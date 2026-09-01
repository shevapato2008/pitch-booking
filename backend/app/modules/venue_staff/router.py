from __future__ import annotations

import uuid
from collections.abc import Callable
from contextlib import suppress
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, Request, Response
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from backend.app.database import get_database
from backend.app.errors import AppError, ErrorEnvelope
from backend.app.models import User
from backend.app.modules.auth.router import get_current_user
from backend.app.modules.platform_auth.router import require_platform_mutation_session
from backend.app.modules.platform_auth.service import AuthenticatedPlatformSession
from backend.app.modules.venue_staff.dto import (
    CreateVenueStaffInvitationRequest,
    CurrentVenueStaffInvitation,
    RemoveVenueStaffMemberRequest,
    TransferVenueOwnerRequest,
    UpdateVenueStaffPermissionsRequest,
    VenueOwnerTransferResult,
    VenueStaffInvitation,
    VenueStaffInvitationCreated,
    VenueStaffMember,
    VenueStaffMembershipAccepted,
    VenueStaffOverview,
)
from backend.app.modules.venue_staff.owner_mapping import owner_mapping_is_complete
from backend.app.modules.venue_staff.repository import VenueStaffRepository
from backend.app.modules.venue_staff.service import VenueStaffAuthorizationService

owner_router = APIRouter(
    prefix="/api/v1/admin/venues/{venue_id}",
    tags=["venue-staff"],
)
invitation_router = APIRouter(
    prefix="/api/v1/venue-staff-invitations/current",
    tags=["venue-staff-invitations"],
)
platform_router = APIRouter(
    prefix="/platform-admin/api/v1/venues/{venue_id}",
    tags=["platform-venue-staff"],
)

IdempotencyKey = Annotated[
    str,
    Header(alias="Idempotency-Key", min_length=16, max_length=128),
]
InvitationToken = Annotated[
    str,
    Header(
        alias="X-Venue-Staff-Invitation-Token",
        min_length=43,
        max_length=43,
        pattern=r"^[A-Za-z0-9_-]{43}$",
    ),
]

_OWNER_BASE_ERRORS: dict[int | str, dict[str, Any]] = {
    401: {"model": ErrorEnvelope},
    404: {"model": ErrorEnvelope},
    422: {"model": ErrorEnvelope},
    503: {"model": ErrorEnvelope},
}
_OWNER_MUTATION_ERRORS: dict[int | str, dict[str, Any]] = {
    **_OWNER_BASE_ERRORS,
    409: {"model": ErrorEnvelope},
}
_INVITATION_BASE_ERRORS: dict[int | str, dict[str, Any]] = {
    401: {"model": ErrorEnvelope},
    410: {"model": ErrorEnvelope},
    422: {"model": ErrorEnvelope},
    503: {"model": ErrorEnvelope},
}
_PLATFORM_ERRORS: dict[int | str, dict[str, Any]] = {
    401: {"model": ErrorEnvelope},
    403: {"model": ErrorEnvelope},
    404: {"model": ErrorEnvelope},
    409: {"model": ErrorEnvelope},
    422: {"model": ErrorEnvelope},
    503: {"model": ErrorEnvelope},
}


def get_venue_staff_service(
    database: Annotated[Session, Depends(get_database)],
) -> VenueStaffAuthorizationService:
    return VenueStaffAuthorizationService(repository=VenueStaffRepository(database))


def require_venue_staff_authorization_enabled(
    request: Request,
    database: Annotated[Session, Depends(get_database)],
) -> None:
    if not request.app.state.settings.venue_staff_authorization_enabled:
        raise _disabled()
    try:
        ready = owner_mapping_is_complete(database)
    except SQLAlchemyError:
        raise AppError(503, "SERVICE_UNAVAILABLE", "员工权限服务暂不可用。") from None
    if not ready:
        raise _disabled()


