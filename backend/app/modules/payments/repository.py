from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from backend.app.models import IdempotencyRecord, IdempotencyState, Order, Payment
from backend.app.modules.orders.locking import (
    lock_current_payment,
    lock_order,
    lock_payment,
    lock_slot,
)


class PaymentRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def locate_owned_order(self, *, order_id: uuid.UUID, user_id: uuid.UUID) -> Order | None:
        return self.session.scalar(
            select(Order).where(Order.id == order_id, Order.user_id == user_id)
        )

    def lock_order_graph(
        self, *, order_id: uuid.UUID, slot_id: uuid.UUID
    ) -> tuple[Order, Payment | None]:
        slot = lock_slot(self.session, slot_id)
        order = lock_order(self.session, order_id)
        if slot is None or order is None or order.slot_id != slot.id:
            raise RuntimeError("payment lock graph changed")
        return order, lock_current_payment(self.session, order.id)

    def lock_payment_graph(
        self, *, order_id: uuid.UUID, slot_id: uuid.UUID, payment_id: uuid.UUID
    ) -> tuple[Order, Payment]:
        slot = lock_slot(self.session, slot_id)
        order = lock_order(self.session, order_id)
        payment = lock_payment(self.session, payment_id)
        if (
            slot is None
            or order is None
            or payment is None
            or order.slot_id != slot.id
            or payment.order_id != order.id
        ):
            raise RuntimeError("payment lock graph changed")
        return order, payment

    def claim_idempotency(
        self, *, user_id: uuid.UUID, key: str, request_sha256: str
    ) -> tuple[IdempotencyRecord, bool]:
        candidate_id = uuid.uuid4()
        inserted_id = self.session.scalar(
            insert(IdempotencyRecord)
            .values(
                id=candidate_id,
                user_id=user_id,
                operation="create_payment",
                key=key,
                request_sha256=request_sha256,
                state=IdempotencyState.CLAIMED,
                payment_id=None,
                response_status=None,
                response_body=None,
            )
            .on_conflict_do_nothing(constraint="uq_idempotency_records_user_operation_key")
            .returning(IdempotencyRecord.id)
        )
        if inserted_id is not None:
            return self.session.get_one(IdempotencyRecord, inserted_id), True
        record = self.session.scalar(
            select(IdempotencyRecord)
            .where(
                IdempotencyRecord.user_id == user_id,
                IdempotencyRecord.operation == "create_payment",
                IdempotencyRecord.key == key,
            )
            .with_for_update()
        )
        if record is None:
            raise RuntimeError("idempotency conflict did not resolve")
        return record, False

    def get_idempotency_for_update(self, record_id: uuid.UUID) -> IdempotencyRecord:
        record = self.session.scalar(
            select(IdempotencyRecord).where(IdempotencyRecord.id == record_id).with_for_update()
        )
        if record is None:
            raise RuntimeError("idempotency record disappeared")
        return record
