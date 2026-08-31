from __future__ import annotations

import time
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from typing import cast
from uuid import UUID

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, create_engine, inspect, text
from sqlalchemy.exc import DBAPIError

from backend.tests.postgres_test_database import (
    disposable_database,
    override_test_database_url,
)
from backend.tests.test_open_game_registration_schema import (
    _enum_labels,
    _insert_registration,
    _seed_registration_parents,
    _valid_registration,
)
from backend.tests.test_open_game_schema import _insert_game, _valid_game

pytestmark = pytest.mark.integration


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


def _config(engine: Engine) -> Config:
    config = Config("alembic.ini")
    config.set_main_option(
        "sqlalchemy.url",
        engine.url.render_as_string(hide_password=False),
    )
    return config


def _revision(engine: Engine) -> str:
    with engine.connect() as connection:
        return cast(
            str,
            connection.execute(
                text("SELECT version_num FROM alembic_version")
            ).scalar_one(),
        )


def _insert_outbox(
    engine: Engine,
    *,
    registration_id: UUID,
    game_id: UUID,
    recipient_user_id: UUID,
    overrides: dict[str, object] | None = None,
) -> None:
    values: dict[str, object] = {
        "id": UUID("30000000-0000-0000-0000-000000000101"),
        "dedupe_key": f"waitlist-promoted:{registration_id}:2",
        "game_id": game_id,
        "registration_id": registration_id,
        "recipient_user_id": recipient_user_id,
        "event": "WAITLIST_PROMOTED",
        "template_key": "waitlist-promoted",
        "status": "PENDING",
        "payload": (
            '{"game_name": "周末轻松局", '
            '"starts_at": "2026-09-01T12:00:00Z", '
            '"venue_name": "Open Game Venue"}'
        ),
        "attempt_count": 0,
        "available_at": datetime(2026, 8, 30, 12, 10, tzinfo=UTC),
        "claim_token": None,
        "lease_until": None,
        "completed_at": None,
        "last_failure_code": None,
    }
    values.update(overrides or {})
    if overrides is not None and "dedupe_key" not in overrides:
        values["dedupe_key"] = (
            f"waitlist-promoted:{registration_id}:{values['id']}"
        )
    columns = ", ".join(values)
    parameters = ", ".join(f":{key}" for key in values)
    with engine.begin() as connection:
        connection.execute(
            text(
                f"INSERT INTO open_game_notification_outbox ({columns}) "
                f"VALUES ({parameters})"
            ),
            values,
        )


def _waitlisted_values(
    *,
    registration_id: UUID,
    game_id: UUID,
    applicant_user_id: UUID,
    captain_id: UUID,
    waitlist_seq: int,
    withdrawn: bool = False,
) -> dict[str, object]:
    applied_at = datetime(2026, 8, 30, 12, tzinfo=UTC)
    waitlisted_at = applied_at + timedelta(minutes=1)
    return {
        **_valid_registration(
            registration_id=registration_id,
            game_id=game_id,
            applicant_user_id=applicant_user_id,
        ),
        "applied_at": applied_at,
        "status": "WITHDRAWN" if withdrawn else "WAITLISTED",
        "decided_at": waitlisted_at,
        "decided_by_user_id": captain_id,
        "waitlist_seq": waitlist_seq,
        "waitlisted_at": waitlisted_at,
        "promoted_at": None,
        "withdrawn_at": (
            waitlisted_at + timedelta(minutes=1) if withdrawn else None
        ),
        "withdrawal_kind": "WAITLIST_WITHDRAWAL" if withdrawn else None,
        "late_exit_recorded": False,
    }


def _add_applicants(engine: Engine, *, count: int) -> tuple[UUID, ...]:
    applicant_ids = tuple(
        UUID(f"30000000-0000-0000-0000-{200 + index:012d}")
        for index in range(count)
    )
    with engine.begin() as connection:
        for index, applicant_id in enumerate(applicant_ids):
            connection.execute(
                text(
                    "INSERT INTO users "
                    "(id, wechat_app_id, wechat_openid, created_at) "
                    "VALUES (:id, 'wx-waitlist-migration', :openid, now())"
                ),
                {"id": applicant_id, "openid": f"waitlist-extra-{index}"},
            )
    return applicant_ids


