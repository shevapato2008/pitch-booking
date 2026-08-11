from fastapi import FastAPI

from backend.app.config import Settings
from backend.app.main import create_app
from backend.app.modules.orders.dto import OrderDetailResponse
from backend.app.modules.payments.dto import (
    PaymentAlreadyConfirmedResponse,
    PaymentConfirmingResponse,
    PaymentPrepayCreatedResponse,
)


def _route_paths(app: FastAPI) -> set[str | None]:
    paths: set[str | None] = set()
    for route in app.routes:
        paths.add(getattr(route, "path", None))
        original = getattr(route, "original_router", None)
        if original is not None:
            paths.update(getattr(child, "path", None) for child in original.routes)
    return paths


def test_development_authority_route_is_strictly_isolated_and_absent_from_openapi() -> None:
    disabled = create_app(settings=Settings(app_env="development", payment_provider="wechat"))
    enabled = create_app(
        settings=Settings(
            app_env="development", payment_provider="mock", enable_mock_payment_provider=True
        )
    )
    test_app = create_app(settings=Settings(app_env="test", payment_provider="wechat"))

    path = "/api/v1/development/payments/{payment_id}/authority"
    assert path not in _route_paths(disabled)
    assert path in _route_paths(enabled)
    assert path not in _route_paths(test_app)
    assert path not in enabled.openapi()["paths"]


def test_no_unverified_production_notification_route_is_registered() -> None:
    app = create_app(
        settings=Settings(
            app_env="production",
            wechat_provider="real",
            payment_provider="wechat",
            wechat_app_id="wx-app",
            wechat_app_secret="secret",
            phone_encryption_key_base64="AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
            phone_encryption_key_version=1,
            database_url="postgresql+psycopg://u:p@db.example.com/pitch",
            public_api_base_url="https://api.example.com",
            public_image_hosts=("images.example.com",),
            oss_endpoint="https://oss-cn-hangzhou.aliyuncs.com",
            oss_bucket="venue-media-production",
            oss_public_base_url="https://images.example.com/media",
            oss_access_key_id="production-access-key-id",
            oss_access_key_secret="production-access-key-secret",
        )
    )
    assert "/api/v1/payments/wechat/notify" not in _route_paths(app)


def test_runtime_payment_openapi_has_the_frozen_response_matrix() -> None:
    schema = create_app(settings=Settings(app_env="test")).openapi()
    assert set(schema["paths"]["/api/v1/orders/{order_id}/pay"]["post"]["responses"]) == {
        "200",
        "201",
        "202",
        "401",
        "404",
        "409",
        "503",
    }
    assert set(
        schema["paths"]["/api/v1/orders/{order_id}/payments/{payment_id}/reconcile"]["post"][
            "responses"
        ]
    ) == {"200", "202", "401", "404"}


def test_public_payment_responses_have_no_provider_or_private_identity_fields() -> None:
    forbidden = {
        "merchant_order_no",
        "provider_transaction_no",
        "provider",
        "openid",
        "merchant_id",
        "app_id",
        "phone",
        "signature",
        "secret",
    }
    for model in (
        OrderDetailResponse,
        PaymentPrepayCreatedResponse,
        PaymentConfirmingResponse,
        PaymentAlreadyConfirmedResponse,
    ):
        assert forbidden.isdisjoint(model.model_fields)
