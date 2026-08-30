from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

import pytest

from scripts.verify_open_game_attendance_staging import (
    HttpResponse,
    VerificationReport,
    request_json,
    verify,
)

BASE_URL = "https://pitch-api-staging.modelstella.com"
REVISION = "a" * 40
VENUE_ID = "10000000-0000-4000-8000-000000000001"
ORDER_ID = "20000000-0000-4000-8000-000000000001"
GAME_ID = "30000000-0000-4000-8000-000000000001"
REGISTRATION_ID = "40000000-0000-4000-8000-000000000001"
CAPTAIN_BEARER = "captain-secret-bearer"
PLAYER_BEARER = "player-secret-bearer"
VENUE_BEARER = "venue-secret-bearer"
RECORDED_AT = "2026-08-31T12:06:00+08:00"
SHARE_TOKEN = "C2cStagingAttendanceShareToken01"


class FakeAttendanceStaging:
    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []
        self.completed = False
        self.attendance_status = "UNMARKED"
        self.attendance_version = 2
        self.recorded_at: str | None = None
        self.order_id = ORDER_ID
        self.game_id = GAME_ID
        self.fail_complete = False
        self.mark_version_increment = 1
        self.leak_player_recorder = False
        self.context_after_attendance_status: str | None = None
        self.context_game_name = "C2c staging game"
        self.hide_player_registration = False
        self.player_page = 0

    def request(
        self,
        method: str,
        url: str,
        headers: dict[str, str],
        body: object | None,
    ) -> HttpResponse:
        self.requests.append(
            {"method": method, "url": url, "headers": headers, "body": body}
        )
        parsed = urlsplit(url)
        response_headers = {
            "X-App-Revision": REVISION,
            "X-Request-Id": f"request-{len(self.requests)}",
        }

        if parsed.path == f"/api/v1/games/{GAME_ID}":
            assert method == "GET"
            assert headers == {
                "Accept": "application/json",
                "Authorization": f"Bearer {CAPTAIN_BEARER}",
            }
            return HttpResponse(
                200,
                response_headers,
                {
                    "id": self.game_id,
                    "order_id": self.order_id,
                    "state": "COMPLETED" if self.completed else "PUBLISHED",
                    "share": {
                        "path": (
                            "/pages/captain-game-public/index?token="
                            f"{SHARE_TOKEN}"
                        )
                    },
                    "public_view": self._public_game(),
                    "allowed_actions": {
                        "can_manage_attendance": self.completed,
                    },
                },
            )

        fulfillment_prefix = (
            f"/api/v1/venues/{VENUE_ID}/fulfillment/orders/{ORDER_ID}"
        )
        if parsed.path == f"{fulfillment_prefix}/check-in":
            assert method == "POST"
            assert body is None
            self._assert_mutation_headers(headers, VENUE_BEARER)
            return HttpResponse(
                200,
                response_headers,
                {
                    "id": ORDER_ID,
                    "status": "COMPLETED" if self.completed else "CONFIRMED",
                    "checked_in_at": "2026-08-31T10:55:00+08:00",
                },
            )

        if parsed.path == f"{fulfillment_prefix}/complete":
            assert method == "POST"
            assert body is None
            self._assert_mutation_headers(headers, VENUE_BEARER)
            if self.fail_complete:
                return HttpResponse(
                    409,
                    response_headers,
                    {"error": {"code": "ORDER_STATE_CHANGED"}},
                )
            self.completed = True
            return HttpResponse(
                200,
                response_headers,
                {
                    "id": ORDER_ID,
                    "status": "COMPLETED",
                    "checked_in_at": "2026-08-31T10:55:00+08:00",
                },
            )

        if parsed.path == f"/api/v1/games/{GAME_ID}/attendance-roster":
            assert method == "GET"
            if headers["Authorization"] == f"Bearer {PLAYER_BEARER}":
                return HttpResponse(
                    404,
                    response_headers,
                    {"error": {"code": "OPEN_GAME_NOT_FOUND"}},
                )
            assert headers == {
                "Accept": "application/json",
                "Authorization": f"Bearer {CAPTAIN_BEARER}",
            }
            return HttpResponse(200, response_headers, self._roster())

        if parsed.path == (
            f"/api/v1/games/{GAME_ID}/registrations/{REGISTRATION_ID}/attendance"
        ):
            assert method == "POST"
            self._assert_mutation_headers(headers, CAPTAIN_BEARER)
            assert body == {
                "attendance_status": "PRESENT",
                "expected_version": 2,
            }
            self.attendance_status = "PRESENT"
            self.attendance_version = 2 + self.mark_version_increment
            self.recorded_at = RECORDED_AT
            return HttpResponse(
                200,
                response_headers,
                {
                    "registration_id": REGISTRATION_ID,
                    "attendance_status": "PRESENT",
                    "attendance_recorded_at": RECORDED_AT,
                    "version": self.attendance_version,
                    "recorded_count": 1,
                    "total_count": 1,
                    "attendance_complete": True,
                },
            )

        if parsed.path == "/api/v1/open-game-applications":
            assert method == "GET"
            assert headers == {
                "Accept": "application/json",
                "Authorization": f"Bearer {PLAYER_BEARER}",
            }
            query = parse_qs(parsed.query)
            if "cursor" not in query:
                self.player_page += 1
                return HttpResponse(
                    200,
                    response_headers,
                    {
                        "items": [{"id": "50000000-0000-4000-8000-000000000001"}],
                        "next_cursor": "second page",
                    },
                )
            assert query == {"limit": ["50"], "cursor": ["second page"]}
            self.player_page += 1
            target = {
                "id": REGISTRATION_ID,
                "effective_status": "JOINED",
                "attendance_status": self.attendance_status,
                "attendance_recorded_at": self.recorded_at,
                "detail_path": (
                    "/pages/captain-game-public/index?token=" f"{SHARE_TOKEN}"
                ),
            }
            if self.leak_player_recorder:
                target["attendance_recorded_by_user_id"] = (
                    "60000000-0000-4000-8000-000000000001"
                )
            return HttpResponse(
                200,
                response_headers,
                {
                    "items": [] if self.hide_player_registration else [target],
                    "next_cursor": None,
                },
            )

        if parsed.path == (
            f"/api/v1/shared-games/{SHARE_TOKEN}/registration-context"
        ):
            assert method == "GET"
            assert headers == {
                "Accept": "application/json",
                "Authorization": f"Bearer {PLAYER_BEARER}",
            }
            return HttpResponse(
                200,
                response_headers,
                {
                    "game": {
                        **self._public_game(),
                        "name": self.context_game_name,
                    },
                    "viewer_authenticated": True,
                    "viewer_registration": {
                        "id": REGISTRATION_ID,
                        "effective_status": "JOINED",
                        "attendance_status": (
                            self.context_after_attendance_status
                            if self.completed
                            and self.context_after_attendance_status is not None
                            else self.attendance_status if self.completed else None
                        ),
                        "attendance_recorded_at": (
                            self.recorded_at if self.completed else None
                        ),
                    },
                },
            )

        raise AssertionError(f"unexpected request: {method} {url}")

    def _public_game(self) -> dict[str, object]:
        return {
            "name": "C2c staging game",
            "state": "COMPLETED" if self.completed else "PUBLISHED",
        }

    def _roster(self) -> dict[str, object]:
        return {
            "game": {"id": GAME_ID, "state": "COMPLETED"},
            "recorded_count": 0 if self.attendance_status == "UNMARKED" else 1,
            "total_count": 1,
            "attendance_complete": self.attendance_status != "UNMARKED",
            "registrations": [
                {
                    "registration_id": REGISTRATION_ID,
                    "display_name": "验收球员",
                    "position": "FORWARD",
                    "attendance_status": self.attendance_status,
                    "attendance_recorded_at": self.recorded_at,
                    "version": self.attendance_version,
                }
            ],
        }

    @staticmethod
    def _assert_mutation_headers(headers: dict[str, str], bearer: str) -> None:
        assert headers["Accept"] == "application/json"
        assert headers["Authorization"] == f"Bearer {bearer}"
        assert len(headers["Idempotency-Key"]) >= 16