def test_0019_round_trips_empty_waitlist_storage_and_preserves_0018_rows(
    migration_engine: Engine,
) -> None:
    config = _config(migration_engine)
    command.upgrade(config, "0018")
    _, game_id, applicant_ids = _seed_registration_parents(migration_engine)
    registration_id = UUID("30000000-0000-0000-0000-000000000111")
    _insert_registration(
        migration_engine,
        _valid_registration(
            registration_id=registration_id,
            game_id=game_id,
            applicant_user_id=applicant_ids[0],
        ),
    )

    command.upgrade(config, "0019")

    assert _revision(migration_engine) == "0019"
    assert _enum_labels(migration_engine, "open_game_registration_status") == [
        "APPLIED",
        "WAITLISTED",
        "JOINED",
        "REJECTED",
        "WITHDRAWN",
    ]
    assert _enum_labels(
        migration_engine,
        "open_game_registration_withdrawal_kind",
    ) == ["APPLICATION_WITHDRAWAL", "WAITLIST_WITHDRAWAL", "GAME_EXIT"]
    assert _enum_labels(migration_engine, "open_game_notification_event") == [
        "WAITLIST_PROMOTED"
    ]
    assert _enum_labels(migration_engine, "open_game_notification_status") == [
        "PENDING",
        "CLAIMED",
        "SENT",
        "FAILED",
        "SUPERSEDED",
    ]
    assert "open_game_notification_outbox" in inspect(
        migration_engine
    ).get_table_names()
    registration_columns = {
        column["name"]: column
        for column in inspect(migration_engine).get_columns(
            "open_game_registrations"
        )
    }
    for name in ("waitlist_seq", "waitlisted_at", "promoted_at"):
        assert registration_columns[name]["nullable"] is True
    assert str(registration_columns["waitlist_seq"]["type"]) == "BIGINT"
    with migration_engine.connect() as connection:
        row = connection.execute(
            text(
                "SELECT status::text, waitlist_seq, waitlisted_at, promoted_at "
                "FROM open_game_registrations WHERE id = :id"
            ),
            {"id": registration_id},
        ).one()
    assert tuple(row) == ("APPLIED", None, None, None)

    command.downgrade(config, "0018")
    assert _revision(migration_engine) == "0018"
    assert "open_game_notification_outbox" not in inspect(
        migration_engine
    ).get_table_names()
    assert _enum_labels(migration_engine, "open_game_registration_status") == [
        "APPLIED",
        "JOINED",
        "REJECTED",
        "WITHDRAWN",
    ]
    assert _enum_labels(
        migration_engine,
        "open_game_registration_withdrawal_kind",
    ) == ["APPLICATION_WITHDRAWAL", "GAME_EXIT"]


