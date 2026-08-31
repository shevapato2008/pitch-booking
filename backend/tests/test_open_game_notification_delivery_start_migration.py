from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
from alembic import command
from sqlalchemy import Engine, create_engine, inspect, text
from sqlalchemy.exc import DBAPIError

from backend.tests.postgres_test_database import (
    disposable_database,
    override_test_database_url,
)
from backend.tests.test_open_game_registration_schema import (
    _insert_registration,
    _seed_registration_parents,
    _valid_registration,
)
from backend.tests.test_open_game_registration_waitlist_migration import (
    _config,
    _insert_outbox,
    _revision,
)

pytestmark = pytest.mark.integration

COMPLETED_AT = datetime(2026, 8, 30, 12, 20, tzinfo=UTC)


@pytest.fixture  # type: ignore[untyped-decorator]
def migration_engine(test_database_url: str) -> Iterator[Engine]:
    with disposable_database(test_database_url) as migration_url:
        rendered = migration_url.render_as_string(hide_password=False)
        with override_test_database_url(rendered):
            engine = create_engine(migration_url)
            try:
                yield engine
            finally:
                engine.dispose()


def _seed_outbox(
    engine: Engine,
    *,
    overrides: dict[str, object] | None = None,
) -> UUID:
    _, game_id, applicant_ids = _seed_registration_parents(engine)
    registration_id = UUID("30000000-0000-0000-0000-000000000201")
    _insert_registration(
        engine,
        _valid_registration(
            registration_id=registration_id,
            game_id=game_id,
            applicant_user_id=applicant_ids[0],
        ),
    )
    _insert_outbox(
        engine,
        registration_id=registration_id,
        game_id=game_id,
        recipient_user_id=applicant_ids[0],
        overrides=overrides,
    )
    return UUID("30000000-0000-0000-0000-000000000101")


def test_0020_round_trips_when_delivery_has_not_started(
    migration_engine: Engine,
) -> None:
    config = _config(migration_engine)
    command.upgrade(config, "0019")
    _seed_outbox(migration_engine)

    command.upgrade(config, "0020")

    assert _revision(migration_engine) == "0020"
    columns = {
        column["name"]: column
        for column in inspect(migration_engine).get_columns(
            "open_game_notification_outbox"
        )
    }
    assert columns["delivery_started_at"]["nullable"] is True
    command.downgrade(config, "0019")
    assert _revision(migration_engine) == "0019"
    assert "delivery_started_at" not in {
        column["name"]
        for column in inspect(migration_engine).get_columns(
            "open_game_notification_outbox"
        )
    }


def test_0020_backfills_sent_history_and_refuses_lossy_downgrade(
    migration_engine: Engine,
) -> None:
    config = _config(migration_engine)
    command.upgrade(config, "0019")
    outbox_id = _seed_outbox(
        migration_engine,
        overrides={"status": "SENT", "completed_at": COMPLETED_AT},
    )

    command.upgrade(config, "0020")

    with migration_engine.connect() as connection:
        delivery_started_at = connection.execute(
            text(
                "SELECT delivery_started_at "
                "FROM open_game_notification_outbox WHERE id = :id"
            ),
            {"id": outbox_id},
        ).scalar_one()
    assert delivery_started_at == COMPLETED_AT
    with pytest.raises(RuntimeError, match="delivery-start history"):
        command.downgrade(config, "0019")
    assert _revision(migration_engine) == "0020"


def test_0020_constrains_send_start_semantics(
    migration_engine: Engine,
) -> None:
    config = _config(migration_engine)
    command.upgrade(config, "0019")
    outbox_id = _seed_outbox(migration_engine)
    command.upgrade(config, "0020")

    with pytest.raises(DBAPIError), migration_engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE open_game_notification_outbox "
                "SET delivery_started_at = :started WHERE id = :id"
            ),
            {"id": outbox_id, "started": COMPLETED_AT},
        )
    with pytest.raises(DBAPIError), migration_engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE open_game_notification_outbox "
                "SET status = 'SENT', completed_at = :completed "
                "WHERE id = :id"
            ),
            {"id": outbox_id, "completed": COMPLETED_AT},
        )

    with migration_engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE open_game_notification_outbox "
                "SET status = 'FAILED', completed_at = :completed, "
                "last_failure_code = 'INVALID_NOTIFICATION_DATA' "
                "WHERE id = :id"
            ),
            {"id": outbox_id, "completed": COMPLETED_AT},
        )


def test_0020_refuses_downgrade_after_claimed_send_start(
    migration_engine: Engine,
) -> None:
    config = _config(migration_engine)
    command.upgrade(config, "0019")
    outbox_id = _seed_outbox(migration_engine)
    command.upgrade(config, "0020")
    with migration_engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE open_game_notification_outbox SET "
                "status = 'CLAIMED', claim_token = :token, "
                "lease_until = :lease, delivery_started_at = :started "
                "WHERE id = :id"
            ),
            {
                "id": outbox_id,
                "token": UUID("30000000-0000-0000-0000-000000000299"),
                "lease": COMPLETED_AT + timedelta(minutes=2),
                "started": COMPLETED_AT,
            },
        )

    with pytest.raises(RuntimeError, match="delivery-start history"):
        command.downgrade(config, "0019")
    assert _revision(migration_engine) == "0020"
