from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.openapi.utils import get_openapi
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.app.config import Settings
from backend.app.database import get_database
from backend.app.errors import (
    AppError,
    app_error_handler,
    request_validation_error_handler,
    unexpected_error_handler,
)
from backend.app.modules.auth.provider import build_providers
from backend.app.modules.auth.router import router as auth_router
from backend.app.modules.availability.router import router as availability_router
from backend.app.modules.checkout.router import router as checkout_router
from backend.app.modules.inventory.router import router as inventory_router
from backend.app.modules.orders.router import router as orders_router
from backend.app.modules.payments.development_router import router as development_payment_router
from backend.app.modules.payments.mock_provider import MockPaymentProvider
from backend.app.modules.payments.router import router as payments_router
from backend.app.modules.venues.router import router as venues_router
from backend.app.request_id import RequestIdMiddleware
from backend.app.security.phone_vault import PhoneVault


def create_app(*, include_test_routes: bool = False, settings: Settings | None = None) -> FastAPI:
    resolved_settings = settings or Settings()
    phone_vault = (
        PhoneVault(
            key_base64=resolved_settings.phone_encryption_key_base64.get_secret_value(),
            key_version=resolved_settings.phone_encryption_key_version,
        )
        if resolved_settings.phone_encryption_key_base64 is not None
        else None
    )
    provider_bundle = build_providers(resolved_settings)
    payment_provider = (
        MockPaymentProvider() if resolved_settings.mock_payment_provider_enabled else None
    )

    @asynccontextmanager
    async def lifespan(_application: FastAPI) -> AsyncIterator[None]:
        try:
            yield
        finally:
            provider_bundle.close()

    try:
        application = FastAPI(title="Pitch Booking API", version="0.1.0", lifespan=lifespan)
        application.add_middleware(
            RequestIdMiddleware,
            app_revision=resolved_settings.app_revision,
        )
        application.add_exception_handler(AppError, app_error_handler)
        application.add_exception_handler(
            RequestValidationError,
            request_validation_error_handler,
        )
        application.add_exception_handler(Exception, unexpected_error_handler)
        application.state.settings = resolved_settings
        application.state.identity_provider = provider_bundle.identity_provider
        application.state.phone_provider = provider_bundle.phone_provider
        application.state.phone_vault = phone_vault
        application.state.provider_bundle = provider_bundle
        application.state.payment_provider = payment_provider
        application.include_router(auth_router)
        application.include_router(availability_router)
        application.include_router(checkout_router)
        application.include_router(inventory_router)
        application.include_router(orders_router)
        application.include_router(payments_router)
        if resolved_settings.mock_payment_provider_enabled:
            application.include_router(development_payment_router)
        application.include_router(venues_router)
    except BaseException:
        provider_bundle.close()
        raise

    @application.get("/api/v1/health")
    def health(database: Annotated[Session, Depends(get_database)]) -> dict[str, str]:
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

    def frozen_runtime_openapi() -> dict[str, object]:
        if application.openapi_schema is None:
            schema = get_openapi(
                title=application.title,
                version=application.version,
                routes=application.routes,
            )
            for path in (
                "/api/v1/orders/{order_id}/pay",
                "/api/v1/orders/{order_id}/payments/{payment_id}/reconcile",
            ):
                operation = schema.get("paths", {}).get(path, {}).get("post", {})
                operation.get("responses", {}).pop("422", None)
            application.openapi_schema = schema
        return application.openapi_schema

    setattr(application, "openapi", frozen_runtime_openapi)  # noqa: B010

    return application


app = create_app()
