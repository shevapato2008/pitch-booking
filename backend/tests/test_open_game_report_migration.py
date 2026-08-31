from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime
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

pytestmark = pytest.mark.integration

REPORT_ID = UUID("55000000-0000-4000-8000-000000000001")
RESOLUTION_ID = UUID("55000000-0000-4000-8000-000000000002")
REGISTRATION_ID = UUID("55000000-0000-4000-8000-000000000003")


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
    config.set_main_option("sqlalchemy.url", engine.url.render_as_string(hide_password=False))
    return config


def _revision(engine: Engine) -> str:
    with engine.connect() as connection:
        return cast(
            str,
            connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one(),
        )


def _seed_report(engine: Engine) -> tuple[UUID, UUID, UUID]:
    captain_id, game_id, applicant_ids = _seed_registration_parents(engine)
    _insert_registration(
        engine,
        _valid_registration(
            registration_id=REGISTRATION_ID,
            game_id=game_id,
            applicant_user_id=applicant_ids[0],
        ),
    )
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO open_game_reports "
                "(id, game_id, reporter_registration_id, reporter_user_id, "
                "organizer_user_id, category, facts, submitted_at, "
                "idempotency_key, request_sha256) VALUES "
                "(:id, :game_id, :registration_id, :reporter_id, :organizer_id, "
                "'FALSE_INFORMATION', :facts, :submitted_at, :key, :digest)"
            ),
            {
                "id": REPORT_ID,
                "game_id": game_id,
                "registration_id": REGISTRATION_ID,
                "reporter_id": applicant_ids[0],
                "organizer_id": captain_id,
                "facts": "公开信息与现场安排不一致。",
                "submitted_at": datetime(2026, 9, 1, 8, tzinfo=UTC),
                "key": "game-report-key-0001",
                "digest": "a" * 64,
            },
        )
    return captain_id, game_id, applicant_ids[0]


def test_0024_round_trips_empty_storage_and_declares_strict_schema(
    migration_engine: Engine,
) -> None:
    config = _config(migration_engine)
    command.upgrade(config, "0023")
    command.upgrade(config, "0024")

    assert _revision(migration_engine) == "0024"
    assert _enum_labels(migration_engine, "open_game_report_category") == [
        "FALSE_INFORMATION",
        "EXTRA_CHARGE",
        "DANGEROUS_BEHAVIOR",
        "HARASSMENT",
        "ORGANIZER_NO_SHOW",
    ]
    assert _enum_labels(migration_engine, "open_game_report_resolution_outcome") == [
        "DISMISSED",
        "CONFIRMED_RECORDED",
        "CONFIRMED_GAME_CANCELLED",
    ]
    assert _enum_labels(migration_engine, "open_game_cancellation_source") == [
        "CAPTAIN",
        "PLATFORM_REPORT",
    ]

    inspector = inspect(migration_engine)
    assert [column["name"] for column in inspector.get_columns("open_game_reports")] == [
        "id",
        "game_id",
        "reporter_registration_id",
        "reporter_user_id",
        "organizer_user_id",
        "category",
        "facts",
        "submitted_at",
        "idempotency_key",
        "request_sha256",
    ]
    assert [column["name"] for column in inspector.get_columns("open_game_report_resolutions")] == [
        "id",
        "report_id",
        "outcome",
        "resolution_note",
        "resolved_by_principal_id",
        "resolved_at",
        "game_version_before",
        "game_version_after",
        "idempotency_key",
        "request_sha256",
    ]
    assert "cancellation_source" in {
        column["name"] for column in inspector.get_columns("open_games")
    }
    assert {
        foreign_key["name"] for foreign_key in inspector.get_foreign_keys("open_game_reports")
    } == {
        "fk_open_game_reports_game",
        "fk_open_game_reports_reporter_registration_identity",
        "fk_open_game_reports_organizer_user",
    }

    command.downgrade(config, "0023")
    assert _revision(migration_engine) == "0023"
    assert "open_game_reports" not in inspect(migration_engine).get_table_names()
    assert "cancellation_source" not in {
        column["name"] for column in inspect(migration_engine).get_columns("open_games")
    }


