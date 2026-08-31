import hashlib
import json
import uuid
from collections.abc import Iterator, Mapping
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from backend.app.config import Settings
from backend.app.database import get_database
from backend.app.main import create_app
from backend.app.models import (
    IdempotencyRecord,
    OpenGame,
    OpenGameNotificationOutbox,
    OpenGameRegistration,
    OpenGameRegistrationStatus,
    OpenGameStatus,
    User,
    UserSession,
)
from backend.app.modules.open_game_registrations.privacy import (
    CAPTAIN_APPLICATION_FIELDS,
    VIEWER_REGISTRATION_FIELDS,
)
from backend.app.modules.open_game_registrations.repository import (
    OpenGameRegistrationRepository,
)
from backend.app.modules.open_game_registrations.router import (
    get_open_game_registration_clock,
)
from backend.app.modules.open_games.privacy import PUBLIC_OPEN_GAME_FIELDS
from backend.tests.test_open_game_registration_service import (
    SeededRegistrationCase,
    _add_registration,
    _b1_snapshot,
    _c1a_snapshot,
    _new_user,
)
from backend.tests.test_open_game_service import (
    add_stored_game,
    seed_confirmed_order,
)

pytestmark = pytest.mark.integration

OWNER_TOKEN = "registration-api-owner-token-with-at-least-256-bits"
APPLICANT_TOKEN = "registration-api-applicant-token-with-256-bits"
EXPIRED_TOKEN = "registration-api-expired-token-with-256-bits"
APPLY_KEY = "registration-api-apply-key-000001"
DECISION_KEY = "registration-api-decision-key-0001"
WITHDRAWAL_KEY = "registration-api-withdrawal-key-0001"

CONTEXT_FIELDS = frozenset(
    {
        "game",
        "remaining_spots",
        "viewer_authenticated",
        "viewer_registration",
        "allowed_actions",
    }
)
QUEUE_FIELDS = frozenset(
    {"remaining_spots", "pending_count", "applications", "waitlist_count", "waitlist"}
)
PRIVATE_REGISTRATION_FIELDS = frozenset(
    {
        "applicant_user_id",
        "decided_by_user_id",
        "consent_version",
        "adult_confirmed_at",
        "risk_confirmed_at",
        "created_at",
        "updated_at",
        "wechat_openid",
        "wechat_unionid",
        "phone",
        "order",
        "payment",
        "refund",
    }
)


def _seed_published_game(engine: Engine) -> SeededRegistrationCase:
    booking = seed_confirmed_order(
        engine,
        starts_at=datetime.now(UTC) + timedelta(days=3),
    )
    share_token = "R" * 32
    with Session(engine) as session:
        game = add_stored_game(
            session,
            seeded=booking,
            status=OpenGameStatus.PUBLISHED,
            share_token=share_token,
        )
        session.commit()
        return SeededRegistrationCase(
            booking=booking,
            game_id=game.id,
            share_token=share_token,
        )


def _attach_sessions(engine: Engine, case: SeededRegistrationCase) -> None:
    now = datetime.now(UTC)
    with Session(engine) as session:
        for user_id, token, expires_at in (
            (case.booking.owner_id, OWNER_TOKEN, now + timedelta(days=1)),
            (case.booking.stranger_id, APPLICANT_TOKEN, now + timedelta(days=1)),
            (case.booking.stranger_id, EXPIRED_TOKEN, now - timedelta(seconds=1)),
        ):
            session.add(
                UserSession(
                    user=session.get_one(User, user_id),
                    token_hash=hashlib.sha256(token.encode()).hexdigest(),
                    issued_at=now - timedelta(minutes=1),
                    expires_at=expires_at,
                )
            )
        session.commit()


def _client(engine: Engine) -> TestClient:
    app = create_app(
        settings=Settings(app_env="test", wechat_provider="development")
    )

    def database_override() -> Iterator[Session]:
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_database] = database_override
    return TestClient(app, raise_server_exceptions=False)


def _auth(token: str = APPLICANT_TOKEN) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _idempotent(key: str, *, token: str = APPLICANT_TOKEN) -> dict[str, str]:
    return {**_auth(token), "Idempotency-Key": key}


def _application_body(*, display_name: str = "周末小翼") -> dict[str, object]:
    return {
        "display_name": display_name,
        "position": "FORWARD",
        "note": "可以补边路，按时到场。",
        "adult_confirmed": True,
        "risk_confirmed": True,
    }


