from __future__ import annotations

import base64
import subprocess
import sys

import httpx
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from pydantic import ValidationError

from backend.app.config import Settings
from backend.app.main import create_app
from backend.app.modules.payments import build_payment_provider
from backend.app.modules.wechat_pay.provider import WeChatPayProvider


def _pem_values() -> tuple[str, str]:
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = private.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    public_pem = private.public_key().public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    return (
        base64.b64encode(private_pem).decode(),
        base64.b64encode(public_pem).decode(),
    )


def configured_settings(**overrides: object) -> Settings:
    private_pem, public_pem = _pem_values()
    values: dict[str, object] = {
        "app_env": "development",
        "payment_provider": "wechat",
        "wechat_app_id": "wx6b988ca75ad753c",
        "wechat_pay_merchant_id": "1900000109",
        "wechat_pay_merchant_cert_serial": "0123456789ABCDEF",
        "wechat_pay_merchant_private_key_pem_base64": private_pem,
        "wechat_pay_public_key_id": "PUB_KEY_ID_3000000001",
        "wechat_pay_public_key_pem_base64": public_pem,
        "wechat_pay_api_v3_key": "0123456789abcdef0123456789abcdef",
        "wechat_pay_payment_notification_url": (
            "https://api.example.test/api/v1/payments/wechat/notify"
        ),
        "wechat_pay_refund_notification_url": (
            "https://api.example.test/api/v1/refunds/wechat/notify"
        ),
    }
    values.update(overrides)
    return Settings(**values)


def test_factory_builds_one_real_adapter_for_payment_and_refund_protocols() -> None:
    adapter = build_payment_provider(
        configured_settings(),
        client=httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(500))),
    )

    assert isinstance(adapter, WeChatPayProvider)
    assert callable(adapter.create_refund)
    assert callable(adapter.query_refund)
    assert adapter.app_id == "wx6b988ca75ad753c"
    assert adapter.merchant_id == "1900000109"


def test_wechat_provider_supports_fresh_import_before_payment_package() -> None:
    completed = subprocess.run(
        [sys.executable, "-c", "import backend.app.modules.wechat_pay.provider"],
        check=False,
        capture_output=True,
        text=True,
    )
    assert completed.returncode == 0, completed.stderr


def test_app_startup_closes_owned_payment_provider_when_later_composition_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class ClosingProvider:
        closed = False

        def close(self) -> None:
            self.closed = True

    payment_provider = ClosingProvider()
    monkeypatch.setattr(
        "backend.app.main.build_payment_provider", lambda _settings: payment_provider
    )

    def fail_storage() -> None:
        raise RuntimeError("storage failed")

    monkeypatch.setattr("backend.app.main.LocalMediaStorage", fail_storage)

    with pytest.raises(RuntimeError, match="storage failed"):
        create_app(settings=configured_settings())

    assert payment_provider.closed is True


def test_incomplete_wechat_settings_never_fall_back_to_mock() -> None:
    with pytest.raises(RuntimeError, match="credentials are incomplete"):
        build_payment_provider(Settings(app_env="development", payment_provider="wechat"))


def test_deployed_wechat_provider_requires_complete_credentials() -> None:
    complete = configured_settings()
    values = complete.model_dump()
    values.update(
        app_env="staging",
        database_url="postgresql+psycopg://pitch:password@postgres:5432/pitch",
        public_api_base_url="https://api.example.test",
        public_image_hosts=("media.example.test",),
        oss_endpoint="https://oss-cn-beijing.aliyuncs.com",
        oss_bucket="pitch-media",
        oss_public_base_url="https://media.example.test",
        oss_access_key_id="access-key-id",
        oss_access_key_secret="access-key-secret",
        dashscope_api_key="dashscope-key",
        wechat_provider="real",
        wechat_app_secret="wechat-secret",
        phone_encryption_key_base64=(
            "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="
        ),
        phone_encryption_key_version=1,
        wechat_pay_merchant_id=None,
    )

    with pytest.raises(ValidationError, match="credentials are incomplete"):
        Settings(**values)


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("wechat_pay_merchant_private_key_pem_base64", "not-base64", "private key"),
        ("wechat_pay_public_key_pem_base64", "not-base64", "public key"),
        ("wechat_pay_api_v3_key", "too-short", "API v3"),
        (
            "wechat_pay_payment_notification_url",
            "https://api.example.test/callback?secret=yes",
            "notification URL",
        ),
    ],
)
def test_malformed_wechat_credentials_are_rejected_without_echoing_secret(
    field: str, value: str, message: str
) -> None:
    with pytest.raises(ValidationError, match=message) as error:
        configured_settings(**{field: value})

    assert value not in str(error.value)
