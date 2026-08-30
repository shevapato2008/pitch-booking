from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import os
import uuid
from collections.abc import Callable, Mapping
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Literal
from urllib.error import HTTPError
from urllib.parse import parse_qs, quote, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

AttendanceStatus = Literal["PRESENT", "NO_SHOW"]
RequestJson = Callable[
    [str, str, dict[str, str], object | None],
    "HttpResponse",
]
SPECIAL_USE_DOMAIN_SUFFIXES = (
    "invalid",
    "localhost",
    "test",
    "example",
    "example.com",
    "example.net",
    "example.org",
)


@dataclass(frozen=True)
class HttpResponse:
    status: int
    headers: Mapping[str, str]
    body: Any


class _RejectRedirects(HTTPRedirectHandler):
    def redirect_request(self, *args: Any, **kwargs: Any) -> None:
        return None


@dataclass(frozen=True)
class VerificationReport:
    base_url: str
    venue_id: str
    order_id: str
    game_id: str
    registration_id: str
    requested_attendance_status: str
    failures: tuple[str, ...]
    request_count: int
    order_status: str | None
    attendance_status: str | None
    player_attendance_status: str | None
    player_detail_attendance_status: str | None
    expected_revision: str | None
    generated_at: str

    @property
    def ok(self) -> bool:
        return not self.failures

    def to_json(self) -> dict[str, object]:
        return {**asdict(self), "ok": self.ok}


def request_json(
    method: str,
    url: str,
    headers: dict[str, str],
    body: object | None,
) -> HttpResponse:
    request_headers = dict(headers)
    data: bytes | None = None
    if body is not None:
        data = json.dumps(body, separators=(",", ":")).encode()
        request_headers["Content-Type"] = "application/json"
    request = Request(url, method=method, headers=request_headers, data=data)
    try:
        response = build_opener(_RejectRedirects()).open(request, timeout=10)
    except HTTPError as error:
        response = error
    with response:
        raw_body = response.read()
        try:
            decoded = json.loads(raw_body)
        except (json.JSONDecodeError, UnicodeDecodeError):
            decoded = None
        return HttpResponse(response.status, dict(response.headers.items()), decoded)


