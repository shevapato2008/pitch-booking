from __future__ import annotations

import hashlib
import json
import uuid
from collections.abc import Callable
from datetime import datetime

from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from backend.app.errors import AppError
from backend.app.models import (
    OpenGame,
    OpenGameAttendanceCorrection,
    OpenGameAttendanceStatus,
    OpenGameRegistrationStatus,
    Order,
)
from backend.app.modules.open_games.lifecycle import (
    EffectiveOpenGameState,
    OpenGameFacts,
    project_open_game_state,
)
from backend.app.modules.orders.lifecycle import OrderLifecycleFacts
from backend.app.modules.platform_attendance_corrections.dto import (
    PlatformAttendanceAllowedCorrection,
    PlatformAttendanceCorrectionEvent,
    PlatformAttendanceCorrectionRequest,
    PlatformAttendanceRegistrationDetail,
)
from backend.app.modules.platform_attendance_corrections.repository import (
    AttendanceRegistrationGraph,
    PlatformAttendanceCorrectionRepository,
)

CORRECT_PLATFORM_ATTENDANCE_OPERATION = "CORRECT_PLATFORM_ATTENDANCE_REGISTRATION"
_TERMINAL_ATTENDANCE = {
    OpenGameAttendanceStatus.PRESENT,
    OpenGameAttendanceStatus.NO_SHOW,
}


class PlatformAttendanceCorrectionService:
    def __init__(
        self,
        *,
        repository: PlatformAttendanceCorrectionRepository,
        now: Callable[[], datetime],
    ) -> None:
        self.repository = repository
        self.now = now

    def get_registration(self, registration_id: uuid.UUID) -> PlatformAttendanceRegistrationDetail:
        try:
            graph = self._lock_graph(registration_id)
            corrections = self.repository.list_corrections(registration_id)
            detail = _project_detail(graph, corrections)
            self.repository.commit()
            return detail
        except AppError:
            self.repository.rollback()
            raise
        except (SQLAlchemyError, ValidationError, ValueError, RuntimeError):
            self.repository.rollback()
            raise _service_unavailable() from None

    def correct(
        self,
        *,
        registration_id: uuid.UUID,
        principal_id: str,
        idempotency_key: str,
        request: PlatformAttendanceCorrectionRequest,
    ) -> PlatformAttendanceCorrectionEvent:
        normalized_principal = principal_id.strip()
        if not 1 <= len(normalized_principal) <= 128:
            raise _invalid_argument()
        if not 16 <= len(idempotency_key) <= 128:
            raise _invalid_argument()
        try:
            graph = self._lock_graph(registration_id)
            registration = graph.registration
            digest = _correction_request_digest(
                registration_id=registration.id,
                game_id=graph.game.id,
                request=request,
            )
            existing = self.repository.get_idempotency_correction(
                principal_id=normalized_principal,
                idempotency_key=idempotency_key,
            )
            if existing is not None:
                replay = _replay(existing, digest=digest)
                self.repository.commit()
                return replay

            corrections = self.repository.list_corrections(registration.id)
            allowed = _allowed_correction(
                game_completed=_game_state(graph.game, graph.order)
                is EffectiveOpenGameState.COMPLETED,
                registration_status=registration.status,
                attendance_status=registration.attendance_status,
                attendance_recorded_at=registration.attendance_recorded_at,
                attendance_recorded_by_user_id=(registration.attendance_recorded_by_user_id),
            )
            if corrections and not _correction_history_complete(
                registration_status=registration.attendance_status,
                registration_version=registration.version,
                corrections=corrections,
            ):
                allowed = _audit_incomplete()
            if (
                allowed.target_status is None
                or request.attendance_status is not allowed.target_status
                or registration.version != request.expected_version
            ):
                raise _attendance_state_changed()

            event = OpenGameAttendanceCorrection(
                id=uuid.uuid4(),
                registration_id=registration.id,
                from_status=registration.attendance_status,
                to_status=request.attendance_status,
                reason=request.reason,
                corrected_by_principal_id=normalized_principal,
                corrected_at=self.now(),
                registration_version_before=registration.version,
                registration_version_after=registration.version + 1,
                idempotency_key=idempotency_key,
                request_sha256=digest,
            )
            self.repository.add_correction(event)
            try:
                self.repository.flush()
            except IntegrityError as error:
                constraint = _constraint_name(error)
                self.repository.rollback()
                if constraint == ("uq_open_game_attendance_corrections_principal_idempotency_key"):
                    persisted = self.repository.get_idempotency_correction(
                        principal_id=normalized_principal,
                        idempotency_key=idempotency_key,
                    )
                    if persisted is None:
                        raise _service_unavailable() from None
                    return _replay(persisted, digest=digest)
                if constraint == ("uq_open_game_attendance_corrections_registration_version_after"):
                    raise _attendance_state_changed() from None
                raise

            registration.attendance_status = request.attendance_status
            registration.version += 1
            self.repository.flush()
            result = _event(event)
            self.repository.commit()
            return result
        except AppError:
            self.repository.rollback()
            raise
        except (SQLAlchemyError, ValidationError, ValueError, RuntimeError):
            self.repository.rollback()
            raise _service_unavailable() from None

    def _lock_graph(self, registration_id: uuid.UUID) -> AttendanceRegistrationGraph:
        target = self.repository.locate_lock_target(registration_id)
        if target is None:
            raise _not_found()
        order = self.repository.lock_order(target.order_id)
        if order is None:
            raise _not_found()
        game = self.repository.lock_game(
            game_id=target.game_id,
            order_id=order.id,
        )
        if game is None:
            raise _not_found()
        registration = self.repository.lock_registration(
            registration_id=registration_id,
            game_id=game.id,
        )
        if registration is None:
            raise _not_found()
        graph = self.repository.get_registration_graph(registration.id)
        if graph is None:
            raise RuntimeError("attendance registration graph is incomplete")
        return graph


