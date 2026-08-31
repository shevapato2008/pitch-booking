from __future__ import annotations

import base64
import hashlib
import json
import threading
import time
import uuid
from collections.abc import Iterator, Mapping
from datetime import datetime
from typing import Any

import httpx
import pytest
import uvicorn
from sqlalchemy import Engine, func, select
from sqlalchemy import inspect as sqlalchemy_inspect
from sqlalchemy.orm import Session

from backend.app.config import Settings
from backend.app.database import get_database
from backend.app.main import create_app
from backend.app.models import (
    OpenGame,
    OpenGameAttendanceCorrection,
    OpenGameAttendanceStatus,
    OpenGameRegistration,
    Order,
    User,
)
from backend.app.modules.platform_auth.service import SESSION_COOKIE
from backend.tests.test_open_game_attendance_service import (
    _seed_completed_attendance_game,
)

pytestmark = pytest.mark.integration

WECHAT_APP_ID = "wx-platform-attendance-http-test"
CAPTAIN_CODE = "dev-platform-attendance-http-captain"
PLAYER_CODE = "dev-platform-attendance-http-player"
CAPTAIN_ATTENDANCE_KEY = "platform-attendance-http-captain-mark-0001"
CORRECTION_KEY = "platform-attendance-http-correction-0001"
CORRECTION_REASON = "平台已核对现场记录，原到场结果录入错误。"
ADMIN_PRINCIPAL = "platform-attendance-http-admin"
REVIEWER_PRINCIPAL = "platform-attendance-http-reviewer"
ADMIN_TOKEN = "platform-attendance-http-admin-token-000000001"
REVIEWER_TOKEN = "platform-attendance-http-reviewer-token-00001"
CSRF_SECRET = base64.b64encode(bytes(range(32))).decode("ascii")


def _configured_principals() -> str:
    return json.dumps(
        [
            {
                "principal_id": ADMIN_PRINCIPAL,
                "display_name": "到场纠正管理员",
                "token_sha256": hashlib.sha256(ADMIN_TOKEN.encode()).hexdigest(),
                "enabled": True,
                "roles": ["PLATFORM_ADMIN"],
            },
            {
                "principal_id": REVIEWER_PRINCIPAL,
                "display_name": "入驻审核员",
                "token_sha256": hashlib.sha256(REVIEWER_TOKEN.encode()).hexdigest(),
                "enabled": True,
                "roles": ["ONBOARDING_REVIEWER"],
            },
        ],
        ensure_ascii=False,
    )


