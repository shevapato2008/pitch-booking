from __future__ import annotations

import json
import uuid
from collections.abc import Callable
from contextlib import suppress
from typing import Annotated, cast

from fastapi import APIRouter, Depends, Header, Query, Request, Response
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from backend.app.database import get_database
from backend.app.errors import AppError, ErrorEnvelope
from backend.app.models import User, VenueRecruitmentInvitationStatus
from backend.app.modules.auth.router import get_current_user
from backend.app.modules.platform_auth.router import (
    get_current_platform_session,
    require_platform_mutation_session,
)
from backend.app.modules.platform_auth.service import AuthenticatedPlatformSession
from backend.app.modules.venue_onboarding.dto import VenueOnboardingApplicationResponse
from backend.app.modules.venue_onboarding.repository import VenueOnboardingRepository
from backend.app.modules.venue_onboarding.service import VenueOnboardingService
from backend.app.modules.venue_onboarding.storage import (
    PrivateStorageUnavailableError,
    VenueOnboardingStore,
)
from backend.app.modules.venue_recruitment_invitations.dto import (
    InvitedVenueClaimRequest,
    RecruitmentInvitation,
    RecruitmentInvitationCreateRequest,
    RecruitmentInvitationCreateResult,
    RecruitmentInvitationEligibleVenues,
    RecruitmentInvitationRevokeRequest,
    RecruitmentInvitations,
    VenueRecruitmentInvitation,
)
from backend.app.modules.venue_recruitment_invitations.repository import (
    VenueRecruitmentInvitationRepository,
)
from backend.app.modules.venue_recruitment_invitations.service import (
    PlatformRecruitmentInvitationService,
    VenueRecruitmentInvitationService,
)
from backend.app.security.phone_vault import PhoneVaultError

platform_router = APIRouter(
    prefix="/platform-admin/api/v1/recruitment-invitations",
    tags=["platform-recruitment-invitations"],
)
viewer_router = APIRouter(
    prefix="/api/v1/venue-invitations",
    tags=["venue-recruitment-invitations"],
)

RECRUITMENT_REVIEW_ROLES = frozenset({"PLATFORM_ADMIN", "ONBOARDING_REVIEWER"})
IdempotencyKey = Annotated[
    str,
    Header(alias="Idempotency-Key", min_length=16, max_length=128),
]

_PLATFORM_BASE_ERRORS = {
    401: {"model": ErrorEnvelope},
    403: {"model": ErrorEnvelope},
    422: {"model": ErrorEnvelope},
    503: {"model": ErrorEnvelope},
}
_VIEWER_BASE_ERRORS = {
    401: {"model": ErrorEnvelope},
    404: {"model": ErrorEnvelope},
    410: {"model": ErrorEnvelope},
    422: {"model": ErrorEnvelope},
    503: {"model": ErrorEnvelope},
}


def _require_role(
    authenticated: AuthenticatedPlatformSession,
) -> AuthenticatedPlatformSession:
    if not (set(authenticated.principal.roles) & RECRUITMENT_REVIEW_ROLES):
        raise AppError(403, "PLATFORM_ROLE_REQUIRED", "当前账号没有招商邀请管理权限。")
    return authenticated


def require_recruitment_reviewer(
    authenticated: Annotated[
        AuthenticatedPlatformSession,
        Depends(get_current_platform_session),
    ],
) -> AuthenticatedPlatformSession:
    return _require_role(authenticated)


def require_mutating_recruitment_reviewer(
    authenticated: Annotated[
        AuthenticatedPlatformSession,
        Depends(require_platform_mutation_session),
    ],
) -> AuthenticatedPlatformSession:
    return _require_role(authenticated)


def get_platform_recruitment_service(
    database: Annotated[Session, Depends(get_database)],
) -> PlatformRecruitmentInvitationService:
    return PlatformRecruitmentInvitationService(
        repository=VenueRecruitmentInvitationRepository(database)
    )


def get_viewer_recruitment_service(
    request: Request,
    database: Annotated[Session, Depends(get_database)],
) -> VenueRecruitmentInvitationService:
    onboarding = VenueOnboardingService(
        repository=VenueOnboardingRepository(database),
        storage=cast(VenueOnboardingStore, request.app.state.venue_onboarding_store),
        phone_vault=request.app.state.phone_vault,
    )
    return VenueRecruitmentInvitationService(
        repository=VenueRecruitmentInvitationRepository(database),
        claim_boundary=onboarding,
    )


def _available[Result](database: Session, operation: Callable[[], Result]) -> Result:
    try:
        return operation()
    except AppError:
        raise
    except (SQLAlchemyError, PrivateStorageUnavailableError, PhoneVaultError):
        with suppress(SQLAlchemyError):
            database.rollback()
        raise AppError(503, "SERVICE_UNAVAILABLE", "招商邀请服务暂不可用。") from None


