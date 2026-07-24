import logging
from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)


class AppError(Exception):
    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(code)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details or {}


def _request_id(request: Request) -> str:
    return str(request.state.request_id)


def _response(request: Request, status_code: int, code: str, message: str) -> JSONResponse:
    request_id = _request_id(request)
    return JSONResponse(
        status_code=status_code,
        headers={"X-Request-Id": request_id},
        content={
            "error": {
                "code": code,
                "message": message,
                "request_id": request_id,
                "details": {},
            }
        },
    )


async def app_error_handler(request: Request, error: Exception) -> JSONResponse:
    if not isinstance(error, AppError):
        raise TypeError("app_error_handler requires AppError")
    request_id = _request_id(request)
    return JSONResponse(
        status_code=error.status_code,
        headers={"X-Request-Id": request_id},
        content={
            "error": {
                "code": error.code,
                "message": error.message,
                "request_id": request_id,
                "details": error.details,
            }
        },
    )


async def unexpected_error_handler(request: Request, _error: Exception) -> JSONResponse:
    logger.error("Unhandled request error request_id=%s", _request_id(request))
    return _response(request, 500, "INTERNAL_ERROR", "服务内部错误")
