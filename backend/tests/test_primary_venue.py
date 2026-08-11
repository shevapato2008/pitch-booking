from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, select, text
from sqlalchemy.orm import Session

from backend.app.database import get_database
from backend.app.main import create_app
from backend.app.models import Pitch, Slot, VenueFacility, VenueImage
from backend.app.modules.venues.repository import VenueRepository
from backend.tests.test_schema_constraints import venue

pytestmark = pytest.mark.integration


@pytest.fixture(scope="module")
def venue_engine(pg_engine: Engine) -> Engine:
    return pg_engine


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
        parent = venue(
            is_primary=True,
            description="已发布场馆介绍",
            profile_version=4,
            public_pitch_types=["SEVEN_A_SIDE"],
        )
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
        five = Pitch(
            venue=parent,
            code="FIVE-A",
            name="五人制 A 场",
            pitch_type="FIVE_A_SIDE",
            sort_order=0,
        )
        seven = Pitch(
            venue=parent,
            code="SEVEN-A",
            name="七人制 A 场",
            pitch_type="SEVEN_A_SIDE",
            sort_order=2,
        )
        inactive = Pitch(
            venue=parent,
            code="FIVE-INACTIVE",
            name="停用五人制场",
            pitch_type="FIVE_A_SIDE",
            sort_order=4,
            status="INACTIVE",
        )
        session.add_all(
            [
                VenueFacility(
                    venue=parent, code="PARKING", name="停车场", sort_order=2
                ),
                VenueFacility(
                    venue=parent, code="AED", name="AED", sort_order=1
                ),
                VenueFacility(
                    venue=parent, code="LIGHTING", name="专业夜场照明", sort_order=0
                ),
                five,
                seven,
                inactive,
            ]
        )
        session.flush()
        future = datetime.now(UTC) + timedelta(days=3)
        session.add_all(
            [
                Slot(
                    pitch=five,
                    starts_at=future,
                    ends_at=future + timedelta(hours=1),
                    status="AVAILABLE",
                    price_cents=36000,
                ),
                Slot(
                    pitch=seven,
                    starts_at=future + timedelta(hours=2),
                    ends_at=future + timedelta(hours=3),
                    status="AVAILABLE",
                    price_cents=28000,
                ),
                Slot(
                    pitch=inactive,
                    starts_at=future,
                    ends_at=future + timedelta(hours=1),
                    status="AVAILABLE",
                    price_cents=100,
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
        "profile",
        "price_advantage_text",
        "timezone",
        "business_hours_text",
        "address",
        "latitude",
        "longitude",
        "parking_text",
        "refund_policy_summary",
        "pitch_types",
        "availability_window",
        "generated_at",
    }
    profile = body["profile"]
    assert set(profile) == {
        "publication_state",
        "published_version",
        "description",
        "cover_image",
        "images",
        "facilities",
        "pitch_sizes",
        "live_price",
        "availability_target",
    }
    assert profile["publication_state"] == "PUBLISHED"
    assert profile["published_version"] == 4
    assert profile["description"] == "已发布场馆介绍"
    assert [item["sort_order"] for item in profile["images"]] == [0, 2]
    assert [item["sort_order"] for item in profile["facilities"]] == [0, 1, 2]
    assert profile["pitch_sizes"] == ["FIVE_A_SIDE", "SEVEN_A_SIDE"]
    assert profile["live_price"] == {
        "available": True,
        "from_price_cents": 28000,
        "currency": "CNY",
        "unit": "HOUR",
    }
    assert profile["availability_target"] == {
        "enabled": True,
        "label": "查看可订时段",
        "path": f"/api/v1/venues/{body['id']}/availability",
    }
    assert [item["code"] for item in body["pitch_types"]] == [
        "FIVE_A_SIDE",
        "SEVEN_A_SIDE",
    ]
    assert sum(image["role"] == "COVER" for image in profile["images"]) == 1
    serialized = response.text
    for forbidden in (
        "phone",
        "current_revision",
        "object_key",
        "signed_put_url",
    ):
        assert forbidden not in serialized
    assert not {"description", "images", "facilities"} & set(body)
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


def test_published_profile_allows_a_missing_cover(
    venue_client: TestClient, venue_engine: Engine
) -> None:
    seed_primary(venue_engine, include_cover=False)

    response = venue_client.get("/api/v1/venues/primary")

    assert response.status_code == 200
    assert response.json()["profile"]["cover_image"] is None


def test_minimum_available_price_uses_explicit_now_and_active_pitches(
    venue_engine: Engine,
) -> None:
    seed_primary(venue_engine)
    with Session(venue_engine) as session:
        primary_pitch = session.scalar(select(Pitch).order_by(Pitch.sort_order))
        assert primary_pitch is not None
        primary = primary_pitch.venue
        now = datetime.now(UTC)

        repository = VenueRepository(session)
        assert repository.minimum_available_price(primary.id, now) == 28000
        assert repository.minimum_available_price(
            primary.id, now + timedelta(days=4)
        ) is None


def test_runtime_uses_named_shanghai_timezone() -> None:
    assert ZoneInfo("Asia/Shanghai").key == "Asia/Shanghai"
