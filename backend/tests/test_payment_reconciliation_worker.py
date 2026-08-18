import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier, Event

import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from backend.app.models import Order, OrderStatus, Payment, PaymentState, Slot, SlotStatus
from backend.app.modules.payments.convergence import PaymentConvergenceService
from backend.app.modules.payments.mock_provider import MockCreateMode, MockPaymentProvider
from backend.app.modules.payments.provider import (
    PAYMENT_PROVIDER_MAX_REQUEST_DURATION,
    ClosePaymentRequest,
    Created,
    CreatePrepayRequest,
    QueryPaymentRequest,
    QueryPaymentResult,
    QueryPaymentStatus,
)
from backend.app.modules.payments.reconciliation import (
    RECOVERY_LEASE_DURATION,
    PaymentReconciliationService,
)
from backend.app.modules.payments.repository import PaymentRecoveryClaim, PaymentRepository
from backend.app.worker import ExpiryWorker
from backend.tests.test_payment_concurrency import LockCheckingProvider
from backend.tests.test_payment_settlement import seed_payment, session_factory

pytestmark = pytest.mark.integration


def fixed_now(value: datetime) -> Callable[[], datetime]:
    return lambda: value


def recovery_service(
    engine: Engine,
    provider: MockPaymentProvider,
    *,
    now: Callable[[], datetime],
) -> PaymentReconciliationService:
    return PaymentReconciliationService(
        session_factory=session_factory(engine),
        provider=provider,
        convergence=PaymentConvergenceService(
            session_factory=session_factory(engine),
            expected_app_id=provider.app_id,
            expected_merchant_id=provider.merchant_id,
            now=now,
        ),
        now=now,
    )


def seed_provider_order(
    engine: Engine,
    provider: MockPaymentProvider,
    payment_id: uuid.UUID,
) -> str:
    with Session(engine) as session:
        payment = session.get_one(Payment, payment_id)
        merchant = payment.merchant_order_no
        provider.create_prepay(
            CreatePrepayRequest(
                merchant,
                "booking",
                payment.amount_cents,
                "CNY",
                "openid",
                payment.order.expires_at,
            )
        )
        return merchant


class RecoveryLockCheckingProvider(LockCheckingProvider):
    def close_payment(self, request: ClosePaymentRequest):  # type: ignore[no-untyped-def]
        self._assert_no_business_row_locks(request.merchant_order_no)
        return super().close_payment(request)


class CreateCrashesOnceProvider(MockPaymentProvider):
    def __init__(self) -> None:
        super().__init__()
        self.crash_create = True

    def create_prepay(self, request: CreatePrepayRequest):  # type: ignore[no-untyped-def]
        if self.crash_create:
            self.crash_create = False
            raise RuntimeError("injected create timeout")
        return super().create_prepay(request)


class CapturingRecoveryProvider(MockPaymentProvider):
    create_request: CreatePrepayRequest | None = None

    def create_prepay(self, request: CreatePrepayRequest):  # type: ignore[no-untyped-def]
        self.create_request = request
        return super().create_prepay(request)


class RequeryCrashesProvider(MockPaymentProvider):
    def __init__(self) -> None:
        super().__init__(create_mode=MockCreateMode.REJECTED)
        self.query_count = 0

    def query_payment(self, request: QueryPaymentRequest) -> QueryPaymentResult:
        self.query_count += 1
        if self.query_count == 2:
            raise RuntimeError("injected rejection requery timeout")
        return super().query_payment(request)


class BlockingQueryProvider(MockPaymentProvider):
    def __init__(self) -> None:
        super().__init__()
        self.query_started = Event()
        self.release_query = Event()

    def query_payment(self, request: QueryPaymentRequest) -> QueryPaymentResult:
        self.query_started.set()
        if not self.release_query.wait(timeout=5):
            raise RuntimeError("test did not release Provider query")
        return super().query_payment(request)


