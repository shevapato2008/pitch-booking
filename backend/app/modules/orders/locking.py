import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.models import Order, Payment, PaymentState, Slot

NONTERMINAL_PAYMENT_STATES = (
    PaymentState.CREATING,
    PaymentState.PREPAY_CREATED,
    PaymentState.CONFIRMING,
    PaymentState.UNKNOWN,
)


def lock_slot(session: Session, slot_id: uuid.UUID) -> Slot | None:
    return session.scalar(
        select(Slot)
        .where(Slot.id == slot_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )


def lock_order(session: Session, order_id: uuid.UUID) -> Order | None:
    return session.scalar(
        select(Order)
        .where(Order.id == order_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )


def lock_current_payment(session: Session, order_id: uuid.UUID) -> Payment | None:
    return session.scalar(
        select(Payment)
        .where(Payment.order_id == order_id, Payment.status.in_(NONTERMINAL_PAYMENT_STATES))
        .order_by(Payment.created_at.desc(), Payment.id.desc())
        .limit(1)
        .with_for_update()
        .execution_options(populate_existing=True)
    )


def lock_payment(session: Session, payment_id: uuid.UUID) -> Payment | None:
    return session.scalar(
        select(Payment)
        .where(Payment.id == payment_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
