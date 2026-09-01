import base64
import hashlib
import json
import stat
import sys
from pathlib import Path

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from scripts import prepare_live_deploy as prepare_module
from scripts.preflight_deploy import preflight, read_env_file
from scripts.prepare_live_deploy import PrepareInputs, prepare_live_deploy

OSS_VALUES = {
    "OSS_ENDPOINT": "https://oss-cn-hangzhou.aliyuncs.com",
    "OSS_BUCKET": "pitch-media-staging",
    "OSS_PUBLIC_BASE_URL": "https://media.modelstella.com",
    "OSS_ACCESS_KEY_ID": "oss-access-id-secret",
    "OSS_ACCESS_KEY_SECRET": "oss-access-key-secret",
}
APP_ID = "wx-app-id-secret"
DASHSCOPE_KEY = "dashscope-key-secret"
WECHAT_SECRET = "wechat-app-secret"
TENCENT_KEY = "ABCDE-FGHIJ-KLMNO-PQRST-UVWXY-Z1234"
REVISION = "a" * 40
ONBOARDING_BUCKET = "pitch-onboarding-private"
PLATFORM_REVIEWER_TOKEN = "reviewer-token-with-at-least-32-chars"
WECHAT_PAY_MERCHANT_ID = "1900000109"
WECHAT_PAY_MERCHANT_CERT_SERIAL = "0123456789ABCDEF"
WECHAT_PAY_PUBLIC_KEY_ID = "PUB_KEY_ID_3000000001"
WECHAT_PAY_API_V3_KEY = "0123456789abcdef0123456789abcdef"
WECHAT_PAY_PAYMENT_NOTIFICATION_URL = (
    "https://pitch-api-staging.modelstella.com/api/v1/payments/wechat/notify"
)
WECHAT_PAY_REFUND_NOTIFICATION_URL = (
    "https://pitch-api-staging.modelstella.com/api/v1/refunds/wechat/notify"
)
WAITLIST_TEMPLATE_ID = "zun-LzcQyW-edafCVvzPkK4de2Rllr1fFpw2A_x0oXE"
WAITLIST_KEYWORD_MAPPING = json.dumps(
    {
        "game_name": "thing1",
        "starts_at": "time2",
        "venue_name": "thing3",
    },
    separators=(",", ":"),
)


def _payment_pem_values(*, key_size: int = 2048) -> tuple[str, str]:
    private = rsa.generate_private_key(public_exponent=65537, key_size=key_size)
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


def write_inputs(tmp_path: Path) -> tuple[Path, Path]:
    oss_env = tmp_path / "oss.env"
    oss_env.write_text(
        "".join(f"{key}={value}\n" for key, value in OSS_VALUES.items()),
        encoding="utf-8",
    )
    project_config = tmp_path / "project.private.config.json"
    project_config.write_text(json.dumps({"appid": APP_ID}), encoding="utf-8")
    return oss_env, project_config


def inputs(tmp_path: Path, **overrides: object) -> PrepareInputs:
    oss_env, project_config = write_inputs(tmp_path)
    values: dict[str, object] = {
        "oss_env": oss_env,
        "project_config": project_config,
        "deploy_env": tmp_path / "deploy.env",
        "miniprogram_env": tmp_path / "miniprogram.env",
        "dashscope_api_key": DASHSCOPE_KEY,
        "wechat_app_secret": WECHAT_SECRET,
        "tencent_map_key": TENCENT_KEY,
        "revision": REVISION,
        "onboarding_oss_bucket": ONBOARDING_BUCKET,
        "platform_reviewer_token": PLATFORM_REVIEWER_TOKEN,
        "wechat_pay_merchant_id": WECHAT_PAY_MERCHANT_ID,
        "wechat_pay_merchant_cert_serial": WECHAT_PAY_MERCHANT_CERT_SERIAL,
        "wechat_pay_merchant_private_key_pem_base64": WECHAT_PAY_PRIVATE_KEY_BASE64,
        "wechat_pay_public_key_id": WECHAT_PAY_PUBLIC_KEY_ID,
        "wechat_pay_public_key_pem_base64": WECHAT_PAY_PUBLIC_KEY_BASE64,
        "wechat_pay_api_v3_key": WECHAT_PAY_API_V3_KEY,
        "wechat_pay_payment_notification_url": WECHAT_PAY_PAYMENT_NOTIFICATION_URL,
        "wechat_pay_refund_notification_url": WECHAT_PAY_REFUND_NOTIFICATION_URL,
    }
    values.update(overrides)
    return PrepareInputs(**values)  # type: ignore[arg-type]