class ForcedNotPaidProvider(MockPaymentProvider):
    def __init__(self, *, include_launch_params: bool) -> None:
        super().__init__()
        self.include_launch_params = include_launch_params
        self.created: Created | None = None

    def create_prepay(self, request: CreatePrepayRequest):  # type: ignore[no-untyped-def]
        result = super().create_prepay(request)
        assert isinstance(result, Created)
        self.created = result
        return result

    def query_payment(self, request: QueryPaymentRequest) -> QueryPaymentResult:
        super().query_payment(request)
        if not self.include_launch_params:
            return QueryPaymentResult(QueryPaymentStatus.NOT_PAID)
        assert self.created is not None
        return QueryPaymentResult(
            QueryPaymentStatus.NOT_PAID,
            provider_prepay_id=self.created.provider_prepay_id,
            launch_params=self.created.launch_params,
        )


def test_recovery_lease_exceeds_provider_timeout_contract() -> None:
    assert RECOVERY_LEASE_DURATION >= PAYMENT_PROVIDER_MAX_REQUEST_DURATION * 2


def test_creation_recovery_reuses_persisted_order_expiry(pg_engine: Engine) -> None:
    now = datetime(2026, 8, 18, 4, tzinfo=UTC)
    order_id, payment_id, _, _ = seed_payment(
        pg_engine,
        status=PaymentState.CREATING,
        now=now,
    )
    provider = CapturingRecoveryProvider()

    recovery_service(pg_engine, provider, now=fixed_now(now)).recover(payment_id)

    with Session(pg_engine) as session:
        order = session.get_one(Order, order_id)
        assert provider.create_request is not None
        assert provider.create_request.time_expire == order.expires_at


def test_expired_not_paid_payment_is_queried_closed_then_released(pg_engine: Engine) -> None:
    order_id, payment_id, slot_id, now = seed_payment(
        pg_engine, status=PaymentState.PREPAY_CREATED
    )
    provider = MockPaymentProvider()
    seed_provider_order(pg_engine, provider, payment_id)
    expiry_time = now + timedelta(minutes=11)
    with Session(pg_engine) as session:
        session.get_one(Payment, payment_id).next_reconcile_at = expiry_time
        session.commit()

    result = recovery_service(
        pg_engine, provider, now=lambda: expiry_time
    ).recover(payment_id)

    assert result.terminal is True
    assert [call.method for call in provider.calls][-2:] == ["query_payment", "close_payment"]
    with Session(pg_engine) as session:
        assert session.get_one(Payment, payment_id).status is PaymentState.CLOSED
        assert session.get_one(Order, order_id).status is OrderStatus.EXPIRED
        slot = session.get_one(Slot, slot_id)
        assert slot.status is SlotStatus.AVAILABLE
        assert slot.locked_by_order_id is None


def test_recovery_provider_io_happens_without_business_row_locks(
    pg_engine: Engine,
) -> None:
    order_id, payment_id, _, now = seed_payment(
        pg_engine, status=PaymentState.PREPAY_CREATED
    )
    provider = RecoveryLockCheckingProvider(pg_engine, order_id)
    seed_provider_order(pg_engine, provider, payment_id)
    expiry_time = now + timedelta(minutes=11)
    with Session(pg_engine) as session:
        session.get_one(Payment, payment_id).next_reconcile_at = expiry_time
        session.commit()

    result = recovery_service(
        pg_engine, provider, now=lambda: expiry_time
    ).recover(payment_id)

    assert result.terminal is True


def test_provider_close_failure_keeps_expired_order_locked(pg_engine: Engine) -> None:
    order_id, payment_id, slot_id, now = seed_payment(
        pg_engine, status=PaymentState.PREPAY_CREATED
    )
    provider = MockPaymentProvider()
    merchant = seed_provider_order(pg_engine, provider, payment_id)
    provider.set_close_unknown(merchant)
    expiry_time = now + timedelta(minutes=11)
    with Session(pg_engine) as session:
        session.get_one(Payment, payment_id).next_reconcile_at = expiry_time
        session.commit()

    result = recovery_service(
        pg_engine, provider, now=lambda: expiry_time
    ).recover(payment_id)

    assert result.terminal is False
    with Session(pg_engine) as session:
        payment = session.get_one(Payment, payment_id)
        assert payment.status is PaymentState.UNKNOWN
        assert payment.last_error_code == "MOCK_CLOSE_UNKNOWN"
        assert payment.last_error_at == expiry_time
        assert session.get_one(Order, order_id).status is OrderStatus.PENDING_PAYMENT
        assert session.get_one(Slot, slot_id).status is SlotStatus.LOCKED


