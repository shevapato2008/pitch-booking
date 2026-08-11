import hashlib
from collections.abc import Iterator
from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, select
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

TOKEN = "admin-inventory-token-0000000000000001"


def _client(engine: Engine) -> TestClient:
    app = create_app()

    def database_override() -> Iterator[Session]:
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_database] = database_override
    return TestClient(app, raise_server_exceptions=False)


def _seed(engine: Engine) -> tuple[Venue, Pitch, Pitch, User]:
    with Session(engine) as session:
        venue = Venue(
            slug="admin-inventory",
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
            sort_order=0,
        )
        five = Pitch(
            venue=venue,
            code="five-1",
            name="滨河场",
            pitch_type=PitchType.FIVE_A_SIDE,
            sort_order=1,
        )
        user = User(wechat_app_id="wx-test", wechat_openid="inventory-admin")
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
        for row in (venue, seven, five, user):
            session.refresh(row)
            session.expunge(row)
        return venue, seven, five, user


def _future_local_date() -> str:
    return str(datetime.now(ZoneInfo("Asia/Shanghai")).date() + timedelta(days=1))


def _auth() -> dict[str, str]:
    return {"Authorization": f"Bearer {TOKEN}"}


def test_inventory_requires_active_manage_membership_and_bootstraps_pitch_picker(
    pg_engine: Engine,
) -> None:
    venue, seven, five, user = _seed(pg_engine)
    local_date = _future_local_date()
    client = _client(pg_engine)

    response = client.get(
        f"/api/v1/admin/venues/{venue.id}/inventory?local_date={local_date}",
        headers=_auth(),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["venue"] == {
        "id": str(venue.id),
        "name": "渤海元丰足球场",
        "timezone": "Asia/Shanghai",
    }
    assert body["selected_pitch_id"] == str(five.id)
    assert body["local_date"] == local_date
    assert body["pitches"] == [
        {
            "id": str(five.id),
            "name": "滨河场",
            "display_name": "滨河场",
            "pitch_type": "FIVE_A_SIDE",
            "players_per_side": 5,
        },
        {
            "id": str(seven.id),
            "name": "A场",
            "display_name": "A场",
            "pitch_type": "SEVEN_A_SIDE",
            "players_per_side": 7,
        },
    ]
    assert body["slots"] == []

    with Session(pg_engine) as session:
        membership = session.scalar(
            select(VenueMembership).where(VenueMembership.user_id == user.id)
        )
        assert membership is not None
        membership.can_manage_inventory = False
        session.commit()

    denied = client.get(
        f"/api/v1/admin/venues/{venue.id}/inventory?local_date={local_date}",
        headers=_auth(),
    )
    assert denied.status_code == 403
    assert denied.json()["error"]["code"] == "INVENTORY_FORBIDDEN"


def test_admin_can_create_replay_and_update_available_slot(pg_engine: Engine) -> None:
    venue, seven, _five, _user = _seed(pg_engine)
    local_date = _future_local_date()
    client = _client(pg_engine)
    request = {
        "pitch_id": str(seven.id),
        "local_date": local_date,
        "start_time": "09:30",
        "end_time": "11:00",
        "price_cents": 20000,
    }

    created = client.post(
        f"/api/v1/admin/venues/{venue.id}/inventory/slots",
        headers={**_auth(), "Idempotency-Key": "create-admin-slot-00000001"},
        json=request,
    )
    replay = client.post(
        f"/api/v1/admin/venues/{venue.id}/inventory/slots",
        headers={**_auth(), "Idempotency-Key": "create-admin-slot-00000001"},
        json=request,
    )
    assert created.status_code == replay.status_code == 201
    assert created.content == replay.content
    slot = created.json()
    assert slot["status"] == "AVAILABLE"
    assert slot["checkout_version"] == 1
    assert slot["editable"] is True
    assert slot["read_only_reason"] is None

    updated = client.put(
        f"/api/v1/admin/venues/{venue.id}/inventory/slots/{slot['id']}",
        headers=_auth(),
        json={
            "price_cents": 26000,
            "status": "CLOSED",
            "expected_checkout_version": 1,
        },
    )
    assert updated.status_code == 200
    assert updated.json()["price_cents"] == 26000
    assert updated.json()["status"] == "CLOSED"
    assert updated.json()["checkout_version"] == 2

    stale = client.put(
        f"/api/v1/admin/venues/{venue.id}/inventory/slots/{slot['id']}",
        headers=_auth(),
        json={
            "price_cents": 28000,
            "status": "AVAILABLE",
            "expected_checkout_version": 1,
        },
    )
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "INVENTORY_VERSION_CONFLICT"


def test_locked_and_booked_slots_are_read_only(pg_engine: Engine) -> None:
    venue, seven, _five, _user = _seed(pg_engine)
    local_date = _future_local_date()
    timezone = ZoneInfo("Asia/Shanghai")
    starts_at = datetime.combine(
        datetime.fromisoformat(local_date).date(), time(14), timezone
    )
    with Session(pg_engine) as session:
        slot = Slot(
            pitch_id=seven.id,
            starts_at=starts_at.astimezone(UTC),
            ends_at=(starts_at + timedelta(hours=2)).astimezone(UTC),
            status=SlotStatus.BOOKED,
            price_cents=32000,
        )
        session.add(slot)
        session.commit()
        slot_id = slot.id

    client = _client(pg_engine)
    listed = client.get(
        f"/api/v1/admin/venues/{venue.id}/inventory",
        params={"local_date": local_date, "pitch_id": str(seven.id)},
        headers=_auth(),
    )
    assert listed.status_code == 200
    assert listed.json()["slots"][0]["status"] == "BOOKED"
    assert listed.json()["slots"][0]["editable"] is False
    assert listed.json()["slots"][0]["read_only_reason"] == "ALREADY_BOOKED"

    update = client.put(
        f"/api/v1/admin/venues/{venue.id}/inventory/slots/{slot_id}",
        headers=_auth(),
        json={
            "price_cents": 30000,
            "status": "CLOSED",
            "expected_checkout_version": 1,
        },
    )
    assert update.status_code == 409
    assert update.json()["error"]["code"] == "INVENTORY_SLOT_READ_ONLY"


@pytest.mark.parametrize(
    ("start_time", "end_time"),
    [("09:15", "11:00"), ("09:30", "11:10"), ("11:00", "09:30")],
)
def test_create_rejects_invalid_half_hour_boundaries(
    pg_engine: Engine, start_time: str, end_time: str
) -> None:
    venue, seven, _five, _user = _seed(pg_engine)
    response = _client(pg_engine).post(
        f"/api/v1/admin/venues/{venue.id}/inventory/slots",
        headers={**_auth(), "Idempotency-Key": "invalid-admin-slot-000001"},
        json={
            "pitch_id": str(seven.id),
            "local_date": _future_local_date(),
            "start_time": start_time,
            "end_time": end_time,
            "price_cents": 20000,
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_ARGUMENT"
