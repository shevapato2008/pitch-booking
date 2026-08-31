"""Registrant-owned open-game report HTTP routes."""

from __future__ import annotations

import re
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from backend.app.database import get_database
from backend.app.errors import AppError, ErrorEnvelope, app_error_handler
from backend.app.models import User
from backend.app.modules.open_game_reports.dto import (
    OpenGameReportContext,
    OpenGameReportForReporter,
    OpenGameReportSubmissionRequest,
)
from backend.app.modules.open_game_reports.repository import OpenGameReportRepository
from backend.app.modules.open_game_reports.service import OpenGameReportService
from backend.app.modules.open_games.router import get_open_game_current_user

router = APIRouter(tags=["open-game-reports"])

_SUBMIT_PATH = re.compile(r"^/api/v1/games/[^/]+/reports$")
_SUBMIT_FIELDS = frozenset({"category", "facts"})


def _utc_now() -> datetime:
    return datetime.now(UTC)


def get_open_game_report_clock() -> Callable[[], datetime]:
    return _utc_now


def get_required_open_game_report_user(
    user: Annotated[User, Depends(get_open_game_current_user)],
) -> User:
    return user


def is_open_game_report_mutation_request(request: Request) -> bool:
    return request.method == "POST" and _SUBMIT_PATH.fullmatch(request.url.path) is not None


async def open_game_report_request_validation_handler(
    request: Request,
    error: RequestValidationError,
) -> JSONResponse:
    fields: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in error.errors():
        location = item.get("loc", ())
        if (
            len(location) < 2
            or location[0] != "body"
            or not isinstance(location[1], str)
            or location[1] not in _SUBMIT_FIELDS
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
) -> OpenGameReportService:
    return OpenGameReportService(
        repository=OpenGameReportRepository(database),
        now=clock,
    )


@router.get(
    "/api/v1/games/{game_id}/my-report",
    operation_id="getMyOpenGameReport",
    response_model=OpenGameReportContext,
    responses={
        401: {"model": ErrorEnvelope},
        404: {"model": ErrorEnvelope},
        422: {"model": ErrorEnvelope},
        503: {"model": ErrorEnvelope},
    },
)
def get_my_open_game_report(
    game_id: uuid.UUID,
    user: Annotated[User, Depends(get_required_open_game_report_user)],
    database: Annotated[Session, Depends(get_database)],
    clock: Annotated[Callable[[], datetime], Depends(get_open_game_report_clock)],
) -> OpenGameReportContext:
    return _service(database, clock=clock).get_my_report(
        game_id=game_id,
        reporter_user_id=user.id,
    )


@router.post(
    "/api/v1/games/{game_id}/reports",
    operation_id="submitOpenGameReport",
    response_model=OpenGameReportForReporter,
    responses={
        200: {"model": OpenGameReportForReporter},
        201: {"model": OpenGameReportForReporter},
        401: {"model": ErrorEnvelope},
        404: {"model": ErrorEnvelope},
        409: {"model": ErrorEnvelope},
        422: {"model": ErrorEnvelope},
        503: {"model": ErrorEnvelope},
    },
)
def submit_open_game_report(
    response: Response,
    game_id: uuid.UUID,
    body: OpenGameReportSubmissionRequest,
    idempotency_key: Annotated[
        str,
        Header(alias="Idempotency-Key", min_length=16, max_length=128),
    ],
    user: Annotated[User, Depends(get_required_open_game_report_user)],
    database: Annotated[Session, Depends(get_database)],
    clock: Annotated[Callable[[], datetime], Depends(get_open_game_report_clock)],
) -> OpenGameReportForReporter:
    result = _service(database, clock=clock).submit(
        game_id=game_id,
        reporter_user_id=user.id,
        idempotency_key=idempotency_key,
        request=body,
    )
    response.status_code = 201 if result.created else 200
    return result.report


def align_open_game_reports_openapi(schema: dict[str, Any]) -> None:
    """Align generated authentication metadata with the frozen contract."""
    for path, method in (
        ("/api/v1/games/{game_id}/my-report", "get"),
        ("/api/v1/games/{game_id}/reports", "post"),
    ):
        operation = schema["paths"][path][method]
        operation["security"] = [{"bearerAuth": []}]
        operation.pop("summary", None)