def test_payment_exception_success_still_settles_and_books_slot(
    pg_engine: Engine,
) -> None:
    order_id, payment_id, slot_id, now = seed_payment(
        pg_engine, status=PaymentState.UNKNOWN
    )
    provider = MockPaymentProvider()
    merchant = seed_provider_order(pg_engine, provider, payment_id)
    provider.mark_success(
        merchant,
        provider_transaction_no=f"T-{uuid.uuid4().hex}",
        paid_at=now,
    )
    with Session(pg_engine) as session:
        session.get_one(Order, order_id).status = OrderStatus.PAYMENT_EXCEPTION
        session.get_one(Payment, payment_id).next_reconcile_at = now
        session.commit()

    result = recovery_service(pg_engine, provider, now=lambda: now).recover(payment_id)

    assert result.terminal is True
    with Session(pg_engine) as session:
        assert session.get_one(Payment, payment_id).status is PaymentState.SUCCESS
        assert session.get_one(Order, order_id).status is OrderStatus.CONFIRMED
        assert session.get_one(Slot, slot_id).status is SlotStatus.BOOKED


def test_unknown_backoff_persists_across_service_instances(pg_engine: Engine) -> None:
    _, payment_id, _, start = seed_payment(pg_engine, status=PaymentState.PREPAY_CREATED)
    provider = MockPaymentProvider()
    merchant = seed_provider_order(pg_engine, provider, payment_id)
    provider.set_unknown(merchant)
    current = start
    expected_minutes = [1, 2, 5, 10, 30, 30]

    for attempt, expected in enumerate(expected_minutes, start=1):
        with Session(pg_engine) as session:
            session.get_one(Payment, payment_id).next_reconcile_at = current
            session.commit()
        recovery_service(pg_engine, provider, now=fixed_now(current)).recover(payment_id)
        with Session(pg_engine) as session:
            payment = session.get_one(Payment, payment_id)
            assert payment.next_reconcile_at == current + timedelta(minutes=expected)
            assert payment.reconcile_attempts == attempt
        current += timedelta(minutes=expected)


def test_unknown_for_24_hours_enters_exception_and_retries_in_six_hours(
    pg_engine: Engine,
) -> None:
    order_id, payment_id, slot_id, now = seed_payment(
        pg_engine, status=PaymentState.UNKNOWN
    )
    provider = MockPaymentProvider()
    merchant = seed_provider_order(pg_engine, provider, payment_id)
    provider.set_unknown(merchant)
    with Session(pg_engine) as session:
        payment = session.get_one(Payment, payment_id)
        payment.authority_unknown_since = now - timedelta(hours=24)
        payment.next_reconcile_at = now
        session.commit()

    recovery_service(pg_engine, provider, now=lambda: now).recover(payment_id)

    with Session(pg_engine) as session:
        payment = session.get_one(Payment, payment_id)
        assert payment.status is PaymentState.UNKNOWN
        assert payment.authority_unknown_since == now - timedelta(hours=24)
        assert payment.next_reconcile_at == now + timedelta(hours=6)
        assert session.get_one(Order, order_id).status is OrderStatus.PAYMENT_EXCEPTION
        assert session.get_one(Slot, slot_id).status is SlotStatus.LOCKED


