from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from backend.app.models import (
    IdempotencyRecord,
    IdempotencyState,
    Order,
    OrderStatus,
    Payment,
    Slot,
)
from backend.app.modules.orders.locking import (
    NONTERMINAL_PAYMENT_STATES,
    lock_current_payment,
    lock_order,
    lock_payment,
    lock_slot,
)


@dataclass(frozen=True, slots=True)
class PaymentRecoveryClaim:
    payment_id: uuid.UUID
    claim_token: uuid.UUID


class PaymentRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def locate_owned_order(self, *, order_id: uuid.UUID, user_id: uuid.UUID) -> Order | None:
        return self.session.scalar(
            select(Order).where(Order.id == order_id, Order.user_id == user_id)
        )

    def locate_payment(self, payment_id: uuid.UUID) -> Payment | None:
        return self.session.get(Payment, payment_id)

    def locate_payment_by_merchant_order_no(
        self, *, provider: str, merchant_order_no: str
    ) -> Payment | None:
        return self.session.scalar(
            select(Payment).where(
                Payment.provider == provider,
                Payment.merchant_order_no == merchant_order_no,
            )
        )

    def list_due_payment_ids(
        self, *, now: datetime, provider: str, limit: int
    ) -> list[uuid.UUID]:
        return list(
            self.session.scalars(
                select(Payment.id)
                .join(Order, Order.id == Payment.order_id)
                .where(
                    Payment.provider == provider,
                    Payment.status.in_(NONTERMINAL_PAYMENT_STATES),
                    self._is_recovery_due(now),
                )
                .order_by(Payment.next_reconcile_at, Payment.id)
                .limit(limit)
            )
        )

    def claim_next_due_payment(
        self,
        *,
        now: datetime,
        provider: str,
        lease_until: datetime,
    ) -> PaymentRecoveryClaim | None:
        payment = self.session.scalar(
            select(Payment)
            .join(Order, Order.id == Payment.order_id)
            .where(
                Payment.provider == provider,
                Payment.status.in_(NONTERMINAL_PAYMENT_STATES),
                self._is_recovery_due(now),
            )
            .order_by(Payment.next_reconcile_at, Payment.id)
            .limit(1)
            .with_for_update(of=Payment, skip_locked=True)
        )
        if payment is None:
            return None
        token = uuid.uuid4()
        payment.reconcile_claim_token = token
        payment.reconcile_lease_until = lease_until
        payment.reconcile_attempts += 1
        self.session.flush()
        return PaymentRecoveryClaim(payment.id, token)

    @staticmethod
    def _is_recovery_due(now: datetime) -> ColumnElement[bool]:
        lease_available = or_(
            Payment.reconcile_lease_until.is_(None),
            Payment.reconcile_lease_until <= now,
        )
        schedule_due = or_(
            Payment.next_reconcile_at.is_(None),
            Payment.next_reconcile_at <= now,
            (
                (Order.expires_at <= now)
                & Payment.expiry_reconciled_at.is_(None)
            ),
        )
        return lease_available & schedule_due

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
    ) -> tuple[Slot, Order, Payment]:
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
        return slot, order, payment

    def find_transaction_owner(
        self,
        *,
        provider: str,
        provider_transaction_no: str,
        payment_id: uuid.UUID,
    ) -> Payment | None:
        return self.session.scalar(
            select(Payment).where(
                Payment.provider == provider,
                Payment.provider_transaction_no == provider_transaction_no,
                Payment.id != payment_id,
            )
        )

    def has_other_valid_order(self, *, slot_id: uuid.UUID, order_id: uuid.UUID) -> bool:
        return (
            self.session.scalar(
                select(Order.id)
                .where(
                    Order.slot_id == slot_id,
                    Order.id != order_id,
                    Order.status.in_(
                        (
                            OrderStatus.PENDING_PAYMENT,
                            OrderStatus.CONFIRMED,
                            OrderStatus.PAYMENT_EXCEPTION,
                        )
                    ),
                )
                .limit(1)
            )
            is not None
        )

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

    def lock_other_nonterminal_payment(
        self, *, order_id: uuid.UUID, payment_id: uuid.UUID
    ) -> Payment | None:
        return self.session.scalar(
            select(Payment)
            .where(
                Payment.order_id == order_id,
                Payment.id != payment_id,
                Payment.status.in_(NONTERMINAL_PAYMENT_STATES),
            )
            .order_by(Payment.created_at, Payment.id)
            .limit(1)
            .with_for_update()
            .execution_options(populate_existing=True)
        )

    def lock_payment_idempotencies(self, payment_id: uuid.UUID) -> list[IdempotencyRecord]:
        return list(
            self.session.scalars(
                select(IdempotencyRecord)
                .where(
                    IdempotencyRecord.payment_id == payment_id,
                    IdempotencyRecord.operation == "create_payment",
                )
                .order_by(IdempotencyRecord.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        )
