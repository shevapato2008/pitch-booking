from __future__ import annotations

import uuid
from collections.abc import Callable
from contextlib import suppress
from typing import Annotated, cast

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from backend.app.database import get_database
from backend.app.errors import AppError, ErrorEnvelope
from backend.app.models import VenueOnboardingKind, VenueOnboardingStatus
from backend.app.modules.platform_auth.router import (
    get_current_platform_session,
    require_platform_mutation_session,
)
from backend.app.modules.platform_auth.service import AuthenticatedPlatformSession
from backend.app.modules.platform_onboarding.dto import (
    PlatformOnboardingApplicationDetail,
    PlatformOnboardingDecision,
    PlatformOnboardingDecisionRequest,
    PlatformOnboardingEvidenceDownload,
    PlatformOnboardingQueue,
)
from backend.app.modules.platform_onboarding.repository import (
    PlatformOnboardingRepository,
)
from backend.app.modules.platform_onboarding.service import PlatformOnboardingService
from backend.app.modules.venue_onboarding.storage import VenueOnboardingStore

router = APIRouter(
    prefix="/platform-admin/api/v1/onboarding",
    tags=["platform-onboarding"],
)
REVIEW_ROLES = frozenset({"PLATFORM_ADMIN", "ONBOARDING_REVIEWER"})


def _database_call[T](database: Session, operation: Callable[[], T]) -> T:
    try:
        return operation()
    except SQLAlchemyError:
        with suppress(SQLAlchemyError):
            database.rollback()
        raise AppError(503, "SERVICE_UNAVAILABLE", "入驻审核服务暂不可用。") from None


def _require_role(
    authenticated: AuthenticatedPlatformSession,
) -> AuthenticatedPlatformSession:
    if not (set(authenticated.principal.roles) & REVIEW_ROLES):
        raise AppError(403, "PLATFORM_ROLE_REQUIRED", "当前账号没有入驻审核权限。")
    return authenticated


def require_reviewer(
    authenticated: Annotated[
        AuthenticatedPlatformSession,
        Depends(get_current_platform_session),
    ],
) -> AuthenticatedPlatformSession:
    return _require_role(authenticated)


def require_mutating_reviewer(
    authenticated: Annotated[
        AuthenticatedPlatformSession,
        Depends(require_platform_mutation_session),
    ],
) -> AuthenticatedPlatformSession:
    return _require_role(authenticated)


def _service(request: Request, database: Session) -> PlatformOnboardingService:
    return PlatformOnboardingService(
        repository=PlatformOnboardingRepository(database),
        storage=cast(VenueOnboardingStore, request.app.state.venue_onboarding_store),
        phone_vault=request.app.state.phone_vault,
    )


_COMMON_ERRORS = {
    401: {"model": ErrorEnvelope},
    403: {"model": ErrorEnvelope},
    404: {"model": ErrorEnvelope},
    422: {"model": ErrorEnvelope},
    503: {"model": ErrorEnvelope},
}


@router.get(
    "/applications",
    response_model=PlatformOnboardingQueue,
    responses=_COMMON_ERRORS,
)
def list_applications(
    request: Request,
    database: Annotated[Session, Depends(get_database)],
    _authenticated: Annotated[
        AuthenticatedPlatformSession,
        Depends(require_reviewer),
    ],
    kind: VenueOnboardingKind | None = None,
    status: VenueOnboardingStatus | None = None,
    cursor: str | None = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
) -> PlatformOnboardingQueue:
    return _database_call(
        database,
        lambda: _service(request, database).list_applications(
            kind=kind,
            status=status,
            cursor=cursor,
            limit=limit,
        ),
    )


@router.get(
    "/applications/{application_id}",
    response_model=PlatformOnboardingApplicationDetail,
    responses=_COMMON_ERRORS,
)
def get_application(
    application_id: uuid.UUID,
    request: Request,
    database: Annotated[Session, Depends(get_database)],
    _authenticated: Annotated[
        AuthenticatedPlatformSession,
        Depends(require_reviewer),
    ],
) -> PlatformOnboardingApplicationDetail:
    return _database_call(
        database,
        lambda: _service(request, database).get_application(application_id),
    )


@router.get(
    "/evidence/{evidence_id}/download",
    response_model=PlatformOnboardingEvidenceDownload,
    responses=_COMMON_ERRORS,
)
def create_evidence_download(
    evidence_id: uuid.UUID,
    request: Request,
    database: Annotated[Session, Depends(get_database)],
    _authenticated: Annotated[
        AuthenticatedPlatformSession,
        Depends(require_reviewer),
    ],
) -> PlatformOnboardingEvidenceDownload:
    return _database_call(
        database,
        lambda: _service(request, database).create_evidence_download(evidence_id),
    )


@router.post(
    "/applications/{application_id}/decisions",
    response_model=PlatformOnboardingDecision,
    responses={**_COMMON_ERRORS, 409: {"model": ErrorEnvelope}},
)
def decide_application(
    application_id: uuid.UUID,
    body: PlatformOnboardingDecisionRequest,
    request: Request,
    database: Annotated[Session, Depends(get_database)],
    authenticated: Annotated[
        AuthenticatedPlatformSession,
        Depends(require_mutating_reviewer),
    ],
) -> PlatformOnboardingDecision:
    return _database_call(
        database,
        lambda: _service(request, database).decide(
            application_id=application_id,
            principal_id=authenticated.principal.principal_id,
            request=body,
        ),
    )
