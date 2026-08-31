from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header
from sqlalchemy.orm import Session

from backend.app.database import get_database
from backend.app.errors import AppError, ErrorEnvelope
from backend.app.modules.platform_attendance_corrections.dto import (
    PlatformAttendanceCorrectionEvent,
    PlatformAttendanceCorrectionRequest,
    PlatformAttendanceRegistrationDetail,
)
from backend.app.modules.platform_attendance_corrections.repository import (
    PlatformAttendanceCorrectionRepository,
)
from backend.app.modules.platform_attendance_corrections.service import (
    PlatformAttendanceCorrectionService,
)
from backend.app.modules.platform_auth.router import (
    get_current_platform_session,
    require_platform_mutation_session,
)
from backend.app.modules.platform_auth.service import AuthenticatedPlatformSession

router = APIRouter(
    prefix="/platform-admin/api/v1/attendance",
    tags=["platform-attendance"],
)
_DETAIL_PATH = "/platform-admin/api/v1/attendance/registrations/{registration_id}"
_CORRECTION_PATH = f"{_DETAIL_PATH}/corrections"


def get_platform_attendance_clock() -> datetime:
    return datetime.now(UTC)


def _require_platform_admin(
    authenticated: AuthenticatedPlatformSession,
) -> AuthenticatedPlatformSession:
    if "PLATFORM_ADMIN" not in authenticated.principal.roles:
        raise AppError(
            403,
            "PLATFORM_ROLE_REQUIRED",
            "当前账号没有到场纠正权限。",
        )
    return authenticated


def require_platform_admin(
    authenticated: Annotated[
        AuthenticatedPlatformSession,
        Depends(get_current_platform_session),
    ],
) -> AuthenticatedPlatformSession:
    return _require_platform_admin(authenticated)


def require_mutating_platform_admin(
    authenticated: Annotated[
        AuthenticatedPlatformSession,
        Depends(require_platform_mutation_session),
    ],
) -> AuthenticatedPlatformSession:
    return _require_platform_admin(authenticated)


def _service(
    database: Session,
    now: datetime,
) -> PlatformAttendanceCorrectionService:
    return PlatformAttendanceCorrectionService(
        repository=PlatformAttendanceCorrectionRepository(database),
        now=lambda: now,
    )


_BASE_ERRORS = {
    401: {"model": ErrorEnvelope},
    403: {"model": ErrorEnvelope},
    404: {"model": ErrorEnvelope},
    422: {"model": ErrorEnvelope},
    503: {"model": ErrorEnvelope},
}


@router.get(
    "/registrations/{registration_id}",
    operation_id="getPlatformAttendanceRegistration",
    response_model=PlatformAttendanceRegistrationDetail,
    responses=_BASE_ERRORS,
)
def get_platform_attendance_registration(
    registration_id: uuid.UUID,
    database: Annotated[Session, Depends(get_database)],
    _authenticated: Annotated[
        AuthenticatedPlatformSession,
        Depends(require_platform_admin),
    ],
    now: Annotated[datetime, Depends(get_platform_attendance_clock)],
) -> PlatformAttendanceRegistrationDetail:
    return _service(database, now).get_registration(registration_id)


@router.post(
    "/registrations/{registration_id}/corrections",
    operation_id="correctPlatformAttendanceRegistration",
    response_model=PlatformAttendanceCorrectionEvent,
    responses={**_BASE_ERRORS, 409: {"model": ErrorEnvelope}},
)
def correct_platform_attendance_registration(
    registration_id: uuid.UUID,
    body: PlatformAttendanceCorrectionRequest,
    database: Annotated[Session, Depends(get_database)],
    authenticated: Annotated[
        AuthenticatedPlatformSession,
        Depends(require_mutating_platform_admin),
    ],
    now: Annotated[datetime, Depends(get_platform_attendance_clock)],
    idempotency_key: Annotated[
        str,
        Header(
            alias="Idempotency-Key",
            min_length=16,
            max_length=128,
        ),
    ],
) -> PlatformAttendanceCorrectionEvent:
    return _service(database, now).correct(
        registration_id=registration_id,
        principal_id=authenticated.principal.principal_id,
        idempotency_key=idempotency_key,
        request=body,
    )


