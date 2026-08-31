from copy import deepcopy
from datetime import UTC, datetime, timedelta
from importlib import import_module
from types import ModuleType

import pytest
from pydantic import ValidationError

AUTHORITATIVE_NOW = datetime(2026, 8, 26, 4, tzinfo=UTC)


def _dto_module() -> ModuleType:
    try:
        module = import_module("backend.app.modules.public_games.dto")
    except ModuleNotFoundError:
        pytest.fail("public game directory DTO module is missing", pytrace=False)
    for name in (
        "PublicGameFormat",
        "PublicGameDirectoryItem",
        "PublicGameDirectoryResponse",
    ):
        if not hasattr(module, name):
            pytest.fail(f"public game directory DTO {name} is missing", pytrace=False)
    return module


def _item_payload(
    *,
    token_character: str,
    starts_at: datetime,
    local_date: str,
    format: str,
) -> dict[str, object]:
    if format == "FIVE":
        players_per_side = 5
        total_players = 10
        fixed_players = 4
        open_spots = 6
        current_players = 6
        remaining_spots = 4
    else:
        players_per_side = 7
        total_players = 14
        fixed_players = 8
        open_spots = 6
        current_players = 11
        remaining_spots = 3
    return {
        "detail_path": (
            "/pages/captain-game-public/index?token=" + token_character * 32
        ),
        "local_date": local_date,
        "format": format,
        "current_players": current_players,
        "remaining_spots": remaining_spots,
        "game": {
            "name": "周末公开球局",
            "team_name": "海河联队",
            "state": "PUBLISHED",
            "state_reason": None,
            "venue_name": "天津河东体育中心",
            "pitch_name": f"{players_per_side}人制 A 场",
            "pitch_specification": f"{players_per_side}人制",
            "starts_at": starts_at,
            "ends_at": starts_at + timedelta(hours=2),
            "time_zone": "Asia/Shanghai",
            "total_players": total_players,
            "fixed_players": fixed_players,
            "open_spots": open_spots,
            "intensity": "CASUAL",
            "minimum_experience": None,
            "positions": ["ANY"],
            "aa_cents": 3600,
            "registration_deadline": starts_at - timedelta(hours=3),
            "equipment_and_arrival_notes": None,
            "visibility": "PUBLIC",
        },
    }


def _response_payload() -> dict[str, object]:
    return {
        "authoritative_now": AUTHORITATIVE_NOW,
        "available_dates": ["2026-08-29", "2026-08-30"],
        "items": [
            _item_payload(
                token_character="a",
                starts_at=datetime(2026, 8, 28, 23, 30, tzinfo=UTC),
                local_date="2026-08-29",
                format="FIVE",
            ),
            _item_payload(
                token_character="b",
                starts_at=datetime(2026, 8, 30, 10, tzinfo=UTC),
                local_date="2026-08-30",
                format="SEVEN",
            ),
        ],
    }


def test_directory_models_freeze_the_closed_public_shape() -> None:
    dto = _dto_module()

    assert [member.value for member in dto.PublicGameFormat] == ["FIVE", "SEVEN"]
    response = dto.PublicGameDirectoryResponse.model_validate(_response_payload())
    body = response.model_dump(mode="json")
    assert set(body) == {"authoritative_now", "available_dates", "items"}
    assert set(body["items"][0]) == {
        "detail_path",
        "local_date",
        "format",
        "current_players",
        "remaining_spots",
        "game",
    }

    for private_field, location in (
        ("cursor", "response"),
        ("order_id", "item"),
        ("captain_user_id", "game"),
    ):
        payload = deepcopy(_response_payload())
        if location == "response":
            payload[private_field] = "private"
        elif location == "item":
            payload["items"][0][private_field] = "private"  # type: ignore[index]
        else:
            payload["items"][0]["game"][private_field] = "private"  # type: ignore[index]
        with pytest.raises(ValidationError):
            dto.PublicGameDirectoryResponse.model_validate(payload)


def test_directory_response_requires_aware_time_sorted_dates_and_stable_items() -> None:
    dto = _dto_module()

    invalid_payloads = []
    naive = deepcopy(_response_payload())
    naive["authoritative_now"] = AUTHORITATIVE_NOW.replace(tzinfo=None)
    invalid_payloads.append(naive)

    duplicate_dates = deepcopy(_response_payload())
    duplicate_dates["available_dates"] = ["2026-08-29", "2026-08-29"]
    invalid_payloads.append(duplicate_dates)

    unsorted_dates = deepcopy(_response_payload())
    unsorted_dates["available_dates"] = ["2026-08-30", "2026-08-29"]
    invalid_payloads.append(unsorted_dates)

    unstable_items = deepcopy(_response_payload())
    unstable_items["items"].reverse()  # type: ignore[union-attr]
    invalid_payloads.append(unstable_items)

    for payload in invalid_payloads:
        with pytest.raises(ValidationError):
            dto.PublicGameDirectoryResponse.model_validate(payload)