def _verify(
    staging: FakeAttendanceStaging,
    *,
    base_url: str = BASE_URL,
    confirm_registration_id: str = REGISTRATION_ID,
    output: Path | None = None,
) -> VerificationReport:
    return verify(
        base_url,
        captain_bearer=CAPTAIN_BEARER,
        player_bearer=PLAYER_BEARER,
        venue_bearer=VENUE_BEARER,
        venue_id=VENUE_ID,
        order_id=ORDER_ID,
        game_id=GAME_ID,
        registration_id=REGISTRATION_ID,
        attendance_status="PRESENT",
        confirm_registration_id=confirm_registration_id,
        expected_revision=REVISION,
        request=staging.request,
        output=output,
    )


def test_verify_runs_real_authority_path_and_player_readback(
    tmp_path: Path,
) -> None:
    staging = FakeAttendanceStaging()
    output = tmp_path / "attendance-report.json"

    report = _verify(staging, output=output)

    assert report.ok
    assert report.failures == ()
    assert report.order_status == "COMPLETED"
    assert report.attendance_status == "PRESENT"
    assert report.player_attendance_status == "PRESENT"
    assert report.request_count == 15
    assert staging.player_page == 4
    paths = [urlsplit(call["url"]).path for call in staging.requests]
    assert paths[:7] == [
        f"/api/v1/games/{GAME_ID}",
        "/api/v1/open-game-applications",
        "/api/v1/open-game-applications",
        f"/api/v1/shared-games/{SHARE_TOKEN}/registration-context",
        f"/api/v1/venues/{VENUE_ID}/fulfillment/orders/{ORDER_ID}/check-in",
        f"/api/v1/venues/{VENUE_ID}/fulfillment/orders/{ORDER_ID}/complete",
        f"/api/v1/games/{GAME_ID}",
    ]
    assert paths.count(
        f"/api/v1/games/{GAME_ID}/registrations/{REGISTRATION_ID}/attendance"
    ) == 2
    written = output.read_text(encoding="utf-8")
    assert json.loads(written)["ok"] is True
    assert CAPTAIN_BEARER not in written
    assert PLAYER_BEARER not in written
    assert VENUE_BEARER not in written


