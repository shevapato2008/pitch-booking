"""Payment provider boundary and durable payment-attempt services."""

import base64
import uuid

import httpx

from backend.app.config import Settings
from backend.app.modules.payments.mock_provider import MockPaymentProvider
from backend.app.modules.payments.provider import PaymentProvider


def build_payment_provider(
    settings: Settings, *, client: httpx.Client | None = None
) -> PaymentProvider:
    # Keep production implementation imports inside the factory. Importing a
    # concrete adapter first necessarily imports this package to reach the
    # shared payment protocol, so eager imports here form a cycle.
    from backend.app.modules.wechat_pay.provider import WeChatPayProvider
    from backend.app.modules.wechat_pay.transport import WeChatPayTransport

    if settings.mock_payment_provider_enabled:
        return MockPaymentProvider()
    if settings.payment_provider != "wechat" or not settings.wechat_payment_configured:
        raise RuntimeError("WeChat payment credentials are incomplete")

    assert settings.wechat_app_id is not None
    assert settings.wechat_pay_merchant_id is not None
    assert settings.wechat_pay_merchant_cert_serial is not None
    assert settings.wechat_pay_merchant_private_key_pem_base64 is not None
    assert settings.wechat_pay_public_key_id is not None
    assert settings.wechat_pay_public_key_pem_base64 is not None
    assert settings.wechat_pay_api_v3_key is not None
    assert settings.wechat_pay_payment_notification_url is not None
    assert settings.wechat_pay_refund_notification_url is not None

    merchant_private_key_pem = base64.b64decode(
        settings.wechat_pay_merchant_private_key_pem_base64.get_secret_value(),
        validate=True,
    )
    public_key_pem = base64.b64decode(
        settings.wechat_pay_public_key_pem_base64.get_secret_value(), validate=True
    )
    owned_client = client is None
    resolved_client = client or httpx.Client()

    def nonce_factory() -> str:
        return uuid.uuid4().hex

    transport = WeChatPayTransport(
        client=resolved_client,
        merchant_id=settings.wechat_pay_merchant_id,
        merchant_certificate_serial=settings.wechat_pay_merchant_cert_serial,
        merchant_private_key_pem=merchant_private_key_pem,
        wechat_pay_public_key_id=settings.wechat_pay_public_key_id,
        wechat_pay_public_key_pem=public_key_pem,
        api_v3_key=settings.wechat_pay_api_v3_key.get_secret_value(),
        nonce_factory=nonce_factory,
    )
    return WeChatPayProvider(
        transport=transport,
        app_id=settings.wechat_app_id,
        merchant_id=settings.wechat_pay_merchant_id,
        merchant_private_key_pem=merchant_private_key_pem,
        payment_notification_url=str(settings.wechat_pay_payment_notification_url),
        refund_notification_url=str(settings.wechat_pay_refund_notification_url),
        nonce_factory=nonce_factory,
        owned_client=resolved_client if owned_client else None,
    )


__all__ = ["build_payment_provider"]