def _withdrawal_body(
    *,
    action: str = "WITHDRAW_APPLICATION",
    expected_version: int = 1,
) -> dict[str, object]:
    return {"action": action, "expected_version": expected_version}


def test_withdrawal_route_is_self_only_closed_and_byte_stable_on_replay(
    pg_engine: Engine,
) -> None:
    case = _seed_published_game(pg_engine)
    _attach_sessions(pg_engine, case)
    with Session(pg_engine) as session:
        target = _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=case.booking.stranger_id,
            status=OpenGameRegistrationStatus.APPLIED,
        )
        session.commit()
        application_id = target.id

    path = f"/api/v1/open-game-applications/{application_id}/withdraw"
    with _client(pg_engine) as client:
        unauthenticated = client.post(
            path,
            headers={"Idempotency-Key": WITHDRAWAL_KEY},
            json=_withdrawal_body(),
        )
        hidden = client.post(
            path,
            headers=_idempotent(WITHDRAWAL_KEY, token=OWNER_TOKEN),
            json=_withdrawal_body(),
        )
        invalid = client.post(
            path,
            headers=_idempotent("short"),
            json={"action": "AUTO", "expected_version": 0, "late": True},
        )
        withdrawn = client.post(
            path,
            headers=_idempotent(WITHDRAWAL_KEY),
            json=_withdrawal_body(),
        )
        replay = client.post(
            path,
            headers=_idempotent(WITHDRAWAL_KEY),
            json=_withdrawal_body(),
        )
        reused = client.post(
            path,
            headers=_idempotent(WITHDRAWAL_KEY),
            json=_withdrawal_body(expected_version=2),
        )

    assert unauthenticated.status_code == 401
    assert unauthenticated.json()["error"]["code"] == "AUTH_REQUIRED"
    assert hidden.status_code == 404
    assert hidden.json()["error"]["code"] == "APPLICATION_NOT_FOUND"
    assert invalid.status_code == 422
    assert _error(invalid) == {
        "code": "INVALID_ARGUMENT",
        "message": "请求参数格式不正确，请检查后重试。",
        "details": {
            "fields": [
                {"field": "action", "message": "字段值不符合要求。"},
                {"field": "expected_version", "message": "字段值不符合要求。"},
            ]
        },
    }
    assert withdrawn.status_code == 200, withdrawn.text
    _assert_context_privacy(withdrawn.json())
    assert withdrawn.json()["viewer_registration"]["persisted_status"] == "WITHDRAWN"
    assert replay.status_code == 200
    assert replay.content == withdrawn.content
    assert reused.status_code == 409
    assert reused.json()["error"]["code"] == "IDEMPOTENCY_KEY_REUSED"


def test_joined_exit_route_atomically_promotes_waitlist_without_exposing_outbox(
    pg_engine: Engine,
) -> None:
    case = _seed_published_game(pg_engine)
    _attach_sessions(pg_engine, case)
    with Session(pg_engine) as session:
        game = session.get_one(OpenGame, case.game_id)
        game.open_spots = 1
        departing = _add_registration(
            session,
            game_id=game.id,
            applicant_user_id=case.booking.stranger_id,
            status=OpenGameRegistrationStatus.JOINED,
            decided_by_user_id=case.booking.owner_id,
        )
        candidate_user = _new_user(session, "api-promotion")
        candidate = _add_registration(
            session,
            game_id=game.id,
            applicant_user_id=candidate_user.id,
            status=OpenGameRegistrationStatus.WAITLISTED,
            decided_by_user_id=case.booking.owner_id,
            waitlist_seq=1,
            waitlisted_at=datetime.now(UTC) - timedelta(minutes=1),
        )
        session.commit()
        departing_id = departing.id
        candidate_id = candidate.id

    with _client(pg_engine) as client:
        response = client.post(
            f"/api/v1/open-game-applications/{departing_id}/withdraw",
            headers=_idempotent("registration-api-promotion-exit-key-01"),
            json=_withdrawal_body(action="LEAVE_GAME", expected_version=2),
        )

    assert response.status_code == 200, response.text
    assert response.json()["remaining_spots"] == 0
    assert response.json()["viewer_registration"]["persisted_status"] == (
        "WITHDRAWN"
    )
    assert "outbox" not in response.text.lower()
    assert "waitlist_seq" not in response.text
    with Session(pg_engine) as session:
        assert session.get_one(
            OpenGameRegistration,
            candidate_id,
        ).status is OpenGameRegistrationStatus.JOINED
        events = tuple(session.scalars(select(OpenGameNotificationOutbox)))
        assert len(events) == 1
        assert events[0].registration_id == candidate_id


