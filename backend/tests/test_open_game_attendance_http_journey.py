import uuid

import httpx
import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from backend.app.models import OpenGame, OpenGameRegistration, Order, User
from backend.tests.test_open_game_attendance_service import (
    _seed_completed_attendance_game,
)
from backend.tests.test_open_game_registration_http_journey import (
    WECHAT_APP_ID,
    _development_openid,
    registration_backend_url,
)

pytestmark = pytest.mark.integration

CAPTAIN_CODE = "dev-attendance-http-captain"
PLAYER_CODE = "dev-attendance-http-player"
ATTENDANCE_KEY = "real-http-attendance-mark-key-000001"


def _login(client: httpx.Client, code: str, expected_user_id: uuid.UUID) -> str:
    response = client.post("/api/v1/auth/wechat/session", json={"code": code})
    assert response.status_code == 200, response.text
    assert response.json()["user"]["id"] == str(expected_user_id)
    token = response.json()["session_token"]
    assert isinstance(token, str) and token
    return token


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_owner_records_attendance_over_real_http_and_player_reads_result(
    pg_engine: Engine,
    request: pytest.FixtureRequest,
) -> None:
    backend_url = request.getfixturevalue(registration_backend_url.__name__)
    seeded = _seed_completed_attendance_game(pg_engine)
    registration_id = seeded.joined_ids[0]
    with Session(pg_engine) as session:
        captain = session.get_one(User, seeded.owner_id)
        registration = session.get_one(OpenGameRegistration, registration_id)
        player = session.get_one(User, registration.applicant_user_id)
        captain.wechat_app_id = WECHAT_APP_ID
        captain.wechat_openid = _development_openid(CAPTAIN_CODE)
        player.wechat_app_id = WECHAT_APP_ID
        player.wechat_openid = _development_openid(PLAYER_CODE)
        game = session.get_one(OpenGame, seeded.game.game_id)
        order = session.get_one(Order, seeded.game.booking.order_id)
        invariant = (
            game.status,
            game.open_spots,
            order.status,
            registration.status,
        )
        player_id = player.id
        session.commit()

    roster_path = f"/api/v1/games/{seeded.game.game_id}/attendance-roster"
    mark_path = (
        f"/api/v1/games/{seeded.game.game_id}/registrations/"
        f"{registration_id}/attendance"
    )
    context_path = (
        f"/api/v1/shared-games/{seeded.game.share_token}/registration-context"
    )
    with httpx.Client(
        base_url=backend_url,
        timeout=5,
        trust_env=False,
    ) as client:
        captain_token = _login(client, CAPTAIN_CODE, seeded.owner_id)
        player_token = _login(client, PLAYER_CODE, player_id)

        roster_before = client.get(roster_path, headers=_auth(captain_token))
        hidden = client.get(roster_path, headers=_auth(player_token))
        marked = client.post(
            mark_path,
            headers={
                **_auth(captain_token),
                "Idempotency-Key": ATTENDANCE_KEY,
            },
            json={"attendance_status": "PRESENT", "expected_version": 2},
        )
        replay = client.post(
            mark_path,
            headers={
                **_auth(captain_token),
                "Idempotency-Key": ATTENDANCE_KEY,
            },
            json={"attendance_status": "PRESENT", "expected_version": 2},
        )
        roster_after = client.get(roster_path, headers=_auth(captain_token))
        self_context = client.get(context_path, headers=_auth(player_token))

    assert roster_before.status_code == 200, roster_before.text
    assert roster_before.json()["recorded_count"] == 0
    assert roster_before.json()["attendance_complete"] is False
    assert hidden.status_code == 404
    assert hidden.json()["error"]["code"] == "OPEN_GAME_NOT_FOUND"
    assert marked.status_code == 200, marked.text
    assert marked.json()["attendance_status"] == "PRESENT"
    assert replay.content == marked.content
    assert roster_after.status_code == 200, roster_after.text
    assert roster_after.json()["recorded_count"] == 1
    assert roster_after.json()["attendance_complete"] is True
    assert self_context.status_code == 200, self_context.text
    assert self_context.json()["viewer_registration"]["attendance_status"] == (
        "PRESENT"
    )
    assert self_context.json()["viewer_registration"][
        "attendance_recorded_at"
    ] == marked.json()["attendance_recorded_at"]
    assert "attendance_recorded_by_user_id" not in self_context.text
    assert str(seeded.owner_id) not in self_context.text

    with Session(pg_engine) as session:
        game = session.get_one(OpenGame, seeded.game.game_id)
        order = session.get_one(Order, seeded.game.booking.order_id)
        registration = session.get_one(OpenGameRegistration, registration_id)
        assert (
            game.status,
            game.open_spots,
            order.status,
            registration.status,
        ) == invariant
