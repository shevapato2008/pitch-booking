import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier
from typing import Any

import pytest
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session

from backend.app.models import (
    Order,
    OrderStatus,
    Payment,
    PaymentState,
    RefundAttempt,
    RefundAttemptStatus,
    RefundCase,
    RefundCasePurpose,
    Slot,
    SlotStatus,
    User,
)
from backend.app.modules.orders.service import _project_payment
from backend.app.modules.payments.convergence import PaymentConvergenceService
from backend.app.modules.payments.provider import (
    AuthoritativePaymentFacts,
    QueryPaymentResult,
    QueryPaymentStatus,
)
from backend.tests.test_schema_constraints import add_pitch, add_slot, venue

pytestmark = pytest.mark.integration


def session_factory(engine: Engine) -> Callable[[], Session]:
    return lambda: Session(engine)


def seed_payment(
    engine: Engine,
    *,
    status: PaymentState = PaymentState.CONFIRMING,
    slot_status: SlotStatus = SlotStatus.LOCKED,
    transaction_no: str | None = None,
    now: datetime | None = None,
) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID, datetime]:
    now = now or datetime.now(UTC)
    with Session(engine) as session:
        user = User(wechat_app_id="mock-app-id", wechat_openid=f"owner-{uuid.uuid4()}")
        pitch = add_pitch(session, venue())
        slot = add_slot(session, pitch, now + timedelta(days=1), now + timedelta(days=1, hours=2))
        order = Order(
            id=uuid.uuid4(),
            order_number=f"PB-{uuid.uuid4().hex}",
            user=user,
            slot=slot,
            status=OrderStatus.PENDING_PAYMENT,
            price_cents=32000,
            contact_name="张三",
            contact_phone_ciphertext=b"encrypted-phone-value",
            contact_phone_nonce=b"abcdefghijkl",
            contact_phone_key_version=1,
            created_at=now,
            expires_at=now + timedelta(minutes=10),
        )
        session.add(order)
        session.flush()
        payment = Payment(
            id=uuid.uuid4(),
            order=order,
            provider="mock",
            merchant_order_no=f"PB{uuid.uuid4().hex[:30]}",
            provider_transaction_no=transaction_no,
            amount_cents=32000,
            currency="CNY",
            status=status,
            paid_at=now if status is PaymentState.SUCCESS else None,
        )
        slot.status = slot_status
        if slot_status is SlotStatus.LOCKED:
            slot.locked_by_order_id = order.id
            slot.locked_until = order.expires_at
        session.add(payment)
        session.commit()
        return order.id, payment.id, slot.id, now


def success_facts(
    engine: Engine,
    payment_id: uuid.UUID,
    *,
    transaction_no: str = "tx-1",
    changes: dict[str, object] | None = None,
    **overrides: Any,
) -> AuthoritativePaymentFacts:
    with Session(engine) as session:
        payment = session.get_one(Payment, payment_id)
        values: dict[str, object] = {
            "app_id": "mock-app-id",
            "merchant_id": "mock-merchant-id",
            "merchant_order_no": payment.merchant_order_no,
            "provider_transaction_no": transaction_no,
            "amount_cents": payment.amount_cents,
            "currency": "CNY",
            "paid_at": datetime.now(UTC),
        }
    values.update(changes or {})
    values.update(overrides)
    return AuthoritativePaymentFacts(**values)  # type: ignore[arg-type]


def convergence(engine: Engine) -> PaymentConvergenceService:
    return PaymentConvergenceService(
        session_factory=session_factory(engine),
        expected_app_id="mock-app-id",
        expected_merchant_id="mock-merchant-id",
    )


def test_verified_success_atomically_books_and_duplicate_or_old_close_cannot_regress(
    pg_engine: Engine,
) -> None:
    order_id, payment_id, slot_id, _ = seed_payment(pg_engine)
    facts = success_facts(pg_engine, payment_id)
    service = convergence(pg_engine)

    first = service.converge(
        payment_id=payment_id,
        provider="mock",
        result=QueryPaymentResult(QueryPaymentStatus.SUCCESS, facts=facts),
    )
    duplicate = service.converge(
        payment_id=payment_id,
        provider="mock",
        result=QueryPaymentResult(QueryPaymentStatus.SUCCESS, facts=facts),
    )
    service.converge(
        payment_id=payment_id, provider="mock", result=QueryPaymentResult(QueryPaymentStatus.CLOSED)
    )

    with Session(pg_engine) as session:
        payment = session.get_one(Payment, payment_id)
        order = session.get_one(Order, order_id)
        slot = session.get_one(__import__("backend.app.models", fromlist=["Slot"]).Slot, slot_id)
        assert first.terminal and duplicate.terminal
        assert payment.status is PaymentState.SUCCESS
        assert payment.provider_transaction_no == "tx-1"
        assert payment.applied_to_order_at is not None
        assert order.status is OrderStatus.CONFIRMED
        assert slot.status is SlotStatus.BOOKED
        assert slot.locked_by_order_id is None and slot.locked_until is None