def require_mutating_venue_staff_platform_admin(
    authenticated: Annotated[
        AuthenticatedPlatformSession,
        Depends(require_platform_mutation_session),
    ],
) -> AuthenticatedPlatformSession:
    if "PLATFORM_ADMIN" not in authenticated.principal.roles:
        raise AppError(403, "PLATFORM_ROLE_REQUIRED", "当前账号没有负责人转移权限。")
    return authenticated


def _available[Result](database: Session, operation: Callable[[], Result]) -> Result:
    try:
        return operation()
    except AppError:
        raise
    except SQLAlchemyError:
        with suppress(SQLAlchemyError):
            database.rollback()
        raise AppError(503, "SERVICE_UNAVAILABLE", "员工权限服务暂不可用。") from None


@owner_router.get(
    "/staff",
    operation_id="getVenueStaffOverview",
    response_model=VenueStaffOverview,
    responses=_OWNER_BASE_ERRORS,
)
def get_staff_overview(
    venue_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    database: Annotated[Session, Depends(get_database)],
    service: Annotated[VenueStaffAuthorizationService, Depends(get_venue_staff_service)],
    _enabled: Annotated[None, Depends(require_venue_staff_authorization_enabled)],
) -> VenueStaffOverview:
    return _available(
        database,
        lambda: service.get_overview(venue_id=venue_id, user=user),
    )


@owner_router.post(
    "/staff-invitations",
    operation_id="createVenueStaffInvitation",
    response_model=VenueStaffInvitationCreated,
    status_code=201,
    responses={200: {"model": VenueStaffInvitation}, **_OWNER_MUTATION_ERRORS},
)
def create_staff_invitation(
    venue_id: uuid.UUID,
    body: CreateVenueStaffInvitationRequest,
    user: Annotated[User, Depends(get_current_user)],
    database: Annotated[Session, Depends(get_database)],
    service: Annotated[VenueStaffAuthorizationService, Depends(get_venue_staff_service)],
    _enabled: Annotated[None, Depends(require_venue_staff_authorization_enabled)],
    idempotency_key: IdempotencyKey,
) -> Response:
    result = _available(
        database,
        lambda: service.create_invitation(
            venue_id=venue_id,
            user=user,
            request=body,
            idempotency_key=idempotency_key,
        ),
    )
    return Response(
        content=result.response.model_dump_json(),
        status_code=201 if result.created else 200,
        media_type="application/json",
    )


@owner_router.post(
    "/staff-invitations/{invitation_id}/revoke",
    operation_id="revokeVenueStaffInvitation",
    response_model=VenueStaffInvitation,
    responses=_OWNER_MUTATION_ERRORS,
)
def revoke_staff_invitation(
    venue_id: uuid.UUID,
    invitation_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    database: Annotated[Session, Depends(get_database)],
    service: Annotated[VenueStaffAuthorizationService, Depends(get_venue_staff_service)],
    _enabled: Annotated[None, Depends(require_venue_staff_authorization_enabled)],
    idempotency_key: IdempotencyKey,
) -> VenueStaffInvitation:
    return _available(
        database,
        lambda: service.revoke_invitation(
            venue_id=venue_id,
            invitation_id=invitation_id,
            user=user,
            idempotency_key=idempotency_key,
        ),
    )


@owner_router.put(
    "/staff/{membership_id}",
    operation_id="updateVenueStaffPermissions",
    response_model=VenueStaffMember,
    responses=_OWNER_MUTATION_ERRORS,
)
def update_staff_permissions(
    venue_id: uuid.UUID,
    membership_id: uuid.UUID,
    body: UpdateVenueStaffPermissionsRequest,
    user: Annotated[User, Depends(get_current_user)],
    database: Annotated[Session, Depends(get_database)],
    service: Annotated[VenueStaffAuthorizationService, Depends(get_venue_staff_service)],
    _enabled: Annotated[None, Depends(require_venue_staff_authorization_enabled)],
    idempotency_key: IdempotencyKey,
) -> VenueStaffMember:
    return _available(
        database,
        lambda: service.update_permissions(
            venue_id=venue_id,
            membership_id=membership_id,
            user=user,
            request=body,
            idempotency_key=idempotency_key,
        ),
    )


