"""Narrow PostgreSQL repository for open-game registrations."""

import uuid

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.app.models import (
    OpenGameRegistration,
    OpenGameRegistrationStatus,
    Order,
)
from backend.app.modules.orders.locking import lock_order as lock_order_row


class RegistrationApplicantConflictError(RuntimeError):
    """Raised only for the named game/applicant uniqueness constraint."""


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

    def flush(self) -> None:
        self.session.flush()

    def commit(self) -> None:
        self.session.commit()

    def rollback(self) -> None:
        self.session.rollback()


def _constraint_name(error: IntegrityError) -> str | None:
    diagnostic = getattr(error.orig, "diag", None)
    return getattr(diagnostic, "constraint_name", None)
