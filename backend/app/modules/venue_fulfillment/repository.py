import uuid
from datetime import datetime

from sqlalchemy import and_, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, contains_eager

from backend.app.models import (
    IdempotencyRecord,
    IdempotencyState,
    Order,
    Pitch,
    Slot,
    Venue,
    VenueMembership,
)
from backend.app.modules.orders.locking import lock_order, lock_slot


class VenueFulfillmentRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def get_authorized_venue(
        self,
        *,
        venue_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> Venue | None:
        return self.session.scalar(
            select(Venue)
            .join(VenueMembership, VenueMembership.venue_id == Venue.id)
            .where(
                Venue.id == venue_id,
                Venue.is_active.is_(True),
                VenueMembership.user_id == user_id,
                VenueMembership.is_active.is_(True),
                VenueMembership.can_manage_inventory.is_(True),
            )
        )

    def list_orders(
        self,
        *,
        venue_id: uuid.UUID,
        utc_start: datetime,
        utc_end: datetime,
        limit: int,
        after_starts_at: datetime | None,
        after_id: uuid.UUID | None,
    ) -> list[Order]:
        statement = (
            select(Order)
            .join(Slot, Slot.id == Order.slot_id)
            .join(Pitch, Pitch.id == Slot.pitch_id)
            .where(
                Pitch.venue_id == venue_id,
                Slot.starts_at >= utc_start,
                Slot.starts_at < utc_end,
            )
            .options(contains_eager(Order.slot).contains_eager(Slot.pitch))
        )
        if after_starts_at is not None and after_id is not None:
            statement = statement.where(
                or_(
                    Slot.starts_at > after_starts_at,
                    and_(
                        Slot.starts_at == after_starts_at,
                        Order.id > after_id,
                    ),
                )
            )
        return list(
            self.session.scalars(
                statement.order_by(Slot.starts_at, Order.id)
                .limit(limit)
                .execution_options(populate_existing=True)
            )
        )

    def get_authorized_order(
        self,
        *,
        venue_id: uuid.UUID,
        order_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> Order | None:
        return self.session.scalar(
            select(Order)
            .join(Slot, Slot.id == Order.slot_id)
            .join(Pitch, Pitch.id == Slot.pitch_id)
            .join(Venue, Venue.id == Pitch.venue_id)
            .join(VenueMembership, VenueMembership.venue_id == Venue.id)
            .where(
                Order.id == order_id,
                Venue.id == venue_id,
                Venue.is_active.is_(True),
                VenueMembership.user_id == user_id,
                VenueMembership.is_active.is_(True),
                VenueMembership.can_manage_inventory.is_(True),
            )
            .options(contains_eager(Order.slot).contains_eager(Slot.pitch))
            .execution_options(populate_existing=True)
        )

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
                payment_id=None,
                response_status=None,
                response_body=None,
            )
            .on_conflict_do_nothing(
                constraint="uq_idempotency_records_user_operation_key"
            )
            .returning(IdempotencyRecord.id)
        )
        if inserted_id is not None:
            return self.session.get_one(IdempotencyRecord, inserted_id), True
        record = self.session.scalar(
            select(IdempotencyRecord)
            .where(
                IdempotencyRecord.user_id == user_id,
                IdempotencyRecord.operation == operation,
                IdempotencyRecord.key == key,
            )
            .with_for_update()
        )
        if record is None:
            raise RuntimeError("idempotency conflict has no committed record")
        return record, False

    def lock_business_graph(
        self,
        *,
        slot_id: uuid.UUID,
        order_id: uuid.UUID,
    ) -> tuple[Slot | None, Order | None]:
        return lock_slot(self.session, slot_id), lock_order(self.session, order_id)

    def complete_idempotency(
        self,
        record: IdempotencyRecord,
        *,
        response_body: dict[str, object],
    ) -> None:
        record.state = IdempotencyState.COMPLETED
        record.response_status = 200
        record.response_body = response_body
        self.session.flush()

    def flush(self) -> None:
        self.session.flush()

    def commit(self) -> None:
        self.session.commit()

    def rollback(self) -> None:
        self.session.rollback()
