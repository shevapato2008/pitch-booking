from datetime import timedelta
from typing import Annotated, cast

from fastapi import APIRouter, Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from backend.app.database import get_database
from backend.app.errors import ErrorEnvelope
from backend.app.models import User
from backend.app.modules.auth.dto import (
    PhoneVerificationResponse,
    WeChatCodeRequest,
    WeChatSessionResponse,
)
from backend.app.modules.auth.provider import IdentityProvider, PhoneProvider
from backend.app.modules.auth.repository import AuthRepository
from backend.app.modules.auth.service import AuthService, resolve_authenticated_user
from backend.app.security.phone_vault import PhoneVault

router = APIRouter(prefix="/api/v1/auth/wechat", tags=["auth"])
_bearer = HTTPBearer(auto_error=False)


def get_identity_provider(request: Request) -> IdentityProvider:
    return cast(IdentityProvider, request.app.state.identity_provider)


def get_phone_provider(request: Request) -> PhoneProvider:
    return cast(PhoneProvider, request.app.state.phone_provider)


def get_phone_vault(request: Request) -> PhoneVault | None:
    return cast(PhoneVault | None, request.app.state.phone_vault)


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
