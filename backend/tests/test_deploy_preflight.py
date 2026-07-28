import json
import subprocess
from pathlib import Path

from scripts.preflight_deploy import preflight


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
        "PAYMENT_PROVIDER": "wechat",
        "ENABLE_MOCK_PAYMENT_PROVIDER": "false",
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


def test_preflight_rejects_mock_payment_configuration(tmp_path: Path) -> None:
    values = valid_local_environment()
    values["PAYMENT_PROVIDER"] = "mock"
    values["ENABLE_MOCK_PAYMENT_PROVIDER"] = "true"

    result = preflight(write_env(tmp_path, values))

    assert set(result.failures) == {
        "PAYMENT_PROVIDER must be wechat for deployment",
        "ENABLE_MOCK_PAYMENT_PROVIDER must be false for deployment",
    }


def test_compose_defines_the_local_staging_services(tmp_path: Path) -> None:
    env_file = write_env(tmp_path, valid_local_environment())

    completed = subprocess.run(
        ["docker", "compose", "--env-file", str(env_file), "config", "--format", "json"],
        check=True,
        capture_output=True,
        text=True,
    )
    config = json.loads(completed.stdout)

    assert set(config["services"]) == {"api", "caddy", "postgres"}
    assert config["services"]["postgres"]["healthcheck"]
    assert config["services"]["api"]["depends_on"]["postgres"]["condition"] == "service_healthy"
    assert "alembic upgrade head" in " ".join(config["services"]["api"]["command"])
    assert "postgres_data" in config["volumes"]


def test_runtime_image_never_syncs_development_dependencies() -> None:
    dockerfile = Path("backend/Dockerfile").read_text(encoding="utf-8")

    assert "UV_NO_DEV=1" in dockerfile
