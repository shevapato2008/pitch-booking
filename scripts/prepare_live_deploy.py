from __future__ import annotations

import argparse
import base64
import getpass
import hashlib
import ipaddress
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

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

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
    "ONBOARDING_OSS_BUCKET",
    "PLATFORM_STAFF_PRINCIPALS_JSON",
    "PLATFORM_CSRF_SECRET",
    "PAYMENT_PROVIDER",
    "WECHAT_PAY_MERCHANT_ID",
    "WECHAT_PAY_MERCHANT_CERT_SERIAL",
    "WECHAT_PAY_MERCHANT_PRIVATE_KEY_PEM_BASE64",
    "WECHAT_PAY_PUBLIC_KEY_ID",
    "WECHAT_PAY_PUBLIC_KEY_PEM_BASE64",
    "WECHAT_PAY_API_V3_KEY",
    "WECHAT_PAY_PAYMENT_NOTIFICATION_URL",
    "WECHAT_PAY_REFUND_NOTIFICATION_URL",
)
ENV_KEY = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
COMMIT_SHA = re.compile(r"^[0-9a-fA-F]{40}$")
OSS_BUCKET = re.compile(r"^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$")
TENCENT_MAP_KEY = re.compile(r"^[A-Z0-9]{5}(?:-[A-Z0-9]{5}){5}$", re.IGNORECASE)
API_BASE_URL = "https://pitch-api-staging.modelstella.com"
MEDIA_HOST = "media.modelstella.com"
PLATFORM_ROLES = frozenset({"PLATFORM_ADMIN", "ONBOARDING_REVIEWER"})
WECHAT_PAY_KEYS = PRESERVED_KEYS[-8:]
WECHAT_PAY_API_V3_KEY = re.compile(r"[A-Za-z0-9_-]{32}", re.ASCII)
OPEN_GAME_NOTIFICATION_TEMPLATE_ID = re.compile(r"[A-Za-z0-9_-]{1,128}", re.ASCII)
SPECIAL_USE_DOMAIN_SUFFIXES = (
    "invalid",
    "localhost",
    "test",
    "example",
    "example.com",
    "example.net",
    "example.org",
)
PAYMENT_NOTIFICATION_URL = f"{API_BASE_URL}/api/v1/payments/wechat/notify"
REFUND_NOTIFICATION_URL = f"{API_BASE_URL}/api/v1/refunds/wechat/notify"


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
    wechat_pay_merchant_id: str
    wechat_pay_merchant_cert_serial: str
    wechat_pay_merchant_private_key_pem_base64: str
    wechat_pay_public_key_id: str
    wechat_pay_public_key_pem_base64: str
    wechat_pay_api_v3_key: str
    wechat_pay_payment_notification_url: str
    wechat_pay_refund_notification_url: str
    payment_provider: str = "wechat"
    onboarding_oss_bucket: str = ""
    platform_reviewer_token: str = ""
    open_game_notification_provider: str = "disabled"
    open_game_notification_template_id: str = ""
    open_game_notification_keyword_mapping_json: str = ""
    open_game_notification_miniprogram_state: str = "formal"
    venue_staff_authorization_enabled: bool = False


@dataclass(frozen=True)
class PreparedPaths:
    deploy_env: Path
    miniprogram_env: Path
    oss_request_base_url: str
    onboarding_upload_base_url: str


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


def _is_placeholder(value: str) -> bool:
    normalized = value.casefold()
    return normalized.startswith(("replace-", "change-", "generate-", "inject-", "your-")) or (
        ".invalid" in normalized
    )