@owner_router.post(
    "/staff/{membership_id}/remove",
    operation_id="removeVenueStaffMember",
    response_model=VenueStaffMember,
    responses=_OWNER_MUTATION_ERRORS,
)
def remove_staff_member(
    venue_id: uuid.UUID,
    membership_id: uuid.UUID,
    body: RemoveVenueStaffMemberRequest,
    user: Annotated[User, Depends(get_current_user)],
    database: Annotated[Session, Depends(get_database)],
    service: Annotated[VenueStaffAuthorizationService, Depends(get_venue_staff_service)],
    _enabled: Annotated[None, Depends(require_venue_staff_authorization_enabled)],
    idempotency_key: IdempotencyKey,
) -> VenueStaffMember:
    return _available(
        database,
        lambda: service.remove_member(
            venue_id=venue_id,
            membership_id=membership_id,
            user=user,
            request=body,
            idempotency_key=idempotency_key,
        ),
    )


@invitation_router.get(
    "",
    operation_id="getCurrentVenueStaffInvitation",
    response_model=CurrentVenueStaffInvitation,
    responses={404: {"model": ErrorEnvelope}, **_INVITATION_BASE_ERRORS},
)
def get_current_staff_invitation(
    user: Annotated[User, Depends(get_current_user)],
    database: Annotated[Session, Depends(get_database)],
    service: Annotated[VenueStaffAuthorizationService, Depends(get_venue_staff_service)],
    _enabled: Annotated[None, Depends(require_venue_staff_authorization_enabled)],
    invitation_token: InvitationToken,
) -> CurrentVenueStaffInvitation:
    return _available(
        database,
        lambda: service.get_current_invitation(
            user=user,
            raw_token=invitation_token,
        ),
    )


@invitation_router.post(
    "/accept",
    operation_id="acceptCurrentVenueStaffInvitation",
    response_model=VenueStaffMembershipAccepted,
    responses={409: {"model": ErrorEnvelope}, **_INVITATION_BASE_ERRORS},
)
def accept_current_staff_invitation(
    user: Annotated[User, Depends(get_current_user)],
    database: Annotated[Session, Depends(get_database)],
    service: Annotated[VenueStaffAuthorizationService, Depends(get_venue_staff_service)],
    _enabled: Annotated[None, Depends(require_venue_staff_authorization_enabled)],
    invitation_token: InvitationToken,
    idempotency_key: IdempotencyKey,
) -> VenueStaffMembershipAccepted:
    return _available(
        database,
        lambda: service.accept_invitation(
            user=user,
            raw_token=invitation_token,
            idempotency_key=idempotency_key,
        ),
    )


@platform_router.post(
    "/owner-transfers",
    operation_id="transferVenueOwner",
    response_model=VenueOwnerTransferResult,
    responses=_PLATFORM_ERRORS,
)
def transfer_venue_owner(
    venue_id: uuid.UUID,
    body: TransferVenueOwnerRequest,
    database: Annotated[Session, Depends(get_database)],
    service: Annotated[VenueStaffAuthorizationService, Depends(get_venue_staff_service)],
    _enabled: Annotated[None, Depends(require_venue_staff_authorization_enabled)],
    authenticated: Annotated[
        AuthenticatedPlatformSession,
        Depends(require_mutating_venue_staff_platform_admin),
    ],
    idempotency_key: IdempotencyKey,
) -> VenueOwnerTransferResult:
    return _available(
        database,
        lambda: service.transfer_owner(
            venue_id=venue_id,
            principal_id=authenticated.principal.principal_id,
            request=body,
            idempotency_key=idempotency_key,
        ),
    )