def test_prepare_creates_complete_preflight_compatible_files_with_mode_0600(
    tmp_path: Path,
) -> None:
    paths = prepare_live_deploy(inputs(tmp_path))

    deploy = read_env_file(paths.deploy_env)
    assert deploy["DATABASE_URL"] == (
        f"postgresql+psycopg://pitch:{deploy['POSTGRES_PASSWORD']}@postgres:5432/pitch"
    )
    assert deploy["APP_REVISION"] == REVISION
    assert deploy["PUBLIC_API_BASE_URL"] == "https://pitch-api-staging.modelstella.com"
    assert deploy["PUBLIC_IMAGE_HOSTS"] == '["media.modelstella.com"]'
    assert deploy["OSS_PUBLIC_BASE_URL"] == "https://media.modelstella.com"
    assert deploy["WECHAT_PROVIDER"] == "real"
    assert deploy["OPEN_GAME_NOTIFICATION_PROVIDER"] == "disabled"
    assert deploy["OPEN_GAME_NOTIFICATION_TEMPLATE_ID"] == ""
    assert deploy["OPEN_GAME_NOTIFICATION_KEYWORD_MAPPING_JSON"] == ""
    assert deploy["OPEN_GAME_NOTIFICATION_MINIPROGRAM_STATE"] == "formal"
    assert deploy["PAYMENT_PROVIDER"] == "wechat"
    assert deploy["ENABLE_MOCK_PAYMENT_PROVIDER"] == "false"
    assert deploy["VENUE_STAFF_AUTHORIZATION_ENABLED"] == "false"
    assert deploy["WECHAT_PAY_MERCHANT_ID"] == WECHAT_PAY_MERCHANT_ID
    assert deploy["WECHAT_PAY_MERCHANT_CERT_SERIAL"] == WECHAT_PAY_MERCHANT_CERT_SERIAL
    assert deploy["WECHAT_PAY_MERCHANT_PRIVATE_KEY_PEM_BASE64"] == WECHAT_PAY_PRIVATE_KEY_BASE64
    assert deploy["WECHAT_PAY_PUBLIC_KEY_ID"] == WECHAT_PAY_PUBLIC_KEY_ID
    assert deploy["WECHAT_PAY_PUBLIC_KEY_PEM_BASE64"] == WECHAT_PAY_PUBLIC_KEY_BASE64
    assert deploy["WECHAT_PAY_API_V3_KEY"] == WECHAT_PAY_API_V3_KEY
    assert deploy["WECHAT_PAY_PAYMENT_NOTIFICATION_URL"] == WECHAT_PAY_PAYMENT_NOTIFICATION_URL
    assert deploy["WECHAT_PAY_REFUND_NOTIFICATION_URL"] == WECHAT_PAY_REFUND_NOTIFICATION_URL
    assert deploy["MINIPROGRAM_ICP_FILING_CONFIRMED"] == "false"
    assert deploy["MODERATION_REVIEWER_USER_IDS"]
    assert deploy["ONBOARDING_OSS_BUCKET"] == ONBOARDING_BUCKET
    assert len(base64.b64decode(deploy["PLATFORM_CSRF_SECRET"], validate=True)) == 32
    principals = json.loads(deploy["PLATFORM_STAFF_PRINCIPALS_JSON"])
    assert principals == [
        {
            "principal_id": "onboarding-reviewer",
            "display_name": "入驻审核员",
            "token_sha256": hashlib.sha256(PLATFORM_REVIEWER_TOKEN.encode("utf-8")).hexdigest(),
            "enabled": True,
            "roles": ["ONBOARDING_REVIEWER"],
        }
    ]
    assert PLATFORM_REVIEWER_TOKEN not in paths.deploy_env.read_text(encoding="utf-8")
    assert len(base64.b64decode(deploy["PHONE_ENCRYPTION_KEY_BASE64"], validate=True)) == 32
    assert read_env_file(paths.miniprogram_env) == {
        "MINIPROGRAM_API_BASE_URL": "https://pitch-api-staging.modelstella.com",
        "MINIPROGRAM_TENCENT_MAP_KEY": TENCENT_KEY,
        "MINIPROGRAM_PAYMENT_PROVIDER": "wechat",
        "MINIPROGRAM_OPEN_GAME_NOTIFICATION_PROVIDER": "disabled",
        "MINIPROGRAM_WAITLIST_PROMOTED_TEMPLATE_ID": "",
        "MINIPROGRAM_VENUE_STAFF_AUTHORIZATION_ENABLED": "false",
    }
    assert stat.S_IMODE(paths.deploy_env.stat().st_mode) == 0o600
    assert stat.S_IMODE(paths.miniprogram_env.stat().st_mode) == 0o600
    assert paths.oss_request_base_url == (
        "https://pitch-media-staging.oss-cn-hangzhou.aliyuncs.com"
    )
    assert paths.onboarding_upload_base_url == (
        "https://pitch-onboarding-private.oss-cn-hangzhou.aliyuncs.com"
    )
    assert preflight(paths.deploy_env, miniprogram_env_file=paths.miniprogram_env).ok is True


