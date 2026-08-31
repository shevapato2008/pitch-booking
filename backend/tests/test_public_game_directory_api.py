from collections.abc import Iterator
from datetime import UTC, datetime
from importlib import import_module
from pathlib import Path
from typing import Any, Protocol, cast

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from backend.app.config import Settings
from backend.app.database import get_database
from backend.app.main import create_app
from backend.app.models import OpenGameRegistrationStatus
from backend.app.modules.public_games.router import get_public_game_directory_clock
from backend.tests.test_public_game_directory_service import (
    NOW,
    add_registration,
    seed_directory_game,
)

pytestmark = pytest.mark.integration

CONTRACT_PATH = Path(__file__).resolve().parents[2] / "contracts" / "openapi.yaml"


class _YamlLoader(Protocol):
    def safe_load(self, stream: str) -> object: ...


YAML = cast(_YamlLoader, import_module("yaml"))


def _client(engine: Engine, *, now: datetime = NOW) -> TestClient:
    app = create_app(settings=Settings(app_env="test", wechat_provider="development"))

    def database_override() -> Iterator[Session]:
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_database] = database_override
    app.dependency_overrides[get_public_game_directory_clock] = lambda: now
    return TestClient(app, raise_server_exceptions=False)


def _contract() -> dict[str, Any]:
    loaded = YAML.safe_load(CONTRACT_PATH.read_text())
    if not isinstance(loaded, dict):
        raise TypeError("OpenAPI contract root must be an object")
    return cast(dict[str, Any], loaded)


def test_anonymous_success_ignores_invalid_bearer_and_stays_private(
    pg_engine: Engine,
) -> None:
    seed_directory_game(
        pg_engine,
        name="匿名公开球局",
        share_token="A" * 32,
    )

    with _client(pg_engine) as client:
        anonymous = client.get("/api/v1/public-games")
        invalid_bearer = client.get(
            "/api/v1/public-games",
            headers={"Authorization": "Bearer deliberately-invalid"},
        )

    assert anonymous.status_code == invalid_bearer.status_code == 200
    assert anonymous.json() == invalid_bearer.json()
    body = anonymous.json()
    assert body["authoritative_now"] == NOW.isoformat().replace("+00:00", "Z")
    assert body["available_dates"] == ["2026-08-29"]
    assert len(body["items"]) == 1
    assert body["items"][0]["detail_path"] == ("/pages/captain-game-public/index?token=" + "A" * 32)
    serialized = anonymous.text.casefold()
    for private in (
        "order_id",
        "captain_user_id",
        "share_token",
        "contact",
        "payment",
        "refund",
        "application",
        "members",
    ):
        assert private not in serialized


@pytest.mark.parametrize(
    ("query", "expected_names"),
    [
        ("local_date=2026-08-29", ["七人制可报名", "七人制已满"]),
        ("format=SEVEN", ["七人制可报名", "七人制已满"]),
        ("available_only=true", ["五人制可报名", "七人制可报名"]),
        (
            "local_date=2026-08-29&format=SEVEN&available_only=true",
            ["七人制可报名"],
        ),
    ],
)
def test_query_parameters_filter_without_changing_date_facets(
    pg_engine: Engine,
    query: str,
    expected_names: list[str],
) -> None:
    seed_directory_game(
        pg_engine,
        name="五人制可报名",
        starts_at=datetime(2026, 8, 28, 1, tzinfo=UTC),
    )
    seed_directory_game(
        pg_engine,
        name="七人制可报名",
        starts_at=datetime(2026, 8, 29, 1, tzinfo=UTC),
        players_per_side=7,
    )
    full = seed_directory_game(
        pg_engine,
        name="七人制已满",
        starts_at=datetime(2026, 8, 29, 4, tzinfo=UTC),
        players_per_side=7,
    )
    with Session(pg_engine) as session:
        for index in range(4):
            add_registration(
                session,
                game=full,
                status=OpenGameRegistrationStatus.JOINED,
                label=f"api-full-{index}",
            )
        session.commit()

    with _client(pg_engine) as client:
        response = client.get(f"/api/v1/public-games?{query}")

    assert response.status_code == 200
    body = response.json()
    assert body["available_dates"] == ["2026-08-28", "2026-08-29"]
    assert [item["game"]["name"] for item in body["items"]] == expected_names


@pytest.mark.parametrize(
    "query",
    [
        "local_date=not-a-date",
        "format=ELEVEN",
        "available_only=maybe",
    ],
)
def test_invalid_query_parameters_use_error_envelope(
    pg_engine: Engine,
    query: str,
) -> None:
    with _client(pg_engine) as client:
        response = client.get(f"/api/v1/public-games?{query}")

    assert response.status_code == 422
    body = response.json()
    assert set(body) == {"error"}
    assert body["error"]["code"] == "INVALID_ARGUMENT"
    assert body["error"]["details"] == {}
    assert body["error"]["request_id"] == response.headers["X-Request-Id"]


def test_database_failure_is_sanitized_503_and_rolls_back() -> None:
    class FailingDatabase:
        rollback_called = False

        def execute(self, _statement: object) -> object:
            raise SQLAlchemyError("postgresql://private-secret@database")

        def rollback(self) -> None:
            self.rollback_called = True

    database = FailingDatabase()
    app = create_app(settings=Settings(app_env="test", wechat_provider="development"))
    app.dependency_overrides[get_database] = lambda: database
    app.dependency_overrides[get_public_game_directory_clock] = lambda: NOW

    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get("/api/v1/public-games")

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "SERVICE_UNAVAILABLE"
    assert "secret" not in response.text
    assert database.rollback_called is True


def test_runtime_openapi_matches_frozen_public_directory_contract() -> None:
    frozen = _contract()
    runtime = create_app(settings=Settings(app_env="test", wechat_provider="development")).openapi()

    assert (
        runtime["paths"]["/api/v1/public-games"]["get"]
        == frozen["paths"]["/api/v1/public-games"]["get"]
    )
    for name in (
        "PublicGameFormat",
        "PublicGameDirectoryItem",
        "PublicGameDirectoryResponse",
    ):
        assert runtime["components"]["schemas"][name] == frozen["components"]["schemas"][name]