def test_directory_response_requires_item_dates_in_available_dates() -> None:
    dto = _dto_module()
    payload = deepcopy(_response_payload())
    payload["available_dates"] = ["2026-08-30"]

    with pytest.raises(
        ValidationError,
        match="item local_date must belong to available_dates",
    ):
        dto.PublicGameDirectoryResponse.model_validate(payload)


def test_directory_item_local_date_matches_game_timezone() -> None:
    dto = _dto_module()
    payload = deepcopy(_response_payload())
    payload["items"][0]["local_date"] = "2026-08-28"  # type: ignore[index]

    with pytest.raises(
        ValidationError,
        match=r"local_date must match game\.starts_at in game\.time_zone",
    ):
        dto.PublicGameDirectoryResponse.model_validate(payload)


def test_directory_item_rejects_unknown_game_timezone() -> None:
    dto = _dto_module()
    payload = deepcopy(_response_payload())
    payload["items"][0]["game"]["time_zone"] = "Fake/Zone"  # type: ignore[index]

    with pytest.raises(
        ValidationError,
        match="game.time_zone must identify an available IANA time zone",
    ):
        dto.PublicGameDirectoryResponse.model_validate(payload)


def test_directory_item_rejects_published_state_reason() -> None:
    dto = _dto_module()
    payload = deepcopy(_response_payload())
    payload["items"][0]["game"][  # type: ignore[index]
        "state_reason"
    ] = "REGISTRATION_DEADLINE_PASSED"

    with pytest.raises(
        ValidationError,
        match="directory published game cannot have a state reason",
    ):
        dto.PublicGameDirectoryResponse.model_validate(payload)


def test_directory_items_enforce_public_format_capacity_and_future_authority() -> None:
    dto = _dto_module()

    invalid_payloads = []
    for field, value in (
        ("format", "ELEVEN"),
        ("current_players", 0),
        ("remaining_spots", -1),
    ):
        payload = deepcopy(_response_payload())
        payload["items"][0][field] = value  # type: ignore[index]
        invalid_payloads.append(payload)

    format_mismatch = deepcopy(_response_payload())
    format_mismatch["items"][0]["format"] = "SEVEN"  # type: ignore[index]
    invalid_payloads.append(format_mismatch)

    capacity_mismatch = deepcopy(_response_payload())
    capacity_mismatch["items"][0]["remaining_spots"] = 3  # type: ignore[index]
    invalid_payloads.append(capacity_mismatch)

    for field, value in (("state", "DRAFT"), ("visibility", "LINK_ONLY")):
        payload = deepcopy(_response_payload())
        payload["items"][0]["game"][field] = value  # type: ignore[index]
        invalid_payloads.append(payload)

    started = deepcopy(_response_payload())
    started["items"][0]["game"]["starts_at"] = AUTHORITATIVE_NOW  # type: ignore[index]
    invalid_payloads.append(started)

    deadline_closed = deepcopy(_response_payload())
    deadline_closed["items"][0]["game"]["registration_deadline"] = (  # type: ignore[index]
        AUTHORITATIVE_NOW
    )
    invalid_payloads.append(deadline_closed)

    for payload in invalid_payloads:
        with pytest.raises(ValidationError):
            dto.PublicGameDirectoryResponse.model_validate(payload)


@pytest.mark.parametrize(
    "detail_path",
    [
        "/pages/captain-game-public/index?token=" + "a" * 31,
        "/pages/captain-game-public/index?token=" + "a" * 33,
        "/pages/captain-game-public/index?token=" + "a" * 32 + "&extra=1",
        "/pages/c1b-game-detail/index?token=" + "a" * 32,
    ],
)
def test_directory_item_accepts_only_the_existing_exact_detail_path(
    detail_path: str,
) -> None:
    dto = _dto_module()
    payload = deepcopy(_response_payload())
    payload["items"][0]["detail_path"] = detail_path  # type: ignore[index]

    with pytest.raises(ValidationError):
        dto.PublicGameDirectoryResponse.model_validate(payload)