@pytest.mark.parametrize(
    ("changes", "code"),
    [
        ({"amount_cents": 1}, "PAYMENT_AMOUNT_MISMATCH"),
        ({"currency": "USD"}, "PAYMENT_CURRENCY_MISMATCH"),
        ({"app_id": "wrong"}, "PAYMENT_APP_ID_MISMATCH"),
        ({"merchant_id": "wrong"}, "PAYMENT_MERCHANT_ID_MISMATCH"),
        ({"merchant_order_no": "wrong"}, "PAYMENT_ORDER_NO_MISMATCH"),
    ],
)
def test_success_fact_mismatch_is_searchable_but_never_confirms(
    pg_engine: Engine, changes: dict[str, object], code: str
) -> None:
    order_id, payment_id, _, _ = seed_payment(pg_engine)
    convergence(pg_engine).converge(
        payment_id=payment_id,
        provider="mock",
        result=QueryPaymentResult(
            QueryPaymentStatus.SUCCESS,
            facts=success_facts(pg_engine, payment_id, changes=changes),
        ),
    )
    with Session(pg_engine) as session:
        payment = session.get_one(Payment, payment_id)
        assert payment.status is PaymentState.UNKNOWN
        assert payment.last_error_code == code
        assert session.get_one(Order, order_id).status is OrderStatus.PAYMENT_EXCEPTION


def test_transaction_uniqueness_and_inventory_collision_preserve_money_fact_without_double_booking(
    pg_engine: Engine,
) -> None:
    first_order, first_payment, _, _ = seed_payment(pg_engine)
    second_order, second_payment, second_slot, _ = seed_payment(pg_engine)
    service = convergence(pg_engine)
    service.converge(
        payment_id=first_payment,
        provider="mock",
        result=QueryPaymentResult(
            QueryPaymentStatus.SUCCESS,
            facts=success_facts(pg_engine, first_payment, transaction_no="same-tx"),
        ),
    )
    service.converge(
        payment_id=second_payment,
        provider="mock",
        result=QueryPaymentResult(
            QueryPaymentStatus.SUCCESS,
            facts=success_facts(pg_engine, second_payment, transaction_no="same-tx"),
        ),
    )

    with Session(pg_engine) as session:
        assert session.get_one(Order, first_order).status is OrderStatus.CONFIRMED
        second = session.get_one(Payment, second_payment)
        assert second.status is PaymentState.UNKNOWN
        assert second.last_error_code == "PAYMENT_TRANSACTION_CONFLICT"
        assert session.get_one(Order, second_order).status is OrderStatus.PAYMENT_EXCEPTION
        assert (
            session.get_one(
                __import__("backend.app.models", fromlist=["Slot"]).Slot, second_slot
            ).status
            is SlotStatus.LOCKED
        )


def test_available_slot_is_recovered_only_without_a_later_valid_order(pg_engine: Engine) -> None:
    order_id, payment_id, slot_id, _ = seed_payment(pg_engine, slot_status=SlotStatus.AVAILABLE)
    convergence(pg_engine).converge(
        payment_id=payment_id,
        provider="mock",
        result=QueryPaymentResult(
            QueryPaymentStatus.SUCCESS, facts=success_facts(pg_engine, payment_id)
        ),
    )
    with Session(pg_engine) as session:
        assert session.get_one(Order, order_id).status is OrderStatus.CONFIRMED
        assert (
            session.get_one(
                __import__("backend.app.models", fromlist=["Slot"]).Slot, slot_id
            ).status
            is SlotStatus.BOOKED
        )


