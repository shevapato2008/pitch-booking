import uuid
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.app.models import Venue, VenueMembership


@dataclass(frozen=True)
class ManagedVenueRow:
    venue: Venue
    membership: VenueMembership


class VenueAccessRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def list_managed_venues(self, user_id: uuid.UUID) -> list[ManagedVenueRow]:
        statement = (
            select(Venue, VenueMembership)
            .join(VenueMembership, VenueMembership.venue_id == Venue.id)
            .where(
                VenueMembership.user_id == user_id,
                VenueMembership.is_active.is_(True),
                Venue.is_active.is_(True),
            )
            .order_by(func.lower(func.trim(Venue.name)), Venue.id)
        )
        return [
            ManagedVenueRow(venue=venue, membership=membership)
            for venue, membership in self.session.execute(statement).all()
        ]
