from __future__ import annotations

import json
import uuid
from collections.abc import Callable
from typing import Annotated, cast

from fastapi import APIRouter, Depends, Header, Query, Request, Response
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from backend.app.database import get_database
from backend.app.errors import AppError, ErrorEnvelope
from backend.app.models import User
from backend.app.modules.auth.router import get_current_user, get_phone_vault
from backend.app.modules.venue_onboarding.dto import (
    CreateVenueOnboardingUploadIntent,
    SubmitVenueClaim,
    SubmitVenueCreate,
    VenueOnboardingApplicationResponse,
    VenueOnboardingApplications,
    VenueOnboardingCandidates,
    VenueOnboardingEvidenceClosed,
    VenueOnboardingUploadIntent,
)
from backend.app.modules.venue_onboarding.repository import VenueOnboardingRepository
from backend.app.modules.venue_onboarding.service import VenueOnboardingService
from backend.app.modules.venue_onboarding.storage import (
    PrivateStorageUnavailableError,
    VenueOnboardingStore,
)
from backend.app.security.phone_vault import PhoneVault, PhoneVaultError

router = APIRouter(prefix="/api/v1/venue-onboarding", tags=["venue-onboarding"])
IdempotencyKey = Annotated[
    str,
    Header(alias="Idempotency-Key", min_length=16, max_length=128),
]


def get_onboarding_store(request: Request) -> VenueOnboardingStore:
    return cast(VenueOnboardingStore, request.app.state.venue_onboarding_store)


def _service(
    database: Session,
    storage: VenueOnboardingStore,
    phone_vault: PhoneVault | None,
) -> VenueOnboardingService:
    return VenueOnboardingService(
        repository=VenueOnboardingRepository(database),
        storage=storage,
        phone_vault=phone_vault,
    )


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


def _available[Result](action: Callable[[], Result]) -> Result:
    try:
        return action()
    except (SQLAlchemyError, PrivateStorageUnavailableError, PhoneVaultError):
        raise AppError(503, "SERVICE_UNAVAILABLE", "服务暂时不可用") from None


@router.get(
    "/candidates",
    response_model=VenueOnboardingCandidates,
    responses={
        401: {"model": ErrorEnvelope},
        422: {"model": ErrorEnvelope},
        503: {"model": ErrorEnvelope},
    },
)
def search_candidates(
    user: Annotated[User, Depends(get_current_user)],
    database: Annotated[Session, Depends(get_database)],
    storage: Annotated[VenueOnboardingStore, Depends(get_onboarding_store)],
    phone_vault: Annotated[PhoneVault | None, Depends(get_phone_vault)],
    q: Annotated[str, Query(min_length=2, max_length=80)],
    cursor: str | None = None,
    limit: Annotated[int, Query(ge=1, le=20)] = 20,
) -> VenueOnboardingCandidates:
    del user
    return _available(
        lambda: _service(database, storage, phone_vault).search_candidates(
            query=q,
            cursor=cursor,
            limit=limit,
        )
    )


@router.post(
    "/evidence/upload-intents",
    response_model=VenueOnboardingUploadIntent,
    status_code=201,
    responses={
        200: {"model": VenueOnboardingUploadIntent},
        401: {"model": ErrorEnvelope},
        409: {"model": ErrorEnvelope},
        422: {"model": ErrorEnvelope},
        503: {"model": ErrorEnvelope},
    },
)
def create_upload_intent(
    request_body: CreateVenueOnboardingUploadIntent,
    user: Annotated[User, Depends(get_current_user)],
    database: Annotated[Session, Depends(get_database)],
    storage: Annotated[VenueOnboardingStore, Depends(get_onboarding_store)],
    phone_vault: Annotated[PhoneVault | None, Depends(get_phone_vault)],
    idempotency_key: IdempotencyKey,
) -> Response:
    result = _available(
        lambda: _service(database, storage, phone_vault).create_upload_intent(
            user=user,
            idempotency_key=idempotency_key,
            request=request_body,
        )
    )
    return _json_response(result.status_code, result.body)


