"""HTTP routes for captain-owned and token-shared open games."""

import re
import uuid
from contextlib import suppress
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from backend.app.database import get_database
from backend.app.errors import AppError, ErrorEnvelope, app_error_handler
from backend.app.models import User
from backend.app.modules.auth.repository import AuthRepository
from backend.app.modules.auth.service import resolve_authenticated_user
from backend.app.modules.open_games.dto import (
    CreateOpenGameRequest,
    OpenGameEntry,
    OpenGameOwner,
    OpenGamePublic,
    OpenGameVersionRequest,
    UpdateOpenGameRequest,
)
from backend.app.modules.open_games.repository import OpenGameRepository
from backend.app.modules.open_games.service import OpenGameService
from backend.app.modules.orders.repository import OrderRepository

router = APIRouter(tags=["open-games"])
_open_game_bearer = HTTPBearer(
    auto_error=False,
    scheme_name="bearerAuth",
    bearerFormat="opaque",
)
_ORDER_GAME_PATH = re.compile(r"^/api/v1/orders/[^/]+/game$")
_GAME_PATH = re.compile(r"^/api/v1/games/[^/]+$")
_GAME_ACTION_PATH = re.compile(r"^/api/v1/games/[^/]+/(?:publish|cancel)$")
_DRAFT_FIELDS = frozenset(
    {
        "name",
        "team_name",
        "total_players",
        "fixed_players",
        "open_spots",
        "intensity",
        "minimum_experience",
        "positions",
        "aa_cents",
        "registration_deadline",
        "equipment_and_arrival_notes",
        "visibility",
    }
)


def get_open_game_clock() -> datetime:
    return datetime.now(UTC)


