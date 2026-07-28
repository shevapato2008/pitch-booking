import base64
import logging
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from pydantic import SecretStr, ValidationError
from sqlalchemy.engine import make_url

from backend.app.config import Settings
from backend.app.security.phone_vault import (
    PhoneDecryptionError,
    PhoneVault,
    PhoneVaultConfigurationError,
    PhoneVaultError,
    SealedPhone,
)

KEY = bytes(range(32))
OTHER_KEY = bytes(range(1, 33))
KEY_BASE64 = base64.b64encode(KEY).decode("ascii")
OTHER_KEY_BASE64 = base64.b64encode(OTHER_KEY).decode("ascii")
NONCANONICAL_PAD_BITS_KEY = f"{KEY_BASE64[:-2]}9="
URLSAFE_KEY = base64.urlsafe_b64encode(b"\xfb" * 32).decode("ascii")
PHONE = "13800138000"
RECORD_ID = UUID("8e6ac16a-e098-4b53-b13a-13f64010a349")
OTHER_RECORD_ID = UUID("b46b3bc1-8950-4578-b2ec-f78091623663")


def vault(*, key: str = KEY_BASE64, key_version: int = 1) -> PhoneVault:
    return PhoneVault(key_base64=key, key_version=key_version)


def deployed_settings(**overrides: object) -> dict[str, object]:
    values: dict[str, object] = {
        "app_env": "staging",
        "database_url": "postgresql+psycopg://pitch:password@postgres:5432/pitch",
        "public_api_base_url": "https://api.example.com",
        "public_image_hosts": ("cdn.example.com",),
        "wechat_provider": "real",
        "wechat_app_id": "wx-app-id",
        "wechat_app_secret": "wechat-secret",
        "phone_encryption_key_base64": KEY_BASE64,
        "phone_encryption_key_version": 1,
    }
    values.update(overrides)
    return values


def test_phone_vault_round_trip() -> None:
    sealed = vault().encrypt(
        PHONE,
        record_type="user",
        record_id=RECORD_ID,
        field="phone",
    )

    plaintext = vault().decrypt(
        sealed,
        record_type="user",
        record_id=RECORD_ID,
        field="phone",
    )

    assert plaintext == PHONE
    assert sealed.key_version == 1
    assert len(sealed.nonce) == 12
    assert sealed.ciphertext_with_tag != PHONE.encode()


def test_phone_vault_uses_a_random_nonce_for_each_encryption() -> None:
    phone_vault = vault()

    first = phone_vault.encrypt(
        PHONE,
        record_type="user",
        record_id=RECORD_ID,
        field="phone",
    )
    second = phone_vault.encrypt(
        PHONE,
        record_type="user",
        record_id=RECORD_ID,
        field="phone",
    )

    assert first.nonce != second.nonce
    assert first.ciphertext_with_tag != second.ciphertext_with_tag


def test_phone_vault_rejects_wrong_aad_without_logging_secrets(
    caplog: pytest.LogCaptureFixture,
) -> None:
    phone_vault = vault()
    sealed = phone_vault.encrypt(
        PHONE,
        record_type="user",
        record_id=RECORD_ID,
        field="phone",
    )

    with caplog.at_level(logging.DEBUG), pytest.raises(PhoneDecryptionError):
        phone_vault.decrypt(
            sealed,
            record_type="order",
            record_id=RECORD_ID,
            field="phone",
        )

    rendered_logs = caplog.text
    assert PHONE not in rendered_logs
    assert sealed.ciphertext_with_tag.hex() not in rendered_logs
    assert sealed.nonce.hex() not in rendered_logs
    assert KEY_BASE64 not in rendered_logs
    assert f"user:{RECORD_ID}:phone" not in rendered_logs


def test_phone_vault_rejects_wrong_key() -> None:
    sealed = vault().encrypt(
        PHONE,
        record_type="user",
        record_id=RECORD_ID,
        field="phone",
    )

    with pytest.raises(PhoneDecryptionError):
        vault(key=OTHER_KEY_BASE64).decrypt(
            sealed,
            record_type="user",
            record_id=RECORD_ID,
            field="phone",
        )


def test_phone_vault_masks_phone_number() -> None:
    assert PhoneVault.mask(PHONE) == "138****8000"


