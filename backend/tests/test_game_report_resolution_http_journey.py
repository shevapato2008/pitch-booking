from __future__ import annotations

import base64
import hashlib
import json
import threading
import time
import uuid
from collections.abc import Iterator

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
    OpenGameCancellationSource,
    OpenGameRegistrationStatus,
    OpenGameReport,
    OpenGameReportResolution,
    OpenGameReportResolutionOutcome,
    OpenGameStatus,
    Order,
    Payment,
    RefundAttempt,
    RefundCase,
    User,
)
from backend.app.modules.platform_auth.service import SESSION_COOKIE
from backend.tests.test_open_game_registration_api import _seed_published_game
from backend.tests.test_open_game_registration_service import _add_registration

pytestmark = pytest.mark.integration

WECHAT_APP_ID = "wx-game-report-http-test"
PLAYER_CODE = "dev-game-report-http-player"
ADMIN_PRINCIPAL = "game-report-http-admin"
ADMIN_TOKEN = "game-report-http-admin-token-0000000001"
REPORT_KEY = "game-report-http-submit-key-00000001"
RESOLUTION_KEY = "game-report-http-resolution-key-000001"
CSRF_SECRET = base64.b64encode(bytes(range(32))).decode("ascii")


def _configured_principals() -> str:
    return json.dumps(
        [
            {
                "principal_id": ADMIN_PRINCIPAL,
                "display_name": "举报处置管理员",
                "token_sha256": hashlib.sha256(ADMIN_TOKEN.encode()).hexdigest(),
                "enabled": True,
                "roles": ["PLATFORM_ADMIN"],
            }
        ],
        ensure_ascii=False,
    )


@pytest.fixture
def game_report_backend_url(pg_engine: Engine) -> Iterator[str]:
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
    base_url = f"http://127.0.0.1:{listener.getsockname()[1]}"
    failures: list[BaseException] = []

    def serve() -> None:
        try:
            server.run(sockets=[listener])
        except BaseException as error:
            failures.append(error)

    thread = threading.Thread(
        target=serve,
        name="game-report-resolution-http-journey-uvicorn",
        daemon=True,
    )
    deadline = time.monotonic() + 5
    try:
        thread.start()
        with httpx.Client(timeout=0.5, trust_env=False) as probe:
            while True:
                if failures:
                    raise RuntimeError("local game report Uvicorn server failed") from failures[0]
                if not thread.is_alive():
                    raise RuntimeError("local game report Uvicorn server exited early")
                try:
                    if probe.get(f"{base_url}/api/v1/health").status_code == 200:
                        break
                except httpx.TransportError:
                    pass
                if time.monotonic() >= deadline:
                    raise RuntimeError("local game report Uvicorn health check timed out")
                time.sleep(0.01)
        yield base_url
    finally:
        server.should_exit = True
        if thread.ident is not None:
            thread.join(timeout=5)
        listener.close()
        app.dependency_overrides.clear()
        if thread.is_alive():
            raise RuntimeError("local game report Uvicorn server did not stop")
        if failures:
            raise RuntimeError("local game report Uvicorn server failed") from failures[0]


def _development_openid(code: str) -> str:
    return f"dev-openid-{hashlib.sha256(code.encode()).hexdigest()[:32]}"


def _wechat_login(
    client: httpx.Client,
    *,
    expected_user_id: uuid.UUID,
) -> str:
    response = client.post("/api/v1/auth/wechat/session", json={"code": PLAYER_CODE})
    assert response.status_code == 200, response.text
    assert response.json()["user"]["id"] == str(expected_user_id)
    return response.json()["session_token"]


def _platform_login(client: httpx.Client, *, origin: str) -> tuple[str, str]:
    response = client.post(
        "/platform-admin/api/v1/auth/session",
        headers={"Origin": origin},
        json={"access_token": ADMIN_TOKEN},
    )
    assert response.status_code == 200, response.text
    csrf = response.json()["csrf_token"]
    cookie = response.cookies.get(SESSION_COOKIE)
    assert isinstance(csrf, str) and csrf
    assert isinstance(cookie, str) and cookie
    return csrf, f"{SESSION_COOKIE}={cookie}"


def _row(value: object) -> dict[str, object]:
    inspected = sqlalchemy_inspect(value)
    assert inspected is not None
    return {
        attribute.key: getattr(value, attribute.key)
        for attribute in inspected.mapper.column_attrs
    }


