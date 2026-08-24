"""Applicant context and idempotent apply transaction for shared open games."""

import hashlib
import json
import uuid
from collections.abc import Callable
from datetime import UTC, datetime

from pydantic import ValidationError
from sqlalchemy.exc import SQLAlchemyError

from backend.app.errors import AppError
from backend.app.models import (
    IdempotencyRecord,
    IdempotencyState,
    OpenGame,
    OpenGameRegistration,
    OpenGameRegistrationStatus,
    Order,
)
from backend.app.modules.open_game_registrations.dto import (
    OPEN_GAME_REGISTRATION_CONSENT_VERSION,
    CreateApplicationRequest,
    RegistrationContext,
)
from backend.app.modules.open_game_registrations.lifecycle import (
    RegistrationFacts,
    project_apply_actions,
    remaining_spots,
)
from backend.app.modules.open_game_registrations.privacy import (
    project_viewer_registration,
)
from backend.app.modules.open_game_registrations.repository import (
    OpenGameRegistrationRepository,
    RegistrationApplicantConflictError,
)
from backend.app.modules.open_games.lifecycle import OpenGameProjectionInvariantError
from backend.app.modules.open_games.repository import (
    OpenGameOrderRow,
    OpenGameRepository,
    OrderAuthorityRows,
)
from backend.app.modules.open_games.service import (
    AuthoritativePublicGameProjection,
    project_authoritative_public_game,
)
from backend.app.modules.orders.repository import OrderRepository

CREATE_OPEN_GAME_APPLICATION_OPERATION = "create_open_game_application"


