import hashlib
import threading
import time
import uuid
from collections.abc import Iterator, Mapping
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
import uvicorn
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session

from backend.app.config import Settings
from backend.app.database import get_database
from backend.app.main import create_app
from backend.app.models import (
    OpenGameRegistration,
    OpenGameRegistrationStatus,
    OpenGameStatus,
    Payment,
    RefundAttempt,
    RefundCase,
    User,
)
from backend.app.modules.open_game_registrations.privacy import (
    CAPTAIN_APPLICATION_FIELDS,
    VIEWER_REGISTRATION_FIELDS,
)
from backend.app.modules.open_games.privacy import PUBLIC_OPEN_GAME_FIELDS
from backend.tests.test_open_game_registration_service import (
    SeededRegistrationCase,
    _b1_snapshot,
)
from backend.tests.test_open_game_service import (
    add_stored_game,
    seed_confirmed_order,
)

pytestmark = pytest.mark.integration

CAPTAIN_CODE = "dev-registration-http-captain"
ACCEPTED_CODE = "dev-registration-http-accepted"
REJECTED_CODE = "dev-registration-http-rejected"
WECHAT_APP_ID = "wx-open-game-registration-test"
SHARE_TOKEN = "H" * 32
ACCEPTED_APPLY_KEY = "http-registration-accepted-apply-001"
ACCEPT_DECISION_KEY = "http-registration-accept-decision-01"
EXIT_KEY = "http-registration-joined-exit-key-0001"
REJECTED_APPLY_KEY = "http-registration-rejected-apply-001"
REJECT_DECISION_KEY = "http-registration-reject-decision-01"


@pytest.fixture
def registration_backend_url(pg_engine: Engine) -> Iterator[str]:
    app = create_app(
        settings=Settings(
            app_env="test",
            database_url=pg_engine.url.render_as_string(hide_password=False),
            payment_provider="disabled",
            wechat_app_id=WECHAT_APP_ID,
            wechat_provider="development",
        )
    )

    def database_override() -> Iterator[Session]:
        with Session(pg_engine) as session:
            yield session

    app.dependency_overrides[get_database] = database_override
    config = uvicorn.Config(
        app,
        host="127.0.0.1",
        port=0,
        access_log=False,
        log_level="warning",
        lifespan="on",
    )
    server = uvicorn.Server(config)
    listener = config.bind_socket()
    port = listener.getsockname()[1]
    base_url = f"http://127.0.0.1:{port}"
    failures: list[BaseException] = []

    def serve() -> None:
        try:
            server.run(sockets=[listener])
        except BaseException as error:
            failures.append(error)

    thread = threading.Thread(
        target=serve,
        name="open-game-registration-http-journey-uvicorn",
        daemon=True,
    )
    deadline = time.monotonic() + 5
    try:
        thread.start()
        with httpx.Client(timeout=0.5, trust_env=False) as probe:
            while True:
                if failures:
                    raise RuntimeError(
                        "local registration Uvicorn server failed to start"
                    ) from failures[0]
                if not thread.is_alive():
                    raise RuntimeError(
                        "local registration Uvicorn server exited before startup"
                    )
                try:
                    health = probe.get(f"{base_url}/api/v1/health")
                    if health.status_code == 200:
                        break
                except httpx.TransportError:
                    pass
                if time.monotonic() >= deadline:
                    raise RuntimeError(
                        "local registration Uvicorn health check timed out"
                    )
                time.sleep(0.01)
        yield base_url
    finally:
        server.should_exit = True
        if thread.ident is not None:
            thread.join(timeout=5)
        listener.close()
        app.dependency_overrides.clear()
        if thread.is_alive():
            raise RuntimeError("local registration Uvicorn server did not stop")
        if failures:
            raise RuntimeError("local registration Uvicorn server failed") from failures[0]


def _development_openid(code: str) -> str:
    suffix = hashlib.sha256(code.encode()).hexdigest()[:32]
    return f"dev-openid-{suffix}"


def _seed_three_identities(
    engine: Engine,
) -> tuple[SeededRegistrationCase, uuid.UUID]:
    booking = seed_confirmed_order(
        engine,
        starts_at=datetime.now(UTC) + timedelta(days=3),
    )
    with Session(engine) as session:
        captain = session.get_one(User, booking.owner_id)
        accepted = session.get_one(User, booking.stranger_id)
        rejected = User(
            wechat_app_id=WECHAT_APP_ID,
            wechat_openid=_development_openid(REJECTED_CODE),
        )
        captain.wechat_app_id = WECHAT_APP_ID
        captain.wechat_openid = _development_openid(CAPTAIN_CODE)
        accepted.wechat_app_id = WECHAT_APP_ID
        accepted.wechat_openid = _development_openid(ACCEPTED_CODE)
        session.add(rejected)
        session.flush()
        game = add_stored_game(
            session,
            seeded=booking,
            status=OpenGameStatus.PUBLISHED,
            share_token=SHARE_TOKEN,
        )
        session.commit()
        case = SeededRegistrationCase(
            booking=booking,
            game_id=game.id,
            share_token=SHARE_TOKEN,
        )
        return case, rejected.id


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _idempotent(key: str, *, token: str) -> dict[str, str]:
    return {**_auth(token), "Idempotency-Key": key}


