from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import cast
from uuid import UUID

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import DateTime, Engine, Integer, String, create_engine, inspect, text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.exc import DBAPIError

from backend.app import models
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

REGISTRATION_ID = UUID("30000000-0000-0000-0000-000000000321")
CORRECTION_ID = UUID("30000000-0000-0000-0000-000000000322")
RECORDED_AT = datetime(2026, 8, 31, 10, 6, tzinfo=UTC)
CORRECTED_AT = datetime(2026, 8, 31, 14, 18, tzinfo=UTC)


@pytest.fixture
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


def _seed_terminal_registration(engine: Engine) -> tuple[UUID, UUID]:
    captain_id, game_id, applicant_ids = _seed_registration_parents(engine)
    values = _valid_registration(
        registration_id=REGISTRATION_ID,
        game_id=game_id,
        applicant_user_id=applicant_ids[0],
    )
    applied_at = values["applied_at"]
    assert isinstance(applied_at, datetime)
    _insert_registration(
        engine,
        {
            **values,
            "status": "JOINED",
            "attendance_status": "NO_SHOW",
            "attendance_recorded_at": RECORDED_AT,
            "attendance_recorded_by_user_id": captain_id,
            "version": 3,
            "decided_at": applied_at + timedelta(minutes=1),
            "decided_by_user_id": captain_id,
        },
    )
    return captain_id, game_id


def _valid_correction(**overrides: object) -> dict[str, object]:
    return {
        "id": CORRECTION_ID,
        "registration_id": REGISTRATION_ID,
        "from_status": "NO_SHOW",
        "to_status": "PRESENT",
        "reason": "已核对现场签到记录，原到场结果录入错误。",
        "corrected_by_principal_id": "platform-admin-yangfan",
        "corrected_at": CORRECTED_AT,
        "registration_version_before": 3,
        "registration_version_after": 4,
        "idempotency_key": "attendance-correction-key-0001",
        "request_sha256": "a" * 64,
        **overrides,
    }


def _insert_correction(engine: Engine, values: dict[str, object]) -> None:
    columns = ", ".join(values)
    parameters = ", ".join(f":{column}" for column in values)
    with engine.begin() as connection:
        connection.execute(
            text(
                f"INSERT INTO open_game_attendance_corrections ({columns}) "
                f"VALUES ({parameters})"
            ),
            values,
        )


def _constraint_name(error: DBAPIError) -> str | None:
    diagnostic = getattr(error.orig, "diag", None)
    return getattr(diagnostic, "constraint_name", None)


