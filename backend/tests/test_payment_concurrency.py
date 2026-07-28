from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import Engine, func, select, text
from sqlalchemy.orm import Session

from backend.app.models import IdempotencyRecord, IdempotencyState, Payment, PaymentState
from backend.app.modules.payments.mock_provider import MockCreateMode, MockPaymentProvider
from backend.app.modules.payments.provider import (
    CreatePrepayRequest,
    QueryPaymentRequest,
    Unknown,
)
from backend.app.modules.payments.service import _PhaseOne
from backend.tests.test_payment_creation import seed_order, service

pytestmark = pytest.mark.integration


class LockCheckingProvider(MockPaymentProvider):
    def __init__(self, engine: Engine) -> None:
        super().__init__()
        self.engine = engine

    def _assert_no_business_row_locks(self) -> None:
        with self.engine.connect() as connection:
            locked = connection.scalar(
                text(
                    "SELECT count(*) FROM pg_locks l JOIN pg_class c ON c.oid=l.relation "
                    "WHERE l.pid=pg_backend_pid() AND l.granted AND l.mode='RowShareLock' "
                    "AND c.relname IN ('slots','orders','payments','idempotency_records')"
                )
            )
        assert locked == 0

    def query_payment(self, request: QueryPaymentRequest):  # type: ignore[no-untyped-def]
        self._assert_no_business_row_locks()
        return super().query_payment(request)

    def create_prepay(self, request: CreatePrepayRequest):  # type: ignore[no-untyped-def]
        self._assert_no_business_row_locks()
        return super().create_prepay(request)


def test_provider_calls_happen_without_business_row_locks(pg_engine: Engine) -> None:
    user_id, order_id = seed_order(pg_engine)

    result = service(pg_engine, LockCheckingProvider(pg_engine)).create_payment(
        user_id=user_id,
        order_id=order_id,
        idempotency_key="payment-lock-check-key",
        payer_openid="openid",
    )

    assert result.status_code == 201


def test_crash_before_provider_retries_same_merchant_number(pg_engine: Engine) -> None:
    user_id, order_id = seed_order(pg_engine)
    provider = MockPaymentProvider()
    payments = service(pg_engine, provider)
    phase = payments._phase_one(  # noqa: SLF001 - intentional crash-window seam
        user_id=user_id, order_id=order_id, idempotency_key="payment-crash-before"
    )
    assert not hasattr(phase, "status_code")
    with Session(pg_engine) as session:
        merchant_order_no = session.scalar(select(Payment.merchant_order_no))

    recovered = payments.create_payment(
        user_id=user_id,
        order_id=order_id,
        idempotency_key="payment-crash-before",
        payer_openid="openid",
    )

    assert recovered.status_code == 200
    assert provider.calls[-1].merchant_order_no == merchant_order_no
    assert provider.provider_order_count == 1


def test_crash_after_provider_acceptance_recovers_by_query(pg_engine: Engine) -> None:
    user_id, order_id = seed_order(pg_engine)
    provider = MockPaymentProvider()
    payments = service(pg_engine, provider)
    payments._phase_one(  # noqa: SLF001 - intentional crash-window seam
        user_id=user_id, order_id=order_id, idempotency_key="payment-crash-after"
    )
    with Session(pg_engine) as session:
        payment = session.scalar(select(Payment))
        assert payment is not None
        merchant_order_no = payment.merchant_order_no
        amount = payment.amount_cents
    provider.create_prepay(
        CreatePrepayRequest(merchant_order_no, "预订场地", amount, "CNY", "openid")
    )

    recovered = payments.create_payment(
        user_id=user_id,
        order_id=order_id,
        idempotency_key="payment-crash-after",
        payer_openid="openid",
    )

    assert recovered.status_code == 200
    assert [call.method for call in provider.calls].count("create_prepay") == 1


def test_twenty_concurrent_keys_share_one_nonterminal_payment(pg_engine: Engine) -> None:
    user_id, order_id = seed_order(pg_engine)
    provider = MockPaymentProvider()

    def create(index: int) -> tuple[int, str]:
        result = service(pg_engine, provider).create_payment(
            user_id=user_id,
            order_id=order_id,
            idempotency_key=f"payment-concurrent-{index:04d}",
            payer_openid="openid",
        )
        return result.status_code, str(result.body["payment_id"])

    with ThreadPoolExecutor(max_workers=20) as pool:
        results = list(pool.map(create, range(20)))

    assert len({payment_id for _status, payment_id in results}) == 1
    assert sum(status == 201 for status, _payment_id in results) == 1
    with Session(pg_engine) as session:
        assert session.scalar(select(func.count()).select_from(Payment)) == 1
        payment = session.scalar(select(Payment))
        assert payment is not None and payment.status is PaymentState.PREPAY_CREATED
        assert session.scalar(select(func.count()).select_from(IdempotencyRecord)) == 20
        assert {record.payment_id for record in session.scalars(select(IdempotencyRecord))} == {
            payment.id
        }
    assert provider.provider_order_count == 1