def _application_body(display_name: str) -> dict[str, object]:
    return {
        "display_name": display_name,
        "position": "ANY",
        "note": "周末可准时到场。",
        "adult_confirmed": True,
        "risk_confirmed": True,
    }


def _all_keys(value: Any) -> set[str]:
    if isinstance(value, Mapping):
        return {str(key) for key in value} | {
            key for child in value.values() for key in _all_keys(child)
        }
    if isinstance(value, list):
        return {key for child in value for key in _all_keys(child)}
    return set()


def _assert_context(
    response: httpx.Response,
    *,
    sensitive_user_ids: set[uuid.UUID],
) -> dict[str, Any]:
    assert response.status_code == 200, response.text
    payload = response.json()
    assert set(payload) == {
        "game",
        "remaining_spots",
        "viewer_authenticated",
        "viewer_registration",
        "allowed_actions",
    }
    assert set(payload["game"]) == PUBLIC_OPEN_GAME_FIELDS
    assert set(payload["allowed_actions"]) == {
        "can_apply",
        "apply_blocked_reason",
    }
    if payload["viewer_registration"] is not None:
        assert set(payload["viewer_registration"]) == VIEWER_REGISTRATION_FIELDS
    assert not {
        "applicant_user_id",
        "decided_by_user_id",
        "consent_version",
        "adult_confirmed_at",
        "risk_confirmed_at",
    } & _all_keys(payload)
    assert all(str(user_id) not in response.text for user_id in sensitive_user_ids)
    return payload


def _assert_queue(
    response: httpx.Response,
    *,
    sensitive_user_ids: set[uuid.UUID],
) -> dict[str, Any]:
    assert response.status_code == 200, response.text
    payload = response.json()
    assert set(payload) == {"remaining_spots", "pending_count", "applications"}
    assert payload["pending_count"] == len(payload["applications"])
    for application in payload["applications"]:
        assert set(application) == CAPTAIN_APPLICATION_FIELDS
        assert set(application["allowed_actions"]) == {
            "can_accept",
            "accept_blocked_reason",
            "can_reject",
            "reject_blocked_reason",
        }
    assert not {
        "applicant_user_id",
        "decided_by_user_id",
        "consent_version",
        "adult_confirmed_at",
        "risk_confirmed_at",
    } & _all_keys(payload)
    assert all(str(user_id) not in response.text for user_id in sensitive_user_ids)
    return payload


def _login(client: httpx.Client, code: str, expected_user_id: uuid.UUID) -> str:
    response = client.post("/api/v1/auth/wechat/session", json={"code": code})
    assert response.status_code == 200, response.text
    assert response.json()["user"]["id"] == str(expected_user_id)
    token = response.json()["session_token"]
    assert isinstance(token, str) and token
    return token