def test_inventory_conflict_success_creates_one_durable_automatic_refund(
    pg_engine: Engine,
) -> None:
    order_id, payment_id, slot_id, now = seed_payment(
        pg_engine, slot_status=SlotStatus.AVAILABLE, now=datetime(2026, 8, 19, 4, tzinfo=UTC)
    )
    with Session(pg_engine) as session:
        other = Order(
            id=uuid.uuid4(),
            order_number=f"PB-{uuid.uuid4().hex}",
            user=session.get_one(Order, order_id).user,
            slot_id=slot_id,
            status=OrderStatus.CONFIRMED,
            price_cents=32000,
            contact_name="李四",
            contact_phone_ciphertext=b"encrypted-phone-value",
            contact_phone_nonce=b"abcdefghijkl",
            contact_phone_key_version=1,
            created_at=now,
            expires_at=now + timedelta(minutes=10),
        )
        session.add(other)
        session.commit()

    result = QueryPaymentResult(
        QueryPaymentStatus.SUCCESS,
        facts=success_facts(pg_engine, payment_id, transaction_no="tx-conflict", paid_at=now),
    )
    convergence(pg_engine).converge(payment_id=payment_id, provider="mock", result=result)
    convergence(pg_engine).converge(payment_id=payment_id, provider="mock", result=result)

    with Session(pg_engine) as session:
        payment = session.get_one(Payment, payment_id)
        refund_case = session.scalar(select(RefundCase).where(RefundCase.payment_id == payment_id))
        assert payment.status is PaymentState.SUCCESS
        assert payment.applied_to_order_at is None
        assert refund_case is not None
        assert refund_case.purpose is RefundCasePurpose.PAYMENT_INVENTORY_CONFLICT
        assert session.scalar(select(func.count()).select_from(RefundAttempt)) == 1
        assert refund_case.attempts[0].status is RefundAttemptStatus.CREATING
        assert session.get_one(Order, order_id).status is OrderStatus.REFUND_PENDING
        assert session.get_one(Slot, slot_id).status is SlotStatus.AVAILABLE


