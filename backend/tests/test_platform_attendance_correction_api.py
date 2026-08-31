from __future__ import annotations

import base64
import hashlib
import json
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from backend.app.config import Settings
from backend.app.database import get_database
from backend.app.main import create_app
from backend.tests.test_platform_attendance_correction_service import (
    CORRECTION_KEY,
    _seed_correctable_registration,
)

pytestmark = pytest.mark.integration

RAW_TOKEN = "platform-attendance-admin-token-000000001"
ORIGIN = "https://api.example.test"
CSRF_SECRET = base64.b64encode(bytes(reversed(range(32)))).decode("ascii")


def _principals(role: str) -> str:
    return json.dumps(
        [
            {
                "principal_id": "platform-admin-yangfan",
                "display_name": "平台管理员",
                "token_sha256": hashlib.sha256(RAW_TOKEN.encode()).hexdigest(),
                "enabled": True,
                "roles": [role],
            }
        ],
        ensure_ascii=False,
    )


def _client(engine: Engine, *, role: str = "PLATFORM_ADMIN") -> TestClient:
    app = create_app(
        settings=Settings(
            app_env="test",
            wechat_provider="development",
            public_api_base_url=ORIGIN,
            platform_staff_principals_json=_principals(role),
            platform_csrf_secret=CSRF_SECRET,
        )
    )

    def database_override() -> Iterator[Session]:
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_database] = database_override
    return TestClient(app, base_url=ORIGIN, raise_server_exceptions=False)


def _login(client: TestClient) -> str:
    response = client.post(
        "/platform-admin/api/v1/auth/session",
        json={"access_token": RAW_TOKEN},
        headers={"Origin": ORIGIN},
    )
    assert response.status_code == 200, response.text
    return str(response.json()["csrf_token"])


def _mutation_headers(csrf: str, *, key: str = CORRECTION_KEY) -> dict[str, str]:
    return {
        "Origin": ORIGIN,
        "X-CSRF-Token": csrf,
        "Idempotency-Key": key,
    }


def _body() -> dict[str, object]:
    return {
        "attendance_status": "PRESENT",
        "expected_version": 3,
        "reason": "已核对现场签到记录，原到场结果录入错误。",
    }


def test_routes_require_active_platform_admin_session_and_role(
    pg_engine: Engine,
) -> None:
    case = _seed_correctable_registration(pg_engine)
    registration_id = case.joined_ids[0]
    detail_path = f"/platform-admin/api/v1/attendance/registrations/{registration_id}"
    correction_path = f"{detail_path}/corrections"

    with _client(pg_engine) as anonymous:
        assert anonymous.get(detail_path).status_code == 401
        assert anonymous.post(correction_path, json=_body()).status_code == 401

    with _client(pg_engine, role="ONBOARDING_REVIEWER") as reviewer:
        csrf = _login(reviewer)
        for response in (
            reviewer.get(detail_path),
            reviewer.post(
                correction_path,
                headers=_mutation_headers(csrf),
                json=_body(),
            ),
        ):
            assert response.status_code == 403
            assert response.json()["error"]["code"] == "PLATFORM_ROLE_REQUIRED"


def test_get_and_correct_are_end_to_end_private_and_idempotent(
    pg_engine: Engine,
) -> None:
    case = _seed_correctable_registration(pg_engine)
    registration_id = case.joined_ids[0]
    detail_path = f"/platform-admin/api/v1/attendance/registrations/{registration_id}"
    correction_path = f"{detail_path}/corrections"

    with _client(pg_engine) as client:
        csrf = _login(client)
        detail = client.get(detail_path)
        corrected = client.post(
            correction_path,
            headers=_mutation_headers(csrf),
            json=_body(),
        )
        replay = client.post(
            correction_path,
            headers=_mutation_headers(csrf),
            json=_body(),
        )
        refreshed = client.get(detail_path)

    assert detail.status_code == 200, detail.text
    assert detail.json()["allowed_correction"] == {
        "target_status": "PRESENT",
        "blocked_reason": None,
    }
    assert corrected.status_code == 200, corrected.text
    assert corrected.json()["to_status"] == "PRESENT"
    assert replay.status_code == 200
    assert replay.content == corrected.content
    assert refreshed.status_code == 200
    assert refreshed.json()["version"] == 4
    assert refreshed.json()["attendance_status"] == "PRESENT"
    assert refreshed.json()["original_attendance_status"] == "NO_SHOW"
    assert refreshed.json()["corrections"] == [corrected.json()]

    serialized = json.dumps(refreshed.json(), ensure_ascii=False).lower()
    for forbidden in (
        "phone",
        "openid",
        "user_id",
        "note",
        "adult",
        "risk",
        "payment",
        "refund",
    ):
        assert forbidden not in serialized


def test_post_requires_same_origin_csrf_and_valid_request_shape(
    pg_engine: Engine,
) -> None:
    case = _seed_correctable_registration(pg_engine)
    path = f"/platform-admin/api/v1/attendance/registrations/{case.joined_ids[0]}/corrections"
    with _client(pg_engine) as client:
        csrf = _login(client)
        for headers in (
            {"Idempotency-Key": CORRECTION_KEY},
            {
                "Origin": "https://evil.example",
                "X-CSRF-Token": csrf,
                "Idempotency-Key": CORRECTION_KEY,
            },
            {
                "Origin": ORIGIN,
                "X-CSRF-Token": "0" * 64,
                "Idempotency-Key": CORRECTION_KEY,
            },
        ):
            response = client.post(path, headers=headers, json=_body())
            assert response.status_code == 403
            assert response.json()["error"]["code"] == "PLATFORM_CSRF_INVALID"

        invalid_requests = (
            ("not-a-uuid", _mutation_headers(csrf), _body()),
            (str(case.joined_ids[0]), _mutation_headers(csrf, key="short"), _body()),
            (
                str(case.joined_ids[0]),
                _mutation_headers(csrf, key="valid-key-but-invalid-body"),
                {
                    "attendance_status": "UNMARKED",
                    "expected_version": 0,
                    "reason": "\t\n",
                    "forbidden": True,
                },
            ),
        )
        for registration_id, headers, body in invalid_requests:
            response = client.post(
                f"/platform-admin/api/v1/attendance/registrations/{registration_id}/corrections",
                headers=headers,
                json=body,
            )
            assert response.status_code == 422, response.text
            assert response.json()["error"]["code"] == "INVALID_ARGUMENT"


def test_missing_registration_and_state_conflicts_use_frozen_errors(
    pg_engine: Engine,
) -> None:
    case = _seed_correctable_registration(pg_engine)
    with _client(pg_engine) as client:
        csrf = _login(client)
        missing = client.get(
            "/platform-admin/api/v1/attendance/registrations/00000000-0000-0000-0000-000000000001"
        )
        conflict = client.post(
            f"/platform-admin/api/v1/attendance/registrations/{case.joined_ids[0]}/corrections",
            headers=_mutation_headers(csrf),
            json={**_body(), "attendance_status": "NO_SHOW"},
        )

    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "ATTENDANCE_REGISTRATION_NOT_FOUND"
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "ATTENDANCE_STATE_CHANGED"