def verify(
    base_url: str,
    *,
    captain_bearer: str,
    player_bearer: str,
    venue_bearer: str,
    venue_id: str,
    order_id: str,
    game_id: str,
    registration_id: str,
    attendance_status: AttendanceStatus,
    confirm_registration_id: str,
    expected_revision: str | None = None,
    request: RequestJson = request_json,
    output: Path | None = None,
) -> VerificationReport:
    failures: list[str] = []
    normalized_base = _public_https_base_url(base_url)
    if normalized_base is None:
        normalized_base = "<invalid>"
        failures.append(
            "base URL must be one public HTTPS origin without credentials, path, "
            "query, or fragment; no requests sent"
        )
    request_count = 0
    final_order_status: str | None = None
    final_attendance_status: str | None = None
    player_attendance_status: str | None = None
    player_detail_attendance_status: str | None = None

    normalized_ids: dict[str, str] = {}
    for name, value in (
        ("venue", venue_id),
        ("order", order_id),
        ("game", game_id),
        ("registration", registration_id),
    ):
        try:
            normalized_ids[name] = str(uuid.UUID(value))
        except (AttributeError, TypeError, ValueError):
            failures.append(f"{name} id must be a UUID; no requests sent")

    if attendance_status not in {"PRESENT", "NO_SHOW"}:
        failures.append("attendance status must be PRESENT or NO_SHOW; no requests sent")
    for role, bearer in (
        ("captain", captain_bearer),
        ("player", player_bearer),
        ("venue", venue_bearer),
    ):
        if not isinstance(bearer, str) or not bearer.strip():
            failures.append(f"{role} bearer is required; no requests sent")
    if (
        all(
            isinstance(bearer, str) and bool(bearer.strip())
            for bearer in (captain_bearer, player_bearer, venue_bearer)
        )
        and len({captain_bearer, player_bearer, venue_bearer}) != 3
    ):
        failures.append(
            "captain, player, and venue bearers must be pairwise distinct; no requests sent"
        )

    normalized_registration = normalized_ids.get("registration", registration_id)
    try:
        normalized_confirmation = str(uuid.UUID(confirm_registration_id))
    except (AttributeError, TypeError, ValueError):
        normalized_confirmation = confirm_registration_id
    if normalized_confirmation != normalized_registration:
        failures.append(
            "confirmation registration id does not match registration id; no requests sent"
        )

    def finish() -> VerificationReport:
        report = VerificationReport(
            base_url=normalized_base,
            venue_id=normalized_ids.get("venue", venue_id),
            order_id=normalized_ids.get("order", order_id),
            game_id=normalized_ids.get("game", game_id),
            registration_id=normalized_registration,
            requested_attendance_status=attendance_status,
            failures=tuple(failures),
            request_count=request_count,
            order_status=final_order_status,
            attendance_status=final_attendance_status,
            player_attendance_status=player_attendance_status,
            player_detail_attendance_status=player_detail_attendance_status,
            expected_revision=expected_revision,
            generated_at=datetime.now().astimezone().isoformat(),
        )
        if output is not None:
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(
                f"{json.dumps(report.to_json(), ensure_ascii=False, indent=2)}\n",
                encoding="utf-8",
            )
        return report

    if failures:
        return finish()

    venue_id = normalized_ids["venue"]
    order_id = normalized_ids["order"]
    game_id = normalized_ids["game"]
    registration_id = normalized_ids["registration"]

    def call(
        label: str,
        method: str,
        path: str,
        bearer: str,
        *,
        body: object | None = None,
        idempotency_key: str | None = None,
    ) -> HttpResponse | None:
        nonlocal request_count
        headers = {
            "Accept": "application/json",
            "Authorization": f"Bearer {bearer}",
        }
        if idempotency_key is not None:
            headers["Idempotency-Key"] = idempotency_key
        request_count += 1
        try:
            response = request(method, f"{normalized_base}{path}", headers, body)
        except Exception as error:
            failures.append(f"{method} {label} request failed: {type(error).__name__}")
            return None
        if expected_revision is not None:
            actual_revision = _header(response.headers, "X-App-Revision")
            if actual_revision != expected_revision:
                failures.append(
                    "application revision mismatch: "
                    f"expected {expected_revision}, got {actual_revision or '<missing>'}"
                )
                return None
        return response

    def require_200(label: str, response: HttpResponse | None) -> dict[str, Any] | None:
        if response is None:
            return None
        if response.status != 200 or not isinstance(response.body, dict):
            failures.append(_response_failure(label, response))
            return None
        return response.body

    def read_player_application() -> dict[str, Any] | None:
        cursor: str | None = None
        seen_cursors: set[str] = set()
        for _ in range(20):
            query: dict[str, object] = {"limit": 50}
            if cursor is not None:
                query["cursor"] = cursor
            response = require_200(
                "player applications",
                call(
                    "player applications",
                    "GET",
                    f"/api/v1/open-game-applications?{urlencode(query)}",
                    player_bearer,
                ),
            )
            if response is None:
                return None
            if "attendance_recorded_by_user_id" in json.dumps(response):
                failures.append(
                    "player applications leaked the private attendance recorder"
                )
                return None
            items = response.get("items")
            if not isinstance(items, list):
                failures.append("player applications response has no item list")
                return None
            player_item = next(
                (
                    item
                    for item in items
                    if isinstance(item, dict) and item.get("id") == registration_id
                ),
                None,
            )
            if player_item is not None:
                return player_item
            next_cursor = response.get("next_cursor")
            if next_cursor is None:
                break
            if (
                not isinstance(next_cursor, str)
                or not next_cursor
                or next_cursor in seen_cursors
            ):
                failures.append("player applications returned an invalid pagination cursor")
                return None
            seen_cursors.add(next_cursor)
            cursor = next_cursor
        failures.append("target registration is absent from player applications")
        return None

    owner_path = f"/api/v1/games/{game_id}"
    owner_before = require_200(
        "captain game",
        call("captain game", "GET", owner_path, captain_bearer),
    )
    if owner_before is None:
        return finish()
    actual_game_id = owner_before.get("id")
    if actual_game_id != game_id:
        failures.append(
            f"captain game id mismatch: expected {game_id}, got {actual_game_id}"
        )
        return finish()
    actual_order_id = owner_before.get("order_id")
    if actual_order_id != order_id:
        failures.append(
            f"captain game order mismatch: expected {order_id}, got {actual_order_id}"
        )
        return finish()
    captain_share = owner_before.get("share")
    captain_public_game = owner_before.get("public_view")
    if not isinstance(captain_share, dict) or not isinstance(captain_public_game, dict):
        failures.append("captain game has no authoritative share projection")
        return finish()
    captain_share_token = _share_token(captain_share.get("path"))
    if captain_share_token is None:
        failures.append("captain game share path does not contain one safe share token")
        return finish()

    player_before = read_player_application()
    if player_before is None:
        return finish()
    if player_before.get("effective_status") != "JOINED":
        failures.append("target player registration is not authoritatively JOINED")
        return finish()
    initial_share_token = _share_token(player_before.get("detail_path"))
    if initial_share_token is None:
        failures.append("player application detail path does not contain one safe share token")
        return finish()
    if initial_share_token != captain_share_token:
        failures.append("player application detail token does not match the captain game")
        return finish()
    detail_before = require_200(
        "player shared detail",
        call(
            "player shared detail",
            "GET",
            f"/api/v1/shared-games/{quote(initial_share_token, safe='')}/registration-context",
            player_bearer,
        ),
    )
    if detail_before is None:
        return finish()
    if "attendance_recorded_by_user_id" in json.dumps(detail_before):
        failures.append("player shared detail leaked the private attendance recorder")
        return finish()
    viewer_before = detail_before.get("viewer_registration")
    if detail_before.get("game") != captain_public_game:
        failures.append("player shared detail does not match the captain game")
        return finish()
    if (
        detail_before.get("viewer_authenticated") is not True
        or not isinstance(viewer_before, dict)
        or viewer_before.get("id") != registration_id
        or viewer_before.get("effective_status") != "JOINED"
    ):
        failures.append("player shared detail does not own the target JOINED registration")
        return finish()

    fulfillment_path = (
        f"/api/v1/venues/{venue_id}/fulfillment/orders/{order_id}"
    )
    checked_in = require_200(
        "order check-in",
        call(
            "order check-in",
            "POST",
            f"{fulfillment_path}/check-in",
            venue_bearer,
            idempotency_key=_idempotency_key("check-in", order_id),
        ),
    )
    if checked_in is None:
        return finish()
    if checked_in.get("id") != order_id or checked_in.get("checked_in_at") is None:
        failures.append("order check-in response did not confirm the requested order")
        return finish()

    completed = require_200(
        "order complete",
        call(
            "order complete",
            "POST",
            f"{fulfillment_path}/complete",
            venue_bearer,
            idempotency_key=_idempotency_key("complete", order_id),
        ),
    )
    if completed is None:
        return finish()
    final_order_status = _string(completed.get("status"))
    if completed.get("id") != order_id or final_order_status != "COMPLETED":
        failures.append("order completion response did not confirm COMPLETED authority")
        return finish()

    owner_after = require_200(
        "completed captain game",
        call("completed captain game", "GET", owner_path, captain_bearer),
    )
    if owner_after is None:
        return finish()
    allowed_actions = owner_after.get("allowed_actions")
    captain_public_game_after = owner_after.get("public_view")
    if (
        owner_after.get("id") != game_id
        or owner_after.get("order_id") != order_id
        or owner_after.get("state") != "COMPLETED"
        or not isinstance(allowed_actions, dict)
        or allowed_actions.get("can_manage_attendance") is not True
        or not isinstance(captain_public_game_after, dict)
    ):
        failures.append(
            "captain game did not project COMPLETED with attendance authority"
        )
        return finish()

    roster_path = f"/api/v1/games/{game_id}/attendance-roster"
    roster_before = require_200(
        "captain attendance roster",
        call("captain attendance roster", "GET", roster_path, captain_bearer),
    )
    if roster_before is None:
        return finish()
    target_before = _target_registration(roster_before, game_id, registration_id)
    if target_before is None:
        failures.append("target registration is absent from the completed attendance roster")
        return finish()

    player_roster = call("player attendance roster", "GET", roster_path, player_bearer)
    if player_roster is None:
        return finish()
    if (
        player_roster.status != 404
        or _error_code(player_roster.body) != "OPEN_GAME_NOT_FOUND"
    ):
        failures.append(
            "player attendance roster was not hidden as 404 OPEN_GAME_NOT_FOUND"
        )
        return finish()

    mark_result: dict[str, Any] | None = None
    expected_result_version: int | None = None
    current_status = target_before.get("attendance_status")
    if current_status == attendance_status:
        mark_result = target_before
    elif current_status == "UNMARKED":
        expected_version = target_before.get("version")
        if not isinstance(expected_version, int) or isinstance(expected_version, bool):
            failures.append("target attendance roster version is invalid")
            return finish()
        expected_result_version = expected_version + 1
        mark_path = (
            f"/api/v1/games/{game_id}/registrations/{registration_id}/attendance"
        )
        mark_body = {
            "attendance_status": attendance_status,
            "expected_version": expected_version,
        }
        mark_key = _idempotency_key(
            "attendance",
            f"{game_id}:{registration_id}:{attendance_status}:{expected_version}",
        )
        first_mark = require_200(
            "attendance mark",
            call(
                "attendance mark",
                "POST",
                mark_path,
                captain_bearer,
                body=mark_body,
                idempotency_key=mark_key,
            ),
        )
        if first_mark is None:
            return finish()
        replay = require_200(
            "attendance mark replay",
            call(
                "attendance mark replay",
                "POST",
                mark_path,
                captain_bearer,
                body=mark_body,
                idempotency_key=mark_key,
            ),
        )
        if replay is None:
            return finish()
        if replay != first_mark:
            failures.append("attendance idempotency replay did not return the first result")
            return finish()
        mark_result = first_mark
    else:
        failures.append(
            "target attendance already has a different irreversible result: "
            f"{current_status}"
        )
        return finish()

    final_attendance_status = _string(mark_result.get("attendance_status"))
    recorded_at = mark_result.get("attendance_recorded_at")
    if (
        mark_result.get("registration_id") != registration_id
        or final_attendance_status != attendance_status
        or not isinstance(recorded_at, str)
        or not recorded_at
    ):
        failures.append("attendance result did not confirm the requested final status")
        return finish()
    if (
        expected_result_version is not None
        and mark_result.get("version") != expected_result_version
    ):
        failures.append(
            "attendance result did not increment the authoritative version exactly once"
        )
        return finish()

    roster_after = require_200(
        "updated captain attendance roster",
        call("updated captain attendance roster", "GET", roster_path, captain_bearer),
    )
    if roster_after is None:
        return finish()
    target_after = _target_registration(roster_after, game_id, registration_id)
    if (
        target_after is None
        or target_after.get("attendance_status") != attendance_status
        or target_after.get("attendance_recorded_at") != recorded_at
        or target_after.get("version") != mark_result.get("version")
    ):
        failures.append("captain attendance roster did not read back the final result")
        return finish()

    player_item = read_player_application()
    if player_item is None:
        return finish()
    player_attendance_status = _string(player_item.get("attendance_status"))
    if (
        player_item.get("effective_status") != "JOINED"
        or player_attendance_status != attendance_status
        or player_item.get("attendance_recorded_at") != recorded_at
    ):
        failures.append("player applications did not read back the final attendance result")
        return finish()

    share_token = _share_token(player_item.get("detail_path"))
    if share_token is None or share_token != initial_share_token:
        failures.append("player application detail path does not contain one safe share token")
        return finish()
    detail = require_200(
        "player shared detail",
        call(
            "player shared detail",
            "GET",
            f"/api/v1/shared-games/{quote(share_token, safe='')}/registration-context",
            player_bearer,
        ),
    )
    if detail is None:
        return finish()
    if "attendance_recorded_by_user_id" in json.dumps(detail):
        failures.append("player shared detail leaked the private attendance recorder")
        return finish()
    detail_game = detail.get("game")
    viewer_registration = detail.get("viewer_registration")
    if not isinstance(viewer_registration, dict):
        failures.append("player shared detail has no viewer registration")
        return finish()
    player_detail_attendance_status = _string(
        viewer_registration.get("attendance_status")
    )
    if (
        detail_game != captain_public_game_after
        or detail.get("viewer_authenticated") is not True
        or viewer_registration.get("id") != registration_id
        or viewer_registration.get("effective_status") != "JOINED"
        or player_detail_attendance_status != attendance_status
        or viewer_registration.get("attendance_recorded_at") != recorded_at
    ):
        failures.append(
            "player shared detail did not read back the final attendance result"
        )
        return finish()

    return finish()


