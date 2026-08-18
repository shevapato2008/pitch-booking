import uuid
from datetime import datetime

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session, contains_eager

from backend.app.models import Order, Pitch, Slot, Venue, VenueMembership


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

    def rollback(self) -> None:
        self.session.rollback()