class OpenGameRegistrationService:
    def __init__(
        self,
        *,
        repository: OpenGameRegistrationRepository,
        open_game_repository: OpenGameRepository,
        order_repository: OrderRepository,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        session = repository.session
        if (
            open_game_repository.session is not session
            or order_repository.session is not session
        ):
            raise ValueError(
                "registration, open-game and order repositories must share one Session"
            )
        self._repository = repository
        self._open_game_repository = open_game_repository
        self._order_repository = order_repository
        self._now = now or (lambda: datetime.now(UTC))

    def get_context(
        self,
        *,
        share_token: str,
        viewer_user_id: uuid.UUID | None,
    ) -> RegistrationContext:
        try:
            game = self._open_game_repository.get_by_share_token(
                share_token=share_token
            )
            if game is None:
                raise _game_not_found()
            order = game.order
            authority = self._open_game_repository.get_order_authority(
                order_id=order.id
            )
            order_row = self._require_order_row(order.id)
            now = self._now()
            projection = self._project_game(
                game=game,
                order=order,
                authority=authority,
                order_row=order_row,
                now=now,
            )
            joined_count = self._repository.count_joined(game_id=game.id)
            registration = (
                self._repository.get_registration(
                    game_id=game.id,
                    applicant_user_id=viewer_user_id,
                )
                if viewer_user_id is not None
                else None
            )
            return _project_context(
                game=game,
                projection=projection,
                viewer_user_id=viewer_user_id,
                registration=registration,
                joined_count=joined_count,
                now=now,
            )
        except AppError:
            self._repository.rollback()
            raise
        except (
            SQLAlchemyError,
            OpenGameProjectionInvariantError,
            ValidationError,
            ValueError,
            RuntimeError,
        ):
            self._repository.rollback()
            raise _service_unavailable() from None

    def apply(
        self,
        *,
        share_token: str,
        applicant_user_id: uuid.UUID,
        idempotency_key: str,
        request: CreateApplicationRequest,
    ) -> RegistrationContext:
        try:
            proof = self._open_game_repository.get_by_share_token(
                share_token=share_token
            )
            if proof is None:
                raise _game_not_found()
            order = self._repository.lock_order(order_id=proof.order_id)
            if order is None:
                raise _game_not_found()
            game = self._open_game_repository.lock_target_game(
                game_id=proof.id,
                order_id=order.id,
            )
            if (
                game is None
                or game.share_token != share_token
                or game.published_at is None
            ):
                raise _game_not_found()

            digest = _application_request_digest(
                operation=CREATE_OPEN_GAME_APPLICATION_OPERATION,
                share_token=share_token,
                resolved_game_id=game.id,
                request=request,
            )
            record, claimed = self._order_repository.claim_idempotency(
                user_id=applicant_user_id,
                operation=CREATE_OPEN_GAME_APPLICATION_OPERATION,
                key=idempotency_key,
                request_sha256=digest,
            )
            if not claimed:
                replay = _replay_context(record, digest=digest)
                self._order_repository.commit()
                return replay

            authority = self._open_game_repository.lock_order_authority(
                order_id=order.id
            )
            order_row = self._require_order_row(order.id)
            now = self._now()
            projection = self._project_game(
                game=game,
                order=order,
                authority=authority,
                order_row=order_row,
                now=now,
            )
            existing = self._repository.get_registration(
                game_id=game.id,
                applicant_user_id=applicant_user_id,
            )
            if existing is not None:
                raise _application_already_exists()
            joined_count = self._repository.count_joined(game_id=game.id)
            before = _project_context(
                game=game,
                projection=projection,
                viewer_user_id=applicant_user_id,
                registration=None,
                joined_count=joined_count,
                now=now,
            )
            if not before.allowed_actions.can_apply:
                blocker = before.allowed_actions.apply_blocked_reason
                if blocker is None:
                    raise RuntimeError("blocked apply projection has no blocker")
                raise AppError(
                    409,
                    "APPLICATION_NOT_ALLOWED",
                    "当前球局暂不允许提交申请。",
                    details={
                        "apply_blocked_reason": blocker.value,
                        "remaining_spots": before.remaining_spots,
                    },
                )

            registration = OpenGameRegistration(
                id=uuid.uuid4(),
                game_id=game.id,
                applicant_user_id=applicant_user_id,
                display_name=request.display_name,
                position=request.position,
                note=request.note,
                status=OpenGameRegistrationStatus.APPLIED,
                version=1,
                consent_version=OPEN_GAME_REGISTRATION_CONSENT_VERSION,
                adult_confirmed_at=now,
                risk_confirmed_at=now,
                applied_at=now,
                decided_at=None,
                decided_by_user_id=None,
            )
            self._repository.add_registration(registration)
            response = _project_context(
                game=game,
                projection=projection,
                viewer_user_id=applicant_user_id,
                registration=registration,
                joined_count=joined_count,
                now=now,
            )
            self._order_repository.complete_idempotency(
                record,
                response_status=201,
                response_body=response.model_dump(mode="json"),
            )
            self._order_repository.commit()
            return response
        except RegistrationApplicantConflictError:
            self._repository.rollback()
            raise _application_already_exists() from None
        except AppError:
            self._repository.rollback()
            raise
        except (
            SQLAlchemyError,
            OpenGameProjectionInvariantError,
            ValidationError,
            ValueError,
            RuntimeError,
        ):
            self._repository.rollback()
            raise _service_unavailable() from None

    def _require_order_row(self, order_id: uuid.UUID) -> OpenGameOrderRow:
        row = self._open_game_repository.get_order_row(order_id=order_id)
        if row is None:
            raise RuntimeError("open-game order graph is missing")
        return row

    def _project_game(
        self,
        *,
        game: OpenGame,
        order: Order,
        authority: OrderAuthorityRows,
        order_row: OpenGameOrderRow,
        now: datetime,
    ) -> AuthoritativePublicGameProjection:
        team = self._open_game_repository.get_team(team_id=game.team_id)
        if team is None:
            raise RuntimeError("open game team is missing")
        return project_authoritative_public_game(
            game=game,
            order=order,
            authority=authority,
            order_row=order_row,
            team=team,
            now=now,
        )


def _project_context(
    *,
    game: OpenGame,
    projection: AuthoritativePublicGameProjection,
    viewer_user_id: uuid.UUID | None,
    registration: OpenGameRegistration | None,
    joined_count: int,
    now: datetime,
) -> RegistrationContext:
    facts = RegistrationFacts(
        game_state=projection.state,
        stored_game_status=game.status,
        viewer_authenticated=viewer_user_id is not None,
        viewer_is_owner=viewer_user_id == projection.owner_user_id,
        viewer_has_registration=registration is not None,
        registration_deadline=game.registration_deadline,
        starts_at=projection.starts_at,
        open_spots=game.open_spots,
        joined_count=joined_count,
    )
    viewer_registration = (
        project_viewer_registration(
            display_name=registration.display_name,
            position=registration.position,
            note=registration.note,
            persisted_status=registration.status,
            game_state=projection.state,
            applied_at=registration.applied_at,
            decided_at=registration.decided_at,
        )
        if registration is not None
        else None
    )
    return RegistrationContext(
        game=projection.public,
        remaining_spots=remaining_spots(
            open_spots=game.open_spots,
            joined_count=joined_count,
        ),
        viewer_authenticated=viewer_user_id is not None,
        viewer_registration=viewer_registration,
        allowed_actions=project_apply_actions(facts, now),
    )


def _application_request_digest(
    *,
    operation: str,
    share_token: str,
    resolved_game_id: uuid.UUID,
    request: CreateApplicationRequest,
) -> str:
    payload = {
        "operation": operation,
        "share_token": share_token,
        "resolved_game_id": str(resolved_game_id),
        "body": request.model_dump(mode="json"),
        "version": 1,
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


def _replay_context(
    record: IdempotencyRecord,
    *,
    digest: str,
) -> RegistrationContext:
    if record.request_sha256 != digest:
        raise AppError(
            409,
            "IDEMPOTENCY_KEY_REUSED",
            "该幂等键已用于其他请求，请生成新键后重试。",
        )
    if (
        record.state is not IdempotencyState.COMPLETED
        or record.response_status != 201
        or record.response_body is None
    ):
        raise _service_unavailable()
    return RegistrationContext.model_validate(record.response_body)


def _game_not_found() -> AppError:
    return AppError(404, "OPEN_GAME_NOT_FOUND", "球局不存在。")


def _application_already_exists() -> AppError:
    return AppError(
        409,
        "APPLICATION_ALREADY_EXISTS",
        "你已申请过本场球局，请刷新查看当前结果。",
    )


def _service_unavailable() -> AppError:
    return AppError(
        503,
        "SERVICE_UNAVAILABLE",
        "服务暂时不可用，请稍后重试。",
    )
