from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import cast
from uuid import UUID

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import DateTime, Engine, create_engine, inspect, text
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

pytestmark = pytest.mark.integration

RECORDED_AT = datetime(2026, 8, 30, 12, 32, tzinfo=UTC)
REGISTRATION_ID = UUID("30000000-0000-0000-0000-000000000301")


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


def _joined_registration(
    *,
    game_id: UUID,
    applicant_user_id: UUID,
    captain_id: UUID,
) -> dict[str, object]:
    values = _valid_registration(
        registration_id=REGISTRATION_ID,
        game_id=game_id,
        applicant_user_id=applicant_user_id,
    )
    applied_at = values["applied_at"]
    assert isinstance(applied_at, datetime)
    return {
        **values,
        "status": "JOINED",
        "decided_at": applied_at + timedelta(minutes=1),
        "decided_by_user_id": captain_id,
    }


def _non_joined_registration(
    *,
    status: str,
    game_id: UUID,
    applicant_user_id: UUID,
    captain_id: UUID,
) -> dict[str, object]:
    values = _valid_registration(
        registration_id=REGISTRATION_ID,
        game_id=game_id,
        applicant_user_id=applicant_user_id,
    )
    applied_at = values["applied_at"]
    assert isinstance(applied_at, datetime)
    decided_at = applied_at + timedelta(minutes=1)
    if status == "APPLIED":
        return values
    if status == "WAITLISTED":
        return {
            **values,
            "status": status,
            "decided_at": decided_at,
            "decided_by_user_id": captain_id,
            "waitlist_seq": 1,
            "waitlisted_at": decided_at,
        }
    if status == "REJECTED":
        return {
            **values,
            "status": status,
            "decided_at": decided_at,
            "decided_by_user_id": captain_id,
        }
    assert status == "WITHDRAWN"
    return {
        **values,
        "status": status,
        "withdrawn_at": decided_at,
        "withdrawal_kind": "APPLICATION_WITHDRAWAL",
    }


def _set_attendance(
    engine: Engine,
    *,
    attendance_status: str,
    recorded_at: datetime | None,
    recorded_by_user_id: UUID | None,
) -> None:
    with engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE open_game_registrations SET "
                "attendance_status = :attendance_status, "
                "attendance_recorded_at = :recorded_at, "
                "attendance_recorded_by_user_id = :recorded_by_user_id "
                "WHERE id = :registration_id"
            ),
            {
                "attendance_status": attendance_status,
                "recorded_at": recorded_at,
                "recorded_by_user_id": recorded_by_user_id,
                "registration_id": REGISTRATION_ID,
            },
        )


def test_0021_round_trips_empty_attendance_storage_and_preserves_0020_rows(
    migration_engine: Engine,
) -> None:
    config = _config(migration_engine)
    command.upgrade(config, "0020")
    _, game_id, applicant_ids = _seed_registration_parents(migration_engine)
    _insert_registration(
        migration_engine,
        _valid_registration(
            registration_id=REGISTRATION_ID,
            game_id=game_id,
            applicant_user_id=applicant_ids[0],
        ),
    )

    command.upgrade(config, "0021")

    assert _revision(migration_engine) == "0021"
    assert _enum_labels(migration_engine, "open_game_attendance_status") == [
        "UNMARKED",
        "PRESENT",
        "NO_SHOW",
    ]
    inspector = inspect(migration_engine)
    columns = {
        column["name"]: column
        for column in inspector.get_columns("open_game_registrations")
    }
    assert columns["attendance_status"]["nullable"] is False
    assert columns["attendance_status"]["type"].name == (
        "open_game_attendance_status"
    )
    assert "UNMARKED" in str(columns["attendance_status"]["default"])
    assert columns["attendance_recorded_at"]["nullable"] is True
    assert isinstance(columns["attendance_recorded_at"]["type"], DateTime)
    assert columns["attendance_recorded_at"]["type"].timezone is True
    assert columns["attendance_recorded_by_user_id"]["nullable"] is True
    assert str(columns["attendance_recorded_by_user_id"]["type"]) == "UUID"
    assert "attendance_version" not in columns

    attendance_fk = next(
        item
        for item in inspector.get_foreign_keys("open_game_registrations")
        if item["name"]
        == "fk_open_game_registrations_attendance_recorded_by_user_id_users"
    )
    assert attendance_fk["constrained_columns"] == [
        "attendance_recorded_by_user_id"
    ]
    assert attendance_fk["referred_table"] == "users"
    assert attendance_fk["referred_columns"] == ["id"]
    assert attendance_fk["options"]["ondelete"] == "RESTRICT"
    check_names = {
        item["name"]
        for item in inspector.get_check_constraints(
            "open_game_registrations"
        )
    }
    assert check_names >= {
        "ck_open_game_registrations_attendance_audit",
        "ck_open_game_registrations_attendance_joined",
    }
    assert not any(
        "attendance" in item["name"]
        for item in inspector.get_indexes("open_game_registrations")
    )
    with migration_engine.connect() as connection:
        row = connection.execute(
            text(
                "SELECT attendance_status::text, attendance_recorded_at, "
                "attendance_recorded_by_user_id, version "
                "FROM open_game_registrations WHERE id = :id"
            ),
            {"id": REGISTRATION_ID},
        ).one()
    assert tuple(row) == ("UNMARKED", None, None, 1)

    command.downgrade(config, "0020")

    assert _revision(migration_engine) == "0020"
    remaining_columns = {
        column["name"]
        for column in inspect(migration_engine).get_columns(
            "open_game_registrations"
        )
    }
    assert {
        "attendance_status",
        "attendance_recorded_at",
        "attendance_recorded_by_user_id",
    }.isdisjoint(remaining_columns)
    assert _enum_labels(migration_engine, "open_game_attendance_status") == []
    with migration_engine.connect() as connection:
        assert connection.execute(
            text(
                "SELECT version FROM open_game_registrations WHERE id = :id"
            ),
            {"id": REGISTRATION_ID},
        ).scalar_one() == 1


