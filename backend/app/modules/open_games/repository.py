"""PostgreSQL repository for captain-owned open games."""

import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.app.models import (
    ImageRole,
    OpenGame,
    OpenGameCancellationSource,
    OpenGameStatus,
    Order,
    Payment,
    Pitch,
    RefundAttempt,
    RefundCase,
    Slot,
    Team,
    Venue,
    VenueImage,
)


class ShareTokenCollisionError(RuntimeError):
    """Raised only for the named share-token uniqueness constraint."""


class ActiveOpenGameConflictError(RuntimeError):
    """Raised only for the named one-active-game partial index."""


@dataclass(frozen=True, slots=True)
class OrderAuthorityRows:
    payments: tuple[Payment, ...]
    refund_cases: tuple[RefundCase, ...]
    refund_attempts: tuple[RefundAttempt, ...]


@dataclass(frozen=True, slots=True)
class OpenGameOrderRow:
    venue_name: str
    pitch_name: str
    players_per_side: int
    booking_price_cents: int
    starts_at: datetime
    ends_at: datetime
    time_zone: str | None


class OpenGameRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def get_owned_order(
        self,
        *,
        order_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> Order | None:
        return self.session.scalar(
            select(Order)
            .where(Order.id == order_id, Order.user_id == user_id)
            .execution_options(populate_existing=True)
        )

    def lock_owned_order(
        self,
        *,
        order_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> Order | None:
        return self.session.scalar(
            select(Order)
            .where(Order.id == order_id, Order.user_id == user_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )

    def locate_order_id(self, *, game_id: uuid.UUID) -> uuid.UUID | None:
        return self.session.scalar(select(OpenGame.order_id).where(OpenGame.id == game_id))

    def get_owned_game(
        self,
        *,
        game_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> OpenGame | None:
        return self.session.scalar(
            select(OpenGame)
            .join(Order, Order.id == OpenGame.order_id)
            .where(OpenGame.id == game_id, Order.user_id == user_id)
            .execution_options(populate_existing=True)
        )

    def get_active_game(self, *, order_id: uuid.UUID) -> OpenGame | None:
        return self.session.scalar(
            select(OpenGame)
            .where(
                OpenGame.order_id == order_id,
                OpenGame.status != OpenGameStatus.CANCELLED,
            )
            .order_by(OpenGame.created_at.desc(), OpenGame.id.desc())
            .limit(1)
            .execution_options(populate_existing=True)
        )

    def lock_active_game(self, *, order_id: uuid.UUID) -> OpenGame | None:
        return self.session.scalar(
            select(OpenGame)
            .where(
                OpenGame.order_id == order_id,
                OpenGame.status != OpenGameStatus.CANCELLED,
            )
            .order_by(OpenGame.created_at.desc(), OpenGame.id.desc())
            .limit(1)
            .with_for_update()
            .execution_options(populate_existing=True)
        )

    def has_platform_cancelled_game(self, *, order_id: uuid.UUID) -> bool:
        return (
            self.session.scalar(
                select(OpenGame.id)
                .where(
                    OpenGame.order_id == order_id,
                    OpenGame.cancellation_source == OpenGameCancellationSource.PLATFORM_REPORT,
                )
                .limit(1)
            )
            is not None
        )

    def lock_target_game(
        self,
        *,
        game_id: uuid.UUID,
        order_id: uuid.UUID,
    ) -> OpenGame | None:
        return self.session.scalar(
            select(OpenGame)
            .where(OpenGame.id == game_id, OpenGame.order_id == order_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )

    def get_by_share_token(self, *, share_token: str) -> OpenGame | None:
        return self.session.scalar(
            select(OpenGame)
            .where(
                OpenGame.share_token == share_token,
                OpenGame.published_at.is_not(None),
            )
            .execution_options(populate_existing=True)
        )

    def get_order_authority(self, *, order_id: uuid.UUID) -> OrderAuthorityRows:
        return self._order_authority(order_id=order_id, lock=False)

    def lock_order_authority(self, *, order_id: uuid.UUID) -> OrderAuthorityRows:
        return self._order_authority(order_id=order_id, lock=True)

    def _order_authority(
        self,
        *,
        order_id: uuid.UUID,
        lock: bool,
    ) -> OrderAuthorityRows:
        payment_statement = (
            select(Payment)
            .where(Payment.order_id == order_id)
            .order_by(Payment.id)
            .execution_options(populate_existing=True)
        )
        refund_case_statement = (
            select(RefundCase)
            .where(RefundCase.order_id == order_id)
            .order_by(RefundCase.created_at, RefundCase.id)
            .execution_options(populate_existing=True)
        )
        if lock:
            payment_statement = payment_statement.with_for_update()
            refund_case_statement = refund_case_statement.with_for_update()
        payments = tuple(self.session.scalars(payment_statement))
        refund_cases = tuple(self.session.scalars(refund_case_statement))
        case_ids = [row.id for row in refund_cases]
        refund_attempt_statement = (
            select(RefundAttempt)
            .where(RefundAttempt.refund_case_id.in_(case_ids))
            .order_by(
                RefundAttempt.refund_case_id,
                RefundAttempt.attempt_no,
                RefundAttempt.id,
            )
            .execution_options(populate_existing=True)
        )
        if lock:
            refund_attempt_statement = refund_attempt_statement.with_for_update()
        refund_attempts = tuple(self.session.scalars(refund_attempt_statement)) if case_ids else ()
        return OrderAuthorityRows(
            payments=payments,
            refund_cases=refund_cases,
            refund_attempts=refund_attempts,
        )

    def get_order_row(self, *, order_id: uuid.UUID) -> OpenGameOrderRow | None:
        row = self.session.execute(
            select(
                Venue.name,
                Pitch.name,
                Pitch.players_per_side,
                Order.price_cents,
                Slot.starts_at,
                Slot.ends_at,
                Venue.timezone,
            )
            .select_from(Order)
            .join(Slot, Slot.id == Order.slot_id)
            .join(Pitch, Pitch.id == Slot.pitch_id)
            .join(Venue, Venue.id == Pitch.venue_id)
            .where(Order.id == order_id)
        ).one_or_none()
        if row is None:
            return None
        return OpenGameOrderRow(
            venue_name=row[0],
            pitch_name=row[1],
            players_per_side=row[2],
            booking_price_cents=row[3],
            starts_at=row[4],
            ends_at=row[5],
            time_zone=row[6],
        )

    def get_team(self, *, team_id: uuid.UUID) -> Team | None:
        return self.session.get(Team, team_id)

    def upsert_team(
        self,
        *,
        captain_user_id: uuid.UUID,
        name: str,
        name_key: str,
    ) -> Team:
        candidate_id = uuid.uuid4()
        self.session.execute(
            insert(Team)
            .values(
                id=candidate_id,
                captain_user_id=captain_user_id,
                name=name,
                name_key=name_key,
            )
            .on_conflict_do_nothing(constraint="uq_teams_captain_name_key")
        )
        team = self.session.scalar(
            select(Team).where(
                Team.captain_user_id == captain_user_id,
                Team.name_key == name_key,
            )
        )
        if team is None:
            raise RuntimeError("team upsert did not resolve")
        return team

    def insert_game_candidate(self, game: OpenGame) -> None:
        try:
            with self.session.begin_nested():
                self.session.add(game)
                self.session.flush()
        except IntegrityError as error:
            constraint_name = _constraint_name(error)
            if constraint_name == "uq_open_games_share_token":
                raise ShareTokenCollisionError from error
            if constraint_name == "uq_open_games_one_active_per_order":
                raise ActiveOpenGameConflictError from error
            raise

    def get_cover_images(self, *, order_id: uuid.UUID) -> tuple[VenueImage, ...]:
        return tuple(
            self.session.scalars(
                select(VenueImage)
                .join(Venue, Venue.id == VenueImage.venue_id)
                .join(Pitch, Pitch.venue_id == Venue.id)
                .join(Slot, Slot.pitch_id == Pitch.id)
                .join(Order, Order.slot_id == Slot.id)
                .where(
                    Order.id == order_id,
                    VenueImage.role == ImageRole.COVER,
                )
                .order_by(VenueImage.id)
            )
        )

    def flush(self) -> None:
        self.session.flush()

    def commit(self) -> None:
        self.session.commit()

    def rollback(self) -> None:
        self.session.rollback()


def _constraint_name(error: IntegrityError) -> str | None:
    diagnostic = getattr(error.orig, "diag", None)
    return getattr(diagnostic, "constraint_name", None)