def test_three_identity_registration_journey_runs_over_real_http_without_changing_b1(
    pg_engine: Engine,
    registration_backend_url: str,
) -> None:
    case, rejected_user_id = _seed_three_identities(pg_engine)
    sensitive_user_ids = {
        case.booking.owner_id,
        case.booking.stranger_id,
        rejected_user_id,
    }
    with Session(pg_engine) as session:
        baseline = _b1_snapshot(session)
        assert session.scalar(select(func.count()).select_from(Payment)) == 1
        assert session.scalar(select(func.count()).select_from(RefundCase)) == 0
        assert session.scalar(select(func.count()).select_from(RefundAttempt)) == 0

    with httpx.Client(
        base_url=registration_backend_url,
        timeout=5.0,
        trust_env=False,
    ) as client:
        anonymous = _assert_context(
            client.get(
                f"/api/v1/shared-games/{case.share_token}/registration-context"
            ),
            sensitive_user_ids=sensitive_user_ids,
        )
        assert anonymous["viewer_authenticated"] is False
        assert anonymous["viewer_registration"] is None
        assert anonymous["allowed_actions"] == {
            "can_apply": False,
            "apply_blocked_reason": "AUTH_REQUIRED",
        }

        accepted_token = _login(
            client,
            ACCEPTED_CODE,
            case.booking.stranger_id,
        )
        accepted_apply = client.post(
            f"/api/v1/shared-games/{case.share_token}/applications",
            headers=_idempotent(ACCEPTED_APPLY_KEY, token=accepted_token),
            json=_application_body("接受球员"),
        )
        assert accepted_apply.status_code == 201, accepted_apply.text
        assert accepted_apply.json()["viewer_registration"]["persisted_status"] == (
            "APPLIED"
        )
        accepted_replay = client.post(
            f"/api/v1/shared-games/{case.share_token}/applications",
            headers=_idempotent(ACCEPTED_APPLY_KEY, token=accepted_token),
            json=_application_body("接受球员"),
        )
        assert accepted_replay.status_code == 201, accepted_replay.text
        assert accepted_replay.content == accepted_apply.content

        captain_token = _login(client, CAPTAIN_CODE, case.booking.owner_id)
        accepted_queue = _assert_queue(
            client.get(
                f"/api/v1/games/{case.game_id}/applications",
                headers=_auth(captain_token),
            ),
            sensitive_user_ids=sensitive_user_ids,
        )
        assert accepted_queue["pending_count"] == 1
        accepted_application_id = accepted_queue["applications"][0]["id"]
        accepted_decision = client.post(
            f"/api/v1/games/{case.game_id}/applications/{accepted_application_id}/decision",
            headers=_idempotent(ACCEPT_DECISION_KEY, token=captain_token),
            json={"decision": "ACCEPT", "expected_version": 1},
        )
        assert accepted_decision.status_code == 200, accepted_decision.text
        assert accepted_decision.json()["status"] == "JOINED"
        accepted_decision_replay = client.post(
            f"/api/v1/games/{case.game_id}/applications/{accepted_application_id}/decision",
            headers=_idempotent(ACCEPT_DECISION_KEY, token=captain_token),
            json={"decision": "ACCEPT", "expected_version": 1},
        )
        assert accepted_decision_replay.status_code == 200
        assert accepted_decision_replay.content == accepted_decision.content

        joined = _assert_context(
            client.get(
                f"/api/v1/shared-games/{case.share_token}/registration-context",
                headers=_auth(accepted_token),
            ),
            sensitive_user_ids=sensitive_user_ids,
        )
        assert joined["viewer_registration"]["persisted_status"] == "JOINED"
        assert joined["viewer_registration"]["effective_status"] == "JOINED"
        assert joined["viewer_registration"]["available_withdrawal_action"] == (
            "LEAVE_GAME"
        )

        exited = client.post(
            (
                "/api/v1/open-game-applications/"
                f"{accepted_application_id}/withdraw"
            ),
            headers=_idempotent(EXIT_KEY, token=accepted_token),
            json={"action": "LEAVE_GAME", "expected_version": 2},
        )
        exited_replay = client.post(
            (
                "/api/v1/open-game-applications/"
                f"{accepted_application_id}/withdraw"
            ),
            headers=_idempotent(EXIT_KEY, token=accepted_token),
            json={"action": "LEAVE_GAME", "expected_version": 2},
        )
        exited_body = _assert_context(
            exited,
            sensitive_user_ids=sensitive_user_ids,
        )
        assert exited_replay.status_code == 200
        assert exited_replay.content == exited.content
        assert exited_body["viewer_registration"]["persisted_status"] == "WITHDRAWN"
        assert exited_body["viewer_registration"]["withdrawal_kind"] == "GAME_EXIT"
        assert exited_body["viewer_registration"]["version"] == 3
        assert exited_body["remaining_spots"] == 4

        rejected_token = _login(client, REJECTED_CODE, rejected_user_id)
        rejected_apply = client.post(
            f"/api/v1/shared-games/{case.share_token}/applications",
            headers=_idempotent(REJECTED_APPLY_KEY, token=rejected_token),
            json=_application_body("婉拒球员"),
        )
        assert rejected_apply.status_code == 201, rejected_apply.text
        rejected_queue = _assert_queue(
            client.get(
                f"/api/v1/games/{case.game_id}/applications",
                headers=_auth(captain_token),
            ),
            sensitive_user_ids=sensitive_user_ids,
        )
        assert rejected_queue["pending_count"] == 1
        rejected_application_id = rejected_queue["applications"][0]["id"]
        rejected_decision = client.post(
            f"/api/v1/games/{case.game_id}/applications/{rejected_application_id}/decision",
            headers=_idempotent(REJECT_DECISION_KEY, token=captain_token),
            json={"decision": "REJECT", "expected_version": 1},
        )
        assert rejected_decision.status_code == 200, rejected_decision.text
        assert rejected_decision.json()["status"] == "REJECTED"

        rejected = _assert_context(
            client.get(
                f"/api/v1/shared-games/{case.share_token}/registration-context",
                headers=_auth(rejected_token),
            ),
            sensitive_user_ids=sensitive_user_ids,
        )
        assert rejected["viewer_registration"]["persisted_status"] == "REJECTED"
        assert rejected["viewer_registration"]["effective_status"] == "REJECTED"

    with Session(pg_engine) as session:
        assert _b1_snapshot(session) == baseline
        statuses = tuple(
            session.scalars(
                select(OpenGameRegistration.status).order_by(
                    OpenGameRegistration.applied_at,
                    OpenGameRegistration.id,
                )
            )
        )
        assert set(statuses) == {
            OpenGameRegistrationStatus.WITHDRAWN,
            OpenGameRegistrationStatus.REJECTED,
        }
        assert len(statuses) == 2
        assert session.scalar(select(func.count()).select_from(Payment)) == 1
        assert session.scalar(select(func.count()).select_from(RefundCase)) == 0
        assert session.scalar(select(func.count()).select_from(RefundAttempt)) == 0