def test_creating_before_provider_call_retries_the_same_merchant_number(
    pg_engine: Engine,
) -> None:
    _, payment_id, _, now = seed_payment(pg_engine, status=PaymentState.CREATING)
    provider = MockPaymentProvider()
    with Session(pg_engine) as session:
        payment = session.get_one(Payment, payment_id)
        merchant = payment.merchant_order_no
        payment.next_reconcile_at = now
        session.commit()

    recovery_service(pg_engine, provider, now=lambda: now).recover(payment_id)

    assert provider.provider_order_count == 1
    assert [call.method for call in provider.calls] == ["query_payment", "create_prepay"]
    assert provider.calls[-1].merchant_order_no == merchant
    with Session(pg_engine) as session:
        payment = session.get_one(Payment, payment_id)
        assert payment.status is PaymentState.PREPAY_CREATED
        assert payment.provider_prepay_id is not None


def test_creating_after_provider_acceptance_recovers_without_second_create(
    pg_engine: Engine,
) -> None:
    _, payment_id, _, now = seed_payment(pg_engine, status=PaymentState.CREATING)
    provider = MockPaymentProvider()
    seed_provider_order(pg_engine, provider, payment_id)
    with Session(pg_engine) as session:
        session.get_one(Payment, payment_id).next_reconcile_at = now
        session.commit()

    recovery_service(pg_engine, provider, now=lambda: now).recover(payment_id)

    assert [call.method for call in provider.calls].count("create_prepay") == 1
    with Session(pg_engine) as session:
        assert session.get_one(Payment, payment_id).status is PaymentState.PREPAY_CREATED


def test_expired_creating_not_paid_with_launch_closes_before_release(
    pg_engine: Engine,
) -> None:
    order_id, payment_id, slot_id, now = seed_payment(
        pg_engine, status=PaymentState.CREATING
    )
    provider = ForcedNotPaidProvider(include_launch_params=True)
    seed_provider_order(pg_engine, provider, payment_id)
    expiry_time = now + timedelta(minutes=11)
    with Session(pg_engine) as session:
        session.get_one(Payment, payment_id).next_reconcile_at = expiry_time
        session.commit()

    result = recovery_service(
        pg_engine, provider, now=lambda: expiry_time
    ).recover(payment_id)

    assert result.terminal is True
    assert [call.method for call in provider.calls][-2:] == ["query_payment", "close_payment"]
    with Session(pg_engine) as session:
        assert session.get_one(Payment, payment_id).status is PaymentState.CLOSED
        assert session.get_one(Order, order_id).status is OrderStatus.EXPIRED
        assert session.get_one(Slot, slot_id).status is SlotStatus.AVAILABLE


def test_expired_creation_recovery_not_paid_without_launch_still_closes(
    pg_engine: Engine,
) -> None:
    order_id, payment_id, slot_id, now = seed_payment(
        pg_engine, status=PaymentState.UNKNOWN
    )
    provider = ForcedNotPaidProvider(include_launch_params=False)
    seed_provider_order(pg_engine, provider, payment_id)
    expiry_time = now + timedelta(minutes=11)
    with Session(pg_engine) as session:
        payment = session.get_one(Payment, payment_id)
        payment.creation_recovery_pending = True
        payment.next_reconcile_at = expiry_time
        session.commit()

    recovery_service(pg_engine, provider, now=lambda: expiry_time).recover(payment_id)

    assert [call.method for call in provider.calls][-2:] == ["query_payment", "close_payment"]
    with Session(pg_engine) as session:
        assert session.get_one(Payment, payment_id).status is PaymentState.CLOSED
        assert session.get_one(Order, order_id).status is OrderStatus.EXPIRED
        assert session.get_one(Slot, slot_id).status is SlotStatus.AVAILABLE