def test_concurrent_successes_apply_one_payment_and_refund_the_duplicate(
    pg_engine: Engine,
) -> None:
    order_id, first_id, slot_id, now = seed_payment(
        pg_engine,
        status=PaymentState.CLOSED,
        now=datetime(2026, 8, 19, 4, tzinfo=UTC),
    )
    with Session(pg_engine) as session:
        second = Payment(
            id=uuid.uuid4(),
            order_id=order_id,
            provider="mock",
            merchant_order_no=f"PB{uuid.uuid4().hex[:30]}",
            amount_cents=32000,
            currency="CNY",
            status=PaymentState.CONFIRMING,
        )
        session.add(second)
        session.commit()
        second_id = second.id
    barrier = Barrier(2)

    def settle(payment_id: uuid.UUID, transaction: str) -> None:
        facts = success_facts(pg_engine, payment_id, transaction_no=transaction, paid_at=now)
        barrier.wait()
        convergence(pg_engine).converge(
            payment_id=payment_id,
            provider="mock",
            result=QueryPaymentResult(QueryPaymentStatus.SUCCESS, facts=facts),
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [
            pool.submit(settle, first_id, "tx-first"),
            pool.submit(settle, second_id, "tx-second"),
        ]
        for future in futures:
            future.result(timeout=10)

    with Session(pg_engine) as session:
        payments = list(
            session.scalars(
                select(Payment).where(Payment.order_id == order_id).order_by(Payment.id)
            )
        )
        assert sum(payment.applied_to_order_at is not None for payment in payments) == 1
        duplicate = next(payment for payment in payments if payment.applied_to_order_at is None)
        assert duplicate.refund_case is not None
        assert duplicate.refund_case.purpose is RefundCasePurpose.DUPLICATE_CHARGE
        assert len(duplicate.refund_case.attempts) == 1
        assert session.get_one(Order, order_id).status is OrderStatus.CONFIRMED
        assert session.get_one(Slot, slot_id).status is SlotStatus.BOOKED


def test_order_projection_prefers_success_then_nonterminal_then_latest_terminal() -> None:
    now = datetime.now(UTC)

    def payment(state: PaymentState, offset: int, paid: bool = False) -> Payment:
        return Payment(
            id=uuid.uuid4(),
            order_id=uuid.uuid4(),
            provider="mock",
            merchant_order_no=f"m-{uuid.uuid4()}",
            amount_cents=1,
            currency="CNY",
            status=state,
            created_at=now + timedelta(seconds=offset),
            paid_at=now + timedelta(seconds=offset) if paid else None,
        )

    closed = payment(PaymentState.CLOSED, 3)
    confirming = payment(PaymentState.CONFIRMING, 2)
    success = payment(PaymentState.SUCCESS, 1, paid=True)
    success.applied_to_order_at = now
    assert _project_payment([success, confirming, closed]) is success
    assert _project_payment([confirming, closed]) is confirming
    assert _project_payment([payment(PaymentState.CLOSED, 1), closed]) is closed


def test_late_success_after_closed_preserves_money_without_becoming_main_payment(
    pg_engine: Engine,
) -> None:
    order_id, payment_id, slot_id, _ = seed_payment(pg_engine, status=PaymentState.CLOSED)
    service = convergence(pg_engine)
    service.converge(
        payment_id=payment_id,
        provider="mock",
        result=QueryPaymentResult(QueryPaymentStatus.UNKNOWN, safe_error_code="STALE_UNKNOWN"),
    )
    with Session(pg_engine) as session:
        assert session.get_one(Payment, payment_id).status is PaymentState.CLOSED

    service.converge(
        payment_id=payment_id,
        provider="mock",
        result=QueryPaymentResult(
            QueryPaymentStatus.SUCCESS, facts=success_facts(pg_engine, payment_id)
        ),
    )
    with Session(pg_engine) as session:
        payment = session.get_one(Payment, payment_id)
        slot = session.get_one(Slot, slot_id)
        assert payment.status is PaymentState.SUCCESS
        assert payment.applied_to_order_at is None
        assert session.get_one(Order, order_id).status is OrderStatus.REFUND_PENDING
        assert slot.status is SlotStatus.LOCKED
        assert slot.locked_by_order_id == order_id


def test_conflicting_success_fact_is_audited_without_overwriting_first_success(
    pg_engine: Engine,
) -> None:
    _, payment_id, _, _ = seed_payment(pg_engine)
    service = convergence(pg_engine)
    original = success_facts(pg_engine, payment_id, transaction_no="original-tx")
    service.converge(
        payment_id=payment_id,
        provider="mock",
        result=QueryPaymentResult(QueryPaymentStatus.SUCCESS, facts=original),
    )
    conflicting = success_facts(pg_engine, payment_id, transaction_no="different-tx")
    service.converge(
        payment_id=payment_id,
        provider="mock",
        result=QueryPaymentResult(QueryPaymentStatus.SUCCESS, facts=conflicting),
    )
    with Session(pg_engine) as session:
        payment = session.get_one(Payment, payment_id)
        assert payment.status is PaymentState.SUCCESS
        assert payment.provider_transaction_no == "original-tx"
        assert payment.last_error_code == "PAYMENT_TRANSACTION_MISMATCH"


def test_success_on_closed_inventory_preserves_money_and_queues_refund(
    pg_engine: Engine,
) -> None:
    order_id, payment_id, slot_id, _ = seed_payment(pg_engine, slot_status=SlotStatus.CLOSED)
    convergence(pg_engine).converge(
        payment_id=payment_id,
        provider="mock",
        result=QueryPaymentResult(
            QueryPaymentStatus.SUCCESS, facts=success_facts(pg_engine, payment_id)
        ),
    )
    with Session(pg_engine) as session:
        payment = session.get_one(Payment, payment_id)
        assert payment.status is PaymentState.SUCCESS
        assert payment.applied_to_order_at is None
        assert session.get_one(Order, order_id).status is OrderStatus.REFUND_PENDING
        assert session.get_one(Slot, slot_id).status is SlotStatus.CLOSED


def test_authoritative_mismatch_replaces_transient_unknown_code(pg_engine: Engine) -> None:
    order_id, payment_id, _, _ = seed_payment(pg_engine, status=PaymentState.UNKNOWN)
    with Session(pg_engine) as session:
        payment = session.get_one(Payment, payment_id)
        payment.last_error_code = "PAYMENT_PROVIDER_QUERY_FAILED"
        payment.last_error_at = datetime.now(UTC)
        session.commit()

    convergence(pg_engine).converge(
        payment_id=payment_id,
        provider="mock",
        result=QueryPaymentResult(
            QueryPaymentStatus.SUCCESS,
            facts=success_facts(pg_engine, payment_id, amount_cents=1),
        ),
    )

    with Session(pg_engine) as session:
        payment = session.get_one(Payment, payment_id)
        assert payment.status is PaymentState.UNKNOWN
        assert payment.last_error_code == "PAYMENT_AMOUNT_MISMATCH"
        assert payment.notification_result == "MISMATCH"
        assert payment.notification_code == "PAYMENT_AMOUNT_MISMATCH"
        assert session.get_one(Order, order_id).status is OrderStatus.PAYMENT_EXCEPTION


def test_conflicting_success_audit_survives_existing_inventory_error(pg_engine: Engine) -> None:
    _, payment_id, _, _ = seed_payment(pg_engine, slot_status=SlotStatus.CLOSED)
    service = convergence(pg_engine)
    service.converge(
        payment_id=payment_id,
        provider="mock",
        result=QueryPaymentResult(
            QueryPaymentStatus.SUCCESS,
            facts=success_facts(pg_engine, payment_id, transaction_no="first-transaction"),
        ),
    )
    service.converge(
        payment_id=payment_id,
        provider="mock",
        result=QueryPaymentResult(
            QueryPaymentStatus.SUCCESS,
            facts=success_facts(pg_engine, payment_id, transaction_no="conflicting-transaction"),
        ),
    )

    with Session(pg_engine) as session:
        payment = session.get_one(Payment, payment_id)
        assert payment.status is PaymentState.SUCCESS
        assert payment.provider_transaction_no == "first-transaction"
        assert payment.last_error_code == "PAYMENT_INVENTORY_CONFLICT"
        assert payment.notification_result == "SUCCESS"
        assert payment.notification_code == "PAYMENT_TRANSACTION_MISMATCH"
