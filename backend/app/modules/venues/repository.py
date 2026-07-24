from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from backend.app.models import Venue


class VenueRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def list_active_primaries(self) -> list[Venue]:
        statement = (
            select(Venue)
            .where(Venue.is_primary.is_(True), Venue.is_active.is_(True))
            .options(
                selectinload(Venue.images),
                selectinload(Venue.facilities),
                selectinload(Venue.pitches),
            )
            .order_by(Venue.id)
        )
        return list(self.session.scalars(statement).unique())
