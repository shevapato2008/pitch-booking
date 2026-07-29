import uuid
from collections.abc import Callable
from datetime import datetime, timedelta

import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from backend.app.models import Order, OrderStatus, Payment, PaymentState, Slot, SlotStatus
from backend.app.modules.payments.convergence import PaymentConvergenceService
from backend.app.modules.payments.mock_provider import MockPaymentProvider
from backend.app.modules.payments.provider import ClosePaymentRequest, CreatePrepayRequest
from backend.app.modules.payments.reconciliation import PaymentReconciliationService
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
            CreatePrepayRequest(merchant, "booking", payment.amount_cents, "CNY", "openid")
        )
        return merchant


class RecoveryLockCheckingProvider(LockCheckingProvider):
    def close_payment(self, request: ClosePaymentRequest):  # type: ignore[no-untyped-def]
        self._assert_no_business_row_locks(request.merchant_order_no)
        return super().close_payment(request)


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
