from __future__ import annotations

import argparse
import json
import os
from collections.abc import Callable, Mapping
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

PITCH_TYPES = ("FIVE_A_SIDE", "SEVEN_A_SIDE")
REQUIRED_VENUE_TEXT = (
    "id",
    "name",
    "price_advantage_text",
    "timezone",
    "business_hours_text",
    "address",
    "parking_text",
    "refund_policy_summary",
)


@dataclass(frozen=True)
class HttpResponse:
    status: int
    headers: Mapping[str, str]
    body: Any


@dataclass(frozen=True)
class VerificationReport:
    base_url: str
    failures: tuple[str, ...]
    covered_dates: tuple[date, ...]
    request_count: int
    expected_revision: str | None
    generated_at: str

    @property
    def ok(self) -> bool:
        return not self.failures

    def to_json(self) -> dict[str, object]:
        payload = asdict(self)
        payload["covered_dates"] = [value.isoformat() for value in self.covered_dates]
        return payload


def request_json(url: str) -> HttpResponse:
    request = Request(url, method="GET", headers={"Accept": "application/json"})
    try:
        response = urlopen(request, timeout=5)
    except HTTPError as error:
        response = error
    with response:
        raw_body = response.read()
        try:
            body = json.loads(raw_body)
        except (json.JSONDecodeError, UnicodeDecodeError):
            body = None
        return HttpResponse(response.status, dict(response.headers.items()), body)


def verify(
    base_url: str,
    *,
    today: date | None = None,
    expected_revision: str | None = None,
    request: Callable[[str], HttpResponse] = request_json,
    output: Path | None = None,
) -> VerificationReport:
    normalized_base = base_url.rstrip("/")
    local_today = today or date.today()
    failures: list[str] = []
    covered_dates: list[date] = []
    request_count = 0

    def fetch(path: str) -> HttpResponse | None:
        nonlocal request_count
        request_count += 1
        try:
            response = request(f"{normalized_base}{path}")
        except Exception as error:
            failures.append(f"request failed for {path}: {type(error).__name__}")
            return None
        if expected_revision is not None:
            actual = _header(response.headers, "X-App-Revision")
            mismatch = (
                "application revision mismatch: "
                f"expected {expected_revision}, got {actual or '<missing>'}"
            )
            if actual != expected_revision and mismatch not in failures:
                failures.append(mismatch)
        return response

    health = fetch("/api/v1/health")
    if health is None or health.status != 200 or health.body != {"status": "ok"}:
        failures.append("health endpoint is not ready")

    primary = fetch("/api/v1/venues/primary")
    venue = primary.body if primary is not None and isinstance(primary.body, dict) else None
    if primary is None or primary.status != 200 or venue is None:
        failures.append("primary venue is unavailable")
        return _finish(
            normalized_base,
            failures,
            covered_dates,
            request_count,
            expected_revision,
            output,
        )

    for field in REQUIRED_VENUE_TEXT:
        if not isinstance(venue.get(field), str) or not venue[field].strip():
            failures.append(f"venue.{field} is empty")
    for field in ("latitude", "longitude"):
        if not isinstance(venue.get(field), (int, float)):
            failures.append(f"venue.{field} is missing")

    profile = venue.get("profile")
    images = profile.get("images") if isinstance(profile, dict) else None
    if not isinstance(images, list) or sum(
        isinstance(image, dict) and image.get("role") == "COVER" for image in images
    ) != 1:
        failures.append("venue must contain exactly one COVER image")

    pitch_types = venue.get("pitch_types")
    pitch_codes = {
        item.get("code") for item in pitch_types or [] if isinstance(item, dict)
    }
    if not set(PITCH_TYPES).issubset(pitch_codes):
        failures.append("venue does not expose both required pitch types")

    expected_end = local_today + timedelta(days=13)
    window = venue.get("availability_window")
    if (
        not isinstance(window, dict)
        or window.get("start_date") != local_today.isoformat()
        or window.get("end_date") != expected_end.isoformat()
    ):
        failures.append("venue availability window is not today through day 13")

    venue_id = venue.get("id")
    for offset in range(14):
        requested_date = local_today + timedelta(days=offset)
        date_complete = True
        for pitch_type in PITCH_TYPES:
            query = urlencode({"date": requested_date.isoformat(), "pitch_type": pitch_type})
            response = fetch(f"/api/v1/venues/{venue_id}/availability?{query}")
            body = (
                response.body
                if response is not None and isinstance(response.body, dict)
                else None
            )
            if (
                response is None
                or response.status != 200
                or body is None
                or body.get("venue_id") != venue_id
                or body.get("date") != requested_date.isoformat()
                or body.get("pitch_type") != pitch_type
            ):
                failures.append(
                    f"availability missing for {requested_date.isoformat()} {pitch_type}"
                )
                date_complete = False
        if date_complete:
            covered_dates.append(requested_date)

    return _finish(
        normalized_base,
        failures,
        covered_dates,
        request_count,
        expected_revision,
        output,
    )


def _header(headers: Mapping[str, str], name: str) -> str | None:
    lowered = name.lower()
    return next((value for key, value in headers.items() if key.lower() == lowered), None)


def _finish(
    base_url: str,
    failures: list[str],
    covered_dates: list[date],
    request_count: int,
    expected_revision: str | None,
    output: Path | None,
) -> VerificationReport:
    report = VerificationReport(
        base_url=base_url,
        failures=tuple(failures),
        covered_dates=tuple(covered_dates),
        request_count=request_count,
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


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify the venue-browsing staging journey")
    parser.add_argument("--base-url", default=os.environ.get("STAGING_API_BASE_URL"))
    parser.add_argument("--expected-revision")
    parser.add_argument("--today", type=date.fromisoformat)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if not args.base_url:
        parser.error("--base-url or STAGING_API_BASE_URL is required")
    report = verify(
        args.base_url,
        today=args.today,
        expected_revision=args.expected_revision,
        output=args.output,
    )
    print(json.dumps(report.to_json(), ensure_ascii=False))
    return 0 if report.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
