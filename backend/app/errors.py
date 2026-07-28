import logging
from typing import Any

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

logger = logging.getLogger(__name__)


class ErrorBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    message: str
    request_id: str
    details: dict[str, Any]


class ErrorEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    error: ErrorBody


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


async def request_validation_error_handler(
    request: Request,
    error: Exception,
) -> JSONResponse:
    if not isinstance(error, RequestValidationError):
        raise TypeError(
            "request_validation_error_handler requires RequestValidationError"
        )
    return _response(
        request,
        422,
        "INVALID_ARGUMENT",
        "请求参数格式不正确，请检查后重试。",
    )


async def unexpected_error_handler(request: Request, _error: Exception) -> JSONResponse:
    logger.error("Unhandled request error request_id=%s", _request_id(request))
    return _response(request, 500, "INTERNAL_ERROR", "服务内部错误")
