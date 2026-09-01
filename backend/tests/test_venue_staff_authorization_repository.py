import uuid

from sqlalchemy.dialects import postgresql
from sqlalchemy.sql import ClauseElement

from backend.app.modules.venue_staff.repository import VenueStaffRepository


class RecordingSession:
    def __init__(self) -> None:
        self.statement: object | None = None

    def scalar(self, statement: object) -> None:
        self.statement = statement
        return None


USER_ID = uuid.UUID("20000000-0000-0000-0000-000000000001")


def _sql(statement: object | None) -> str:
    assert isinstance(statement, ClauseElement)
    return str(
        statement.compile(
            dialect=postgresql.dialect(),  # type: ignore[no-untyped-call]
            compile_kwargs={"literal_binds": True},
        )
    )


def test_idempotency_lookup_matches_the_exact_actor_pair() -> None:
    session = RecordingSession()

    VenueStaffRepository(session).find_idempotency(  # type: ignore[arg-type]
        actor_user_id=USER_ID,
        actor_principal_id=None,
        operation="create_venue_staff_invitation",
        idempotency_key="create-staff-invitation-0001",
    )

    sql = _sql(session.statement)
    assert f"actor_user_id = '{USER_ID}'" in sql
    assert "actor_principal_id IS NULL" in sql
    assert " OR " not in sql