def align_platform_attendance_corrections_openapi(
    schema: dict[str, Any],
) -> None:
    paths = schema.get("paths")
    if not isinstance(paths, dict):
        raise RuntimeError("raw OpenAPI platform attendance paths are missing")
    operations: dict[tuple[str, str], dict[str, Any]] = {}
    for path, method in ((_DETAIL_PATH, "get"), (_CORRECTION_PATH, "post")):
        path_item = paths.get(path)
        operation = path_item.get(method) if isinstance(path_item, dict) else None
        if not isinstance(operation, dict):
            raise RuntimeError(
                f"raw OpenAPI platform attendance operation is missing: {method.upper()} {path}"
            )
        operations[(path, method)] = operation

    components = schema.get("components")
    schemas = components.get("schemas") if isinstance(components, dict) else None
    if not isinstance(schemas, dict):
        raise RuntimeError("raw OpenAPI platform attendance schemas are missing")
    _align_platform_attendance_schemas(schemas)
    _align_platform_attendance_reusable_components(components)

    request_id = {"$ref": "#/components/headers/RequestId"}

    def response(
        description: str,
        *,
        schema_value: dict[str, Any],
        examples: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        json_content: dict[str, Any] = {"schema": schema_value}
        if examples is not None:
            json_content["examples"] = examples
        return {
            "description": description,
            "headers": {"X-Request-Id": request_id},
            "content": {"application/json": json_content},
        }

    registration_parameter = {"$ref": "#/components/parameters/AttendanceRegistrationId"}
    get_operation = operations[(_DETAIL_PATH, "get")]
    get_operation.clear()
    get_operation.update(
        {
            "operationId": "getPlatformAttendanceRegistration",
            "description": (
                "Exact registration UUID lookup for platform attendance correction. "
                "No fuzzy or personal-identifier search."
            ),
            "security": [{"platformSession": []}],
            "parameters": [registration_parameter],
            "responses": {
                "200": response(
                    "Minimal attendance correction detail and immutable correction history.",
                    schema_value={
                        "$ref": ("#/components/schemas/PlatformAttendanceRegistrationDetail")
                    },
                    examples={
                        "Detail": {
                            "externalValue": (
                                "./examples/platform-attendance-registration-detail.json"
                            )
                        }
                    },
                ),
                "401": {"$ref": "#/components/responses/PlatformAuthRequired"},
                "403": {"$ref": "#/components/responses/PlatformAttendanceForbidden"},
                "404": {"$ref": "#/components/responses/PlatformAttendanceNotFound"},
                "422": {"$ref": "#/components/responses/PlatformAttendanceInvalid"},
                "503": {"$ref": "#/components/responses/PlatformAttendanceUnavailable"},
            },
        }
    )

    post_operation = operations[(_CORRECTION_PATH, "post")]
    raw_parameters = post_operation.get("parameters", [])
    names = {
        parameter.get("name"): parameter
        for parameter in raw_parameters
        if isinstance(parameter, dict)
    }
    if "Idempotency-Key" not in names:
        raise RuntimeError("raw OpenAPI platform attendance Idempotency-Key header is missing")
    post_operation.clear()
    post_operation.update(
        {
            "operationId": "correctPlatformAttendanceRegistration",
            "description": (
                "Atomically append an immutable platform correction and update the "
                "current effective terminal attendance status."
            ),
            "security": [{"platformSession": []}],
            "parameters": [
                registration_parameter,
                {
                    "name": "Origin",
                    "in": "header",
                    "required": True,
                    "schema": {"type": "string", "format": "uri"},
                },
                {
                    "name": "X-CSRF-Token",
                    "in": "header",
                    "required": True,
                    "schema": {"type": "string", "pattern": "^[0-9a-f]{64}$"},
                },
                {"$ref": "#/components/parameters/IdempotencyKey"},
            ],
            "requestBody": {
                "required": True,
                "content": {
                    "application/json": {
                        "schema": {
                            "$ref": ("#/components/schemas/PlatformAttendanceCorrectionRequest")
                        }
                    }
                },
            },
            "responses": {
                "200": response(
                    "Attendance correction applied or idempotently replayed.",
                    schema_value={
                        "$ref": ("#/components/schemas/PlatformAttendanceCorrectionEvent")
                    },
                    examples={
                        "Correction": {
                            "externalValue": (
                                "./examples/platform-attendance-correction-event.json"
                            )
                        }
                    },
                ),
                "401": {"$ref": "#/components/responses/PlatformAuthRequired"},
                "403": {"$ref": ("#/components/responses/PlatformAttendanceMutationForbidden")},
                "404": {"$ref": "#/components/responses/PlatformAttendanceNotFound"},
                "409": response(
                    "Attendance authority, expected version, or idempotency authority changed.",
                    schema_value={
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
                                                    "ATTENDANCE_STATE_CHANGED",
                                                    "IDEMPOTENCY_KEY_REUSED",
                                                ]
                                            }
                                        },
                                    }
                                },
                            },
                        ]
                    },
                ),
                "422": {"$ref": "#/components/responses/PlatformAttendanceInvalid"},
                "503": {"$ref": "#/components/responses/PlatformAttendanceUnavailable"},
            },
        }
    )