def test_0022_round_trips_empty_storage_without_backfilling_attendance(
    migration_engine: Engine,
) -> None:
    config = _config(migration_engine)
    command.upgrade(config, "0021")
    _seed_terminal_registration(migration_engine)

    command.upgrade(config, "0022")

    assert _revision(migration_engine) == "0022"
    inspector = inspect(migration_engine)
    assert "open_game_attendance_corrections" in inspector.get_table_names()
    columns = {
        column["name"]: column
        for column in inspector.get_columns(
            "open_game_attendance_corrections"
        )
    }
    assert list(columns) == [
        "id",
        "registration_id",
        "from_status",
        "to_status",
        "reason",
        "corrected_by_principal_id",
        "corrected_at",
        "registration_version_before",
        "registration_version_after",
        "idempotency_key",
        "request_sha256",
    ]
    assert not any(column["nullable"] for column in columns.values())
    assert str(columns["id"]["type"]) == "UUID"
    assert str(columns["registration_id"]["type"]) == "UUID"
    for name in ("from_status", "to_status"):
        assert isinstance(columns[name]["type"], SAEnum)
        assert columns[name]["type"].name == "open_game_attendance_status"
    for name, length in (
        ("reason", 1000),
        ("corrected_by_principal_id", 128),
        ("idempotency_key", 128),
        ("request_sha256", 64),
    ):
        assert isinstance(columns[name]["type"], String)
        assert columns[name]["type"].length == length
    assert isinstance(columns["corrected_at"]["type"], DateTime)
    assert columns["corrected_at"]["type"].timezone is True
    assert str(columns["corrected_at"]["default"]).lower() == "now()"
    assert isinstance(columns["registration_version_before"]["type"], Integer)
    assert isinstance(columns["registration_version_after"]["type"], Integer)
    assert inspector.get_pk_constraint("open_game_attendance_corrections") == {
        "constrained_columns": ["id"],
        "name": "pk_open_game_attendance_corrections",
        "comment": None,
        "dialect_options": {"postgresql_include": []},
    }
    foreign_keys = inspector.get_foreign_keys(
        "open_game_attendance_corrections"
    )
    assert len(foreign_keys) == 1
    assert foreign_keys[0]["name"] == "fk_attendance_corrections_registration"
    assert foreign_keys[0]["constrained_columns"] == ["registration_id"]
    assert foreign_keys[0]["referred_table"] == "open_game_registrations"
    assert foreign_keys[0]["referred_columns"] == ["id"]
    assert foreign_keys[0]["options"]["ondelete"] == "RESTRICT"
    assert {
        item["name"]
        for item in inspector.get_check_constraints(
            "open_game_attendance_corrections"
        )
    } == {
        "ck_open_game_attendance_corrections_status_transition",
        "ck_open_game_attendance_corrections_reason",
        "ck_open_game_attendance_corrections_principal",
        "ck_open_game_attendance_corrections_version",
        "ck_open_game_attendance_corrections_request_sha256",
    }
    assert {
        item["name"]: item["column_names"]
        for item in inspector.get_unique_constraints(
            "open_game_attendance_corrections"
        )
    } == {
        "uq_open_game_attendance_corrections_registration_version_after": [
            "registration_id",
            "registration_version_after",
        ],
        "uq_open_game_attendance_corrections_principal_idempotency_key": [
            "corrected_by_principal_id",
            "idempotency_key",
        ],
    }
    assert not any(
        item["name"].startswith("ix_")
        for item in inspector.get_indexes(
            "open_game_attendance_corrections"
        )
    )
    assert _enum_labels(
        migration_engine, "open_game_attendance_status"
    ) == ["UNMARKED", "PRESENT", "NO_SHOW"]
    with migration_engine.connect() as connection:
        assert connection.execute(
            text("SELECT count(*) FROM open_game_attendance_corrections")
        ).scalar_one() == 0

    command.downgrade(config, "0021")

    assert _revision(migration_engine) == "0021"
    assert "open_game_attendance_corrections" not in inspect(
        migration_engine
    ).get_table_names()
    assert _enum_labels(
        migration_engine, "open_game_attendance_status"
    ) == ["UNMARKED", "PRESENT", "NO_SHOW"]


def test_0022_enforces_correction_integrity_constraints(
    migration_engine: Engine,
) -> None:
    command.upgrade(_config(migration_engine), "0022")
    _seed_terminal_registration(migration_engine)
    _insert_correction(migration_engine, _valid_correction())

    invalid_changes = (
        {"id": UUID(int=401), "from_status": "UNMARKED"},
        {"id": UUID(int=402), "to_status": "UNMARKED"},
        {"id": UUID(int=403), "to_status": "NO_SHOW"},
        {"id": UUID(int=404), "reason": ""},
        {"id": UUID(int=405), "reason": "   "},
        {"id": UUID(int=406), "reason": " 未 trim"},
        {"id": UUID(int=407), "reason": "超长" * 501},
        {"id": UUID(int=408), "corrected_by_principal_id": ""},
        {"id": UUID(int=409), "corrected_by_principal_id": " ops"},
        {"id": UUID(int=410), "corrected_by_principal_id": "x" * 129},
        {"id": UUID(int=411), "registration_version_before": 0},
        {"id": UUID(int=412), "registration_version_after": 3},
        {"id": UUID(int=413), "registration_version_after": 5},
        {"id": UUID(int=414), "request_sha256": "A" * 64},
        {"id": UUID(int=415), "request_sha256": "a" * 63},
    )
    for index, changes in enumerate(invalid_changes, start=1):
        with pytest.raises(DBAPIError):
            _insert_correction(
                migration_engine,
                _valid_correction(
                    **{
                        "registration_version_before": 10 + index,
                        "registration_version_after": 11 + index,
                        "idempotency_key": (
                            f"invalid-correction-key-{index:04d}"
                        ),
                        **changes,
                    }
                ),
            )

    with pytest.raises(DBAPIError):
        _insert_correction(
            migration_engine,
            _valid_correction(
                id=UUID(int=416),
                registration_id=UUID(int=999),
                registration_version_before=30,
                registration_version_after=31,
                idempotency_key="missing-registration-key-0001",
            ),
        )


