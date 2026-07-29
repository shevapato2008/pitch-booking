from datetime import timedelta

import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from backend.app.models import Order, OrderStatus, Payment, PaymentState, Slot, SlotStatus
from backend.app.modules.orders.expiry import PendingOrderExpiryService
from backend.tests.test_payment_settlement import seed_payment

pytestmark = pytest.mark.integration


@pytest.mark.parametrize(
    "payment_state",
    [
        PaymentState.CREATING,
        PaymentState.PREPAY_CREATED,
        PaymentState.CONFIRMING,
        PaymentState.UNKNOWN,
        PaymentState.SUCCESS,
    ],
)
def test_fast_expiry_is_blocked_by_every_unresolved_or_successful_payment(
    pg_engine: Engine,
    payment_state: PaymentState,
) -> None:
    order_id, payment_id, slot_id, now = seed_payment(pg_engine, status=payment_state)
    expiry_time = now + timedelta(minutes=11)

    with Session(pg_engine) as session:
        result = PendingOrderExpiryService().expire_by_order_id(
            session, order_id, expiry_time
        )
        session.flush()
        assert result.changed is False
        assert session.get_one(Order, order_id).status is OrderStatus.PENDING_PAYMENT
        assert session.get_one(Payment, payment_id).status is payment_state
        assert session.get_one(Slot, slot_id).status is SlotStatus.LOCKED


def test_closed_payment_allows_safe_fast_expiry(pg_engine: Engine) -> None:
    order_id, _, slot_id, now = seed_payment(pg_engine, status=PaymentState.CLOSED)
    expiry_time = now + timedelta(minutes=11)

    with Session(pg_engine) as session:
        result = PendingOrderExpiryService().expire_by_order_id(
            session, order_id, expiry_time
        )
        session.flush()
        assert result.changed is True
        assert session.get_one(Order, order_id).status is OrderStatus.EXPIRED
        assert session.get_one(Slot, slot_id).status is SlotStatus.AVAILABLE


def test_exception_order_never_mutates_a_slot_it_no_longer_owns(
    pg_engine: Engine,
) -> None:
    order_id, _, slot_id, now = seed_payment(pg_engine, status=PaymentState.CLOSED)
    expiry_time = now + timedelta(minutes=11)

    with Session(pg_engine) as session:
        order = session.get_one(Order, order_id)
        order.status = OrderStatus.PAYMENT_EXCEPTION
        slot = session.get_one(Slot, slot_id)
        slot.status = SlotStatus.AVAILABLE
        slot.locked_until = None
        slot.locked_by_order_id = None
        checkout_version = slot.checkout_version
        session.commit()

    with Session(pg_engine) as session:
        result = PendingOrderExpiryService().expire_by_order_id(
            session, order_id, expiry_time
        )
        session.flush()
        assert result.changed is True
        assert session.get_one(Order, order_id).status is OrderStatus.EXPIRED
        slot = session.get_one(Slot, slot_id)
        assert slot.status is SlotStatus.AVAILABLE
        assert slot.locked_by_order_id is None
        assert slot.checkout_version == checkout_version
