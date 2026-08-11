import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from backend.app.models import (
    IdempotencyRecord,
    IdempotencyState,
    Pitch,
    Slot,
    User,
    Venue,
    VenueMembership,
)


class InventoryRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def get_venue(self, venue_id: uuid.UUID) -> Venue | None:
        return self.session.scalar(
            select(Venue).where(Venue.id == venue_id, Venue.is_active.is_(True))
        )

    def can_manage_inventory(self, venue_id: uuid.UUID, user_id: uuid.UUID) -> bool:
        return bool(
            self.session.scalar(
                select(VenueMembership.id).where(
                    VenueMembership.venue_id == venue_id,
                    VenueMembership.user_id == user_id,
                    VenueMembership.is_active.is_(True),
                    VenueMembership.can_manage_inventory.is_(True),
                )
            )
        )

    def list_pitches(self, venue_id: uuid.UUID) -> list[Pitch]:
        return list(
            self.session.scalars(
                select(Pitch)
                .where(Pitch.venue_id == venue_id)
                .order_by(Pitch.sort_order, Pitch.id)
            )
        )

    def get_pitch(self, venue_id: uuid.UUID, pitch_id: uuid.UUID) -> Pitch | None:
        return self.session.scalar(
            select(Pitch).where(Pitch.id == pitch_id, Pitch.venue_id == venue_id)
        )

    def list_slots(
        self, pitch_id: uuid.UUID, starts_at: datetime, ends_at: datetime
    ) -> list[Slot]:
        return list(
            self.session.scalars(
                select(Slot)
                .where(
                    Slot.pitch_id == pitch_id,
                    Slot.starts_at >= starts_at,
                    Slot.starts_at < ends_at,
                )
                .order_by(Slot.starts_at, Slot.id)
            )
        )

    def get_slot_for_update(self, venue_id: uuid.UUID, slot_id: uuid.UUID) -> Slot | None:
        return self.session.scalar(
            select(Slot)
            .join(Pitch, Pitch.id == Slot.pitch_id)
            .where(Slot.id == slot_id, Pitch.venue_id == venue_id)
            .with_for_update(of=Slot)
            .execution_options(populate_existing=True)
        )

    def claim_idempotency(
        self, *, user: User, key: str, request_sha256: str
    ) -> tuple[IdempotencyRecord, bool]:
        inserted_id = self.session.scalar(
            insert(IdempotencyRecord)
            .values(
                id=uuid.uuid4(),
                user_id=user.id,
                operation="create_inventory_slot",
                key=key,
                request_sha256=request_sha256,
                state=IdempotencyState.CLAIMED,
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
                IdempotencyRecord.user_id == user.id,
                IdempotencyRecord.operation == "create_inventory_slot",
                IdempotencyRecord.key == key,
            )
            .with_for_update()
        )
        if record is None:
            raise RuntimeError("inventory idempotency record disappeared")
        return record, False

    def add_slot(self, slot: Slot) -> None:
        self.session.add(slot)
        self.session.flush()

    def complete_idempotency(
        self, record: IdempotencyRecord, response_body: dict[str, object]
    ) -> None:
        record.state = IdempotencyState.COMPLETED
        record.response_status = 201
        record.response_body = response_body
        self.session.flush()

    def commit(self) -> None:
        self.session.commit()

    def rollback(self) -> None:
        self.session.rollback()
