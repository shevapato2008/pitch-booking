from __future__ import annotations

from copy import deepcopy
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from scripts.verify_staging import HttpResponse, verify

TODAY = date(2026, 7, 22)
REVISION = "a" * 40
VENUE_ID = "7e68d7d8-4b7e-4f04-a5c5-3fe263e69c6f"


class FakeStaging:
    def __init__(self) -> None:
        self.venue = {
            "id": VENUE_ID,
            "name": "浦东星跃足球公园",
            "profile": {
                "publication_state": "PUBLISHED",
                "published_version": 1,
                "description": "专业人造草足球场",
                "cover_image": "https://assets.example.com/cover.jpg",
                "images": [
                    {"role": "COVER", "url": "https://assets.example.com/cover.jpg"}
                ],
                "facilities": [
                    {"code": "LIGHTING", "name": "照明", "sort_order": 0}
                ],
            },
            "price_advantage_text": "透明场地价",
            "timezone": "Asia/Shanghai",
            "business_hours_text": "每日 09:00–23:00",
            "address": "上海市浦东新区锦绣东路 2777 弄 18 号",
            "latitude": 31.245621,
            "longitude": 121.623847,
            "parking_text": "园区提供收费停车位",
            "refund_policy_summary": "开场前 24 小时可退款",
            "pitch_types": [
                {"code": "FIVE_A_SIDE", "name": "五人制", "sort_order": 0},
                {"code": "SEVEN_A_SIDE", "name": "七人制", "sort_order": 1},
            ],
            "availability_window": {
                "start_date": TODAY.isoformat(),
                "end_date": (TODAY + timedelta(days=13)).isoformat(),
            },
            "generated_at": "2026-07-22T10:30:00+08:00",
        }
        self.missing: set[tuple[date, str]] = set()
        self.requests: list[str] = []
        self.revision = REVISION

    def request(self, url: str) -> HttpResponse:
        self.requests.append(url)
        parsed = urlsplit(url)
        headers = {"X-App-Revision": self.revision, "X-Request-Id": "request-id"}
        if parsed.path == "/api/v1/health":
            return HttpResponse(200, headers, {"status": "ok"})
        if parsed.path == "/api/v1/venues/primary":
            return HttpResponse(200, headers, deepcopy(self.venue))
        if parsed.path == f"/api/v1/venues/{VENUE_ID}/availability":
            query = parse_qs(parsed.query)
            requested_date = date.fromisoformat(query["date"][0])
            pitch_type = query["pitch_type"][0]
            if (requested_date, pitch_type) in self.missing:
                return HttpResponse(503, headers, {"error": {"code": "SERVICE_UNAVAILABLE"}})
            return HttpResponse(
                200,
                headers,
                {
                    "venue_id": VENUE_ID,
                    "timezone": "Asia/Shanghai",
                    "date": requested_date.isoformat(),
                    "pitch_type": pitch_type,
                    "availability_window": deepcopy(self.venue["availability_window"]),
                    "pitches": [],
                    "generated_at": "2026-07-22T10:30:00+08:00",
                },
            )
        raise AssertionError(f"unexpected URL: {url}")


def test_verify_accepts_complete_real_shape_and_writes_report(tmp_path: Path) -> None:
    staging = FakeStaging()
    output = tmp_path / "report.json"

    report = verify(
        "http://127.0.0.1:8080",
        today=TODAY,
        expected_revision=REVISION,
        request=staging.request,
        output=output,
    )

    assert report.failures == ()
    assert report.covered_dates == tuple(TODAY + timedelta(days=offset) for offset in range(14))
    assert report.request_count == 30
    assert output.is_file()


def test_verify_rejects_missing_primary_venue_field() -> None:
    staging = FakeStaging()
    staging.venue["parking_text"] = ""

    report = verify("http://staging.test", today=TODAY, request=staging.request)

    assert "venue.parking_text is empty" in report.failures


def test_verify_rejects_incomplete_fourteen_day_coverage() -> None:
    staging = FakeStaging()
    missing_date = TODAY + timedelta(days=7)
    staging.missing.add((missing_date, "SEVEN_A_SIDE"))

    report = verify("http://staging.test", today=TODAY, request=staging.request)

    assert missing_date not in report.covered_dates
    assert f"availability missing for {missing_date.isoformat()} SEVEN_A_SIDE" in report.failures


def test_verify_rejects_application_revision_mismatch() -> None:
    staging = FakeStaging()
    staging.revision = "b" * 40

    report = verify(
        "http://staging.test",
        today=TODAY,
        expected_revision=REVISION,
        request=staging.request,
    )

    assert f"application revision mismatch: expected {REVISION}, got {'b' * 40}" in report.failures
