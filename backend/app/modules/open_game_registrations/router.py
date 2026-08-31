"""HTTP routes for applicant and captain open-game registration journeys."""

import re
import uuid
from collections.abc import Callable
from contextlib import suppress
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from backend.app.database import get_database
from backend.app.errors import (
    AppError,
    ErrorEnvelope,
    app_error_handler,
    open_game_review_action_matrix_schema,
)
from backend.app.models import User
from backend.app.modules.auth.repository import AuthRepository
from backend.app.modules.auth.service import resolve_authenticated_user
from backend.app.modules.open_game_registrations.dto import (
    CreateApplicationRequest,
    DecisionRequest,
    DecisionResult,
    MyOpenGameApplicationsResponse,
    OpenGameAttendanceMarkRequest,
    OpenGameAttendanceMarkResult,
    OpenGameAttendanceRoster,
    OpenGameMemberRemovalRequest,
    OpenGameMemberRemovalResult,
    OpenGameMemberRoster,
    Queue,
    RegistrationContext,
    WithdrawalRequest,
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
_WITHDRAWAL_PATH = re.compile(
    r"^/api/v1/open-game-applications/[^/]+/withdraw$"
)
_ATTENDANCE_PATH = re.compile(
    r"^/api/v1/games/[^/]+/registrations/[^/]+/attendance$"
)
_MEMBER_REMOVAL_PATH = re.compile(
    r"^/api/v1/games/[^/]+/members/[^/]+/remove$"
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
_WITHDRAWAL_FIELDS = frozenset({"action", "expected_version"})
_ATTENDANCE_FIELDS = frozenset({"attendance_status", "expected_version"})
_MEMBER_REMOVAL_FIELDS = frozenset({"expected_version", "reason"})
_INVALID_ARGUMENT_EXAMPLE = {
    "error": {
        "code": "INVALID_ARGUMENT",
        "message": "请求参数格式不正确，请检查后重试。",
        "request_id": "req_contract_invalid_argument_001",
        "details": {"field": "date"},
    }
}


def _utc_now() -> datetime:
    return datetime.now(UTC)


def get_open_game_registration_clock() -> Callable[[], datetime]:
    return _utc_now


def align_my_open_game_applications_openapi(schema: dict[str, Any]) -> None:
    request_id_header = {"$ref": "#/components/headers/RequestId"}

    def require_attendance_operation(
        path: str,
        method: str,
    ) -> dict[str, Any]:
        paths = schema.get("paths")
        path_item = paths.get(path) if isinstance(paths, dict) else None
        operation = path_item.get(method) if isinstance(path_item, dict) else None
        if not isinstance(operation, dict):
            raise RuntimeError(
                "raw OpenAPI attendance operation is missing: "
                f"{method.upper()} {path}"
            )
        return operation

    def require_member_operation(path: str, method: str) -> dict[str, Any]:
        paths = schema.get("paths")
        path_item = paths.get(path) if isinstance(paths, dict) else None
        operation = path_item.get(method) if isinstance(path_item, dict) else None
        if not isinstance(operation, dict):
            raise RuntimeError(
                "raw OpenAPI member operation is missing: "
                f"{method.upper()} {path}"
            )
        return operation

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
    error_codes = (
        components["schemas"].get("Error", {})
        .get("properties", {})
        .get("code", {})
        .get("enum")
    )
    if (
        isinstance(error_codes, list)
        and "ATTENDANCE_STATE_CHANGED" not in error_codes
    ):
        error_codes.append("ATTENDANCE_STATE_CHANGED")
    shared_error_schemas = {
        name: components["schemas"].get(name)
        for name in (
            "OpenGameApplyBlockedReason",
            "OpenGameReviewBlockedReason",
            "OpenGameWaitlistBlockedReason",
            "OpenGameReviewActions",
        )
    }
    components["schemas"].update(
        {
            "OpenGameRegistrationPosition": {
                "type": "string",
                "enum": [
                    "GOALKEEPER",
                    "DEFENDER",
                    "MIDFIELDER",
                    "FORWARD",
                    "ANY",
                ],
            },
            "OpenGameRegistrationPersistedStatus": {
                "type": "string",
                "enum": [
                    "APPLIED",
                    "WAITLISTED",
                    "JOINED",
                    "REJECTED",
                    "WITHDRAWN",
                    "REMOVED",
                ],
            },
            "OpenGameRegistrationEffectiveStatus": {
                "type": "string",
                "enum": [
                    "APPLIED",
                    "WAITLISTED",
                    "JOINED",
                    "REJECTED",
                    "WITHDRAWN",
                    "REMOVED",
                    "CANCELLED",
                ],
            },
            "OpenGameRegistrationWithdrawalKind": {
                "type": "string",
                "enum": [
                    "APPLICATION_WITHDRAWAL",
                    "WAITLIST_WITHDRAWAL",
                    "GAME_EXIT",
                ],
            },
            "OpenGameRegistrationAvailableWithdrawalAction": {
                "type": "string",
                "enum": [
                    "WITHDRAW_APPLICATION",
                    "WITHDRAW_WAITLIST",
                    "LEAVE_GAME",
                ],
            },
            "OpenGameRegistrationWithdrawalAction": {
                "type": "string",
                "enum": [
                    "WITHDRAW_APPLICATION",
                    "WITHDRAW_WAITLIST",
                    "LEAVE_GAME",
                ],
            },
            "OpenGameAttendanceStatus": {
                "type": "string",
                "enum": ["UNMARKED", "PRESENT", "NO_SHOW"],
            },
            "OpenGameApplyBlockedReason": {
                "type": "string",
                "enum": [
                    "AUTH_REQUIRED",
                    "OWNER_CANNOT_APPLY",
                    "ALREADY_APPLIED",
                    "GAME_NOT_PUBLISHED",
                    "REGISTRATION_DEADLINE_PASSED",
                    "GAME_SUSPENDED",
                    "GAME_CANCELLED",
                    "GAME_COMPLETED",
                    "GAME_STARTED",
                ],
            },
            "OpenGameApplyActions": {
                "type": "object",
                "additionalProperties": False,
                "required": ["can_apply", "apply_blocked_reason"],
                "properties": {
                    "can_apply": {"type": "boolean"},
                    "apply_blocked_reason": {
                        "oneOf": [
                            {
                                "$ref": (
                                    "#/components/schemas/"
                                    "OpenGameApplyBlockedReason"
                                )
                            },
                            {"type": "null"},
                        ]
                    },
                },
                "oneOf": [
                    {
                        "properties": {
                            "can_apply": {"const": True},
                            "apply_blocked_reason": {"const": None},
                        }
                    },
                    {
                        "properties": {
                            "can_apply": {"const": False},
                            "apply_blocked_reason": {
                                "$ref": (
                                    "#/components/schemas/"
                                    "OpenGameApplyBlockedReason"
                                )
                            },
                        }
                    },
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
            "OpenGameViewerRegistration": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "id",
                    "display_name",
                    "position",
                    "note",
                    "persisted_status",
                    "effective_status",
                    "version",
                    "applied_at",
                    "decided_at",
                    "withdrawn_at",
                    "withdrawal_kind",
                    "late_exit_recorded",
                    "available_withdrawal_action",
                    "late_exit_will_be_recorded",
                    "waitlist_position",
                    "waitlisted_at",
                    "promoted_at",
                    "attendance_status",
                    "attendance_recorded_at",
                    "attendance_corrected_at",
                    "removed_at",
                ],
                "properties": {
                    "id": {"type": "string", "format": "uuid"},
                    "display_name": {
                        "type": "string",
                        "minLength": 2,
                        "maxLength": 24,
                    },
                    "position": {
                        "$ref": (
                            "#/components/schemas/"
                            "OpenGameRegistrationPosition"
                        )
                    },
                    "note": {
                        "type": ["string", "null"],
                        "maxLength": 120,
                    },
                    "persisted_status": {
                        "$ref": (
                            "#/components/schemas/"
                            "OpenGameRegistrationPersistedStatus"
                        )
                    },
                    "effective_status": {
                        "$ref": (
                            "#/components/schemas/"
                            "OpenGameRegistrationEffectiveStatus"
                        )
                    },
                    "version": {"type": "integer", "minimum": 1},
                    "applied_at": {"type": "string", "format": "date-time"},
                    "decided_at": {
                        "type": ["string", "null"],
                        "format": "date-time",
                    },
                    "withdrawn_at": {
                        "type": ["string", "null"],
                        "format": "date-time",
                    },
                    "withdrawal_kind": {
                        "oneOf": [
                            {
                                "$ref": (
                                    "#/components/schemas/"
                                    "OpenGameRegistrationWithdrawalKind"
                                )
                            },
                            {"type": "null"},
                        ]
                    },
                    "late_exit_recorded": {"type": "boolean"},
                    "available_withdrawal_action": {
                        "oneOf": [
                            {
                                "$ref": (
                                    "#/components/schemas/"
                                    "OpenGameRegistrationAvailableWithdrawalAction"
                                )
                            },
                            {"type": "null"},
                        ]
                    },
                    "late_exit_will_be_recorded": {"type": "boolean"},
                    "waitlist_position": {
                        "type": ["integer", "null"],
                        "minimum": 1,
                    },
                    "waitlisted_at": {
                        "type": ["string", "null"],
                        "format": "date-time",
                    },
                    "promoted_at": {
                        "type": ["string", "null"],
                        "format": "date-time",
                    },
                    "attendance_status": {
                        "oneOf": [
                            {
                                "$ref": (
                                    "#/components/schemas/"
                                    "OpenGameAttendanceStatus"
                                )
                            },
                            {"type": "null"},
                        ]
                    },
                    "attendance_recorded_at": {
                        "type": ["string", "null"],
                        "format": "date-time",
                    },
                    "attendance_corrected_at": {
                        "type": ["string", "null"],
                        "format": "date-time",
                    },
                    "removed_at": {
                        "type": ["string", "null"],
                        "format": "date-time",
                    },
                },
                "oneOf": [
                    {
                        "properties": {
                            "attendance_status": {"const": None},
                            "attendance_recorded_at": {"const": None},
                            "attendance_corrected_at": {"const": None},
                        }
                    },
                    {
                        "properties": {
                            "attendance_status": {"const": "UNMARKED"},
                            "attendance_recorded_at": {"const": None},
                            "attendance_corrected_at": {"const": None},
                        }
                    },
                    {
                        "properties": {
                            "attendance_status": {
                                "enum": ["PRESENT", "NO_SHOW"]
                            },
                            "attendance_recorded_at": {
                                "type": "string",
                                "format": "date-time",
                            },
                            "attendance_corrected_at": {
                                "type": ["string", "null"],
                                "format": "date-time",
                            },
                        }
                    },
                ],
            },
            "OpenGameRegistrationContext": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "game",
                    "remaining_spots",
                    "viewer_authenticated",
                    "viewer_registration",
                    "allowed_actions",
                ],
                "properties": {
                    "game": {"$ref": "#/components/schemas/OpenGamePublic"},
                    "remaining_spots": {"type": "integer", "minimum": 0},
                    "viewer_authenticated": {"type": "boolean"},
                    "viewer_registration": {
                        "oneOf": [
                            {
                                "$ref": (
                                    "#/components/schemas/"
                                    "OpenGameViewerRegistration"
                                )
                            },
                            {"type": "null"},
                        ]
                    },
                    "allowed_actions": {
                        "$ref": "#/components/schemas/OpenGameApplyActions"
                    },
                },
            },
            "CreateOpenGameApplicationRequest": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "display_name",
                    "position",
                    "note",
                    "adult_confirmed",
                    "risk_confirmed",
                ],
                "properties": {
                    "display_name": {
                        "type": "string",
                        "minLength": 2,
                        "maxLength": 24,
                    },
                    "position": {
                        "$ref": (
                            "#/components/schemas/"
                            "OpenGameRegistrationPosition"
                        )
                    },
                    "note": {"type": ["string", "null"], "maxLength": 120},
                    "adult_confirmed": {"type": "boolean", "const": True},
                    "risk_confirmed": {"type": "boolean", "const": True},
                },
            },
            "CaptainOpenGameApplication": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "id",
                    "display_name",
                    "position",
                    "note",
                    "applied_at",
                    "version",
                    "allowed_actions",
                ],
                "properties": {
                    "id": {"type": "string", "format": "uuid"},
                    "display_name": {
                        "type": "string",
                        "minLength": 2,
                        "maxLength": 24,
                    },
                    "position": {
                        "$ref": (
                            "#/components/schemas/"
                            "OpenGameRegistrationPosition"
                        )
                    },
                    "note": {"type": ["string", "null"], "maxLength": 120},
                    "applied_at": {"type": "string", "format": "date-time"},
                    "version": {"type": "integer", "minimum": 1},
                    "allowed_actions": {
                        "$ref": "#/components/schemas/OpenGameReviewActions"
                    },
                },
            },
            "CaptainOpenGameWaitlistApplication": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "id",
                    "display_name",
                    "position",
                    "note",
                    "applied_at",
                    "waitlisted_at",
                    "waitlist_position",
                ],
                "properties": {
                    "id": {"type": "string", "format": "uuid"},
                    "display_name": {
                        "type": "string",
                        "minLength": 2,
                        "maxLength": 24,
                    },
                    "position": {
                        "$ref": (
                            "#/components/schemas/"
                            "OpenGameRegistrationPosition"
                        )
                    },
                    "note": {"type": ["string", "null"], "maxLength": 120},
                    "applied_at": {"type": "string", "format": "date-time"},
                    "waitlisted_at": {
                        "type": "string",
                        "format": "date-time",
                    },
                    "waitlist_position": {"type": "integer", "minimum": 1},
                },
            },
            "OpenGameApplicationQueue": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "remaining_spots",
                    "pending_count",
                    "applications",
                    "waitlist_count",
                    "waitlist",
                ],
                "properties": {
                    "remaining_spots": {"type": "integer", "minimum": 0},
                    "pending_count": {"type": "integer", "minimum": 0},
                    "applications": {
                        "type": "array",
                        "items": {
                            "$ref": (
                                "#/components/schemas/"
                                "CaptainOpenGameApplication"
                            )
                        },
                    },
                    "waitlist_count": {"type": "integer", "minimum": 0},
                    "waitlist": {
                        "type": "array",
                        "items": {
                            "$ref": (
                                "#/components/schemas/"
                                "CaptainOpenGameWaitlistApplication"
                            )
                        },
                    },
                },
            },
            "OpenGameApplicationDecisionRequest": {
                "type": "object",
                "additionalProperties": False,
                "required": ["decision", "expected_version"],
                "properties": {
                    "decision": {
                        "type": "string",
                        "enum": ["ACCEPT", "REJECT", "WAITLIST"],
                    },
                    "expected_version": {"type": "integer", "minimum": 1},
                },
            },
            "OpenGameApplicationDecisionResult": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "application_id",
                    "status",
                    "version",
                    "decided_at",
                    "remaining_spots",
                    "allowed_actions",
                ],
                "properties": {
                    "application_id": {"type": "string", "format": "uuid"},
                    "status": {
                        "type": "string",
                        "enum": ["WAITLISTED", "JOINED", "REJECTED"],
                    },
                    "version": {"type": "integer", "minimum": 1},
                    "decided_at": {
                        "type": ["string", "null"],
                        "format": "date-time",
                    },
                    "remaining_spots": {"type": "integer", "minimum": 0},
                    "allowed_actions": {
                        "$ref": "#/components/schemas/OpenGameReviewActions"
                    },
                },
            },
            "OpenGameApplicationWithdrawalRequest": {
                "type": "object",
                "additionalProperties": False,
                "required": ["action", "expected_version"],
                "properties": {
                    "action": {
                        "$ref": (
                            "#/components/schemas/"
                            "OpenGameRegistrationWithdrawalAction"
                        )
                    },
                    "expected_version": {
                        "type": "integer",
                        "minimum": 1,
                    },
                },
            },
            "OpenGameAttendanceGameSummary": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "id",
                    "name",
                    "venue_name",
                    "pitch_name",
                    "starts_at",
                    "ends_at",
                    "time_zone",
                    "state",
                ],
                "properties": {
                    "id": {"type": "string", "format": "uuid"},
                    "name": {
                        "type": "string",
                        "minLength": 2,
                        "maxLength": 30,
                    },
                    "venue_name": {"type": "string", "minLength": 1},
                    "pitch_name": {"type": "string", "minLength": 1},
                    "starts_at": {"type": "string", "format": "date-time"},
                    "ends_at": {"type": "string", "format": "date-time"},
                    "time_zone": {"type": "string"},
                    "state": {"type": "string", "const": "COMPLETED"},
                },
            },
            "OpenGameAttendanceRosterItem": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "registration_id",
                    "display_name",
                    "position",
                    "attendance_status",
                    "attendance_recorded_at",
                    "attendance_corrected_at",
                    "version",
                ],
                "properties": {
                    "registration_id": {"type": "string", "format": "uuid"},
                    "display_name": {
                        "type": "string",
                        "minLength": 2,
                        "maxLength": 24,
                    },
                    "position": {
                        "$ref": (
                            "#/components/schemas/"
                            "OpenGameRegistrationPosition"
                        )
                    },
                    "attendance_status": {
                        "$ref": "#/components/schemas/OpenGameAttendanceStatus"
                    },
                    "attendance_recorded_at": {
                        "type": ["string", "null"],
                        "format": "date-time",
                    },
                    "attendance_corrected_at": {
                        "type": ["string", "null"],
                        "format": "date-time",
                    },
                    "version": {"type": "integer", "minimum": 1},
                },
                "oneOf": [
                    {
                        "properties": {
                            "attendance_status": {"const": "UNMARKED"},
                            "attendance_recorded_at": {"const": None},
                            "attendance_corrected_at": {"const": None},
                        }
                    },
                    {
                        "properties": {
                            "attendance_status": {
                                "enum": ["PRESENT", "NO_SHOW"]
                            },
                            "attendance_recorded_at": {
                                "type": "string",
                                "format": "date-time",
                            },
                            "attendance_corrected_at": {
                                "type": ["string", "null"],
                                "format": "date-time",
                            },
                        }
                    },
                ],
            },
            "OpenGameAttendanceRoster": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "game",
                    "recorded_count",
                    "total_count",
                    "attendance_complete",
                    "registrations",
                ],
                "properties": {
                    "game": {
                        "$ref": (
                            "#/components/schemas/"
                            "OpenGameAttendanceGameSummary"
                        )
                    },
                    "recorded_count": {"type": "integer", "minimum": 0},
                    "total_count": {"type": "integer", "minimum": 0},
                    "attendance_complete": {"type": "boolean"},
                    "registrations": {
                        "type": "array",
                        "items": {
                            "$ref": (
                                "#/components/schemas/"
                                "OpenGameAttendanceRosterItem"
                            )
                        },
                    },
                },
            },
            "OpenGameAttendanceMarkRequest": {
                "type": "object",
                "additionalProperties": False,
                "required": ["attendance_status", "expected_version"],
                "properties": {
                    "attendance_status": {
                        "type": "string",
                        "enum": ["PRESENT", "NO_SHOW"],
                    },
                    "expected_version": {"type": "integer", "minimum": 1},
                },
            },
            "OpenGameAttendanceMarkResult": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "registration_id",
                    "attendance_status",
                    "attendance_recorded_at",
                    "version",
                    "recorded_count",
                    "total_count",
                    "attendance_complete",
                ],
                "properties": {
                    "registration_id": {"type": "string", "format": "uuid"},
                    "attendance_status": {
                        "type": "string",
                        "enum": ["PRESENT", "NO_SHOW"],
                    },
                    "attendance_recorded_at": {
                        "type": "string",
                        "format": "date-time",
                    },
                    "version": {"type": "integer", "minimum": 2},
                    "recorded_count": {"type": "integer", "minimum": 1},
                    "total_count": {"type": "integer", "minimum": 1},
                    "attendance_complete": {"type": "boolean"},
                },
            },
            "OpenGameMemberRemovalBlockedReason": {
                "type": "string",
                "enum": [
                    "GAME_NOT_PUBLISHED",
                    "GAME_SUSPENDED",
                    "GAME_CANCELLED",
                    "GAME_COMPLETED",
                    "GAME_STARTED",
                    "ORDER_AUTHORITY_UNHEALTHY",
                    "ATTENDANCE_RECORDED",
                ],
            },
            "OpenGameMemberRemovalActions": {
                "type": "object",
                "additionalProperties": False,
                "required": ["can_remove", "remove_blocked_reason"],
                "properties": {
                    "can_remove": {"type": "boolean"},
                    "remove_blocked_reason": {
                        "oneOf": [
                            {
                                "$ref": (
                                    "#/components/schemas/"
                                    "OpenGameMemberRemovalBlockedReason"
                                )
                            },
                            {"type": "null"},
                        ]
                    },
                },
                "oneOf": [
                    {
                        "properties": {
                            "can_remove": {"const": True},
                            "remove_blocked_reason": {"const": None},
                        }
                    },
                    {
                        "properties": {
                            "can_remove": {"const": False},
                            "remove_blocked_reason": {
                                "$ref": (
                                    "#/components/schemas/"
                                    "OpenGameMemberRemovalBlockedReason"
                                )
                            },
                        }
                    },
                ],
            },
            "OpenGameMemberGameSummary": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "id",
                    "name",
                    "venue_name",
                    "pitch_name",
                    "starts_at",
                    "ends_at",
                    "time_zone",
                    "state",
                ],
                "properties": {
                    "id": {"type": "string", "format": "uuid"},
                    "name": {
                        "type": "string",
                        "minLength": 2,
                        "maxLength": 30,
                    },
                    "venue_name": {"type": "string", "minLength": 1},
                    "pitch_name": {"type": "string", "minLength": 1},
                    "starts_at": {"type": "string", "format": "date-time"},
                    "ends_at": {"type": "string", "format": "date-time"},
                    "time_zone": {"type": "string"},
                    "state": {
                        "type": "string",
                        "enum": [
                            "DRAFT",
                            "PUBLISHED",
                            "SUSPENDED",
                            "CANCELLED",
                            "COMPLETED",
                        ],
                    },
                },
            },
            "OpenGameMemberRosterItem": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "registration_id",
                    "display_name",
                    "position",
                    "joined_at",
                    "promoted_from_waitlist",
                    "version",
                    "allowed_actions",
                ],
                "properties": {
                    "registration_id": {"type": "string", "format": "uuid"},
                    "display_name": {
                        "type": "string",
                        "minLength": 2,
                        "maxLength": 24,
                    },
                    "position": {
                        "$ref": (
                            "#/components/schemas/"
                            "OpenGameRegistrationPosition"
                        )
                    },
                    "joined_at": {"type": "string", "format": "date-time"},
                    "promoted_from_waitlist": {"type": "boolean"},
                    "version": {"type": "integer", "minimum": 1},
                    "allowed_actions": {
                        "$ref": (
                            "#/components/schemas/"
                            "OpenGameMemberRemovalActions"
                        )
                    },
                },
            },
            "OpenGameMemberRoster": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "game",
                    "joined_count",
                    "remaining_spots",
                    "waitlist_count",
                    "members",
                ],
                "properties": {
                    "game": {
                        "$ref": (
                            "#/components/schemas/"
                            "OpenGameMemberGameSummary"
                        )
                    },
                    "joined_count": {"type": "integer", "minimum": 0},
                    "remaining_spots": {"type": "integer", "minimum": 0},
                    "waitlist_count": {"type": "integer", "minimum": 0},
                    "members": {
                        "type": "array",
                        "items": {
                            "$ref": (
                                "#/components/schemas/"
                                "OpenGameMemberRosterItem"
                            )
                        },
                    },
                },
            },
            "OpenGameMemberRemovalRequest": {
                "type": "object",
                "additionalProperties": False,
                "required": ["expected_version", "reason"],
                "properties": {
                    "expected_version": {"type": "integer", "minimum": 1},
                    "reason": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 120,
                    },
                },
            },
            "OpenGamePromotedMember": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "registration_id",
                    "display_name",
                    "position",
                    "version",
                ],
                "properties": {
                    "registration_id": {"type": "string", "format": "uuid"},
                    "display_name": {
                        "type": "string",
                        "minLength": 2,
                        "maxLength": 24,
                    },
                    "position": {
                        "$ref": (
                            "#/components/schemas/"
                            "OpenGameRegistrationPosition"
                        )
                    },
                    "version": {"type": "integer", "minimum": 2},
                },
            },
            "OpenGameMemberRemovalResult": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "removed_registration_id",
                    "removed_display_name",
                    "status",
                    "version",
                    "removed_at",
                    "joined_count",
                    "remaining_spots",
                    "waitlist_count",
                    "promoted_member",
                ],
                "properties": {
                    "removed_registration_id": {
                        "type": "string",
                        "format": "uuid",
                    },
                    "removed_display_name": {
                        "type": "string",
                        "minLength": 2,
                        "maxLength": 24,
                    },
                    "status": {"type": "string", "const": "REMOVED"},
                    "version": {"type": "integer", "minimum": 2},
                    "removed_at": {"type": "string", "format": "date-time"},
                    "joined_count": {"type": "integer", "minimum": 0},
                    "remaining_spots": {"type": "integer", "minimum": 0},
                    "waitlist_count": {"type": "integer", "minimum": 0},
                    "promoted_member": {
                        "oneOf": [
                            {
                                "$ref": (
                                    "#/components/schemas/"
                                    "OpenGamePromotedMember"
                                )
                            },
                            {"type": "null"},
                        ]
                    },
                },
            },
            "MyOpenGameApplication": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "id",
                    "effective_status",
                    "applied_at",
                    "waitlist_position",
                    "waitlisted_at",
                    "promoted_at",
                    "attendance_status",
                    "attendance_recorded_at",
                    "attendance_corrected_at",
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
                    "waitlist_position": {
                        "type": ["integer", "null"],
                        "minimum": 1,
                    },
                    "waitlisted_at": {
                        "type": ["string", "null"],
                        "format": "date-time",
                    },
                    "promoted_at": {
                        "type": ["string", "null"],
                        "format": "date-time",
                    },
                    "attendance_status": {
                        "oneOf": [
                            {
                                "$ref": (
                                    "#/components/schemas/"
                                    "OpenGameAttendanceStatus"
                                )
                            },
                            {"type": "null"},
                        ]
                    },
                    "attendance_recorded_at": {
                        "type": ["string", "null"],
                        "format": "date-time",
                    },
                    "attendance_corrected_at": {
                        "type": ["string", "null"],
                        "format": "date-time",
                    },
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
                "oneOf": [
                    {
                        "properties": {
                            "attendance_status": {"const": None},
                            "attendance_recorded_at": {"const": None},
                            "attendance_corrected_at": {"const": None},
                        }
                    },
                    {
                        "properties": {
                            "attendance_status": {"const": "UNMARKED"},
                            "attendance_recorded_at": {"const": None},
                            "attendance_corrected_at": {"const": None},
                        }
                    },
                    {
                        "properties": {
                            "attendance_status": {
                                "enum": ["PRESENT", "NO_SHOW"]
                            },
                            "attendance_recorded_at": {
                                "type": "string",
                                "format": "date-time",
                            },
                            "attendance_corrected_at": {
                                "type": ["string", "null"],
                                "format": "date-time",
                            },
                        }
                    },
                ],
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
    for name, shared_schema in shared_error_schemas.items():
        if shared_schema is not None:
            components["schemas"][name] = shared_schema

    context_ref = {"$ref": "#/components/schemas/OpenGameRegistrationContext"}
    context_operation = schema["paths"].get(
        "/api/v1/shared-games/{share_token}/registration-context"
    )
    if context_operation is not None:
        context_operation["get"]["responses"]["200"]["content"][
            "application/json"
        ]["schema"] = context_ref
    apply_operation = schema["paths"].get(
        "/api/v1/shared-games/{share_token}/applications"
    )
    if apply_operation is not None:
        apply_operation["post"]["responses"]["201"]["content"][
            "application/json"
        ]["schema"] = dict(context_ref)
        apply_operation["post"]["requestBody"]["content"]["application/json"][
            "schema"
        ] = {
            "$ref": "#/components/schemas/CreateOpenGameApplicationRequest"
        }
    queue_operation = schema["paths"].get(
        "/api/v1/games/{game_id}/applications"
    )
    if queue_operation is not None:
        queue_operation["get"]["responses"]["200"]["content"][
            "application/json"
        ]["schema"] = {
            "$ref": "#/components/schemas/OpenGameApplicationQueue"
        }
    decision_operation = schema["paths"].get(
        "/api/v1/games/{game_id}/applications/{application_id}/decision"
    )
    if decision_operation is not None:
        decision_post = decision_operation["post"]
        decision_post["requestBody"]["content"]["application/json"]["schema"] = {
            "$ref": "#/components/schemas/OpenGameApplicationDecisionRequest"
        }
        decision_post["responses"]["200"]["content"]["application/json"][
            "schema"
        ] = {
            "$ref": "#/components/schemas/OpenGameApplicationDecisionResult"
        }
    withdrawal_path = (
        "/api/v1/open-game-applications/{application_id}/withdraw"
    )
    if withdrawal_path in schema["paths"]:
        conflict = error_response(
            "Registration state, version, action, or idempotency authority changed.",
            code="APPLICATION_STATE_CHANGED",
            example_name="ApplicationStateChanged",
            example_file="error-application-state-changed.json",
        )
        conflict_content = conflict["content"]["application/json"]
        conflict_content["schema"] = {
            "allOf": [
                {"$ref": "#/components/schemas/ErrorEnvelope"},
                {
                    "type": "object",
                    "properties": {
                        "error": {
                            "oneOf": [
                                {
                                    "type": "object",
                                    "properties": {
                                        "code": {
                                            "const": "APPLICATION_STATE_CHANGED"
                                        }
                                    },
                                },
                                {
                                    "type": "object",
                                    "properties": {
                                        "code": {
                                            "const": "IDEMPOTENCY_KEY_REUSED"
                                        }
                                    },
                                },
                            ]
                        }
                    },
                },
            ]
        }
        conflict_content["examples"] = {
            "ApplicationStateChanged": {
                "externalValue": "./examples/error-application-state-changed.json"
            },
            "IdempotencyKeyReused": {
                "externalValue": "./examples/error-idempotency-key-reused.json"
            },
        }
        schema["paths"][withdrawal_path]["post"] = {
            "operationId": "withdrawOpenGameApplication",
            "description": (
                "Withdraw the current user's pending application or waitlist "
                "entry, or leave a joined game."
            ),
            "security": [{"bearerAuth": []}],
            "parameters": [
                {
                    "name": "application_id",
                    "in": "path",
                    "required": True,
                    "schema": {"type": "string", "format": "uuid"},
                },
                {"$ref": "#/components/parameters/IdempotencyKey"},
            ],
            "requestBody": {
                "required": True,
                "content": {
                    "application/json": {
                        "schema": {
                            "$ref": (
                                "#/components/schemas/"
                                "OpenGameApplicationWithdrawalRequest"
                            )
                        }
                    }
                },
            },
            "responses": {
                "200": {
                    "description": (
                        "Registration withdrawn or idempotently replayed with "
                        "authoritative viewer context."
                    ),
                    "headers": {"X-Request-Id": request_id_header},
                    "content": {
                        "application/json": {
                            "schema": dict(context_ref),
                            "examples": {
                                "ApplicationWithdrawn": {
                                    "externalValue": (
                                        "./examples/"
                                        "open-game-registration-context-"
                                        "withdrawn-application.json"
                                    )
                                },
                                "WaitlistWithdrawn": {
                                    "externalValue": (
                                        "./examples/"
                                        "open-game-registration-context-"
                                        "withdrawn-waitlist.json"
                                    )
                                },
                                "GameExited": {
                                    "externalValue": (
                                        "./examples/"
                                        "open-game-registration-context-"
                                        "withdrawn-game-exit.json"
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
                "404": error_response(
                    (
                        "The application is absent or does not belong to the "
                        "current user."
                    ),
                    code="APPLICATION_NOT_FOUND",
                    example_name="ApplicationNotFound",
                    example_file="error-application-not-found.json",
                ),
                "409": conflict,
                "422": error_response(
                    (
                        "Path, action, expected version, or idempotency key is "
                        "invalid."
                    ),
                    code="INVALID_ARGUMENT",
                    example_name="InvalidArgument",
                    example_file="error-invalid-argument.json",
                ),
                "503": error_response(
                    "Open game application service is unavailable.",
                    code="SERVICE_UNAVAILABLE",
                    example_name="ServiceUnavailable",
                    example_file="error-service-unavailable.json",
                ),
            },
        }

    member_roster_path = "/api/v1/games/{game_id}/members"
    member_roster_operation = require_member_operation(member_roster_path, "get")
    member_roster_operation.clear()
    member_roster_operation.update(
        {
            "operationId": "getOpenGameMemberRoster",
            "description": (
                "Owner-only current joined-member roster and "
                "server-authoritative removal eligibility."
            ),
            "security": [{"bearerAuth": []}],
            "parameters": [
                {
                    "name": "game_id",
                    "in": "path",
                    "required": True,
                    "schema": {"type": "string", "format": "uuid"},
                }
            ],
            "responses": {
                "200": {
                    "description": "Minimal current joined-member roster.",
                    "headers": {"X-Request-Id": request_id_header},
                    "content": {
                        "application/json": {
                            "schema": {
                                "$ref": (
                                    "#/components/schemas/"
                                    "OpenGameMemberRoster"
                                )
                            },
                            "examples": {
                                "Ready": {
                                    "externalValue": (
                                        "./examples/"
                                        "open-game-member-roster-ready.json"
                                    )
                                },
                                "Blocked": {
                                    "externalValue": (
                                        "./examples/"
                                        "open-game-member-roster-blocked.json"
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
                "404": error_response(
                    "Game does not exist or is not owned by this user.",
                    code="OPEN_GAME_NOT_FOUND",
                    example_name="OpenGameNotFound",
                    example_file="error-open-game-not-found.json",
                ),
                "422": error_response(
                    "Game identifier is invalid.",
                    code="INVALID_ARGUMENT",
                    example_name="InvalidArgument",
                    example_file="error-invalid-argument.json",
                ),
                "503": error_response(
                    "Open game member service is unavailable.",
                    code="SERVICE_UNAVAILABLE",
                    example_name="ServiceUnavailable",
                    example_file="error-service-unavailable.json",
                ),
            },
        }
    )

    member_not_found = error_response(
        (
            "Game or registration does not exist, or the game is not owned "
            "by this user."
        ),
        code="APPLICATION_NOT_FOUND",
        example_name="ApplicationNotFound",
        example_file="error-application-not-found.json",
    )
    member_not_found["content"]["application/json"]["schema"] = {
        "allOf": [
            {"$ref": "#/components/schemas/ErrorEnvelope"},
            {
                "type": "object",
                "properties": {
                    "error": {
                        "type": "object",
                        "properties": {
                            "code": {
                                "enum": [
                                    "APPLICATION_NOT_FOUND",
                                    "OPEN_GAME_NOT_FOUND",
                                ]
                            }
                        },
                    }
                },
            },
        ]
    }
    member_not_found["content"]["application/json"]["examples"] = {
        "ApplicationNotFound": {
            "externalValue": "./examples/error-application-not-found.json"
        },
        "OpenGameNotFound": {
            "externalValue": "./examples/error-open-game-not-found.json"
        },
    }
    member_conflict = error_response(
        "Registration state, game authority, or idempotency authority changed.",
        code="APPLICATION_STATE_CHANGED",
        example_name="ApplicationStateChanged",
        example_file="error-application-state-changed.json",
    )
    member_conflict["content"]["application/json"]["schema"] = {
        "allOf": [
            {"$ref": "#/components/schemas/ErrorEnvelope"},
            {
                "type": "object",
                "properties": {
                    "error": {
                        "type": "object",
                        "properties": {
                            "code": {
                                "enum": [
                                    "APPLICATION_STATE_CHANGED",
                                    "IDEMPOTENCY_KEY_REUSED",
                                ]
                            }
                        },
                    }
                },
            },
        ]
    }
    member_conflict["content"]["application/json"]["examples"] = {
        "ApplicationStateChanged": {
            "externalValue": "./examples/error-application-state-changed.json"
        },
        "IdempotencyKeyReused": {
            "externalValue": "./examples/error-idempotency-key-reused.json"
        },
    }
    member_remove_path = (
        "/api/v1/games/{game_id}/members/{registration_id}/remove"
    )
    member_remove_operation = require_member_operation(member_remove_path, "post")
    member_idempotency_parameters = [
        parameter
        for parameter in member_remove_operation.get("parameters", [])
        if isinstance(parameter, dict)
        and parameter.get("name") == "Idempotency-Key"
    ]
    if len(member_idempotency_parameters) != 1:
        raise RuntimeError(
            "raw OpenAPI member remove operation is missing Idempotency-Key"
        )
    member_idempotency = member_idempotency_parameters[0]
    member_idempotency_schema = member_idempotency.get("schema")
    if (
        member_idempotency.get("in") != "header"
        or member_idempotency.get("required") is not True
        or not isinstance(member_idempotency_schema, dict)
        or member_idempotency_schema.get("type") != "string"
        or member_idempotency_schema.get("minLength") != 16
        or member_idempotency_schema.get("maxLength") != 128
    ):
        raise RuntimeError(
            "raw OpenAPI member remove Idempotency-Key contract is invalid"
        )
    member_remove_operation.clear()
    member_remove_operation.update(
        {
            "operationId": "removeOpenGameMember",
            "description": (
                "Owner-only idempotent removal of one eligible joined member "
                "before kickoff."
            ),
            "security": [{"bearerAuth": []}],
            "parameters": [
                {
                    "name": "game_id",
                    "in": "path",
                    "required": True,
                    "schema": {"type": "string", "format": "uuid"},
                },
                {
                    "name": "registration_id",
                    "in": "path",
                    "required": True,
                    "schema": {"type": "string", "format": "uuid"},
                },
                {"$ref": "#/components/parameters/IdempotencyKey"},
            ],
            "requestBody": {
                "required": True,
                "content": {
                    "application/json": {
                        "schema": {
                            "$ref": (
                                "#/components/schemas/"
                                "OpenGameMemberRemovalRequest"
                            )
                        }
                    }
                },
            },
            "responses": {
                "200": {
                    "description": (
                        "Member removal applied or idempotently replayed."
                    ),
                    "headers": {"X-Request-Id": request_id_header},
                    "content": {
                        "application/json": {
                            "schema": {
                                "$ref": (
                                    "#/components/schemas/"
                                    "OpenGameMemberRemovalResult"
                                )
                            },
                            "examples": {
                                "Promoted": {
                                    "externalValue": (
                                        "./examples/"
                                        "open-game-member-removal-promoted.json"
                                    )
                                },
                                "OpenSpot": {
                                    "externalValue": (
                                        "./examples/"
                                        "open-game-member-removal-open-spot.json"
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
                "404": member_not_found,
                "409": member_conflict,
                "422": error_response(
                    "Path, expected version, or trimmed reason is invalid.",
                    code="INVALID_ARGUMENT",
                    example_name="InvalidArgument",
                    example_file="error-invalid-argument.json",
                ),
                "503": error_response(
                    "Open game member service is unavailable.",
                    code="SERVICE_UNAVAILABLE",
                    example_name="ServiceUnavailable",
                    example_file="error-service-unavailable.json",
                ),
            },
        }
    )

    roster_path = "/api/v1/games/{game_id}/attendance-roster"
    roster_operation = require_attendance_operation(roster_path, "get")
    roster_operation.clear()
    roster_operation.update(
        {
            "operationId": "getOpenGameAttendanceRoster",
            "description": (
                "Owner-only attendance roster for an effectively completed "
                "open game."
            ),
            "security": [{"bearerAuth": []}],
            "parameters": [
                {
                    "name": "game_id",
                    "in": "path",
                    "required": True,
                    "schema": {"type": "string", "format": "uuid"},
                }
            ],
            "responses": {
                "200": {
                    "description": "Minimal joined-player attendance roster.",
                    "headers": {"X-Request-Id": request_id_header},
                    "content": {
                        "application/json": {
                            "schema": {
                                "$ref": (
                                    "#/components/schemas/"
                                    "OpenGameAttendanceRoster"
                                )
                            },
                            "examples": {
                                "Ready": {
                                    "externalValue": (
                                        "./examples/"
                                        "open-game-attendance-roster-ready.json"
                                    )
                                },
                                "Empty": {
                                    "externalValue": (
                                        "./examples/"
                                        "open-game-attendance-roster-empty.json"
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
                "404": error_response(
                    "Game does not exist or is not owned by this user.",
                    code="OPEN_GAME_NOT_FOUND",
                    example_name="OpenGameNotFound",
                    example_file="error-open-game-not-found.json",
                ),
                "422": error_response(
                    "Game identifier is invalid.",
                    code="INVALID_ARGUMENT",
                    example_name="InvalidArgument",
                    example_file="error-invalid-argument.json",
                ),
                "503": error_response(
                    "Open game attendance service is unavailable.",
                    code="SERVICE_UNAVAILABLE",
                    example_name="ServiceUnavailable",
                    example_file="error-service-unavailable.json",
                ),
            },
        }
    )

    mark_not_found = error_response(
        (
            "Game or registration does not exist, or the game is not owned "
            "by this user."
        ),
        code="APPLICATION_NOT_FOUND",
        example_name="ApplicationNotFound",
        example_file="error-application-not-found.json",
    )
    mark_not_found["content"]["application/json"]["schema"] = {
        "allOf": [
            {"$ref": "#/components/schemas/ErrorEnvelope"},
            {
                "type": "object",
                "properties": {
                    "error": {
                        "type": "object",
                        "properties": {
                            "code": {
                                "enum": [
                                    "APPLICATION_NOT_FOUND",
                                    "OPEN_GAME_NOT_FOUND",
                                ]
                            }
                        },
                    }
                },
            },
        ]
    }
    mark_not_found["content"]["application/json"]["examples"] = {
        "ApplicationNotFound": {
            "externalValue": "./examples/error-application-not-found.json"
        },
        "OpenGameNotFound": {
            "externalValue": "./examples/error-open-game-not-found.json"
        },
    }
    mark_conflict = error_response(
        "Attendance state, version, or idempotency authority changed.",
        code="ATTENDANCE_STATE_CHANGED",
        example_name="AttendanceStateChanged",
        example_file="error-attendance-state-changed.json",
    )
    mark_conflict["content"]["application/json"]["schema"] = {
        "allOf": [
            {"$ref": "#/components/schemas/ErrorEnvelope"},
            {
                "type": "object",
                "properties": {
                    "error": {
                        "oneOf": [
                            {
                                "type": "object",
                                "properties": {
                                    "code": {
                                        "const": "ATTENDANCE_STATE_CHANGED"
                                    }
                                },
                            },
                            {
                                "type": "object",
                                "properties": {
                                    "code": {"const": "IDEMPOTENCY_KEY_REUSED"}
                                },
                            },
                        ]
                    }
                },
            },
        ]
    }
    mark_conflict["content"]["application/json"]["examples"] = {
        "AttendanceStateChanged": {
            "externalValue": "./examples/error-attendance-state-changed.json"
        },
        "IdempotencyKeyReused": {
            "externalValue": "./examples/error-idempotency-key-reused.json"
        },
    }
    mark_path = (
        "/api/v1/games/{game_id}/registrations/"
        "{registration_id}/attendance"
    )
    mark_operation = require_attendance_operation(mark_path, "post")
    raw_idempotency_parameters = [
        parameter
        for parameter in mark_operation.get("parameters", [])
        if isinstance(parameter, dict)
        and parameter.get("name") == "Idempotency-Key"
    ]
    if len(raw_idempotency_parameters) != 1:
        raise RuntimeError(
            "raw OpenAPI attendance mark operation is missing Idempotency-Key"
        )
    raw_idempotency = raw_idempotency_parameters[0]
    raw_idempotency_schema = raw_idempotency.get("schema")
    if (
        raw_idempotency.get("in") != "header"
        or raw_idempotency.get("required") is not True
        or not isinstance(raw_idempotency_schema, dict)
        or raw_idempotency_schema.get("type") != "string"
        or raw_idempotency_schema.get("minLength") != 16
        or raw_idempotency_schema.get("maxLength") != 128
    ):
        raise RuntimeError(
            "raw OpenAPI attendance mark Idempotency-Key contract is invalid"
        )
    mark_operation.clear()
    mark_operation.update(
        {
            "operationId": "markOpenGameAttendance",
            "description": (
                "Irreversibly mark one joined player's attendance for a "
                "completed game."
            ),
            "security": [{"bearerAuth": []}],
            "parameters": [
                {
                    "name": "game_id",
                    "in": "path",
                    "required": True,
                    "schema": {"type": "string", "format": "uuid"},
                },
                {
                    "name": "registration_id",
                    "in": "path",
                    "required": True,
                    "schema": {"type": "string", "format": "uuid"},
                },
                {"$ref": "#/components/parameters/IdempotencyKey"},
            ],
            "requestBody": {
                "required": True,
                "content": {
                    "application/json": {
                        "schema": {
                            "$ref": (
                                "#/components/schemas/"
                                "OpenGameAttendanceMarkRequest"
                            )
                        }
                    }
                },
            },
            "responses": {
                "200": {
                    "description": (
                        "Attendance mark applied or idempotently replayed."
                    ),
                    "headers": {"X-Request-Id": request_id_header},
                    "content": {
                        "application/json": {
                            "schema": {
                                "$ref": (
                                    "#/components/schemas/"
                                    "OpenGameAttendanceMarkResult"
                                )
                            },
                            "examples": {
                                "MarkedPresent": {
                                    "externalValue": (
                                        "./examples/"
                                        "open-game-attendance-mark-present.json"
                                    )
                                },
                                "MarkedNoShow": {
                                    "externalValue": (
                                        "./examples/"
                                        "open-game-attendance-mark-no-show.json"
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
                "404": mark_not_found,
                "409": mark_conflict,
                "422": error_response(
                    (
                        "Path, attendance status, expected version, or "
                        "idempotency key is invalid."
                    ),
                    code="INVALID_ARGUMENT",
                    example_name="InvalidArgument",
                    example_file="error-invalid-argument.json",
                ),
                "503": error_response(
                    "Open game attendance service is unavailable.",
                    code="SERVICE_UNAVAILABLE",
                    example_name="ServiceUnavailable",
                    example_file="error-service-unavailable.json",
                ),
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
        or _WITHDRAWAL_PATH.fullmatch(path) is not None
        or _ATTENDANCE_PATH.fullmatch(path) is not None
        or _MEMBER_REMOVAL_PATH.fullmatch(path) is not None
    )


async def open_game_registration_request_validation_handler(
    request: Request,
    error: RequestValidationError,
) -> JSONResponse:
    if _DECISION_PATH.fullmatch(request.url.path) is not None:
        allowed_fields = _DECISION_FIELDS
    elif _WITHDRAWAL_PATH.fullmatch(request.url.path) is not None:
        allowed_fields = _WITHDRAWAL_FIELDS
    elif _ATTENDANCE_PATH.fullmatch(request.url.path) is not None:
        allowed_fields = _ATTENDANCE_FIELDS
    elif _MEMBER_REMOVAL_PATH.fullmatch(request.url.path) is not None:
        allowed_fields = _MEMBER_REMOVAL_FIELDS
    else:
        allowed_fields = _APPLICATION_FIELDS
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


def _service(
    database: Session,
    *,
    clock: Callable[[], datetime],
) -> OpenGameRegistrationService:
    return OpenGameRegistrationService(
        repository=OpenGameRegistrationRepository(database),
        open_game_repository=OpenGameRepository(database),
        order_repository=OrderRepository(database),
        now=clock,
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
    clock: Annotated[
        Callable[[], datetime], Depends(get_open_game_registration_clock)
    ],
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    cursor: Annotated[str | None, Query(min_length=1)] = None,
) -> MyOpenGameApplicationsResponse:
    return _service(database, clock=clock).list_my_applications(
        applicant_user_id=user.id,
        limit=limit,
        cursor=cursor,
    )


@router.post(
    "/api/v1/open-game-applications/{application_id}/withdraw",
    operation_id="withdrawOpenGameApplication",
    response_model=RegistrationContext,
    responses={
        401: {"model": ErrorEnvelope},
        404: {"model": ErrorEnvelope},
        409: {"model": ErrorEnvelope},
        422: {"model": ErrorEnvelope},
        503: {"model": ErrorEnvelope},
    },
)
def withdraw_open_game_application(
    application_id: uuid.UUID,
    body: WithdrawalRequest,
    idempotency_key: Annotated[
        str,
        Header(alias="Idempotency-Key", min_length=16, max_length=128),
    ],
    user: Annotated[User, Depends(get_required_open_game_registration_user)],
    database: Annotated[Session, Depends(get_database)],
    clock: Annotated[
        Callable[[], datetime], Depends(get_open_game_registration_clock)
    ],
) -> RegistrationContext:
    return _service(database, clock=clock).withdraw(
        application_id=application_id,
        applicant_user_id=user.id,
        idempotency_key=idempotency_key,
        request=body,
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
    clock: Annotated[
        Callable[[], datetime], Depends(get_open_game_registration_clock)
    ],
) -> RegistrationContext:
    return _service(database, clock=clock).get_context(
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
    clock: Annotated[
        Callable[[], datetime], Depends(get_open_game_registration_clock)
    ],
) -> RegistrationContext:
    return _service(database, clock=clock).apply(
        share_token=share_token,
        applicant_user_id=user.id,
        idempotency_key=idempotency_key,
        request=body,
    )


@router.get(
    "/api/v1/games/{game_id}/members",
    operation_id="getOpenGameMemberRoster",
    response_model=OpenGameMemberRoster,
    responses={
        401: {"model": ErrorEnvelope},
        404: {"model": ErrorEnvelope},
        422: {"model": ErrorEnvelope},
        503: {"model": ErrorEnvelope},
    },
)
def get_open_game_member_roster(
    game_id: uuid.UUID,
    user: Annotated[User, Depends(get_required_open_game_registration_user)],
    database: Annotated[Session, Depends(get_database)],
    clock: Annotated[
        Callable[[], datetime], Depends(get_open_game_registration_clock)
    ],
) -> OpenGameMemberRoster:
    return _service(database, clock=clock).get_member_roster(
        game_id=game_id,
        owner_user_id=user.id,
    )


@router.post(
    "/api/v1/games/{game_id}/members/{registration_id}/remove",
    operation_id="removeOpenGameMember",
    response_model=OpenGameMemberRemovalResult,
    responses={
        401: {"model": ErrorEnvelope},
        404: {"model": ErrorEnvelope},
        409: {"model": ErrorEnvelope},
        422: {"model": ErrorEnvelope},
        503: {"model": ErrorEnvelope},
    },
)
def remove_open_game_member(
    game_id: uuid.UUID,
    registration_id: uuid.UUID,
    body: OpenGameMemberRemovalRequest,
    idempotency_key: Annotated[
        str,
        Header(alias="Idempotency-Key", min_length=16, max_length=128),
    ],
    user: Annotated[User, Depends(get_required_open_game_registration_user)],
    database: Annotated[Session, Depends(get_database)],
    clock: Annotated[
        Callable[[], datetime], Depends(get_open_game_registration_clock)
    ],
) -> OpenGameMemberRemovalResult:
    return _service(database, clock=clock).remove_member(
        game_id=game_id,
        registration_id=registration_id,
        owner_user_id=user.id,
        idempotency_key=idempotency_key,
        request=body,
    )


@router.get(
    "/api/v1/games/{game_id}/attendance-roster",
    operation_id="getOpenGameAttendanceRoster",
    response_model=OpenGameAttendanceRoster,
    responses={
        401: {"model": ErrorEnvelope},
        404: {"model": ErrorEnvelope},
        422: {"model": ErrorEnvelope},
        503: {"model": ErrorEnvelope},
    },
)
def get_open_game_attendance_roster(
    game_id: uuid.UUID,
    user: Annotated[User, Depends(get_required_open_game_registration_user)],
    database: Annotated[Session, Depends(get_database)],
    clock: Annotated[
        Callable[[], datetime], Depends(get_open_game_registration_clock)
    ],
) -> OpenGameAttendanceRoster:
    return _service(database, clock=clock).get_attendance_roster(
        game_id=game_id,
        owner_user_id=user.id,
    )


@router.post(
    "/api/v1/games/{game_id}/registrations/{registration_id}/attendance",
    operation_id="markOpenGameAttendance",
    response_model=OpenGameAttendanceMarkResult,
    responses={
        401: {"model": ErrorEnvelope},
        404: {"model": ErrorEnvelope},
        409: {"model": ErrorEnvelope},
        422: {"model": ErrorEnvelope},
        503: {"model": ErrorEnvelope},
    },
)
def mark_open_game_attendance(
    game_id: uuid.UUID,
    registration_id: uuid.UUID,
    body: OpenGameAttendanceMarkRequest,
    idempotency_key: Annotated[
        str,
        Header(alias="Idempotency-Key", min_length=16, max_length=128),
    ],
    user: Annotated[User, Depends(get_required_open_game_registration_user)],
    database: Annotated[Session, Depends(get_database)],
    clock: Annotated[
        Callable[[], datetime], Depends(get_open_game_registration_clock)
    ],
) -> OpenGameAttendanceMarkResult:
    return _service(database, clock=clock).mark_attendance(
        game_id=game_id,
        registration_id=registration_id,
        owner_user_id=user.id,
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
    clock: Annotated[
        Callable[[], datetime], Depends(get_open_game_registration_clock)
    ],
) -> Queue:
    return _service(database, clock=clock).get_queue(
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
    clock: Annotated[
        Callable[[], datetime], Depends(get_open_game_registration_clock)
    ],
) -> DecisionResult:
    return _service(database, clock=clock).decide(
        game_id=game_id,
        application_id=application_id,
        owner_user_id=user.id,
        idempotency_key=idempotency_key,
        request=body,
    )
