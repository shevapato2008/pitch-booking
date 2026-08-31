"""Bounded PostgreSQL query for anonymous public-game discovery."""

import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.app.models import (
    OpenGame,
    OpenGameIntensity,
    OpenGameRegistration,
    OpenGameRegistrationStatus,
    OpenGameStatus,
    OpenGameVisibility,
    Order,
    OrderStatus,
    Pitch,
    RefundCase,
    RefundCasePurpose,
    Slot,
    Team,
    Venue,
)

_CONTROLLING_REFUND_PURPOSES = (
    RefundCasePurpose.ORDER_CANCELLATION,
    RefundCasePurpose.PAYMENT_INVENTORY_CONFLICT,
)


@dataclass(frozen=True, slots=True)
class PublicGameDirectoryCandidate:
    game_id: uuid.UUID
    name: str
    total_players: int
    fixed_players: int
    open_spots: int
    intensity: OpenGameIntensity
    minimum_experience: str | None
    position_mask: int
    aa_cents: int
    registration_deadline: datetime
    equipment_and_arrival_notes: str | None
    visibility: OpenGameVisibility
    stored_status: OpenGameStatus
    share_token: str
    published_at: datetime | None
    order_status: OrderStatus
    cancel_requested_at: datetime | None
    checked_in_at: datetime | None
    starts_at: datetime
    ends_at: datetime
    pitch_name: str
    players_per_side: int
    venue_name: str
    time_zone: str | None
    team_name: str
    joined_count: int
    controlling_refund_purpose: RefundCasePurpose | None


class PublicGameDirectoryRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def list_candidates(
        self,
        *,
        now: datetime,
    ) -> tuple[PublicGameDirectoryCandidate, ...]:
        joined_counts = (
            select(
                OpenGameRegistration.game_id.label("game_id"),
                func.count(OpenGameRegistration.id).label("joined_count"),
            )
            .where(OpenGameRegistration.status == OpenGameRegistrationStatus.JOINED)
            .group_by(OpenGameRegistration.game_id)
            .subquery()
        )
        controlling_refund_purpose = (
            select(RefundCase.purpose)
            .where(
                RefundCase.order_id == Order.id,
                RefundCase.purpose.in_(_CONTROLLING_REFUND_PURPOSES),
            )
            .order_by(RefundCase.created_at.desc(), RefundCase.id.desc())
            .limit(1)
            .correlate(Order)
            .scalar_subquery()
        )
        statement = (
            select(
                OpenGame.id,
                OpenGame.name,
                OpenGame.total_players,
                OpenGame.fixed_players,
                OpenGame.open_spots,
                OpenGame.intensity,
                OpenGame.minimum_experience,
                OpenGame.position_mask,
                OpenGame.aa_cents,
                OpenGame.registration_deadline,
                OpenGame.equipment_and_arrival_notes,
                OpenGame.visibility,
                OpenGame.status,
                OpenGame.share_token,
                OpenGame.published_at,
                Order.status,
                Order.cancel_requested_at,
                Order.checked_in_at,
                Slot.starts_at,
                Slot.ends_at,
                Pitch.name,
                Pitch.players_per_side,
                Venue.name,
                Venue.timezone,
                Team.name,
                func.coalesce(joined_counts.c.joined_count, 0),
                controlling_refund_purpose,
            )
            .select_from(OpenGame)
            .join(Order, Order.id == OpenGame.order_id)
            .join(Slot, Slot.id == Order.slot_id)
            .join(Pitch, Pitch.id == Slot.pitch_id)
            .join(Venue, Venue.id == Pitch.venue_id)
            .join(Team, Team.id == OpenGame.team_id)
            .outerjoin(
                joined_counts,
                joined_counts.c.game_id == OpenGame.id,
            )
            .where(
                OpenGame.status == OpenGameStatus.PUBLISHED,
                OpenGame.visibility == OpenGameVisibility.PUBLIC,
                OpenGame.published_at.is_not(None),
                OpenGame.registration_deadline > now,
                Slot.starts_at > now,
                Pitch.players_per_side.in_((5, 7)),
            )
            .order_by(Slot.starts_at, OpenGame.id)
        )
        return tuple(
            PublicGameDirectoryCandidate(*row) for row in self.session.execute(statement).all()
        )

    def rollback(self) -> None:
        self.session.rollback()
