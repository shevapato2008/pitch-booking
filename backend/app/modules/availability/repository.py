import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.models import BookingMode, Pitch, PitchType, Slot, Venue


class AvailabilityRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def get_active_venue(self, venue_id: uuid.UUID) -> Venue | None:
        return self.session.scalar(
            select(Venue).where(
                Venue.id == venue_id,
                Venue.is_active.is_(True),
                Venue.booking_mode == BookingMode.ONLINE,
            )
        )

    def list_pitches(self, venue_id: uuid.UUID, pitch_type: PitchType) -> list[Pitch]:
        statement = (
            select(Pitch)
            .where(Pitch.venue_id == venue_id, Pitch.pitch_type == pitch_type)
            .order_by(Pitch.sort_order, Pitch.id)
        )
        return list(self.session.scalars(statement))

    def list_slots(
        self,
        pitch_ids: list[uuid.UUID],
        starts_at: datetime,
        ends_at: datetime,
    ) -> list[Slot]:
        if not pitch_ids:
            return []
        statement = (
            select(Slot)
            .where(
                Slot.pitch_id.in_(pitch_ids),
                Slot.starts_at >= starts_at,
                Slot.starts_at < ends_at,
            )
            .order_by(Slot.starts_at, Slot.id)
        )
        return list(self.session.scalars(statement))