def _align_platform_attendance_reusable_components(
    components: dict[str, Any],
) -> None:
    parameters = components.setdefault("parameters", {})
    responses = components.setdefault("responses", {})
    if not isinstance(parameters, dict) or not isinstance(responses, dict):
        raise RuntimeError("raw OpenAPI platform attendance components are malformed")
    parameters["IdempotencyKey"] = {
        "name": "Idempotency-Key",
        "in": "header",
        "required": True,
        "description": (
            "Reuse the same key to recover the authoritative result after an unknown outcome."
        ),
        "schema": {"type": "string", "minLength": 16, "maxLength": 128},
    }
    parameters["AttendanceRegistrationId"] = {
        "name": "registration_id",
        "in": "path",
        "required": True,
        "schema": {"type": "string", "format": "uuid"},
    }

    def error_response(
        description: str,
        *,
        code_schema: dict[str, Any],
    ) -> dict[str, Any]:
        return {
            "description": description,
            "headers": {"X-Request-Id": {"$ref": "#/components/headers/RequestId"}},
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
                                        "properties": {"code": code_schema},
                                    }
                                },
                            },
                        ]
                    }
                }
            },
        }

    responses.update(
        {
            "PlatformAuthRequired": error_response(
                "Active platform staff session required.",
                code_schema={"const": "PLATFORM_AUTH_REQUIRED"},
            ),
            "PlatformAttendanceForbidden": error_response(
                "PLATFORM_ADMIN role required.",
                code_schema={"const": "PLATFORM_ROLE_REQUIRED"},
            ),
            "PlatformAttendanceMutationForbidden": error_response(
                "PLATFORM_ADMIN role and valid same-origin mutation protection required.",
                code_schema={"enum": ["PLATFORM_ROLE_REQUIRED", "PLATFORM_CSRF_INVALID"]},
            ),
            "PlatformAttendanceNotFound": error_response(
                "Registration does not exist.",
                code_schema={"const": "ATTENDANCE_REGISTRATION_NOT_FOUND"},
            ),
            "PlatformAttendanceInvalid": error_response(
                "Registration identifier, headers, target attendance status, expected "
                "version, or reason is invalid.",
                code_schema={"const": "INVALID_ARGUMENT"},
            ),
            "PlatformAttendanceUnavailable": error_response(
                "Platform attendance correction service is unavailable.",
                code_schema={"const": "SERVICE_UNAVAILABLE"},
            ),
        }
    )