def _target_registration(
    roster: Mapping[str, object],
    game_id: str,
    registration_id: str,
) -> dict[str, Any] | None:
    game = roster.get("game")
    registrations = roster.get("registrations")
    if (
        not isinstance(game, dict)
        or game.get("id") != game_id
        or game.get("state") != "COMPLETED"
        or not isinstance(registrations, list)
    ):
        return None
    return next(
        (
            item
            for item in registrations
            if isinstance(item, dict)
            and item.get("registration_id") == registration_id
        ),
        None,
    )


def _public_https_base_url(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError:
        return None
    hostname = parsed.hostname
    if (
        parsed.scheme.casefold() != "https"
        or hostname is None
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
        or port not in {None, 443}
    ):
        return None
    normalized_host = hostname.rstrip(".").casefold()
    if not normalized_host or not normalized_host.isascii():
        return None
    if any(
        normalized_host == suffix or normalized_host.endswith(f".{suffix}")
        for suffix in SPECIAL_USE_DOMAIN_SUFFIXES
    ):
        return None
    try:
        address = ipaddress.ip_address(normalized_host)
    except ValueError:
        rendered_host = normalized_host
    else:
        if not address.is_global:
            return None
        rendered_host = f"[{normalized_host}]" if address.version == 6 else normalized_host
    return f"https://{rendered_host}"


def _share_token(detail_path: object) -> str | None:
    if not isinstance(detail_path, str):
        return None
    parsed = urlsplit(detail_path)
    if (
        parsed.scheme
        or parsed.netloc
        or parsed.fragment
        or parsed.path != "/pages/captain-game-public/index"
    ):
        return None
    query = parse_qs(parsed.query, keep_blank_values=True)
    if set(query) != {"token"} or len(query["token"]) != 1:
        return None
    token = query["token"][0]
    if not token or len(token) > 128:
        return None
    return token


def _idempotency_key(operation: str, authority: str) -> str:
    digest = hashlib.sha256(authority.encode()).hexdigest()[:32]
    return f"c2c-staging-{operation}-{digest}"


def _header(headers: Mapping[str, str], name: str) -> str | None:
    lowered = name.lower()
    return next((value for key, value in headers.items() if key.lower() == lowered), None)


def _error_code(body: object) -> str | None:
    if not isinstance(body, dict):
        return None
    error = body.get("error")
    if not isinstance(error, dict):
        return None
    return _string(error.get("code"))


def _response_failure(label: str, response: HttpResponse) -> str:
    code = _error_code(response.body) or "INVALID_RESPONSE"
    request_id = _header(response.headers, "X-Request-Id") or "<missing>"
    return (
        f"{_method_for_label(label)} {label} returned {response.status} {code} "
        f"(request_id={request_id})"
    )


def _method_for_label(label: str) -> str:
    if label in {
        "order check-in",
        "order complete",
        "attendance mark",
        "attendance mark replay",
    }:
        return "POST"
    return "GET"


def _string(value: object) -> str | None:
    return value if isinstance(value, str) else None


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Verify the irreversible C2c attendance journey through staging HTTP APIs"
        )
    )
    parser.add_argument("--base-url", default=os.environ.get("STAGING_API_BASE_URL"))
    parser.add_argument(
        "--captain-bearer", default=os.environ.get("C2C_STAGING_CAPTAIN_BEARER")
    )
    parser.add_argument(
        "--player-bearer", default=os.environ.get("C2C_STAGING_PLAYER_BEARER")
    )
    parser.add_argument(
        "--venue-bearer", default=os.environ.get("C2C_STAGING_VENUE_BEARER")
    )
    parser.add_argument("--venue-id", required=True)
    parser.add_argument("--order-id", required=True)
    parser.add_argument("--game-id", required=True)
    parser.add_argument("--registration-id", required=True)
    parser.add_argument(
        "--attendance-status", required=True, choices=("PRESENT", "NO_SHOW")
    )
    parser.add_argument(
        "--confirm-registration-id",
        required=True,
        help="Repeat the irreversible target registration UUID exactly.",
    )
    parser.add_argument("--expected-revision")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    for option in ("base_url", "captain_bearer", "player_bearer", "venue_bearer"):
        if not getattr(args, option):
            parser.error(
                f"--{option.replace('_', '-')} or its documented environment variable is required"
            )
    report = verify(
        args.base_url,
        captain_bearer=args.captain_bearer,
        player_bearer=args.player_bearer,
        venue_bearer=args.venue_bearer,
        venue_id=args.venue_id,
        order_id=args.order_id,
        game_id=args.game_id,
        registration_id=args.registration_id,
        attendance_status=args.attendance_status,
        confirm_registration_id=args.confirm_registration_id,
        expected_revision=args.expected_revision,
        output=args.output,
    )
    print(json.dumps(report.to_json(), ensure_ascii=False))
    return 0 if report.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