def test_expired_creation_recovery_close_success_books_instead_of_releasing(
    pg_engine: Engine,
) -> None:
    order_id, payment_id, slot_id, now = seed_payment(
        pg_engine, status=PaymentState.CREATING
    )
    provider = ForcedNotPaidProvider(include_launch_params=True)
    merchant = seed_provider_order(pg_engine, provider, payment_id)
    provider.mark_success(
        merchant,
        provider_transaction_no=f"T-{uuid.uuid4().hex}",
        paid_at=now,
    )
    expiry_time = now + timedelta(minutes=11)
    with Session(pg_engine) as session:
        session.get_one(Payment, payment_id).next_reconcile_at = expiry_time
        session.commit()

    recovery_service(pg_engine, provider, now=lambda: expiry_time).recover(payment_id)

    with Session(pg_engine) as session:
        assert session.get_one(Payment, payment_id).status is PaymentState.SUCCESS
        assert session.get_one(Order, order_id).status is OrderStatus.CONFIRMED
        assert session.get_one(Slot, slot_id).status is SlotStatus.BOOKED


def test_expired_creation_recovery_close_unknown_never_releases(
    pg_engine: Engine,
) -> None:
    order_id, payment_id, slot_id, now = seed_payment(
        pg_engine, status=PaymentState.CREATING
    )
    provider = ForcedNotPaidProvider(include_launch_params=True)
    merchant = seed_provider_order(pg_engine, provider, payment_id)
    provider.set_close_unknown(merchant)
    expiry_time = now + timedelta(minutes=11)
    with Session(pg_engine) as session:
        session.get_one(Payment, payment_id).next_reconcile_at = expiry_time
        session.commit()

    recovery_service(pg_engine, provider, now=lambda: expiry_time).recover(payment_id)

    with Session(pg_engine) as session:
        assert session.get_one(Payment, payment_id).status is PaymentState.UNKNOWN
        assert session.get_one(Order, order_id).status is OrderStatus.PENDING_PAYMENT
        assert session.get_one(Slot, slot_id).status is SlotStatus.LOCKED


def test_creating_create_timeout_converges_unknown_then_new_service_retries_same_merchant(
    pg_engine: Engine,
) -> None:
    _, payment_id, _, now = seed_payment(pg_engine, status=PaymentState.CREATING)
    provider = CreateCrashesOnceProvider()
    with Session(pg_engine) as session:
        payment = session.get_one(Payment, payment_id)
        merchant = payment.merchant_order_no
        payment.next_reconcile_at = now
        session.commit()

    first = recovery_service(pg_engine, provider, now=lambda: now).recover(payment_id)

    assert first.terminal is False
    with Session(pg_engine) as session:
        payment = session.get_one(Payment, payment_id)
        assert payment.status is PaymentState.UNKNOWN
        assert payment.last_error_code == "PAYMENT_PROVIDER_CREATE_FAILED"
        assert payment.last_error_at == now
        assert payment.authority_unknown_since == now
        assert payment.next_reconcile_at == now + timedelta(minutes=1)

    retry_at = now + timedelta(minutes=1)
    recovery_service(pg_engine, provider, now=lambda: retry_at).recover(payment_id)

    with Session(pg_engine) as session:
        payment = session.get_one(Payment, payment_id)
        assert payment.status is PaymentState.PREPAY_CREATED
        assert payment.merchant_order_no == merchant
        assert payment.reconcile_attempts == 2
        assert payment.next_reconcile_at == retry_at + timedelta(minutes=2)


def test_creating_rejection_requery_timeout_converges_unknown_safely(
    pg_engine: Engine,
) -> None:
    _, payment_id, _, now = seed_payment(pg_engine, status=PaymentState.CREATING)
    provider = RequeryCrashesProvider()
    with Session(pg_engine) as session:
        session.get_one(Payment, payment_id).next_reconcile_at = now
        session.commit()

    result = recovery_service(pg_engine, provider, now=lambda: now).recover(payment_id)

    assert result.terminal is False
    with Session(pg_engine) as session:
        payment = session.get_one(Payment, payment_id)
        assert payment.status is PaymentState.UNKNOWN
        assert payment.last_error_code == "PAYMENT_PROVIDER_REQUERY_FAILED"
        assert payment.last_error_at == now
        assert payment.authority_unknown_since == now
        assert payment.next_reconcile_at == now + timedelta(minutes=1)


