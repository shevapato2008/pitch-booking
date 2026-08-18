from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.openapi.utils import get_openapi
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.app.config import Settings
from backend.app.database import get_database, get_engine
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
from backend.app.modules.orders.router import align_order_list_openapi
from backend.app.modules.orders.router import router as orders_router
from backend.app.modules.payments import build_payment_provider
from backend.app.modules.payments.convergence import PaymentConvergenceService
from backend.app.modules.payments.development_router import router as development_payment_router
from backend.app.modules.payments.repository import PaymentRepository
from backend.app.modules.payments.router import router as payments_router
from backend.app.modules.pitch_configuration.router import router as pitch_configuration_router
from backend.app.modules.platform_auth.router import router as platform_auth_router
from backend.app.modules.platform_onboarding.router import router as platform_onboarding_router
from backend.app.modules.platform_web import (
    PlatformAdminSecurityHeadersMiddleware,
    create_platform_web_router,
    default_platform_admin_root,
)
from backend.app.modules.refunds.convergence import RefundConvergenceService
from backend.app.modules.refunds.repository import RefundRepository
from backend.app.modules.venue_access.router import router as venue_access_router
from backend.app.modules.venue_fulfillment.router import (
    router as venue_fulfillment_router,
)
from backend.app.modules.venue_onboarding.oss_storage import OssOnboardingStorage
from backend.app.modules.venue_onboarding.router import router as venue_onboarding_router
from backend.app.modules.venue_onboarding.storage import (
    MemoryOnboardingStorage,
    UnavailableOnboardingStorage,
    VenueOnboardingStore,
)
from backend.app.modules.venue_profiles.local_storage import LocalMediaStorage
from backend.app.modules.venue_profiles.oss_storage import OssMediaStorage
from backend.app.modules.venue_profiles.router import (
    manual_router as venue_profile_manual_router,
)
from backend.app.modules.venue_profiles.router import (
    profile_request_validation_handler,
)
from backend.app.modules.venue_profiles.router import (
    router as venue_profiles_router,
)
from backend.app.modules.venue_profiles.storage import VenueMediaStore
from backend.app.modules.venues.router import router as venues_router
from backend.app.modules.wechat_pay.notifications import (
    WeChatPayPaymentNotificationService,
    WeChatPayRefundNotificationService,
)
from backend.app.modules.wechat_pay.router import router as wechat_pay_router
from backend.app.request_id import RequestIdMiddleware
from backend.app.security.phone_vault import PhoneVault


