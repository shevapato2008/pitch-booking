from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from backend.app.config import Settings
from backend.app.database import get_database
from backend.app.main import create_app
from backend.app.models import OpenGameRegistrationStatus
from backend.app.modules.open_game_reports.router import get_open_game_report_clock
from backend.tests.test_open_game_registration_api import (
    APPLICANT_TOKEN,
    OWNER_TOKEN,
    _attach_sessions,
    _seed_published_game,
)
from backend.tests.test_open_game_registration_service import _add_registration

pytestmark = pytest.mark.integration

REPORT_KEY = "open-game-report-api-key-000001"
NOW = datetime(2026, 9, 1, 12, 30, tzinfo=UTC)


def _client(engine: Engine) -> TestClient:
    app = create_app(settings=Settings(app_env="test", wechat_provider="development"))

    def database_override() -> Iterator[Session]:
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_database] = database_override
    app.dependency_overrides[get_open_game_report_clock] = lambda: lambda: NOW
    return TestClient(app, raise_server_exceptions=False)


def _auth(token: str = APPLICANT_TOKEN) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _headers(token: str = APPLICANT_TOKEN, *, key: str = REPORT_KEY) -> dict[str, str]:
    return {**_auth(token), "Idempotency-Key": key}


def _seed_report_context(engine: Engine) -> str:
    case = _seed_published_game(engine)
    _attach_sessions(engine, case)
    with Session(engine) as session:
        _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=case.booking.stranger_id,
            status=OpenGameRegistrationStatus.APPLIED,
        )
        session.commit()
    return str(case.game_id)


def _body() -> dict[str, str]:
    return {
        "category": "FALSE_INFORMATION",
        "facts": "公开说明称费用已包含，但现场要求额外支付场地费。",
    }


def test_report_http_journey_is_self_only_closed_and_byte_stable(
    pg_engine: Engine,
) -> None:
    game_id = _seed_report_context(pg_engine)
    context_path = f"/api/v1/games/{game_id}/my-report"
    submit_path = f"/api/v1/games/{game_id}/reports"

    with _client(pg_engine) as client:
        unauthenticated = client.get(context_path)
        hidden = client.get(context_path, headers=_auth(OWNER_TOKEN))
        before = client.get(context_path, headers=_auth())
        invalid = client.post(
            submit_path,
            headers=_headers(key="short"),
            json={"category": "OTHER", "facts": "", "extra": True},
        )
        sensitive = client.post(
            submit_path,
            headers=_headers(),
            json={"category": "HARASSMENT", "facts": "请联系 13800138000 核实。"},
        )
        created = client.post(submit_path, headers=_headers(), json=_body())
        replay = client.post(submit_path, headers=_headers(), json=_body())
        after = client.get(context_path, headers=_auth())

    assert unauthenticated.status_code == 401
    assert unauthenticated.json()["error"]["code"] == "AUTH_REQUIRED"
    assert hidden.status_code == 404
    assert hidden.json()["error"]["code"] == "REPORT_CONTEXT_NOT_FOUND"
    assert before.status_code == 200
    assert before.json()["submission_allowed"] is True
    assert before.json()["report"] is None
    assert invalid.status_code == 422
    assert invalid.json()["error"]["code"] == "INVALID_ARGUMENT"
    assert invalid.json()["error"]["details"] == {
        "fields": [
            {"field": "category", "message": "字段值不符合要求。"},
            {"field": "facts", "message": "字段值不符合要求。"},
        ]
    }
    assert sensitive.status_code == 422
    assert sensitive.json()["error"]["code"] == "SENSITIVE_CONTENT_NOT_ALLOWED"
    assert created.status_code == 201, created.text
    assert replay.status_code == 200
    assert replay.content == created.content
    assert after.status_code == 200
    assert after.json()["report"] == created.json()
    assert after.json()["submission_allowed"] is False
    assert after.json()["submission_blocker"] == "REPORT_ALREADY_EXISTS"
    forbidden = {
        "reporter_user_id",
        "organizer_user_id",
        "reporter_registration_id",
        "order_id",
        "payment",
        "refund",
        "resolution_note",
    }
    serialized = created.text.lower()
    for key in forbidden:
        assert key not in serialized


def test_report_runtime_openapi_exposes_only_frozen_player_operations() -> None:
    runtime = create_app(settings=Settings(app_env="test", wechat_provider="development")).openapi()
    expected = {
        "/api/v1/games/{game_id}/my-report": (
            "get",
            "getMyOpenGameReport",
            {"200", "401", "404", "422", "503"},
        ),
        "/api/v1/games/{game_id}/reports": (
            "post",
            "submitOpenGameReport",
            {"200", "201", "401", "404", "409", "422", "503"},
        ),
    }
    for path, (method, operation_id, statuses) in expected.items():
        assert set(runtime["paths"][path]) == {method}
        operation = runtime["paths"][path][method]
        assert operation["operationId"] == operation_id
        assert operation["security"] == [{"bearerAuth": []}]
        assert set(operation["responses"]) == statuses
