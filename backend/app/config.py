import base64
import binascii
import inspect
import json
import re
import uuid
from typing import Annotated, Any, Literal, cast
from urllib.parse import urlsplit

from pydantic import (
    AnyHttpUrl,
    Field,
    SecretStr,
    TypeAdapter,
    ValidationError,
    ValidationInfo,
    field_validator,
    model_validator,
)
from pydantic_core import InitErrorDetails
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

_CANONICAL_POSITIVE_INTEGER = re.compile(r"[1-9][0-9]*", re.ASCII)
_HOST_LABEL = re.compile(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", re.ASCII)
_OSS_BUCKET = re.compile(r"[a-z0-9][a-z0-9-]{1,61}[a-z0-9]", re.ASCII)
_PUBLIC_API_URL_ADAPTER = TypeAdapter(AnyHttpUrl)
_SETTINGS_CONTROL_NAMES = frozenset(
    name
    for name in inspect.signature(BaseSettings.__init__).parameters
    if name.startswith("_") and name != "__pydantic_self__"
)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="",
        case_sensitive=False,
        extra="ignore",
        validate_default=True,
    )

    app_env: Literal["development", "test", "staging", "production"] = "development"
    app_revision: str = "development"
    database_url: str = Field(default="sqlite+pysqlite:///:memory:", repr=False)
    public_api_base_url: AnyHttpUrl | None = Field(default=None, repr=False)
    public_image_hosts: tuple[str, ...] = ()
    oss_endpoint: AnyHttpUrl | None = Field(default=None, repr=False)
    oss_bucket: str | None = Field(default=None, repr=False)
    onboarding_oss_bucket: str | None = Field(default=None, repr=False)
    oss_public_base_url: AnyHttpUrl | None = Field(default=None, repr=False)
    oss_access_key_id: str | None = Field(default=None, repr=False)
    oss_access_key_secret: SecretStr | None = Field(default=None, repr=False)
    dashscope_api_key: SecretStr | None = Field(default=None, repr=False)
    dashscope_base_url: AnyHttpUrl = Field(
        default_factory=lambda: _PUBLIC_API_URL_ADAPTER.validate_python(
            "https://dashscope.aliyuncs.com/compatible-mode/v1"
        ),
        repr=False,
    )
    dashscope_moderation_model: str = "qwen3-vl-flash"
    moderation_reviewer_user_ids: Annotated[tuple[uuid.UUID, ...], NoDecode] = ()
    wechat_provider: Literal["development", "real"] = "development"
    payment_provider: Literal["wechat", "mock"] = "wechat"
    enable_mock_payment_provider: bool = False
    wechat_app_id: str | None = None
    wechat_app_secret: SecretStr | None = Field(default=None, repr=False)
    wechat_pay_merchant_id: str | None = None
    wechat_pay_merchant_cert_serial: str | None = None
    wechat_pay_merchant_private_key_pem_base64: SecretStr | None = Field(
        default=None, repr=False
    )
    wechat_pay_public_key_id: str | None = None
    wechat_pay_public_key_pem_base64: SecretStr | None = Field(default=None, repr=False)
    wechat_pay_api_v3_key: SecretStr | None = Field(default=None, repr=False)
    wechat_pay_payment_notification_url: AnyHttpUrl | None = Field(
        default=None, repr=False
    )
    wechat_pay_refund_notification_url: AnyHttpUrl | None = Field(default=None, repr=False)
    phone_encryption_key_base64: SecretStr | None = Field(default=None, repr=False)
    phone_encryption_key_version: int | None = None
    session_ttl_days: int = 30
    platform_staff_principals_json: SecretStr | None = Field(default=None, repr=False)
    platform_csrf_secret: SecretStr | None = Field(default=None, repr=False)

    def __init__(self, **values: object) -> None:
        known_fields = {name.casefold(): name for name in type(self).model_fields}
        normalized: dict[str, object] = {}
        controls: dict[str, object] = {}
        errors: list[InitErrorDetails] = []
        strict_integer_fields = {"phone_encryption_key_version", "session_ttl_days"}

        for supplied_name, supplied_value in values.items():
            if supplied_name in _SETTINGS_CONTROL_NAMES:
                controls[supplied_name] = supplied_value
                continue
            canonical_name = known_fields.get(supplied_name.casefold())
            if canonical_name is None or canonical_name in normalized:
                errors.append(
                    InitErrorDetails(
                        type="extra_forbidden",
                        loc=(supplied_name,),
                        input="<redacted>",
                    )
                )
                continue
            if canonical_name == "database_url" and type(supplied_value) is not str:
                errors.append(self._input_error(canonical_name, "DATABASE_URL is invalid"))
                continue
            if (
                canonical_name in strict_integer_fields
                and supplied_value is not None
                and type(supplied_value) is not int
            ):
                errors.append(
                    self._input_error(
                        canonical_name,
                        f"{canonical_name.upper()} must be an integer",
                    )
                )
                continue
            normalized[canonical_name] = supplied_value

        if errors:
            raise ValidationError.from_exception_data(type(self).__name__, errors)
        super().__init__(
            **cast(dict[str, Any], controls),
            **cast(dict[str, Any], normalized),
        )

    @model_validator(mode="before")
    @classmethod
    def redact_secret_inputs(cls, value: object) -> object:
        if not isinstance(value, dict):
            return value
        sanitized = value.copy()
        for key in (
            "wechat_app_secret",
            "WECHAT_APP_SECRET",
            "wechat_pay_merchant_private_key_pem_base64",
            "WECHAT_PAY_MERCHANT_PRIVATE_KEY_PEM_BASE64",
            "wechat_pay_public_key_pem_base64",
            "WECHAT_PAY_PUBLIC_KEY_PEM_BASE64",
            "wechat_pay_api_v3_key",
            "WECHAT_PAY_API_V3_KEY",
            "phone_encryption_key_base64",
            "PHONE_ENCRYPTION_KEY_BASE64",
            "oss_access_key_secret",
            "OSS_ACCESS_KEY_SECRET",
            "dashscope_api_key",
            "DASHSCOPE_API_KEY",
            "platform_staff_principals_json",
            "PLATFORM_STAFF_PRINCIPALS_JSON",
            "platform_csrf_secret",
            "PLATFORM_CSRF_SECRET",
        ):
            secret = sanitized.get(key)
            if secret is None or isinstance(secret, SecretStr):
                continue
            sanitized[key] = SecretStr(secret if type(secret) is str else "")
        return sanitized

    @field_validator("wechat_app_secret")
    @classmethod
    def validate_wechat_app_secret(
        cls, value: SecretStr | None, info: ValidationInfo
    ) -> SecretStr | None:
        if value is None or not value.get_secret_value().strip():
            if cls._is_deployed(info):
                raise ValueError("WECHAT_APP_SECRET is required for staging and production")
            if value is not None:
                raise ValueError("WECHAT_APP_SECRET must not be empty")
        return value

    @field_validator("platform_staff_principals_json", mode="before")
    @classmethod
    def validate_platform_staff_principals(
        cls, value: object
    ) -> SecretStr | None:
        if value is None:
            return None
        raw = value.get_secret_value() if isinstance(value, SecretStr) else value
        if type(raw) is not str or not raw:
            raise cls._safe_value_error(
                "platform_staff_principals_json",
                "PLATFORM_STAFF_PRINCIPALS_JSON is invalid",
            )
        try:
            decoded = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            raise cls._safe_value_error(
                "platform_staff_principals_json",
                "PLATFORM_STAFF_PRINCIPALS_JSON is invalid",
            ) from None
        if not isinstance(decoded, list):
            raise cls._safe_value_error(
                "platform_staff_principals_json",
                "PLATFORM_STAFF_PRINCIPALS_JSON is invalid",
            )
        expected = {
            "principal_id",
            "display_name",
            "token_sha256",
            "enabled",
            "roles",
        }
        allowed_roles = {"PLATFORM_ADMIN", "ONBOARDING_REVIEWER"}
        principal_ids: set[str] = set()
        token_hashes: set[str] = set()
        for item in decoded:
            if not isinstance(item, dict) or set(item) != expected:
                raise cls._safe_value_error(
                    "platform_staff_principals_json",
                    "PLATFORM_STAFF_PRINCIPALS_JSON is invalid",
                )
            principal_id = item["principal_id"]
            display_name = item["display_name"]
            token_hash = item["token_sha256"]
            enabled = item["enabled"]
            roles = item["roles"]
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
                or any(type(role) is not str or role not in allowed_roles for role in roles)
                or len(set(roles)) != len(roles)
                or principal_id in principal_ids
                or token_hash in token_hashes
            ):
                raise cls._safe_value_error(
                    "platform_staff_principals_json",
                    "PLATFORM_STAFF_PRINCIPALS_JSON is invalid",
                )
            principal_ids.add(principal_id)
            token_hashes.add(token_hash)
        return SecretStr(raw)

    @field_validator("platform_csrf_secret", mode="before")
    @classmethod
    def validate_platform_csrf_secret(cls, value: object) -> SecretStr | None:
        if value is None:
            return None
        raw = value.get_secret_value() if isinstance(value, SecretStr) else value
        if type(raw) is not str:
            raise cls._safe_value_error(
                "platform_csrf_secret", "PLATFORM_CSRF_SECRET is invalid"
            )
        try:
            decoded = base64.b64decode(raw, validate=True)
        except (binascii.Error, UnicodeEncodeError, ValueError):
            raise cls._safe_value_error(
                "platform_csrf_secret", "PLATFORM_CSRF_SECRET is invalid"
            ) from None
        if len(decoded) != 32 or base64.b64encode(decoded).decode("ascii") != raw:
            raise cls._safe_value_error(
                "platform_csrf_secret",
                "PLATFORM_CSRF_SECRET must be canonical Base64 for exactly 32 bytes",
            )
        return SecretStr(raw)

    @field_validator("phone_encryption_key_base64")
    @classmethod
    def validate_phone_encryption_key(
        cls, value: SecretStr | None, info: ValidationInfo
    ) -> SecretStr | None:
        if value is None:
            if cls._is_deployed(info):
                raise ValueError(
                    "PHONE_ENCRYPTION_KEY_BASE64 is required for staging and production"
                )
            return None
        encoded_key = value.get_secret_value()
        try:
            key = base64.b64decode(encoded_key, validate=True)
        except (binascii.Error, UnicodeEncodeError, ValueError) as error:
            raise ValueError("PHONE_ENCRYPTION_KEY_BASE64 must be valid Base64") from error
        if len(key) != 32:
            raise ValueError("PHONE_ENCRYPTION_KEY_BASE64 must decode to exactly 32 bytes")
        if base64.b64encode(key).decode("ascii") != encoded_key:
            raise ValueError("PHONE_ENCRYPTION_KEY_BASE64 must be canonical Base64")
        return value

    @field_validator("phone_encryption_key_version", mode="before")
    @classmethod
    def validate_phone_encryption_key_version(
        cls, value: object, info: ValidationInfo
    ) -> int | None:
        if value is None and cls._is_deployed(info):
            raise ValueError("PHONE_ENCRYPTION_KEY_VERSION is required for staging and production")
        if value is None:
            return None
        return cls._parse_positive_integer(value, "PHONE_ENCRYPTION_KEY_VERSION")

    @field_validator("session_ttl_days", mode="before")
    @classmethod
    def validate_session_ttl_days(cls, value: object) -> int:
        return cls._parse_positive_integer(value, "SESSION_TTL_DAYS")

    @field_validator("database_url")
    @classmethod
    def require_deploy_database(cls, value: str, info: ValidationInfo) -> str:
        if not cls._is_deployed(info):
            return value

        normalized = value.strip()
        try:
            parsed = urlsplit(normalized)
            host = parsed.hostname
            port = parsed.port
        except ValueError:
            raise cls._safe_value_error("database_url", "DATABASE_URL is invalid") from None
        database = parsed.path.removeprefix("/")
        if (
            not normalized
            or value != normalized
            or any(character.isspace() for character in normalized)
            or not normalized.startswith("postgresql+psycopg://")
            or parsed.scheme != "postgresql+psycopg"
            or host is None
            or cls._normalize_host(host) is None
            or port is not None
            and not 0 < port <= 65535
            or not database
            or "/" in database
        ):
            raise cls._safe_value_error("database_url", "DATABASE_URL is invalid")
        return normalized

    @field_validator("public_api_base_url", mode="before")
    @classmethod
    def require_deploy_public_url(cls, value: object, info: ValidationInfo) -> AnyHttpUrl | None:
        if cls._is_deployed(info) and value is None:
            raise cls._safe_value_error(
                "public_api_base_url",
                "PUBLIC_API_BASE_URL is required for staging and production",
            )
        if value is None:
            return None
        try:
            validated = _PUBLIC_API_URL_ADAPTER.validate_python(value)
        except (TypeError, ValueError, ValidationError):
            raise cls._safe_value_error(
                "public_api_base_url", "PUBLIC_API_BASE_URL is invalid"
            ) from None
        if validated.username is not None or validated.password is not None:
            raise cls._safe_value_error(
                "public_api_base_url", "PUBLIC_API_BASE_URL must not contain credentials"
            )
        return validated

    @field_validator("public_image_hosts")
    @classmethod
    def require_deploy_image_hosts(
        cls, value: tuple[str, ...], info: ValidationInfo
    ) -> tuple[str, ...]:
        if not value:
            if cls._is_deployed(info):
                raise ValueError("PUBLIC_IMAGE_HOSTS is required for staging and production")
            return value

        normalized_hosts: list[str] = []
        for host in value:
            normalized = cls._normalize_host(host)
            if normalized is None:
                raise cls._safe_value_error(
                    "public_image_hosts", "PUBLIC_IMAGE_HOSTS contains an invalid host"
                )
            normalized_hosts.append(normalized)
        return tuple(normalized_hosts)

    @field_validator("oss_endpoint", "oss_public_base_url", mode="before")
    @classmethod
    def validate_oss_urls(cls, value: object, info: ValidationInfo) -> AnyHttpUrl | None:
        field_name = info.field_name
        assert field_name is not None
        environment_name = field_name.upper()
        if value is None:
            if cls._is_deployed(info):
                raise cls._safe_value_error(
                    field_name,
                    "OSS storage configuration is required for staging and production",
                )
            return None
        try:
            validated = _PUBLIC_API_URL_ADAPTER.validate_python(value)
        except (TypeError, ValueError, ValidationError):
            raise cls._safe_value_error(field_name, f"{environment_name} is invalid") from None
        if validated.username is not None or validated.password is not None:
            raise cls._safe_value_error(
                field_name, f"{environment_name} must not contain credentials"
            )
        if validated.scheme != "https":
            raise cls._safe_value_error(field_name, f"{environment_name} must use HTTPS")
        if validated.query is not None or validated.fragment is not None:
            raise cls._safe_value_error(
                field_name, f"{environment_name} must not contain query or fragment"
            )
        if field_name == "oss_endpoint" and validated.path not in {None, "/"}:
            raise cls._safe_value_error(field_name, "OSS_ENDPOINT must be origin only")
        return validated

    @field_validator(
        "oss_bucket",
        "onboarding_oss_bucket",
        "oss_access_key_id",
        mode="before",
    )
    @classmethod
    def validate_oss_names(cls, value: object, info: ValidationInfo) -> str | None:
        field_name = info.field_name
        assert field_name is not None
        if value is None or type(value) is str and not value.strip():
            if cls._is_deployed(info) and field_name != "onboarding_oss_bucket":
                raise cls._safe_value_error(
                    field_name,
                    "OSS storage configuration is required for staging and production",
                )
            if value is not None:
                raise cls._safe_value_error(field_name, f"{field_name.upper()} must not be empty")
            return None
        if type(value) is not str or value != value.strip():
            raise cls._safe_value_error(field_name, f"{field_name.upper()} is invalid")
        if field_name in {"oss_bucket", "onboarding_oss_bucket"} and _OSS_BUCKET.fullmatch(
            value
        ) is None:
            raise cls._safe_value_error(field_name, f"{field_name.upper()} is invalid")
        return value

    @field_validator("oss_access_key_secret")
    @classmethod
    def validate_oss_access_key_secret(
        cls, value: SecretStr | None, info: ValidationInfo
    ) -> SecretStr | None:
        if value is None or not value.get_secret_value().strip():
            if cls._is_deployed(info):
                raise cls._safe_value_error(
                    "oss_access_key_secret",
                    "OSS storage configuration is required for staging and production",
                )
            if value is not None:
                raise cls._safe_value_error(
                    "oss_access_key_secret", "OSS_ACCESS_KEY_SECRET must not be empty"
                )
        return value

    @field_validator("dashscope_api_key")
    @classmethod
    def validate_dashscope_api_key(
        cls, value: SecretStr | None, info: ValidationInfo
    ) -> SecretStr | None:
        if value is None or not value.get_secret_value().strip():
            if cls._is_deployed(info):
                raise cls._safe_value_error(
                    "dashscope_api_key",
                    "DASHSCOPE_API_KEY is required for staging and production",
                )
            if value is not None:
                raise cls._safe_value_error(
                    "dashscope_api_key", "DASHSCOPE_API_KEY must not be empty"
                )
        return value

    @field_validator("dashscope_base_url", mode="before")
    @classmethod
    def validate_dashscope_base_url(cls, value: object) -> AnyHttpUrl:
        try:
            validated = _PUBLIC_API_URL_ADAPTER.validate_python(value)
        except (TypeError, ValueError, ValidationError):
            raise cls._safe_value_error(
                "dashscope_base_url", "DASHSCOPE_BASE_URL is invalid"
            ) from None
        if validated.scheme != "https":
            raise cls._safe_value_error(
                "dashscope_base_url", "DASHSCOPE_BASE_URL must use HTTPS"
            )
        if validated.username is not None or validated.password is not None:
            raise cls._safe_value_error(
                "dashscope_base_url", "DASHSCOPE_BASE_URL must not contain credentials"
            )
        if validated.query is not None or validated.fragment is not None:
            raise cls._safe_value_error(
                "dashscope_base_url", "DASHSCOPE_BASE_URL must not contain query or fragment"
            )
        return validated

    @field_validator("dashscope_moderation_model")
    @classmethod
    def validate_dashscope_model(cls, value: str) -> str:
        if not value.strip() or value != value.strip():
            raise cls._safe_value_error(
                "dashscope_moderation_model", "DASHSCOPE_MODERATION_MODEL is invalid"
            )
        return value

    @field_validator("moderation_reviewer_user_ids", mode="before")
    @classmethod
    def parse_moderation_reviewer_user_ids(cls, value: object) -> object:
        if value is None or value == "":
            return ()
        if isinstance(value, str):
            parts = tuple(item.strip() for item in value.split(","))
            if any(not item for item in parts):
                raise cls._safe_value_error(
                    "moderation_reviewer_user_ids",
                    "MODERATION_REVIEWER_USER_IDS is invalid",
                )
            return parts
        return value

    @field_validator("wechat_provider")
    @classmethod
    def require_real_deploy_provider(
        cls, value: Literal["development", "real"], info: ValidationInfo
    ) -> Literal["development", "real"]:
        if cls._is_deployed(info) and value != "real":
            raise ValueError("WECHAT_PROVIDER must be real for staging and production")
        return value

    @field_validator("wechat_app_id")
    @classmethod
    def require_deploy_app_id(cls, value: str | None, info: ValidationInfo) -> str | None:
        if cls._is_deployed(info) and (value is None or not value.strip()):
            raise ValueError("WECHAT_APP_ID is required for staging and production")
        return value

    @field_validator("wechat_pay_merchant_id")
    @classmethod
    def validate_wechat_pay_merchant_id(cls, value: str | None) -> str | None:
        if value is not None and (not value.isascii() or not value.isdigit()):
            raise cls._safe_value_error(
                "wechat_pay_merchant_id", "WECHAT_PAY_MERCHANT_ID is invalid"
            )
        return value

    @field_validator("wechat_pay_merchant_cert_serial")
    @classmethod
    def validate_wechat_pay_cert_serial(cls, value: str | None) -> str | None:
        if value is not None and re.fullmatch(r"[0-9A-F]+", value, re.ASCII) is None:
            raise cls._safe_value_error(
                "wechat_pay_merchant_cert_serial",
                "WECHAT_PAY_MERCHANT_CERT_SERIAL is invalid",
            )
        return value

    @field_validator("wechat_pay_public_key_id")
    @classmethod
    def validate_wechat_pay_public_key_id(cls, value: str | None) -> str | None:
        if value is not None and re.fullmatch(r"PUB_KEY_ID_[0-9]+", value, re.ASCII) is None:
            raise cls._safe_value_error(
                "wechat_pay_public_key_id", "WECHAT_PAY_PUBLIC_KEY_ID is invalid"
            )
        return value

    @field_validator(
        "wechat_pay_merchant_private_key_pem_base64",
        "wechat_pay_public_key_pem_base64",
        mode="before",
    )
    @classmethod
    def validate_wechat_pay_pem_base64(
        cls, value: object, info: ValidationInfo
    ) -> SecretStr | None:
        if value is None:
            return None
        raw = value.get_secret_value() if isinstance(value, SecretStr) else value
        field_name = info.field_name or "wechat_pay_pem"
        label = "private key" if "private" in field_name else "public key"
        if type(raw) is not str:
            raise cls._safe_value_error(field_name, f"WeChat Pay {label} Base64 is invalid")
        try:
            decoded = base64.b64decode(raw, validate=True)
        except (binascii.Error, UnicodeEncodeError, ValueError):
            raise cls._safe_value_error(
                field_name, f"WeChat Pay {label} Base64 is invalid"
            ) from None
        expected_marker = b"PRIVATE KEY" if "private" in field_name else b"PUBLIC KEY"
        if expected_marker not in decoded:
            raise cls._safe_value_error(field_name, f"WeChat Pay {label} PEM is invalid")
        return SecretStr(raw)

    @field_validator("wechat_pay_api_v3_key", mode="before")
    @classmethod
    def validate_wechat_pay_api_v3_key(cls, value: object) -> SecretStr | None:
        if value is None:
            return None
        raw = value.get_secret_value() if isinstance(value, SecretStr) else value
        if type(raw) is not str:
            raise cls._safe_value_error("wechat_pay_api_v3_key", "WeChat Pay API v3 key is invalid")
        try:
            encoded = raw.encode("ascii")
        except UnicodeEncodeError:
            encoded = b""
        if len(encoded) != 32:
            raise cls._safe_value_error(
                "wechat_pay_api_v3_key",
                "WeChat Pay API v3 key must be exactly 32 bytes",
            )
        return SecretStr(raw)

    @field_validator(
        "wechat_pay_payment_notification_url",
        "wechat_pay_refund_notification_url",
        mode="before",
    )
    @classmethod
    def validate_wechat_pay_notification_url(
        cls, value: object, info: ValidationInfo
    ) -> AnyHttpUrl | None:
        if value is None:
            return None
        field_name = info.field_name or "wechat_pay_notification_url"
        try:
            validated = _PUBLIC_API_URL_ADAPTER.validate_python(value)
        except (TypeError, ValueError, ValidationError):
            raise cls._safe_value_error(
                field_name, "WeChat Pay notification URL is invalid"
            ) from None
        if (
            validated.scheme != "https"
            or validated.host is None
            or validated.username is not None
            or validated.password is not None
            or validated.query is not None
            or validated.fragment is not None
        ):
            raise cls._safe_value_error(
                field_name,
                "WeChat Pay notification URL must be absolute HTTPS without query or fragment",
            )
        return validated

    @model_validator(mode="after")
    def validate_mock_payment_provider(self) -> "Settings":
        mock_selected = self.payment_provider == "mock"
        if mock_selected and not self.enable_mock_payment_provider:
            raise ValueError(
                "ENABLE_MOCK_PAYMENT_PROVIDER must be true to select Mock payment provider"
            )
        if self.enable_mock_payment_provider and (
            self.app_env != "development" or not mock_selected
        ):
            raise ValueError(
                "Mock payment provider is allowed only when APP_ENV=development, "
                "PAYMENT_PROVIDER=mock, and ENABLE_MOCK_PAYMENT_PROVIDER=true"
            )
        return self

    @model_validator(mode="after")
    def validate_deployed_wechat_payment_provider(self) -> "Settings":
        if (
            self.app_env in {"staging", "production"}
            and self.payment_provider == "wechat"
            and not self.wechat_payment_configured
        ):
            raise ValueError("WeChat payment credentials are incomplete")
        return self

    @model_validator(mode="after")
    def validate_private_onboarding_bucket(self) -> "Settings":
        if (
            self.oss_bucket is not None
            and self.onboarding_oss_bucket is not None
            and self.oss_bucket == self.onboarding_oss_bucket
        ):
            raise ValueError("ONBOARDING_OSS_BUCKET must be separate from OSS_BUCKET")
        return self

    @property
    def mock_payment_provider_enabled(self) -> bool:
        return (
            self.app_env == "development"
            and self.payment_provider == "mock"
            and self.enable_mock_payment_provider
        )

    @property
    def wechat_payment_configured(self) -> bool:
        return all(
            value is not None
            for value in (
                self.wechat_app_id,
                self.wechat_pay_merchant_id,
                self.wechat_pay_merchant_cert_serial,
                self.wechat_pay_merchant_private_key_pem_base64,
                self.wechat_pay_public_key_id,
                self.wechat_pay_public_key_pem_base64,
                self.wechat_pay_api_v3_key,
                self.wechat_pay_payment_notification_url,
                self.wechat_pay_refund_notification_url,
            )
        )

    @staticmethod
    def _is_deployed(info: ValidationInfo) -> bool:
        return info.data.get("app_env") in {"staging", "production"}

    @staticmethod
    def _normalize_host(value: str) -> str | None:
        normalized = value.strip().lower()
        if not normalized or len(normalized) > 253:
            return None
        labels = normalized.split(".")
        if any(_HOST_LABEL.fullmatch(label) is None for label in labels):
            return None
        return normalized

    @staticmethod
    def _parse_positive_integer(value: object, field_name: str) -> int:
        if type(value) is int:
            parsed = value
        elif type(value) is str and _CANONICAL_POSITIVE_INTEGER.fullmatch(value) is not None:
            parsed = int(value)
        else:
            raise Settings._safe_value_error(
                field_name.lower(), f"{field_name} must be a positive canonical integer"
            )
        if parsed <= 0:
            raise Settings._safe_value_error(field_name.lower(), f"{field_name} must be positive")
        return parsed

    @staticmethod
    def _safe_value_error(field_name: str, message: str) -> ValidationError:
        return ValidationError.from_exception_data(
            "Settings",
            [Settings._input_error(field_name, message)],
        )

    @staticmethod
    def _input_error(field_name: str, message: str) -> InitErrorDetails:
        return InitErrorDetails(
            type="value_error",
            loc=(field_name,),
            input="<redacted>",
            ctx={"error": ValueError(message)},
        )