def test_0019_enforces_waitlist_lifecycle_sequence_and_fifo_indexes(
    migration_engine: Engine,
) -> None:
    command.upgrade(_config(migration_engine), "0019")
    captain_id, game_id, applicant_ids = _seed_registration_parents(
        migration_engine
    )
    first = _waitlisted_values(
        registration_id=UUID("30000000-0000-0000-0000-000000000121"),
        game_id=game_id,
        applicant_user_id=applicant_ids[0],
        captain_id=captain_id,
        waitlist_seq=7,
    )
    _insert_registration(migration_engine, first)
    _insert_registration(
        migration_engine,
        {
            **_valid_registration(
                registration_id=UUID(
                    "30000000-0000-0000-0000-000000000122"
                ),
                game_id=game_id,
                applicant_user_id=applicant_ids[1],
            ),
            "status": "JOINED",
            "decided_at": datetime(2026, 8, 30, 12, 1, tzinfo=UTC),
            "decided_by_user_id": captain_id,
            "waitlist_seq": 8,
            "waitlisted_at": datetime(2026, 8, 30, 12, 1, tzinfo=UTC),
            "promoted_at": datetime(2026, 8, 30, 12, 2, tzinfo=UTC),
        },
    )
    _insert_registration(
        migration_engine,
        {
            **_valid_registration(
                registration_id=UUID(
                    "30000000-0000-0000-0000-000000000123"
                ),
                game_id=game_id,
                applicant_user_id=applicant_ids[2],
            ),
            "status": "WITHDRAWN",
            "decided_at": datetime(2026, 8, 30, 12, 1, tzinfo=UTC),
            "decided_by_user_id": captain_id,
            "waitlist_seq": 9,
            "waitlisted_at": datetime(2026, 8, 30, 12, 1, tzinfo=UTC),
            "promoted_at": None,
            "withdrawn_at": datetime(2026, 8, 30, 12, 2, tzinfo=UTC),
            "withdrawal_kind": "WAITLIST_WITHDRAWAL",
            "late_exit_recorded": False,
        },
    )

    invalid_cases = (
        {"waitlist_seq": 0},
        {"waitlist_seq": -1},
        {"waitlisted_at": None},
        {"promoted_at": datetime(2026, 8, 30, 12, 2, tzinfo=UTC)},
        {
            "decided_at": datetime(2026, 8, 30, 12, 1, tzinfo=UTC),
            "waitlisted_at": datetime(2026, 8, 30, 12, 1, 1, tzinfo=UTC),
        },
    )
    invalid_applicant_ids = _add_applicants(
        migration_engine,
        count=len(invalid_cases) + 2,
    )
    _insert_registration(
        migration_engine,
        {
            **_valid_registration(
                registration_id=UUID(
                    "30000000-0000-0000-0000-000000000124"
                ),
                game_id=game_id,
                applicant_user_id=invalid_applicant_ids[0],
            ),
            "status": "WITHDRAWN",
            "decided_at": datetime(2026, 8, 30, 12, 1, tzinfo=UTC),
            "decided_by_user_id": captain_id,
            "waitlist_seq": 10,
            "waitlisted_at": datetime(2026, 8, 30, 12, 1, tzinfo=UTC),
            "promoted_at": datetime(2026, 8, 30, 12, 2, tzinfo=UTC),
            "withdrawn_at": datetime(2026, 8, 30, 12, 3, tzinfo=UTC),
            "withdrawal_kind": "GAME_EXIT",
            "late_exit_recorded": True,
        },
    )
    for index, overrides in enumerate(invalid_cases, start=1):
        with pytest.raises(DBAPIError):
            _insert_registration(
                migration_engine,
                {
                    **first,
                    "id": UUID(
                        f"30000000-0000-0000-0000-{130 + index:012d}"
                    ),
                    "applicant_user_id": invalid_applicant_ids[index],
                    "waitlist_seq": 20 + index,
                    **overrides,
                },
            )

    with pytest.raises(DBAPIError):
        _insert_registration(
            migration_engine,
            {
                **first,
                "id": UUID("30000000-0000-0000-0000-000000000139"),
                "applicant_user_id": invalid_applicant_ids[-1],
            },
        )

    inspector = inspect(migration_engine)
    unique_constraints = {
        item["name"]: item["column_names"]
        for item in inspector.get_unique_constraints("open_game_registrations")
    }
    assert unique_constraints["uq_open_game_registrations_game_waitlist_seq"] == [
        "game_id",
        "waitlist_seq",
    ]
    assert unique_constraints["uq_open_game_registrations_outbox_identity"] == [
        "id",
        "game_id",
        "applicant_user_id",
    ]
    indexes = {
        item["name"]: item
        for item in inspector.get_indexes("open_game_registrations")
    }
    assert indexes["ix_open_game_registrations_active_waitlist"][
        "column_names"
    ] == ["game_id", "status", "waitlist_seq"]
    with migration_engine.connect() as connection:
        predicate = connection.execute(
            text(
                "SELECT pg_get_expr(definition.indpred, definition.indrelid) "
                "FROM pg_index AS definition "
                "JOIN pg_class AS relation "
                "ON relation.oid = definition.indexrelid "
                "WHERE relation.relname = "
                "'ix_open_game_registrations_active_waitlist'"
            )
        ).scalar_one()
    assert "WAITLISTED" in predicate