def test_prepare_emits_matching_enabled_notification_config_for_backend_and_client(
    tmp_path: Path,
) -> None:
    paths = prepare_live_deploy(
        inputs(
            tmp_path,
            open_game_notification_provider="wechat",
            open_game_notification_template_id=WAITLIST_TEMPLATE_ID,
            open_game_notification_keyword_mapping_json=WAITLIST_KEYWORD_MAPPING,
            open_game_notification_miniprogram_state="trial",
        )
    )

    deploy = read_env_file(paths.deploy_env)
    mini = read_env_file(paths.miniprogram_env)
    assert deploy["OPEN_GAME_NOTIFICATION_PROVIDER"] == "wechat"
    assert deploy["OPEN_GAME_NOTIFICATION_TEMPLATE_ID"] == WAITLIST_TEMPLATE_ID
    assert deploy["OPEN_GAME_NOTIFICATION_KEYWORD_MAPPING_JSON"] == WAITLIST_KEYWORD_MAPPING
    assert deploy["OPEN_GAME_NOTIFICATION_MINIPROGRAM_STATE"] == "trial"
    assert mini["MINIPROGRAM_OPEN_GAME_NOTIFICATION_PROVIDER"] == "wechat"
    assert mini["MINIPROGRAM_WAITLIST_PROMOTED_TEMPLATE_ID"] == WAITLIST_TEMPLATE_ID
    assert preflight(paths.deploy_env, miniprogram_env_file=paths.miniprogram_env).ok is True


def test_prepare_emits_explicit_venue_staff_authorization_gate(tmp_path: Path) -> None:
    paths = prepare_live_deploy(
        inputs(tmp_path, venue_staff_authorization_enabled=True)
    )

    assert read_env_file(paths.deploy_env)["VENUE_STAFF_AUTHORIZATION_ENABLED"] == "true"
    assert (
        read_env_file(paths.miniprogram_env)[
            "MINIPROGRAM_VENUE_STAFF_AUTHORIZATION_ENABLED"
        ]
        == "true"
    )


@pytest.mark.parametrize("state", ["formal", "developer"])
def test_prepare_rejects_non_trial_state_for_enabled_staging_notifications(
    tmp_path: Path,
    state: str,
) -> None:
    with pytest.raises(
        ValueError,
        match="OPEN_GAME_NOTIFICATION_MINIPROGRAM_STATE must be trial for staging notifications",
    ):
        prepare_live_deploy(
            inputs(
                tmp_path,
                open_game_notification_provider="wechat",
                open_game_notification_template_id=WAITLIST_TEMPLATE_ID,
                open_game_notification_keyword_mapping_json=WAITLIST_KEYWORD_MAPPING,
                open_game_notification_miniprogram_state=state,
            )
        )


