import base64
import hashlib
import json
import stat
import sys
from pathlib import Path

import pytest

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
    assert deploy["PAYMENT_PROVIDER"] == "wechat"
    assert deploy["ENABLE_MOCK_PAYMENT_PROVIDER"] == "false"
    assert deploy["MINIPROGRAM_ICP_FILING_CONFIRMED"] == "false"
    assert deploy["MODERATION_REVIEWER_USER_IDS"]
    assert deploy["ONBOARDING_OSS_BUCKET"] == ONBOARDING_BUCKET
    assert len(base64.b64decode(deploy["PLATFORM_CSRF_SECRET"], validate=True)) == 32
    principals = json.loads(deploy["PLATFORM_STAFF_PRINCIPALS_JSON"])
    assert principals == [
        {
            "principal_id": "onboarding-reviewer",
            "display_name": "入驻审核员",
            "token_sha256": hashlib.sha256(
                PLATFORM_REVIEWER_TOKEN.encode("utf-8")
            ).hexdigest(),
            "enabled": True,
            "roles": ["ONBOARDING_REVIEWER"],
        }
    ]
    assert PLATFORM_REVIEWER_TOKEN not in paths.deploy_env.read_text(encoding="utf-8")
    assert len(base64.b64decode(deploy["PHONE_ENCRYPTION_KEY_BASE64"], validate=True)) == 32
    assert read_env_file(paths.miniprogram_env) == {
        "MINIPROGRAM_API_BASE_URL": "https://pitch-api-staging.modelstella.com",
        "MINIPROGRAM_TENCENT_MAP_KEY": TENCENT_KEY,
    }
    assert stat.S_IMODE(paths.deploy_env.stat().st_mode) == 0o600
    assert stat.S_IMODE(paths.miniprogram_env.stat().st_mode) == 0o600
    assert paths.oss_request_base_url == (
        "https://pitch-media-staging.oss-cn-hangzhou.aliyuncs.com"
    )
    assert paths.onboarding_upload_base_url == (
        "https://pitch-onboarding-private.oss-cn-hangzhou.aliyuncs.com"
    )
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
    assert json.loads(deploy["PLATFORM_STAFF_PRINCIPALS_JSON"])[0][
        "token_sha256"
    ] == hashlib.sha256(PLATFORM_REVIEWER_TOKEN.encode("utf-8")).hexdigest()
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
        "WeChat uploadFile origin: "
        "https://pitch-onboarding-private.oss-cn-hangzhou.aliyuncs.com"
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
