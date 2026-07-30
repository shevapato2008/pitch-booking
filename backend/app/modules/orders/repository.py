import uuid
from datetime import datetime

from sqlalchemy import exists, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, joinedload, selectinload

from backend.app.models import (
    BookingMode,
    IdempotencyRecord,
    IdempotencyState,
    Order,
    OrderStatus,
    Payment,
    PaymentState,
    Pitch,
    Slot,
    Venue,
)


class OrderRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def claim_idempotency(
        self,
        *,
        user_id: uuid.UUID,
        operation: str,
        key: str,
        request_sha256: str,
    ) -> tuple[IdempotencyRecord, bool]:
        candidate_id = uuid.uuid4()
        inserted_id = self.session.scalar(
            insert(IdempotencyRecord)
            .values(
                id=candidate_id,
                user_id=user_id,
                operation=operation,
                key=key,
                request_sha256=request_sha256,
                state=IdempotencyState.CLAIMED,
                response_status=None,
                response_body=None,
            )
            .on_conflict_do_nothing(constraint="uq_idempotency_records_user_operation_key")
            .returning(IdempotencyRecord.id)
        )
        if inserted_id is not None:
            return self.session.get_one(IdempotencyRecord, inserted_id), True

        record = self.session.scalar(
            select(IdempotencyRecord).where(
                IdempotencyRecord.user_id == user_id,
                IdempotencyRecord.operation == operation,
                IdempotencyRecord.key == key,
            )
        )
        if record is None:
            raise RuntimeError("idempotency conflict did not resolve to a committed record")
        return record, False

    def get_slot_booking_mode(self, slot_id: uuid.UUID) -> BookingMode | None:
        return self.session.scalar(
            select(Venue.booking_mode)
            .select_from(Slot)
            .join(Pitch, Pitch.id == Slot.pitch_id)
            .join(Venue, Venue.id == Pitch.venue_id)
            .where(Slot.id == slot_id)
        )

    def get_slot_for_update(self, slot_id: uuid.UUID) -> Slot | None:
        return self.session.scalar(
            select(Slot)
            .where(Slot.id == slot_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )

    def get_effective_pending_order(
        self,
        *,
        user_id: uuid.UUID,
        slot_id: uuid.UUID,
        now: datetime,
    ) -> Order | None:
        return self.session.scalar(
            select(Order)
            .where(
                Order.user_id == user_id,
                Order.slot_id == slot_id,
                Order.status == OrderStatus.PENDING_PAYMENT,
                Order.expires_at > now,
            )
            .order_by(Order.created_at.desc(), Order.id.desc())
            .limit(1)
            .with_for_update()
            .execution_options(populate_existing=True)
        )

    def get_owned_order(
        self,
        *,
        order_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> Order | None:
        return self.session.scalar(
            select(Order)
            .where(Order.id == order_id, Order.user_id == user_id)
            .options(
                joinedload(Order.slot).joinedload(Slot.pitch),
                selectinload(Order.payments),
            )
            .execution_options(populate_existing=True)
        )

    def list_expiry_candidate_ids(
        self,
        *,
        now: datetime,
        limit: int = 100,
    ) -> list[uuid.UUID]:
        return list(
            self.session.scalars(
                select(Order.id)
                .where(
                    Order.status == OrderStatus.PENDING_PAYMENT,
                    Order.expires_at <= now,
                    ~exists(
                        select(Payment.id).where(
                            Payment.order_id == Order.id,
                            Payment.status.in_(
                                (
                                    PaymentState.CREATING,
                                    PaymentState.PREPAY_CREATED,
                                    PaymentState.CONFIRMING,
                                    PaymentState.UNKNOWN,
                                    PaymentState.SUCCESS,
                                )
                            ),
                        )
                    ),
                )
                .order_by(Order.expires_at, Order.id)
                .limit(limit)
            )
        )

    def add_order(self, order: Order) -> None:
        self.session.add(order)
        self.session.flush()

    def complete_idempotency(
        self,
        record: IdempotencyRecord,
        *,
        response_status: int,
        response_body: dict[str, object],
    ) -> None:
        record.state = IdempotencyState.COMPLETED
        record.response_status = response_status
        record.response_body = response_body
        self.session.flush()

    def flush(self) -> None:
        self.session.flush()

    def commit(self) -> None:
        self.session.commit()

    def rollback(self) -> None:
        self.session.rollback()
