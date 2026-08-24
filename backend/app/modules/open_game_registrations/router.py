"""HTTP routes for applicant and captain open-game registration journeys."""

import re
import uuid
from contextlib import suppress
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from backend.app.database import get_database
from backend.app.errors import AppError, ErrorEnvelope, app_error_handler
from backend.app.models import User
from backend.app.modules.auth.repository import AuthRepository
from backend.app.modules.auth.service import resolve_authenticated_user
from backend.app.modules.open_game_registrations.dto import (
    CreateApplicationRequest,
    DecisionRequest,
    DecisionResult,
    Queue,
    RegistrationContext,
)
from backend.app.modules.open_game_registrations.repository import (
    OpenGameRegistrationRepository,
)
from backend.app.modules.open_game_registrations.service import (
    OpenGameRegistrationService,
)
from backend.app.modules.open_games.repository import OpenGameRepository
from backend.app.modules.open_games.router import get_open_game_current_user
from backend.app.modules.orders.repository import OrderRepository

router = APIRouter(tags=["open-game-registrations"])

_APPLICATION_PATH = re.compile(
    r"^/api/v1/shared-games/[^/]+/applications$"
)
_DECISION_PATH = re.compile(
    r"^/api/v1/games/[^/]+/applications/[^/]+/decision$"
)
_APPLICATION_FIELDS = frozenset(
    {
        "display_name",
        "position",
        "note",
        "adult_confirmed",
        "risk_confirmed",
    }
)
_DECISION_FIELDS = frozenset({"decision", "expected_version"})
_INVALID_ARGUMENT_EXAMPLE = {
    "error": {
        "code": "INVALID_ARGUMENT",
        "message": "请求参数格式不正确，请检查后重试。",
        "request_id": "req_contract_invalid_argument_001",
        "details": {"field": "date"},
    }
}


def get_open_game_registration_clock() -> datetime:
    return datetime.now(UTC)


def get_optional_open_game_registration_user(
    request: Request,
    database: Annotated[Session, Depends(get_database)],
) -> User | None:
    authorization = request.headers.get("authorization")
    if authorization is None:
        return None
    parts = authorization.split()
    token = (
        parts[1]
        if len(parts) == 2
        and parts[0].casefold() == "bearer"
        and bool(parts[1])
        else None
    )
    try:
        return resolve_authenticated_user(AuthRepository(database), token)
    except SQLAlchemyError:
        with suppress(Exception):
            database.rollback()
        raise AppError(
            503,
            "SERVICE_UNAVAILABLE",
            "球局服务暂不可用，请稍后重试。",
        ) from None


def get_required_open_game_registration_user(
    user: Annotated[User, Depends(get_open_game_current_user)],
) -> User:
    return user


def is_open_game_registration_mutation_request(request: Request) -> bool:
    if request.method != "POST":
        return False
    path = request.url.path
    return (
        _APPLICATION_PATH.fullmatch(path) is not None
        or _DECISION_PATH.fullmatch(path) is not None
    )


async def open_game_registration_request_validation_handler(
    request: Request,
    error: RequestValidationError,
) -> JSONResponse:
    allowed_fields = (
        _DECISION_FIELDS
        if _DECISION_PATH.fullmatch(request.url.path) is not None
        else _APPLICATION_FIELDS
    )
    fields: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in error.errors():
        location = item.get("loc", ())
        if (
            len(location) < 2
            or location[0] != "body"
            or not isinstance(location[1], str)
            or location[1] not in allowed_fields
            or location[1] in seen
        ):
            continue
        field = location[1]
        seen.add(field)
        fields.append({"field": field, "message": "字段值不符合要求。"})
    return await app_error_handler(
        request,
        AppError(
            422,
            "INVALID_ARGUMENT",
            "请求参数格式不正确，请检查后重试。",
            details={"fields": fields} if fields else {},
        ),
    )


def _service(database: Session, *, now: datetime) -> OpenGameRegistrationService:
    return OpenGameRegistrationService(
        repository=OpenGameRegistrationRepository(database),
        open_game_repository=OpenGameRepository(database),
        order_repository=OrderRepository(database),
        now=lambda: now,
    )