def test_withdrawal_route_samples_the_injected_clock_inside_the_locked_service(
    pg_engine: Engine,
) -> None:
    case = _seed_published_game(pg_engine)
    _attach_sessions(pg_engine, case)
    with Session(pg_engine) as session:
        target = _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=case.booking.stranger_id,
            status=OpenGameRegistrationStatus.APPLIED,
        )
        session.commit()
        application_id = target.id

    calls = 0

    def locked_clock() -> datetime:
        nonlocal calls
        calls += 1
        return datetime.now(UTC)

    client = _client(pg_engine)
    client.app.dependency_overrides[get_open_game_registration_clock] = (
        lambda: locked_clock
    )
    with client:
        response = client.post(
            f"/api/v1/open-game-applications/{application_id}/withdraw",
            headers=_idempotent("registration-api-lazy-clock-key-01"),
            json=_withdrawal_body(),
        )

    assert response.status_code == 200
    assert calls == 1


def _all_keys(value: Any) -> set[str]:
    if isinstance(value, Mapping):
        return {
            str(key)
            for key, child in value.items()
        } | {key for child in value.values() for key in _all_keys(child)}
    if isinstance(value, list):
        return {key for child in value for key in _all_keys(child)}
    return set()


def _assert_context_privacy(payload: dict[str, Any]) -> None:
    assert set(payload) == CONTEXT_FIELDS
    assert set(payload["game"]) == PUBLIC_OPEN_GAME_FIELDS
    assert set(payload["allowed_actions"]) == {
        "can_apply",
        "apply_blocked_reason",
    }
    registration = payload["viewer_registration"]
    if registration is not None:
        assert set(registration) == VIEWER_REGISTRATION_FIELDS
    assert not PRIVATE_REGISTRATION_FIELDS & _all_keys(payload)


def _assert_queue_privacy(payload: dict[str, Any]) -> None:
    assert set(payload) == QUEUE_FIELDS
    assert payload["pending_count"] == len(payload["applications"])
    for application in payload["applications"]:
        assert set(application) == CAPTAIN_APPLICATION_FIELDS
        assert set(application["allowed_actions"]) == {
            "can_accept",
            "accept_blocked_reason",
            "can_waitlist",
            "waitlist_blocked_reason",
            "can_reject",
            "reject_blocked_reason",
        }
    assert payload["waitlist_count"] == len(payload["waitlist"])
    for waitlist_item in payload["waitlist"]:
        assert set(waitlist_item) == {
            "id",
            "display_name",
            "position",
            "note",
            "applied_at",
            "waitlisted_at",
            "waitlist_position",
        }
    assert not PRIVATE_REGISTRATION_FIELDS & _all_keys(payload)


def test_context_and_owner_queue_project_real_waitlist_without_internal_sequence(
    pg_engine: Engine,
) -> None:
    case = _seed_published_game(pg_engine)
    _attach_sessions(pg_engine, case)
    waitlisted_at = datetime.now(UTC) - timedelta(minutes=2)
    with Session(pg_engine) as session:
        earlier = _new_user(session, "api-waitlist-earlier")
        _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=earlier.id,
            status=OpenGameRegistrationStatus.WAITLISTED,
            decided_by_user_id=case.booking.owner_id,
            waitlist_seq=2,
            waitlisted_at=waitlisted_at,
        )
        viewer = _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=case.booking.stranger_id,
            status=OpenGameRegistrationStatus.WAITLISTED,
            decided_by_user_id=case.booking.owner_id,
            waitlist_seq=8,
            waitlisted_at=waitlisted_at,
        )
        session.commit()
        viewer_id = viewer.id

    with _client(pg_engine) as client:
        context = client.get(
            f"/api/v1/shared-games/{case.share_token}/registration-context",
            headers=_auth(),
        )
        queue = client.get(
            f"/api/v1/games/{case.game_id}/applications",
            headers=_auth(OWNER_TOKEN),
        )

    assert context.status_code == 200, context.text
    context_body = context.json()
    _assert_context_privacy(context_body)
    assert context_body["viewer_registration"]["id"] == str(viewer_id)
    assert context_body["viewer_registration"]["persisted_status"] == "WAITLISTED"
    assert context_body["viewer_registration"]["waitlist_position"] == 2
    assert context_body["viewer_registration"]["promoted_at"] is None
    assert queue.status_code == 200, queue.text
    queue_body = queue.json()
    _assert_queue_privacy(queue_body)
    assert [item["waitlist_position"] for item in queue_body["waitlist"]] == [1, 2]
    assert "waitlist_seq" not in json.dumps(queue_body)


