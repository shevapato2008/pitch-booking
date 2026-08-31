from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from sqlalchemy import Engine, func, select
from sqlalchemy import inspect as sqlalchemy_inspect
from sqlalchemy.orm import Session

from backend.app.models import (
    OpenGameMemberRemoval,
    OpenGameNotificationEvent,
    OpenGameNotificationOutbox,
    OpenGameRegistration,
    OpenGameRegistrationStatus,
    OpenGameStatus,
    Order,
    Payment,
    User,
)
from backend.tests.test_open_game_registration_http_journey import (
    WECHAT_APP_ID,
    _development_openid,
    registration_backend_url,
)
from backend.tests.test_open_game_registration_service import (
    _add_registration,
    _new_user,
)
from backend.tests.test_open_game_service import add_stored_game, seed_confirmed_order

pytestmark = pytest.mark.integration

CAPTAIN_CODE = "dev-member-removal-http-captain"
REMOVED_CODE = "dev-member-removal-http-removed"
PROMOTED_CODE = "dev-member-removal-http-promoted"
WAITING_CODE = "dev-member-removal-http-waiting"
REMOVAL_KEY = "member-removal-http-key-000000001"
SHARE_TOKEN = "M" * 32


def _column_snapshot(value: object) -> dict[str, object]:
    inspected = sqlalchemy_inspect(value)
    assert inspected is not None
    return {
        attribute.key: getattr(value, attribute.key)
        for attribute in inspected.mapper.column_attrs
    }


