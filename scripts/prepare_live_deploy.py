from __future__ import annotations

import argparse
import base64
import getpass
import json
import os
import re
import secrets
import subprocess
import tempfile
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

OSS_KEYS = (
    "OSS_ENDPOINT",
    "OSS_BUCKET",
    "OSS_PUBLIC_BASE_URL",
    "OSS_ACCESS_KEY_ID",
    "OSS_ACCESS_KEY_SECRET",
)
PRESERVED_KEYS = (
    "POSTGRES_PASSWORD",
    "PHONE_ENCRYPTION_KEY_BASE64",
    "MODERATION_REVIEWER_USER_IDS",
    "MINIPROGRAM_ICP_FILING_CONFIRMED",
)
ENV_KEY = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
COMMIT_SHA = re.compile(r"^[0-9a-fA-F]{40}$")
OSS_BUCKET = re.compile(r"^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$")
TENCENT_MAP_KEY = re.compile(r"^[A-Z0-9]{5}(?:-[A-Z0-9]{5}){5}$", re.IGNORECASE)
API_BASE_URL = "https://pitch-api-staging.modelstella.com"
MEDIA_HOST = "media.modelstella.com"


@dataclass(frozen=True)
class PrepareInputs:
    oss_env: Path
    project_config: Path
    deploy_env: Path
    miniprogram_env: Path
    dashscope_api_key: str
    wechat_app_secret: str
    tencent_map_key: str
    revision: str


@dataclass(frozen=True)
class PreparedPaths:
    deploy_env: Path
    miniprogram_env: Path
    oss_request_base_url: str


def read_env_file(path: Path, label: str) -> dict[str, str]:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError) as error:
        raise ValueError(f"{label} is invalid or unreadable") from error

    values: dict[str, str] = {}
    for raw_line in lines:
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            raise ValueError(f"{label} is invalid")
        key, value = line.split("=", 1)
        key = key.strip()
        if ENV_KEY.fullmatch(key) is None or key in values:
            raise ValueError(f"{label} is invalid")
        values[key] = value.strip()
    return values


def _read_app_id(path: Path) -> str:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ValueError("WeChat project configuration is invalid or unreadable") from error
    app_id = document.get("appid") if isinstance(document, dict) else None
    if not isinstance(app_id, str) or not app_id.strip():
        raise ValueError("WeChat project configuration does not contain an AppID")
    return app_id.strip()


