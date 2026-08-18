from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from backend.app.config import Settings
from backend.app.models import (
    Payment,
    PaymentState,
    RefundAttempt,
    RefundAttemptStatus,
    RefundCasePurpose,
    RefundReason,
)
from backend.app.modules.payments.mock_provider import MockPaymentProvider
from backend.app.modules.refunds.convergence import RefundConvergenceService
from backend.app.modules.refunds.provider import (
    CreateRefundRequest,
    QueryRefundRequest,
    QueryRefundResult,
    QueryRefundStatus,
    RefundAccepted,
)
from backend.app.modules.refunds.repository import RefundRepository
from backend.app.modules.refunds.worker import RefundReconciliationService
from backend.app.worker import ExpiryWorker, main
from backend.tests.test_payment_settlement import seed_payment, session_factory
from backend.tests.test_refund_convergence import seed_refund, success_result

pytestmark = pytest.mark.integration
NOW = datetime(2026, 8, 19, 4, tzinfo=UTC)


class RecordingRefundProvider:
    name = "wechat"

    def __init__(
        self,
        *,
        query: QueryRefundResult,
        accepted: RefundAccepted | None = None,
    ) -> None:
        self.query = query
        self.accepted = accepted or RefundAccepted("provider-refund-1")
        self.create_requests: list[CreateRefundRequest] = []
        self.query_requests: list[QueryRefundRequest] = []

    def create_refund(self, request: CreateRefundRequest) -> RefundAccepted:
        self.create_requests.append(request)
        return self.accepted

    def query_refund(self, request: QueryRefundRequest) -> QueryRefundResult:
        self.query_requests.append(request)
        return self.query


def reconciliation(
    engine: Engine,
    provider: RecordingRefundProvider,
    *,
    now: Callable[[], datetime] = lambda: NOW,
) -> RefundReconciliationService:
    return RefundReconciliationService(
        session_factory=session_factory(engine),
        provider=provider,
        convergence=RefundConvergenceService(
            session_factory=session_factory(engine),
            expected_merchant_id="1900000109",
            now=now,
        ),
        now=now,
    )


def test_creating_attempt_reuses_persisted_merchant_number_and_records_acceptance(
    pg_engine: Engine,
) -> None:
    _, _, _, attempt_id = seed_refund(
        pg_engine,
        purpose=RefundCasePurpose.ORDER_CANCELLATION,
        reason=RefundReason.USER_CANCELLED,
        applied=True,
    )
    with Session(pg_engine) as session:
        attempt = session.get_one(RefundAttempt, attempt_id)
        attempt.status = RefundAttemptStatus.CREATING
        merchant = attempt.merchant_refund_no
        session.commit()
    provider = RecordingRefundProvider(query=QueryRefundResult(QueryRefundStatus.PROCESSING))

    reconciliation(pg_engine, provider).recover(attempt_id)

    assert provider.create_requests[0].merchant_refund_no == merchant
    assert provider.query_requests == [QueryRefundRequest(merchant)]
    with Session(pg_engine) as session:
        attempt = session.get_one(RefundAttempt, attempt_id)
        assert attempt.status is RefundAttemptStatus.PROCESSING
        assert attempt.provider_refund_no == "provider-refund-1"
        assert attempt.next_reconcile_at == NOW + timedelta(minutes=1)


def test_due_refund_is_claimed_and_fresh_worker_resumes_persisted_attempt(
    pg_engine: Engine,
) -> None:
    _, _, _, attempt_id = seed_refund(
        pg_engine,
        purpose=RefundCasePurpose.ORDER_CANCELLATION,
        reason=RefundReason.USER_CANCELLED,
        applied=True,
    )
    provider = RecordingRefundProvider(query=success_result(pg_engine, attempt_id))
    recovery = reconciliation(pg_engine, provider)

    processed = ExpiryWorker(
        session_factory=session_factory(pg_engine),
        refund_reconciliation=recovery,
        clock=lambda: NOW,
        batch_size=1,
    ).run_once()

    assert processed == 1
    with Session(pg_engine) as session:
        assert session.get_one(RefundAttempt, attempt_id).status is RefundAttemptStatus.SUCCESS


def test_refund_provider_io_runs_after_claim_transaction_releases_row_locks(
    pg_engine: Engine,
) -> None:
    _, _, _, attempt_id = seed_refund(
        pg_engine,
        purpose=RefundCasePurpose.ORDER_CANCELLATION,
        reason=RefundReason.USER_CANCELLED,
        applied=True,
    )

    class LockCheckingProvider(RecordingRefundProvider):
        def query_refund(self, request: QueryRefundRequest) -> QueryRefundResult:
            with Session(pg_engine) as probe:
                claimed = RefundRepository(probe).claim_next_due_attempt(
                    now=NOW,
                    provider="wechat",
                    lease_until=NOW + timedelta(minutes=10),
                )
                assert claimed is None
            return super().query_refund(request)

    provider = LockCheckingProvider(query=success_result(pg_engine, attempt_id))
    reconciliation(pg_engine, provider).recover(attempt_id)
    assert provider.query_requests


def test_fresh_main_from_settings_resumes_persisted_payment_and_closes_provider(
    pg_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, payment_id, _, _ = seed_payment(
        pg_engine,
        status=PaymentState.CREATING,
        now=NOW,
    )

    class CombinedProvider(MockPaymentProvider):
        closed = False

        def close(self) -> None:
            self.closed = True

        def create_refund(self, request: object) -> object:
            raise AssertionError(f"unexpected refund creation: {request!r}")

        def query_refund(self, request: object) -> object:
            raise AssertionError(f"unexpected refund query: {request!r}")

    provider = CombinedProvider()
    monkeypatch.setattr("backend.app.worker.build_payment_provider", lambda _settings: provider)

    exit_code = main(
        ["--once", "--batch-size", "1"],
        session_factory=session_factory(pg_engine),
        clock=lambda: NOW,
        settings=Settings(
            app_env="development",
            payment_provider="mock",
            enable_mock_payment_provider=True,
        ),
    )

    assert exit_code == 0
    assert provider.closed is True
    with Session(pg_engine) as session:
        assert session.get_one(Payment, payment_id).status is PaymentState.PREPAY_CREATED
