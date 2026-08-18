import base64
import hashlib
import json
import subprocess
from pathlib import Path

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from scripts.preflight_deploy import preflight


def _payment_pem_values() -> tuple[str, str]:
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
        base64.b64encode(private_pem).decode("ascii"),
        base64.b64encode(public_pem).decode("ascii"),
    )


WECHAT_PAY_PRIVATE_KEY_BASE64, WECHAT_PAY_PUBLIC_KEY_BASE64 = _payment_pem_values()


def write_env(path: Path, values: dict[str, str]) -> Path:
    env_file = path / "staging.env"
    env_file.write_text(
        "".join(f"{key}={value}\n" for key, value in values.items()),
        encoding="utf-8",
    )
    return env_file


def valid_local_environment() -> dict[str, str]:
    return {
        "APP_ENV": "staging",
        "APP_REVISION": "a" * 40,
        "DATABASE_URL": "postgresql+psycopg://pitch:local-password@postgres:5432/pitch",
        "POSTGRES_DB": "pitch",
        "POSTGRES_USER": "pitch",
        "POSTGRES_PASSWORD": "local-password",
        "PUBLIC_API_BASE_URL": "http://127.0.0.1:8080",
        "PUBLIC_IMAGE_HOSTS": '["cdn.example.test"]',
        "OSS_ENDPOINT": "https://oss-cn-hangzhou.aliyuncs.com",
        "OSS_BUCKET": "venue-media-staging",
        "OSS_PUBLIC_BASE_URL": "https://cdn.example.test/media",
        "OSS_ACCESS_KEY_ID": "staging-access-key-id",
        "OSS_ACCESS_KEY_SECRET": "staging-access-key-secret",
        "DASHSCOPE_API_KEY": "staging-dashscope-key",
        "DASHSCOPE_BASE_URL": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "DASHSCOPE_MODERATION_MODEL": "qwen3-vl-flash",
        "MODERATION_REVIEWER_USER_IDS": "01a329c4-36b0-401a-a577-48ee1c475a37",
        "PAYMENT_PROVIDER": "wechat",
        "ENABLE_MOCK_PAYMENT_PROVIDER": "false",
        "WECHAT_PAY_MERCHANT_ID": "1900000109",
        "WECHAT_PAY_MERCHANT_CERT_SERIAL": "0123456789ABCDEF",
        "WECHAT_PAY_MERCHANT_PRIVATE_KEY_PEM_BASE64": WECHAT_PAY_PRIVATE_KEY_BASE64,
        "WECHAT_PAY_PUBLIC_KEY_ID": "PUB_KEY_ID_3000000001",
        "WECHAT_PAY_PUBLIC_KEY_PEM_BASE64": WECHAT_PAY_PUBLIC_KEY_BASE64,
        "WECHAT_PAY_API_V3_KEY": "0123456789abcdef0123456789abcdef",
        "WECHAT_PAY_PAYMENT_NOTIFICATION_URL": (
            "https://api.example.test/api/v1/payments/wechat/notify"
        ),
        "WECHAT_PAY_REFUND_NOTIFICATION_URL": (
            "https://api.example.test/api/v1/refunds/wechat/notify"
        ),
        "ONBOARDING_OSS_BUCKET": "venue-onboarding-private",
        "PLATFORM_STAFF_PRINCIPALS_JSON": json.dumps(
            [
                {
                    "principal_id": "onboarding-reviewer",
                    "display_name": "入驻审核员",
                    "token_sha256": "b" * 64,
                    "enabled": True,
                    "roles": ["ONBOARDING_REVIEWER"],
                }
            ],
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        "PLATFORM_CSRF_SECRET": base64.b64encode(bytes(range(32))).decode("ascii"),
    }


def test_preflight_rejects_validation_sentinels(tmp_path: Path) -> None:
    values = valid_local_environment()
    values.update(
        POSTGRES_PASSWORD="change-before-deploy",
        APP_REVISION="uncommitted",
        PUBLIC_API_BASE_URL="https://staging.invalid",
    )

    result = preflight(write_env(tmp_path, values))

    assert set(result.failures) == {
        "POSTGRES_PASSWORD uses validation sentinel",
        "APP_REVISION is not a 40-character commit SHA",
        "PUBLIC_API_BASE_URL uses validation sentinel",
    }


def test_preflight_rejects_malformed_or_unsafe_public_url(tmp_path: Path) -> None:
    values = valid_local_environment()
    values["PUBLIC_API_BASE_URL"] = "http://staging.example.test"

    result = preflight(write_env(tmp_path, values))

    assert result.failures == ("PUBLIC_API_BASE_URL must use HTTPS unless it targets loopback",)


def test_preflight_rejects_non_json_image_hosts(tmp_path: Path) -> None:
    values = valid_local_environment()
    values["PUBLIC_IMAGE_HOSTS"] = "cdn.example.test"

    result = preflight(write_env(tmp_path, values))

    assert result.failures == ("PUBLIC_IMAGE_HOSTS must be a non-empty JSON string array",)


def test_preflight_accepts_valid_local_staging_environment(tmp_path: Path) -> None:
    result = preflight(write_env(tmp_path, valid_local_environment()))

    assert result.ok is True
    assert result.failures == ()


def test_device_qr_preflight_rejects_unconfirmed_icp_filing(tmp_path: Path) -> None:
    result = preflight(
        write_env(tmp_path, valid_local_environment()),
        require_miniprogram_acceptance=True,
    )

    assert result.failures == (
        "MINIPROGRAM_ICP_FILING_CONFIRMED must be true before generating a device QR code",
    )


def test_device_qr_preflight_accepts_confirmed_icp_filing(tmp_path: Path) -> None:
    values = valid_local_environment()
    values["MINIPROGRAM_ICP_FILING_CONFIRMED"] = "true"

    result = preflight(
        write_env(tmp_path, values),
        require_miniprogram_acceptance=True,
    )

    assert result.ok is True


def test_preflight_requires_complete_oss_configuration_without_printing_secrets(
    tmp_path: Path,
) -> None:
    values = valid_local_environment()
    secret = values.pop("OSS_ACCESS_KEY_SECRET")

    result = preflight(write_env(tmp_path, values))

    assert result.failures == ("OSS_ACCESS_KEY_SECRET is required",)
    assert secret not in repr(result)


@pytest.mark.parametrize(
    ("field", "value", "failure"),
    [
        ("OSS_ENDPOINT", "http://oss.example.test", "OSS_ENDPOINT must use HTTPS"),
        (
            "OSS_PUBLIC_BASE_URL",
            "http://cdn.example.test/media",
            "OSS_PUBLIC_BASE_URL must use HTTPS",
        ),
        ("OSS_BUCKET", "Invalid_Bucket", "OSS_BUCKET is invalid"),
        (
            "OSS_ENDPOINT",
            "https://oss.example.test/path",
            "OSS_ENDPOINT must be an origin URL",
        ),
        (
            "OSS_PUBLIC_BASE_URL",
            "https://cdn.example.test/media?token=secret",
            "OSS_PUBLIC_BASE_URL must not contain query or fragment",
        ),
    ],
)
def test_preflight_rejects_unsafe_oss_public_configuration(
    tmp_path: Path, field: str, value: str, failure: str
) -> None:
    values = valid_local_environment()
    values[field] = value

    result = preflight(write_env(tmp_path, values))

    assert result.failures == (failure,)


def test_preflight_rejects_mock_payment_configuration(tmp_path: Path) -> None:
    values = valid_local_environment()
    values["PAYMENT_PROVIDER"] = "mock"
    values["ENABLE_MOCK_PAYMENT_PROVIDER"] = "true"

    result = preflight(write_env(tmp_path, values))

    assert set(result.failures) == {
        "PAYMENT_PROVIDER must be wechat for deployment",
        "ENABLE_MOCK_PAYMENT_PROVIDER must be false for deployment",
    }


def test_preflight_requires_wechat_credentials_only_for_real_provider(
    tmp_path: Path,
) -> None:
    values = valid_local_environment()
    payment_keys = tuple(key for key in values if key.startswith("WECHAT_PAY_"))
    for key in payment_keys:
        values.pop(key)
    values["PAYMENT_PROVIDER"] = "mock"
    values["ENABLE_MOCK_PAYMENT_PROVIDER"] = "true"

    result = preflight(write_env(tmp_path, values))

    assert all("WECHAT_PAY_" not in failure for failure in result.failures)


@pytest.mark.parametrize(
    ("field", "value", "failure"),
    [
        (
            "WECHAT_PAY_MERCHANT_ID",
            "merchant-id",
            "WECHAT_PAY_MERCHANT_ID is invalid",
        ),
        (
            "WECHAT_PAY_MERCHANT_PRIVATE_KEY_PEM_BASE64",
            "not-base64",
            "WECHAT_PAY_MERCHANT_PRIVATE_KEY_PEM_BASE64 is invalid",
        ),
        (
            "WECHAT_PAY_PUBLIC_KEY_PEM_BASE64",
            "not-base64",
            "WECHAT_PAY_PUBLIC_KEY_PEM_BASE64 is invalid",
        ),
        (
            "WECHAT_PAY_API_V3_KEY",
            "too-short",
            "WECHAT_PAY_API_V3_KEY must be exactly 32 bytes",
        ),
        (
            "WECHAT_PAY_PAYMENT_NOTIFICATION_URL",
            "https://api.example.test/payment?secret=value",
            "WECHAT_PAY_PAYMENT_NOTIFICATION_URL must be absolute HTTPS without query or fragment",
        ),
    ],
)
def test_preflight_rejects_malformed_wechat_credentials_without_echoing_them(
    tmp_path: Path,
    field: str,
    value: str,
    failure: str,
) -> None:
    values = valid_local_environment()
    values[field] = value

    result = preflight(write_env(tmp_path, values))

    assert result.failures == (failure,)
    assert value not in repr(result)


@pytest.mark.parametrize(
    ("field", "value", "failure"),
    [
        (
            "ONBOARDING_OSS_BUCKET",
            "Invalid_Bucket",
            "ONBOARDING_OSS_BUCKET is invalid",
        ),
        (
            "ONBOARDING_OSS_BUCKET",
            "venue-media-staging",
            "ONBOARDING_OSS_BUCKET must be separate from OSS_BUCKET",
        ),
        (
            "PLATFORM_STAFF_PRINCIPALS_JSON",
            "[]",
            "PLATFORM_STAFF_PRINCIPALS_JSON must contain an enabled ONBOARDING_REVIEWER",
        ),
        (
            "PLATFORM_STAFF_PRINCIPALS_JSON",
            json.dumps(
                [
                    {
                        "principal_id": "reviewer",
                        "display_name": "Reviewer",
                        "token_sha256": "A" * 64,
                        "enabled": True,
                        "roles": ["SUPER_ADMIN"],
                    }
                ]
            ),
            "PLATFORM_STAFF_PRINCIPALS_JSON is invalid",
        ),
        (
            "PLATFORM_CSRF_SECRET",
            base64.b64encode(b"short").decode("ascii"),
            "PLATFORM_CSRF_SECRET must be canonical Base64 for exactly 32 bytes",
        ),
    ],
)
def test_preflight_rejects_invalid_onboarding_or_platform_staff_configuration(
    tmp_path: Path,
    field: str,
    value: str,
    failure: str,
) -> None:
    values = valid_local_environment()
    values[field] = value

    result = preflight(write_env(tmp_path, values))

    assert result.failures == (failure,)


def test_compose_defines_the_local_staging_services(tmp_path: Path) -> None:
    env_file = write_env(tmp_path, valid_local_environment())

    completed = subprocess.run(
        ["docker", "compose", "--env-file", str(env_file), "config", "--format", "json"],
        check=True,
        capture_output=True,
        text=True,
    )
    config = json.loads(completed.stdout)

    assert set(config["services"]) == {"api", "caddy", "postgres", "worker"}
    assert config["services"]["postgres"]["healthcheck"]
    assert config["services"]["api"]["depends_on"]["postgres"]["condition"] == "service_healthy"
    assert config["services"]["worker"]["depends_on"]["api"]["condition"] == "service_healthy"
    assert "alembic upgrade head" in " ".join(config["services"]["api"]["command"])
    assert {
        key: config["services"]["api"]["environment"][key]
        for key in (
            "OSS_ENDPOINT",
            "OSS_BUCKET",
            "OSS_PUBLIC_BASE_URL",
            "OSS_ACCESS_KEY_ID",
            "OSS_ACCESS_KEY_SECRET",
            "ONBOARDING_OSS_BUCKET",
            "PLATFORM_STAFF_PRINCIPALS_JSON",
            "PLATFORM_CSRF_SECRET",
            "WECHAT_PAY_MERCHANT_ID",
            "WECHAT_PAY_MERCHANT_CERT_SERIAL",
            "WECHAT_PAY_MERCHANT_PRIVATE_KEY_PEM_BASE64",
            "WECHAT_PAY_PUBLIC_KEY_ID",
            "WECHAT_PAY_PUBLIC_KEY_PEM_BASE64",
            "WECHAT_PAY_API_V3_KEY",
            "WECHAT_PAY_PAYMENT_NOTIFICATION_URL",
            "WECHAT_PAY_REFUND_NOTIFICATION_URL",
        )
    } == {
        key: valid_local_environment()[key]
        for key in (
            "OSS_ENDPOINT",
            "OSS_BUCKET",
            "OSS_PUBLIC_BASE_URL",
            "OSS_ACCESS_KEY_ID",
            "OSS_ACCESS_KEY_SECRET",
            "ONBOARDING_OSS_BUCKET",
            "PLATFORM_STAFF_PRINCIPALS_JSON",
            "PLATFORM_CSRF_SECRET",
            "WECHAT_PAY_MERCHANT_ID",
            "WECHAT_PAY_MERCHANT_CERT_SERIAL",
            "WECHAT_PAY_MERCHANT_PRIVATE_KEY_PEM_BASE64",
            "WECHAT_PAY_PUBLIC_KEY_ID",
            "WECHAT_PAY_PUBLIC_KEY_PEM_BASE64",
            "WECHAT_PAY_API_V3_KEY",
            "WECHAT_PAY_PAYMENT_NOTIFICATION_URL",
            "WECHAT_PAY_REFUND_NOTIFICATION_URL",
        )
    }
    assert "postgres_data" in config["volumes"]


def test_deploy_environment_template_declares_all_oss_inputs() -> None:
    template = Path("deploy/.env.example").read_text(encoding="utf-8")

    for key in (
        "OSS_ENDPOINT",
        "OSS_BUCKET",
        "OSS_PUBLIC_BASE_URL",
        "OSS_ACCESS_KEY_ID",
        "OSS_ACCESS_KEY_SECRET",
        "ONBOARDING_OSS_BUCKET",
    ):
        assert f"{key}=" in template


def test_deploy_configuration_passes_through_platform_staff_inputs() -> None:
    compose = Path("compose.yaml").read_text(encoding="utf-8")
    template = Path("deploy/.env.example").read_text(encoding="utf-8")

    for key in (
        "ONBOARDING_OSS_BUCKET",
        "PLATFORM_STAFF_PRINCIPALS_JSON",
        "PLATFORM_CSRF_SECRET",
    ):
        assert f"{key}:" in compose
        assert f"{key}=" in template


def test_deploy_configuration_passes_through_moderation_inputs() -> None:
    compose = Path("compose.yaml").read_text(encoding="utf-8")
    template = Path("deploy/.env.example").read_text(encoding="utf-8")
    for key in (
        "DASHSCOPE_API_KEY",
        "DASHSCOPE_BASE_URL",
        "DASHSCOPE_MODERATION_MODEL",
        "MODERATION_REVIEWER_USER_IDS",
    ):
        assert f"{key}:" in compose
        assert f"{key}=" in template


def test_deploy_configuration_declares_wechat_payment_inputs() -> None:
    compose = Path("compose.yaml").read_text(encoding="utf-8")
    template = Path("deploy/.env.example").read_text(encoding="utf-8")
    for key in (
        "WECHAT_PAY_MERCHANT_ID",
        "WECHAT_PAY_MERCHANT_CERT_SERIAL",
        "WECHAT_PAY_MERCHANT_PRIVATE_KEY_PEM_BASE64",
        "WECHAT_PAY_PUBLIC_KEY_ID",
        "WECHAT_PAY_PUBLIC_KEY_PEM_BASE64",
        "WECHAT_PAY_API_V3_KEY",
        "WECHAT_PAY_PAYMENT_NOTIFICATION_URL",
        "WECHAT_PAY_REFUND_NOTIFICATION_URL",
    ):
        assert f"{key}:" in compose
        assert f"{key}=" in template


def test_runtime_image_never_syncs_development_dependencies() -> None:
    dockerfile = Path("backend/Dockerfile").read_text(encoding="utf-8")

    assert "UV_NO_DEV=1" in dockerfile


def test_runtime_image_explicitly_packages_verified_directory_inputs() -> None:
    dockerfile = Path("backend/Dockerfile").read_text(encoding="utf-8")
    expected = {
        "deploy/venue-directory.json": (
            "dd6bf001243aa48d8d1e0ccf84894f3dd3924eb051fbb2c9e77391e1e5a67199"
        ),
        "deploy/venue-directory.schema.json": (
            "a0f1c0145ccff73a1699fa84efaadd36acfc60c4637a815ce382a3213567ee45"
        ),
    }

    for relative_path, digest in expected.items():
        assert f"COPY {relative_path} /app/{relative_path}" in dockerfile
        assert hashlib.sha256(Path(relative_path).read_bytes()).hexdigest() == digest
    assert "COPY deploy/.env" not in dockerfile
    assert "COPY deploy/*approval" not in dockerfile