def get_open_game_current_user(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None,
        Depends(_open_game_bearer),
    ],
    database: Annotated[Session, Depends(get_database)],
) -> User:
    token = (
        credentials.credentials
        if credentials is not None and credentials.scheme.casefold() == "bearer"
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


def is_open_game_mutation_request(request: Request) -> bool:
    path = request.url.path
    return (
        request.method == "POST"
        and (_ORDER_GAME_PATH.fullmatch(path) is not None)
    ) or (
        request.method == "PUT" and _GAME_PATH.fullmatch(path) is not None
    ) or (
        request.method == "POST" and _GAME_ACTION_PATH.fullmatch(path) is not None
    )


async def open_game_request_validation_handler(
    request: Request,
    error: RequestValidationError,
) -> JSONResponse:
    allowed_fields = _allowed_body_fields(request)
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
        fields.append({"field": field, "message": _field_error_message(field)})

    message = "请求参数格式不正确，请检查后重试。"
    if fields and all(item["field"] == "expected_version" for item in fields):
        message = "球局版本参数不正确，请刷新后重试。"
    elif fields and all(
        item["field"] == "registration_deadline" for item in fields
    ):
        message = "报名截止时间不符合要求，请修改后重试。"
    return await app_error_handler(
        request,
        AppError(
            422,
            "INVALID_ARGUMENT",
            message,
            details={"fields": fields} if fields else {},
        ),
    )


def _allowed_body_fields(request: Request) -> frozenset[str]:
    if _GAME_ACTION_PATH.fullmatch(request.url.path) is not None:
        return frozenset({"expected_version"})
    if request.method == "PUT":
        return _DRAFT_FIELDS | frozenset({"expected_version"})
    return _DRAFT_FIELDS


def _field_error_message(field: str) -> str:
    if field == "registration_deadline":
        return "必须晚于当前时间且不晚于开场前 2 小时。"
    if field == "expected_version":
        return "必须是当前球局版本。"
    return "字段值不符合要求。"


def _translate_service_validation(
    error: AppError,
    *,
    allowed_fields: frozenset[str],
) -> AppError:
    if error.status_code != 422 or error.code != "INVALID_ARGUMENT":
        return error
    raw_fields = error.details.get("fields")
    if not isinstance(raw_fields, list):
        return error
    fields: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in raw_fields:
        if not isinstance(item, dict):
            continue
        field = item.get("field")
        if not isinstance(field, str) or field not in allowed_fields or field in seen:
            continue
        seen.add(field)
        fields.append({"field": field, "message": _field_error_message(field)})
    return AppError(
        422,
        "INVALID_ARGUMENT",
        "报名截止时间不符合要求，请修改后重试。",
        details={"fields": fields} if fields else {},
    )


def _service(database: Session, *, now: datetime) -> OpenGameService:
    return OpenGameService(
        repository=OpenGameRepository(database),
        order_repository=OrderRepository(database),
        now=lambda: now,
    )


@router.get(
    "/api/v1/orders/{order_id}/game",
    operation_id="getOpenGameEntry",
    response_model=OpenGameEntry,
    responses={
        401: {"model": ErrorEnvelope},
        404: {"model": ErrorEnvelope},
        422: {"model": ErrorEnvelope},
        503: {"model": ErrorEnvelope},
    },
)
def get_open_game_entry(
    order_id: uuid.UUID,
    user: Annotated[User, Depends(get_open_game_current_user)],
    database: Annotated[Session, Depends(get_database)],
    now: Annotated[datetime, Depends(get_open_game_clock)],
) -> OpenGameEntry:
    return _service(database, now=now).get_entry(user_id=user.id, order_id=order_id)


@router.post(
    "/api/v1/orders/{order_id}/game",
    operation_id="createOpenGame",
    status_code=201,
    response_model=OpenGameOwner,
    responses={
        401: {"model": ErrorEnvelope},
        404: {"model": ErrorEnvelope},
        409: {"model": ErrorEnvelope},
        422: {"model": ErrorEnvelope},
        503: {"model": ErrorEnvelope},
    },
)
def create_open_game(
    order_id: uuid.UUID,
    body: CreateOpenGameRequest,
    idempotency_key: Annotated[
        str,
        Header(alias="Idempotency-Key", min_length=16, max_length=128),
    ],
    user: Annotated[User, Depends(get_open_game_current_user)],
    database: Annotated[Session, Depends(get_database)],
    now: Annotated[datetime, Depends(get_open_game_clock)],
) -> OpenGameOwner:
    try:
        return _service(database, now=now).create_draft(
            user_id=user.id,
            order_id=order_id,
            idempotency_key=idempotency_key,
            request=body,
        )
    except AppError as error:
        raise _translate_service_validation(
            error, allowed_fields=_DRAFT_FIELDS
        ) from None


@router.get(
    "/api/v1/games/{game_id}",
    operation_id="getOpenGame",
    response_model=OpenGameOwner,
    responses={
        401: {"model": ErrorEnvelope},
        404: {"model": ErrorEnvelope},
        422: {"model": ErrorEnvelope},
        503: {"model": ErrorEnvelope},
    },
)
def get_open_game(
    game_id: uuid.UUID,
    user: Annotated[User, Depends(get_open_game_current_user)],
    database: Annotated[Session, Depends(get_database)],
    now: Annotated[datetime, Depends(get_open_game_clock)],
) -> OpenGameOwner:
    return _service(database, now=now).get_owner(user_id=user.id, game_id=game_id)


@router.put(
    "/api/v1/games/{game_id}",
    operation_id="updateOpenGame",
    response_model=OpenGameOwner,
    responses={
        401: {"model": ErrorEnvelope},
        404: {"model": ErrorEnvelope},
        409: {"model": ErrorEnvelope},
        422: {"model": ErrorEnvelope},
        503: {"model": ErrorEnvelope},
    },
)
def update_open_game(
    game_id: uuid.UUID,
    body: UpdateOpenGameRequest,
    idempotency_key: Annotated[
        str,
        Header(alias="Idempotency-Key", min_length=16, max_length=128),
    ],
    user: Annotated[User, Depends(get_open_game_current_user)],
    database: Annotated[Session, Depends(get_database)],
    now: Annotated[datetime, Depends(get_open_game_clock)],
) -> OpenGameOwner:
    try:
        return _service(database, now=now).update(
            user_id=user.id,
            game_id=game_id,
            idempotency_key=idempotency_key,
            request=body,
        )
    except AppError as error:
        raise _translate_service_validation(
            error,
            allowed_fields=_DRAFT_FIELDS | frozenset({"expected_version"}),
        ) from None


@router.post(
    "/api/v1/games/{game_id}/publish",
    operation_id="publishOpenGame",
    response_model=OpenGameOwner,
    responses={
        401: {"model": ErrorEnvelope},
        404: {"model": ErrorEnvelope},
        409: {"model": ErrorEnvelope},
        422: {"model": ErrorEnvelope},
        503: {"model": ErrorEnvelope},
    },
)
def publish_open_game(
    game_id: uuid.UUID,
    body: OpenGameVersionRequest,
    idempotency_key: Annotated[
        str,
        Header(alias="Idempotency-Key", min_length=16, max_length=128),
    ],
    user: Annotated[User, Depends(get_open_game_current_user)],
    database: Annotated[Session, Depends(get_database)],
    now: Annotated[datetime, Depends(get_open_game_clock)],
) -> OpenGameOwner:
    return _service(database, now=now).publish(
        user_id=user.id,
        game_id=game_id,
        idempotency_key=idempotency_key,
        request=body,
    )


@router.post(
    "/api/v1/games/{game_id}/cancel",
    operation_id="cancelOpenGame",
    response_model=OpenGameOwner,
    responses={
        401: {"model": ErrorEnvelope},
        404: {"model": ErrorEnvelope},
        409: {"model": ErrorEnvelope},
        422: {"model": ErrorEnvelope},
        503: {"model": ErrorEnvelope},
    },
)
def cancel_open_game(
    game_id: uuid.UUID,
    body: OpenGameVersionRequest,
    idempotency_key: Annotated[
        str,
        Header(alias="Idempotency-Key", min_length=16, max_length=128),
    ],
    user: Annotated[User, Depends(get_open_game_current_user)],
    database: Annotated[Session, Depends(get_database)],
    now: Annotated[datetime, Depends(get_open_game_clock)],
) -> OpenGameOwner:
    return _service(database, now=now).cancel(
        user_id=user.id,
        game_id=game_id,
        idempotency_key=idempotency_key,
        request=body,
    )


@router.get(
    "/api/v1/shared-games/{share_token:path}",
    operation_id="getSharedOpenGame",
    response_model=OpenGamePublic,
    responses={
        404: {"model": ErrorEnvelope},
        503: {"model": ErrorEnvelope},
    },
    openapi_extra={"security": []},
)
def get_shared_open_game(
    share_token: str,
    database: Annotated[Session, Depends(get_database)],
    now: Annotated[datetime, Depends(get_open_game_clock)],
) -> OpenGamePublic:
    return _service(database, now=now).get_public(share_token=share_token)
