from collections.abc import Iterator
from datetime import date, timedelta
from zoneinfo import ZoneInfo

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.orm import Session

from backend.app.database import get_database
from backend.app.main import create_app
from backend.app.models import Pitch, VenueFacility, VenueImage
from backend.tests.test_schema_constraints import DATABASE_URL, venue


@pytest.fixture(scope="module")
def venue_engine() -> Iterator[Engine]:
    engine = create_engine(DATABASE_URL)
    migration_config = Config("alembic.ini")
    migration_config.set_main_option("sqlalchemy.url", DATABASE_URL)
    command.downgrade(migration_config, "base")
    command.upgrade(migration_config, "head")
    yield engine
    command.downgrade(migration_config, "base")
    engine.dispose()


@pytest.fixture
def venue_client(venue_engine: Engine) -> Iterator[TestClient]:
    with venue_engine.begin() as connection:
        for table in ("slots", "pitches", "venue_facilities", "venue_images", "venues"):
            connection.execute(text(f"TRUNCATE TABLE {table} CASCADE"))

    def database_override() -> Iterator[Session]:
        with Session(venue_engine) as session:
            yield session

    app = create_app()
    app.dependency_overrides[get_database] = database_override
    with TestClient(app, raise_server_exceptions=False) as client:
        yield client


def seed_primary(engine: Engine, *, include_cover: bool = True) -> None:
    with Session(engine) as session:
        parent = venue(is_primary=True)
        session.add(parent)
        if include_cover:
            session.add(
                VenueImage(
                    venue=parent,
                    url="https://assets.example.com/venues/cover.jpg",
                    alt="场馆主图",
                    role="COVER",
                    sort_order=0,
                )
            )
        session.add(
            VenueImage(
                venue=parent,
                url="https://assets.example.com/venues/gallery.jpg",
                alt="场馆相册",
                role="GALLERY",
                sort_order=2,
            )
        )
        session.add_all(
            [
                VenueFacility(
                    venue=parent, code="PARKING", name="停车场", sort_order=2
                ),
                VenueFacility(
                    venue=parent, code="LIGHTING", name="专业夜场照明", sort_order=0
                ),
                Pitch(
                    venue=parent,
                    code="SEVEN-A",
                    name="七人制 A 场",
                    pitch_type="SEVEN_A_SIDE",
                    sort_order=2,
                ),
                Pitch(
                    venue=parent,
                    code="FIVE-A",
                    name="五人制 A 场",
                    pitch_type="FIVE_A_SIDE",
                    sort_order=0,
                ),
            ]
        )
        session.commit()


def test_primary_venue_matches_contract_and_is_sorted(
    venue_client: TestClient, venue_engine: Engine
) -> None:
    seed_primary(venue_engine)

    response = venue_client.get("/api/v1/venues/primary")

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {
        "id",
        "name",
        "description",
        "price_advantage_text",
        "timezone",
        "business_hours_text",
        "address",
        "latitude",
        "longitude",
        "parking_text",
        "phone",
        "refund_policy_summary",
        "images",
        "facilities",
        "pitch_types",
        "availability_window",
        "generated_at",
    }
    assert [item["sort_order"] for item in body["images"]] == [0, 2]
    assert [item["sort_order"] for item in body["facilities"]] == [0, 2]
    assert [item["code"] for item in body["pitch_types"]] == [
        "FIVE_A_SIDE",
        "SEVEN_A_SIDE",
    ]
    assert sum(image["role"] == "COVER" for image in body["images"]) == 1
    today = body["availability_window"]["start_date"]
    assert body["availability_window"]["end_date"] == str(
        date.fromisoformat(today) + timedelta(days=13)
    )
    assert body["generated_at"].endswith("+08:00")


def test_no_primary_is_misconfiguration_but_health_stays_available(
    venue_client: TestClient,
) -> None:
    response = venue_client.get("/api/v1/venues/primary")

    assert response.status_code == 500
    assert response.json()["error"]["code"] == "PRIMARY_VENUE_MISCONFIGURED"
    assert venue_client.get("/api/v1/health").status_code == 200


def test_missing_cover_is_misconfiguration(
    venue_client: TestClient, venue_engine: Engine
) -> None:
    seed_primary(venue_engine, include_cover=False)

    response = venue_client.get("/api/v1/venues/primary")

    assert response.status_code == 500
    assert response.json()["error"]["code"] == "PRIMARY_VENUE_MISCONFIGURED"


def test_runtime_uses_named_shanghai_timezone() -> None:
    assert ZoneInfo("Asia/Shanghai").key == "Asia/Shanghai"
