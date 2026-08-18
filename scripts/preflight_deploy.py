from __future__ import annotations

import argparse
import base64
import ipaddress
import json
import re
import uuid
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

REQUIRED_KEYS = (
    "APP_ENV",
    "APP_REVISION",
    "DATABASE_URL",
    "POSTGRES_DB",
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
    "PUBLIC_API_BASE_URL",
    "PUBLIC_IMAGE_HOSTS",
    "OSS_ENDPOINT",
    "OSS_BUCKET",
    "OSS_PUBLIC_BASE_URL",
    "OSS_ACCESS_KEY_ID",
    "OSS_ACCESS_KEY_SECRET",
    "DASHSCOPE_API_KEY",
    "DASHSCOPE_BASE_URL",
    "DASHSCOPE_MODERATION_MODEL",
    "MODERATION_REVIEWER_USER_IDS",
    "PAYMENT_PROVIDER",
    "ENABLE_MOCK_PAYMENT_PROVIDER",
    "ONBOARDING_OSS_BUCKET",
    "PLATFORM_STAFF_PRINCIPALS_JSON",
    "PLATFORM_CSRF_SECRET",
)
WECHAT_PAY_REQUIRED_KEYS = (
    "WECHAT_PAY_MERCHANT_ID",
    "WECHAT_PAY_MERCHANT_CERT_SERIAL",
    "WECHAT_PAY_MERCHANT_PRIVATE_KEY_PEM_BASE64",
    "WECHAT_PAY_PUBLIC_KEY_ID",
    "WECHAT_PAY_PUBLIC_KEY_PEM_BASE64",
    "WECHAT_PAY_API_V3_KEY",
    "WECHAT_PAY_PAYMENT_NOTIFICATION_URL",
    "WECHAT_PAY_REFUND_NOTIFICATION_URL",
)
COMMIT_SHA = re.compile(r"^[0-9a-fA-F]{40}$")
OSS_BUCKET = re.compile(r"^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$")
LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})
PLATFORM_ROLES = frozenset({"PLATFORM_ADMIN", "ONBOARDING_REVIEWER"})
WECHAT_PAY_API_V3_KEY = re.compile(r"[A-Za-z0-9_-]{32}", re.ASCII)
SPECIAL_USE_DOMAIN_SUFFIXES = (
    "invalid",
    "localhost",
    "test",
    "example",
    "example.com",
    "example.net",
    "example.org",
)


@dataclass(frozen=True)
class PreflightResult:
    failures: tuple[str, ...]

    @property
    def ok(self) -> bool:
        return not self.failures


def read_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line_number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            raise ValueError(f"invalid env line {line_number}")
        key, value = line.split("=", 1)
        key = key.strip()
        if not key or key in values:
            raise ValueError(f"invalid env key on line {line_number}")
        values[key] = value.strip()
    return values


