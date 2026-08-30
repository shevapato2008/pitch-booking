"""Narrow PostgreSQL repository for open-game registrations."""

import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from backend.app.models import (
    OpenGame,
    OpenGameRegistration,
    OpenGameRegistrationStatus,
    Order,
    Pitch,
    RefundCase,
    Slot,
)
from backend.app.modules.orders.locking import lock_order as lock_order_row


class RegistrationApplicantConflictError(RuntimeError):
    """Raised only for the named game/applicant uniqueness constraint."""


@dataclass(frozen=True, slots=True)
class WithdrawalTarget:
    game_id: uuid.UUID
    order_id: uuid.UUID


@dataclass(frozen=True, slots=True)
class MyRegistrationProjectionRow:
    registration: OpenGameRegistration
    waitlist_position: int | None


class OpenGameRegistrationRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def get_registration(
        self,
        *,
        game_id: uuid.UUID,
        applicant_user_id: uuid.UUID,
    ) -> OpenGameRegistration | None:
        return self.session.scalar(
            select(OpenGameRegistration)
            .where(
                OpenGameRegistration.game_id == game_id,
                OpenGameRegistration.applicant_user_id == applicant_user_id,
            )
            .execution_options(populate_existing=True)
        )

    def lock_registration(
        self,
        *,
        game_id: uuid.UUID,
        application_id: uuid.UUID,
    ) -> OpenGameRegistration | None:
        return self.session.scalar(
            select(OpenGameRegistration)
            .where(
                OpenGameRegistration.game_id == game_id,
                OpenGameRegistration.id == application_id,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )

    def locate_withdrawal_target(
        self,
        *,
        application_id: uuid.UUID,
        applicant_user_id: uuid.UUID,
    ) -> WithdrawalTarget | None:
        row = self.session.execute(
            select(OpenGameRegistration.game_id, OpenGame.order_id)
            .join(OpenGame, OpenGame.id == OpenGameRegistration.game_id)
            .where(
                OpenGameRegistration.id == application_id,
                OpenGameRegistration.applicant_user_id == applicant_user_id,
            )
        ).one_or_none()
        if row is None:
            return None
        return WithdrawalTarget(game_id=row[0], order_id=row[1])

    def lock_self_registration(
        self,
        *,
        game_id: uuid.UUID,
        application_id: uuid.UUID,
        applicant_user_id: uuid.UUID,
    ) -> OpenGameRegistration | None:
        return self.session.scalar(
            select(OpenGameRegistration)
            .where(
                OpenGameRegistration.game_id == game_id,
                OpenGameRegistration.id == application_id,
                OpenGameRegistration.applicant_user_id == applicant_user_id,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )

    def count_joined(self, *, game_id: uuid.UUID) -> int:
        count = self.session.scalar(
            select(func.count())
            .select_from(OpenGameRegistration)
            .where(
                OpenGameRegistration.game_id == game_id,
                OpenGameRegistration.status == OpenGameRegistrationStatus.JOINED,
            )
        )
        return int(count or 0)

    def next_waitlist_seq(self, *, game_id: uuid.UUID) -> int:
        historical_max = self.session.scalar(
            select(func.max(OpenGameRegistration.waitlist_seq)).where(
                OpenGameRegistration.game_id == game_id,
            )
        )
        return int(historical_max or 0) + 1

    def lock_order(self, *, order_id: uuid.UUID) -> Order | None:
        return lock_order_row(self.session, order_id)

    def add_registration(self, registration: OpenGameRegistration) -> None:
        try:
            with self.session.begin_nested():
                self.session.add(registration)
                self.session.flush()
        except IntegrityError as error:
            if _constraint_name(error) == "uq_open_game_registrations_game_applicant":
                raise RegistrationApplicantConflictError from error
            raise

    def list_pending(self, *, game_id: uuid.UUID) -> list[OpenGameRegistration]:
        return list(
            self.session.scalars(
                select(OpenGameRegistration)
                .where(
                    OpenGameRegistration.game_id == game_id,
                    OpenGameRegistration.status
                    == OpenGameRegistrationStatus.APPLIED,
                )
                .order_by(
                    OpenGameRegistration.applied_at,
                    OpenGameRegistration.id,
                )
                .execution_options(populate_existing=True)
            )
        )

    def list_waitlisted(self, *, game_id: uuid.UUID) -> list[OpenGameRegistration]:
        return list(
            self.session.scalars(
                select(OpenGameRegistration)
                .where(
                    OpenGameRegistration.game_id == game_id,
                    OpenGameRegistration.status
                    == OpenGameRegistrationStatus.WAITLISTED,
                )
                .order_by(
                    OpenGameRegistration.waitlist_seq,
                    OpenGameRegistration.id,
                )
                .execution_options(populate_existing=True)
            )
        )

    def get_waitlist_position(
        self,
        *,
        game_id: uuid.UUID,
        application_id: uuid.UUID,
        waitlist_seq: int,
    ) -> int:
        preceding = self.session.scalar(
            select(func.count())
            .select_from(OpenGameRegistration)
            .where(
                OpenGameRegistration.game_id == game_id,
                OpenGameRegistration.status
                == OpenGameRegistrationStatus.WAITLISTED,
                or_(
                    OpenGameRegistration.waitlist_seq < waitlist_seq,
                    and_(
                        OpenGameRegistration.waitlist_seq == waitlist_seq,
                        OpenGameRegistration.id < application_id,
                    ),
                ),
            )
        )
        return int(preceding or 0) + 1

    def list_mine(
        self,
        *,
        applicant_user_id: uuid.UUID,
        limit: int,
        cursor_applied_at: datetime | None,
        cursor_id: uuid.UUID | None,
    ) -> list[MyRegistrationProjectionRow]:
        queued = OpenGameRegistration.__table__.alias("queued_registration")
        preceding_count = (
            select(func.count())
            .select_from(queued)
            .where(
                queued.c.game_id == OpenGameRegistration.game_id,
                queued.c.status == OpenGameRegistrationStatus.WAITLISTED,
                or_(
                    queued.c.waitlist_seq < OpenGameRegistration.waitlist_seq,
                    and_(
                        queued.c.waitlist_seq
                        == OpenGameRegistration.waitlist_seq,
                        queued.c.id < OpenGameRegistration.id,
                    ),
                ),
            )
            .correlate(OpenGameRegistration)
            .scalar_subquery()
        )
        waitlist_position = case(
            (
                OpenGameRegistration.status
                == OpenGameRegistrationStatus.WAITLISTED,
                preceding_count + 1,
            ),
            else_=None,
        ).label("waitlist_position")
        game_order = joinedload(OpenGameRegistration.game).joinedload(OpenGame.order)
        statement = (
            select(OpenGameRegistration, waitlist_position)
            .where(OpenGameRegistration.applicant_user_id == applicant_user_id)
            .options(
                joinedload(OpenGameRegistration.game).joinedload(OpenGame.team),
                game_order.joinedload(Order.slot)
                .joinedload(Slot.pitch)
                .joinedload(Pitch.venue),
                game_order.selectinload(Order.payments),
                game_order.selectinload(Order.refund_cases).selectinload(
                    RefundCase.attempts
                ),
            )
        )
        if cursor_applied_at is not None and cursor_id is not None:
            statement = statement.where(
                or_(
                    OpenGameRegistration.applied_at < cursor_applied_at,
                    and_(
                        OpenGameRegistration.applied_at == cursor_applied_at,
                        OpenGameRegistration.id < cursor_id,
                    ),
                )
            )
        rows = self.session.execute(
            statement.order_by(
                OpenGameRegistration.applied_at.desc(),
                OpenGameRegistration.id.desc(),
            )
            .limit(limit)
            .execution_options(populate_existing=True)
        )
        return [
            MyRegistrationProjectionRow(
                registration=row[0],
                waitlist_position=(
                    int(row.waitlist_position)
                    if row.waitlist_position is not None
                    else None
                ),
            )
            for row in rows
        ]

    def flush(self) -> None:
        self.session.flush()

    def commit(self) -> None:
        self.session.commit()

    def rollback(self) -> None:
        self.session.rollback()


def _constraint_name(error: IntegrityError) -> str | None:
    diagnostic = getattr(error.orig, "diag", None)
    return getattr(diagnostic, "constraint_name", None)