def test_0021_enforces_complete_attendance_audit_equivalence_matrix(
    migration_engine: Engine,
) -> None:
    command.upgrade(_config(migration_engine), "0021")
    captain_id, game_id, applicant_ids = _seed_registration_parents(
        migration_engine
    )
    _insert_registration(
        migration_engine,
        _joined_registration(
            game_id=game_id,
            applicant_user_id=applicant_ids[0],
            captain_id=captain_id,
        ),
    )
    cases = (
        ("UNMARKED", None, None, True),
        ("UNMARKED", RECORDED_AT, None, False),
        ("UNMARKED", None, captain_id, False),
        ("UNMARKED", RECORDED_AT, captain_id, False),
        ("PRESENT", None, None, False),
        ("PRESENT", RECORDED_AT, None, False),
        ("PRESENT", None, captain_id, False),
        ("PRESENT", RECORDED_AT, captain_id, True),
        ("NO_SHOW", None, None, False),
        ("NO_SHOW", RECORDED_AT, None, False),
        ("NO_SHOW", None, captain_id, False),
        ("NO_SHOW", RECORDED_AT, captain_id, True),
    )

    for attendance_status, recorded_at, recorded_by_user_id, valid in cases:
        if valid:
            _set_attendance(
                migration_engine,
                attendance_status=attendance_status,
                recorded_at=recorded_at,
                recorded_by_user_id=recorded_by_user_id,
            )
            with migration_engine.connect() as connection:
                row = connection.execute(
                    text(
                        "SELECT attendance_status::text, "
                        "attendance_recorded_at, "
                        "attendance_recorded_by_user_id "
                        "FROM open_game_registrations WHERE id = :id"
                    ),
                    {"id": REGISTRATION_ID},
                ).one()
            assert tuple(row) == (
                attendance_status,
                recorded_at,
                recorded_by_user_id,
            )
            _set_attendance(
                migration_engine,
                attendance_status="UNMARKED",
                recorded_at=None,
                recorded_by_user_id=None,
            )
            continue

        with pytest.raises(DBAPIError):
            _set_attendance(
                migration_engine,
                attendance_status=attendance_status,
                recorded_at=recorded_at,
                recorded_by_user_id=recorded_by_user_id,
            )


def test_0021_rejects_attendance_for_every_non_joined_registration_status(
    migration_engine: Engine,
) -> None:
    command.upgrade(_config(migration_engine), "0021")
    captain_id, game_id, applicant_ids = _seed_registration_parents(
        migration_engine
    )

    for status in ("APPLIED", "WAITLISTED", "REJECTED", "WITHDRAWN"):
        _insert_registration(
            migration_engine,
            _non_joined_registration(
                status=status,
                game_id=game_id,
                applicant_user_id=applicant_ids[0],
                captain_id=captain_id,
            ),
        )
        with pytest.raises(DBAPIError):
            _set_attendance(
                migration_engine,
                attendance_status="PRESENT",
                recorded_at=RECORDED_AT,
                recorded_by_user_id=captain_id,
            )
        with migration_engine.begin() as connection:
            connection.execute(
                text("DELETE FROM open_game_registrations WHERE id = :id"),
                {"id": REGISTRATION_ID},
            )


def test_0021_attendance_recorder_must_reference_an_existing_user(
    migration_engine: Engine,
) -> None:
    command.upgrade(_config(migration_engine), "0021")
    captain_id, game_id, applicant_ids = _seed_registration_parents(
        migration_engine
    )
    _insert_registration(
        migration_engine,
        _joined_registration(
            game_id=game_id,
            applicant_user_id=applicant_ids[0],
            captain_id=captain_id,
        ),
    )

    with pytest.raises(DBAPIError):
        _set_attendance(
            migration_engine,
            attendance_status="PRESENT",
            recorded_at=RECORDED_AT,
            recorded_by_user_id=UUID(
                "30000000-0000-0000-0000-000000000399"
            ),
        )


def test_0021_refuses_lossy_downgrade_when_attendance_history_exists(
    migration_engine: Engine,
) -> None:
    config = _config(migration_engine)
    command.upgrade(config, "0021")
    captain_id, game_id, applicant_ids = _seed_registration_parents(
        migration_engine
    )
    _insert_registration(
        migration_engine,
        {
            **_joined_registration(
                game_id=game_id,
                applicant_user_id=applicant_ids[0],
                captain_id=captain_id,
            ),
            "attendance_status": "NO_SHOW",
            "attendance_recorded_at": RECORDED_AT,
            "attendance_recorded_by_user_id": captain_id,
        },
    )

    with pytest.raises(RuntimeError, match="attendance history"):
        command.downgrade(config, "0020")

    assert _revision(migration_engine) == "0021"