def create_app(
    *,
    include_test_routes: bool = False,
    settings: Settings | None = None,
    venue_media_store: VenueMediaStore | None = None,
    venue_onboarding_store: VenueOnboardingStore | None = None,
    platform_admin_root: Path | None = None,
) -> FastAPI:
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
        build_payment_provider(resolved_settings)
        if resolved_settings.mock_payment_provider_enabled
        or resolved_settings.wechat_payment_configured
        else None
    )
    payment_notification_service = None
    refund_notification_service = None
    notification_adapter_factory = getattr(payment_provider, "notification_adapter", None)
    if notification_adapter_factory is not None:

        def session_factory() -> Session:
            return Session(get_engine())

        notification_adapter = notification_adapter_factory()
        payment_convergence = PaymentConvergenceService(
            session_factory=session_factory,
            expected_app_id=payment_provider.app_id,
            expected_merchant_id=payment_provider.merchant_id,
        )
        refund_convergence = RefundConvergenceService(
            session_factory=session_factory,
            expected_merchant_id=payment_provider.merchant_id,
        )

        def locate_payment(provider: str, merchant_order_no: str):  # type: ignore[no-untyped-def]
            with session_factory() as session:
                payment = PaymentRepository(session).locate_payment_by_merchant_order_no(
                    provider=provider, merchant_order_no=merchant_order_no
                )
                return payment.id if payment is not None else None

        def locate_refund_attempt(provider: str, merchant_refund_no: str):  # type: ignore[no-untyped-def]
            with session_factory() as session:
                return RefundRepository(session).locate_attempt_id_by_merchant_refund_no(
                    provider=provider, merchant_refund_no=merchant_refund_no
                )

        payment_notification_service = WeChatPayPaymentNotificationService(
            adapter=notification_adapter,
            convergence=payment_convergence,
            locate_payment=locate_payment,
            provider=payment_provider.name,
        )
        refund_notification_service = WeChatPayRefundNotificationService(
            adapter=notification_adapter,
            convergence=refund_convergence,
            locate_attempt=locate_refund_attempt,
            provider=payment_provider.name,
        )
    owns_venue_media_store = venue_media_store is None
    owns_venue_onboarding_store = venue_onboarding_store is None
    try:
        resolved_media_store = venue_media_store or (
            OssMediaStorage.from_settings(resolved_settings)
            if resolved_settings.app_env in {"staging", "production"}
            else LocalMediaStorage()
        )
        if venue_onboarding_store is not None:
            resolved_onboarding_store = venue_onboarding_store
        elif resolved_settings.app_env not in {"staging", "production"}:
            resolved_onboarding_store = MemoryOnboardingStorage()
        elif resolved_settings.onboarding_oss_bucket is None:
            resolved_onboarding_store = UnavailableOnboardingStorage()
        else:
            resolved_onboarding_store = OssOnboardingStorage.from_settings(resolved_settings)
    except BaseException:
        provider_bundle.close()
        close_payment_provider = getattr(payment_provider, "close", None)
        if close_payment_provider is not None:
            close_payment_provider()
        raise

    @asynccontextmanager
    async def lifespan(_application: FastAPI) -> AsyncIterator[None]:
        try:
            yield
        finally:
            provider_bundle.close()
            close_payment_provider = getattr(payment_provider, "close", None)
            if close_payment_provider is not None:
                close_payment_provider()
            close_storage = getattr(resolved_media_store, "close", None)
            if owns_venue_media_store and close_storage is not None:
                close_storage()
            close_onboarding_storage = getattr(resolved_onboarding_store, "close", None)
            if owns_venue_onboarding_store and close_onboarding_storage is not None:
                close_onboarding_storage()

    try:
        application = FastAPI(title="Pitch Booking API", version="0.1.0", lifespan=lifespan)
        application.add_middleware(
            RequestIdMiddleware,
            app_revision=resolved_settings.app_revision,
        )
        application.add_middleware(PlatformAdminSecurityHeadersMiddleware)
        application.add_exception_handler(AppError, app_error_handler)

        async def validation_handler(request: Request, error: Exception) -> JSONResponse:
            if (
                request.url.path.startswith("/api/v1/admin/venues/")
                and "/profile" in request.url.path
            ):
                assert isinstance(error, RequestValidationError)
                return await profile_request_validation_handler(request, error)
            return await request_validation_error_handler(request, error)

        application.add_exception_handler(RequestValidationError, validation_handler)
        application.add_exception_handler(Exception, unexpected_error_handler)
        application.state.settings = resolved_settings
        application.state.identity_provider = provider_bundle.identity_provider
        application.state.phone_provider = provider_bundle.phone_provider
        application.state.phone_vault = phone_vault
        application.state.provider_bundle = provider_bundle
        application.state.payment_provider = payment_provider
        application.state.refund_provider = payment_provider
        application.state.wechat_payment_notification_service = payment_notification_service
        application.state.wechat_refund_notification_service = refund_notification_service
        application.state.venue_media_store = resolved_media_store
        application.state.venue_onboarding_store = resolved_onboarding_store
        application.include_router(auth_router)
        application.include_router(availability_router)
        application.include_router(checkout_router)
        application.include_router(inventory_router)
        application.include_router(orders_router)
        application.include_router(payments_router)
        application.include_router(wechat_pay_router)
        application.include_router(platform_auth_router)
        application.include_router(platform_onboarding_router)
        application.include_router(pitch_configuration_router)
        application.include_router(venue_access_router)
        application.include_router(venue_fulfillment_router)
        application.include_router(venue_onboarding_router)
        application.include_router(venue_profiles_router)
        application.include_router(venue_profile_manual_router)
        if resolved_settings.mock_payment_provider_enabled:
            application.include_router(development_payment_router)
        application.include_router(venues_router)
        application.include_router(
            create_platform_web_router(platform_admin_root or default_platform_admin_root())
        )
    except BaseException:
        provider_bundle.close()
        close_payment_provider = getattr(payment_provider, "close", None)
        if close_payment_provider is not None:
            close_payment_provider()
        close_storage = getattr(resolved_media_store, "close", None)
        if owns_venue_media_store and close_storage is not None:
            close_storage()
        close_onboarding_storage = getattr(resolved_onboarding_store, "close", None)
        if owns_venue_onboarding_store and close_onboarding_storage is not None:
            close_onboarding_storage()
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
                "/api/v1/venues/{venue_id}/fulfillment/orders/{order_id}/check-in",
                "/api/v1/venues/{venue_id}/fulfillment/orders/{order_id}/complete",
            ):
                operation = schema.get("paths", {}).get(path, {}).get("post", {})
                operation.get("responses", {}).pop("422", None)
            align_order_list_openapi(schema)
            profile_get = (
                schema.get("paths", {})
                .get("/api/v1/admin/venues/{venue_id}/profile", {})
                .get("get", {})
            )
            profile_get.get("responses", {}).pop("422", None)
            platform_session_path = schema.get("paths", {}).get(
                "/platform-admin/api/v1/auth/session", {}
            )
            for method, names in (
                ("post", {"Origin"}),
                ("delete", {"Origin", "X-CSRF-Token"}),
            ):
                parameters = platform_session_path.get(method, {}).get("parameters", [])
                for parameter in parameters:
                    if parameter.get("name") not in names:
                        continue
                    name = parameter["name"]
                    parameter["required"] = True
                    parameter["schema"] = {
                        "type": "string",
                        "title": parameter.get("schema", {}).get("title", name),
                        **(
                            {"format": "uri"} if name == "Origin" else {"pattern": "^[0-9a-f]{64}$"}
                        ),
                    }
            platform_decision = (
                schema.get("paths", {})
                .get(
                    "/platform-admin/api/v1/onboarding/applications/{application_id}/decisions",
                    {},
                )
                .get("post", {})
            )
            for parameter in platform_decision.get("parameters", []):
                if parameter.get("name") not in {"Origin", "X-CSRF-Token"}:
                    continue
                name = parameter["name"]
                parameter["required"] = True
                parameter["schema"] = {
                    "type": "string",
                    "title": parameter.get("schema", {}).get("title", name),
                    **({"format": "uri"} if name == "Origin" else {"pattern": "^[0-9a-f]{64}$"}),
                }
            application.openapi_schema = schema
        return application.openapi_schema

    setattr(application, "openapi", frozen_runtime_openapi)  # noqa: B010

    return application


app = create_app()