def _correction_request_digest(
    *,
    registration_id: uuid.UUID,
    game_id: uuid.UUID,
    request: PlatformAttendanceCorrectionRequest,
) -> str:
    payload = {
        "operation": CORRECT_PLATFORM_ATTENDANCE_OPERATION,
        "registration_id": str(registration_id),
        "game_id": str(game_id),
        "attendance_status": request.attendance_status.value,
        "expected_version": request.expected_version,
        "reason": request.reason,
        "schema_version": 1,
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


def _allowed_correction(
    *,
    game_completed: bool,
    registration_status: OpenGameRegistrationStatus,
    attendance_status: OpenGameAttendanceStatus,
    attendance_recorded_at: datetime | None,
    attendance_recorded_by_user_id: uuid.UUID | None,
) -> PlatformAttendanceAllowedCorrection:
    if not game_completed:
        return PlatformAttendanceAllowedCorrection(
            target_status=None,
            blocked_reason="GAME_NOT_COMPLETED",
        )
    if registration_status is not OpenGameRegistrationStatus.JOINED:
        return PlatformAttendanceAllowedCorrection(
            target_status=None,
            blocked_reason="REGISTRATION_NOT_JOINED",
        )
    if attendance_status is OpenGameAttendanceStatus.UNMARKED:
        return PlatformAttendanceAllowedCorrection(
            target_status=None,
            blocked_reason="ATTENDANCE_UNMARKED",
        )
    if (
        attendance_status not in _TERMINAL_ATTENDANCE
        or attendance_recorded_at is None
        or attendance_recorded_by_user_id is None
    ):
        return PlatformAttendanceAllowedCorrection(
            target_status=None,
            blocked_reason="ATTENDANCE_AUDIT_INCOMPLETE",
        )
    target = (
        OpenGameAttendanceStatus.NO_SHOW
        if attendance_status is OpenGameAttendanceStatus.PRESENT
        else OpenGameAttendanceStatus.PRESENT
    )
    return PlatformAttendanceAllowedCorrection(
        target_status=target,
        blocked_reason=None,
    )


def _project_detail(
    graph: AttendanceRegistrationGraph,
    corrections: list[OpenGameAttendanceCorrection],
) -> PlatformAttendanceRegistrationDetail:
    registration = graph.registration
    state = _game_state(graph.game, graph.order)
    events = tuple(_event(correction) for correction in corrections)
    if events:
        original_status = events[0].from_status
    elif registration.attendance_status in _TERMINAL_ATTENDANCE:
        original_status = registration.attendance_status
    else:
        original_status = None
    allowed = _allowed_correction(
        game_completed=state is EffectiveOpenGameState.COMPLETED,
        registration_status=registration.status,
        attendance_status=registration.attendance_status,
        attendance_recorded_at=registration.attendance_recorded_at,
        attendance_recorded_by_user_id=(registration.attendance_recorded_by_user_id),
    )
    if events and not _correction_history_complete(
        registration_status=registration.attendance_status,
        registration_version=registration.version,
        corrections=corrections,
    ):
        allowed = _audit_incomplete()
    return PlatformAttendanceRegistrationDetail(
        registration_id=registration.id,
        registration_status=registration.status,
        player_display_name=registration.display_name,
        intended_position=registration.position,
        game_name=graph.game.name,
        game_status=state,
        venue_name=graph.venue.name,
        pitch_name=graph.pitch.name,
        starts_at=graph.slot.starts_at,
        ends_at=graph.slot.ends_at,
        time_zone=graph.venue.timezone,
        original_attendance_status=original_status,
        attendance_recorded_at=registration.attendance_recorded_at,
        attendance_status=registration.attendance_status,
        version=registration.version,
        corrections=events,
        allowed_correction=allowed,
    )


def _correction_history_complete(
    *,
    registration_status: OpenGameAttendanceStatus,
    registration_version: int,
    corrections: list[OpenGameAttendanceCorrection],
) -> bool:
    if not corrections:
        return True
    expected_status = corrections[0].from_status
    expected_version = corrections[0].registration_version_before
    for correction in corrections:
        if (
            correction.from_status is not expected_status
            or correction.registration_version_before != expected_version
            or correction.to_status is correction.from_status
            or correction.registration_version_after != correction.registration_version_before + 1
        ):
            return False
        expected_status = correction.to_status
        expected_version = correction.registration_version_after
    return expected_status is registration_status and expected_version == registration_version


def _audit_incomplete() -> PlatformAttendanceAllowedCorrection:
    return PlatformAttendanceAllowedCorrection(
        target_status=None,
        blocked_reason="ATTENDANCE_AUDIT_INCOMPLETE",
    )


def _game_state(game: OpenGame, order: Order) -> EffectiveOpenGameState:
    return project_open_game_state(
        OpenGameFacts(
            stored_status=game.status,
            registration_deadline=game.registration_deadline,
            order_facts=OrderLifecycleFacts(
                status=order.status,
                starts_at=order.slot.starts_at,
                ends_at=order.slot.ends_at,
                cancel_requested_at=order.cancel_requested_at,
                checked_in_at=order.checked_in_at,
                payment_may_exist=False,
                controlling_refund_purpose=None,
            ),
        )
    )


def _event(
    correction: OpenGameAttendanceCorrection,
) -> PlatformAttendanceCorrectionEvent:
    return PlatformAttendanceCorrectionEvent(
        id=correction.id,
        registration_id=correction.registration_id,
        from_status=correction.from_status,
        to_status=correction.to_status,
        reason=correction.reason,
        corrected_by_principal_id=correction.corrected_by_principal_id,
        corrected_at=correction.corrected_at,
        registration_version_before=correction.registration_version_before,
        registration_version_after=correction.registration_version_after,
    )


def _replay(
    correction: OpenGameAttendanceCorrection,
    *,
    digest: str,
) -> PlatformAttendanceCorrectionEvent:
    if correction.request_sha256 != digest:
        raise _idempotency_key_reused()
    return _event(correction)


def _constraint_name(error: IntegrityError) -> str | None:
    diagnostic = getattr(error.orig, "diag", None)
    return getattr(diagnostic, "constraint_name", None)


def _not_found() -> AppError:
    return AppError(
        404,
        "ATTENDANCE_REGISTRATION_NOT_FOUND",
        "未找到该报名记录。",
    )


def _invalid_argument() -> AppError:
    return AppError(422, "INVALID_ARGUMENT", "请求参数格式不正确，请检查后重试。")


def _attendance_state_changed() -> AppError:
    return AppError(
        409,
        "ATTENDANCE_STATE_CHANGED",
        "到场记录状态已变化，请刷新后重试。",
    )


def _idempotency_key_reused() -> AppError:
    return AppError(
        409,
        "IDEMPOTENCY_KEY_REUSED",
        "该幂等键已用于其他请求，请生成新键后重试。",
    )


def _service_unavailable() -> AppError:
    return AppError(503, "SERVICE_UNAVAILABLE", "到场纠正服务暂不可用。")