@router.get(
    "/api/v1/shared-games/{share_token}/registration-context",
    operation_id="getOpenGameRegistrationContext",
    response_model=RegistrationContext,
    responses={
        401: {"model": ErrorEnvelope},
        404: {"model": ErrorEnvelope},
        503: {"model": ErrorEnvelope},
    },
    openapi_extra={"security": [{}, {"bearerAuth": []}]},
)
def get_open_game_registration_context(
    share_token: str,
    viewer: Annotated[
        User | None,
        Depends(get_optional_open_game_registration_user),
    ],
    database: Annotated[Session, Depends(get_database)],
    now: Annotated[datetime, Depends(get_open_game_registration_clock)],
) -> RegistrationContext:
    return _service(database, now=now).get_context(
        share_token=share_token,
        viewer_user_id=viewer.id if viewer is not None else None,
    )


@router.post(
    "/api/v1/shared-games/{share_token}/applications",
    operation_id="createOpenGameApplication",
    status_code=201,
    response_model=RegistrationContext,
    responses={
        401: {"model": ErrorEnvelope},
        404: {"model": ErrorEnvelope},
        409: {"model": ErrorEnvelope},
        422: {"model": ErrorEnvelope},
        503: {"model": ErrorEnvelope},
    },
)
def create_open_game_application(
    share_token: str,
    body: CreateApplicationRequest,
    idempotency_key: Annotated[
        str,
        Header(alias="Idempotency-Key", min_length=16, max_length=128),
    ],
    user: Annotated[User, Depends(get_required_open_game_registration_user)],
    database: Annotated[Session, Depends(get_database)],
    now: Annotated[datetime, Depends(get_open_game_registration_clock)],
) -> RegistrationContext:
    return _service(database, now=now).apply(
        share_token=share_token,
        applicant_user_id=user.id,
        idempotency_key=idempotency_key,
        request=body,
    )


@router.get(
    "/api/v1/games/{game_id}/applications",
    operation_id="listOpenGameApplications",
    response_model=Queue,
    responses={
        401: {"model": ErrorEnvelope},
        404: {"model": ErrorEnvelope},
        422: {
            "model": ErrorEnvelope,
            "content": {
                "application/json": {
                    "examples": {
                        "InvalidArgument": {"value": _INVALID_ARGUMENT_EXAMPLE}
                    }
                }
            },
        },
        503: {"model": ErrorEnvelope},
    },
)
def list_open_game_applications(
    game_id: uuid.UUID,
    user: Annotated[User, Depends(get_required_open_game_registration_user)],
    database: Annotated[Session, Depends(get_database)],
    now: Annotated[datetime, Depends(get_open_game_registration_clock)],
) -> Queue:
    return _service(database, now=now).get_queue(
        game_id=game_id,
        owner_user_id=user.id,
    )


@router.post(
    "/api/v1/games/{game_id}/applications/{application_id}/decision",
    operation_id="decideOpenGameApplication",
    response_model=DecisionResult,
    responses={
        401: {"model": ErrorEnvelope},
        404: {"model": ErrorEnvelope},
        409: {"model": ErrorEnvelope},
        422: {"model": ErrorEnvelope},
        503: {"model": ErrorEnvelope},
    },
)
def decide_open_game_application(
    game_id: uuid.UUID,
    application_id: uuid.UUID,
    body: DecisionRequest,
    idempotency_key: Annotated[
        str,
        Header(alias="Idempotency-Key", min_length=16, max_length=128),
    ],
    user: Annotated[User, Depends(get_required_open_game_registration_user)],
    database: Annotated[Session, Depends(get_database)],
    now: Annotated[datetime, Depends(get_open_game_registration_clock)],
) -> DecisionResult:
    return _service(database, now=now).decide(
        game_id=game_id,
        application_id=application_id,
        owner_user_id=user.id,
        idempotency_key=idempotency_key,
        request=body,
    )