def _validated_open_game_notification_config(
    *,
    provider: str,
    template_id: str,
    keyword_mapping_json: str,
    miniprogram_state: str,
) -> dict[str, str]:
    normalized_provider = provider.strip().casefold()
    if normalized_provider not in {"disabled", "wechat"}:
        raise ValueError("OPEN_GAME_NOTIFICATION_PROVIDER must be wechat or disabled")
    normalized_state = miniprogram_state.strip().casefold()
    if normalized_state not in {"formal", "trial", "developer"}:
        raise ValueError("OPEN_GAME_NOTIFICATION_MINIPROGRAM_STATE is invalid")
    if normalized_provider == "disabled":
        return {
            "provider": "disabled",
            "template_id": "",
            "keyword_mapping_json": "",
            "miniprogram_state": normalized_state,
        }

    normalized_template_id = _required(template_id, "OPEN_GAME_NOTIFICATION_TEMPLATE_ID")
    if OPEN_GAME_NOTIFICATION_TEMPLATE_ID.fullmatch(
        normalized_template_id
    ) is None or _is_placeholder(normalized_template_id):
        raise ValueError("OPEN_GAME_NOTIFICATION_TEMPLATE_ID is invalid")
    normalized_mapping = _required(
        keyword_mapping_json, "OPEN_GAME_NOTIFICATION_KEYWORD_MAPPING_JSON"
    )
    try:
        mapping = json.loads(normalized_mapping)
    except (json.JSONDecodeError, TypeError):
        raise ValueError("OPEN_GAME_NOTIFICATION_KEYWORD_MAPPING_JSON is invalid") from None
    expected = {"game_name", "starts_at", "venue_name"}
    if (
        not isinstance(mapping, dict)
        or set(mapping) != expected
        or type(mapping.get("game_name")) is not str
        or re.fullmatch(r"thing[1-9][0-9]*", mapping["game_name"], re.ASCII) is None
        or type(mapping.get("starts_at")) is not str
        or re.fullmatch(r"time[1-9][0-9]*", mapping["starts_at"], re.ASCII) is None
        or type(mapping.get("venue_name")) is not str
        or re.fullmatch(r"thing[1-9][0-9]*", mapping["venue_name"], re.ASCII) is None
        or len(set(mapping.values())) != 3
    ):
        raise ValueError("OPEN_GAME_NOTIFICATION_KEYWORD_MAPPING_JSON is invalid")
    return {
        "provider": "wechat",
        "template_id": normalized_template_id,
        "keyword_mapping_json": json.dumps(
            mapping, ensure_ascii=True, sort_keys=True, separators=(",", ":")
        ),
        "miniprogram_state": normalized_state,
    }


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

    onboarding_bucket = values.get("ONBOARDING_OSS_BUCKET")
    if onboarding_bucket and OSS_BUCKET.fullmatch(onboarding_bucket) is not None:
        preserved["ONBOARDING_OSS_BUCKET"] = onboarding_bucket

    principals = values.get("PLATFORM_STAFF_PRINCIPALS_JSON")
    if principals and _valid_platform_principals(principals):
        preserved["PLATFORM_STAFF_PRINCIPALS_JSON"] = principals

    csrf_secret = values.get("PLATFORM_CSRF_SECRET")
    if csrf_secret and _valid_base64_32(csrf_secret):
        preserved["PLATFORM_CSRF_SECRET"] = csrf_secret
    payment_provider = values.get("PAYMENT_PROVIDER")
    if payment_provider in {"wechat", "disabled"}:
        preserved["PAYMENT_PROVIDER"] = payment_provider
    try:
        preserved.update(_validated_wechat_pay_config(values))
    except ValueError:
        pass
    return preserved


def _validated_wechat_pay_config(values: Mapping[str, str]) -> dict[str, str]:
    merchant_id = _required(values.get("WECHAT_PAY_MERCHANT_ID", ""), "WECHAT_PAY_MERCHANT_ID")
    if not merchant_id.isascii() or not merchant_id.isdigit():
        raise ValueError("WECHAT_PAY_MERCHANT_ID is invalid")
    serial = _required(
        values.get("WECHAT_PAY_MERCHANT_CERT_SERIAL", ""),
        "WECHAT_PAY_MERCHANT_CERT_SERIAL",
    )
    if re.fullmatch(r"[0-9A-F]+", serial, re.ASCII) is None:
        raise ValueError("WECHAT_PAY_MERCHANT_CERT_SERIAL is invalid")
    private_key = _validated_pem_base64(
        values.get("WECHAT_PAY_MERCHANT_PRIVATE_KEY_PEM_BASE64", ""),
        private=True,
    )
    public_key_id = _required(
        values.get("WECHAT_PAY_PUBLIC_KEY_ID", ""), "WECHAT_PAY_PUBLIC_KEY_ID"
    )
    if re.fullmatch(r"PUB_KEY_ID_[0-9]+", public_key_id, re.ASCII) is None:
        raise ValueError("WECHAT_PAY_PUBLIC_KEY_ID is invalid")
    public_key = _validated_pem_base64(
        values.get("WECHAT_PAY_PUBLIC_KEY_PEM_BASE64", ""),
        private=False,
    )
    api_key = _required(values.get("WECHAT_PAY_API_V3_KEY", ""), "WECHAT_PAY_API_V3_KEY")
    if WECHAT_PAY_API_V3_KEY.fullmatch(api_key) is None:
        raise ValueError(
            "WECHAT_PAY_API_V3_KEY must be exactly 32 bytes using deployment-safe ASCII"
        )
    payment_url = _validated_notification_url(
        values.get("WECHAT_PAY_PAYMENT_NOTIFICATION_URL", ""),
        "WECHAT_PAY_PAYMENT_NOTIFICATION_URL",
        public_api_base_url=API_BASE_URL,
    )
    refund_url = _validated_notification_url(
        values.get("WECHAT_PAY_REFUND_NOTIFICATION_URL", ""),
        "WECHAT_PAY_REFUND_NOTIFICATION_URL",
        public_api_base_url=API_BASE_URL,
    )
    return {
        "WECHAT_PAY_MERCHANT_ID": merchant_id,
        "WECHAT_PAY_MERCHANT_CERT_SERIAL": serial,
        "WECHAT_PAY_MERCHANT_PRIVATE_KEY_PEM_BASE64": private_key,
        "WECHAT_PAY_PUBLIC_KEY_ID": public_key_id,
        "WECHAT_PAY_PUBLIC_KEY_PEM_BASE64": public_key,
        "WECHAT_PAY_API_V3_KEY": api_key,
        "WECHAT_PAY_PAYMENT_NOTIFICATION_URL": payment_url,
        "WECHAT_PAY_REFUND_NOTIFICATION_URL": refund_url,
    }