def test_waitlist_decision_and_self_withdrawal_http_journey_is_authoritative(
    pg_engine: Engine,
) -> None:
    case = _seed_published_game(pg_engine)
    _attach_sessions(pg_engine, case)
    with Session(pg_engine) as session:
        game = session.get_one(OpenGame, case.game_id)
        game.open_spots = 1
        joined_user = _new_user(session, "api-waitlist-full")
        _add_registration(
            session,
            game_id=game.id,
            applicant_user_id=joined_user.id,
            status=OpenGameRegistrationStatus.JOINED,
            decided_by_user_id=case.booking.owner_id,
        )
        target = _add_registration(
            session,
            game_id=game.id,
            applicant_user_id=case.booking.stranger_id,
            status=OpenGameRegistrationStatus.APPLIED,
        )
        session.commit()
        target_id = target.id

    decision_path = (
        f"/api/v1/games/{case.game_id}/applications/{target_id}/decision"
    )
    context_path = (
        f"/api/v1/shared-games/{case.share_token}/registration-context"
    )
    withdrawal_path = f"/api/v1/open-game-applications/{target_id}/withdraw"
    with _client(pg_engine) as client:
        queued = client.post(
            decision_path,
            headers=_idempotent(
                "registration-api-waitlist-decision-001",
                token=OWNER_TOKEN,
            ),
            json={"decision": "WAITLIST", "expected_version": 1},
        )
        replay = client.post(
            decision_path,
            headers=_idempotent(
                "registration-api-waitlist-decision-001",
                token=OWNER_TOKEN,
            ),
            json={"decision": "WAITLIST", "expected_version": 1},
        )
        context = client.get(context_path, headers=_auth())
        owner_queue = client.get(
            f"/api/v1/games/{case.game_id}/applications",
            headers=_auth(OWNER_TOKEN),
        )
        withdrawn = client.post(
            withdrawal_path,
            headers=_idempotent("registration-api-waitlist-withdraw-001"),
            json={"action": "WITHDRAW_WAITLIST", "expected_version": 2},
        )

    assert queued.status_code == replay.status_code == 200
    assert queued.content == replay.content
    assert queued.json()["status"] == "WAITLISTED"
    assert queued.json()["remaining_spots"] == 0
    assert "waitlist_seq" not in queued.text
    assert context.status_code == 200
    viewer_registration = context.json()["viewer_registration"]
    assert viewer_registration["persisted_status"] == "WAITLISTED"
    assert viewer_registration["effective_status"] == "WAITLISTED"
    assert viewer_registration["version"] == 2
    assert viewer_registration["available_withdrawal_action"] == (
        "WITHDRAW_WAITLIST"
    )
    assert viewer_registration["waitlist_position"] == 1
    assert owner_queue.status_code == 200
    assert owner_queue.json()["pending_count"] == 0
    assert owner_queue.json()["waitlist_count"] == 1
    assert owner_queue.json()["waitlist"][0]["id"] == str(target_id)
    assert withdrawn.status_code == 200
    assert withdrawn.json()["viewer_registration"]["persisted_status"] == "WITHDRAWN"
    assert withdrawn.json()["viewer_registration"]["withdrawal_kind"] == (
        "WAITLIST_WITHDRAWAL"
    )
    assert withdrawn.json()["viewer_registration"]["waitlisted_at"] is not None
    assert withdrawn.json()["viewer_registration"]["waitlist_position"] is None
    assert "waitlist_seq" not in withdrawn.text


def _error(response: Any) -> dict[str, Any]:
    payload = response.json()["error"]
    assert isinstance(payload.pop("request_id"), str)
    return payload