def preflight(
    env_file: str | Path,
    *,
    require_miniprogram_acceptance: bool = False,
) -> PreflightResult:
    try:
        values = read_env_file(Path(env_file))
    except (OSError, UnicodeError, ValueError) as error:
        return PreflightResult((f"environment file is invalid: {error}",))

    payment_provider = values.get("PAYMENT_PROVIDER")
    required_keys = (
        (*REQUIRED_KEYS, *WECHAT_PAY_REQUIRED_KEYS)
        if payment_provider == "wechat"
        else REQUIRED_KEYS
    )
    failures = [f"{key} is required" for key in required_keys if not values.get(key)]
    if values.get("POSTGRES_PASSWORD") == "change-before-deploy":
        failures.append("POSTGRES_PASSWORD uses validation sentinel")
    if not COMMIT_SHA.fullmatch(values.get("APP_REVISION", "")):
        failures.append("APP_REVISION is not a 40-character commit SHA")
    if values.get("PAYMENT_PROVIDER") != "wechat":
        failures.append("PAYMENT_PROVIDER must be wechat for deployment")
    if values.get("ENABLE_MOCK_PAYMENT_PROVIDER", "").casefold() != "false":
        failures.append("ENABLE_MOCK_PAYMENT_PROVIDER must be false for deployment")
    if payment_provider == "wechat":
        _validate_wechat_pay(values, failures)
    if (
        require_miniprogram_acceptance
        and values.get("MINIPROGRAM_ICP_FILING_CONFIRMED", "").casefold() != "true"
    ):
        failures.append(
            "MINIPROGRAM_ICP_FILING_CONFIRMED must be true before generating a device QR code"
        )

    public_url = values.get("PUBLIC_API_BASE_URL", "")
    parsed = urlsplit(public_url)
    if parsed.hostname and parsed.hostname.endswith(".invalid"):
        failures.append("PUBLIC_API_BASE_URL uses validation sentinel")
    elif parsed.scheme not in {"http", "https"} or not parsed.hostname:
        failures.append("PUBLIC_API_BASE_URL must be an absolute HTTP(S) URL")
    elif parsed.scheme == "http" and parsed.hostname not in LOOPBACK_HOSTS:
        failures.append("PUBLIC_API_BASE_URL must use HTTPS unless it targets loopback")

    try:
        image_hosts = json.loads(values.get("PUBLIC_IMAGE_HOSTS", ""))
    except json.JSONDecodeError:
        image_hosts = None
    if (
        not isinstance(image_hosts, list)
        or not image_hosts
        or any(not isinstance(host, str) or not host for host in image_hosts)
    ):
        failures.append("PUBLIC_IMAGE_HOSTS must be a non-empty JSON string array")

    for key in ("OSS_ENDPOINT", "OSS_PUBLIC_BASE_URL"):
        parsed_oss_url = urlsplit(values.get(key, ""))
        if parsed_oss_url.scheme != "https":
            failures.append(f"{key} must use HTTPS")
        elif (
            not parsed_oss_url.hostname
            or parsed_oss_url.username is not None
            or parsed_oss_url.password is not None
        ):
            failures.append(f"{key} is invalid")
        elif parsed_oss_url.query or parsed_oss_url.fragment:
            failures.append(f"{key} must not contain query or fragment")
        elif key == "OSS_ENDPOINT" and parsed_oss_url.path not in {"", "/"}:
            failures.append("OSS_ENDPOINT must be an origin URL")
    if values.get("OSS_BUCKET") and OSS_BUCKET.fullmatch(values["OSS_BUCKET"]) is None:
        failures.append("OSS_BUCKET is invalid")
    onboarding_bucket = values.get("ONBOARDING_OSS_BUCKET", "")
    if onboarding_bucket and OSS_BUCKET.fullmatch(onboarding_bucket) is None:
        failures.append("ONBOARDING_OSS_BUCKET is invalid")
    elif onboarding_bucket and onboarding_bucket == values.get("OSS_BUCKET"):
        failures.append("ONBOARDING_OSS_BUCKET must be separate from OSS_BUCKET")

    dashscope_url = urlsplit(values.get("DASHSCOPE_BASE_URL", ""))
    if dashscope_url.scheme != "https":
        failures.append("DASHSCOPE_BASE_URL must use HTTPS")
    elif (
        not dashscope_url.hostname
        or dashscope_url.username is not None
        or dashscope_url.password is not None
        or dashscope_url.query
        or dashscope_url.fragment
    ):
        failures.append("DASHSCOPE_BASE_URL is invalid")
    reviewer_ids = values.get("MODERATION_REVIEWER_USER_IDS", "").split(",")
    try:
        if any(not value.strip() for value in reviewer_ids):
            raise ValueError
        normalized_reviewers = [uuid.UUID(value.strip()) for value in reviewer_ids]
        if len(normalized_reviewers) != len(set(normalized_reviewers)):
            raise ValueError
    except ValueError:
        failures.append("MODERATION_REVIEWER_USER_IDS must be unique comma-separated UUIDs")

    principals_value = values.get("PLATFORM_STAFF_PRINCIPALS_JSON", "")
    principals_valid, has_enabled_reviewer = _validate_platform_principals(principals_value)
    if principals_value and not principals_valid:
        failures.append("PLATFORM_STAFF_PRINCIPALS_JSON is invalid")
    elif principals_value and not has_enabled_reviewer:
        failures.append(
            "PLATFORM_STAFF_PRINCIPALS_JSON must contain an enabled ONBOARDING_REVIEWER"
        )

    csrf_secret = values.get("PLATFORM_CSRF_SECRET", "")
    if csrf_secret:
        try:
            csrf_bytes = base64.b64decode(csrf_secret, validate=True)
        except (ValueError, UnicodeError):
            csrf_bytes = b""
        if len(csrf_bytes) != 32 or base64.b64encode(csrf_bytes).decode("ascii") != csrf_secret:
            failures.append("PLATFORM_CSRF_SECRET must be canonical Base64 for exactly 32 bytes")

    return PreflightResult(tuple(failures))