@pytest.mark.parametrize(
    ("override", "message"),
    [
        (
            {"open_game_notification_provider": "wechat"},
            "OPEN_GAME_NOTIFICATION_TEMPLATE_ID is required",
        ),
        (
            {
                "open_game_notification_provider": "wechat",
                "open_game_notification_template_id": WAITLIST_TEMPLATE_ID,
            },
            "OPEN_GAME_NOTIFICATION_KEYWORD_MAPPING_JSON is required",
        ),
        (
            {
                "open_game_notification_provider": "wechat",
                "open_game_notification_template_id": "replace-with-template-id",
                "open_game_notification_keyword_mapping_json": WAITLIST_KEYWORD_MAPPING,
            },
            "OPEN_GAME_NOTIFICATION_TEMPLATE_ID is invalid",
        ),
        (
            {
                "open_game_notification_provider": "wechat",
                "open_game_notification_template_id": WAITLIST_TEMPLATE_ID,
                "open_game_notification_keyword_mapping_json": (
                    '{"game_name":"thing1","starts_at":"time2","extra":"thing3"}'
                ),
            },
            "OPEN_GAME_NOTIFICATION_KEYWORD_MAPPING_JSON is invalid",
        ),
        (
            {"open_game_notification_miniprogram_state": "preview"},
            "OPEN_GAME_NOTIFICATION_MINIPROGRAM_STATE is invalid",
        ),
    ],
)
def test_prepare_rejects_partial_or_placeholder_notification_config_before_writing(
    tmp_path: Path,
    override: dict[str, str],
    message: str,
) -> None:
    config = inputs(tmp_path, **override)
    config.deploy_env.write_text("preserve-deploy", encoding="utf-8")
    config.miniprogram_env.write_text("preserve-mini", encoding="utf-8")

    with pytest.raises(ValueError, match=message):
        prepare_live_deploy(config)

    assert config.deploy_env.read_text(encoding="utf-8") == "preserve-deploy"
    assert config.miniprogram_env.read_text(encoding="utf-8") == "preserve-mini"


def test_prepare_disabled_payment_omits_merchant_credentials_and_closes_miniprogram_booking(
    tmp_path: Path,
) -> None:
    paths = prepare_live_deploy(
        inputs(
            tmp_path,
            payment_provider="disabled",
            wechat_pay_merchant_id="",
            wechat_pay_merchant_cert_serial="",
            wechat_pay_merchant_private_key_pem_base64="",
            wechat_pay_public_key_id="",
            wechat_pay_public_key_pem_base64="",
            wechat_pay_api_v3_key="",
            wechat_pay_payment_notification_url="",
            wechat_pay_refund_notification_url="",
        )
    )

    deploy = read_env_file(paths.deploy_env)
    assert deploy["PAYMENT_PROVIDER"] == "disabled"
    assert not any(key.startswith("WECHAT_PAY_") for key in deploy)
    assert read_env_file(paths.miniprogram_env)["MINIPROGRAM_PAYMENT_PROVIDER"] == "disabled"
    assert preflight(paths.deploy_env).ok is True


def test_prepare_preserves_generated_and_existing_values_on_rerun(tmp_path: Path) -> None:
    first = prepare_live_deploy(inputs(tmp_path))
    original = read_env_file(first.deploy_env)
    first.deploy_env.write_text(
        first.deploy_env.read_text(encoding="utf-8").replace(
            "MINIPROGRAM_ICP_FILING_CONFIRMED=false",
            "MINIPROGRAM_ICP_FILING_CONFIRMED=true",
        ),
        encoding="utf-8",
    )

    second = prepare_live_deploy(
        inputs(
            tmp_path,
            deploy_env=first.deploy_env,
            miniprogram_env=first.miniprogram_env,
            revision="b" * 40,
        )
    )
    updated = read_env_file(second.deploy_env)

    for key in (
        "POSTGRES_PASSWORD",
        "PHONE_ENCRYPTION_KEY_BASE64",
        "MODERATION_REVIEWER_USER_IDS",
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
    ):
        assert updated[key] == original[key]
    assert updated["MINIPROGRAM_ICP_FILING_CONFIRMED"] == "true"
    assert updated["APP_REVISION"] == "b" * 40