@pytest.fixture
def attendance_correction_backend_url(pg_engine: Engine) -> Iterator[str]:
    app = create_app(
        settings=Settings(
            app_env="test",
            database_url=pg_engine.url.render_as_string(hide_password=False),
            public_api_base_url=None,
            payment_provider="disabled",
            wechat_app_id=WECHAT_APP_ID,
            wechat_provider="development",
            platform_staff_principals_json=_configured_principals(),
            platform_csrf_secret=CSRF_SECRET,
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
        name="platform-attendance-correction-http-journey-uvicorn",
        daemon=True,
    )
    deadline = time.monotonic() + 5
    try:
        thread.start()
        with httpx.Client(timeout=0.5, trust_env=False) as probe:
            while True:
                if failures:
                    raise RuntimeError(
                        "local attendance correction Uvicorn server failed to start"
                    ) from failures[0]
                if not thread.is_alive():
                    raise RuntimeError(
                        "local attendance correction Uvicorn server exited before startup"
                    )
                try:
                    health = probe.get(f"{base_url}/api/v1/health")
                    if health.status_code == 200:
                        break
                except httpx.TransportError:
                    pass
                if time.monotonic() >= deadline:
                    raise RuntimeError(
                        "local attendance correction Uvicorn health check timed out"
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
            raise RuntimeError(
                "local attendance correction Uvicorn server did not stop"
            )
        if failures:
            raise RuntimeError(
                "local attendance correction Uvicorn server failed"
            ) from failures[0]


def _development_openid(code: str) -> str:
    suffix = hashlib.sha256(code.encode()).hexdigest()[:32]
    return f"dev-openid-{suffix}"


def _wechat_login(
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


def _platform_login(
    client: httpx.Client,
    *,
    access_token: str,
    origin: str,
) -> tuple[str, str]:
    response = client.post(
        "/platform-admin/api/v1/auth/session",
        headers={"Origin": origin},
        json={"access_token": access_token},
    )
    assert response.status_code == 200, response.text
    csrf_token = response.json()["csrf_token"]
    raw_cookie = response.cookies.get(SESSION_COOKIE)
    assert isinstance(csrf_token, str) and csrf_token
    assert isinstance(raw_cookie, str) and raw_cookie
    # Platform cookies are intentionally Secure. A real HTTP localhost journey
    # must copy it explicitly instead of weakening the production cookie policy.
    return csrf_token, f"{SESSION_COOKIE}={raw_cookie}"


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _all_keys(value: Any) -> set[str]:
    if isinstance(value, Mapping):
        return {str(key) for key in value} | {
            key for child in value.values() for key in _all_keys(child)
        }
    if isinstance(value, list):
        return {key for child in value for key in _all_keys(child)}
    return set()


def _column_snapshot(value: object) -> dict[str, object]:
    inspected = sqlalchemy_inspect(value)
    assert inspected is not None
    return {
        attribute.key: getattr(value, attribute.key)
        for attribute in inspected.mapper.column_attrs
    }


def _parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def test_platform_correction_is_visible_to_captain_and_player_over_real_http(
    pg_engine: Engine,
    attendance_correction_backend_url: str,
) -> None:
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
        session.commit()

        game_before = _column_snapshot(
            session.get_one(OpenGame, seeded.game.game_id)
        )
        order_before = _column_snapshot(
            session.get_one(Order, seeded.game.booking.order_id)
        )
        player_id = player.id

    roster_path = f"/api/v1/games/{seeded.game.game_id}/attendance-roster"
    mark_path = (
        f"/api/v1/games/{seeded.game.game_id}/registrations/"
        f"{registration_id}/attendance"
    )
    context_path = (
        f"/api/v1/shared-games/{seeded.game.share_token}/registration-context"
    )
    detail_path = (
        "/platform-admin/api/v1/attendance/registrations/"
        f"{registration_id}"
    )
    correction_path = f"{detail_path}/corrections"
    origin = attendance_correction_backend_url

    with httpx.Client(
        base_url=attendance_correction_backend_url,
        timeout=5,
        trust_env=False,
    ) as client:
        captain_token = _wechat_login(
            client,
            code=CAPTAIN_CODE,
            expected_user_id=seeded.owner_id,
        )
        player_token = _wechat_login(
            client,
            code=PLAYER_CODE,
            expected_user_id=player_id,
        )
        marked = client.post(
            mark_path,
            headers={
                **_auth(captain_token),
                "Idempotency-Key": CAPTAIN_ATTENDANCE_KEY,
            },
            json={"attendance_status": "PRESENT", "expected_version": 2},
        )
        assert marked.status_code == 200, marked.text
        marked_payload = marked.json()
        assert marked_payload["attendance_status"] == "PRESENT"
        original_recorded_at = marked_payload["attendance_recorded_at"]

        _reviewer_csrf, reviewer_cookie = _platform_login(
            client,
            access_token=REVIEWER_TOKEN,
            origin=origin,
        )
        reviewer_hidden = client.get(
            detail_path,
            headers={"Cookie": reviewer_cookie},
        )
        assert reviewer_hidden.status_code == 403, reviewer_hidden.text
        assert reviewer_hidden.json()["error"]["code"] == "PLATFORM_ROLE_REQUIRED"

        admin_csrf, admin_cookie = _platform_login(
            client,
            access_token=ADMIN_TOKEN,
            origin=origin,
        )
        before = client.get(detail_path, headers={"Cookie": admin_cookie})
        assert before.status_code == 200, before.text
        assert before.json()["original_attendance_status"] == "PRESENT"
        assert before.json()["attendance_status"] == "PRESENT"
        assert before.json()["attendance_recorded_at"] == original_recorded_at
        assert before.json()["version"] == 3
        assert before.json()["corrections"] == []

        correction_body = {
            "attendance_status": "NO_SHOW",
            "expected_version": 3,
            "reason": CORRECTION_REASON,
        }
        correction_headers = {
            "Cookie": admin_cookie,
            "Origin": origin,
            "X-CSRF-Token": admin_csrf,
            "Idempotency-Key": CORRECTION_KEY,
        }
        corrected = client.post(
            correction_path,
            headers=correction_headers,
            json=correction_body,
        )
        replay = client.post(
            correction_path,
            headers=correction_headers,
            json=correction_body,
        )
        assert corrected.status_code == 200, corrected.text
        assert corrected.json()["from_status"] == "PRESENT"
        assert corrected.json()["to_status"] == "NO_SHOW"
        assert replay.status_code == 200, replay.text
        assert replay.content == corrected.content

        after = client.get(detail_path, headers={"Cookie": admin_cookie})
        roster = client.get(roster_path, headers=_auth(captain_token))
        context = client.get(context_path, headers=_auth(player_token))

    assert after.status_code == 200, after.text
    assert after.json()["original_attendance_status"] == "PRESENT"
    assert after.json()["attendance_status"] == "NO_SHOW"
    assert after.json()["attendance_recorded_at"] == original_recorded_at
    assert after.json()["version"] == 4
    assert after.json()["corrections"] == [corrected.json()]
    corrected_at = corrected.json()["corrected_at"]

    assert roster.status_code == 200, roster.text
    roster_item = next(
        item
        for item in roster.json()["registrations"]
        if item["registration_id"] == str(registration_id)
    )
    assert roster_item["attendance_status"] == "NO_SHOW"
    assert roster_item["attendance_recorded_at"] == original_recorded_at
    assert roster_item["attendance_corrected_at"] == corrected_at

    assert context.status_code == 200, context.text
    viewer_registration = context.json()["viewer_registration"]
    assert viewer_registration["id"] == str(registration_id)
    assert viewer_registration["attendance_status"] == "NO_SHOW"
    assert viewer_registration["attendance_recorded_at"] == original_recorded_at
    assert viewer_registration["attendance_corrected_at"] == corrected_at

    for response in (roster, context):
        serialized = response.text
        assert CORRECTION_REASON not in serialized
        assert ADMIN_PRINCIPAL not in serialized
        assert not {
            "corrections",
            "correction_history",
            "corrected_by_principal_id",
            "reason",
            "registration_version_before",
            "registration_version_after",
        } & _all_keys(response.json())

    with Session(pg_engine) as session:
        registration = session.get_one(OpenGameRegistration, registration_id)
        events = tuple(
            session.scalars(
                select(OpenGameAttendanceCorrection).where(
                    OpenGameAttendanceCorrection.registration_id
                    == registration_id
                )
            )
        )
        assert session.scalar(
            select(func.count()).select_from(OpenGameAttendanceCorrection)
        ) == 1
        assert len(events) == 1
        assert events[0].from_status is OpenGameAttendanceStatus.PRESENT
        assert events[0].to_status is OpenGameAttendanceStatus.NO_SHOW
        assert events[0].reason == CORRECTION_REASON
        assert events[0].corrected_by_principal_id == ADMIN_PRINCIPAL
        assert events[0].corrected_at == _parse_time(corrected_at)
        assert registration.attendance_status is OpenGameAttendanceStatus.NO_SHOW
        assert registration.attendance_recorded_at == _parse_time(
            original_recorded_at
        )
        assert registration.attendance_recorded_by_user_id == seeded.owner_id
        assert registration.version == 4
        assert _column_snapshot(
            session.get_one(OpenGame, seeded.game.game_id)
        ) == game_before
        assert _column_snapshot(
            session.get_one(Order, seeded.game.booking.order_id)
        ) == order_before
