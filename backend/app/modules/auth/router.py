from datetime import timedelta
from typing import Annotated, cast

from fastapi import APIRouter, Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from backend.app.database import get_database
from backend.app.errors import ErrorEnvelope
from backend.app.models import User
from backend.app.modules.auth.dto import (
    CreateUserAvatarUploadIntentRequest,
    PhoneVerificationResponse,
    UpdateUserPublicProfileRequest,
    UserAvatarUploadIntentResponse,
    UserPublicProfileResponse,
    WeChatCodeRequest,
    WeChatSessionResponse,
)
from backend.app.modules.auth.provider import IdentityProvider, PhoneProvider
from backend.app.modules.auth.repository import AuthRepository
from backend.app.modules.auth.service import AuthService, resolve_authenticated_user
from backend.app.modules.venue_profiles.storage import VenueMediaStore
from backend.app.security.phone_vault import PhoneVault

router = APIRouter(prefix="/api/v1/auth/wechat", tags=["auth"])
_bearer = HTTPBearer(auto_error=False)


def get_identity_provider(request: Request) -> IdentityProvider:
    return cast(IdentityProvider, request.app.state.identity_provider)


def get_phone_provider(request: Request) -> PhoneProvider:
    return cast(PhoneProvider, request.app.state.phone_provider)


def get_phone_vault(request: Request) -> PhoneVault | None:
    return cast(PhoneVault | None, request.app.state.phone_vault)


def get_media_store(request: Request) -> VenueMediaStore:
    return cast(VenueMediaStore, request.app.state.venue_media_store)


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    database: Annotated[Session, Depends(get_database)],
) -> User:
    token = (
        credentials.credentials
        if credentials is not None and credentials.scheme.casefold() == "bearer"
        else None
    )
    return resolve_authenticated_user(AuthRepository(database), token)


@router.post(
    "/session",
    response_model=WeChatSessionResponse,
    responses={422: {"model": ErrorEnvelope}},
)
def create_wechat_session(
    request: WeChatCodeRequest,
    database: Annotated[Session, Depends(get_database)],
    identity_provider: Annotated[IdentityProvider, Depends(get_identity_provider)],
    phone_provider: Annotated[PhoneProvider, Depends(get_phone_provider)],
    phone_vault: Annotated[PhoneVault | None, Depends(get_phone_vault)],
    app_request: Request,
) -> WeChatSessionResponse:
    return AuthService(
        repository=AuthRepository(database),
        identity_provider=identity_provider,
        phone_provider=phone_provider,
        phone_vault=phone_vault,
        session_ttl=timedelta(days=app_request.app.state.settings.session_ttl_days),
    ).create_session(request.code)


@router.post(
    "/phone",
    response_model=PhoneVerificationResponse,
    responses={422: {"model": ErrorEnvelope}},
)
def verify_wechat_phone(
    request: WeChatCodeRequest,
    user: Annotated[User, Depends(get_current_user)],
    database: Annotated[Session, Depends(get_database)],
    identity_provider: Annotated[IdentityProvider, Depends(get_identity_provider)],
    phone_provider: Annotated[PhoneProvider, Depends(get_phone_provider)],
    phone_vault: Annotated[PhoneVault | None, Depends(get_phone_vault)],
    app_request: Request,
) -> PhoneVerificationResponse:
    return AuthService(
        repository=AuthRepository(database),
        identity_provider=identity_provider,
        phone_provider=phone_provider,
        phone_vault=phone_vault,
        session_ttl=timedelta(days=app_request.app.state.settings.session_ttl_days),
    ).verify_phone(user.id, request.code)


def _profile_service(
    *,
    database: Session,
    app_request: Request,
    identity_provider: IdentityProvider,
    phone_provider: PhoneProvider,
    phone_vault: PhoneVault | None,
    media_store: VenueMediaStore,
) -> AuthService:
    return AuthService(
        repository=AuthRepository(database),
        identity_provider=identity_provider,
        phone_provider=phone_provider,
        phone_vault=phone_vault,
        session_ttl=timedelta(days=app_request.app.state.settings.session_ttl_days),
        media_store=media_store,
    )


@router.get(
    "/profile",
    response_model=UserPublicProfileResponse,
    responses={401: {"model": ErrorEnvelope}, 503: {"model": ErrorEnvelope}},
    operation_id="getWechatPublicProfile",
)
def get_wechat_public_profile(
    user: Annotated[User, Depends(get_current_user)],
    database: Annotated[Session, Depends(get_database)],
    identity_provider: Annotated[IdentityProvider, Depends(get_identity_provider)],
    phone_provider: Annotated[PhoneProvider, Depends(get_phone_provider)],
    phone_vault: Annotated[PhoneVault | None, Depends(get_phone_vault)],
    media_store: Annotated[VenueMediaStore, Depends(get_media_store)],
    app_request: Request,
) -> UserPublicProfileResponse:
    return _profile_service(
        database=database,
        app_request=app_request,
        identity_provider=identity_provider,
        phone_provider=phone_provider,
        phone_vault=phone_vault,
        media_store=media_store,
    ).get_public_profile(user.id)


@router.post(
    "/profile/avatar/upload-intents",
    status_code=201,
    response_model=UserAvatarUploadIntentResponse,
    responses={
        401: {"model": ErrorEnvelope},
        422: {"model": ErrorEnvelope},
        503: {"model": ErrorEnvelope},
    },
    operation_id="createWechatAvatarUploadIntent",
)
def create_wechat_avatar_upload_intent(
    body: CreateUserAvatarUploadIntentRequest,
    user: Annotated[User, Depends(get_current_user)],
    database: Annotated[Session, Depends(get_database)],
    identity_provider: Annotated[IdentityProvider, Depends(get_identity_provider)],
    phone_provider: Annotated[PhoneProvider, Depends(get_phone_provider)],
    phone_vault: Annotated[PhoneVault | None, Depends(get_phone_vault)],
    media_store: Annotated[VenueMediaStore, Depends(get_media_store)],
    app_request: Request,
) -> UserAvatarUploadIntentResponse:
    return _profile_service(
        database=database,
        app_request=app_request,
        identity_provider=identity_provider,
        phone_provider=phone_provider,
        phone_vault=phone_vault,
        media_store=media_store,
    ).create_avatar_upload_intent(user_id=user.id, request=body)


@router.put(
    "/profile",
    response_model=UserPublicProfileResponse,
    responses={
        401: {"model": ErrorEnvelope},
        422: {"model": ErrorEnvelope},
        503: {"model": ErrorEnvelope},
    },
    operation_id="updateWechatPublicProfile",
)
def update_wechat_public_profile(
    body: UpdateUserPublicProfileRequest,
    user: Annotated[User, Depends(get_current_user)],
    database: Annotated[Session, Depends(get_database)],
    identity_provider: Annotated[IdentityProvider, Depends(get_identity_provider)],
    phone_provider: Annotated[PhoneProvider, Depends(get_phone_provider)],
    phone_vault: Annotated[PhoneVault | None, Depends(get_phone_vault)],
    media_store: Annotated[VenueMediaStore, Depends(get_media_store)],
    app_request: Request,
) -> UserPublicProfileResponse:
    return _profile_service(
        database=database,
        app_request=app_request,
        identity_provider=identity_provider,
        phone_provider=phone_provider,
        phone_vault=phone_vault,
        media_store=media_store,
    ).update_public_profile(user_id=user.id, request=body)