def test_verify_requires_exact_irreversible_registration_confirmation() -> None:
    staging = FakeAttendanceStaging()

    report = _verify(
        staging,
        confirm_registration_id="40000000-0000-4000-8000-000000000099",
    )

    assert report.request_count == 0
    assert report.failures == (
        "confirmation registration id does not match registration id; no requests sent",
    )
    assert staging.requests == []


@pytest.mark.parametrize(
    "base_url",
    [
        "http://staging.example.org",
        "file:///tmp/api",
        "https://127.0.0.1",
        "https://10.0.0.8",
        "https://api.example.test",
        "https://user:password@api.example.org",
        "https://api.example.org/api",
        "https://api.example.org?target=elsewhere",
        "https://api.example.org#fragment",
    ],
)
def test_verify_rejects_unsafe_bearer_destination_before_requests(
    base_url: str,
) -> None:
    staging = FakeAttendanceStaging()

    report = _verify(staging, base_url=base_url)

    assert report.request_count == 0
    assert report.base_url == "<invalid>"
    assert report.failures == (
        "base URL must be one public HTTPS origin without credentials, path, query, "
        "or fragment; no requests sent",
    )
    rendered = json.dumps(report.to_json())
    assert "password" not in rendered
    assert CAPTAIN_BEARER not in rendered
    assert PLAYER_BEARER not in rendered
    assert VENUE_BEARER not in rendered


@pytest.mark.parametrize(
    ("captain", "player", "venue"),
    [
        (CAPTAIN_BEARER, CAPTAIN_BEARER, VENUE_BEARER),
        (CAPTAIN_BEARER, PLAYER_BEARER, CAPTAIN_BEARER),
        (VENUE_BEARER, PLAYER_BEARER, VENUE_BEARER),
    ],
)
def test_verify_rejects_duplicate_business_sessions_before_requests(
    captain: str,
    player: str,
    venue: str,
) -> None:
    staging = FakeAttendanceStaging()

    report = verify(
        BASE_URL,
        captain_bearer=captain,
        player_bearer=player,
        venue_bearer=venue,
        venue_id=VENUE_ID,
        order_id=ORDER_ID,
        game_id=GAME_ID,
        registration_id=REGISTRATION_ID,
        attendance_status="PRESENT",
        confirm_registration_id=REGISTRATION_ID,
        request=staging.request,
    )

    assert report.request_count == 0
    assert report.failures == (
        "captain, player, and venue bearers must be pairwise distinct; no requests sent",
    )


def test_verify_stops_before_fulfillment_when_owner_order_does_not_match() -> None:
    staging = FakeAttendanceStaging()
    staging.order_id = "20000000-0000-4000-8000-000000000099"

    report = _verify(staging)

    assert report.request_count == 1
    assert report.failures == (
        f"captain game order mismatch: expected {ORDER_ID}, got {staging.order_id}",
    )
    assert all("/fulfillment/" not in call["url"] for call in staging.requests)