@router.post(
    "/evidence/{evidence_id}/complete",
    response_model=VenueOnboardingEvidenceClosed,
    responses={
        401: {"model": ErrorEnvelope},
        404: {"model": ErrorEnvelope},
        409: {"model": ErrorEnvelope},
        422: {"model": ErrorEnvelope},
        503: {"model": ErrorEnvelope},
    },
)
def complete_evidence(
    evidence_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    database: Annotated[Session, Depends(get_database)],
    storage: Annotated[VenueOnboardingStore, Depends(get_onboarding_store)],
    phone_vault: Annotated[PhoneVault | None, Depends(get_phone_vault)],
    idempotency_key: IdempotencyKey,
) -> Response:
    result = _available(
        lambda: _service(database, storage, phone_vault).complete_evidence(
            user=user,
            evidence_id=evidence_id,
            idempotency_key=idempotency_key,
        )
    )
    return _json_response(result.status_code, result.body)


@router.post(
    "/claims",
    response_model=VenueOnboardingApplicationResponse,
    status_code=201,
    responses={
        200: {"model": VenueOnboardingApplicationResponse},
        401: {"model": ErrorEnvelope},
        409: {"model": ErrorEnvelope},
        422: {"model": ErrorEnvelope},
        503: {"model": ErrorEnvelope},
    },
)
def submit_claim(
    request_body: SubmitVenueClaim,
    user: Annotated[User, Depends(get_current_user)],
    database: Annotated[Session, Depends(get_database)],
    storage: Annotated[VenueOnboardingStore, Depends(get_onboarding_store)],
    phone_vault: Annotated[PhoneVault | None, Depends(get_phone_vault)],
    idempotency_key: IdempotencyKey,
) -> Response:
    result = _available(
        lambda: _service(database, storage, phone_vault).submit_claim(
            user=user,
            idempotency_key=idempotency_key,
            request=request_body,
        )
    )
    return _json_response(result.status_code, result.body)


@router.post(
    "/venues",
    response_model=VenueOnboardingApplicationResponse,
    status_code=201,
    responses={
        200: {"model": VenueOnboardingApplicationResponse},
        401: {"model": ErrorEnvelope},
        409: {"model": ErrorEnvelope},
        422: {"model": ErrorEnvelope},
        503: {"model": ErrorEnvelope},
    },
)
def submit_create(
    request_body: SubmitVenueCreate,
    user: Annotated[User, Depends(get_current_user)],
    database: Annotated[Session, Depends(get_database)],
    storage: Annotated[VenueOnboardingStore, Depends(get_onboarding_store)],
    phone_vault: Annotated[PhoneVault | None, Depends(get_phone_vault)],
    idempotency_key: IdempotencyKey,
) -> Response:
    result = _available(
        lambda: _service(database, storage, phone_vault).submit_create(
            user=user,
            idempotency_key=idempotency_key,
            request=request_body,
        )
    )
    return _json_response(result.status_code, result.body)


@router.get(
    "/applications",
    response_model=VenueOnboardingApplications,
    responses={
        401: {"model": ErrorEnvelope},
        422: {"model": ErrorEnvelope},
        503: {"model": ErrorEnvelope},
    },
)
def list_applications(
    user: Annotated[User, Depends(get_current_user)],
    database: Annotated[Session, Depends(get_database)],
    storage: Annotated[VenueOnboardingStore, Depends(get_onboarding_store)],
    phone_vault: Annotated[PhoneVault | None, Depends(get_phone_vault)],
    cursor: str | None = None,
    limit: Annotated[int, Query(ge=1, le=20)] = 20,
) -> VenueOnboardingApplications:
    return _available(
        lambda: _service(database, storage, phone_vault).list_applications(
            user_id=user.id,
            cursor=cursor,
            limit=limit,
        )
    )