def test_prepare_replaces_invalid_new_live_values_without_leaking_token(
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    config = inputs(tmp_path)
    config.deploy_env.write_text(
        "ONBOARDING_OSS_BUCKET=INVALID_BUCKET\n"
        "PLATFORM_STAFF_PRINCIPALS_JSON=[]\n"
        "PLATFORM_CSRF_SECRET=not-base64\n",
        encoding="utf-8",
    )

    prepared = prepare_live_deploy(config)

    deploy = read_env_file(prepared.deploy_env)
    assert deploy["ONBOARDING_OSS_BUCKET"] == ONBOARDING_BUCKET
    assert (
        json.loads(deploy["PLATFORM_STAFF_PRINCIPALS_JSON"])[0]["token_sha256"]
        == hashlib.sha256(PLATFORM_REVIEWER_TOKEN.encode("utf-8")).hexdigest()
    )
    assert len(base64.b64decode(deploy["PLATFORM_CSRF_SECRET"], validate=True)) == 32
    captured = capsys.readouterr()
    assert PLATFORM_REVIEWER_TOKEN not in captured.out
    assert PLATFORM_REVIEWER_TOKEN not in captured.err


def test_prepare_cli_prompts_for_bootstrap_values_only_on_first_setup(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    oss_env, project_config = write_inputs(tmp_path)
    deploy_env = tmp_path / "deploy.env"
    miniprogram_env = tmp_path / "miniprogram.env"
    monkeypatch.setenv("DASHSCOPE_API_KEY", DASHSCOPE_KEY)
    monkeypatch.setenv("WECHAT_APP_SECRET", WECHAT_SECRET)
    monkeypatch.setenv("MINIPROGRAM_TENCENT_MAP_KEY", TENCENT_KEY)
    monkeypatch.setenv("WECHAT_PAY_MERCHANT_ID", WECHAT_PAY_MERCHANT_ID)
    monkeypatch.setenv("WECHAT_PAY_MERCHANT_CERT_SERIAL", WECHAT_PAY_MERCHANT_CERT_SERIAL)
    monkeypatch.setenv("WECHAT_PAY_MERCHANT_PRIVATE_KEY_PEM_BASE64", WECHAT_PAY_PRIVATE_KEY_BASE64)
    monkeypatch.setenv("WECHAT_PAY_PUBLIC_KEY_ID", WECHAT_PAY_PUBLIC_KEY_ID)
    monkeypatch.setenv("WECHAT_PAY_PUBLIC_KEY_PEM_BASE64", WECHAT_PAY_PUBLIC_KEY_BASE64)
    monkeypatch.setenv("WECHAT_PAY_API_V3_KEY", WECHAT_PAY_API_V3_KEY)
    monkeypatch.setenv("WECHAT_PAY_PAYMENT_NOTIFICATION_URL", WECHAT_PAY_PAYMENT_NOTIFICATION_URL)
    monkeypatch.setenv("WECHAT_PAY_REFUND_NOTIFICATION_URL", WECHAT_PAY_REFUND_NOTIFICATION_URL)
    monkeypatch.delenv("ONBOARDING_OSS_BUCKET", raising=False)
    monkeypatch.setenv("PLATFORM_REVIEWER_TOKEN", "environment-token-must-not-be-used")
    monkeypatch.setattr(prepare_module, "_git_revision", lambda: REVISION)
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "prepare_live_deploy",
            "--oss-env",
            str(oss_env),
            "--project-config",
            str(project_config),
            "--deploy-env",
            str(deploy_env),
            "--miniprogram-env",
            str(miniprogram_env),
        ],
    )
    prompts: list[str] = []

    def first_prompt(label: str) -> str:
        prompts.append(label)
        return {
            "ONBOARDING_OSS_BUCKET: ": ONBOARDING_BUCKET,
            "PLATFORM_REVIEWER_TOKEN: ": PLATFORM_REVIEWER_TOKEN,
        }[label]

    monkeypatch.setattr(prepare_module.getpass, "getpass", first_prompt)
    assert prepare_module.main() == 0
    assert prompts == ["ONBOARDING_OSS_BUCKET: ", "PLATFORM_REVIEWER_TOKEN: "]
    output = capsys.readouterr()
    reviewer_hash = hashlib.sha256(PLATFORM_REVIEWER_TOKEN.encode("utf-8")).hexdigest()
    assert PLATFORM_REVIEWER_TOKEN not in output.out
    assert reviewer_hash not in output.out
    assert PLATFORM_REVIEWER_TOKEN not in output.err
    assert reviewer_hash not in output.err
    assert (
        "WeChat request origins: https://pitch-api-staging.modelstella.com, "
        "https://pitch-media-staging.oss-cn-hangzhou.aliyuncs.com, "
        "https://apis.map.qq.com"
    ) in output.out
    assert (
        "WeChat uploadFile origin: https://pitch-onboarding-private.oss-cn-hangzhou.aliyuncs.com"
    ) in output.out

    prompts.clear()
    assert prepare_module.main() == 0
    assert prompts == []

    invalid_existing = deploy_env.read_text(encoding="utf-8")
    invalid_existing = invalid_existing.replace(
        f"ONBOARDING_OSS_BUCKET={ONBOARDING_BUCKET}",
        f"ONBOARDING_OSS_BUCKET={OSS_VALUES['OSS_BUCKET']}",
    )
    invalid_existing = invalid_existing.replace(
        f"PLATFORM_STAFF_PRINCIPALS_JSON={read_env_file(deploy_env)['PLATFORM_STAFF_PRINCIPALS_JSON']}",
        "PLATFORM_STAFF_PRINCIPALS_JSON=[]",
    )
    deploy_env.write_text(invalid_existing, encoding="utf-8")

    assert prepare_module.main() == 0
    assert prompts == ["ONBOARDING_OSS_BUCKET: ", "PLATFORM_REVIEWER_TOKEN: "]