def test_context_apply_queue_and_decision_routes_precede_the_shared_catch_all(
    pg_engine: Engine,
) -> None:
    case = _seed_published_game(pg_engine)
    _attach_sessions(pg_engine, case)

    with _client(pg_engine) as client:
        anonymous = client.get(
            f"/api/v1/shared-games/{case.share_token}/registration-context"
        )
        assert anonymous.status_code == 200, anonymous.text
        anonymous_body = anonymous.json()
        _assert_context_privacy(anonymous_body)
        assert anonymous_body["viewer_authenticated"] is False
        assert anonymous_body["viewer_registration"] is None
        assert anonymous_body["allowed_actions"] == {
            "can_apply": False,
            "apply_blocked_reason": "AUTH_REQUIRED",
        }

        ready = client.get(
            f"/api/v1/shared-games/{case.share_token}/registration-context",
            headers=_auth(),
        )
        assert ready.status_code == 200, ready.text
        assert ready.json()["allowed_actions"] == {
            "can_apply": True,
            "apply_blocked_reason": None,
        }

        applied = client.post(
            f"/api/v1/shared-games/{case.share_token}/applications",
            headers=_idempotent(APPLY_KEY),
            json=_application_body(),
        )
        assert applied.status_code == 201, applied.text
        applied_body = applied.json()
        _assert_context_privacy(applied_body)
        assert applied_body["viewer_registration"]["persisted_status"] == "APPLIED"

        replay = client.post(
            f"/api/v1/shared-games/{case.share_token}/applications",
            headers=_idempotent(APPLY_KEY),
            json=_application_body(),
        )
        assert replay.status_code == 201, replay.text
        assert replay.content == applied.content

        queue = client.get(
            f"/api/v1/games/{case.game_id}/applications",
            headers=_auth(OWNER_TOKEN),
        )
        assert queue.status_code == 200, queue.text
        queue_body = queue.json()
        _assert_queue_privacy(queue_body)
        assert queue_body["pending_count"] == 1
        application_id = queue_body["applications"][0]["id"]

        accepted = client.post(
            f"/api/v1/games/{case.game_id}/applications/{application_id}/decision",
            headers=_idempotent(DECISION_KEY, token=OWNER_TOKEN),
            json={"decision": "ACCEPT", "expected_version": 1},
        )
        assert accepted.status_code == 200, accepted.text
        assert accepted.json()["status"] == "JOINED"
        assert set(accepted.json()) == {
            "application_id",
            "status",
            "version",
            "decided_at",
            "remaining_spots",
            "allowed_actions",
        }

        decision_replay = client.post(
            f"/api/v1/games/{case.game_id}/applications/{application_id}/decision",
            headers=_idempotent(DECISION_KEY, token=OWNER_TOKEN),
            json={"decision": "ACCEPT", "expected_version": 1},
        )
        assert decision_replay.status_code == 200, decision_replay.text
        assert decision_replay.content == accepted.content

        joined = client.get(
            f"/api/v1/shared-games/{case.share_token}/registration-context",
            headers=_auth(),
        )
        assert joined.status_code == 200, joined.text
        _assert_context_privacy(joined.json())
        assert joined.json()["viewer_registration"]["effective_status"] == "JOINED"


@pytest.mark.parametrize(
    "authorization",
    ["", "Basic opaque", "Bearer", "Bearer opaque extra", "Bearer invalid-token"],
)
def test_optional_context_rejects_every_present_invalid_authorization(
    pg_engine: Engine,
    authorization: str,
) -> None:
    case = _seed_published_game(pg_engine)
    _attach_sessions(pg_engine, case)

    with _client(pg_engine) as client:
        response = client.get(
            f"/api/v1/shared-games/{case.share_token}/registration-context",
            headers={"Authorization": authorization},
        )

    assert response.status_code == 401
    assert _error(response) == {
        "code": "AUTH_REQUIRED",
        "message": "登录状态已失效，请重新登录。",
        "details": {},
    }


def test_optional_context_rejects_expired_bearer(pg_engine: Engine) -> None:
    case = _seed_published_game(pg_engine)
    _attach_sessions(pg_engine, case)

    with _client(pg_engine) as client:
        response = client.get(
            f"/api/v1/shared-games/{case.share_token}/registration-context",
            headers=_auth(EXPIRED_TOKEN),
        )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_REQUIRED"


def test_apply_queue_and_decision_all_require_bearer(pg_engine: Engine) -> None:
    case = _seed_published_game(pg_engine)

    with _client(pg_engine) as client:
        responses = (
            client.post(
                f"/api/v1/shared-games/{case.share_token}/applications",
                headers={"Idempotency-Key": APPLY_KEY},
                json=_application_body(),
            ),
            client.get(f"/api/v1/games/{case.game_id}/applications"),
            client.post(
                f"/api/v1/games/{case.game_id}/applications/{uuid.uuid4()}/decision",
                headers={"Idempotency-Key": DECISION_KEY},
                json={"decision": "ACCEPT", "expected_version": 1},
            ),
        )

    assert [response.status_code for response in responses] == [401, 401, 401]
    assert {response.json()["error"]["code"] for response in responses} == {
        "AUTH_REQUIRED"
    }


