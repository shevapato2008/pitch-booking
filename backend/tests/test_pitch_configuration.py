import hashlib
from collections.abc import Iterator
from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from backend.app.database import get_database
from backend.app.main import create_app
from backend.app.models import (
    Pitch,
    PitchType,
    Slot,
    SlotStatus,
    User,
    UserSession,
    Venue,
    VenueMembership,
)

pytestmark = pytest.mark.integration

TOKEN = "pitch-configuration-token-00000001"


def _client(engine: Engine) -> TestClient:
    app = create_app()

    def database_override() -> Iterator[Session]:
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_database] = database_override
    return TestClient(app, raise_server_exceptions=False)


def _seed(engine: Engine) -> tuple[Venue, Pitch, Pitch]:
    with Session(engine) as session:
        venue = Venue(
            slug="pitch-configuration",
            name="渤海元丰足球场",
            description="测试场馆",
            price_advantage_text="价格透明",
            timezone="Asia/Shanghai",
            business_hours_text="09:00-23:00",
            address="天津市测试路 1 号",
            district_code="120101",
            district_name="和平区",
            parking_text="可停车",
            phone="13800000000",
            refund_policy_text="按规则退款",
            latitude=39.1,
            longitude=117.2,
            navigation_poi_name="渤海元丰足球场",
            navigation_latitude=39.1,
            navigation_longitude=117.2,
            public_pitch_types=["FIVE_A_SIDE", "SEVEN_A_SIDE"],
            is_primary=True,
            is_active=True,
        )
        seven = Pitch(
            venue=venue,
            code="seven-a",
            name="A场",
            pitch_type=PitchType.SEVEN_A_SIDE,
            sort_order=1,
        )
        five = Pitch(
            venue=venue,
            code="five-a",
            name="滨河场",
            pitch_type=PitchType.FIVE_A_SIDE,
            sort_order=0,
        )
        user = User(wechat_app_id="wx-test", wechat_openid="pitch-config-admin")
        session.add_all([venue, seven, five, user])
        session.flush()
        session.add_all(
            [
                VenueMembership(
                    venue_id=venue.id,
                    user_id=user.id,
                    is_active=True,
                    can_manage_inventory=True,
                ),
                UserSession(
                    user_id=user.id,
                    token_hash=hashlib.sha256(TOKEN.encode()).hexdigest(),
                    issued_at=datetime.now(UTC) - timedelta(minutes=1),
                    expires_at=datetime.now(UTC) + timedelta(hours=1),
                ),
            ]
        )
        session.commit()
        for row in (venue, seven, five):
            session.refresh(row)
            session.expunge(row)
        return venue, seven, five


def _auth(key: str | None = None) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {TOKEN}"}
    if key is not None:
        headers["Idempotency-Key"] = key
    return headers


def test_runtime_openapi_exposes_versioned_idempotent_configuration_contract() -> None:
    schema = create_app().openapi()
    path = schema["paths"]["/api/v1/admin/venues/{venue_id}/pitch-configuration"]
    assert set(path) == {"get", "put"}
    headers = {item["name"]: item for item in path["put"]["parameters"]}
    assert headers["Idempotency-Key"]["required"] is True
    response = schema["components"]["schemas"]["PitchConfigurationResponse"]
    assert {
        "venue",
        "configuration_version",
        "pitches",
        "created_pitch_mappings",
    } == set(response["required"])


def test_get_returns_authoritative_sorted_configuration_and_capabilities(
    pg_engine: Engine,
) -> None:
    venue, seven, five = _seed(pg_engine)
    response = _client(pg_engine).get(
        f"/api/v1/admin/venues/{venue.id}/pitch-configuration", headers=_auth()
    )

    assert response.status_code == 200
    body = response.json()
    assert body["venue"] == {
        "id": str(venue.id),
        "name": "渤海元丰足球场",
        "timezone": "Asia/Shanghai",
    }
    assert body["configuration_version"] == 1
    assert [pitch["id"] for pitch in body["pitches"]] == [str(five.id), str(seven.id)]
    assert body["pitches"][0] | {"capabilities": None} == {
        "id": str(five.id),
        "custom_name": None,
        "system_name": "滨河场",
        "display_name": "滨河场",
        "players_per_side": 5,
        "sequence": 1,
        "status": "ACTIVE",
        "capabilities": None,
    }
    assert body["pitches"][0]["capabilities"] == {
        "edit_format": {"allowed": True, "reason": None},
        "delete": {"allowed": True, "reason": None},
        "deactivate": {"allowed": True, "reason": None},
        "reactivate": {"allowed": False, "reason": "PITCH_ALREADY_ACTIVE"},
        "future_blockers": {"AVAILABLE": 0, "LOCKED": 0, "BOOKED": 0},
    }