def _login(
    client: httpx.Client,
    *,
    code: str,
    expected_user_id: uuid.UUID,
) -> str:
    response = client.post("/api/v1/auth/wechat/session", json={"code": code})
    assert response.status_code == 200, response.text
    assert response.json()["user"]["id"] == str(expected_user_id)
    token = response.json()["session_token"]
    assert isinstance(token, str) and token
    return token


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_owner_removes_joined_member_and_promotes_fifo_over_real_http(
    pg_engine: Engine,
    request: pytest.FixtureRequest,
) -> None:
    backend_url = request.getfixturevalue(registration_backend_url.__name__)
    booking = seed_confirmed_order(
        pg_engine,
        starts_at=datetime.now(UTC) + timedelta(days=3),
    )
    with Session(pg_engine) as session:
        captain = session.get_one(User, booking.owner_id)
        removed_user = session.get_one(User, booking.stranger_id)
        promoted_user = _new_user(session, "member-http-promoted")
        waiting_user = _new_user(session, "member-http-waiting")
        steady_user = _new_user(session, "member-http-steady")
        for user, code in (
            (captain, CAPTAIN_CODE),
            (removed_user, REMOVED_CODE),
            (promoted_user, PROMOTED_CODE),
            (waiting_user, WAITING_CODE),
        ):
            user.wechat_app_id = WECHAT_APP_ID
            user.wechat_openid = _development_openid(code)

        game = add_stored_game(
            session,
            seeded=booking,
            status=OpenGameStatus.PUBLISHED,
            share_token=SHARE_TOKEN,
        )
        game.open_spots = 2
        removed = _add_registration(
            session,
            game_id=game.id,
            applicant_user_id=removed_user.id,
            status=OpenGameRegistrationStatus.JOINED,
            decided_by_user_id=captain.id,
            display_name="待移除队员",
        )
        steady = _add_registration(
            session,
            game_id=game.id,
            applicant_user_id=steady_user.id,
            status=OpenGameRegistrationStatus.JOINED,
            decided_by_user_id=captain.id,
            display_name="固定在场队员",
        )
        waiting = _add_registration(
            session,
            game_id=game.id,
            applicant_user_id=waiting_user.id,
            status=OpenGameRegistrationStatus.WAITLISTED,
            decided_by_user_id=captain.id,
            display_name="候补第二位",
            waitlist_seq=8,
            waitlisted_at=datetime.now(UTC) - timedelta(minutes=2),
        )
        promoted = _add_registration(
            session,
            game_id=game.id,
            applicant_user_id=promoted_user.id,
            status=OpenGameRegistrationStatus.WAITLISTED,
            decided_by_user_id=captain.id,
            display_name="候补第一位",
            waitlist_seq=2,
            waitlisted_at=datetime.now(UTC) - timedelta(minutes=1),
        )
        session.commit()

        game_id = game.id
        removed_id = removed.id
        steady_id = steady.id
        promoted_id = promoted.id
        waiting_id = waiting.id
        removed_user_id = removed_user.id
        promoted_user_id = promoted_user.id
        order_before = _column_snapshot(session.get_one(Order, booking.order_id))
        payment_before = _column_snapshot(session.get_one(Payment, booking.payment_id))

    roster_path = f"/api/v1/games/{game_id}/members"
    remove_path = f"{roster_path}/{removed_id}/remove"
    context_path = f"/api/v1/shared-games/{SHARE_TOKEN}/registration-context"
    with httpx.Client(
        base_url=backend_url,
        timeout=5,
        trust_env=False,
    ) as client:
        captain_token = _login(
            client,
            code=CAPTAIN_CODE,
            expected_user_id=booking.owner_id,
        )
        removed_token = _login(
            client,
            code=REMOVED_CODE,
            expected_user_id=removed_user_id,
        )
        promoted_token = _login(
            client,
            code=PROMOTED_CODE,
            expected_user_id=promoted_user_id,
        )

        roster_before = client.get(roster_path, headers=_auth(captain_token))
        removed_response = client.post(
            remove_path,
            headers={
                **_auth(captain_token),
                "Idempotency-Key": REMOVAL_KEY,
            },
            json={"expected_version": 2, "reason": "  临时阵容调整  "},
        )
        replay = client.post(
            remove_path,
            headers={
                **_auth(captain_token),
                "Idempotency-Key": REMOVAL_KEY,
            },
            json={"expected_version": 2, "reason": "临时阵容调整"},
        )
        roster_after = client.get(roster_path, headers=_auth(captain_token))
        removed_readback = client.get(
            context_path,
            headers=_auth(removed_token),
        )
        promoted_readback = client.get(
            context_path,
            headers=_auth(promoted_token),
        )

    assert roster_before.status_code == 200, roster_before.text
    assert roster_before.json()["joined_count"] == 2
    assert roster_before.json()["remaining_spots"] == 0
    assert roster_before.json()["waitlist_count"] == 2
    assert {item["registration_id"] for item in roster_before.json()["members"]} == {
        str(removed_id),
        str(steady_id),
    }

    assert removed_response.status_code == 200, removed_response.text
    assert replay.status_code == 200, replay.text
    assert replay.content == removed_response.content
    result = removed_response.json()
    assert result["removed_registration_id"] == str(removed_id)
    assert result["status"] == "REMOVED"
    assert result["joined_count"] == 2
    assert result["remaining_spots"] == 0
    assert result["waitlist_count"] == 1
    assert result["promoted_member"]["registration_id"] == str(promoted_id)

    assert roster_after.status_code == 200, roster_after.text
    assert {item["registration_id"] for item in roster_after.json()["members"]} == {
        str(steady_id),
        str(promoted_id),
    }
    assert removed_readback.status_code == 200, removed_readback.text
    assert removed_readback.json()["viewer_registration"]["persisted_status"] == (
        "REMOVED"
    )
    assert promoted_readback.status_code == 200, promoted_readback.text
    assert promoted_readback.json()["viewer_registration"]["persisted_status"] == (
        "JOINED"
    )

    with Session(pg_engine) as session:
        assert _column_snapshot(session.get_one(Order, booking.order_id)) == order_before
        assert _column_snapshot(session.get_one(Payment, booking.payment_id)) == (
            payment_before
        )
        assert session.get_one(OpenGameRegistration, removed_id).status is (
            OpenGameRegistrationStatus.REMOVED
        )
        assert session.get_one(OpenGameRegistration, promoted_id).status is (
            OpenGameRegistrationStatus.JOINED
        )
        assert session.get_one(OpenGameRegistration, waiting_id).status is (
            OpenGameRegistrationStatus.WAITLISTED
        )
        audit = session.scalar(select(OpenGameMemberRemoval))
        assert audit is not None
        assert (
            audit.registration_id,
            audit.applicant_user_id,
            audit.game_id,
            audit.order_id,
            audit.promoted_registration_id,
            audit.promoted_applicant_user_id,
        ) == (
            removed_id,
            removed_user_id,
            game_id,
            booking.order_id,
            promoted_id,
            promoted_user_id,
        )
        events = tuple(session.scalars(select(OpenGameNotificationOutbox)))
        assert len(events) == 1
        assert events[0].event is OpenGameNotificationEvent.WAITLIST_PROMOTED
        assert events[0].registration_id == promoted_id
        assert events[0].recipient_user_id == promoted_user_id
        assert session.scalar(
            select(func.count())
            .select_from(OpenGameNotificationOutbox)
            .where(OpenGameNotificationOutbox.recipient_user_id == removed_user_id)
        ) == 0
