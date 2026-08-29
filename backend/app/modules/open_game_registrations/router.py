"""HTTP routes for applicant and captain open-game registration journeys."""

import re
import uuid
from contextlib import suppress
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, Query, Request
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
    MyOpenGameApplicationsResponse,
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


def align_my_open_game_applications_openapi(schema: dict[str, Any]) -> None:
    request_id_header = {"$ref": "#/components/headers/RequestId"}

    def error_response(
        description: str,
        *,
        code: str,
        example_name: str,
        example_file: str,
    ) -> dict[str, Any]:
        return {
            "description": description,
            "headers": {"X-Request-Id": request_id_header},
            "content": {
                "application/json": {
                    "schema": {
                        "allOf": [
                            {"$ref": "#/components/schemas/ErrorEnvelope"},
                            {
                                "type": "object",
                                "properties": {
                                    "error": {
                                        "type": "object",
                                        "properties": {"code": {"const": code}},
                                    }
                                },
                            },
                        ]
                    },
                    "examples": {
                        example_name: {
                            "externalValue": f"./examples/{example_file}"
                        }
                    },
                }
            },
        }

    schema["paths"]["/api/v1/open-game-applications"]["get"] = {
        "operationId": "listMyOpenGameApplications",
        "description": (
            "Applications owned by the current authenticated user, newest first."
        ),
        "security": [{"bearerAuth": []}],
        "parameters": [
            {
                "name": "limit",
                "in": "query",
                "required": False,
                "schema": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 50,
                    "default": 20,
                },
            },
            {
                "name": "cursor",
                "in": "query",
                "required": False,
                "schema": {"type": "string", "minLength": 1},
            },
        ],
        "responses": {
            "200": {
                "description": (
                    "Current page of the authenticated user's applications."
                ),
                "headers": {"X-Request-Id": request_id_header},
                "content": {
                    "application/json": {
                        "schema": {
                            "$ref": (
                                "#/components/schemas/"
                                "MyOpenGameApplicationsResponse"
                            )
                        },
                        "examples": {
                            "Ready": {
                                "externalValue": (
                                    "./examples/"
                                    "my-open-game-applications-ready.json"
                                )
                            },
                            "Empty": {
                                "externalValue": (
                                    "./examples/"
                                    "my-open-game-applications-empty.json"
                                )
                            },
                        },
                    }
                },
            },
            "401": error_response(
                "Authentication required.",
                code="AUTH_REQUIRED",
                example_name="AuthRequired",
                example_file="error-auth-required.json",
            ),
            "422": error_response(
                "Limit or cursor is invalid.",
                code="INVALID_ARGUMENT",
                example_name="InvalidArgument",
                example_file=(
                    "error-my-open-game-applications-invalid-argument.json"
                ),
            ),
            "503": error_response(
                "Open game application service is unavailable.",
                code="SERVICE_UNAVAILABLE",
                example_name="ServiceUnavailable",
                example_file="error-service-unavailable.json",
            ),
        },
    }

    components = schema["components"]
    components.setdefault("securitySchemes", {})["bearerAuth"] = {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "opaque",
    }
    components.setdefault("headers", {})["RequestId"] = {
        "description": "Identifier used to trace the request.",
        "required": True,
        "schema": {"type": "string", "minLength": 1},
    }
    components["schemas"].update(
        {
            "OpenGameRegistrationEffectiveStatus": {
                "type": "string",
                "enum": ["APPLIED", "JOINED", "REJECTED", "CANCELLED"],
            },
            "MyOpenGameApplication": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "id",
                    "effective_status",
                    "applied_at",
                    "detail_path",
                    "game_name",
                    "starts_at",
                    "ends_at",
                    "time_zone",
                    "venue_name",
                    "pitch_name",
                    "pitch_specification",
                ],
                "properties": {
                    "id": {"type": "string", "format": "uuid"},
                    "effective_status": {
                        "$ref": (
                            "#/components/schemas/"
                            "OpenGameRegistrationEffectiveStatus"
                        )
                    },
                    "applied_at": {"type": "string", "format": "date-time"},
                    "detail_path": {
                        "type": "string",
                        "pattern": (
                            r"^/pages/captain-game-public/index\?token="
                            r"[A-Za-z0-9_-]{32}$"
                        ),
                    },
                    "game_name": {"type": "string"},
                    "starts_at": {"type": "string", "format": "date-time"},
                    "ends_at": {"type": "string", "format": "date-time"},
                    "time_zone": {"type": "string"},
                    "venue_name": {"type": "string"},
                    "pitch_name": {"type": "string"},
                    "pitch_specification": {"type": "string"},
                },
            },
            "MyOpenGameApplicationsResponse": {
                "type": "object",
                "additionalProperties": False,
                "required": ["items", "next_cursor"],
                "properties": {
                    "items": {
                        "type": "array",
                        "items": {
                            "$ref": "#/components/schemas/MyOpenGameApplication"
                        },
                    },
                    "next_cursor": {
                        "type": ["string", "null"],
                        "minLength": 1,
                    },
                },
            },
        }
    )


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
    "/api/v1/open-game-applications",
    operation_id="listMyOpenGameApplications",
    response_model=MyOpenGameApplicationsResponse,
    responses={
        401: {"model": ErrorEnvelope},
        422: {"model": ErrorEnvelope},
        503: {"model": ErrorEnvelope},
    },
)
def list_my_open_game_applications(
    user: Annotated[User, Depends(get_required_open_game_registration_user)],
    database: Annotated[Session, Depends(get_database)],
    now: Annotated[datetime, Depends(get_open_game_registration_clock)],
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    cursor: Annotated[str | None, Query(min_length=1)] = None,
) -> MyOpenGameApplicationsResponse:
    return _service(database, now=now).list_my_applications(
        applicant_user_id=user.id,
        limit=limit,
        cursor=cursor,
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