def _required(value: str, name: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise ValueError(f"{name} is required")
    if "\n" in normalized or "\r" in normalized:
        raise ValueError(f"{name} is invalid")
    return normalized


def _oss_request_base_url(endpoint: str, bucket: str) -> str:
    parsed = urlsplit(endpoint)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("OSS_ENDPOINT is invalid")
    if OSS_BUCKET.fullmatch(bucket) is None:
        raise ValueError("OSS_BUCKET is invalid")
    port = f":{parsed.port}" if parsed.port is not None else ""
    return f"https://{bucket}.{parsed.hostname}{port}"


def _validate_preserved(values: Mapping[str, str]) -> dict[str, str]:
    preserved: dict[str, str] = {}
    password = values.get("POSTGRES_PASSWORD")
    if password:
        preserved["POSTGRES_PASSWORD"] = _required(password, "POSTGRES_PASSWORD")

    phone_key = values.get("PHONE_ENCRYPTION_KEY_BASE64")
    if phone_key:
        try:
            decoded = base64.b64decode(phone_key, validate=True)
        except (ValueError, UnicodeError) as error:
            raise ValueError("existing PHONE_ENCRYPTION_KEY_BASE64 is invalid") from error
        if len(decoded) != 32 or base64.b64encode(decoded).decode("ascii") != phone_key:
            raise ValueError("existing PHONE_ENCRYPTION_KEY_BASE64 is invalid")
        preserved["PHONE_ENCRYPTION_KEY_BASE64"] = phone_key

    reviewer = values.get("MODERATION_REVIEWER_USER_IDS")
    if reviewer:
        try:
            uuid.UUID(reviewer)
        except ValueError as error:
            raise ValueError("existing MODERATION_REVIEWER_USER_IDS is invalid") from error
        preserved["MODERATION_REVIEWER_USER_IDS"] = reviewer

    icp_confirmed = values.get("MINIPROGRAM_ICP_FILING_CONFIRMED")
    if icp_confirmed:
        if icp_confirmed.casefold() not in {"true", "false"}:
            raise ValueError("existing MINIPROGRAM_ICP_FILING_CONFIRMED is invalid")
        preserved["MINIPROGRAM_ICP_FILING_CONFIRMED"] = icp_confirmed.casefold()
    return preserved


def _atomic_write(path: Path, contents: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            delete=False,
        ) as handle:
            temporary_path = Path(handle.name)
            os.chmod(handle.name, 0o600)
            handle.write(contents)
            handle.flush()
            os.fsync(handle.fileno())
        temporary_path.replace(path)
        path.chmod(0o600)
    finally:
        if temporary_path is not None and temporary_path.exists():
            temporary_path.unlink()


def _render(values: Mapping[str, str], header: str) -> str:
    return header + "\n" + "".join(f"{key}={value}\n" for key, value in values.items())


def prepare_live_deploy(inputs: PrepareInputs) -> PreparedPaths:
    source = read_env_file(inputs.oss_env, "OSS environment file")
    oss = {key: _required(source.get(key, ""), key) for key in OSS_KEYS}
    app_id = _read_app_id(inputs.project_config)
    dashscope_api_key = _required(inputs.dashscope_api_key, "DASHSCOPE_API_KEY")
    wechat_app_secret = _required(inputs.wechat_app_secret, "WECHAT_APP_SECRET")
    tencent_map_key = _required(inputs.tencent_map_key, "MINIPROGRAM_TENCENT_MAP_KEY")
    if TENCENT_MAP_KEY.fullmatch(tencent_map_key) is None:
        raise ValueError("MINIPROGRAM_TENCENT_MAP_KEY is invalid")
    if COMMIT_SHA.fullmatch(inputs.revision) is None:
        raise ValueError("APP_REVISION is not a 40-character commit SHA")

    existing: dict[str, str] = {}
    if inputs.deploy_env.exists():
        existing = read_env_file(inputs.deploy_env, "existing deployment environment file")
    preserved = _validate_preserved(existing)
    postgres_password = preserved.get("POSTGRES_PASSWORD", secrets.token_urlsafe(32))
    phone_key = preserved.get(
        "PHONE_ENCRYPTION_KEY_BASE64",
        base64.b64encode(secrets.token_bytes(32)).decode("ascii"),
    )
    reviewer_id = preserved.get("MODERATION_REVIEWER_USER_IDS", str(uuid.uuid4()))
    icp_confirmed = preserved.get("MINIPROGRAM_ICP_FILING_CONFIRMED", "false")
    oss_request_base_url = _oss_request_base_url(oss["OSS_ENDPOINT"], oss["OSS_BUCKET"])

    deploy_values = {
        "APP_ENV": "staging",
        "APP_REVISION": inputs.revision,
        "DATABASE_URL": (
            f"postgresql+psycopg://pitch:{postgres_password}@postgres:5432/pitch"
        ),
        "POSTGRES_DB": "pitch",
        "POSTGRES_USER": "pitch",
        "POSTGRES_PASSWORD": postgres_password,
        "PUBLIC_API_BASE_URL": API_BASE_URL,
        "PUBLIC_IMAGE_HOSTS": f'["{MEDIA_HOST}"]',
        **oss,
        "DASHSCOPE_API_KEY": dashscope_api_key,
        "DASHSCOPE_BASE_URL": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "DASHSCOPE_MODERATION_MODEL": "qwen3-vl-flash",
        "MODERATION_REVIEWER_USER_IDS": reviewer_id,
        "WECHAT_PROVIDER": "real",
        "PAYMENT_PROVIDER": "wechat",
        "ENABLE_MOCK_PAYMENT_PROVIDER": "false",
        "MINIPROGRAM_ICP_FILING_CONFIRMED": icp_confirmed,
        "WECHAT_APP_ID": app_id,
        "WECHAT_APP_SECRET": wechat_app_secret,
        "PHONE_ENCRYPTION_KEY_BASE64": phone_key,
        "PHONE_ENCRYPTION_KEY_VERSION": "1",
        "SESSION_TTL_DAYS": "30",
    }
    miniprogram_values = {
        "MINIPROGRAM_API_BASE_URL": API_BASE_URL,
        "MINIPROGRAM_TENCENT_MAP_KEY": tencent_map_key,
    }
    _atomic_write(
        inputs.deploy_env,
        _render(
            deploy_values,
            "# Generated local staging secrets. Do not commit. "
            "Bootstrap reviewer ID is not membership.",
        ),
    )
    _atomic_write(
        inputs.miniprogram_env,
        _render(
            miniprogram_values,
            f"# Generated local build inputs. OSS upload request origin: {oss_request_base_url}",
        ),
    )
    return PreparedPaths(inputs.deploy_env, inputs.miniprogram_env, oss_request_base_url)


def _git_revision() -> str:
    try:
        completed = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError) as error:
        raise ValueError("unable to resolve the current Git revision") from error
    return completed.stdout.strip()


def main() -> int:
    parser = argparse.ArgumentParser(description="Prepare ignored local live-staging inputs")
    parser.add_argument("--oss-env", type=Path, default=Path("backend/.env.local"))
    parser.add_argument("--project-config", type=Path, default=Path("project.private.config.json"))
    parser.add_argument("--deploy-env", type=Path, default=Path("deploy/.env.live.local"))
    parser.add_argument(
        "--miniprogram-env",
        type=Path,
        default=Path("deploy/miniprogram.live.local"),
    )
    args = parser.parse_args()

    wechat_secret = os.environ.get("WECHAT_APP_SECRET") or getpass.getpass(
        "WECHAT_APP_SECRET: "
    )
    tencent_key = os.environ.get("MINIPROGRAM_TENCENT_MAP_KEY") or getpass.getpass(
        "MINIPROGRAM_TENCENT_MAP_KEY: "
    )
    try:
        result = prepare_live_deploy(
            PrepareInputs(
                oss_env=args.oss_env,
                project_config=args.project_config,
                deploy_env=args.deploy_env,
                miniprogram_env=args.miniprogram_env,
                dashscope_api_key=os.environ.get("DASHSCOPE_API_KEY", ""),
                wechat_app_secret=wechat_secret,
                tencent_map_key=tencent_key,
                revision=_git_revision(),
            )
        )
    except ValueError as error:
        parser.error(str(error))

    print(f"Prepared {result.deploy_env} and {result.miniprogram_env} with mode 0600.")
    print(f"WeChat request origins: {API_BASE_URL}, {result.oss_request_base_url}")
    print(f"WeChat download origin: https://{MEDIA_HOST}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
