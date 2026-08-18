import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.app.models import Venue, VenueMembership


class VenueAccessRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def list_managed_venues(self, user_id: uuid.UUID) -> list[Venue]:
        statement = (
            select(Venue)
            .join(VenueMembership, VenueMembership.venue_id == Venue.id)
            .where(
                VenueMembership.user_id == user_id,
                VenueMembership.is_active.is_(True),
                VenueMembership.can_manage_inventory.is_(True),
                Venue.is_active.is_(True),
            )
            .order_by(func.lower(func.trim(Venue.name)), Venue.id)
        )
        return list(self.session.scalars(statement))