def test_registration_validation_exposes_only_known_first_level_body_fields(
    pg_engine: Engine,
) -> None:
    case = _seed_published_game(pg_engine)
    _attach_sessions(pg_engine, case)

    with _client(pg_engine) as client:
        invalid_apply = client.post(
            f"/api/v1/shared-games/{case.share_token}/applications",
            headers=_idempotent(APPLY_KEY),
            json={
                "display_name": "x",
                "position": "SECRET_POSITION",
                "note": None,
                "adult_confirmed": False,
                "risk_confirmed": False,
                "unexpected": {"secret": "must-not-echo"},
            },
        )
        invalid_decision = client.post(
            f"/api/v1/games/{case.game_id}/applications/{uuid.uuid4()}/decision",
            headers=_idempotent(DECISION_KEY, token=OWNER_TOKEN),
            json={
                "decision": "SECRET_DECISION",
                "expected_version": 0,
                "unexpected": "must-not-echo",
            },
        )
        missing_waitlist_decision = client.post(
            f"/api/v1/games/{case.game_id}/applications/{uuid.uuid4()}/decision",
            headers=_idempotent(
                "registration-api-unopened-waitlist-01",
                token=OWNER_TOKEN,
            ),
            json={"decision": "WAITLIST", "expected_version": 1},
        )
        missing_waitlist_withdrawal = client.post(
            f"/api/v1/open-game-applications/{uuid.uuid4()}/withdraw",
            headers=_idempotent("registration-api-unopened-withdraw-01"),
            json={"action": "WITHDRAW_WAITLIST", "expected_version": 1},
        )
        invalid_path = client.post(
            "/api/v1/games/not-a-uuid/applications/not-a-uuid/decision",
            headers=_idempotent(DECISION_KEY, token=OWNER_TOKEN),
            json={"decision": "ACCEPT", "expected_version": 1},
        )
        missing_key = client.post(
            f"/api/v1/shared-games/{case.share_token}/applications",
            headers=_auth(),
            json=_application_body(),
        )

    assert invalid_apply.status_code == invalid_decision.status_code == 422
    assert missing_waitlist_decision.status_code == 404
    assert missing_waitlist_decision.json()["error"]["code"] == "APPLICATION_NOT_FOUND"
    assert missing_waitlist_withdrawal.status_code == 404
    assert missing_waitlist_withdrawal.json()["error"]["code"] == "APPLICATION_NOT_FOUND"
    apply_details = invalid_apply.json()["error"]["details"]
    decision_details = invalid_decision.json()["error"]["details"]
    assert {item["field"] for item in apply_details["fields"]} == {
        "display_name",
        "position",
        "adult_confirmed",
        "risk_confirmed",
    }
    assert {item["field"] for item in decision_details["fields"]} == {
        "decision",
        "expected_version",
    }
    for response in (invalid_apply, invalid_decision):
        details = response.json()["error"]["details"]
        assert all(set(item) == {"field", "message"} for item in details["fields"])
        assert "must-not-echo" not in response.text
        assert not {"input", "msg", "ctx"} & _all_keys(response.json())
    assert invalid_path.status_code == missing_key.status_code == 422
    assert invalid_path.json()["error"]["details"] == {}
    assert missing_key.json()["error"]["details"] == {}
    with Session(pg_engine) as session:
        assert session.scalar(
            select(func.count()).select_from(OpenGameRegistration)
        ) == 0
        assert session.scalar(select(func.count()).select_from(IdempotencyRecord)) == 0


def test_owner_and_application_relationships_are_hidden_by_symmetric_404s(
    pg_engine: Engine,
) -> None:
    case = _seed_published_game(pg_engine)
    _attach_sessions(pg_engine, case)
    with _client(pg_engine) as client:
        applied = client.post(
            f"/api/v1/shared-games/{case.share_token}/applications",
            headers=_idempotent(APPLY_KEY),
            json=_application_body(),
        )
        assert applied.status_code == 201, applied.text
        with Session(pg_engine) as session:
            target_id = session.scalar(select(OpenGameRegistration.id))
            assert target_id is not None

        foreign_queue = client.get(
            f"/api/v1/games/{case.game_id}/applications",
            headers=_auth(),
        )
        missing_queue = client.get(
            f"/api/v1/games/{uuid.uuid4()}/applications",
            headers=_auth(OWNER_TOKEN),
        )
        foreign_decision = client.post(
            f"/api/v1/games/{case.game_id}/applications/{target_id}/decision",
            headers=_idempotent(DECISION_KEY),
            json={"decision": "ACCEPT", "expected_version": 1},
        )
        missing_application = client.post(
            f"/api/v1/games/{case.game_id}/applications/{uuid.uuid4()}/decision",
            headers=_idempotent(DECISION_KEY, token=OWNER_TOKEN),
            json={"decision": "ACCEPT", "expected_version": 1},
        )

    assert [(foreign_queue.status_code, foreign_queue.json()["error"]["code"]),
            (missing_queue.status_code, missing_queue.json()["error"]["code"])] == [
        (404, "OPEN_GAME_NOT_FOUND"),
        (404, "OPEN_GAME_NOT_FOUND"),
    ]
    assert (foreign_decision.status_code, foreign_decision.json()["error"]["code"]) == (
        404,
        "OPEN_GAME_NOT_FOUND",
    )
    assert (
        missing_application.status_code,
        missing_application.json()["error"]["code"],
    ) == (404, "APPLICATION_NOT_FOUND")


