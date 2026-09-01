from __future__ import annotations

import json

import pytest
from sqlalchemy import Engine

from backend.tests.test_platform_attendance_correction_api import (
    ORIGIN,
    _client,
    _login,
)
from backend.tests.test_platform_game_report_service import PLATFORM_KEY, _seed_report

pytestmark = pytest.mark.integration


def _headers(csrf: str, *, key: str = PLATFORM_KEY) -> dict[str, str]:
    return {
        "Origin": ORIGIN,
        "X-CSRF-Token": csrf,
        "Idempotency-Key": key,
    }


def _body() -> dict[str, str]:
    return {
        "outcome": "CONFIRMED_RECORDED",
        "resolution_note": "已核对公开页面、现场记录与双方陈述，记录本次成立结论。",
    }


def test_platform_report_routes_require_admin_role_and_same_origin_csrf(
    pg_engine: Engine,
) -> None:
    report_id, _game_id, _order_id, _now, _booking = _seed_report(pg_engine)
    detail_path = f"/platform-admin/api/v1/game-reports/{report_id}"
    resolution_path = f"{detail_path}/resolution"

    with _client(pg_engine) as anonymous:
        assert anonymous.get("/platform-admin/api/v1/game-reports").status_code == 401
        assert anonymous.get(detail_path).status_code == 401
        assert anonymous.post(resolution_path, json=_body()).status_code == 401

    with _client(pg_engine, role="ONBOARDING_REVIEWER") as reviewer:
        csrf = _login(reviewer)
        for response in (
            reviewer.get("/platform-admin/api/v1/game-reports"),
            reviewer.get(detail_path),
            reviewer.post(resolution_path, headers=_headers(csrf), json=_body()),
        ):
            assert response.status_code == 403
            assert response.json()["error"]["code"] == "PLATFORM_ROLE_REQUIRED"

    with _client(pg_engine) as admin:
        csrf = _login(admin)
        for headers in (
            {"Idempotency-Key": PLATFORM_KEY},
            {
                "Origin": "https://evil.example",
                "X-CSRF-Token": csrf,
                "Idempotency-Key": PLATFORM_KEY,
            },
        ):
            response = admin.post(resolution_path, headers=headers, json=_body())
            assert response.status_code == 403
            assert response.json()["error"]["code"] == "PLATFORM_CSRF_INVALID"


def test_platform_queue_detail_and_resolution_are_private_and_idempotent(
    pg_engine: Engine,
) -> None:
    report_id, _game_id, _order_id, _now, _booking = _seed_report(pg_engine)
    detail_path = f"/platform-admin/api/v1/game-reports/{report_id}"
    resolution_path = f"{detail_path}/resolution"

    with _client(pg_engine) as client:
        csrf = _login(client)
        queue = client.get("/platform-admin/api/v1/game-reports?state=PENDING&limit=1")
        detail = client.get(detail_path)
        sensitive = client.post(
            resolution_path,
            headers=_headers(csrf),
            json={
                "outcome": "DISMISSED",
                "resolution_note": "请联系 admin@example.com 补充材料。",
            },
        )
        resolved = client.post(
            resolution_path,
            headers=_headers(csrf),
            json=_body(),
        )
        replay = client.post(
            resolution_path,
            headers=_headers(csrf),
            json=_body(),
        )
        refreshed = client.get(detail_path)
        resolved_queue = client.get("/platform-admin/api/v1/game-reports?state=RESOLVED&limit=20")

    assert queue.status_code == 200, queue.text
    assert queue.json()["items"][0]["report_id"] == str(report_id)
    assert detail.status_code == 200, detail.text
    assert detail.json()["allowed_outcomes"] == [
        "DISMISSED",
        "CONFIRMED_RECORDED",
        "CONFIRMED_GAME_CANCELLED",
    ]
    assert sensitive.status_code == 422
    assert sensitive.json()["error"]["code"] == "SENSITIVE_CONTENT_NOT_ALLOWED"
    assert resolved.status_code == 200, resolved.text
    assert replay.status_code == 200
    assert replay.content == resolved.content
    assert refreshed.status_code == 200
    assert refreshed.json()["resolution"] == resolved.json()
    assert resolved_queue.status_code == 200
    assert resolved_queue.json()["items"][0]["status"] == "RESOLVED"

    serialized = json.dumps(detail.json(), ensure_ascii=False).lower()
    for forbidden in (
        "user_id",
        "phone",
        "openid",
        "order_id",
        "payment",
        "refund",
        "registration_note",
    ):
        assert forbidden not in serialized


def test_platform_report_validation_and_missing_errors_are_stable(
    pg_engine: Engine,
) -> None:
    report_id, _game_id, _order_id, _now, _booking = _seed_report(pg_engine)
    with _client(pg_engine) as client:
        csrf = _login(client)
        invalid_cursor = client.get(
            "/platform-admin/api/v1/game-reports?state=PENDING&cursor=not-opaque"
        )
        invalid = client.post(
            f"/platform-admin/api/v1/game-reports/{report_id}/resolution",
            headers=_headers(csrf, key="short"),
            json={"outcome": "BAN_USER", "resolution_note": "", "extra": True},
        )
        missing = client.get(
            "/platform-admin/api/v1/game-reports/00000000-0000-0000-0000-000000000001"
        )

    assert invalid_cursor.status_code == 422
    assert invalid_cursor.json()["error"]["code"] == "INVALID_ARGUMENT"
    assert invalid.status_code == 422
    assert invalid.json()["error"]["code"] == "INVALID_ARGUMENT"
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "REPORT_NOT_FOUND"


def test_platform_report_runtime_openapi_exposes_three_frozen_operations() -> None:
    from backend.app.config import Settings
    from backend.app.main import create_app

    runtime = create_app(settings=Settings(app_env="test", wechat_provider="development")).openapi()
    expected = {
        "/platform-admin/api/v1/game-reports": (
            "get",
            "listPlatformGameReports",
            {"200", "401", "403", "422", "503"},
        ),
        "/platform-admin/api/v1/game-reports/{report_id}": (
            "get",
            "getPlatformGameReport",
            {"200", "401", "403", "404", "422", "503"},
        ),
        "/platform-admin/api/v1/game-reports/{report_id}/resolution": (
            "post",
            "resolvePlatformGameReport",
            {"200", "401", "403", "404", "409", "422", "503"},
        ),
    }
    for path, (method, operation_id, statuses) in expected.items():
        operation = runtime["paths"][path][method]
        assert operation["operationId"] == operation_id
        assert operation["security"] == [{"platformSession": []}]
        assert set(operation["responses"]) == statuses