@pytest.mark.parametrize("invalid_key", ["not base64!", "AA===", ""])
def test_phone_vault_rejects_invalid_base64(invalid_key: str) -> None:
    with pytest.raises(PhoneVaultConfigurationError, match="encryption key"):
        PhoneVault(key_base64=invalid_key, key_version=1)


def test_phone_vault_rejects_key_that_is_not_32_bytes() -> None:
    short_key = base64.b64encode(b"x" * 31).decode("ascii")

    with pytest.raises(PhoneVaultConfigurationError, match="32 bytes"):
        PhoneVault(key_base64=short_key, key_version=1)


@pytest.mark.parametrize("key_version", [None, 0, -1])
def test_phone_vault_rejects_missing_or_non_positive_key_version(
    key_version: int | None,
) -> None:
    with pytest.raises(PhoneVaultConfigurationError, match="key version"):
        PhoneVault(key_base64=KEY_BASE64, key_version=key_version)


def test_settings_session_ttl_defaults_to_30_days() -> None:
    assert Settings().session_ttl_days == 30


def test_development_settings_allow_explicit_deterministic_phone_key() -> None:
    settings = Settings(
        app_env="test",
        phone_encryption_key_base64=SecretStr(KEY_BASE64),
        phone_encryption_key_version=7,
    )

    assert settings.phone_encryption_key_base64 is not None
    assert settings.phone_encryption_key_base64.get_secret_value() == KEY_BASE64
    assert settings.phone_encryption_key_version == 7


@pytest.mark.parametrize("app_env", ["staging", "production"])
@pytest.mark.parametrize(
    ("overrides", "expected_message"),
    [
        ({"wechat_provider": "development"}, "WECHAT_PROVIDER must be real"),
        ({"wechat_app_id": None}, "WECHAT_APP_ID is required"),
        ({"wechat_app_secret": None}, "WECHAT_APP_SECRET is required"),
        ({"phone_encryption_key_base64": None}, "PHONE_ENCRYPTION_KEY_BASE64 is required"),
        ({"phone_encryption_key_base64": "not base64!"}, "valid Base64"),
        (
            {"phone_encryption_key_base64": base64.b64encode(b"x" * 31).decode("ascii")},
            "32 bytes",
        ),
        ({"phone_encryption_key_version": None}, "PHONE_ENCRYPTION_KEY_VERSION is required"),
        ({"phone_encryption_key_version": 0}, "PHONE_ENCRYPTION_KEY_VERSION must be positive"),
    ],
)
def test_deployed_settings_fail_closed_for_missing_or_unsafe_secrets(
    app_env: str,
    overrides: dict[str, object],
    expected_message: str,
) -> None:
    values = deployed_settings(app_env=app_env, **overrides)

    with pytest.raises(ValidationError, match=expected_message):
        Settings(**values)


def test_deployed_settings_accept_complete_real_configuration() -> None:
    settings = Settings(**deployed_settings())

    assert settings.wechat_provider == "real"
    assert settings.session_ttl_days == 30


def test_phone_vault_accepts_uuid_objects_for_aad_identity() -> None:
    record_id = uuid4()
    phone_vault = vault()

    sealed = phone_vault.encrypt(
        PHONE,
        record_type="user",
        record_id=record_id,
        field="phone",
    )

    assert (
        phone_vault.decrypt(
            sealed,
            record_type="user",
            record_id=record_id,
            field="phone",
        )
        == PHONE
    )


@pytest.mark.parametrize(
    ("record_type", "record_id", "field"),
    [
        (f"user:{RECORD_ID}", OTHER_RECORD_ID, "phone"),
        ("user", RECORD_ID, f"{OTHER_RECORD_ID}:phone"),
        (f"order:{OTHER_RECORD_ID}", RECORD_ID, "contact_phone"),
        ("order", OTHER_RECORD_ID, f"{RECORD_ID}:contact_phone"),
    ],
)
def test_phone_vault_rejects_delimiter_injection_that_can_collide_aad(
    record_type: str,
    record_id: UUID,
    field: str,
) -> None:
    with pytest.raises(PhoneVaultError):
        vault().encrypt(
            PHONE,
            record_type=record_type,
            record_id=record_id,
            field=field,
        )


@pytest.mark.parametrize("token", ["", "user name", "phone/primary", "手机号"])
def test_phone_vault_rejects_non_ascii_or_ambiguous_aad_tokens(token: str) -> None:
    with pytest.raises(PhoneVaultError):
        vault().encrypt(
            PHONE,
            record_type=token,
            record_id=RECORD_ID,
            field="phone",
        )