def test_0022_enforces_both_correction_authorities(
    migration_engine: Engine,
) -> None:
    command.upgrade(_config(migration_engine), "0022")
    _seed_terminal_registration(migration_engine)
    _insert_correction(migration_engine, _valid_correction())

    with pytest.raises(DBAPIError) as duplicate_registration_version:
        _insert_correction(
            migration_engine,
            _valid_correction(
                id=UUID(int=421),
                corrected_by_principal_id="platform-admin-other",
                idempotency_key="different-correction-key-0001",
            ),
        )
    assert _constraint_name(duplicate_registration_version.value) == (
        "uq_open_game_attendance_corrections_registration_version_after"
    )

    with pytest.raises(DBAPIError) as duplicate_principal_key:
        _insert_correction(
            migration_engine,
            _valid_correction(
                id=UUID(int=422),
                registration_version_before=4,
                registration_version_after=5,
            ),
        )
    assert _constraint_name(duplicate_principal_key.value) == (
        "uq_open_game_attendance_corrections_principal_idempotency_key"
    )


def test_0022_correction_events_are_append_only(
    migration_engine: Engine,
) -> None:
    command.upgrade(_config(migration_engine), "0022")
    _seed_terminal_registration(migration_engine)
    _insert_correction(migration_engine, _valid_correction())

    with pytest.raises(DBAPIError) as update_error:
        with migration_engine.begin() as connection:
            connection.execute(
                text(
                    "UPDATE open_game_attendance_corrections "
                    "SET reason = '试图覆盖历史' WHERE id = :id"
                ),
                {"id": CORRECTION_ID},
            )
    assert _constraint_name(update_error.value) == (
        "ck_open_game_attendance_corrections_append_only"
    )

    with pytest.raises(DBAPIError) as delete_error:
        with migration_engine.begin() as connection:
            connection.execute(
                text(
                    "DELETE FROM open_game_attendance_corrections "
                    "WHERE id = :id"
                ),
                {"id": CORRECTION_ID},
            )
    assert _constraint_name(delete_error.value) == (
        "ck_open_game_attendance_corrections_append_only"
    )
    with migration_engine.connect() as connection:
        assert connection.execute(
            text("SELECT count(*) FROM open_game_attendance_corrections")
        ).scalar_one() == 1


def test_0022_refuses_lossy_downgrade_before_ddl(
    migration_engine: Engine,
) -> None:
    config = _config(migration_engine)
    command.upgrade(config, "0022")
    _seed_terminal_registration(migration_engine)
    _insert_correction(migration_engine, _valid_correction())

    with pytest.raises(RuntimeError, match="attendance correction history"):
        command.downgrade(config, "0021")

    assert _revision(migration_engine) == "0022"
    assert "open_game_attendance_corrections" in inspect(
        migration_engine
    ).get_table_names()


def test_0022_model_metadata_matches_migration(
    migration_engine: Engine,
) -> None:
    config = _config(migration_engine)
    command.upgrade(config, "head")

    table = models.OpenGameAttendanceCorrection.__table__
    assert list(table.c) == [
        table.c.id,
        table.c.registration_id,
        table.c.from_status,
        table.c.to_status,
        table.c.reason,
        table.c.corrected_by_principal_id,
        table.c.corrected_at,
        table.c.registration_version_before,
        table.c.registration_version_after,
        table.c.idempotency_key,
        table.c.request_sha256,
    ]
    assert table.c.from_status.type.name == "open_game_attendance_status"
    assert table.c.to_status.type.name == "open_game_attendance_status"
    assert table.c.reason.type.length == 1000
    assert table.c.corrected_by_principal_id.type.length == 128
    assert table.c.idempotency_key.type.length == 128
    assert table.c.request_sha256.type.length == 64
    assert str(table.c.corrected_at.server_default.arg) == "now()"

    command.check(config)