def test_put_atomically_creates_updates_and_replays_before_version_check(
    pg_engine: Engine,
) -> None:
    venue, seven, _five = _seed(pg_engine)
    client = _client(pg_engine)
    request = {
        "expected_version": 1,
        "changes": [
            {
                "operation": "CREATE",
                "client_ref": "draft-eight-1",
                "custom_name": "  训练   场  ",
                "players_per_side": 8,
            },
            {
                "operation": "UPDATE",
                "pitch_id": str(seven.id),
                "custom_name": "主场",
                "players_per_side": 7,
                "status": "ACTIVE",
            },
        ],
    }
    key = "save-pitch-configuration-000001"

    created = client.put(
        f"/api/v1/admin/venues/{venue.id}/pitch-configuration",
        headers=_auth(key),
        json=request,
    )
    assert created.status_code == 200
    assert created.json()["configuration_version"] == 2
    mapping = created.json()["created_pitch_mappings"]
    assert mapping[0]["client_ref"] == "draft-eight-1"
    assert mapping[0]["sequence"] == 1
    assert mapping[0]["system_name"] == "8人场 · 1号场"
    assert (
        next(p for p in created.json()["pitches"] if p["id"] == mapping[0]["pitch_id"])[
            "custom_name"
        ]
        == "训练 场"
    )

    with Session(pg_engine) as session:
        locked = session.get_one(Venue, venue.id)
        locked.configuration_version = 9
        session.commit()

    replay = client.put(
        f"/api/v1/admin/venues/{venue.id}/pitch-configuration",
        headers=_auth(key),
        json=request,
    )
    assert replay.status_code == 200
    assert replay.content == created.content


def test_put_rejects_stale_version_with_latest_configuration_and_duplicate_name(
    pg_engine: Engine,
) -> None:
    venue, seven, _five = _seed(pg_engine)
    client = _client(pg_engine)
    stale = client.put(
        f"/api/v1/admin/venues/{venue.id}/pitch-configuration",
        headers=_auth("stale-pitch-configuration-0001"),
        json={"expected_version": 2, "changes": []},
    )
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "CONFIGURATION_CHANGED"
    assert stale.json()["error"]["details"]["latest_configuration"]["configuration_version"] == 1

    conflict = client.put(
        f"/api/v1/admin/venues/{venue.id}/pitch-configuration",
        headers=_auth("name-pitch-configuration-00001"),
        json={
            "expected_version": 1,
            "changes": [
                {
                    "operation": "UPDATE",
                    "pitch_id": str(seven.id),
                    "custom_name": " 滨河场 ",
                    "players_per_side": 7,
                    "status": "ACTIVE",
                }
            ],
        },
    )
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "PITCH_NAME_CONFLICT"


def test_business_history_and_future_inventory_enforce_lifecycle_rules(
    pg_engine: Engine,
) -> None:
    venue, seven, five = _seed(pg_engine)
    timezone = ZoneInfo("Asia/Shanghai")
    starts_at = datetime.combine(
        datetime.now(timezone).date() + timedelta(days=1), time(14), timezone
    )
    with Session(pg_engine) as session:
        session.add(
            Slot(
                pitch_id=seven.id,
                starts_at=starts_at.astimezone(UTC),
                ends_at=(starts_at + timedelta(hours=2)).astimezone(UTC),
                status=SlotStatus.AVAILABLE,
                price_cents=26000,
            )
        )
        session.commit()

    client = _client(pg_engine)
    delete = client.put(
        f"/api/v1/admin/venues/{venue.id}/pitch-configuration",
        headers=_auth("delete-used-pitch-config-00001"),
        json={
            "expected_version": 1,
            "changes": [{"operation": "DELETE", "pitch_id": str(seven.id)}],
        },
    )
    assert delete.status_code == 409
    assert delete.json()["error"]["code"] == "PITCH_HAS_BUSINESS_HISTORY"

    deactivate = client.put(
        f"/api/v1/admin/venues/{venue.id}/pitch-configuration",
        headers=_auth("deactivate-pitch-config-00001"),
        json={
            "expected_version": 1,
            "changes": [
                {
                    "operation": "UPDATE",
                    "pitch_id": str(seven.id),
                    "custom_name": None,
                    "players_per_side": 7,
                    "status": "INACTIVE",
                }
            ],
        },
    )
    assert deactivate.status_code == 409
    assert deactivate.json()["error"]["code"] == "PITCH_DEACTIVATE_BLOCKED"
    assert deactivate.json()["error"]["details"]["future_blockers"] == {
        "AVAILABLE": 1,
        "LOCKED": 0,
        "BOOKED": 0,
    }

    last_active = client.put(
        f"/api/v1/admin/venues/{venue.id}/pitch-configuration",
        headers=_auth("last-active-pitch-config-00001"),
        json={
            "expected_version": 1,
            "changes": [
                {"operation": "DELETE", "pitch_id": str(five.id)},
                {
                    "operation": "UPDATE",
                    "pitch_id": str(seven.id),
                    "custom_name": None,
                    "players_per_side": 7,
                    "status": "INACTIVE",
                },
            ],
        },
    )
    assert last_active.status_code == 409


def test_same_existing_pitch_cannot_appear_twice(pg_engine: Engine) -> None:
    venue, seven, _five = _seed(pg_engine)
    response = _client(pg_engine).put(
        f"/api/v1/admin/venues/{venue.id}/pitch-configuration",
        headers=_auth("duplicate-pitch-change-000001"),
        json={
            "expected_version": 1,
            "changes": [
                {
                    "operation": "UPDATE",
                    "pitch_id": str(seven.id),
                    "custom_name": None,
                    "players_per_side": 7,
                    "status": "ACTIVE",
                },
                {"operation": "DELETE", "pitch_id": str(seven.id)},
            ],
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "DUPLICATE_PITCH_CHANGE"