def test_0019_outbox_schema_is_narrow_durable_and_constrained(
    migration_engine: Engine,
) -> None:
    command.upgrade(_config(migration_engine), "0019")
    captain_id, game_id, applicant_ids = _seed_registration_parents(
        migration_engine
    )
    registration_id = UUID("30000000-0000-0000-0000-000000000141")
    _insert_registration(
        migration_engine,
        _valid_registration(
            registration_id=registration_id,
            game_id=game_id,
            applicant_user_id=applicant_ids[0],
        ),
    )
    _insert_outbox(
        migration_engine,
        registration_id=registration_id,
        game_id=game_id,
        recipient_user_id=applicant_ids[0],
    )

    columns = {
        column["name"]
        for column in inspect(migration_engine).get_columns(
            "open_game_notification_outbox"
        )
    }
    assert columns == {
        "id",
        "dedupe_key",
        "game_id",
        "registration_id",
        "recipient_user_id",
        "event",
        "template_key",
        "status",
        "payload",
        "attempt_count",
        "available_at",
        "claim_token",
        "lease_until",
        "created_at",
        "completed_at",
        "last_failure_code",
    }
    assert not columns.intersection(
        {"phone", "openid", "access_token", "subscription", "provider_body"}
    )
    due_index = next(
        item
        for item in inspect(migration_engine).get_indexes(
            "open_game_notification_outbox"
        )
        if item["name"] == "ix_open_game_notification_outbox_due"
    )
    assert due_index["column_names"] == ["available_at", "id"]
    with migration_engine.connect() as connection:
        due_predicate = connection.execute(
            text(
                "SELECT pg_get_expr(definition.indpred, definition.indrelid) "
                "FROM pg_index AS definition "
                "JOIN pg_class AS relation "
                "ON relation.oid = definition.indexrelid "
                "WHERE relation.relname = "
                "'ix_open_game_notification_outbox_due'"
            )
        ).scalar_one()
    assert "PENDING" in due_predicate

    invalid_overrides = (
        {"id": UUID(int=151), "dedupe_key": " "},
        {"id": UUID(int=152), "payload": "[]"},
        {"id": UUID(int=153), "attempt_count": -1},
        {
            "id": UUID(int=154),
            "status": "CLAIMED",
            "claim_token": UUID(int=154),
            "lease_until": None,
        },
        {"id": UUID(int=155), "status": "SENT", "completed_at": None},
        {
            "id": UUID(int=156),
            "status": "FAILED",
            "completed_at": datetime(2026, 8, 30, 12, 20, tzinfo=UTC),
            "last_failure_code": None,
        },
        {"id": UUID(int=157), "last_failure_code": " "},
        {
            "id": UUID(int=158),
            "payload": (
                '{"game_name": "周末轻松局", '
                '"starts_at": "2026-09-01T12:00:00Z", '
                '"venue_name": "Open Game Venue", '
                '"access_token": "must-not-persist"}'
            ),
        },
        {
            "id": UUID(int=159),
            "payload": (
                '{"game_name": "周末轻松局", '
                '"starts_at": "2026-09-01T12:00:00Z"}'
            ),
        },
        {
            "id": UUID(int=160),
            "payload": (
                '{"game_name": 7, '
                '"starts_at": "2026-09-01T12:00:00Z", '
                '"venue_name": "Open Game Venue"}'
            ),
        },
    )
    for overrides in invalid_overrides:
        with pytest.raises(DBAPIError):
            _insert_outbox(
                migration_engine,
                registration_id=registration_id,
                game_id=game_id,
                recipient_user_id=applicant_ids[0],
                overrides=overrides,
            )

    with pytest.raises(DBAPIError):
        _insert_outbox(
            migration_engine,
            registration_id=registration_id,
            game_id=game_id,
            recipient_user_id=applicant_ids[1],
            overrides={"id": UUID(int=161)},
        )

    with migration_engine.begin() as connection:
        order_id, team_id = connection.execute(
            text("SELECT order_id, team_id FROM open_games WHERE id = :id"),
            {"id": game_id},
        ).one()
        connection.execute(
            text(
                "UPDATE open_games SET status = 'CANCELLED', "
                "cancelled_at = now() WHERE id = :id"
            ),
            {"id": game_id},
        )
    other_game_id = UUID("30000000-0000-0000-0000-000000000142")
    _insert_game(
        migration_engine,
        _valid_game(
            game_id=other_game_id,
            order_id=order_id,
            team_id=team_id,
            share_token="waitlist-outbox-other-game",
        ),
    )
    with pytest.raises(DBAPIError):
        _insert_outbox(
            migration_engine,
            registration_id=registration_id,
            game_id=other_game_id,
            recipient_user_id=applicant_ids[0],
            overrides={"id": UUID(int=162)},
        )

    assert captain_id != applicant_ids[0]


