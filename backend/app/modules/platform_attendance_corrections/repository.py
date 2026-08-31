from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.models import (
    OpenGame,
    OpenGameAttendanceCorrection,
    OpenGameRegistration,
    Order,
    Pitch,
    Slot,
    Venue,
)


@dataclass(frozen=True, slots=True)
class AttendanceLockTarget:
    game_id: uuid.UUID
    order_id: uuid.UUID


@dataclass(frozen=True, slots=True)
class AttendanceRegistrationGraph:
    registration: OpenGameRegistration
    game: OpenGame
    order: Order
    slot: Slot
    pitch: Pitch
    venue: Venue


class PlatformAttendanceCorrectionRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def locate_lock_target(self, registration_id: uuid.UUID) -> AttendanceLockTarget | None:
        row = self.session.execute(
            select(OpenGameRegistration.game_id, OpenGame.order_id)
            .join(OpenGame, OpenGame.id == OpenGameRegistration.game_id)
            .where(OpenGameRegistration.id == registration_id)
        ).one_or_none()
        if row is None:
            return None
        return AttendanceLockTarget(game_id=row[0], order_id=row[1])

    def get_registration_graph(
        self, registration_id: uuid.UUID
    ) -> AttendanceRegistrationGraph | None:
        row = self.session.execute(
            select(OpenGameRegistration, OpenGame, Order, Slot, Pitch, Venue)
            .join(OpenGame, OpenGame.id == OpenGameRegistration.game_id)
            .join(Order, Order.id == OpenGame.order_id)
            .join(Slot, Slot.id == Order.slot_id)
            .join(Pitch, Pitch.id == Slot.pitch_id)
            .join(Venue, Venue.id == Pitch.venue_id)
            .where(OpenGameRegistration.id == registration_id)
            .execution_options(populate_existing=True)
        ).one_or_none()
        if row is None:
            return None
        return AttendanceRegistrationGraph(
            registration=row[0],
            game=row[1],
            order=row[2],
            slot=row[3],
            pitch=row[4],
            venue=row[5],
        )

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
        self, *, registration_id: uuid.UUID, game_id: uuid.UUID
    ) -> OpenGameRegistration | None:
        return self.session.scalar(
            select(OpenGameRegistration)
            .where(
                OpenGameRegistration.id == registration_id,
                OpenGameRegistration.game_id == game_id,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )

    def get_idempotency_correction(
        self, *, principal_id: str, idempotency_key: str
    ) -> OpenGameAttendanceCorrection | None:
        return self.session.scalar(
            select(OpenGameAttendanceCorrection).where(
                OpenGameAttendanceCorrection.corrected_by_principal_id == principal_id,
                OpenGameAttendanceCorrection.idempotency_key == idempotency_key,
            )
        )

    def list_corrections(self, registration_id: uuid.UUID) -> list[OpenGameAttendanceCorrection]:
        return list(
            self.session.scalars(
                select(OpenGameAttendanceCorrection)
                .where(OpenGameAttendanceCorrection.registration_id == registration_id)
                .order_by(
                    OpenGameAttendanceCorrection.registration_version_after,
                    OpenGameAttendanceCorrection.id,
                )
            )
        )

    def add_correction(self, correction: OpenGameAttendanceCorrection) -> None:
        self.session.add(correction)

    def flush(self) -> None:
        self.session.flush()

    def commit(self) -> None:
        self.session.commit()

    def rollback(self) -> None:
        self.session.rollback()
