import json

import pytest
from sqlalchemy import Engine

from backend.app.modules.open_game_registrations.privacy import (
    ATTENDANCE_ROSTER_ITEM_FIELDS,
)
from backend.tests.test_open_game_attendance_service import (
    ATTENDANCE_KEY,
    _seed_completed_attendance_game,
)
from backend.tests.test_open_game_registration_api import (
    APPLICANT_TOKEN,
    OWNER_TOKEN,
    _attach_sessions,
    _auth,
    _client,
    _idempotent,
)

pytestmark = pytest.mark.integration


def test_attendance_http_routes_enforce_auth_privacy_validation_and_replay(
    pg_engine: Engine,
) -> None:
    seeded = _seed_completed_attendance_game(pg_engine, joined_count=1)
    _attach_sessions(pg_engine, seeded.game)
    target_id = seeded.joined_ids[0]
    roster_path = f"/api/v1/games/{seeded.game.game_id}/attendance-roster"
    mark_path = (
        f"/api/v1/games/{seeded.game.game_id}/registrations/"
        f"{target_id}/attendance"
    )

    with _client(pg_engine) as client:
        unauthenticated = client.get(roster_path)
        hidden = client.get(roster_path, headers=_auth(APPLICANT_TOKEN))
        roster = client.get(roster_path, headers=_auth(OWNER_TOKEN))
        invalid = client.post(
            mark_path,
            headers=_idempotent("short", token=OWNER_TOKEN),
            json={
                "attendance_status": "UNMARKED",
                "expected_version": 0,
                "recorder_id": "forbidden",
            },
        )
        marked = client.post(
            mark_path,
            headers=_idempotent(ATTENDANCE_KEY, token=OWNER_TOKEN),
            json={"attendance_status": "PRESENT", "expected_version": 2},
        )
        replay = client.post(
            mark_path,
            headers=_idempotent(ATTENDANCE_KEY, token=OWNER_TOKEN),
            json={"attendance_status": "PRESENT", "expected_version": 2},
        )
        opposite = client.post(
            mark_path,
            headers=_idempotent(
                "mark-open-game-attendance-other-key-001",
                token=OWNER_TOKEN,
            ),
            json={"attendance_status": "NO_SHOW", "expected_version": 3},
        )

    assert unauthenticated.status_code == 401
    assert unauthenticated.json()["error"]["code"] == "AUTH_REQUIRED"
    assert hidden.status_code == 404
    assert hidden.json()["error"]["code"] == "OPEN_GAME_NOT_FOUND"
    assert roster.status_code == 200, roster.text
    assert set(roster.json()) == {
        "game",
        "recorded_count",
        "total_count",
        "attendance_complete",
        "registrations",
    }
    assert set(roster.json()["registrations"][0]) == ATTENDANCE_ROSTER_ITEM_FIELDS
    assert "note" not in json.dumps(roster.json(), ensure_ascii=False)
    assert invalid.status_code == 422
    assert invalid.json()["error"]["code"] == "INVALID_ARGUMENT"
    assert marked.status_code == 200, marked.text
    assert marked.json()["attendance_status"] == "PRESENT"
    assert marked.json()["version"] == 3
    assert replay.status_code == 200
    assert replay.content == marked.content
    assert opposite.status_code == 409
    assert opposite.json()["error"]["code"] == "ATTENDANCE_STATE_CHANGED"


def test_attendance_mark_hides_non_owner_and_missing_registration(
    pg_engine: Engine,
) -> None:
    seeded = _seed_completed_attendance_game(pg_engine)
    _attach_sessions(pg_engine, seeded.game)
    path = (
        f"/api/v1/games/{seeded.game.game_id}/registrations/"
        "00000000-0000-0000-0000-000000000001/attendance"
    )
    body = {"attendance_status": "PRESENT", "expected_version": 2}

    with _client(pg_engine) as client:
        hidden = client.post(
            path,
            headers=_idempotent(ATTENDANCE_KEY, token=APPLICANT_TOKEN),
            json=body,
        )
        missing = client.post(
            path,
            headers=_idempotent(ATTENDANCE_KEY, token=OWNER_TOKEN),
            json=body,
        )

    assert hidden.status_code == 404
    assert hidden.json()["error"]["code"] == "OPEN_GAME_NOT_FOUND"
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "APPLICATION_NOT_FOUND"