def test_new_worker_instance_respects_persisted_next_reconcile_lease(
    pg_engine: Engine,
) -> None:
    _, payment_id, _, now = seed_payment(pg_engine, status=PaymentState.PREPAY_CREATED)
    provider = MockPaymentProvider()
    merchant = seed_provider_order(pg_engine, provider, payment_id)
    provider.set_unknown(merchant)

    recovery_service(pg_engine, provider, now=lambda: now).recover(payment_id)
    calls_after_first = len(provider.calls)
    repeated = recovery_service(pg_engine, provider, now=lambda: now).recover(payment_id)

    assert repeated.terminal is False
    assert len(provider.calls) == calls_after_first
    with Session(pg_engine) as session:
        payment = session.get_one(Payment, payment_id)
        assert payment.reconcile_attempts == 1
        assert payment.next_reconcile_at == now + timedelta(minutes=1)


def test_expired_payment_also_respects_persisted_next_reconcile_lease(
    pg_engine: Engine,
) -> None:
    _, payment_id, _, now = seed_payment(pg_engine, status=PaymentState.PREPAY_CREATED)
    provider = MockPaymentProvider()
    merchant = seed_provider_order(pg_engine, provider, payment_id)
    provider.set_unknown(merchant)
    expiry_time = now + timedelta(minutes=11)

    recovery_service(pg_engine, provider, now=lambda: expiry_time).recover(payment_id)
    calls_after_first = len(provider.calls)
    repeated = recovery_service(
        pg_engine, provider, now=lambda: expiry_time
    ).recover(payment_id)

    assert repeated.terminal is False
    assert len(provider.calls) == calls_after_first
    with Session(pg_engine) as session:
        payment = session.get_one(Payment, payment_id)
        assert payment.reconcile_attempts == 1
        assert payment.next_reconcile_at == expiry_time + timedelta(minutes=1)


def test_first_expiry_crossing_promotes_retry_ahead_of_business_backoff(
    pg_engine: Engine,
) -> None:
    order_id, payment_id, slot_id, now = seed_payment(
        pg_engine, status=PaymentState.PREPAY_CREATED
    )
    provider = MockPaymentProvider()
    seed_provider_order(pg_engine, provider, payment_id)
    expiry_time = now + timedelta(minutes=11)
    with Session(pg_engine) as session:
        payment = session.get_one(Payment, payment_id)
        payment.reconcile_attempts = 4
        payment.next_reconcile_at = now + timedelta(minutes=30)
        session.commit()

    processed = ExpiryWorker(
        session_factory=lambda: Session(pg_engine),
        payment_reconciliation=recovery_service(
            pg_engine, provider, now=lambda: expiry_time
        ),
        clock=lambda: expiry_time,
    ).run(once=True)

    assert processed == 1
    assert [call.method for call in provider.calls][-2:] == ["query_payment", "close_payment"]
    with Session(pg_engine) as session:
        assert session.get_one(Payment, payment_id).status is PaymentState.CLOSED
        assert session.get_one(Order, order_id).status is OrderStatus.EXPIRED
        assert session.get_one(Slot, slot_id).status is SlotStatus.AVAILABLE


def test_active_io_lease_blocks_expiry_promotion(pg_engine: Engine) -> None:
    _, payment_id, _, now = seed_payment(
        pg_engine, status=PaymentState.PREPAY_CREATED
    )
    provider = MockPaymentProvider()
    seed_provider_order(pg_engine, provider, payment_id)
    expiry_time = now + timedelta(minutes=11)
    with Session(pg_engine) as session:
        payment = session.get_one(Payment, payment_id)
        payment.reconcile_attempts = 4
        payment.next_reconcile_at = now + timedelta(minutes=30)
        payment.reconcile_claim_token = uuid.uuid4()
        payment.reconcile_lease_until = expiry_time + timedelta(minutes=5)
        session.commit()

    processed = ExpiryWorker(
        session_factory=lambda: Session(pg_engine),
        payment_reconciliation=recovery_service(
            pg_engine, provider, now=lambda: expiry_time
        ),
        clock=lambda: expiry_time,
    ).run(once=True)

    assert processed == 0
    assert [call.method for call in provider.calls] == ["create_prepay"]


