from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any, cast

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, Table, create_engine, inspect, text

from backend.app.models import OpenGameRegistration
from backend.tests.postgres_test_database import (
    disposable_database,
    override_test_database_url,
)

pytestmark = pytest.mark.integration

MIGRATION_PATH = Path("backend/migrations/versions/0017_my_open_game_applications.py")
INDEX_NAME = "ix_open_game_registrations_applicant_applied"
INDEX_COLUMNS = ["applicant_user_id", "applied_at", "id"]


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


def _index(engine: Engine) -> dict[str, Any] | None:
    return cast(
        dict[str, Any] | None,
        next(
            (
                index
                for index in inspect(engine).get_indexes("open_game_registrations")
                if index["name"] == INDEX_NAME
            ),
            None,
        ),
    )


def _column_signature(engine: Engine) -> list[tuple[str, str, bool]]:
    return [
        (column["name"], str(column["type"]), column["nullable"])
        for column in inspect(engine).get_columns("open_game_registrations")
    ]


def _enum_signature(engine: Engine) -> list[tuple[object, ...]]:
    with engine.connect() as connection:
        return [
            tuple(row)
            for row in connection.execute(
                text(
                    "SELECT type.typname, label.enumlabel, label.enumsortorder "
                    "FROM pg_type AS type "
                    "JOIN pg_enum AS label ON label.enumtypid = type.oid "
                    "ORDER BY type.typname, label.enumsortorder"
                )
            )
        ]


def test_model_declares_my_applications_pagination_index() -> None:
    table = cast(Table, OpenGameRegistration.__table__)
    index = next(
        (index for index in table.indexes if index.name == INDEX_NAME),
        None,
    )
    assert index is not None
    assert [column.name for column in index.columns] == INDEX_COLUMNS
    assert index.unique is False


def test_0017_only_adds_and_removes_my_applications_index(
    migration_engine: Engine,
) -> None:
    assert MIGRATION_PATH.is_file(), "Alembic 0017 migration must exist"
    config = _config(migration_engine)
    command.upgrade(config, "0016")
    before_columns = _column_signature(migration_engine)
    before_enums = _enum_signature(migration_engine)
    assert _index(migration_engine) is None

    command.upgrade(config, "0017")
    created = _index(migration_engine)
    assert created is not None
    assert created["column_names"] == INDEX_COLUMNS
    assert created["unique"] is False
    assert _column_signature(migration_engine) == before_columns
    assert _enum_signature(migration_engine) == before_enums
    with migration_engine.connect() as connection:
        version = connection.execute(
            text("SELECT version_num FROM alembic_version")
        ).scalar_one()
        assert version == "0017"

    command.downgrade(config, "0016")
    assert _index(migration_engine) is None
    assert _column_signature(migration_engine) == before_columns
    assert _enum_signature(migration_engine) == before_enums
