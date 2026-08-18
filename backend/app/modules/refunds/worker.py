from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Literal, Protocol, cast

from sqlalchemy.orm import Session

from backend.app.models import RefundAttemptStatus
from backend.app.modules.payments.reconciliation import RECOVERY_LEASE_DURATION
from backend.app.modules.refunds.convergence import (
    RefundConvergenceResult,
    RefundConvergenceService,
)
from backend.app.modules.refunds.provider import (
    CreateRefundRequest,
    QueryRefundRequest,
    QueryRefundResult,
    QueryRefundStatus,
    RefundAccepted,
    RefundProvider,
    RefundRejected,
    RefundUnknown,
)
from backend.app.modules.refunds.repository import RefundRepository


class NamedRefundProvider(RefundProvider, Protocol):
    name: str


class RefundReconciliationService:
    def __init__(
        self,
        *,
        session_factory: Callable[[], Session],
        provider: NamedRefundProvider,
        convergence: RefundConvergenceService,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self._session_factory = session_factory
        self._provider = provider
        self._convergence = convergence
        self._now = now or (lambda: datetime.now(UTC))

    @property
    def provider_name(self) -> str:
        return self._provider.name

    def recover(
        self,
        attempt_id: uuid.UUID,
        *,
        claim_token: uuid.UUID | None = None,
    ) -> RefundConvergenceResult:
        now = self._now()
        with self._session_factory() as locating:
            repository = RefundRepository(locating)
            payment_id = repository.locate_attempt_payment_id(attempt_id)
            if payment_id is None:
                raise LookupError("refund attempt not found")

        with self._session_factory() as session:
            graph = RefundRepository(session).lock_refund_graph(payment_id)
            attempt = next(
                (candidate for candidate in graph.attempts if candidate.id == attempt_id),
                None,
            )
            if attempt is None or attempt.provider != self._provider.name:
                raise LookupError("refund attempt not found")
            if attempt.status in {
                RefundAttemptStatus.SUCCESS,
                RefundAttemptStatus.FAILED,
            }:
                attempt.reconcile_claim_token = None
                attempt.reconcile_lease_until = None
                session.commit()
                return RefundConvergenceResult(graph.order.id, attempt.id, True)
            if claim_token is None:
                lease_active = (
                    attempt.reconcile_lease_until is not None
                    and attempt.reconcile_lease_until > now
                )
                if (
                    lease_active
                    or attempt.next_reconcile_at is None
                    or attempt.next_reconcile_at > now
                ):
                    session.commit()
                    return RefundConvergenceResult(graph.order.id, attempt.id, False)
                claim_token = uuid.uuid4()
                attempt.reconcile_claim_token = claim_token
                attempt.reconcile_lease_until = now + RECOVERY_LEASE_DURATION
            elif (
                attempt.reconcile_claim_token != claim_token
                or attempt.reconcile_lease_until is None
                or attempt.reconcile_lease_until <= now
            ):
                session.commit()
                return RefundConvergenceResult(graph.order.id, attempt.id, False)
            status = attempt.status
            merchant_refund_no = attempt.merchant_refund_no
            payment = graph.payment
            refund_case = graph.refund_case
            assert refund_case is not None
            provider_transaction_no = payment.provider_transaction_no or ""
            merchant_order_no = payment.merchant_order_no
            amount_cents = refund_case.amount_cents
            currency = cast(Literal["CNY"], refund_case.currency)
            session.commit()

        creation: RefundAccepted | RefundRejected | RefundUnknown | None = None
        if status is RefundAttemptStatus.CREATING:
            try:
                creation = self._provider.create_refund(
                    CreateRefundRequest(
                        merchant_refund_no=merchant_refund_no,
                        merchant_order_no=merchant_order_no,
                        provider_transaction_no=provider_transaction_no,
                        amount_cents=amount_cents,
                        currency=currency,
                    )
                )
            except Exception:
                creation = RefundUnknown("REFUND_PROVIDER_CREATE_FAILED")
            if isinstance(creation, RefundAccepted):
                if not self._record_accepted(
                    payment_id=payment_id,
                    attempt_id=attempt_id,
                    claim_token=claim_token,
                    provider_refund_no=creation.provider_refund_no,
                ):
                    return RefundConvergenceResult(graph.order.id, attempt_id, False)

        try:
            queried = self._provider.query_refund(QueryRefundRequest(merchant_refund_no))
        except Exception:
            queried = QueryRefundResult(
                QueryRefundStatus.UNKNOWN,
                safe_error_code="REFUND_PROVIDER_QUERY_FAILED",
            )

        if queried.status is QueryRefundStatus.NOT_FOUND and creation is not None:
            if isinstance(creation, RefundRejected):
                queried = QueryRefundResult(
                    QueryRefundStatus.FAILED,
                    safe_error_code=creation.safe_error_code,
                )
            elif isinstance(creation, RefundUnknown):
                queried = QueryRefundResult(
                    QueryRefundStatus.UNKNOWN,
                    safe_error_code=creation.safe_error_code,
                )
            else:
                queried = QueryRefundResult(QueryRefundStatus.PROCESSING)
        return self._convergence.converge(
            attempt_id=attempt_id,
            provider=self._provider.name,
            result=queried,
            claim_token=claim_token,
        )

    def _record_accepted(
        self,
        *,
        payment_id: uuid.UUID,
        attempt_id: uuid.UUID,
        claim_token: uuid.UUID,
        provider_refund_no: str,
    ) -> bool:
        with self._session_factory() as session:
            graph = RefundRepository(session).lock_refund_graph(payment_id)
            attempt = next(
                (candidate for candidate in graph.attempts if candidate.id == attempt_id),
                None,
            )
            if (
                attempt is None
                or attempt.reconcile_claim_token != claim_token
                or attempt.reconcile_lease_until is None
                or attempt.reconcile_lease_until <= self._now()
            ):
                session.commit()
                return False
            attempt.provider_refund_no = provider_refund_no
            attempt.status = RefundAttemptStatus.PROCESSING
            session.commit()
            return True