def _json_response(status_code: int, body: dict[str, object]) -> Response:
    return Response(
        content=json.dumps(
            body,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode(),
        status_code=status_code,
        media_type="application/json",
    )


@platform_router.get(
    "/eligible-venues",
    operation_id="searchRecruitmentInvitationEligibleVenues",
    response_model=RecruitmentInvitationEligibleVenues,
    responses=_PLATFORM_BASE_ERRORS,
)
def search_eligible_venues(
    database: Annotated[Session, Depends(get_database)],
    service: Annotated[
        PlatformRecruitmentInvitationService,
        Depends(get_platform_recruitment_service),
    ],
    _authenticated: Annotated[
        AuthenticatedPlatformSession,
        Depends(require_recruitment_reviewer),
    ],
    q: Annotated[str | None, Query(min_length=2, max_length=80)] = None,
    cursor: Annotated[str | None, Query(min_length=1)] = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
) -> RecruitmentInvitationEligibleVenues:
    return _available(
        database,
        lambda: service.eligible_venues(query=q, cursor=cursor, limit=limit),
    )


@platform_router.get(
    "",
    operation_id="listRecruitmentInvitations",
    response_model=RecruitmentInvitations,
    responses=_PLATFORM_BASE_ERRORS,
)
def list_invitations(
    database: Annotated[Session, Depends(get_database)],
    service: Annotated[
        PlatformRecruitmentInvitationService,
        Depends(get_platform_recruitment_service),
    ],
    _authenticated: Annotated[
        AuthenticatedPlatformSession,
        Depends(require_recruitment_reviewer),
    ],
    status: VenueRecruitmentInvitationStatus | None = None,
    cursor: Annotated[str | None, Query(min_length=1)] = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
) -> RecruitmentInvitations:
    return _available(
        database,
        lambda: service.list(status=status, cursor=cursor, limit=limit),
    )


@platform_router.post(
    "",
    operation_id="createRecruitmentInvitation",
    response_model=RecruitmentInvitationCreateResult,
    status_code=201,
    responses={
        200: {"model": RecruitmentInvitation},
        **_PLATFORM_BASE_ERRORS,
        409: {"model": ErrorEnvelope},
    },
)
def create_invitation(
    body: RecruitmentInvitationCreateRequest,
    database: Annotated[Session, Depends(get_database)],
    service: Annotated[
        PlatformRecruitmentInvitationService,
        Depends(get_platform_recruitment_service),
    ],
    authenticated: Annotated[
        AuthenticatedPlatformSession,
        Depends(require_mutating_recruitment_reviewer),
    ],
    idempotency_key: IdempotencyKey,
) -> Response:
    result = _available(
        database,
        lambda: service.create(
            principal_id=authenticated.principal.principal_id,
            idempotency_key=idempotency_key,
            request=body,
        ),
    )
    return _json_response(result.status_code, result.body)


@platform_router.post(
    "/{invitation_id}/revoke",
    operation_id="revokeRecruitmentInvitation",
    response_model=RecruitmentInvitation,
    responses={
        **_PLATFORM_BASE_ERRORS,
        404: {"model": ErrorEnvelope},
        409: {"model": ErrorEnvelope},
    },
)
def revoke_invitation(
    invitation_id: uuid.UUID,
    body: RecruitmentInvitationRevokeRequest,
    database: Annotated[Session, Depends(get_database)],
    service: Annotated[
        PlatformRecruitmentInvitationService,
        Depends(get_platform_recruitment_service),
    ],
    authenticated: Annotated[
        AuthenticatedPlatformSession,
        Depends(require_mutating_recruitment_reviewer),
    ],
    idempotency_key: IdempotencyKey,
) -> RecruitmentInvitation:
    return _available(
        database,
        lambda: service.revoke(
            invitation_id=invitation_id,
            principal_id=authenticated.principal.principal_id,
            idempotency_key=idempotency_key,
            request=body,
        ),
    )


@viewer_router.get(
    "/{token}",
    operation_id="getVenueRecruitmentInvitation",
    response_model=VenueRecruitmentInvitation,
    responses=_VIEWER_BASE_ERRORS,
)
def get_invitation(
    token: str,
    user: Annotated[User, Depends(get_current_user)],
    database: Annotated[Session, Depends(get_database)],
    service: Annotated[
        VenueRecruitmentInvitationService,
        Depends(get_viewer_recruitment_service),
    ],
) -> VenueRecruitmentInvitation:
    return _available(database, lambda: service.read(token=token, user=user))


@viewer_router.post(
    "/{token}/accept",
    operation_id="acceptVenueRecruitmentInvitation",
    response_model=VenueRecruitmentInvitation,
    responses={**_VIEWER_BASE_ERRORS, 409: {"model": ErrorEnvelope}},
)
def accept_invitation(
    token: str,
    user: Annotated[User, Depends(get_current_user)],
    database: Annotated[Session, Depends(get_database)],
    service: Annotated[
        VenueRecruitmentInvitationService,
        Depends(get_viewer_recruitment_service),
    ],
    idempotency_key: IdempotencyKey,
) -> VenueRecruitmentInvitation:
    return _available(
        database,
        lambda: service.accept(
            token=token,
            user=user,
            idempotency_key=idempotency_key,
        ),
    )


@viewer_router.post(
    "/{token}/claims",
    operation_id="submitInvitedVenueClaim",
    response_model=VenueOnboardingApplicationResponse,
    status_code=201,
    responses={
        200: {"model": VenueOnboardingApplicationResponse},
        **_VIEWER_BASE_ERRORS,
        409: {"model": ErrorEnvelope},
    },
)
def submit_invited_claim(
    token: str,
    body: InvitedVenueClaimRequest,
    user: Annotated[User, Depends(get_current_user)],
    database: Annotated[Session, Depends(get_database)],
    service: Annotated[
        VenueRecruitmentInvitationService,
        Depends(get_viewer_recruitment_service),
    ],
    idempotency_key: IdempotencyKey,
) -> Response:
    result = _available(
        database,
        lambda: service.submit_claim(
            token=token,
            user=user,
            idempotency_key=idempotency_key,
            request=body,
        ),
    )
    return _json_response(result.status_code, result.body)