def _align_platform_attendance_schemas(schemas: dict[str, Any]) -> None:
    required_names = {
        "PlatformAttendanceCorrectionRequest",
        "PlatformAttendanceAllowedCorrection",
        "PlatformAttendanceCorrectionEvent",
        "PlatformAttendanceRegistrationDetail",
    }
    if not required_names.issubset(schemas):
        raise RuntimeError("raw OpenAPI platform attendance schemas are incomplete")

    schemas["PlatformAttendanceCorrectionBlockedReason"] = {
        "type": "string",
        "enum": [
            "GAME_NOT_COMPLETED",
            "REGISTRATION_NOT_JOINED",
            "ATTENDANCE_UNMARKED",
            "ATTENDANCE_AUDIT_INCOMPLETE",
        ],
    }

    schemas["PlatformAttendanceCorrectionRequest"].clear()
    schemas["PlatformAttendanceCorrectionRequest"].update(
        {
            "type": "object",
            "additionalProperties": False,
            "required": ["attendance_status", "expected_version", "reason"],
            "properties": {
                "attendance_status": {
                    "type": "string",
                    "enum": ["PRESENT", "NO_SHOW"],
                },
                "expected_version": {"type": "integer", "minimum": 1},
                "reason": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 1000,
                    "pattern": r".*\S.*",
                },
            },
        }
    )
    schemas["PlatformAttendanceAllowedCorrection"].clear()
    schemas["PlatformAttendanceAllowedCorrection"].update(
        {
            "type": "object",
            "additionalProperties": False,
            "required": ["target_status", "blocked_reason"],
            "properties": {
                "target_status": {
                    "type": ["string", "null"],
                    "enum": ["PRESENT", "NO_SHOW", None],
                },
                "blocked_reason": {
                    "oneOf": [
                        {
                            "$ref": (
                                "#/components/schemas/PlatformAttendanceCorrectionBlockedReason"
                            )
                        },
                        {"type": "null"},
                    ]
                },
            },
            "oneOf": [
                {
                    "properties": {
                        "target_status": {"enum": ["PRESENT", "NO_SHOW"]},
                        "blocked_reason": {"const": None},
                    }
                },
                {
                    "properties": {
                        "target_status": {"const": None},
                        "blocked_reason": {
                            "enum": [
                                "GAME_NOT_COMPLETED",
                                "REGISTRATION_NOT_JOINED",
                                "ATTENDANCE_UNMARKED",
                                "ATTENDANCE_AUDIT_INCOMPLETE",
                            ]
                        },
                    }
                },
            ],
        }
    )
    schemas["PlatformAttendanceCorrectionEvent"].clear()
    schemas["PlatformAttendanceCorrectionEvent"].update(
        {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "id",
                "registration_id",
                "from_status",
                "to_status",
                "reason",
                "corrected_by_principal_id",
                "corrected_at",
                "registration_version_before",
                "registration_version_after",
            ],
            "properties": {
                "id": {"type": "string", "format": "uuid"},
                "registration_id": {"type": "string", "format": "uuid"},
                "from_status": {
                    "type": "string",
                    "enum": ["PRESENT", "NO_SHOW"],
                },
                "to_status": {
                    "type": "string",
                    "enum": ["PRESENT", "NO_SHOW"],
                },
                "reason": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 1000,
                    "pattern": r".*\S.*",
                },
                "corrected_by_principal_id": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 128,
                },
                "corrected_at": {"type": "string", "format": "date-time"},
                "registration_version_before": {"type": "integer", "minimum": 1},
                "registration_version_after": {
                    "type": "integer",
                    "minimum": 2,
                    "description": "Exactly registration_version_before + 1.",
                },
            },
            "oneOf": [
                {
                    "properties": {
                        "from_status": {"const": "PRESENT"},
                        "to_status": {"const": "NO_SHOW"},
                    }
                },
                {
                    "properties": {
                        "from_status": {"const": "NO_SHOW"},
                        "to_status": {"const": "PRESENT"},
                    }
                },
            ],
        }
    )
    detail_one_of = [
        {
            "properties": {
                "game_status": {"const": "COMPLETED"},
                "registration_status": {"const": "JOINED"},
                "attendance_status": {"const": "PRESENT"},
                "original_attendance_status": {"enum": ["PRESENT", "NO_SHOW"]},
                "attendance_recorded_at": {
                    "type": "string",
                    "format": "date-time",
                },
                "allowed_correction": {
                    "const": {"target_status": "NO_SHOW", "blocked_reason": None}
                },
            }
        },
        {
            "properties": {
                "game_status": {"const": "COMPLETED"},
                "registration_status": {"const": "JOINED"},
                "attendance_status": {"const": "NO_SHOW"},
                "original_attendance_status": {"enum": ["PRESENT", "NO_SHOW"]},
                "attendance_recorded_at": {
                    "type": "string",
                    "format": "date-time",
                },
                "allowed_correction": {
                    "const": {"target_status": "PRESENT", "blocked_reason": None}
                },
            }
        },
        {
            "properties": {
                "game_status": {"const": "COMPLETED"},
                "registration_status": {"const": "JOINED"},
                "attendance_status": {"enum": ["PRESENT", "NO_SHOW"]},
                "original_attendance_status": {"enum": ["PRESENT", "NO_SHOW"]},
                "attendance_recorded_at": {
                    "type": "string",
                    "format": "date-time",
                },
                "allowed_correction": {
                    "const": {
                        "target_status": None,
                        "blocked_reason": "ATTENDANCE_AUDIT_INCOMPLETE",
                    }
                },
            }
        },
        {
            "properties": {
                "allowed_correction": {
                    "type": "object",
                    "properties": {
                        "target_status": {"const": None},
                        "blocked_reason": {
                            "$ref": (
                                "#/components/schemas/PlatformAttendanceCorrectionBlockedReason"
                            )
                        },
                    },
                }
            },
            "not": {
                "required": [
                    "game_status",
                    "registration_status",
                    "attendance_status",
                    "original_attendance_status",
                    "attendance_recorded_at",
                ],
                "properties": {
                    "game_status": {"const": "COMPLETED"},
                    "registration_status": {"const": "JOINED"},
                    "attendance_status": {"enum": ["PRESENT", "NO_SHOW"]},
                    "original_attendance_status": {"enum": ["PRESENT", "NO_SHOW"]},
                    "attendance_recorded_at": {
                        "type": "string",
                        "format": "date-time",
                    },
                },
            },
        },
    ]
    detail = schemas["PlatformAttendanceRegistrationDetail"]
    detail.clear()
    detail.update(
        {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "registration_id",
                "registration_status",
                "player_display_name",
                "intended_position",
                "game_name",
                "game_status",
                "venue_name",
                "pitch_name",
                "starts_at",
                "ends_at",
                "time_zone",
                "original_attendance_status",
                "attendance_recorded_at",
                "attendance_status",
                "version",
                "corrections",
                "allowed_correction",
            ],
            "properties": {
                "registration_id": {"type": "string", "format": "uuid"},
                "registration_status": {
                    "$ref": ("#/components/schemas/OpenGameRegistrationPersistedStatus")
                },
                "player_display_name": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 24,
                },
                "intended_position": {"$ref": "#/components/schemas/OpenGameRegistrationPosition"},
                "game_name": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 30,
                },
                "game_status": {"$ref": "#/components/schemas/OpenGameState"},
                "venue_name": {"type": "string", "minLength": 1},
                "pitch_name": {"type": "string", "minLength": 1},
                "starts_at": {"type": "string", "format": "date-time"},
                "ends_at": {"type": "string", "format": "date-time"},
                "time_zone": {"type": "string", "const": "Asia/Shanghai"},
                "original_attendance_status": {
                    "type": ["string", "null"],
                    "enum": ["PRESENT", "NO_SHOW", None],
                },
                "attendance_recorded_at": {
                    "type": ["string", "null"],
                    "format": "date-time",
                },
                "attendance_status": {"$ref": "#/components/schemas/OpenGameAttendanceStatus"},
                "version": {"type": "integer", "minimum": 1},
                "corrections": {
                    "type": "array",
                    "items": {"$ref": ("#/components/schemas/PlatformAttendanceCorrectionEvent")},
                },
                "allowed_correction": {
                    "$ref": ("#/components/schemas/PlatformAttendanceAllowedCorrection")
                },
            },
            "oneOf": detail_one_of,
        }
    )
    schemas["OpenGameState"] = {
        "type": "string",
        "enum": ["DRAFT", "PUBLISHED", "SUSPENDED", "CANCELLED", "COMPLETED"],
    }