@pytest.mark.parametrize("record_id", [str(RECORD_ID), object()])
def test_phone_vault_requires_a_real_uuid_for_aad(record_id: object) -> None:
    with pytest.raises(PhoneVaultError):
        vault().encrypt(
            PHONE,
            record_type="user",
            record_id=record_id,  # type: ignore[arg-type]
            field="phone",
        )


def test_settings_repr_and_str_redact_secret_values() -> None:
    values = deployed_settings()
    secret = str(values["wechat_app_secret"])
    key = str(values["phone_encryption_key_base64"])

    settings = Settings(**values)

    assert isinstance(settings.wechat_app_secret, SecretStr)
    assert isinstance(settings.phone_encryption_key_base64, SecretStr)
    assert secret not in repr(settings)
    assert secret not in str(settings)
    assert key not in repr(settings)
    assert key not in str(settings)


@pytest.mark.parametrize(
    "overrides",
    [
        {"phone_encryption_key_base64": "SECRET_INVALID_BASE64!"},
        {"wechat_provider": "development"},
    ],
)
def test_settings_validation_errors_and_logs_never_expose_secrets(
    overrides: dict[str, object],
    caplog: pytest.LogCaptureFixture,
) -> None:
    values = deployed_settings(**overrides)
    secret = str(values["wechat_app_secret"])
    key = str(values["phone_encryption_key_base64"])

    with caplog.at_level(logging.DEBUG), pytest.raises(ValidationError) as captured:
        Settings(**values)

    rendered = "\n".join(
        (str(captured.value), repr(captured.value), captured.value.json(), caplog.text)
    )
    assert secret not in rendered
    assert key not in rendered


def test_sealed_phone_repr_redacts_ciphertext_and_nonce() -> None:
    sealed = vault().encrypt(
        PHONE,
        record_type="user",
        record_id=RECORD_ID,
        field="phone",
    )

    rendered = repr(sealed)
    assert sealed.ciphertext_with_tag.hex() not in rendered
    assert repr(sealed.ciphertext_with_tag) not in rendered
    assert sealed.nonce.hex() not in rendered
    assert repr(sealed.nonce) not in rendered


def test_direct_uppercase_settings_kwargs_are_rejected_without_secret_leakage() -> None:
    values = deployed_settings()
    values.pop("app_env")
    values["APP_ENV"] = "production"
    values["WECHAT_APP_SECRET"] = "UPPERCASE_SECRET_SENTINEL"
    values["PHONE_ENCRYPTION_KEY_BASE64"] = KEY_BASE64

    with pytest.raises(ValidationError) as captured:
        Settings(**values)

    rendered = f"{captured.value!s}\n{captured.value!r}\n{captured.value.json()}"
    assert "UPPERCASE_SECRET_SENTINEL" not in rendered
    assert KEY_BASE64 not in rendered


def production_environment(*, provider: str = "development") -> dict[str, str]:
    return {
        "APP_ENV": "production",
        "DATABASE_URL": "postgresql+psycopg://pitch:password@postgres:5432/pitch",
        "PUBLIC_API_BASE_URL": "https://api.example.com",
        "PUBLIC_IMAGE_HOSTS": '["cdn.example.com"]',
        "WECHAT_PROVIDER": provider,
        "WECHAT_APP_ID": "wx-app-id",
        "WECHAT_APP_SECRET": "environment-secret",
        "PHONE_ENCRYPTION_KEY_BASE64": KEY_BASE64,
        "PHONE_ENCRYPTION_KEY_VERSION": "1",
    }