def test_verify_stops_before_fulfillment_when_owner_game_does_not_match() -> None:
    staging = FakeAttendanceStaging()
    staging.game_id = "30000000-0000-4000-8000-000000000099"

    report = _verify(staging)

    assert report.request_count == 1
    assert report.failures == (
        f"captain game id mismatch: expected {GAME_ID}, got {staging.game_id}",
    )
    assert all("/fulfillment/" not in call["url"] for call in staging.requests)


def test_verify_stops_before_fulfillment_when_player_does_not_own_registration() -> None:
    staging = FakeAttendanceStaging()
    staging.hide_player_registration = True

    report = _verify(staging)

    assert report.failures == (
        "target registration is absent from player applications",
    )
    assert all("/fulfillment/" not in call["url"] for call in staging.requests)


def test_verify_stops_before_fulfillment_when_player_detail_is_another_game() -> None:
    staging = FakeAttendanceStaging()
    staging.context_game_name = "another game"

    report = _verify(staging)

    assert report.failures == (
        "player shared detail does not match the captain game",
    )
    assert all("/fulfillment/" not in call["url"] for call in staging.requests)


def test_verify_reports_mutation_failure_without_leaking_bearers() -> None:
    staging = FakeAttendanceStaging()
    staging.fail_complete = True

    report = _verify(staging)

    assert report.request_count == 6
    assert report.failures == (
        "POST order complete returned 409 ORDER_STATE_CHANGED (request_id=request-6)",
    )
    rendered = json.dumps(report.to_json())
    assert CAPTAIN_BEARER not in rendered
    assert PLAYER_BEARER not in rendered
    assert VENUE_BEARER not in rendered


def test_verify_is_safe_to_rerun_after_the_target_result_exists() -> None:
    staging = FakeAttendanceStaging()
    staging.completed = True
    staging.attendance_status = "PRESENT"
    staging.attendance_version = 3
    staging.recorded_at = RECORDED_AT

    report = _verify(staging)
    repeated = _verify(staging)

    assert report.ok
    assert repeated.ok
    attendance_posts = [
        call
        for call in staging.requests
        if call["method"] == "POST" and call["url"].endswith("/attendance")
    ]
    assert attendance_posts == []
    assert any(call["url"].endswith("/check-in") for call in staging.requests)
    assert any(call["url"].endswith("/complete") for call in staging.requests)
    for suffix in ("/check-in", "/complete"):
        keys = [
            call["headers"]["Idempotency-Key"]
            for call in staging.requests
            if call["url"].endswith(suffix)
        ]
        assert len(keys) == 2
        assert keys[0] == keys[1]


def test_verify_rejects_mark_result_without_one_version_increment() -> None:
    staging = FakeAttendanceStaging()
    staging.mark_version_increment = 0

    report = _verify(staging)

    assert report.failures == (
        "attendance result did not increment the authoritative version exactly once",
    )


def test_verify_rejects_private_recorder_in_player_readback() -> None:
    staging = FakeAttendanceStaging()
    staging.leak_player_recorder = True

    report = _verify(staging)

    assert report.failures == (
        "player applications leaked the private attendance recorder",
    )


def test_verify_rejects_mismatched_player_shared_detail_readback() -> None:
    staging = FakeAttendanceStaging()
    staging.context_after_attendance_status = "NO_SHOW"

    report = _verify(staging)

    assert report.failures == (
        "player shared detail did not read back the final attendance result",
    )


def test_request_json_does_not_follow_redirects_with_authorization() -> None:
    class RedirectHandler(BaseHTTPRequestHandler):
        sink_requests = 0

        def do_GET(self) -> None:  # noqa: N802
            if self.path == "/redirect":
                self.send_response(302)
                self.send_header("Location", "/sink")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            type(self).sink_requests += 1
            self.send_response(200)
            self.send_header("Content-Length", "0")
            self.end_headers()

        def log_message(self, format: str, *args: object) -> None:  # noqa: A002
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), RedirectHandler)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        response = request_json(
            "GET",
            f"http://127.0.0.1:{server.server_port}/redirect",
            {"Authorization": "Bearer must-not-reach-the-sink"},
            None,
        )
    finally:
        server.shutdown()
        server.server_close()
        worker.join(timeout=2)

    assert response.status == 302
    assert RedirectHandler.sink_requests == 0
