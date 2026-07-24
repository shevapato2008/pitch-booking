import uuid
from collections.abc import Iterator
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.orm import Session

from backend.app.database import get_database
from backend.app.main import create_app
from backend.app.models import Pitch, Slot
from backend.tests.test_schema_constraints import DATABASE_URL, venue

SHANGHAI = ZoneInfo("Asia/Shanghai")


@pytest.fixture(scope="module")
def availability_engine() -> Iterator[Engine]:
    engine = create_engine(DATABASE_URL)
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", DATABASE_URL)
    command.downgrade(config, "base")
    command.upgrade(config, "head")
    yield engine
    command.downgrade(config, "base")
    engine.dispose()


@pytest.fixture
def availability_client(availability_engine: Engine) -> Iterator[TestClient]:
    with availability_engine.begin() as connection:
        for table in ("slots", "pitches", "venue_facilities", "venue_images", "venues"):
            connection.execute(text(f"TRUNCATE TABLE {table} CASCADE"))

    def database_override() -> Iterator[Session]:
        with Session(availability_engine) as session:
            yield session

    app = create_app()
    app.dependency_overrides[get_database] = database_override
    with TestClient(app, raise_server_exceptions=False) as client:
        yield client


def seed_venue(engine: Engine, *, include_seven: bool = False) -> tuple[uuid.UUID, uuid.UUID]:
    with Session(engine) as session:
        parent = venue(is_primary=True)
        five = Pitch(
            venue=parent,
            code="FIVE-A",
            name="五人制 A 场",
            pitch_type="FIVE_A_SIDE",
            sort_order=0,
        )
        session.add_all([parent, five])
        if include_seven:
            session.add(
                Pitch(
                    venue=parent,
                    code="SEVEN-A",
                    name="七人制 A 场",
                    pitch_type="SEVEN_A_SIDE",
                    sort_order=1,
                )
            )
        session.commit()
        return parent.id, five.id


def add_status_slot(
    engine: Engine,
    pitch_id: uuid.UUID,
    stored_status: str,
    local_day: date,
) -> uuid.UUID:
    starts_at = datetime.combine(local_day, time(9), SHANGHAI).astimezone(UTC)
    values: dict[str, object] = {}
    if stored_status == "LOCKED":
        values = {
            "locked_until": starts_at + timedelta(minutes=15),
            "locked_by_order_id": uuid.uuid4(),
        }
    with Session(engine) as session:
        row = Slot(
            pitch_id=pitch_id,
            starts_at=starts_at,
            ends_at=starts_at + timedelta(hours=1),
            status=stored_status,
            price_cents=36000,
            **values,
        )
        session.add(row)
        session.commit()
        return row.id


@pytest.mark.parametrize(
    ("stored", "day_offset", "expected", "reason"),
    [
        ("AVAILABLE", 1, "AVAILABLE", None),
        ("LOCKED", 1, "TEMPORARILY_LOCKED", "HELD_FOR_PAYMENT"),
        ("BOOKED", 1, "BOOKED", "ALREADY_BOOKED"),
        ("CLOSED", 1, "CLOSED", "VENUE_CLOSED"),
        ("AVAILABLE", 0, "EXPIRED", "TIME_PASSED"),
    ],
)
def test_status_projection(
    availability_client: TestClient,
    availability_engine: Engine,
    stored: str,
    day_offset: int,
    expected: str,
    reason: str | None,
) -> None:
    venue_id, pitch_id = seed_venue(availability_engine)
    local_day = datetime.now(SHANGHAI).date() + timedelta(days=day_offset)
    slot_id = add_status_slot(availability_engine, pitch_id, stored, local_day)

    response = availability_client.get(
        f"/api/v1/venues/{venue_id}/availability",
        params={"date": str(local_day), "pitch_type": "FIVE_A_SIDE"},
    )

    assert response.status_code == 200
    slot = response.json()["pitches"][0]["slots"][0]
    assert slot["id"] == str(slot_id)
    assert (slot["status"], slot["unavailable_reason"]) == (expected, reason)
    assert slot["starts_at"].endswith("+08:00")


@pytest.mark.parametrize(
    ("query", "code"),
    [
        ({"date": "bad", "pitch_type": "FIVE_A_SIDE"}, "INVALID_ARGUMENT"),
        (
            {"date": str(datetime.now(SHANGHAI).date()), "pitch_type": "ELEVEN_A_SIDE"},
            "INVALID_ARGUMENT",
        ),
        (
            {"date": str(datetime.now(SHANGHAI).date()), "pitch_type": "SEVEN_A_SIDE"},
            "PITCH_TYPE_NOT_SUPPORTED",
        ),
        (
            {
                "date": str(datetime.now(SHANGHAI).date() + timedelta(days=14)),
                "pitch_type": "FIVE_A_SIDE",
            },
            "DATE_OUT_OF_RANGE",
        ),
    ],
)
def test_query_errors_use_contract_envelope(
    availability_client: TestClient,
    availability_engine: Engine,
    query: dict[str, str],
    code: str,
) -> None:
    venue_id, _ = seed_venue(availability_engine)

    response = availability_client.get(
        f"/api/v1/venues/{venue_id}/availability", params=query
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == code
    assert response.json()["error"]["request_id"] == response.headers["X-Request-Id"]


def test_unknown_venue_is_404(availability_client: TestClient) -> None:
    response = availability_client.get(
        f"/api/v1/venues/{uuid.uuid4()}/availability",
        params={
            "date": str(datetime.now(SHANGHAI).date()),
            "pitch_type": "FIVE_A_SIDE",
        },
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "VENUE_NOT_FOUND"


def test_first_and_last_dates_are_inclusive_and_empty_is_200(
    availability_client: TestClient, availability_engine: Engine
) -> None:
    venue_id, _ = seed_venue(availability_engine)
    today = datetime.now(SHANGHAI).date()

    for local_day in (today, today + timedelta(days=13)):
        response = availability_client.get(
            f"/api/v1/venues/{venue_id}/availability",
            params={"date": str(local_day), "pitch_type": "FIVE_A_SIDE"},
        )
        assert response.status_code == 200
        assert response.json()["pitches"] == []
