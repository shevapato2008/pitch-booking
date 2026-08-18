from __future__ import annotations

import base64
import hashlib
import hmac
import json
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr, ValidationError
from sqlalchemy import Engine, MetaData, Table, func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from backend.app.config import Settings
from backend.app.database import get_database
from backend.app.main import create_app
from backend.app.modules.platform_auth import service as platform_auth_service
from backend.app.modules.platform_auth.repository import PlatformAuthRepository

pytestmark = pytest.mark.integration

RAW_ACCESS_TOKEN = "platform-reviewer-access-token-000000000001"
CSRF_BYTES = bytes(range(32))
CSRF_SECRET = base64.b64encode(CSRF_BYTES).decode("ascii")
ORIGIN = "https://api.example.test"


def _principals(
    *,
    role: str = "ONBOARDING_REVIEWER",
    enabled: bool = True,
    token: str = RAW_ACCESS_TOKEN,
) -> str:
    return json.dumps(
        [
            {
                "principal_id": "ops-1",
                "display_name": "平台审核员",
                "token_sha256": hashlib.sha256(token.encode()).hexdigest(),
                "enabled": enabled,
                "roles": [role],
            }
        ],
        ensure_ascii=False,
        separators=(",", ":"),
    )


def _client(engine: Engine, *, principals: str | None = None) -> TestClient:
    settings = Settings(
        app_env="test",
        wechat_provider="development",
        public_api_base_url=ORIGIN,
        platform_staff_principals_json=principals or _principals(),
        platform_csrf_secret=CSRF_SECRET,
    )
    app = create_app(settings=settings)

    def database_override() -> Iterator[Session]:
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_database] = database_override
    return TestClient(
        app,
        base_url=ORIGIN,
        raise_server_exceptions=False,
    )


@pytest.mark.parametrize("role", ["PLATFORM_ADMIN", "ONBOARDING_REVIEWER"])
def test_allowed_staff_role_exchanges_and_restores_secure_session(
    pg_engine: Engine,
    role: str,
) -> None:
    client = _client(pg_engine, principals=_principals(role=role))

    created = client.post(
        "/platform-admin/api/v1/auth/session",
        json={"access_token": RAW_ACCESS_TOKEN},
        headers={"Origin": ORIGIN},
    )

    assert created.status_code == 200
    body = created.json()
    assert body["principal_id"] == "ops-1"
    assert body["display_name"] == "平台审核员"
    assert body["roles"] == [role]
    assert set(body) == {
        "principal_id",
        "display_name",
        "roles",
        "csrf_token",
        "expires_at",
    }
    assert RAW_ACCESS_TOKEN not in created.text
    assert hashlib.sha256(RAW_ACCESS_TOKEN.encode()).hexdigest() not in created.text

    cookie_header = created.headers["set-cookie"]
    assert "pitch_platform_session=" in cookie_header
    assert "HttpOnly" in cookie_header
    assert "Secure" in cookie_header
    assert "SameSite=strict" in cookie_header
    assert "Path=/platform-admin" in cookie_header
    assert "Max-Age=28800" in cookie_header

    session_token = client.cookies.get("pitch_platform_session")
    assert session_token is not None
    session_hash = hashlib.sha256(session_token.encode()).hexdigest()
    expected_csrf = hmac.new(
        CSRF_BYTES,
        session_hash.encode("ascii"),
        hashlib.sha256,
    ).hexdigest()
    assert body["csrf_token"] == expected_csrf

    restored = client.get("/platform-admin/api/v1/auth/session")
    assert restored.status_code == 200
    assert restored.json() == body

    with Session(pg_engine) as session:
        platform_sessions = Table(
            "platform_sessions", MetaData(), autoload_with=pg_engine
        )
        record = session.execute(
            select(platform_sessions).where(
                platform_sessions.c.token_hash == session_hash
            )
        ).mappings().one_or_none()
        assert record is not None
        assert record["principal_id"] == "ops-1"
        assert record["revoked_at"] is None
        assert record["expires_at"] - record["issued_at"] == timedelta(hours=8)
        assert "csrf_token" not in record