def test_apply_conflicts_keep_exact_closed_codes_and_details(pg_engine: Engine) -> None:
    case = _seed_published_game(pg_engine)
    _attach_sessions(pg_engine, case)

    with _client(pg_engine) as client:
        first = client.post(
            f"/api/v1/shared-games/{case.share_token}/applications",
            headers=_idempotent(APPLY_KEY),
            json=_application_body(),
        )
        assert first.status_code == 201
        duplicate = client.post(
            f"/api/v1/shared-games/{case.share_token}/applications",
            headers=_idempotent("registration-api-duplicate-key-001"),
            json=_application_body(),
        )
        reused = client.post(
            f"/api/v1/shared-games/{case.share_token}/applications",
            headers=_idempotent(APPLY_KEY),
            json=_application_body(display_name="另一个称呼"),
        )
        owner_blocked = client.post(
            f"/api/v1/shared-games/{case.share_token}/applications",
            headers=_idempotent(
                "registration-api-owner-blocked-001", token=OWNER_TOKEN
            ),
            json=_application_body(display_name="队长本人"),
        )

    assert (duplicate.status_code, _error(duplicate)) == (
        409,
        {
            "code": "APPLICATION_ALREADY_EXISTS",
            "message": "你已申请过本场球局，请刷新查看当前结果。",
            "details": {},
        },
    )
    assert (reused.status_code, _error(reused)) == (
        409,
        {
            "code": "IDEMPOTENCY_KEY_REUSED",
            "message": "该幂等键已用于其他请求，请生成新键后重试。",
            "details": {},
        },
    )
    assert owner_blocked.status_code == 409
    assert _error(owner_blocked) == {
        "code": "APPLICATION_NOT_ALLOWED",
        "message": "当前球局暂不允许提交申请。",
        "details": {
            "apply_blocked_reason": "OWNER_CANNOT_APPLY",
            "remaining_spots": 4,
        },
    }


def test_decision_conflicts_keep_exact_closed_codes_and_details(
    pg_engine: Engine,
) -> None:
    case = _seed_published_game(pg_engine)
    _attach_sessions(pg_engine, case)
    with _client(pg_engine) as client:
        applied = client.post(
            f"/api/v1/shared-games/{case.share_token}/applications",
            headers=_idempotent(APPLY_KEY),
            json=_application_body(),
        )
        assert applied.status_code == 201
        with Session(pg_engine) as session:
            target = session.scalar(select(OpenGameRegistration))
            assert target is not None
            game = session.get_one(OpenGame, case.game_id)
            game.open_spots = 1
            joined = _new_user(session, "api-capacity")
            _add_registration(
                session,
                game_id=case.game_id,
                applicant_user_id=joined.id,
                status=OpenGameRegistrationStatus.JOINED,
                decided_by_user_id=case.booking.owner_id,
            )
            session.commit()
            target_id = target.id

        capacity = client.post(
            f"/api/v1/games/{case.game_id}/applications/{target_id}/decision",
            headers=_idempotent(
                "registration-api-capacity-key-0001", token=OWNER_TOKEN
            ),
            json={"decision": "ACCEPT", "expected_version": 1},
        )
        state = client.post(
            f"/api/v1/games/{case.game_id}/applications/{target_id}/decision",
            headers=_idempotent("registration-api-state-key-000001", token=OWNER_TOKEN),
            json={"decision": "REJECT", "expected_version": 2},
        )
        rejected = client.post(
            f"/api/v1/games/{case.game_id}/applications/{target_id}/decision",
            headers=_idempotent(DECISION_KEY, token=OWNER_TOKEN),
            json={"decision": "REJECT", "expected_version": 1},
        )
        assert rejected.status_code == 200
        reused = client.post(
            f"/api/v1/games/{case.game_id}/applications/{target_id}/decision",
            headers=_idempotent(DECISION_KEY, token=OWNER_TOKEN),
            json={"decision": "ACCEPT", "expected_version": 1},
        )

    assert capacity.status_code == 409
    assert _error(capacity) == {
        "code": "APPLICATION_CAPACITY_CHANGED",
        "message": "剩余名额已变化，请刷新报名队列。",
        "details": {
            "remaining_spots": 0,
            "allowed_actions": {
                "can_accept": False,
                "accept_blocked_reason": "GAME_FULL",
                "can_waitlist": True,
                "waitlist_blocked_reason": None,
                "can_reject": True,
                "reject_blocked_reason": None,
            },
        },
    }
    assert (state.status_code, state.json()["error"]["code"], state.json()["error"]["details"]) == (
        409,
        "APPLICATION_STATE_CHANGED",
        {},
    )
    assert (
        reused.status_code,
        reused.json()["error"]["code"],
        reused.json()["error"]["details"],
    ) == (
        409,
        "IDEMPOTENCY_KEY_REUSED",
        {},
    )