@pytest.mark.parametrize(
    ("override", "message"),
    [
        ({"onboarding_oss_bucket": ""}, "ONBOARDING_OSS_BUCKET is required"),
        (
            {"onboarding_oss_bucket": OSS_VALUES["OSS_BUCKET"]},
            "ONBOARDING_OSS_BUCKET must be separate from OSS_BUCKET",
        ),
        (
            {"platform_reviewer_token": "too-short"},
            "platform reviewer token must contain at least 32 characters",
        ),
    ],
)
def test_prepare_rejects_invalid_onboarding_bootstrap_inputs(
    tmp_path: Path,
    override: dict[str, str],
    message: str,
) -> None:
    with pytest.raises(ValueError, match=message):
        prepare_live_deploy(inputs(tmp_path, **override))


@pytest.mark.parametrize(
    ("override", "message"),
    [
        ({"dashscope_api_key": ""}, "DASHSCOPE_API_KEY is required"),
        ({"wechat_app_secret": ""}, "WECHAT_APP_SECRET is required"),
        ({"tencent_map_key": "bad-key"}, "MINIPROGRAM_TENCENT_MAP_KEY is invalid"),
    ],
)
def test_prepare_rejects_missing_or_invalid_required_inputs_without_leaking_secrets(
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
    override: dict[str, str],
    message: str,
) -> None:
    secret_values = (*OSS_VALUES.values(), APP_ID, DASHSCOPE_KEY, WECHAT_SECRET, TENCENT_KEY)

    with pytest.raises(ValueError, match=message) as caught:
        prepare_live_deploy(inputs(tmp_path, **override))

    output = capsys.readouterr()
    rendered = f"{caught.value!r}{output.out}{output.err}"
    assert all(secret not in rendered for secret in secret_values)


