import logging
from typing import Any

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

logger = logging.getLogger(__name__)

_OPEN_GAME_COMMON_REVIEW_BLOCKERS = (
    "APPLICATION_NOT_PENDING",
    "GAME_SUSPENDED",
    "GAME_CANCELLED",
    "GAME_COMPLETED",
    "GAME_STARTED",
)


def open_game_review_action_matrix_schema() -> list[dict[str, Any]]:
    """Return the closed current/future read matrices for review actions."""
    matrices: list[
        tuple[bool, str | None, bool, str | None, bool, str | None]
    ] = [
        (True, None, False, "GAME_NOT_FULL", True, None),
        (False, "GAME_FULL", False, "WAITLIST_NOT_ENABLED", True, None),
        (False, "GAME_FULL", True, None, True, None),
    ]
    matrices.extend(
        (False, blocker, False, blocker, False, blocker)
        for blocker in _OPEN_GAME_COMMON_REVIEW_BLOCKERS
    )
    fields = (
        "can_accept",
        "accept_blocked_reason",
        "can_waitlist",
        "waitlist_blocked_reason",
        "can_reject",
        "reject_blocked_reason",
    )
    return [
        {
            "properties": {
                field: {"const": value}
                for field, value in zip(fields, matrix, strict=True)
            }
        }
        for matrix in matrices
    ]


class ErrorBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    message: str
    request_id: str
    details: dict[str, Any]


class ErrorEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    error: ErrorBody


def align_error_schemas_openapi(schema: dict[str, Any]) -> None:
    schema["components"]["schemas"].update(
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
                            "PUBLIC_PROFILE_REQUIRED",
                            "PUBLIC_PROFILE_CHANGED",
                            "APPLICATION_STATE_CHANGED",
                            "APPLICATION_CAPACITY_CHANGED",
                            "ATTENDANCE_STATE_CHANGED",
                            "ATTENDANCE_REGISTRATION_NOT_FOUND",
                            "REPORT_CONTEXT_NOT_FOUND",
                            "REPORTING_WINDOW_CLOSED",
                            "REPORT_ALREADY_EXISTS",
                            "SENSITIVE_CONTENT_NOT_ALLOWED",
                            "REPORT_NOT_FOUND",
                            "REPORT_RESOLUTION_STATE_CHANGED",
                            "REPORT_ALREADY_RESOLVED",
                            "ORDER_GAME_PLATFORM_CANCELLED",
                            "VENUE_STAFF_NOT_FOUND",
                            "VENUE_STAFF_STATE_CHANGED",
                            "VENUE_STAFF_INVITATION_UNAVAILABLE",
                            "VENUE_STAFF_AUTHORIZATION_DISABLED",
                            "OWNER_TRANSFER_REQUIRED",
                            "VENUE_NOT_ELIGIBLE",
                            "VENUE_INVITATION_EXISTS",
                            "VENUE_INVITATION_STATE_CHANGED",
                            "VENUE_INVITATION_NOT_FOUND",
                            "VENUE_INVITATION_UNAVAILABLE",
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
                    "REMOVED_BY_CAPTAIN",
                    "GAME_NOT_PUBLISHED",
                    "REGISTRATION_DEADLINE_PASSED",
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
            "OpenGameWaitlistBlockedReason": {
                "type": "string",
                "enum": [
                    "APPLICATION_NOT_PENDING",
                    "GAME_SUSPENDED",
                    "GAME_CANCELLED",
                    "GAME_COMPLETED",
                    "GAME_STARTED",
                    "GAME_NOT_FULL",
                    "WAITLIST_NOT_ENABLED",
                ],
            },
            "OpenGameReviewActions": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "can_accept",
                    "accept_blocked_reason",
                    "can_waitlist",
                    "waitlist_blocked_reason",
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
                    "can_waitlist": {"type": "boolean"},
                    "waitlist_blocked_reason": {
                        "oneOf": [
                            {
                                "$ref": (
                                    "#/components/schemas/"
                                    "OpenGameWaitlistBlockedReason"
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
                                    "can_waitlist": {"const": True},
                                    "waitlist_blocked_reason": {"const": None},
                                }
                            },
                            {
                                "properties": {
                                    "can_waitlist": {"const": False},
                                    "waitlist_blocked_reason": {
                                        "$ref": (
                                            "#/components/schemas/"
                                            "OpenGameWaitlistBlockedReason"
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
                    {
                        "not": {
                            "properties": {
                                "can_accept": {"const": True},
                                "can_waitlist": {"const": True},
                            }
                        }
                    },
                ],
                "oneOf": open_game_review_action_matrix_schema(),
            },
        }
    )


class AppError(Exception):
    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(code)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details or {}


def _request_id(request: Request) -> str:
    return str(request.state.request_id)


def _response(request: Request, status_code: int, code: str, message: str) -> JSONResponse:
    request_id = _request_id(request)
    return JSONResponse(
        status_code=status_code,
        headers={"X-Request-Id": request_id},
        content={
            "error": {
                "code": code,
                "message": message,
                "request_id": request_id,
                "details": {},
            }
        },
    )


async def app_error_handler(request: Request, error: Exception) -> JSONResponse:
    if not isinstance(error, AppError):
        raise TypeError("app_error_handler requires AppError")
    request_id = _request_id(request)
    return JSONResponse(
        status_code=error.status_code,
        headers={"X-Request-Id": request_id},
        content={
            "error": {
                "code": error.code,
                "message": error.message,
                "request_id": request_id,
                "details": error.details,
            }
        },
    )


async def request_validation_error_handler(
    request: Request,
    error: Exception,
) -> JSONResponse:
    if not isinstance(error, RequestValidationError):
        raise TypeError(
            "request_validation_error_handler requires RequestValidationError"
        )
    return _response(
        request,
        422,
        "INVALID_ARGUMENT",
        "请求参数格式不正确，请检查后重试。",
    )


async def unexpected_error_handler(request: Request, _error: Exception) -> JSONResponse:
    logger.error("Unhandled request error request_id=%s", _request_id(request))
    return _response(request, 500, "INTERNAL_ERROR", "服务内部错误")
