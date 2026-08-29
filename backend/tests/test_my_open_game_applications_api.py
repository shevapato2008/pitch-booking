from __future__ import annotations

import base64
import hashlib
import json
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from backend.app.config import Settings
from backend.app.database import get_database
from backend.app.main import create_app
from backend.app.models import User, UserSession
from backend.tests.test_my_open_game_applications_service import (
    ITEM_FIELDS,
    NOW,
    PRIVATE_FIELDS,
    _all_keys,
    _new_user,
    _seed_application,
)

pytestmark = pytest.mark.integration

TOKEN = "my-open-game-applications-api-token-with-enough-entropy"


def _attach_session(engine: Engine, user_id: uuid.UUID, token: str = TOKEN) -> None:
    with Session(engine) as session:
        now = datetime.now(UTC)
        session.add(
            UserSession(
                user=session.get_one(User, user_id),
                token_hash=hashlib.sha256(token.encode()).hexdigest(),
                issued_at=now - timedelta(minutes=1),
                expires_at=now + timedelta(days=1),
            )
        )
        session.commit()


def _client(engine: Engine) -> TestClient:
    app = create_app(settings=Settings(app_env="test", wechat_provider="development"))

    def database_override() -> Iterator[Session]:
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_database] = database_override
    return TestClient(app, raise_server_exceptions=False)


def _auth(token: str = TOKEN) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _assert_invalid_argument(response: Response) -> None:
    payload = response.json()
    request_id = payload["error"].pop("request_id")
    assert isinstance(request_id, str) and request_id
    assert payload == {
        "error": {
            "code": "INVALID_ARGUMENT",
            "message": "请求参数格式不正确，请检查后重试。",
            "details": {},
        }
    }
    assert not {"loc", "type", "input", "msg", "ctx"} & _all_keys(payload)


def test_list_requires_bearer_and_returns_exact_self_only_privacy(pg_engine: Engine) -> None:
    applicant_id = _new_user(pg_engine, "api")
    foreign_id = _new_user(pg_engine, "api-foreign")
    own_id = _seed_application(
        pg_engine,
        applicant_user_id=applicant_id,
        label="自己的",
        applied_at=NOW,
    )
    _seed_application(
        pg_engine,
        applicant_user_id=foreign_id,
        label="别人的",
        applied_at=NOW + timedelta(minutes=1),
    )
    _attach_session(pg_engine, applicant_id)

    with _client(pg_engine) as client:
        anonymous = client.get("/api/v1/open-game-applications")
        response = client.get(
            "/api/v1/open-game-applications",
            headers=_auth(),
        )

    assert anonymous.status_code == 401
    assert anonymous.json()["error"]["code"] == "AUTH_REQUIRED"
    assert response.status_code == 200, response.text
    payload = response.json()
    assert set(payload) == {"items", "next_cursor"}
    assert payload["next_cursor"] is None
    assert [item["id"] for item in payload["items"]] == [str(own_id)]
    assert all(set(item) == ITEM_FIELDS for item in payload["items"])
    assert not PRIVATE_FIELDS & _all_keys(payload)
    assert str(applicant_id) not in response.text
    assert str(foreign_id) not in response.text


@pytest.mark.parametrize("limit", ["0", "51", "1.5", "true", ""])
def test_invalid_limit_maps_to_closed_422(pg_engine: Engine, limit: str) -> None:
    applicant_id = _new_user(pg_engine, f"limit-{limit}")
    _attach_session(pg_engine, applicant_id)
    with _client(pg_engine) as client:
        response = client.get(
            "/api/v1/open-game-applications",
            params={"limit": limit},
            headers=_auth(),
        )
    assert response.status_code == 422
    _assert_invalid_argument(response)


@pytest.mark.parametrize(
    "cursor",
    [
        "",
        "bad!",
        base64.urlsafe_b64encode(
            json.dumps({"v": 9, "applied_at": NOW.isoformat(), "id": str(uuid.uuid4())}).encode()
        ).decode().rstrip("="),
    ],
)
def test_invalid_cursor_maps_to_closed_422(
    pg_engine: Engine,
    cursor: str,
) -> None:
    applicant_id = _new_user(pg_engine, f"cursor-{uuid.uuid4()}")
    _attach_session(pg_engine, applicant_id)
    with _client(pg_engine) as client:
        response = client.get(
            "/api/v1/open-game-applications",
            params={"cursor": cursor},
            headers=_auth(),
        )
    assert response.status_code == 422
    _assert_invalid_argument(response)


def test_broken_authority_maps_to_whole_page_503(pg_engine: Engine) -> None:
    applicant_id = _new_user(pg_engine, "api-broken")
    _seed_application(
        pg_engine,
        applicant_user_id=applicant_id,
        label="接口损坏",
        applied_at=NOW,
        time_zone="Broken/Authority",
    )
    _attach_session(pg_engine, applicant_id)

    with _client(pg_engine) as client:
        response = client.get(
            "/api/v1/open-game-applications",
            headers=_auth(),
        )

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "SERVICE_UNAVAILABLE"
    assert "接口损坏" not in response.text
