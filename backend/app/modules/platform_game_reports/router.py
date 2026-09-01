from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, Query
from sqlalchemy.orm import Session

from backend.app.database import get_database
from backend.app.errors import AppError, ErrorEnvelope
from backend.app.modules.open_game_reports.dto import OpenGameReportStatus
from backend.app.modules.platform_auth.router import (
    get_current_platform_session,
    require_platform_mutation_session,
)
from backend.app.modules.platform_auth.service import AuthenticatedPlatformSession
from backend.app.modules.platform_game_reports.dto import (
    PlatformGameReportDetail,
    PlatformGameReportList,
    PlatformGameReportResolution,
    PlatformGameReportResolutionRequest,
)
from backend.app.modules.platform_game_reports.repository import (
    PlatformGameReportRepository,
)
from backend.app.modules.platform_game_reports.service import PlatformGameReportService

router = APIRouter(
    prefix="/platform-admin/api/v1/game-reports",
    tags=["platform-game-reports"],
)


def get_platform_game_report_clock() -> datetime:
    return datetime.now(UTC)


def _require_platform_admin(
    authenticated: AuthenticatedPlatformSession,
) -> AuthenticatedPlatformSession:
    if "PLATFORM_ADMIN" not in authenticated.principal.roles:
        raise AppError(403, "PLATFORM_ROLE_REQUIRED", "当前账号没有举报处置权限。")
    return authenticated


def require_platform_game_report_admin(
    authenticated: Annotated[
        AuthenticatedPlatformSession,
        Depends(get_current_platform_session),
    ],
) -> AuthenticatedPlatformSession:
    return _require_platform_admin(authenticated)


def require_mutating_platform_game_report_admin(
    authenticated: Annotated[
        AuthenticatedPlatformSession,
        Depends(require_platform_mutation_session),
    ],
) -> AuthenticatedPlatformSession:
    return _require_platform_admin(authenticated)


def _service(database: Session, now: datetime) -> PlatformGameReportService:
    return PlatformGameReportService(
        repository=PlatformGameReportRepository(database),
        now=lambda: now,
    )


_BASE_ERRORS: dict[int | str, dict[str, Any]] = {
    401: {"model": ErrorEnvelope},
    403: {"model": ErrorEnvelope},
    422: {"model": ErrorEnvelope},
    503: {"model": ErrorEnvelope},
}


@router.get(
    "",
    operation_id="listPlatformGameReports",
    response_model=PlatformGameReportList,
    responses=_BASE_ERRORS,
)
def list_platform_game_reports(
    database: Annotated[Session, Depends(get_database)],
    _authenticated: Annotated[
        AuthenticatedPlatformSession,
        Depends(require_platform_game_report_admin),
    ],
    now: Annotated[datetime, Depends(get_platform_game_report_clock)],
    state: Annotated[OpenGameReportStatus, Query()] = OpenGameReportStatus.PENDING,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    cursor: Annotated[str | None, Query(min_length=1, max_length=1024)] = None,
) -> PlatformGameReportList:
    return _service(database, now).list_reports(
        state=state,
        limit=limit,
        cursor=cursor,
    )


@router.get(
    "/{report_id}",
    operation_id="getPlatformGameReport",
    response_model=PlatformGameReportDetail,
    responses={**_BASE_ERRORS, 404: {"model": ErrorEnvelope}},
)
def get_platform_game_report(
    report_id: uuid.UUID,
    database: Annotated[Session, Depends(get_database)],
    _authenticated: Annotated[
        AuthenticatedPlatformSession,
        Depends(require_platform_game_report_admin),
    ],
    now: Annotated[datetime, Depends(get_platform_game_report_clock)],
) -> PlatformGameReportDetail:
    return _service(database, now).get_report(report_id)


@router.post(
    "/{report_id}/resolution",
    operation_id="resolvePlatformGameReport",
    response_model=PlatformGameReportResolution,
    responses={**_BASE_ERRORS, 404: {"model": ErrorEnvelope}, 409: {"model": ErrorEnvelope}},
)
def resolve_platform_game_report(
    report_id: uuid.UUID,
    body: PlatformGameReportResolutionRequest,
    database: Annotated[Session, Depends(get_database)],
    authenticated: Annotated[
        AuthenticatedPlatformSession,
        Depends(require_mutating_platform_game_report_admin),
    ],
    now: Annotated[datetime, Depends(get_platform_game_report_clock)],
    idempotency_key: Annotated[
        str,
        Header(alias="Idempotency-Key", min_length=16, max_length=128),
    ],
) -> PlatformGameReportResolution:
    return _service(database, now).resolve(
        report_id=report_id,
        principal_id=authenticated.principal.principal_id,
        idempotency_key=idempotency_key,
        request=body,
    )


def align_platform_game_reports_openapi(schema: dict[str, Any]) -> None:
    for path, method in (
        ("/platform-admin/api/v1/game-reports", "get"),
        ("/platform-admin/api/v1/game-reports/{report_id}", "get"),
        ("/platform-admin/api/v1/game-reports/{report_id}/resolution", "post"),
    ):
        operation = schema["paths"][path][method]
        operation["security"] = [{"platformSession": []}]
        operation.pop("summary", None)