def test_optional_and_required_auth_database_failures_rollback_to_safe_503() -> None:
    class FailingAuthDatabase:
        rollback_calls = 0

        def scalar(self, _statement: object) -> object:
            raise SQLAlchemyError("injected secret auth failure")

        def rollback(self) -> None:
            self.rollback_calls += 1

    database = FailingAuthDatabase()
    app = create_app(
        settings=Settings(app_env="test", wechat_provider="development")
    )
    app.dependency_overrides[get_database] = lambda: database

    with TestClient(app, raise_server_exceptions=False) as client:
        optional = client.get(
            f"/api/v1/shared-games/{'R' * 32}/registration-context",
            headers=_auth(),
        )
        required = client.get(
            f"/api/v1/games/{uuid.uuid4()}/applications",
            headers=_auth(OWNER_TOKEN),
        )

    for response in (optional, required):
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "SERVICE_UNAVAILABLE"
        assert response.json()["error"]["details"] == {}
        assert "secret" not in response.text
    assert database.rollback_calls == 2


def test_registration_read_failure_is_safe_and_does_not_change_rows(
    pg_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        before_b1 = _b1_snapshot(session)
        before_c1a = _c1a_snapshot(session)

    def fail_read(self: OpenGameRegistrationRepository, *, game_id: uuid.UUID) -> int:
        raise SQLAlchemyError(f"injected secret registration read {game_id}")

    monkeypatch.setattr(OpenGameRegistrationRepository, "count_joined", fail_read)
    with _client(pg_engine) as client:
        response = client.get(
            f"/api/v1/shared-games/{case.share_token}/registration-context"
        )

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "SERVICE_UNAVAILABLE"
    assert response.json()["error"]["details"] == {}
    assert "secret" not in response.text
    with Session(pg_engine) as session:
        assert _b1_snapshot(session) == before_b1
        assert _c1a_snapshot(session) == before_c1a


def test_registration_mutation_flush_failure_is_safe_and_rolls_back_all_rows(
    pg_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    case = _seed_published_game(pg_engine)
    _attach_sessions(pg_engine, case)
    with Session(pg_engine) as session:
        before_b1 = _b1_snapshot(session)
        before_c1a = _c1a_snapshot(session)

    original_add = OpenGameRegistrationRepository.add_registration

    def fail_after_flush(
        self: OpenGameRegistrationRepository,
        registration: OpenGameRegistration,
    ) -> None:
        original_add(self, registration)
        raise SQLAlchemyError("injected secret registration flush failure")

    monkeypatch.setattr(
        OpenGameRegistrationRepository,
        "add_registration",
        fail_after_flush,
    )
    with _client(pg_engine) as client:
        response = client.post(
            f"/api/v1/shared-games/{case.share_token}/applications",
            headers=_idempotent(APPLY_KEY),
            json=_application_body(),
        )

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "SERVICE_UNAVAILABLE"
    assert response.json()["error"]["details"] == {}
    assert "secret" not in response.text
    with Session(pg_engine) as session:
        assert _b1_snapshot(session) == before_b1
        assert _c1a_snapshot(session) == before_c1a
        assert session.scalar(select(func.count()).select_from(OpenGameRegistration)) == 0
        assert session.scalar(select(func.count()).select_from(IdempotencyRecord)) == 0