def _validated_pem_base64(value: str, *, private: bool) -> str:
    label = "private key" if private else "public key"
    normalized = _required(value, f"WeChat Pay {label}")
    try:
        decoded = base64.b64decode(normalized, validate=True)
        if private:
            key = serialization.load_pem_private_key(decoded, password=None)
            if not isinstance(key, rsa.RSAPrivateKey) or key.key_size != 2048:
                raise ValueError
        else:
            key = serialization.load_pem_public_key(decoded)
            if not isinstance(key, rsa.RSAPublicKey) or key.key_size != 2048:
                raise ValueError
    except (TypeError, ValueError):
        raise ValueError(f"WeChat Pay {label} PEM/Base64 is invalid") from None
    return normalized


def _validated_notification_url(
    value: str,
    field: str,
    *,
    public_api_base_url: str,
) -> str:
    normalized = _required(value, field)
    public_origin = _public_https_origin(public_api_base_url)
    callback_origin = _public_https_origin(normalized)
    if public_origin is None or callback_origin is None or callback_origin != public_origin:
        raise ValueError(f"{field} notification URL must use the public API origin")
    return normalized


def _public_https_origin(value: str) -> tuple[str, int] | None:
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError:
        return None
    hostname = parsed.hostname
    if (
        parsed.scheme.casefold() != "https"
        or hostname is None
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or port not in {None, 443}
    ):
        return None
    normalized_host = hostname.rstrip(".").casefold()
    if any(
        normalized_host == suffix or normalized_host.endswith(f".{suffix}")
        for suffix in SPECIAL_USE_DOMAIN_SUFFIXES
    ):
        return None
    try:
        address = ipaddress.ip_address(normalized_host)
    except ValueError:
        pass
    else:
        if not address.is_global:
            return None
    return normalized_host, 443


def _valid_base64_32(value: str) -> bool:
    try:
        decoded = base64.b64decode(value, validate=True)
    except (ValueError, UnicodeError):
        return False
    return len(decoded) == 32 and base64.b64encode(decoded).decode("ascii") == value


def _valid_platform_principals(value: str) -> bool:
    try:
        principals = json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return False
    if not isinstance(principals, list) or not principals:
        return False
    expected = {
        "principal_id",
        "display_name",
        "token_sha256",
        "enabled",
        "roles",
    }
    principal_ids: set[str] = set()
    token_hashes: set[str] = set()
    has_enabled_reviewer = False
    for principal in principals:
        if not isinstance(principal, dict) or set(principal) != expected:
            return False
        principal_id = principal["principal_id"]
        display_name = principal["display_name"]
        token_hash = principal["token_sha256"]
        enabled = principal["enabled"]
        roles = principal["roles"]
        if (
            type(principal_id) is not str
            or not 1 <= len(principal_id.strip()) <= 128
            or principal_id != principal_id.strip()
            or type(display_name) is not str
            or not 1 <= len(display_name.strip()) <= 120
            or display_name != display_name.strip()
            or type(token_hash) is not str
            or re.fullmatch(r"[0-9a-f]{64}", token_hash, re.ASCII) is None
            or type(enabled) is not bool
            or not isinstance(roles, list)
            or not roles
            or any(type(role) is not str or role not in PLATFORM_ROLES for role in roles)
            or len(roles) != len(set(roles))
            or principal_id in principal_ids
            or token_hash in token_hashes
        ):
            return False
        principal_ids.add(principal_id)
        token_hashes.add(token_hash)
        has_enabled_reviewer = has_enabled_reviewer or (enabled and "ONBOARDING_REVIEWER" in roles)
    return has_enabled_reviewer