def test_report_submission_platform_cancellation_and_readback_over_real_http(
    pg_engine: Engine,
    game_report_backend_url: str,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        player = session.get_one(User, case.booking.stranger_id)
        player.wechat_app_id = WECHAT_APP_ID
        player.wechat_openid = _development_openid(PLAYER_CODE)
        registration = _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=player.id,
            status=OpenGameRegistrationStatus.APPLIED,
            display_name="举报验收球员",
        )
        session.commit()
        registration_id = registration.id
        order_before = _row(session.get_one(Order, case.booking.order_id))
        payment_before = _row(session.get_one(Payment, case.booking.payment_id))

    context_path = f"/api/v1/games/{case.game_id}/my-report"
    submit_path = f"/api/v1/games/{case.game_id}/reports"
    report_body = {
        "category": "EXTRA_CHARGE",
        "facts": "现场要求支付公开说明中未列出的额外场地费用。",
    }
    origin = game_report_backend_url
    with httpx.Client(base_url=origin, timeout=5, trust_env=False) as client:
        player_token = _wechat_login(client, expected_user_id=case.booking.stranger_id)
        player_headers = {"Authorization": f"Bearer {player_token}"}
        before = client.get(context_path, headers=player_headers)
        created = client.post(
            submit_path,
            headers={**player_headers, "Idempotency-Key": REPORT_KEY},
            json=report_body,
        )
        replay = client.post(
            submit_path,
            headers={**player_headers, "Idempotency-Key": REPORT_KEY},
            json=report_body,
        )
        pending_readback = client.get(context_path, headers=player_headers)

        csrf, cookie = _platform_login(client, origin=origin)
        queue = client.get(
            "/platform-admin/api/v1/game-reports?state=PENDING&limit=20",
            headers={"Cookie": cookie},
        )
        report_id = created.json()["report_id"]
        detail_path = f"/platform-admin/api/v1/game-reports/{report_id}"
        detail = client.get(detail_path, headers={"Cookie": cookie})
        resolution_body = {
            "outcome": "CONFIRMED_GAME_CANCELLED",
            "resolution_note": "已核实额外收费事实，取消公开球局；订场订单与退款状态保持不变。",
        }
        resolution_headers = {
            "Cookie": cookie,
            "Origin": origin,
            "X-CSRF-Token": csrf,
            "Idempotency-Key": RESOLUTION_KEY,
        }
        resolved = client.post(
            f"{detail_path}/resolution",
            headers=resolution_headers,
            json=resolution_body,
        )
        resolution_replay = client.post(
            f"{detail_path}/resolution",
            headers=resolution_headers,
            json=resolution_body,
        )
        resolved_detail = client.get(detail_path, headers={"Cookie": cookie})
        player_readback = client.get(context_path, headers=player_headers)

    assert before.status_code == 200, before.text
    assert before.json()["submission_allowed"] is True
    assert before.json()["report"] is None
    assert created.status_code == 201, created.text
    assert replay.status_code == 200, replay.text
    assert replay.content == created.content
    assert created.json()["category"] == report_body["category"]
    assert created.json()["facts"] == report_body["facts"]
    assert pending_readback.status_code == 200, pending_readback.text
    assert pending_readback.json()["report"] == created.json()
    assert pending_readback.json()["submission_blocker"] == "REPORT_ALREADY_EXISTS"

    assert queue.status_code == 200, queue.text
    assert [item["report_id"] for item in queue.json()["items"]] == [report_id]
    assert detail.status_code == 200, detail.text
    assert detail.json()["reporter_display_name"] == "举报验收球员"
    assert detail.json()["target"]["game_id"] == str(case.game_id)
    assert detail.json()["allowed_outcomes"] == [
        "DISMISSED",
        "CONFIRMED_RECORDED",
        "CONFIRMED_GAME_CANCELLED",
    ]
    assert resolved.status_code == 200, resolved.text
    assert resolution_replay.status_code == 200, resolution_replay.text
    assert resolution_replay.content == resolved.content
    assert resolved.json()["outcome"] == "CONFIRMED_GAME_CANCELLED"
    assert resolved.json()["game_version_after"] == resolved.json()["game_version_before"] + 1
    assert resolved_detail.status_code == 200, resolved_detail.text
    assert resolved_detail.json()["status"] == "RESOLVED"
    assert resolved_detail.json()["allowed_outcomes"] == []
    assert resolved_detail.json()["resolution"] == resolved.json()

    assert player_readback.status_code == 200, player_readback.text
    reporter_result = player_readback.json()["report"]
    assert reporter_result["status"] == "RESOLVED"
    assert reporter_result["outcome"] == "CONFIRMED_GAME_CANCELLED"
    assert reporter_result["result_title"] == "举报成立，球局已取消"
    assert reporter_result["result_message"] == (
        "平台已取消公开球局；订场订单和退款状态不因此改变。"
    )

    with Session(pg_engine) as session:
        game = session.get_one(OpenGame, case.game_id)
        assert game.status is OpenGameStatus.CANCELLED
        assert game.cancellation_source is OpenGameCancellationSource.PLATFORM_REPORT
        assert game.version == resolved.json()["game_version_after"]
        report = session.scalar(
            select(OpenGameReport).where(OpenGameReport.id == uuid.UUID(report_id))
        )
        assert report is not None
        assert report.reporter_registration_id == registration_id
        assert report.reporter_user_id == case.booking.stranger_id
        resolution = session.scalar(
            select(OpenGameReportResolution).where(
                OpenGameReportResolution.report_id == report.id
            )
        )
        assert resolution is not None
        assert resolution.outcome is OpenGameReportResolutionOutcome.CONFIRMED_GAME_CANCELLED
        assert resolution.resolved_by_principal_id == ADMIN_PRINCIPAL
        assert resolution.idempotency_key == RESOLUTION_KEY
        assert _row(session.get_one(Order, case.booking.order_id)) == order_before
        assert _row(session.get_one(Payment, case.booking.payment_id)) == payment_before
        assert session.scalar(select(func.count()).select_from(RefundCase)) == 0
        assert session.scalar(select(func.count()).select_from(RefundAttempt)) == 0
