from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import and_, or_, select
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
class PlatformReportTarget:
    game_id: uuid.UUID
    order_id: uuid.UUID


@dataclass(frozen=True, slots=True)
class PlatformReportGraph:
    report: OpenGameReport
    resolution: OpenGameReportResolution | None
    game: OpenGame
    order: Order
    registration: OpenGameRegistration
    team: Team
    slot: Slot
    pitch: Pitch
    venue: Venue


class PlatformGameReportRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def locate_target(self, report_id: uuid.UUID) -> PlatformReportTarget | None:
        row = self.session.execute(
            select(OpenGameReport.game_id, OpenGame.order_id)
            .join(OpenGame, OpenGame.id == OpenGameReport.game_id)
            .where(OpenGameReport.id == report_id)
        ).one_or_none()
        return PlatformReportTarget(game_id=row[0], order_id=row[1]) if row else None

    def list_graphs(
        self,
        *,
        resolved: bool,
        limit: int,
        cursor_submitted_at: datetime | None,
        cursor_id: uuid.UUID | None,
    ) -> list[PlatformReportGraph]:
        statement = (
            select(
                OpenGameReport,
                OpenGameReportResolution,
                OpenGame,
                Order,
                OpenGameRegistration,
                Team,
                Slot,
                Pitch,
                Venue,
            )
            .join(OpenGame, OpenGame.id == OpenGameReport.game_id)
            .join(Order, Order.id == OpenGame.order_id)
            .join(
                OpenGameRegistration,
                OpenGameRegistration.id == OpenGameReport.reporter_registration_id,
            )
            .join(Team, Team.id == OpenGame.team_id)
            .join(Slot, Slot.id == Order.slot_id)
            .join(Pitch, Pitch.id == Slot.pitch_id)
            .join(Venue, Venue.id == Pitch.venue_id)
            .outerjoin(
                OpenGameReportResolution,
                OpenGameReportResolution.report_id == OpenGameReport.id,
            )
            .where(
                OpenGameReportResolution.id.is_not(None)
                if resolved
                else OpenGameReportResolution.id.is_(None)
            )
        )
        if cursor_submitted_at is not None and cursor_id is not None:
            statement = statement.where(
                or_(
                    OpenGameReport.submitted_at < cursor_submitted_at,
                    and_(
                        OpenGameReport.submitted_at == cursor_submitted_at,
                        OpenGameReport.id < cursor_id,
                    ),
                )
            )
        rows = self.session.execute(
            statement.order_by(
                OpenGameReport.submitted_at.desc(),
                OpenGameReport.id.desc(),
            ).limit(limit + 1)
        )
        return [PlatformReportGraph(*row) for row in rows]

    def get_graph(self, report_id: uuid.UUID) -> PlatformReportGraph | None:
        row = self.session.execute(
            select(
                OpenGameReport,
                OpenGameReportResolution,
                OpenGame,
                Order,
                OpenGameRegistration,
                Team,
                Slot,
                Pitch,
                Venue,
            )
            .join(OpenGame, OpenGame.id == OpenGameReport.game_id)
            .join(Order, Order.id == OpenGame.order_id)
            .join(
                OpenGameRegistration,
                OpenGameRegistration.id == OpenGameReport.reporter_registration_id,
            )
            .join(Team, Team.id == OpenGame.team_id)
            .join(Slot, Slot.id == Order.slot_id)
            .join(Pitch, Pitch.id == Slot.pitch_id)
            .join(Venue, Venue.id == Pitch.venue_id)
            .outerjoin(
                OpenGameReportResolution,
                OpenGameReportResolution.report_id == OpenGameReport.id,
            )
            .where(OpenGameReport.id == report_id)
            .execution_options(populate_existing=True)
        ).one_or_none()
        return PlatformReportGraph(*row) if row else None

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

    def lock_report(self, *, report_id: uuid.UUID, game_id: uuid.UUID) -> OpenGameReport | None:
        return self.session.scalar(
            select(OpenGameReport)
            .where(OpenGameReport.id == report_id, OpenGameReport.game_id == game_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )

    def get_resolution(self, report_id: uuid.UUID) -> OpenGameReportResolution | None:
        return self.session.scalar(
            select(OpenGameReportResolution).where(OpenGameReportResolution.report_id == report_id)
        )

    def get_idempotency_resolution(
        self, *, principal_id: str, idempotency_key: str
    ) -> OpenGameReportResolution | None:
        return self.session.scalar(
            select(OpenGameReportResolution).where(
                OpenGameReportResolution.resolved_by_principal_id == principal_id,
                OpenGameReportResolution.idempotency_key == idempotency_key,
            )
        )

    def add_resolution(self, resolution: OpenGameReportResolution) -> None:
        self.session.add(resolution)

    def flush(self) -> None:
        self.session.flush()

    def commit(self) -> None:
        self.session.commit()

    def rollback(self) -> None:
        self.session.rollback()