def _platform_principals_json(raw_token: str) -> str:
    token = _required(raw_token, "platform reviewer token")
    if len(token) < 32:
        raise ValueError("platform reviewer token must contain at least 32 characters")
    return json.dumps(
        [
            {
                "principal_id": "onboarding-reviewer",
                "display_name": "入驻审核员",
                "token_sha256": hashlib.sha256(token.encode("utf-8")).hexdigest(),
                "enabled": True,
                "roles": ["ONBOARDING_REVIEWER"],
            }
        ],
        ensure_ascii=False,
        separators=(",", ":"),
    )


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
    payment_provider = inputs.payment_provider.strip().casefold()
    if payment_provider not in {"wechat", "disabled"}:
        raise ValueError("PAYMENT_PROVIDER must be wechat or disabled")
    notification_config = _validated_open_game_notification_config(
        provider=inputs.open_game_notification_provider,
        template_id=inputs.open_game_notification_template_id,
        keyword_mapping_json=inputs.open_game_notification_keyword_mapping_json,
        miniprogram_state=inputs.open_game_notification_miniprogram_state,
    )
    if (
        notification_config["provider"] == "wechat"
        and notification_config["miniprogram_state"] != "trial"
    ):
        raise ValueError(
            "OPEN_GAME_NOTIFICATION_MINIPROGRAM_STATE must be trial for staging notifications"
        )

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
    preserved_onboarding_bucket = preserved.get("ONBOARDING_OSS_BUCKET")
    if preserved_onboarding_bucket == oss["OSS_BUCKET"]:
        preserved_onboarding_bucket = None
    onboarding_bucket = preserved_onboarding_bucket or _required(
        inputs.onboarding_oss_bucket, "ONBOARDING_OSS_BUCKET"
    )
    if OSS_BUCKET.fullmatch(onboarding_bucket) is None:
        raise ValueError("ONBOARDING_OSS_BUCKET is invalid")
    if onboarding_bucket == oss["OSS_BUCKET"]:
        raise ValueError("ONBOARDING_OSS_BUCKET must be separate from OSS_BUCKET")
    platform_principals = preserved.get("PLATFORM_STAFF_PRINCIPALS_JSON")
    if platform_principals is None:
        platform_principals = _platform_principals_json(inputs.platform_reviewer_token)
    platform_csrf_secret = preserved.get(
        "PLATFORM_CSRF_SECRET",
        base64.b64encode(secrets.token_bytes(32)).decode("ascii"),
    )
    payment_input_values = {
        "WECHAT_PAY_MERCHANT_ID": inputs.wechat_pay_merchant_id,
        "WECHAT_PAY_MERCHANT_CERT_SERIAL": inputs.wechat_pay_merchant_cert_serial,
        "WECHAT_PAY_MERCHANT_PRIVATE_KEY_PEM_BASE64": (
            inputs.wechat_pay_merchant_private_key_pem_base64
        ),
        "WECHAT_PAY_PUBLIC_KEY_ID": inputs.wechat_pay_public_key_id,
        "WECHAT_PAY_PUBLIC_KEY_PEM_BASE64": inputs.wechat_pay_public_key_pem_base64,
        "WECHAT_PAY_API_V3_KEY": inputs.wechat_pay_api_v3_key,
        "WECHAT_PAY_PAYMENT_NOTIFICATION_URL": (inputs.wechat_pay_payment_notification_url),
        "WECHAT_PAY_REFUND_NOTIFICATION_URL": inputs.wechat_pay_refund_notification_url,
    }
    payment_config = {}
    if payment_provider == "wechat":
        payment_config = (
            {key: preserved[key] for key in WECHAT_PAY_KEYS}
            if all(key in preserved for key in WECHAT_PAY_KEYS)
            else _validated_wechat_pay_config(payment_input_values)
        )
    oss_request_base_url = _oss_request_base_url(oss["OSS_ENDPOINT"], oss["OSS_BUCKET"])
    onboarding_upload_base_url = _oss_request_base_url(oss["OSS_ENDPOINT"], onboarding_bucket)

    deploy_values = {
        "APP_ENV": "staging",
        "APP_REVISION": inputs.revision,
        "DATABASE_URL": (f"postgresql+psycopg://pitch:{postgres_password}@postgres:5432/pitch"),
        "POSTGRES_DB": "pitch",
        "POSTGRES_USER": "pitch",
        "POSTGRES_PASSWORD": postgres_password,
        "PUBLIC_API_BASE_URL": API_BASE_URL,
        "PUBLIC_IMAGE_HOSTS": f'["{MEDIA_HOST}"]',
        **oss,
        "ONBOARDING_OSS_BUCKET": onboarding_bucket,
        "DASHSCOPE_API_KEY": dashscope_api_key,
        "DASHSCOPE_BASE_URL": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "DASHSCOPE_MODERATION_MODEL": "qwen3-vl-flash",
        "MODERATION_REVIEWER_USER_IDS": reviewer_id,
        "WECHAT_PROVIDER": "real",
        "OPEN_GAME_NOTIFICATION_PROVIDER": notification_config["provider"],
        "OPEN_GAME_NOTIFICATION_TEMPLATE_ID": notification_config["template_id"],
        "OPEN_GAME_NOTIFICATION_KEYWORD_MAPPING_JSON": notification_config["keyword_mapping_json"],
        "OPEN_GAME_NOTIFICATION_MINIPROGRAM_STATE": notification_config["miniprogram_state"],
        "PAYMENT_PROVIDER": payment_provider,
        "ENABLE_MOCK_PAYMENT_PROVIDER": "false",
        **payment_config,
        "MINIPROGRAM_ICP_FILING_CONFIRMED": icp_confirmed,
        "WECHAT_APP_ID": app_id,
        "WECHAT_APP_SECRET": wechat_app_secret,
        "PHONE_ENCRYPTION_KEY_BASE64": phone_key,
        "PHONE_ENCRYPTION_KEY_VERSION": "1",
        "SESSION_TTL_DAYS": "30",
        "PLATFORM_STAFF_PRINCIPALS_JSON": platform_principals,
        "PLATFORM_CSRF_SECRET": platform_csrf_secret,
        "VENUE_STAFF_AUTHORIZATION_ENABLED": (
            "true" if inputs.venue_staff_authorization_enabled else "false"
        ),
    }
    miniprogram_values = {
        "MINIPROGRAM_API_BASE_URL": API_BASE_URL,
        "MINIPROGRAM_TENCENT_MAP_KEY": tencent_map_key,
        "MINIPROGRAM_PAYMENT_PROVIDER": payment_provider,
        "MINIPROGRAM_OPEN_GAME_NOTIFICATION_PROVIDER": notification_config["provider"],
        "MINIPROGRAM_WAITLIST_PROMOTED_TEMPLATE_ID": notification_config["template_id"],
        "MINIPROGRAM_VENUE_STAFF_AUTHORIZATION_ENABLED": (
            "true" if inputs.venue_staff_authorization_enabled else "false"
        ),
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
            "# Generated local build inputs. WeChat OSS request origin: "
            f"{oss_request_base_url}; uploadFile origin: {onboarding_upload_base_url}",
        ),
    )
    return PreparedPaths(
        inputs.deploy_env,
        inputs.miniprogram_env,
        oss_request_base_url,
        onboarding_upload_base_url,
    )


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

    existing: dict[str, str] = {}
    if args.deploy_env.exists():
        try:
            existing = read_env_file(args.deploy_env, "existing deployment environment file")
        except ValueError as error:
            parser.error(str(error))
    try:
        existing_bootstrap = _validate_preserved(existing)
    except ValueError as error:
        parser.error(str(error))
    onboarding_bucket = existing_bootstrap.get("ONBOARDING_OSS_BUCKET", "")
    try:
        source_oss_bucket = read_env_file(args.oss_env, "OSS environment file").get(
            "OSS_BUCKET", ""
        )
    except ValueError as error:
        parser.error(str(error))
    if onboarding_bucket == source_oss_bucket:
        onboarding_bucket = ""
    if not onboarding_bucket:
        onboarding_bucket = os.environ.get("ONBOARDING_OSS_BUCKET") or getpass.getpass(
            "ONBOARDING_OSS_BUCKET: "
        )
    reviewer_token = ""
    if "PLATFORM_STAFF_PRINCIPALS_JSON" not in existing_bootstrap:
        reviewer_token = getpass.getpass("PLATFORM_REVIEWER_TOKEN: ")

    payment_provider = (
        (
            os.environ.get("PAYMENT_PROVIDER")
            or existing_bootstrap.get("PAYMENT_PROVIDER")
            or "disabled"
        )
        .strip()
        .casefold()
    )
    if payment_provider not in {"wechat", "disabled"}:
        parser.error("PAYMENT_PROVIDER must be wechat or disabled")
    notification_provider = (
        os.environ.get("OPEN_GAME_NOTIFICATION_PROVIDER", "disabled").strip().casefold()
    )
    if notification_provider not in {"wechat", "disabled"}:
        parser.error("OPEN_GAME_NOTIFICATION_PROVIDER must be wechat or disabled")
    venue_staff_authorization = os.environ.get(
        "VENUE_STAFF_AUTHORIZATION_ENABLED", "false"
    ).strip().casefold()
    if venue_staff_authorization not in {"true", "false"}:
        parser.error("VENUE_STAFF_AUTHORIZATION_ENABLED must be true or false")
    existing_payment = (
        {key: existing_bootstrap[key] for key in WECHAT_PAY_KEYS}
        if payment_provider == "wechat"
        and all(key in existing_bootstrap for key in WECHAT_PAY_KEYS)
        else {}
    )

    def payment_input(key: str, *, default: str = "") -> str:
        if payment_provider == "disabled":
            return ""
        if existing_payment:
            return existing_payment[key]
        return os.environ.get(key) or default or getpass.getpass(f"{key}: ")

    wechat_secret = os.environ.get("WECHAT_APP_SECRET") or getpass.getpass("WECHAT_APP_SECRET: ")
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
                payment_provider=payment_provider,
                wechat_pay_merchant_id=payment_input("WECHAT_PAY_MERCHANT_ID"),
                wechat_pay_merchant_cert_serial=payment_input("WECHAT_PAY_MERCHANT_CERT_SERIAL"),
                wechat_pay_merchant_private_key_pem_base64=payment_input(
                    "WECHAT_PAY_MERCHANT_PRIVATE_KEY_PEM_BASE64"
                ),
                wechat_pay_public_key_id=payment_input("WECHAT_PAY_PUBLIC_KEY_ID"),
                wechat_pay_public_key_pem_base64=payment_input("WECHAT_PAY_PUBLIC_KEY_PEM_BASE64"),
                wechat_pay_api_v3_key=payment_input("WECHAT_PAY_API_V3_KEY"),
                wechat_pay_payment_notification_url=payment_input(
                    "WECHAT_PAY_PAYMENT_NOTIFICATION_URL",
                    default=PAYMENT_NOTIFICATION_URL,
                ),
                wechat_pay_refund_notification_url=payment_input(
                    "WECHAT_PAY_REFUND_NOTIFICATION_URL",
                    default=REFUND_NOTIFICATION_URL,
                ),
                onboarding_oss_bucket=onboarding_bucket,
                platform_reviewer_token=reviewer_token,
                open_game_notification_provider=notification_provider,
                open_game_notification_template_id=os.environ.get(
                    "OPEN_GAME_NOTIFICATION_TEMPLATE_ID", ""
                ),
                open_game_notification_keyword_mapping_json=os.environ.get(
                    "OPEN_GAME_NOTIFICATION_KEYWORD_MAPPING_JSON", ""
                ),
                open_game_notification_miniprogram_state=os.environ.get(
                    "OPEN_GAME_NOTIFICATION_MINIPROGRAM_STATE", "formal"
                ),
                venue_staff_authorization_enabled=(venue_staff_authorization == "true"),
            )
        )
    except ValueError as error:
        parser.error(str(error))

    print(f"Prepared {result.deploy_env} and {result.miniprogram_env} with mode 0600.")
    print(
        f"WeChat request origins: {API_BASE_URL}, {result.oss_request_base_url}, "
        "https://apis.map.qq.com"
    )
    print(f"WeChat uploadFile origin: {result.onboarding_upload_base_url}")
    print(f"WeChat download origin: https://{MEDIA_HOST}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