def _validate_wechat_pay(values: dict[str, str], failures: list[str]) -> None:
    merchant_id = values.get("WECHAT_PAY_MERCHANT_ID", "")
    if merchant_id and (not merchant_id.isascii() or not merchant_id.isdigit()):
        failures.append("WECHAT_PAY_MERCHANT_ID is invalid")
    serial = values.get("WECHAT_PAY_MERCHANT_CERT_SERIAL", "")
    if serial and re.fullmatch(r"[0-9A-F]+", serial, re.ASCII) is None:
        failures.append("WECHAT_PAY_MERCHANT_CERT_SERIAL is invalid")
    public_key_id = values.get("WECHAT_PAY_PUBLIC_KEY_ID", "")
    if public_key_id and re.fullmatch(r"PUB_KEY_ID_[0-9]+", public_key_id, re.ASCII) is None:
        failures.append("WECHAT_PAY_PUBLIC_KEY_ID is invalid")
    _validate_pem(
        values.get("WECHAT_PAY_MERCHANT_PRIVATE_KEY_PEM_BASE64", ""),
        field="WECHAT_PAY_MERCHANT_PRIVATE_KEY_PEM_BASE64",
        private=True,
        failures=failures,
    )
    _validate_pem(
        values.get("WECHAT_PAY_PUBLIC_KEY_PEM_BASE64", ""),
        field="WECHAT_PAY_PUBLIC_KEY_PEM_BASE64",
        private=False,
        failures=failures,
    )
    api_key = values.get("WECHAT_PAY_API_V3_KEY", "")
    if api_key and WECHAT_PAY_API_V3_KEY.fullmatch(api_key) is None:
        failures.append(
            "WECHAT_PAY_API_V3_KEY must be exactly 32 bytes using deployment-safe ASCII"
        )
    public_origin = _public_https_origin(values.get("PUBLIC_API_BASE_URL", ""))
    for field in (
        "WECHAT_PAY_PAYMENT_NOTIFICATION_URL",
        "WECHAT_PAY_REFUND_NOTIFICATION_URL",
    ):
        value = values.get(field, "")
        if not value:
            continue
        callback_origin = _public_https_origin(value)
        if public_origin is None or callback_origin is None or callback_origin != public_origin:
            failures.append(f"{field} must use the PUBLIC_API_BASE_URL public HTTPS origin")


def _validate_pem(
    value: str,
    *,
    field: str,
    private: bool,
    failures: list[str],
) -> None:
    if not value:
        return
    try:
        decoded = base64.b64decode(value, validate=True)
        if private:
            key = serialization.load_pem_private_key(decoded, password=None)
            if not isinstance(key, rsa.RSAPrivateKey) or key.key_size != 2048:
                raise ValueError
        else:
            key = serialization.load_pem_public_key(decoded)
            if not isinstance(key, rsa.RSAPublicKey) or key.key_size != 2048:
                raise ValueError
    except (TypeError, ValueError):
        failures.append(f"{field} is invalid")


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


def _validate_platform_principals(value: str) -> tuple[bool, bool]:
    try:
        principals = json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return False, False
    if not isinstance(principals, list):
        return False, False
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
            return False, False
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
            return False, False
        principal_ids.add(principal_id)
        token_hashes.add(token_hash)
        has_enabled_reviewer = has_enabled_reviewer or (enabled and "ONBOARDING_REVIEWER" in roles)
    return True, has_enabled_reviewer


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate local staging deployment inputs")
    parser.add_argument("--env-file", type=Path, required=True)
    parser.add_argument("--require-miniprogram-acceptance", action="store_true")
    args = parser.parse_args()
    result = preflight(
        args.env_file,
        require_miniprogram_acceptance=args.require_miniprogram_acceptance,
    )
    print(json.dumps({"ok": result.ok, "failures": result.failures}, ensure_ascii=False))
    return 0 if result.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
