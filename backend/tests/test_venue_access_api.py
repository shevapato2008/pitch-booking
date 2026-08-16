import uuid

from fastapi.testclient import TestClient
from sqlalchemy.dialects import postgresql

from backend.app.database import get_database
from backend.app.main import create_app
from backend.app.models import User, Venue
from backend.app.modules.auth.router import get_current_user

USER_ID = uuid.UUID("10000000-0000-0000-0000-000000000001")


class RecordingSession:
    def __init__(self, venues: list[Venue] | None = None) -> None:
        self.venues = venues or []
        self.statement: object | None = None

    def scalars(self, statement: object) -> list[Venue]:
        self.statement = statement
        return self.venues


def _venue(*, venue_id: str, name: str) -> Venue:
    return Venue(
        id=uuid.UUID(venue_id),
        slug=f"venue-{venue_id[-4:]}",
        name=name,
        description="测试场馆",
        price_advantage_text="价格透明",
        timezone="Asia/Shanghai",
        business_hours_text="09:00-23:00",
        address=f"天津市{name.strip()}路 1 号",
        district_code="120104",
        district_name="南开区",
        parking_text="可停车",
        phone="13800000000",
        refund_policy_text="按规则退款",
        latitude=39.1,
        longitude=117.2,
        navigation_poi_name=name,
        navigation_latitude=39.1,
        navigation_longitude=117.2,
        public_pitch_types=["FIVE_A_SIDE"],
        is_active=True,
    )


def _client(
    venues: list[Venue] | None = None, *, authenticated: bool = True
) -> tuple[TestClient, RecordingSession]:
    app = create_app()
    database = RecordingSession(venues)
    app.dependency_overrides[get_database] = lambda: database
    if authenticated:
        app.dependency_overrides[get_current_user] = lambda: User(
            id=USER_ID,
            wechat_app_id="wx-test",
            wechat_openid="managed-venues-user",
        )
    return TestClient(app, raise_server_exceptions=False), database


def _auth() -> dict[str, str]:
    return {"Authorization": "Bearer managed-venues-token-000000000000001"}


def test_managed_venues_requires_bearer_authentication() -> None:
    client, _database = _client(authenticated=False)

    response = client.get("/api/v1/admin/venues")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_REQUIRED"


def test_managed_venues_returns_empty_for_user_without_memberships() -> None:
    client, _database = _client()

    response = client.get("/api/v1/admin/venues", headers=_auth())

    assert response.status_code == 200
    assert response.json() == {"venues": []}


def test_managed_venues_returns_one_closed_venue_projection() -> None:
    client, _database = _client(
        [
            _venue(
                venue_id="00000000-0000-0000-0000-000000000001",
                name="渤海元丰足球场",
            )
        ]
    )

    response = client.get("/api/v1/admin/venues", headers=_auth())

    assert response.status_code == 200
    assert response.json() == {
        "venues": [
            {
                "id": "00000000-0000-0000-0000-000000000001",
                "name": "渤海元丰足球场",
                "district_name": "南开区",
                "address": "天津市渤海元丰足球场路 1 号",
            }
        ]
    }


def test_managed_venues_query_filters_authority_and_has_deterministic_order() -> None:
    venues = [
        _venue(
            venue_id="00000000-0000-0000-0000-000000000001",
            name=" alpha 场馆 ",
        ),
        _venue(
            venue_id="00000000-0000-0000-0000-000000000002",
            name="Alpha 场馆",
        ),
        _venue(
            venue_id="00000000-0000-0000-0000-000000000003",
            name=" bravo 场馆 ",
        ),
    ]
    client, database = _client(venues)

    response = client.get("/api/v1/admin/venues", headers=_auth())

    assert response.status_code == 200
    assert [venue["id"] for venue in response.json()["venues"]] == [
        "00000000-0000-0000-0000-000000000001",
        "00000000-0000-0000-0000-000000000002",
        "00000000-0000-0000-0000-000000000003",
    ]
    assert all(
        set(venue) == {"id", "name", "district_name", "address"}
        for venue in response.json()["venues"]
    )
    assert database.statement is not None
    sql = str(
        database.statement.compile(
            dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}
        )
    )
    assert "JOIN venue_memberships" in sql
    assert f"venue_memberships.user_id = '{USER_ID}'" in sql
    assert "venue_memberships.is_active IS true" in sql
    assert "venue_memberships.can_manage_inventory IS true" in sql
    assert "venues.is_active IS true" in sql
    assert "ORDER BY lower(trim(venues.name)), venues.id" in sql
