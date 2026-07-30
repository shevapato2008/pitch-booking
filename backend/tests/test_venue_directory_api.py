import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from backend.app.database import get_database
from backend.app.main import create_app
from backend.app.models import BookingMode, Venue
from backend.app.modules.venues.loader import VenueDirectoryLoader
from scripts.seed_demo import run_seed

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "deploy" / "venue-directory.json"
SCHEMA = ROOT / "deploy" / "venue-directory.schema.json"
ONLINE_ID = "7e68d7d8-4b7e-4f04-a5c5-3fe263e69c6f"
DIRECTORY_ID = "e03d801d-1254-5c62-9a16-9a8800280162"
EXPECTED_ORDER = [
    ONLINE_ID,
    DIRECTORY_ID,
    "2a9640a5-f625-5ad8-9cb9-3440acb70967",
    "80532433-8038-5ee5-9963-3e6282aa4abd",
    "c0372328-6fa4-585a-b951-3324925763d6",
]


@pytest.fixture
def directory_client(pg_engine: Engine) -> Iterator[TestClient]:
    def database_override() -> Iterator[Session]:
        with Session(pg_engine) as session:
            yield session

    app = create_app()
    app.dependency_overrides[get_database] = database_override
    with TestClient(app, raise_server_exceptions=False) as client:
        yield client


def _load_directory(
    engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("APP_ENV", "test")
    run_seed(
        anchor="2026-07-30",
        days=1,
        database_url=engine.url.render_as_string(hide_password=False),
    )
    with Session(engine) as session:
        VenueDirectoryLoader(session).load(
            manifest_path=MANIFEST,
            schema_path=SCHEMA,
            environment="development",
        )


@pytest.mark.integration
def test_map_is_strict_stably_ordered_and_excludes_internal_evidence(
    pg_engine: Engine,
    directory_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _load_directory(pg_engine, monkeypatch)

    response = directory_client.get("/api/v1/venues/map")

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"coordinate_system", "venues"}
    assert body["coordinate_system"] == "GCJ02"
    assert [venue["id"] for venue in body["venues"]] == EXPECTED_ORDER
    assert [venue["booking_mode"] for venue in body["venues"]] == [
        "ONLINE",
        "DIRECTORY_ONLY",
        "DIRECTORY_ONLY",
        "DIRECTORY_ONLY",
        "DIRECTORY_ONLY",
    ]
    expected_fields = {
        "id",
        "name",
        "address",
        "latitude",
        "longitude",
        "booking_mode",
        "pitch_types",
        "cover_image",
        "nearest_transit",
        "content_verified_at",
    }
    assert all(set(venue) == expected_fields for venue in body["venues"])
    serialized = response.text
    for forbidden in ("source_url", "source_name", "verifier", "user_latitude"):
        assert forbidden not in serialized


@pytest.mark.integration
def test_public_predicate_excludes_inactive_and_unlisted_venues(
    pg_engine: Engine,
    directory_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _load_directory(pg_engine, monkeypatch)
    with Session(pg_engine) as session:
        inactive = session.get_one(Venue, uuid.UUID(EXPECTED_ORDER[3]))
        unlisted = session.get_one(Venue, uuid.UUID(EXPECTED_ORDER[4]))
        inactive_id = inactive.id
        unlisted_id = unlisted.id
        inactive.is_active = False
        unlisted.is_listed = False
        session.commit()

    response = directory_client.get("/api/v1/venues/map")

    assert response.status_code == 200
    assert [venue["id"] for venue in response.json()["venues"]] == EXPECTED_ORDER[:3]
    assert directory_client.get(f"/api/v1/venues/{inactive_id}").status_code == 404
    assert directory_client.get(f"/api/v1/venues/{unlisted_id}").status_code == 404


@pytest.mark.integration
def test_online_and_directory_details_are_closed_discriminated_variants(
    pg_engine: Engine,
    directory_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _load_directory(pg_engine, monkeypatch)

    online = directory_client.get(f"/api/v1/venues/{ONLINE_ID}")
    directory = directory_client.get(f"/api/v1/venues/{DIRECTORY_ID}")

    assert online.status_code == directory.status_code == 200
    online_body = online.json()
    directory_body = directory.json()
    assert online_body["booking_mode"] == "ONLINE"
    assert directory_body["booking_mode"] == "DIRECTORY_ONLY"
    for required in (
        "price_advantage_text",
        "timezone",
        "phone",
        "refund_policy_summary",
        "availability_window",
    ):
        assert required in online_body
        assert required not in directory_body
    assert directory_body["business_hours_text"] is None
    assert directory_body["parking_text"] is None
    assert directory_body["images"] == []
    assert directory_body["facilities"] == []
    assert directory_body["pitch_types"] == ["FIVE_A_SIDE"]
    assert set(directory_body["nearest_transit"][0]) == {
        "kind",
        "name",
        "lines",
        "distance_meters",
        "distance_basis",
    }


@pytest.mark.integration
def test_unknown_uuid_and_literal_route_precedence(
    pg_engine: Engine,
    directory_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _load_directory(pg_engine, monkeypatch)

    assert directory_client.get("/api/v1/venues/map").status_code == 200
    assert directory_client.get("/api/v1/venues/primary").status_code == 200
    missing = directory_client.get(f"/api/v1/venues/{uuid.uuid4()}")
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "VENUE_NOT_FOUND"


@pytest.mark.integration
def test_empty_public_directory_is_a_named_misconfiguration(
    directory_client: TestClient,
) -> None:
    response = directory_client.get("/api/v1/venues/map")

    assert response.status_code == 500
    assert response.json()["error"]["code"] == "VENUE_DIRECTORY_MISCONFIGURED"


def test_map_service_rejects_a_primary_that_is_not_online() -> None:
    class InvalidRepository:
        def list_public(self) -> list[Venue]:
            return [
                Venue(
                    id=uuid.uuid4(),
                    slug="invalid-primary",
                    name="Invalid",
                    description="",
                    address="Invalid",
                    latitude=39.0,
                    longitude=117.0,
                    booking_mode=BookingMode.DIRECTORY_ONLY,
                    navigation_poi_name="Invalid",
                    navigation_latitude=39.0,
                    navigation_longitude=117.0,
                    sort_order=0,
                    content_verified_at="2026-07-30T00:00:00+00:00",
                    is_listed=True,
                    public_pitch_types=[],
                    is_primary=True,
                    is_active=True,
                )
            ]

        def get_public(self, venue_id: uuid.UUID) -> Venue | None:
            return None

    from backend.app.modules.venues.service import VenueDirectoryService

    with pytest.raises(Exception) as raised:
        VenueDirectoryService(InvalidRepository()).get_map()
    assert getattr(raised.value, "code", None) == "VENUE_DIRECTORY_MISCONFIGURED"