def test_concurrent_atomic_claim_returns_payment_to_only_one_worker(
    pg_engine: Engine,
) -> None:
    _, payment_id, _, now = seed_payment(
        pg_engine, status=PaymentState.PREPAY_CREATED
    )
    start = Barrier(2)

    def claim_once(_index: int) -> PaymentRecoveryClaim | None:
        start.wait(timeout=5)
        with Session(pg_engine) as session:
            claim = PaymentRepository(session).claim_next_due_payment(
                now=now,
                provider="mock",
                lease_until=now + timedelta(minutes=10),
            )
            session.commit()
            return claim

    with ThreadPoolExecutor(max_workers=2) as pool:
        claims = list(pool.map(claim_once, range(2)))

    claimed = [claim for claim in claims if claim is not None]
    assert len(claimed) == 1
    assert claimed[0].payment_id == payment_id


def test_second_worker_does_not_call_provider_during_first_workers_io(
    pg_engine: Engine,
) -> None:
    _, payment_id, _, now = seed_payment(
        pg_engine, status=PaymentState.PREPAY_CREATED
    )
    provider = BlockingQueryProvider()
    seed_provider_order(pg_engine, provider, payment_id)
    service = recovery_service(pg_engine, provider, now=lambda: now)

    def worker() -> int:
        return ExpiryWorker(
            session_factory=lambda: Session(pg_engine),
            payment_reconciliation=service,
            clock=lambda: now,
        ).run(once=True)

    with ThreadPoolExecutor(max_workers=1) as pool:
        first = pool.submit(worker)
        assert provider.query_started.wait(timeout=5)
        try:
            assert worker() == 0
        finally:
            provider.release_query.set()
        assert first.result(timeout=5) == 1

    assert [call.method for call in provider.calls].count("query_payment") == 1


def test_worker_scans_due_payments_and_recovers_them(pg_engine: Engine) -> None:
    order_id, payment_id, _, now = seed_payment(
        pg_engine, status=PaymentState.PREPAY_CREATED
    )
    provider = MockPaymentProvider()
    seed_provider_order(pg_engine, provider, payment_id)
    with Session(pg_engine) as session:
        payment = session.get_one(Payment, payment_id)
        payment.next_reconcile_at = now
        session.commit()
    service = recovery_service(pg_engine, provider, now=lambda: now)

    processed = ExpiryWorker(
        session_factory=lambda: Session(pg_engine),
        payment_reconciliation=service,
        clock=lambda: now,
    ).run(once=True)

    assert processed == 1
    with Session(pg_engine) as session:
        assert session.get_one(Payment, payment_id).reconcile_attempts == 1
        assert session.get_one(Order, order_id).status is OrderStatus.PENDING_PAYMENT


def test_payment_exception_closed_authority_expires_and_releases_original_lock(
    pg_engine: Engine,
) -> None:
    order_id, payment_id, slot_id, now = seed_payment(
        pg_engine, status=PaymentState.UNKNOWN
    )
    provider = MockPaymentProvider()
    seed_provider_order(pg_engine, provider, payment_id)
    expiry_time = now + timedelta(minutes=11)
    with Session(pg_engine) as session:
        order = session.get_one(Order, order_id)
        order.status = OrderStatus.PAYMENT_EXCEPTION
        session.get_one(Payment, payment_id).next_reconcile_at = expiry_time
        session.commit()

    recovery_service(
        pg_engine, provider, now=lambda: expiry_time
    ).recover(payment_id)

    with Session(pg_engine) as session:
        assert session.get_one(Payment, payment_id).status is PaymentState.CLOSED
        assert session.get_one(Order, order_id).status is OrderStatus.EXPIRED
        slot = session.get_one(Slot, slot_id)
        assert slot.status is SlotStatus.AVAILABLE
        assert slot.locked_by_order_id is None
