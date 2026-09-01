from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.models import (
    OpenGame,
    OpenGameRegistration,
    OpenGameReport,
    OpenGameReportResolution,
    Order,
    Pitch,
    Slot,
    Team,
    Venue,
)


@dataclass(frozen=True, slots=True)
class ReportLockTarget:
    order_id: uuid.UUID
    registration_id: uuid.UUID


@dataclass(frozen=True, slots=True)
class ReportGraph:
    game: OpenGame
    order: Order
    registration: OpenGameRegistration
    team: Team
    slot: Slot
    pitch: Pitch
    venue: Venue


@dataclass(frozen=True, slots=True)
class ReportWithResolution:
    report: OpenGameReport
    resolution: OpenGameReportResolution | None


class OpenGameReportRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def locate_target(
        self, *, game_id: uuid.UUID, reporter_user_id: uuid.UUID
    ) -> ReportLockTarget | None:
        row = self.session.execute(
            select(OpenGame.order_id, OpenGameRegistration.id)
            .join(
                OpenGameRegistration,
                OpenGameRegistration.game_id == OpenGame.id,
            )
            .where(
                OpenGame.id == game_id,
                OpenGameRegistration.applicant_user_id == reporter_user_id,
            )
        ).one_or_none()
        return ReportLockTarget(order_id=row[0], registration_id=row[1]) if row else None

    def get_graph(self, *, game_id: uuid.UUID, reporter_user_id: uuid.UUID) -> ReportGraph | None:
        row = self.session.execute(
            select(OpenGame, Order, OpenGameRegistration, Team, Slot, Pitch, Venue)
            .join(Order, Order.id == OpenGame.order_id)
            .join(
                OpenGameRegistration,
                OpenGameRegistration.game_id == OpenGame.id,
            )
            .join(Team, Team.id == OpenGame.team_id)
            .join(Slot, Slot.id == Order.slot_id)
            .join(Pitch, Pitch.id == Slot.pitch_id)
            .join(Venue, Venue.id == Pitch.venue_id)
            .where(
                OpenGame.id == game_id,
                OpenGameRegistration.applicant_user_id == reporter_user_id,
            )
            .execution_options(populate_existing=True)
        ).one_or_none()
        return ReportGraph(*row) if row else None

    def lock_order(self, order_id: uuid.UUID) -> Order | None:
        return self.session.scalar(
            select(Order)
            .where(Order.id == order_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )

    def lock_game(self, *, game_id: uuid.UUID, order_id: uuid.UUID) -> OpenGame | None:
        return self.session.scalar(
            select(OpenGame)
            .where(OpenGame.id == game_id, OpenGame.order_id == order_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )

    def lock_registration(
        self,
        *,
        registration_id: uuid.UUID,
        game_id: uuid.UUID,
        reporter_user_id: uuid.UUID,
    ) -> OpenGameRegistration | None:
        return self.session.scalar(
            select(OpenGameRegistration)
            .where(
                OpenGameRegistration.id == registration_id,
                OpenGameRegistration.game_id == game_id,
                OpenGameRegistration.applicant_user_id == reporter_user_id,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )

    def get_report(
        self, *, game_id: uuid.UUID, reporter_user_id: uuid.UUID
    ) -> ReportWithResolution | None:
        row = self.session.execute(
            select(OpenGameReport, OpenGameReportResolution)
            .outerjoin(
                OpenGameReportResolution,
                OpenGameReportResolution.report_id == OpenGameReport.id,
            )
            .where(
                OpenGameReport.game_id == game_id,
                OpenGameReport.reporter_user_id == reporter_user_id,
            )
        ).one_or_none()
        return ReportWithResolution(report=row[0], resolution=row[1]) if row else None

    def get_idempotency_report(
        self, *, reporter_user_id: uuid.UUID, idempotency_key: str
    ) -> ReportWithResolution | None:
        row = self.session.execute(
            select(OpenGameReport, OpenGameReportResolution)
            .outerjoin(
                OpenGameReportResolution,
                OpenGameReportResolution.report_id == OpenGameReport.id,
            )
            .where(
                OpenGameReport.reporter_user_id == reporter_user_id,
                OpenGameReport.idempotency_key == idempotency_key,
            )
        ).one_or_none()
        return ReportWithResolution(report=row[0], resolution=row[1]) if row else None

    def add_report(self, report: OpenGameReport) -> None:
        self.session.add(report)

    def flush(self) -> None:
        self.session.flush()

    def commit(self) -> None:
        self.session.commit()

    def rollback(self) -> None:
        self.session.rollback()