def align_venue_staff_authorization_openapi(schema: dict[str, Any]) -> None:
    paths = schema.get("paths")
    if not isinstance(paths, dict):
        raise RuntimeError("raw OpenAPI venue staff paths are missing")
    operations = (
        ("/api/v1/admin/venues/{venue_id}/staff", "get", False),
        ("/api/v1/admin/venues/{venue_id}/staff-invitations", "post", False),
        (
            "/api/v1/admin/venues/{venue_id}/staff-invitations/"
            "{invitation_id}/revoke",
            "post",
            False,
        ),
        ("/api/v1/admin/venues/{venue_id}/staff/{membership_id}", "put", False),
        (
            "/api/v1/admin/venues/{venue_id}/staff/{membership_id}/remove",
            "post",
            False,
        ),
        ("/api/v1/venue-staff-invitations/current", "get", False),
        ("/api/v1/venue-staff-invitations/current/accept", "post", False),
        (
            "/platform-admin/api/v1/venues/{venue_id}/owner-transfers",
            "post",
            True,
        ),
    )
    for path, method, platform in operations:
        path_item = paths.get(path)
        operation = path_item.get(method) if isinstance(path_item, dict) else None
        if not isinstance(operation, dict):
            raise RuntimeError(
                f"raw OpenAPI venue staff operation is missing: {method.upper()} {path}"
            )
        operation["security"] = [
            {"platformSession": []} if platform else {"bearerAuth": []}
        ]

    for path in (
        "/api/v1/admin/venues/{venue_id}/staff",
        "/api/v1/venue-staff-invitations/current",
    ):
        paths[path]["get"]["responses"].pop("422", None)

    for path, method in (
        ("/api/v1/venue-staff-invitations/current", "get"),
        ("/api/v1/venue-staff-invitations/current/accept", "post"),
    ):
        parameters = paths[path][method].get("parameters", [])
        token_parameter = next(
            (
                item
                for item in parameters
                if isinstance(item, dict)
                and item.get("name") == "X-Venue-Staff-Invitation-Token"
            ),
            None,
        )
        if token_parameter is None:
            raise RuntimeError("raw OpenAPI venue staff invitation header is missing")
        token_parameter["description"] = (
            "One-time invitation secret. This header is redacted from logs."
        )

    transfer_parameters = paths[
        "/platform-admin/api/v1/venues/{venue_id}/owner-transfers"
    ]["post"].get("parameters", [])
    transfer_headers = {
        item.get("name"): item
        for item in transfer_parameters
        if isinstance(item, dict) and item.get("name") in {"Origin", "X-CSRF-Token"}
    }
    if set(transfer_headers) != {"Origin", "X-CSRF-Token"}:
        raise RuntimeError("raw OpenAPI venue staff platform mutation headers are missing")
    transfer_headers["Origin"].update(
        {
            "required": True,
            "schema": {"type": "string", "format": "uri"},
        }
    )
    transfer_headers["X-CSRF-Token"].update(
        {
            "required": True,
            "schema": {"type": "string", "pattern": "^[0-9a-f]{64}$"},
        }
    )

    components = schema.get("components")
    if not isinstance(components, dict):
        raise RuntimeError("raw OpenAPI venue staff components are missing")
    security_schemes = components.setdefault("securitySchemes", {})
    security_schemes["bearerAuth"] = {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "opaque",
    }
    schemas = components.get("schemas")
    if not isinstance(schemas, dict):
        raise RuntimeError("raw OpenAPI venue staff schemas are missing")
    for name in (
        "CreateVenueStaffInvitationRequest",
        "UpdateVenueStaffPermissionsRequest",
        "VenueStaffMember",
        "VenueStaffInvitation",
        "VenueStaffInvitationCreated",
        "CurrentVenueStaffInvitation",
        "VenueStaffOverview",
    ):
        value = schemas.get(name)
        properties = value.get("properties") if isinstance(value, dict) else None
        permission_array = (
            properties.get("permissions") if isinstance(properties, dict) else None
        )
        if isinstance(permission_array, dict):
            permission_array["uniqueItems"] = True


def _disabled() -> AppError:
    return AppError(
        503,
        "VENUE_STAFF_AUTHORIZATION_DISABLED",
        "员工权限功能尚未完成负责人映射，暂不可用。",
    )
