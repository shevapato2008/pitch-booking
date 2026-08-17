from typing import Annotated

from fastapi import APIRouter, Depends, Header, Request, Response, Security
from fastapi.security import APIKeyCookie
from sqlalchemy.orm import Session

from backend.app.database import get_database
from backend.app.errors import ErrorEnvelope
from backend.app.modules.platform_auth.dto import (
    PlatformSessionExchange,
    PlatformSessionResponse,
)
from backend.app.modules.platform_auth.repository import PlatformAuthRepository
from backend.app.modules.platform_auth.service import (
    SESSION_COOKIE,
    SESSION_TTL,
    AuthenticatedPlatformSession,
    PlatformAuthService,
)

router = APIRouter(prefix="/platform-admin/api/v1/auth", tags=["platform-auth"])
_session_cookie = APIKeyCookie(
    name=SESSION_COOKIE,
    scheme_name="platformSession",
    auto_error=False,
)


def _service(request: Request, database: Session) -> PlatformAuthService:
    return PlatformAuthService(
        repository=PlatformAuthRepository(database),
        settings=request.app.state.settings,
    )


def get_current_platform_session(
    request: Request,
    database: Annotated[Session, Depends(get_database)],
    session_token: Annotated[str | None, Security(_session_cookie)],
) -> AuthenticatedPlatformSession:
    return _service(request, database).authenticate_session(session_token)


def require_platform_mutation_session(
    request: Request,
    database: Annotated[Session, Depends(get_database)],
    authenticated: Annotated[
        AuthenticatedPlatformSession,
        Depends(get_current_platform_session),
    ],
    origin: Annotated[str | None, Header(alias="Origin")] = None,
    csrf_token: Annotated[str | None, Header(alias="X-CSRF-Token")] = None,
) -> AuthenticatedPlatformSession:
    _service(request, database).validate_mutation(
        request,
        authenticated,
        origin=origin,
        csrf_token=csrf_token,
    )
    return authenticated


@router.post(
    "/session",
    response_model=PlatformSessionResponse,
    responses={
        401: {"model": ErrorEnvelope},
        422: {"model": ErrorEnvelope},
        503: {"model": ErrorEnvelope},
    },
)
def create_platform_session(
    body: PlatformSessionExchange,
    response: Response,
    request: Request,
    database: Annotated[Session, Depends(get_database)],
) -> PlatformSessionResponse:
    raw_session_token, authenticated = _service(
        request, database
    ).exchange_access_token(body.access_token)
    response.set_cookie(
        key=SESSION_COOKIE,
        value=raw_session_token,
        max_age=int(SESSION_TTL.total_seconds()),
        expires=authenticated.record.expires_at,
        path="/platform-admin",
        secure=True,
        httponly=True,
        samesite="strict",
    )
    return authenticated.response()


@router.get(
    "/session",
    response_model=PlatformSessionResponse,
    responses={401: {"model": ErrorEnvelope}, 503: {"model": ErrorEnvelope}},
)
def get_platform_session(
    authenticated: Annotated[
        AuthenticatedPlatformSession,
        Depends(get_current_platform_session),
    ],
) -> PlatformSessionResponse:
    return authenticated.response()


@router.delete(
    "/session",
    status_code=204,
    responses={
        401: {"model": ErrorEnvelope},
        403: {"model": ErrorEnvelope},
        503: {"model": ErrorEnvelope},
    },
)
def delete_platform_session(
    response: Response,
    request: Request,
    database: Annotated[Session, Depends(get_database)],
    authenticated: Annotated[
        AuthenticatedPlatformSession,
        Depends(require_platform_mutation_session),
    ],
) -> None:
    _service(request, database).logout(authenticated)
    response.delete_cookie(
        key=SESSION_COOKIE,
        path="/platform-admin",
        secure=True,
        httponly=True,
        samesite="strict",
    )
