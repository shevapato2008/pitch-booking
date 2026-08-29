from __future__ import annotations

import uuid
from datetime import datetime
from zoneinfo import ZoneInfoNotFoundError

import pytest
from pydantic import ValidationError

from backend.app.modules.open_game_registrations.dto import (
    MyOpenGameApplication,
    MyOpenGameApplicationsResponse,
)

ITEM_FIELDS = {
    "id",
    "effective_status",
    "applied_at",
    "detail_path",
    "game_name",
    "starts_at",
    "ends_at",
    "time_zone",
    "venue_name",
    "pitch_name",
    "pitch_specification",
}


def _valid_item() -> dict[str, object]:
    return {
        "id": "40000000-0000-4000-8000-000000000001",
        "effective_status": "APPLIED",
        "applied_at": "2026-08-30T09:00:00+08:00",
        "detail_path": (
            "/pages/captain-game-public/index?token="
            "AbCdEfGhIjKlMnOpQrStUvWxYz012345"
        ),
        "game_name": "周日八人制友谊赛",
        "starts_at": "2026-09-06T18:00:00+08:00",
        "ends_at": "2026-09-06T20:00:00+08:00",
        "time_zone": "Asia/Shanghai",
        "venue_name": "逐光足球公园",
        "pitch_name": "1号场",
        "pitch_specification": "8人制",
    }


def test_my_application_dtos_are_closed_and_exact() -> None:
    item = MyOpenGameApplication.model_validate(_valid_item())
    assert set(item.model_dump()) == ITEM_FIELDS
    assert item.id == uuid.UUID("40000000-0000-4000-8000-000000000001")

    response = MyOpenGameApplicationsResponse.model_validate(
        {"items": [_valid_item()], "next_cursor": "opaque-page-token"}
    )
    assert set(response.model_dump()) == {"items", "next_cursor"}

    with pytest.raises(ValidationError):
        MyOpenGameApplication.model_validate(
            {**_valid_item(), "applicant_user_id": str(uuid.uuid4())}
        )
    with pytest.raises(ValidationError):
        MyOpenGameApplicationsResponse.model_validate(
            {"items": [], "next_cursor": None, "total": 1}
        )


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("applied_at", "2026-08-30T09:00:00"),
        ("starts_at", datetime(2026, 9, 6, 18)),
        ("ends_at", "2026-09-06T20:00:00"),
        ("detail_path", "/pages/captain-game-public/index?token=too-short"),
        ("detail_path", "/pages/captain-game-public/index?token=AbCdEfGhIjKlMnOpQrStUvWxYz01234!"),
        ("time_zone", "UTC+8"),
    ],
)
def test_my_application_rejects_ambiguous_or_invalid_public_projection(
    field: str, value: object
) -> None:
    with pytest.raises((ValidationError, ZoneInfoNotFoundError)):
        MyOpenGameApplication.model_validate({**_valid_item(), field: value})


def test_my_application_accepts_every_effective_status_and_aware_datetimes() -> None:
    for status in ("APPLIED", "JOINED", "REJECTED", "CANCELLED"):
        item = MyOpenGameApplication.model_validate(
            {**_valid_item(), "effective_status": status}
        )
        assert item.effective_status == status
        assert item.applied_at.tzinfo is not None
        assert item.starts_at.tzinfo is not None
        assert item.ends_at.tzinfo is not None

    invalid = {**_valid_item(), "effective_status": "PENDING"}
    with pytest.raises(ValidationError):
        MyOpenGameApplication.model_validate(invalid)
