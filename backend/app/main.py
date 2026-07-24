from typing import Annotated

from fastapi import Depends, FastAPI
from sqlalchemy import text
from sqlalchemy.engine import Connection

from backend.app.database import get_database
from backend.app.errors import AppError, app_error_handler, unexpected_error_handler
from backend.app.request_id import RequestIdMiddleware


def create_app(*, include_test_routes: bool = False) -> FastAPI:
    application = FastAPI(title="Pitch Booking API", version="0.1.0")
    application.add_middleware(RequestIdMiddleware)
    application.add_exception_handler(AppError, app_error_handler)
    application.add_exception_handler(Exception, unexpected_error_handler)

    @application.get("/api/v1/health")
    def health(database: Annotated[Connection, Depends(get_database)]) -> dict[str, str]:
        try:
            database.execute(text("SELECT 1"))
        except Exception:
            raise AppError(503, "SERVICE_UNAVAILABLE", "服务暂时不可用") from None
        return {"status": "ok"}

    if include_test_routes:

        @application.get("/__test__/known-error")
        def known_error() -> None:
            raise AppError(400, "INVALID_ARGUMENT", "请求参数无效")

        @application.get("/__test__/unexpected-error")
        def unexpected_error() -> None:
            raise RuntimeError("database-password")

    return application


app = create_app()