def test_process_environment_cannot_bypass_production_constraints(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for key, value in production_environment().items():
        monkeypatch.setenv(key, value)

    with pytest.raises(ValidationError, match="WECHAT_PROVIDER must be real"):
        Settings()


def test_env_file_cannot_bypass_production_constraints(tmp_path: Path) -> None:
    env_file = tmp_path / "production.env"
    env_file.write_text(
        "".join(f"{key}={value}\n" for key, value in production_environment().items()),
        encoding="utf-8",
    )

    with pytest.raises(ValidationError, match="WECHAT_PROVIDER must be real"):
        Settings(_env_file=env_file)


def test_env_file_encoding_control_is_forwarded(tmp_path: Path) -> None:
    env_file = tmp_path / "utf16.env"
    env_file.write_text("SESSION_TTL_DAYS=31\n", encoding="utf-16")

    settings = Settings(_env_file=env_file, _env_file_encoding="utf-16")

    assert settings.session_ttl_days == 31


def test_case_prefix_and_ignore_empty_controls_are_forwarded_without_bypass(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    environment = production_environment(provider="development")
    for key, value in environment.items():
        monkeypatch.setenv(f"PITCH_{key.lower()}", value)
    monkeypatch.setenv("PITCH_SESSION_TTL_DAYS", "")

    with pytest.raises(ValidationError, match="WECHAT_PROVIDER must be real"):
        Settings(
            _case_sensitive=False,
            _env_prefix="PITCH_",
            _env_ignore_empty=True,
        )


@pytest.mark.parametrize(
    "invalid_phone",
    [
        "12",
        "12900138000",
        "1380013800a",
        "１３８００１３８０００",
        "١٣٨٠٠١٣٨٠٠٠",
        "13800138000\n",
        "PHONE_SECRET_SENTINEL",
    ],
)
def test_phone_mask_rejects_noncanonical_values_without_exposure(
    invalid_phone: str,
    caplog: pytest.LogCaptureFixture,
) -> None:
    with caplog.at_level(logging.DEBUG), pytest.raises(PhoneVaultError) as captured:
        PhoneVault.mask(invalid_phone)

    rendered = f"{captured.value!s}\n{captured.value!r}\n{caplog.text}"
    assert invalid_phone not in rendered


def test_phone_mask_rejects_non_string_values_with_domain_error() -> None:
    with pytest.raises(PhoneVaultError, match="phone number is invalid"):
        PhoneVault.mask(object())  # type: ignore[arg-type]


def test_sealed_phone_copies_mutable_byte_buffers() -> None:
    ciphertext = bytearray(b"c" * 16)
    nonce = bytearray(b"n" * 12)

    sealed = SealedPhone(
        ciphertext_with_tag=ciphertext,  # type: ignore[arg-type]
        nonce=nonce,  # type: ignore[arg-type]
        key_version=1,
    )
    ciphertext[0] = ord("x")
    nonce[0] = ord("x")

    assert sealed.ciphertext_with_tag == b"c" * 16
    assert sealed.nonce == b"n" * 12
    assert type(sealed.ciphertext_with_tag) is bytes
    assert type(sealed.nonce) is bytes


@pytest.mark.parametrize(
    ("ciphertext", "nonce", "key_version"),
    [
        (b"c" * 15, b"n" * 12, 1),
        (b"c" * 16, b"n", 1),
        (b"c" * 16, b"n" * 12, 0),
        (b"c" * 16, b"n" * 12, True),
        (b"c" * 16, b"n" * 12, 1.5),
        (b"c" * 16, b"n" * 12, "1"),
    ],
)
def test_sealed_phone_rejects_invalid_storage_values(
    ciphertext: bytes,
    nonce: bytes,
    key_version: object,
) -> None:
    with pytest.raises(PhoneVaultError):
        SealedPhone(
            ciphertext_with_tag=ciphertext,
            nonce=nonce,
            key_version=key_version,  # type: ignore[arg-type]
        )


@pytest.mark.parametrize(
    ("attribute", "corrupt_value"),
    [
        ("nonce", b"n"),
        ("ciphertext_with_tag", b"secret"),
        ("key_version", 2),
        ("key_version", 1.5),
        ("key_version", "1"),
    ],
)
def test_decrypt_maps_corrupt_storage_to_safe_domain_error(
    attribute: str,
    corrupt_value: object,
    caplog: pytest.LogCaptureFixture,
) -> None:
    phone_vault = vault()
    sealed = phone_vault.encrypt(
        PHONE,
        record_type="user",
        record_id=RECORD_ID,
        field="phone",
    )
    object.__setattr__(sealed, attribute, corrupt_value)

    with caplog.at_level(logging.DEBUG), pytest.raises(PhoneDecryptionError) as captured:
        phone_vault.decrypt(
            sealed,
            record_type="user",
            record_id=RECORD_ID,
            field="phone",
        )

    rendered = f"{captured.value!s}\n{captured.value!r}\n{caplog.text}"
    assert "secret" not in rendered
    assert repr(corrupt_value) not in rendered


def test_decrypt_rejects_non_sealed_objects_with_domain_error() -> None:
    with pytest.raises(PhoneDecryptionError, match="could not be decrypted"):
        vault().decrypt(
            object(),  # type: ignore[arg-type]
            record_type="user",
            record_id=RECORD_ID,
            field="phone",
        )


@pytest.mark.parametrize("key_version", [True, 1.0, "1", object()])
def test_phone_vault_requires_strict_integer_key_version(key_version: object) -> None:
    with pytest.raises(PhoneVaultConfigurationError, match="key version"):
        PhoneVault(key_base64=KEY_BASE64, key_version=key_version)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    "noncanonical_key",
    [
        NONCANONICAL_PAD_BITS_KEY,
        URLSAFE_KEY,
        f"{KEY_BASE64}=",
        f" {KEY_BASE64}",
        f"{KEY_BASE64}\n",
    ],
)
def test_phone_vault_rejects_noncanonical_base64_without_exposing_key(
    noncanonical_key: str,
) -> None:
    with pytest.raises(PhoneVaultConfigurationError) as captured:
        PhoneVault(key_base64=noncanonical_key, key_version=1)

    assert noncanonical_key not in str(captured.value)
    assert noncanonical_key not in repr(captured.value)


@pytest.mark.parametrize(
    "noncanonical_key",
    [NONCANONICAL_PAD_BITS_KEY, URLSAFE_KEY, f"{KEY_BASE64}=", f"{KEY_BASE64}\n"],
)
def test_settings_reject_noncanonical_base64_without_exposing_key(
    noncanonical_key: str,
) -> None:
    values = deployed_settings(phone_encryption_key_base64=noncanonical_key)

    with pytest.raises(ValidationError) as captured:
        Settings(**values)

    rendered = f"{captured.value!s}\n{captured.value!r}\n{captured.value.json()}"
    assert noncanonical_key not in rendered


def render_validation_error(error: ValidationError, logs: str = "") -> str:
    return "\n".join((str(error), repr(error), error.json(), repr(error.errors()), logs))


@pytest.mark.parametrize(
    ("unknown_key", "secret_value"),
    [
        ("WeChat_App_Secrett", "MIXED_CASE_SECRET_SENTINEL"),
        ("phone_encryption_keY", "TYPO_KEY_SENTINEL"),
        ("Database_Password", "PASSWORD_SENTINEL"),
        ("Api_TokeN", "TOKEN_SENTINEL"),
        ("Client_CredentialS", "CREDENTIAL_SENTINEL"),
    ],
)
def test_unknown_constructor_values_are_rejected_without_value_exposure(
    unknown_key: str,
    secret_value: str,
    caplog: pytest.LogCaptureFixture,
) -> None:
    with caplog.at_level(logging.DEBUG), pytest.raises(ValidationError) as captured:
        Settings(**{unknown_key: secret_value})

    assert secret_value not in render_validation_error(captured.value, caplog.text)


def test_database_url_is_absent_from_settings_repr_and_str() -> None:
    database_url = "postgresql+psycopg://pitch:DB_PASSWORD_SENTINEL@postgres:5432/pitch"
    settings = Settings(**deployed_settings(database_url=database_url))

    assert database_url not in repr(settings)
    assert database_url not in str(settings)
    assert "DB_PASSWORD_SENTINEL" not in repr(settings)
    assert "DB_PASSWORD_SENTINEL" not in str(settings)


def test_invalid_database_url_error_surfaces_never_expose_url_or_password(
    caplog: pytest.LogCaptureFixture,
) -> None:
    database_url = "mysql://pitch:INVALID_DB_PASSWORD_SENTINEL@database/pitch"

    with caplog.at_level(logging.DEBUG), pytest.raises(ValidationError) as captured:
        Settings(**deployed_settings(database_url=database_url))

    rendered = render_validation_error(captured.value, caplog.text)
    assert database_url not in rendered
    assert "INVALID_DB_PASSWORD_SENTINEL" not in rendered


def test_actual_deploy_env_shape_ignores_non_application_fields_without_leaks() -> None:
    env_file = Path("deploy/.env.example")
    postgres_password = "change-before-deploy"

    with pytest.raises(ValidationError) as captured:
        Settings(_env_file=env_file)

    rendered = render_validation_error(captured.value)
    assert postgres_password not in rendered
    assert not any(
        error["type"] == "extra_forbidden" and str(error["loc"][0]).startswith("POSTGRES_")
        for error in captured.value.errors()
    )


def test_uppercase_app_env_constructor_path_enforces_production_constraints() -> None:
    values = deployed_settings(wechat_provider="development")
    values.pop("app_env")
    values["APP_ENV"] = "production"

    with pytest.raises(ValidationError, match="WECHAT_PROVIDER must be real"):
        Settings(**values)


def test_process_env_invalid_database_never_leaks_url_or_password(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database_url = "mysql://pitch:PROCESS_DB_PASSWORD_SENTINEL@database/pitch"
    for key, value in production_environment(provider="real").items():
        monkeypatch.setenv(key, value)
    monkeypatch.setenv("DATABASE_URL", database_url)

    with pytest.raises(ValidationError) as captured:
        Settings()

    rendered = render_validation_error(captured.value)
    assert database_url not in rendered
    assert "PROCESS_DB_PASSWORD_SENTINEL" not in rendered


@pytest.mark.parametrize(
    "database_url",
    [
        "",
        "   ",
        "sqlite+pysqlite:///:memory:",
        "sqlite:///pitch.db",
        "mysql://database/pitch",
        "postgresql:///pitch",
        "postgresql://database",
        "postgresql://pitch:DB_PASSWORD_SENTINEL@postgres:5432/pitch",
        "postgresql+psycopg2://pitch:DB_PASSWORD_SENTINEL@postgres:5432/pitch",
        "postgresql+asyncpg://pitch:DB_PASSWORD_SENTINEL@postgres:5432/pitch",
        "PostgreSQL+psycopg://pitch:DB_PASSWORD_SENTINEL@postgres:5432/pitch",
        "POSTGRESQL+PSYCOPG://pitch:DB_PASSWORD_SENTINEL@postgres:5432/pitch",
        " postgresql+psycopg://pitch:DB_PASSWORD_SENTINEL@postgres:5432/pitch",
        "postgresql://data base/pitch",
    ],
)
def test_deployed_settings_reject_invalid_or_non_postgresql_database_urls(
    database_url: str,
) -> None:
    with pytest.raises(ValidationError, match="DATABASE_URL") as captured:
        Settings(**deployed_settings(database_url=database_url))

    rendered = render_validation_error(captured.value)
    if database_url.strip():
        assert database_url not in rendered
    assert "DB_PASSWORD_SENTINEL" not in rendered


def test_deployed_database_url_loads_the_installed_psycopg_dialect() -> None:
    database_url = "postgresql+psycopg://pitch:password@postgres:5432/pitch"
    settings = Settings(**deployed_settings(database_url=database_url))
    parsed = make_url(settings.database_url)

    assert settings.database_url == database_url
    assert parsed.drivername == "postgresql+psycopg"
    assert parsed.get_dialect().driver == "psycopg"
    assert parsed.get_dialect().import_dbapi().__name__ == "psycopg"


@pytest.mark.parametrize(
    "public_api_base_url",
    ["https://api.example.com", "http://127.0.0.1:8080"],
)
def test_public_api_base_url_accepts_credential_free_http_urls(
    public_api_base_url: str,
) -> None:
    settings = Settings(**deployed_settings(public_api_base_url=public_api_base_url))

    assert str(settings.public_api_base_url).rstrip("/") == public_api_base_url


@pytest.mark.parametrize(
    "public_api_base_url",
    [
        "https://api-user:API_PASSWORD_SENTINEL@api.example.com",
        "https://API_PASSWORD_SENTINEL@api.example.com",
        "https://[malformed-API_PASSWORD_SENTINEL",
    ],
)
def test_public_api_base_url_rejects_credentials_and_malformed_urls_without_exposure(
    public_api_base_url: str,
    caplog: pytest.LogCaptureFixture,
) -> None:
    with caplog.at_level(logging.DEBUG), pytest.raises(ValidationError) as captured:
        Settings(**deployed_settings(public_api_base_url=public_api_base_url))

    rendered = render_validation_error(captured.value, caplog.text)
    assert public_api_base_url not in rendered
    assert "API_PASSWORD_SENTINEL" not in rendered


def test_public_api_base_url_is_absent_from_settings_repr() -> None:
    public_api_base_url = "https://api.example.com"
    settings = Settings(**deployed_settings(public_api_base_url=public_api_base_url))

    assert public_api_base_url not in repr(settings)
    assert public_api_base_url not in str(settings)


@pytest.mark.parametrize(
    "invalid_host",
    [
        "",
        "   ",
        "https://cdn.example.com",
        "cdn.example.com/path",
        "cdn .example.com",
        "-cdn.example.com",
        "cdn..example.com",
        "cdn.example.com:443",
        "例子.example.com",
    ],
)
def test_deployed_settings_reject_invalid_public_image_hosts(invalid_host: str) -> None:
    with pytest.raises(ValidationError, match="PUBLIC_IMAGE_HOSTS"):
        Settings(**deployed_settings(public_image_hosts=(invalid_host,)))


def test_public_image_hosts_are_stripped_and_normalized() -> None:
    settings = Settings(
        **deployed_settings(public_image_hosts=(" CDN.Example.COM ", "assets-1.example.com"))
    )

    assert settings.public_image_hosts == ("cdn.example.com", "assets-1.example.com")


def test_development_keeps_local_database_default() -> None:
    assert Settings(app_env="development").database_url == "sqlite+pysqlite:///:memory:"


@pytest.mark.parametrize(
    ("field_name", "invalid_value"),
    [
        ("phone_encryption_key_version", True),
        ("phone_encryption_key_version", 1.0),
        ("phone_encryption_key_version", "1"),
        ("phone_encryption_key_version", "01"),
        ("session_ttl_days", True),
        ("session_ttl_days", 30.0),
        ("session_ttl_days", "30"),
        ("session_ttl_days", "030"),
    ],
)
def test_direct_settings_require_exact_integer_types(
    field_name: str,
    invalid_value: object,
) -> None:
    values = deployed_settings()
    values[field_name] = invalid_value

    with pytest.raises(ValidationError):
        Settings(**values)


def test_direct_settings_accept_exact_positive_integers() -> None:
    settings = Settings(**deployed_settings(phone_encryption_key_version=7, session_ttl_days=31))

    assert settings.phone_encryption_key_version == 7
    assert settings.session_ttl_days == 31


def test_process_environment_accepts_canonical_decimal_integer_strings(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    environment = production_environment(provider="real")
    environment["PHONE_ENCRYPTION_KEY_VERSION"] = "7"
    environment["SESSION_TTL_DAYS"] = "31"
    for key, value in environment.items():
        monkeypatch.setenv(key, value)

    settings = Settings()

    assert settings.phone_encryption_key_version == 7
    assert settings.session_ttl_days == 31


@pytest.mark.parametrize(
    ("field_name", "invalid_value"),
    [
        ("PHONE_ENCRYPTION_KEY_VERSION", "01"),
        ("PHONE_ENCRYPTION_KEY_VERSION", "+1"),
        ("PHONE_ENCRYPTION_KEY_VERSION", "1.0"),
        ("PHONE_ENCRYPTION_KEY_VERSION", " 1"),
        ("SESSION_TTL_DAYS", "030"),
        ("SESSION_TTL_DAYS", "+30"),
        ("SESSION_TTL_DAYS", "30.0"),
        ("SESSION_TTL_DAYS", "30 "),
    ],
)
def test_process_environment_rejects_noncanonical_integer_strings(
    field_name: str,
    invalid_value: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    environment = production_environment(provider="real")
    environment[field_name] = invalid_value
    for key, value in environment.items():
        monkeypatch.setenv(key, value)

    with pytest.raises(ValidationError):
        Settings()


@pytest.mark.parametrize(
    "invalid_phone",
    [
        "12",
        "12900138000",
        "1380013800a",
        "１３８００１３８０００",
        "١٣٨٠٠١٣٨٠٠٠",
        "13800138000\n",
        "ENCRYPT_PHONE_SECRET_SENTINEL",
    ],
)
def test_encrypt_rejects_noncanonical_phone_without_exposure(
    invalid_phone: str,
    caplog: pytest.LogCaptureFixture,
) -> None:
    with caplog.at_level(logging.DEBUG), pytest.raises(PhoneVaultError) as captured:
        vault().encrypt(
            invalid_phone,
            record_type="user",
            record_id=RECORD_ID,
            field="phone",
        )

    rendered = f"{captured.value!s}\n{captured.value!r}\n{caplog.text}"
    assert invalid_phone not in rendered


def test_encrypt_rejects_non_string_phone_with_domain_error() -> None:
    with pytest.raises(PhoneVaultError, match="phone number is invalid"):
        vault().encrypt(
            object(),  # type: ignore[arg-type]
            record_type="user",
            record_id=RECORD_ID,
            field="phone",
        )
