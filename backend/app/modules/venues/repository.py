import uuid
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from backend.app.models import (
    BookingMode,
    Pitch,
    PitchStatus,
    Slot,
    SlotStatus,
    Venue,
)


class VenueRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def list_active_primaries(self) -> list[Venue]:
        statement = (
            select(Venue)
            .where(
                Venue.is_primary.is_(True),
                Venue.is_active.is_(True),
                Venue.booking_mode == BookingMode.ONLINE,
            )
            .options(
                selectinload(Venue.images),
                selectinload(Venue.facilities),
                selectinload(Venue.pitches),
            )
            .order_by(Venue.id)
        )
        return list(self.session.scalars(statement).unique())

    def list_public(self) -> list[Venue]:
        statement = (
            select(Venue)
            .where(Venue.is_active.is_(True), Venue.is_listed.is_(True))
            .options(
                selectinload(Venue.images),
                selectinload(Venue.facilities),
                selectinload(Venue.pitches),
                selectinload(Venue.transit_stops),
            )
            .order_by(Venue.sort_order, Venue.name, Venue.id)
        )
        return list(self.session.scalars(statement).unique())

    def get_public(self, venue_id: uuid.UUID) -> Venue | None:
        statement = (
            select(Venue)
            .where(
                Venue.id == venue_id,
                Venue.is_active.is_(True),
                Venue.is_listed.is_(True),
            )
            .options(
                selectinload(Venue.images),
                selectinload(Venue.facilities),
                selectinload(Venue.pitches),
                selectinload(Venue.transit_stops),
            )
        )
        return self.session.scalar(statement)

    def minimum_available_price(
        self, venue_id: uuid.UUID, now: datetime
    ) -> int | None:
        return self.session.scalar(
            select(func.min(Slot.price_cents))
            .join(Pitch)
            .where(
                Pitch.venue_id == venue_id,
                Pitch.status == PitchStatus.ACTIVE,
                Slot.status == SlotStatus.AVAILABLE,
                Slot.starts_at > now,
            )
        )