def test_0024_enforces_report_and_resolution_immutability(
    migration_engine: Engine,
) -> None:
    command.upgrade(_config(migration_engine), "0024")
    _seed_report(migration_engine)
    with migration_engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO open_game_report_resolutions "
                "(id, report_id, outcome, resolution_note, "
                "resolved_by_principal_id, resolved_at, game_version_before, "
                "game_version_after, idempotency_key, request_sha256) VALUES "
                "(:id, :report_id, 'CONFIRMED_RECORDED', :note, 'platform-admin', "
                "now(), NULL, NULL, :key, :digest)"
            ),
            {
                "id": RESOLUTION_ID,
                "report_id": REPORT_ID,
                "note": "已核实并记录本次举报。",
                "key": "game-resolution-key-0001",
                "digest": "b" * 64,
            },
        )

    for table, row_id, constraint in (
        ("open_game_reports", REPORT_ID, "ck_open_game_reports_append_only"),
        (
            "open_game_report_resolutions",
            RESOLUTION_ID,
            "ck_open_game_report_resolutions_append_only",
        ),
    ):
        for verb in ("UPDATE", "DELETE"):
            statement = (
                f"UPDATE {table} SET id = id WHERE id = :id"
                if verb == "UPDATE"
                else f"DELETE FROM {table} WHERE id = :id"
            )
            with pytest.raises(DBAPIError) as error:
                with migration_engine.begin() as connection:
                    connection.execute(text(statement), {"id": row_id})
            assert error.value.orig.diag.constraint_name == constraint

    with pytest.raises(RuntimeError, match="game report audit history"):
        command.downgrade(_config(migration_engine), "0023")
    assert _revision(migration_engine) == "0024"


def test_0024_constrains_resolution_version_pair_and_cancellation_source(
    migration_engine: Engine,
) -> None:
    command.upgrade(_config(migration_engine), "0024")
    _, game_id, _ = _seed_report(migration_engine)

    invalid_resolutions = (
        ("CONFIRMED_GAME_CANCELLED", None, None),
        ("CONFIRMED_GAME_CANCELLED", 3, 5),
        ("CONFIRMED_RECORDED", 3, 4),
        ("DISMISSED", 3, None),
    )
    for index, (outcome, before, after) in enumerate(invalid_resolutions):
        with pytest.raises(DBAPIError):
            with migration_engine.begin() as connection:
                connection.execute(
                    text(
                        "INSERT INTO open_game_report_resolutions "
                        "(id, report_id, outcome, resolution_note, "
                        "resolved_by_principal_id, resolved_at, game_version_before, "
                        "game_version_after, idempotency_key, request_sha256) VALUES "
                        "(:id, :report_id, :outcome, '已核实', 'platform-admin', "
                        "now(), :before, :after, :key, :digest)"
                    ),
                    {
                        "id": UUID(int=700 + index),
                        "report_id": REPORT_ID,
                        "outcome": outcome,
                        "before": before,
                        "after": after,
                        "key": f"invalid-resolution-{index:04d}",
                        "digest": f"{index + 1:x}" * 64,
                    },
                )

    for statement in (
        "UPDATE open_games SET cancellation_source = 'CAPTAIN' WHERE id = :id",
        "UPDATE open_games SET status = 'CANCELLED', cancelled_at = now(), "
        "cancellation_source = NULL WHERE id = :id",
    ):
        with pytest.raises(DBAPIError):
            with migration_engine.begin() as connection:
                connection.execute(text(statement), {"id": game_id})


def test_0024_backfills_captain_source_and_refuses_platform_cancel_downgrade(
    migration_engine: Engine,
) -> None:
    config = _config(migration_engine)
    command.upgrade(config, "0023")
    _, game_id, _ = _seed_registration_parents(migration_engine)
    with migration_engine.begin() as connection:
        connection.execute(
            text("UPDATE open_games SET status = 'CANCELLED', cancelled_at = now() WHERE id = :id"),
            {"id": game_id},
        )
    command.upgrade(config, "0024")
    with migration_engine.connect() as connection:
        assert (
            connection.execute(
                text("SELECT cancellation_source FROM open_games WHERE id = :id"),
                {"id": game_id},
            ).scalar_one()
            == "CAPTAIN"
        )
    command.downgrade(config, "0023")
    assert _revision(migration_engine) == "0023"

    command.upgrade(config, "0024")
    with migration_engine.begin() as connection:
        connection.execute(
            text("UPDATE open_games SET cancellation_source = 'PLATFORM_REPORT' WHERE id = :id"),
            {"id": game_id},
        )
    with pytest.raises(RuntimeError, match="game report audit history"):
        command.downgrade(config, "0023")
    assert _revision(migration_engine) == "0024"
