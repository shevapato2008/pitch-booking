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
            "ErrorEnvelope": {
                "type": "object",
                "additionalProperties": False,
                "required": ["error"],
                "properties": {
                    "error": {"$ref": "#/components/schemas/Error"}
                },
            },
            "Error": {
                "type": "object",
                "additionalProperties": False,
                "required": ["code", "message", "request_id", "details"],
                "properties": {
                    "code": {
                        "type": "string",
                        "enum": [
                            "INVALID_ARGUMENT",
                            "PITCH_TYPE_NOT_SUPPORTED",
                            "DATE_OUT_OF_RANGE",
                            "VENUE_NOT_FOUND",
                            "SERVICE_UNAVAILABLE",
                            "INTERNAL_ERROR",
                            "PRIMARY_VENUE_MISCONFIGURED",
                            "VENUE_DIRECTORY_MISCONFIGURED",
                            "AUTH_REQUIRED",
                            "WECHAT_LOGIN_FAILED",
                            "PHONE_AUTH_REQUIRED",
                            "PHONE_AUTH_UNAVAILABLE",
                            "PHONE_AUTH_FAILED",
                            "INVALID_CONTACT",
                            "SLOT_NOT_AVAILABLE",
                            "PRICE_CHANGED",
                            "IDEMPOTENCY_KEY_REUSED",
                            "ORDER_NOT_FOUND",
                            "ORDER_EXPIRED",
                            "PAYMENT_CREATE_FAILED",
                            "PAYMENT_PROVIDER_UNAVAILABLE",
                            "PAYMENT_EXCEPTION",
                            "ORDER_STATE_CHANGED",
                            "PAYMENT_RESULT_PENDING",
                            "REFUND_IN_PROGRESS",
                            "WECHAT_NOTIFICATION_INVALID",
                            "INVENTORY_FORBIDDEN",
                            "PITCH_NOT_FOUND",
                            "SLOT_NOT_FOUND",
                            "SLOT_TIME_CONFLICT",
                            "INVENTORY_VERSION_CONFLICT",
                            "INVENTORY_SLOT_READ_ONLY",
                            "REQUEST_IN_PROGRESS",
                            "CONFIGURATION_CHANGED",
                            "PITCH_NAME_CONFLICT",
                            "PITCH_FORMAT_IMMUTABLE",
                            "PITCH_HAS_BUSINESS_HISTORY",
                            "PITCH_DEACTIVATE_BLOCKED",
                            "LAST_ACTIVE_PITCH_REQUIRED",
                            "INVALID_PLAYERS_PER_SIDE",
                            "INVALID_CUSTOM_NAME",
                            "DUPLICATE_PITCH_CHANGE",
                            "VENUE_PROFILE_VERSION_CONFLICT",
                            "VENUE_PROFILE_VALIDATION_FAILED",
                            "POSSIBLE_DUPLICATE_VENUE",
                            "ONBOARDING_EVIDENCE_REQUIRED",
                            "ONBOARDING_EVIDENCE_INVALID",
                            "ONBOARDING_APPLICATION_EXISTS",
                            "ONBOARDING_APPLICATION_NOT_FOUND",
                            "ONBOARDING_APPLICATION_STATE_CHANGED",
                            "PLATFORM_AUTH_REQUIRED",
                            "PLATFORM_AUTH_INVALID",
                            "PLATFORM_CSRF_INVALID",
                            "PLATFORM_ROLE_REQUIRED",
                            "ORDER_NOT_ELIGIBLE",
                            "OPEN_GAME_NOT_FOUND",
                            "OPEN_GAME_ALREADY_EXISTS",
                            "OPEN_GAME_STATE_CHANGED",
                            "APPLICATION_NOT_FOUND",
                            "APPLICATION_ALREADY_EXISTS",
                            "APPLICATION_NOT_ALLOWED",
                            "APPLICATION_STATE_CHANGED",
                            "APPLICATION_CAPACITY_CHANGED",
                        ],
                    },
                    "message": {"type": "string", "minLength": 1},
                    "request_id": {"type": "string", "minLength": 1},
                    "details": {"$ref": "#/components/schemas/ErrorDetails"},
                },
            },
            "ErrorDetails": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "fields": {
                        "type": "array",
                        "items": {"$ref": "#/components/schemas/ErrorField"},
                    },
                    "field": {"type": "string", "minLength": 1},
                    "pitch_type": {"type": "string", "minLength": 1},
                    "start_date": {"type": "string", "format": "date"},
                    "end_date": {"type": "string", "format": "date"},
                    "current_checkout": {
                        "$ref": "#/components/schemas/Checkout"
                    },
                    "future_blockers": {
                        "$ref": "#/components/schemas/PitchFutureBlockers"
                    },
                    "latest_configuration": {
                        "$ref": "#/components/schemas/PitchConfiguration"
                    },
                    "current_facility_version": {
                        "type": "integer",
                        "minimum": 1,
                    },
                    "current_revision_version": {
                        "type": "integer",
                        "minimum": 1,
                    },
                    "reason": {"type": "string", "minLength": 1},
                    "claim_candidate": {
                        "$ref": "#/components/schemas/VenueOnboardingCandidate"
                    },
                    "apply_blocked_reason": {
                        "$ref": "#/components/schemas/OpenGameApplyBlockedReason"
                    },
                    "remaining_spots": {"type": "integer", "minimum": 0},
                    "allowed_actions": {
                        "$ref": "#/components/schemas/OpenGameReviewActions"
                    },
                },
            },
            "ErrorField": {
                "type": "object",
                "additionalProperties": False,
                "required": ["field", "message"],
                "properties": {
                    "field": {"type": "string", "minLength": 1},
                    "message": {"type": "string", "minLength": 1},
                },
            },
            "Checkout": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "slot_id",
                    "venue",
                    "pitch",
                    "date",
                    "starts_at",
                    "ends_at",
                    "duration_minutes",
                    "price_cents",
                    "currency",
                    "available",
                    "cancellation_summary",
                    "lock_duration_seconds",
                    "contact",
                    "checkout_version",
                ],
                "properties": {
                    "slot_id": {"type": "string", "format": "uuid"},
                    "venue": {"$ref": "#/components/schemas/CheckoutVenue"},
                    "pitch": {"$ref": "#/components/schemas/PhysicalPitch"},
                    "date": {"type": "string", "format": "date"},
                    "starts_at": {"type": "string", "format": "date-time"},
                    "ends_at": {"type": "string", "format": "date-time"},
                    "duration_minutes": {"type": "integer", "minimum": 1},
                    "price_cents": {"type": "integer", "minimum": 0},
                    "currency": {"type": "string", "const": "CNY"},
                    "available": {"type": "boolean", "const": True},
                    "cancellation_summary": {
                        "type": "string",
                        "minLength": 1,
                    },
                    "lock_duration_seconds": {
                        "type": "integer",
                        "minimum": 1,
                    },
                    "contact": {
                        "$ref": "#/components/schemas/CheckoutContact"
                    },
                    "checkout_version": {"type": "integer", "minimum": 1},
                },
            },
            "CheckoutContact": {
                "type": "object",
                "additionalProperties": False,
                "required": ["masked_phone", "last_contact_name"],
                "properties": {
                    "masked_phone": {
                        "type": ["string", "null"],
                        "pattern": r"^1[0-9]{2}\*{4}[0-9]{4}$",
                    },
                    "last_contact_name": {
                        "type": ["string", "null"],
                        "minLength": 1,
                        "maxLength": 40,
                    },
                },
            },
            "PitchFutureBlockers": {
                "type": "object",
                "additionalProperties": False,
                "required": ["AVAILABLE", "LOCKED", "BOOKED"],
                "properties": {
                    "AVAILABLE": {"type": "integer", "minimum": 0},
                    "LOCKED": {"type": "integer", "minimum": 0},
                    "BOOKED": {"type": "integer", "minimum": 0},
                },
            },
            "PitchCapability": {
                "type": "object",
                "additionalProperties": False,
                "required": ["allowed", "reason"],
                "properties": {
                    "allowed": {"type": "boolean"},
                    "reason": {"type": ["string", "null"]},
                },
            },
            "PitchCapabilities": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "edit_format",
                    "delete",
                    "deactivate",
                    "reactivate",
                    "future_blockers",
                ],
                "properties": {
                    "edit_format": {
                        "$ref": "#/components/schemas/PitchCapability"
                    },
                    "delete": {"$ref": "#/components/schemas/PitchCapability"},
                    "deactivate": {
                        "$ref": "#/components/schemas/PitchCapability"
                    },
                    "reactivate": {
                        "$ref": "#/components/schemas/PitchCapability"
                    },
                    "future_blockers": {
                        "$ref": "#/components/schemas/PitchFutureBlockers"
                    },
                },
            },
            "ConfiguredPitch": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "id",
                    "custom_name",
                    "system_name",
                    "display_name",
                    "players_per_side",
                    "sequence",
                    "status",
                    "capabilities",
                ],
                "properties": {
                    "id": {"type": "string", "format": "uuid"},
                    "custom_name": {
                        "type": ["string", "null"],
                        "maxLength": 30,
                    },
                    "system_name": {"type": "string", "minLength": 1},
                    "display_name": {"type": "string", "minLength": 1},
                    "players_per_side": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 99,
                    },
                    "sequence": {"type": "integer", "minimum": 1},
                    "status": {
                        "type": "string",
                        "enum": ["ACTIVE", "INACTIVE"],
                    },
                    "capabilities": {
                        "$ref": "#/components/schemas/PitchCapabilities"
                    },
                },
            },
            "CreatedPitchMapping": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "client_ref",
                    "pitch_id",
                    "sequence",
                    "system_name",
                ],
                "properties": {
                    "client_ref": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 100,
                    },
                    "pitch_id": {"type": "string", "format": "uuid"},
                    "sequence": {"type": "integer", "minimum": 1},
                    "system_name": {"type": "string", "minLength": 1},
                },
            },
            "PitchConfigurationVenue": {
                "type": "object",
                "additionalProperties": False,
                "required": ["id", "name", "timezone"],
                "properties": {
                    "id": {"type": "string", "format": "uuid"},
                    "name": {"type": "string", "minLength": 1},
                    "timezone": {"type": "string", "minLength": 1},
                },
            },
            "PitchConfiguration": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "venue",
                    "configuration_version",
                    "pitches",
                    "created_pitch_mappings",
                ],
                "properties": {
                    "venue": {
                        "$ref": "#/components/schemas/PitchConfigurationVenue"
                    },
                    "configuration_version": {
                        "type": "integer",
                        "minimum": 1,
                    },
                    "pitches": {
                        "type": "array",
                        "items": {"$ref": "#/components/schemas/ConfiguredPitch"},
                    },
                    "created_pitch_mappings": {
                        "type": "array",
                        "items": {
                            "$ref": "#/components/schemas/CreatedPitchMapping"
                        },
                    },
                },
            },
            "VenueOnboardingCandidate": {
                "description": (
                    "Safe claim candidate drawn only from listed and active "
                    "public venues."
                ),
                "type": "object",
                "additionalProperties": False,
                "required": ["venue_id", "name", "district_name", "address"],
                "properties": {
                    "venue_id": {"type": "string", "format": "uuid"},
                    "name": {"type": "string", "minLength": 1},
                    "district_name": {"type": "string", "minLength": 1},
                    "address": {"type": "string", "minLength": 1},
                },
            },
            "OpenGameApplyBlockedReason": {
                "type": "string",
                "enum": [
                    "AUTH_REQUIRED",
                    "OWNER_CANNOT_APPLY",
                    "ALREADY_APPLIED",
                    "GAME_NOT_PUBLISHED",
                    "REGISTRATION_DEADLINE_PASSED",
                    "GAME_FULL",
                    "GAME_SUSPENDED",
                    "GAME_CANCELLED",
                    "GAME_COMPLETED",
                    "GAME_STARTED",
                ],
            },
            "OpenGameReviewBlockedReason": {
                "type": "string",
                "enum": [
                    "APPLICATION_NOT_PENDING",
                    "GAME_SUSPENDED",
                    "GAME_CANCELLED",
                    "GAME_COMPLETED",
                    "GAME_STARTED",
                    "GAME_FULL",
                ],
            },
            "OpenGameReviewActions": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "can_accept",
                    "accept_blocked_reason",
                    "can_reject",
                    "reject_blocked_reason",
                ],
                "properties": {
                    "can_accept": {"type": "boolean"},
                    "accept_blocked_reason": {
                        "oneOf": [
                            {
                                "$ref": (
                                    "#/components/schemas/"
                                    "OpenGameReviewBlockedReason"
                                )
                            },
                            {"type": "null"},
                        ]
                    },
                    "can_reject": {"type": "boolean"},
                    "reject_blocked_reason": {
                        "oneOf": [
                            {
                                "$ref": (
                                    "#/components/schemas/"
                                    "OpenGameReviewBlockedReason"
                                )
                            },
                            {"type": "null"},
                        ]
                    },
                },
                "allOf": [
                    {
                        "oneOf": [
                            {
                                "properties": {
                                    "can_accept": {"const": True},
                                    "accept_blocked_reason": {"const": None},
                                }
                            },
                            {
                                "properties": {
                                    "can_accept": {"const": False},
                                    "accept_blocked_reason": {
                                        "$ref": (
                                            "#/components/schemas/"
                                            "OpenGameReviewBlockedReason"
                                        )
                                    },
                                }
                            },
                        ]
                    },
                    {
                        "oneOf": [
                            {
                                "properties": {
                                    "can_reject": {"const": True},
                                    "reject_blocked_reason": {"const": None},
                                }
                            },
                            {
                                "properties": {
                                    "can_reject": {"const": False},
                                    "reject_blocked_reason": {
                                        "type": "string",
                                        "enum": [
                                            "APPLICATION_NOT_PENDING",
                                            "GAME_SUSPENDED",
                                            "GAME_CANCELLED",
                                            "GAME_COMPLETED",
                                            "GAME_STARTED",
                                        ],
                                    },
                                }
                            },
                        ]
                    },
                ],
            },
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
