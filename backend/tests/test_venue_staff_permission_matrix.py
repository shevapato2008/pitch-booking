import uuid

from sqlalchemy.dialects import postgresql

from backend.app.models import VenueMembership
from backend.app.modules.inventory.repository import InventoryRepository
from backend.app.modules.pitch_configuration.repository import PitchConfigurationRepository
from backend.app.modules.venue_access.repository import VenueAccessRepository
from backend.app.modules.venue_fulfillment.repository import VenueFulfillmentRepository
from backend.app.modules.venue_profiles.repository import VenueProfileRepository


class RecordingSession:
    def __init__(self) -> None:
        self.statement: object | None = None

    def scalar(self, statement: object) -> None:
        self.statement = statement
        return None

    def scalars(self, statement: object) -> list[object]:
        self.statement = statement
        return []

    def execute(self, statement: object) -> object:
        self.statement = statement

        class EmptyResult:
            def all(self) -> list[object]:
                return []

        return EmptyResult()


VENUE_ID = uuid.UUID("10000000-0000-0000-0000-000000000001")
USER_ID = uuid.UUID("20000000-0000-0000-0000-000000000001")


def _sql(statement: object | None) -> str:
    assert statement is not None
    return str(
        statement.compile(
            dialect=postgresql.dialect(),
            compile_kwargs={"literal_binds": True},
        )
    )


def test_existing_modules_use_their_exact_staff_permission() -> None:
    session = RecordingSession()

    VenueProfileRepository(session).can_manage(VENUE_ID, USER_ID)  # type: ignore[arg-type]
    assert "venue_memberships.can_manage_profile IS true" in _sql(session.statement)

    PitchConfigurationRepository(session).can_manage(VENUE_ID, USER_ID)  # type: ignore[arg-type]
    assert "venue_memberships.can_manage_pitches IS true" in _sql(session.statement)

    InventoryRepository(session).can_manage_inventory(VENUE_ID, USER_ID)  # type: ignore[arg-type]
    assert "venue_memberships.can_manage_inventory IS true" in _sql(session.statement)

    VenueFulfillmentRepository(session).get_authorized_venue(  # type: ignore[arg-type]
        venue_id=VENUE_ID,
        user_id=USER_ID,
    )
    assert "venue_memberships.can_fulfill_orders IS true" in _sql(session.statement)


def test_workspace_lists_every_active_membership_without_inventing_a_permission_gate() -> None:
    session = RecordingSession()

    VenueAccessRepository(session).list_managed_venues(USER_ID)  # type: ignore[arg-type]

    sql = _sql(session.statement)
    assert "venue_memberships.is_active IS true" in sql
    for permission in (
        "can_manage_profile",
        "can_manage_pitches",
        "can_manage_inventory",
        "can_fulfill_orders",
    ):
        assert f"venue_memberships.{permission} IS true" not in sql


def test_membership_model_declares_all_closed_authority_fields() -> None:
    columns = VenueMembership.__table__.columns
    assert {
        "role",
        "can_manage_profile",
        "can_manage_pitches",
        "can_manage_inventory",
        "can_fulfill_orders",
        "version",
        "revoked_at",
    } <= set(columns.keys())