def test_stale_unknown_for_same_key_replays_completed_prepay_without_regression(
    pg_engine: Engine,
) -> None:
    user_id, order_id = seed_order(pg_engine)
    provider = MockPaymentProvider(create_mode=MockCreateMode.UNKNOWN_AFTER_ACCEPTANCE)
    payments = service(pg_engine, provider)
    fast = payments._phase_one(  # noqa: SLF001 - deterministic phase interleaving
        user_id=user_id, order_id=order_id, idempotency_key="payment-same-key-race"
    )
    slow = payments._phase_one(  # noqa: SLF001 - deterministic phase interleaving
        user_id=user_id, order_id=order_id, idempotency_key="payment-same-key-race"
    )
    assert isinstance(fast, _PhaseOne) and isinstance(slow, _PhaseOne)
    unknown = provider.create_prepay(
        CreatePrepayRequest(
            fast.merchant_order_no,
            "预订场地",
            32000,
            "CNY",
            "openid",
        )
    )
    assert isinstance(unknown, Unknown)
    accepted = provider.query_payment(QueryPaymentRequest(fast.merchant_order_no))

    created = payments._phase_three(fast, accepted)  # noqa: SLF001
    replay = payments._phase_three(slow, unknown)  # noqa: SLF001

    assert created.status_code == 201
    assert replay.status_code == 200
    assert replay.body == created.body
    with Session(pg_engine) as session:
        payment = session.scalar(select(Payment))
        record = session.scalar(select(IdempotencyRecord))
        assert payment is not None and payment.status is PaymentState.PREPAY_CREATED
        assert record is not None and record.state is IdempotencyState.COMPLETED


def test_stale_unknown_for_different_key_keeps_current_monotonic_result(
    pg_engine: Engine,
) -> None:
    user_id, order_id = seed_order(pg_engine)
    provider = MockPaymentProvider(create_mode=MockCreateMode.UNKNOWN_AFTER_ACCEPTANCE)
    payments = service(pg_engine, provider)
    fast = payments._phase_one(  # noqa: SLF001 - deterministic phase interleaving
        user_id=user_id, order_id=order_id, idempotency_key="payment-fast-key-race"
    )
    slow = payments._phase_one(  # noqa: SLF001 - deterministic phase interleaving
        user_id=user_id, order_id=order_id, idempotency_key="payment-slow-key-race"
    )
    assert isinstance(fast, _PhaseOne) and isinstance(slow, _PhaseOne)
    unknown = provider.create_prepay(
        CreatePrepayRequest(
            fast.merchant_order_no,
            "预订场地",
            32000,
            "CNY",
            "openid",
        )
    )
    assert isinstance(unknown, Unknown)
    accepted = provider.query_payment(QueryPaymentRequest(fast.merchant_order_no))

    created = payments._phase_three(fast, accepted)  # noqa: SLF001
    unfinished = payments._phase_three(slow, unknown)  # noqa: SLF001

    assert created.status_code == 201
    assert unfinished.status_code == 202
    with Session(pg_engine) as session:
        payment = session.scalar(select(Payment))
        records = session.scalars(select(IdempotencyRecord).order_by(IdempotencyRecord.key)).all()
        assert payment is not None and payment.status is PaymentState.PREPAY_CREATED
        assert {record.payment_id for record in records} == {payment.id}
        assert {record.state for record in records} == {
            IdempotencyState.COMPLETED,
            IdempotencyState.PROCESSING,
        }

    recovered = payments.create_payment(
        user_id=user_id,
        order_id=order_id,
        idempotency_key="payment-slow-key-race",
        payer_openid="openid",
    )
    assert recovered.status_code == 200
    assert recovered.body["payment_id"] == created.body["payment_id"]
    with Session(pg_engine) as session:
        assert set(session.scalars(select(IdempotencyRecord.state))) == {IdempotencyState.COMPLETED}
        assert session.scalar(select(Payment.status)) is PaymentState.PREPAY_CREATED
