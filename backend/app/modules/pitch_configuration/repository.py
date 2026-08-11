import uuid
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from backend.app.models import (
    IdempotencyRecord,
    IdempotencyState,
    Pitch,
    Slot,
    SlotStatus,
    User,
    Venue,
    VenueMembership,
    VenuePitchSequenceCounter,
)


class PitchConfigurationRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def get_venue(self, venue_id: uuid.UUID, *, for_update: bool = False) -> Venue | None:
        statement = select(Venue).where(Venue.id == venue_id, Venue.is_active.is_(True))
        if for_update:
            statement = statement.with_for_update()
        return self.session.scalar(statement)

    def can_manage(self, venue_id: uuid.UUID, user_id: uuid.UUID) -> bool:
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

    def list_pitches(self, venue_id: uuid.UUID, *, for_update: bool = False) -> list[Pitch]:
        statement = select(Pitch).where(Pitch.venue_id == venue_id)
        if for_update:
            statement = statement.with_for_update()
        return list(self.session.scalars(statement))

    def history_pitch_ids(self, venue_id: uuid.UUID) -> set[uuid.UUID]:
        return set(
            self.session.scalars(
                select(Slot.pitch_id).join(Pitch).where(Pitch.venue_id == venue_id).distinct()
            )
        )

    def future_blockers(
        self, venue_id: uuid.UUID, now: datetime
    ) -> dict[uuid.UUID, dict[str, int]]:
        rows = self.session.execute(
            select(Slot.pitch_id, Slot.status, func.count())
            .join(Pitch)
            .where(
                Pitch.venue_id == venue_id,
                Slot.starts_at > now,
                Slot.status.in_([SlotStatus.AVAILABLE, SlotStatus.LOCKED, SlotStatus.BOOKED]),
            )
            .group_by(Slot.pitch_id, Slot.status)
        )
        result: dict[uuid.UUID, dict[str, int]] = {}
        for pitch_id, status, count in rows:
            result.setdefault(pitch_id, {"AVAILABLE": 0, "LOCKED": 0, "BOOKED": 0})[
                status.value
            ] = count
        return result

    def claim_idempotency(
        self, *, user: User, key: str, request_sha256: str
    ) -> tuple[IdempotencyRecord, bool]:
        inserted_id = self.session.scalar(
            insert(IdempotencyRecord)
            .values(
                id=uuid.uuid4(),
                user_id=user.id,
                operation="save_pitch_configuration",
                key=key,
                request_sha256=request_sha256,
                state=IdempotencyState.CLAIMED,
            )
            .on_conflict_do_nothing(constraint="uq_idempotency_records_user_operation_key")
            .returning(IdempotencyRecord.id)
        )
        if inserted_id is not None:
            return self.session.get_one(IdempotencyRecord, inserted_id), True
        record = self.session.scalar(
            select(IdempotencyRecord)
            .where(
                IdempotencyRecord.user_id == user.id,
                IdempotencyRecord.operation == "save_pitch_configuration",
                IdempotencyRecord.key == key,
            )
            .with_for_update()
        )
        if record is None:
            raise RuntimeError("pitch configuration idempotency record disappeared")
        return record, False

    def allocate_sequence(self, venue_id: uuid.UUID, players_per_side: int) -> int:
        self.session.execute(
            insert(VenuePitchSequenceCounter)
            .values(
                venue_id=venue_id,
                players_per_side=players_per_side,
                last_sequence=0,
            )
            .on_conflict_do_nothing()
        )
        counter = self.session.scalar(
            select(VenuePitchSequenceCounter)
            .where(
                VenuePitchSequenceCounter.venue_id == venue_id,
                VenuePitchSequenceCounter.players_per_side == players_per_side,
            )
            .with_for_update()
        )
        if counter is None:
            raise RuntimeError("pitch sequence counter disappeared")
        counter.last_sequence += 1
        self.session.flush()
        return counter.last_sequence

    def add(self, pitch: Pitch) -> None:
        self.session.add(pitch)
        self.session.flush()

    def delete(self, pitch: Pitch) -> None:
        self.session.delete(pitch)
        self.session.flush()

    def complete(self, record: IdempotencyRecord, response_body: dict[str, object]) -> None:
        record.state = IdempotencyState.COMPLETED
        record.response_status = 200
        record.response_body = response_body
        self.session.flush()

    def commit(self) -> None:
        self.session.commit()

    def rollback(self) -> None:
        self.session.rollback()