@pytest.mark.parametrize(
    ("override", "message"),
    [
        ({"wechat_pay_merchant_id": "merchant-id"}, "WECHAT_PAY_MERCHANT_ID is invalid"),
        (
            {"wechat_pay_merchant_private_key_pem_base64": "not-base64"},
            "WeChat Pay private key",
        ),
        ({"wechat_pay_api_v3_key": "too-short"}, "exactly 32 bytes"),
        (
            {
                "wechat_pay_payment_notification_url": (
                    WECHAT_PAY_PAYMENT_NOTIFICATION_URL + "?token=secret"
                )
            },
            "notification URL",
        ),
    ],
)
def test_prepare_rejects_malformed_wechat_payment_inputs_without_echoing_them(
    tmp_path: Path,
    override: dict[str, str],
    message: str,
) -> None:
    supplied = next(iter(override.values()))

    with pytest.raises(ValueError, match=message) as caught:
        prepare_live_deploy(inputs(tmp_path, **override))

    assert supplied not in str(caught.value)


@pytest.mark.parametrize(
    "callback",
    [
        "https://callback.invalid/api/v1/payments/wechat/notify",
        "https://127.0.0.1/api/v1/payments/wechat/notify",
        "https://192.168.1.10/api/v1/payments/wechat/notify",
        "https://other.modelstella.com/api/v1/payments/wechat/notify",
        "https://pitch-api-staging.modelstella.com:8443/api/v1/payments/wechat/notify",
    ],
)
def test_prepare_rejects_nonpublic_or_cross_origin_payment_callbacks(
    tmp_path: Path,
    callback: str,
) -> None:
    with pytest.raises(ValueError, match="public API origin") as caught:
        prepare_live_deploy(inputs(tmp_path, wechat_pay_payment_notification_url=callback))

    assert callback not in str(caught.value)


@pytest.mark.parametrize(
    "hostname",
    [
        "api.test",
        "api.example",
        "example.com",
        "sub.example.net",
        "example.org",
    ],
)
def test_prepare_rejects_same_origin_special_use_payment_callbacks(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    hostname: str,
) -> None:
    callback = f"https://{hostname}/api/v1/payments/wechat/notify"
    monkeypatch.setattr(prepare_module, "API_BASE_URL", f"https://{hostname}")

    with pytest.raises(ValueError, match="public API origin") as caught:
        prepare_live_deploy(
            inputs(
                tmp_path,
                wechat_pay_payment_notification_url=callback,
                wechat_pay_refund_notification_url=(
                    f"https://{hostname}/api/v1/refunds/wechat/notify"
                ),
            )
        )

    assert callback not in str(caught.value)


@pytest.mark.parametrize(
    "field",
    [
        "wechat_pay_merchant_private_key_pem_base64",
        "wechat_pay_public_key_pem_base64",
    ],
)
def test_prepare_rejects_non_2048_bit_wechat_rsa_keys(
    tmp_path: Path,
    field: str,
) -> None:
    private_key, public_key = _payment_pem_values(key_size=1024)
    value = private_key if "private" in field else public_key

    with pytest.raises(ValueError, match="PEM/Base64 is invalid"):
        prepare_live_deploy(inputs(tmp_path, **{field: value}))


@pytest.mark.parametrize("unsafe_character", ["$", '"', "'", "\\", "\n"])
def test_prepare_rejects_compose_interpolation_characters_in_api_v3_key(
    tmp_path: Path,
    unsafe_character: str,
) -> None:
    with pytest.raises(ValueError, match="deployment-safe ASCII"):
        prepare_live_deploy(inputs(tmp_path, wechat_pay_api_v3_key="A" * 31 + unsafe_character))


@pytest.mark.parametrize(
    "contents",
    [
        "OSS_ENDPOINT=https://one.example\nOSS_ENDPOINT=https://two.example\n",
        "OSS_ENDPOINT\n",
    ],
)
def test_prepare_rejects_duplicate_or_malformed_source_env_safely(
    tmp_path: Path, contents: str
) -> None:
    config = inputs(tmp_path)
    config.oss_env.write_text(contents, encoding="utf-8")

    with pytest.raises(ValueError, match="OSS environment file is invalid") as caught:
        prepare_live_deploy(config)

    assert "https://" not in str(caught.value)