def test_0019_refuses_downgrade_before_ddl_for_any_waitlist_history_or_outbox(
    migration_engine: Engine,
) -> None:
    config = _config(migration_engine)
    command.upgrade(config, "0019")
    captain_id, game_id, applicant_ids = _seed_registration_parents(
        migration_engine
    )
    registration_id = UUID("30000000-0000-0000-0000-000000000161")
    _insert_registration(
        migration_engine,
        _waitlisted_values(
            registration_id=registration_id,
            game_id=game_id,
            applicant_user_id=applicant_ids[0],
            captain_id=captain_id,
            waitlist_seq=1,
        ),
    )

    with pytest.raises(RuntimeError, match="waitlist history or outbox"):
        command.downgrade(config, "0018")
    assert _revision(migration_engine) == "0019"
    assert "open_game_notification_outbox" in inspect(
        migration_engine
    ).get_table_names()

    with migration_engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE open_game_registrations SET "
                "status = 'JOINED', promoted_at = waitlisted_at + interval '1 minute' "
                "WHERE id = :id"
            ),
            {"id": registration_id},
        )
    with pytest.raises(RuntimeError, match="waitlist history or outbox"):
        command.downgrade(config, "0018")
    assert _revision(migration_engine) == "0019"

    with migration_engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE open_game_registrations SET "
                "status = 'WITHDRAWN', promoted_at = NULL, "
                "withdrawn_at = waitlisted_at + interval '2 minutes', "
                "withdrawal_kind = 'WAITLIST_WITHDRAWAL' WHERE id = :id"
            ),
            {"id": registration_id},
        )
    with pytest.raises(RuntimeError, match="waitlist history or outbox"):
        command.downgrade(config, "0018")
    assert _revision(migration_engine) == "0019"

    with migration_engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE open_game_registrations SET "
                "status = 'APPLIED', decided_at = NULL, "
                "decided_by_user_id = NULL, waitlist_seq = NULL, "
                "waitlisted_at = NULL, promoted_at = NULL, withdrawn_at = NULL, "
                "withdrawal_kind = NULL WHERE id = :id"
            ),
            {"id": registration_id},
        )
    _insert_outbox(
        migration_engine,
        registration_id=registration_id,
        game_id=game_id,
        recipient_user_id=applicant_ids[0],
    )
    with pytest.raises(RuntimeError, match="waitlist history or outbox"):
        command.downgrade(config, "0018")
    assert _revision(migration_engine) == "0019"


def test_0019_downgrade_guard_observes_concurrent_outbox_commit_before_ddl(
    migration_engine: Engine,
) -> None:
    config = _config(migration_engine)
    command.upgrade(config, "0019")
    _, game_id, applicant_ids = _seed_registration_parents(migration_engine)
    registration_id = UUID("30000000-0000-0000-0000-000000000171")
    _insert_registration(
        migration_engine,
        _valid_registration(
            registration_id=registration_id,
            game_id=game_id,
            applicant_user_id=applicant_ids[0],
        ),
    )

    writer = migration_engine.connect()
    writer_transaction = writer.begin()
    writer_pid = writer.execute(text("SELECT pg_backend_pid()")).scalar_one()
    values = {
        "id": UUID("30000000-0000-0000-0000-000000000172"),
        "dedupe_key": f"waitlist-promoted:{registration_id}:2",
        "game_id": game_id,
        "registration_id": registration_id,
        "recipient_user_id": applicant_ids[0],
        "event": "WAITLIST_PROMOTED",
        "template_key": "waitlist-promoted",
        "status": "PENDING",
        "payload": (
            '{"game_name": "周末轻松局", '
            '"starts_at": "2026-09-01T12:00:00Z", '
            '"venue_name": "Open Game Venue"}'
        ),
        "attempt_count": 0,
        "available_at": datetime(2026, 8, 30, 12, 10, tzinfo=UTC),
    }
    writer.execute(
        text(
            "INSERT INTO open_game_notification_outbox "
            "(id, dedupe_key, game_id, registration_id, recipient_user_id, "
            "event, template_key, status, payload, attempt_count, available_at) "
            "VALUES (:id, :dedupe_key, :game_id, :registration_id, "
            ":recipient_user_id, :event, :template_key, :status, :payload, "
            ":attempt_count, :available_at)"
        ),
        values,
    )

    try:
        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(command.downgrade, config, "0018")
            deadline = time.monotonic() + 5
            observed_lock_wait = False
            while time.monotonic() < deadline:
                with migration_engine.connect() as observer:
                    observed_lock_wait = bool(
                        observer.execute(
                            text(
                                "SELECT EXISTS (SELECT 1 FROM pg_stat_activity "
                                "WHERE datname = current_database() "
                                "AND pid != :writer_pid "
                                "AND wait_event_type = 'Lock')"
                            ),
                            {"writer_pid": writer_pid},
                        ).scalar_one()
                    )
                if observed_lock_wait:
                    break
                time.sleep(0.02)
            assert observed_lock_wait
            writer_transaction.commit()
            with pytest.raises(RuntimeError, match="waitlist history or outbox"):
                future.result(timeout=5)
    finally:
        if writer_transaction.is_active:
            writer_transaction.rollback()
        writer.close()

    assert _revision(migration_engine) == "0019"
    assert "open_game_notification_outbox" in inspect(
        migration_engine
    ).get_table_names()