def test_invalid_access_token_is_rejected_without_secret_disclosure(
    pg_engine: Engine,
    caplog: pytest.LogCaptureFixture,
) -> None:
    client = _client(pg_engine)
    invalid = "invalid-platform-access-token-000000000000000"

    response = client.post(
        "/platform-admin/api/v1/auth/session",
        json={"access_token": invalid},
        headers={"Origin": ORIGIN},
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "PLATFORM_AUTH_INVALID"
    assert invalid not in response.text
    assert RAW_ACCESS_TOKEN not in response.text
    assert invalid not in caplog.text
    assert RAW_ACCESS_TOKEN not in caplog.text


def test_missing_csrf_configuration_does_not_persist_unusable_session(
    pg_engine: Engine,
) -> None:
    client = _client(pg_engine)
    client.app.state.settings.platform_csrf_secret = None
    platform_sessions = Table("platform_sessions", MetaData(), autoload_with=pg_engine)
    with Session(pg_engine) as session:
        before = session.scalar(
            select(func.count()).select_from(platform_sessions).where(
                platform_sessions.c.principal_id == "ops-1"
            )
        )

    response = client.post(
        "/platform-admin/api/v1/auth/session",
        json={"access_token": RAW_ACCESS_TOKEN},
        headers={"Origin": ORIGIN},
    )

    assert response.status_code == 503
    with Session(pg_engine) as session:
        after = session.scalar(
            select(func.count()).select_from(platform_sessions).where(
                platform_sessions.c.principal_id == "ops-1"
            )
        )
    assert after == before


def test_disabled_or_removed_principal_immediately_invalidates_existing_session(
    pg_engine: Engine,
) -> None:
    client = _client(pg_engine)
    created = client.post(
        "/platform-admin/api/v1/auth/session",
        json={"access_token": RAW_ACCESS_TOKEN},
        headers={"Origin": ORIGIN},
    )
    assert created.status_code == 200

    client.app.state.settings.platform_staff_principals_json = SecretStr(
        _principals(enabled=False)
    )
    disabled = client.get("/platform-admin/api/v1/auth/session")
    assert disabled.status_code == 401
    assert disabled.json()["error"]["code"] == "PLATFORM_AUTH_REQUIRED"

    client.app.state.settings.platform_staff_principals_json = SecretStr("[]")
    removed = client.get("/platform-admin/api/v1/auth/session")
    assert removed.status_code == 401
    assert removed.json()["error"]["code"] == "PLATFORM_AUTH_REQUIRED"


def test_logout_requires_same_origin_csrf_and_revokes_session(pg_engine: Engine) -> None:
    client = _client(pg_engine)
    created = client.post(
        "/platform-admin/api/v1/auth/session",
        json={"access_token": RAW_ACCESS_TOKEN},
        headers={"Origin": ORIGIN},
    )
    assert created.status_code == 200
    csrf_token = created.json()["csrf_token"]
    session_token = client.cookies.get("pitch_platform_session")
    assert session_token is not None

    missing_origin = client.delete(
        "/platform-admin/api/v1/auth/session",
        headers={"X-CSRF-Token": csrf_token},
    )
    assert missing_origin.status_code == 403
    assert missing_origin.json()["error"]["code"] == "PLATFORM_CSRF_INVALID"

    bad_csrf = client.delete(
        "/platform-admin/api/v1/auth/session",
        headers={"Origin": ORIGIN, "X-CSRF-Token": "0" * 64},
    )
    assert bad_csrf.status_code == 403
    assert bad_csrf.json()["error"]["code"] == "PLATFORM_CSRF_INVALID"

    logged_out = client.delete(
        "/platform-admin/api/v1/auth/session",
        headers={"Origin": ORIGIN, "X-CSRF-Token": csrf_token},
    )
    assert logged_out.status_code == 204
    assert "Max-Age=0" in logged_out.headers["set-cookie"]

    restored = client.get("/platform-admin/api/v1/auth/session")
    assert restored.status_code == 401
    with Session(pg_engine) as session:
        platform_sessions = Table(
            "platform_sessions", MetaData(), autoload_with=pg_engine
        )
        record = session.execute(
            select(platform_sessions).where(
                platform_sessions.c.token_hash
                == hashlib.sha256(session_token.encode()).hexdigest()
            )
        ).mappings().one_or_none()
        assert record is not None
        assert record["revoked_at"] is not None


def test_wechat_bearer_cannot_authenticate_platform_route(pg_engine: Engine) -> None:
    client = _client(pg_engine)
    response = client.get(
        "/platform-admin/api/v1/auth/session",
        headers={"Authorization": "Bearer ordinary-wechat-session"},
    )
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "PLATFORM_AUTH_REQUIRED"


def test_expired_session_is_rejected(pg_engine: Engine) -> None:
    client = _client(pg_engine)
    created = client.post(
        "/platform-admin/api/v1/auth/session",
        json={"access_token": RAW_ACCESS_TOKEN},
        headers={"Origin": ORIGIN},
    )
    assert created.status_code == 200
    session_token = client.cookies.get("pitch_platform_session")
    assert session_token is not None
    with Session(pg_engine) as session:
        platform_sessions = Table(
            "platform_sessions", MetaData(), autoload_with=pg_engine
        )
        record = session.execute(
            select(platform_sessions).where(
                platform_sessions.c.token_hash
                == hashlib.sha256(session_token.encode()).hexdigest()
            )
        ).mappings().one_or_none()
        assert record is not None
        expired_at = datetime.now(UTC) - timedelta(seconds=1)
        session.execute(
            platform_sessions.update()
            .where(platform_sessions.c.id == record["id"])
            .values(
                issued_at=expired_at - timedelta(hours=8),
                expires_at=expired_at,
            )
        )
        session.commit()

    response = client.get("/platform-admin/api/v1/auth/session")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "PLATFORM_AUTH_REQUIRED"


@pytest.mark.parametrize("origin", [None, "https://cross-origin.example.test"])
def test_access_token_exchange_requires_exact_same_origin(
    pg_engine: Engine,
    origin: str | None,
) -> None:
    client = _client(pg_engine)
    headers = {} if origin is None else {"Origin": origin}
    platform_sessions = Table("platform_sessions", MetaData(), autoload_with=pg_engine)
    with Session(pg_engine) as session:
        before = session.scalar(
            select(func.count()).select_from(platform_sessions)
        )

    response = client.post(
        "/platform-admin/api/v1/auth/session",
        json={"access_token": RAW_ACCESS_TOKEN},
        headers=headers,
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "PLATFORM_CSRF_INVALID"
    with Session(pg_engine) as session:
        after = session.scalar(select(func.count()).select_from(platform_sessions))
    assert after == before


def test_session_hash_collision_returns_503_without_residual_session(
    pg_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _client(pg_engine)
    raw_session_token = "fixed-platform-session-token"
    session_hash = hashlib.sha256(raw_session_token.encode()).hexdigest()
    monkeypatch.setattr(
        platform_auth_service.secrets,
        "token_urlsafe",
        lambda _bytes: raw_session_token,
    )
    first = client.post(
        "/platform-admin/api/v1/auth/session",
        json={"access_token": RAW_ACCESS_TOKEN},
        headers={"Origin": ORIGIN},
    )
    assert first.status_code == 200

    collided = client.post(
        "/platform-admin/api/v1/auth/session",
        json={"access_token": RAW_ACCESS_TOKEN},
        headers={"Origin": ORIGIN},
    )

    assert collided.status_code == 503
    assert collided.json()["error"]["code"] == "SERVICE_UNAVAILABLE"
    with Session(pg_engine) as session:
        platform_sessions = Table(
            "platform_sessions", MetaData(), autoload_with=pg_engine
        )
        assert session.scalar(
            select(func.count()).select_from(platform_sessions).where(
                platform_sessions.c.token_hash == session_hash
            )
        ) == 1


def test_session_restore_database_failure_returns_503(
    pg_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _client(pg_engine)
    created = client.post(
        "/platform-admin/api/v1/auth/session",
        json={"access_token": RAW_ACCESS_TOKEN},
        headers={"Origin": ORIGIN},
    )
    assert created.status_code == 200

    def fail_restore(
        _repository: PlatformAuthRepository,
        _token_hash: str,
    ) -> None:
        raise SQLAlchemyError("database unavailable")

    monkeypatch.setattr(PlatformAuthRepository, "get_by_token_hash", fail_restore)
    restored = client.get("/platform-admin/api/v1/auth/session")

    assert restored.status_code == 503
    assert restored.json()["error"]["code"] == "SERVICE_UNAVAILABLE"


def test_session_revoke_database_failure_returns_503_without_revocation(
    pg_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _client(pg_engine)
    created = client.post(
        "/platform-admin/api/v1/auth/session",
        json={"access_token": RAW_ACCESS_TOKEN},
        headers={"Origin": ORIGIN},
    )
    assert created.status_code == 200

    def fail_revoke(
        _repository: PlatformAuthRepository,
        _platform_session: object,
        _revoked_at: datetime,
    ) -> None:
        raise SQLAlchemyError("database unavailable")

    monkeypatch.setattr(PlatformAuthRepository, "revoke", fail_revoke)
    revoked = client.delete(
        "/platform-admin/api/v1/auth/session",
        headers={
            "Origin": ORIGIN,
            "X-CSRF-Token": created.json()["csrf_token"],
        },
    )

    assert revoked.status_code == 503
    assert revoked.json()["error"]["code"] == "SERVICE_UNAVAILABLE"
    session_token = client.cookies.get("pitch_platform_session")
    assert session_token is not None
    with Session(pg_engine) as session:
        platform_sessions = Table(
            "platform_sessions", MetaData(), autoload_with=pg_engine
        )
        record = session.execute(
            select(platform_sessions).where(
                platform_sessions.c.token_hash
                == hashlib.sha256(session_token.encode()).hexdigest()
            )
        ).mappings().one()
        assert record["revoked_at"] is None


@pytest.mark.parametrize(
    "principals",
    [
        _principals(role="UNKNOWN_ROLE"),
        json.dumps(
            [
                {
                    "principal_id": "ops-1",
                    "display_name": "平台审核员",
                    "token_sha256": "a" * 64,
                    "enabled": True,
                    "roles": [],
                }
            ]
        ),
        json.dumps(
            [
                {
                    "principal_id": "ops-1",
                    "display_name": "平台审核员",
                    "token_sha256": "A" * 64,
                    "enabled": True,
                    "roles": ["ONBOARDING_REVIEWER"],
                    "unexpected": True,
                }
            ]
        ),
    ],
)
def test_staff_principal_configuration_is_closed(principals: str) -> None:
    with pytest.raises(ValidationError):
        Settings(platform_staff_principals_json=principals)


@pytest.mark.parametrize(
    "csrf_secret",
    [
        "not-base64",
        base64.b64encode(b"short").decode("ascii"),
        base64.b64encode(bytes(range(32))).decode("ascii") + "=",
    ],
)
def test_csrf_secret_must_be_canonical_32_byte_base64(csrf_secret: str) -> None:
    with pytest.raises(ValidationError):
        Settings(platform_csrf_secret=csrf_secret)
