from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, MetaData, Table, create_engine, insert, inspect, text
from sqlalchemy.exc import IntegrityError

from backend.tests.postgres_test_database import (
    disposable_database,
    override_test_database_url,
)

pytestmark = pytest.mark.integration


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


def test_platform_session_migration_round_trips_without_staff_credentials(
    migration_engine: Engine,
) -> None:
    config = _config(migration_engine)
    command.upgrade(config, "0011")

    command.upgrade(config, "0012")

    inspector = inspect(migration_engine)
    assert "platform_sessions" in inspector.get_table_names()
    columns = {column["name"] for column in inspector.get_columns("platform_sessions")}
    assert columns == {
        "id",
        "token_hash",
        "principal_id",
        "issued_at",
        "expires_at",
        "revoked_at",
    }
    assert not {"access_token", "raw_token", "csrf_token", "roles"} & columns
    indexes = {item["name"] for item in inspector.get_indexes("platform_sessions")}
    assert {"uq_platform_sessions_token_hash", "ix_platform_sessions_principal_id"} <= indexes

    command.downgrade(config, "0011")
    assert "platform_sessions" not in inspect(migration_engine).get_table_names()


def test_platform_session_constraints_reject_invalid_hash_and_expiry(
    migration_engine: Engine,
) -> None:
    command.upgrade(_config(migration_engine), "0012")
    table = Table("platform_sessions", MetaData(), autoload_with=migration_engine)
    now = datetime.now(UTC)
    valid = {
        "id": "10000000-0000-0000-0000-000000000001",
        "token_hash": "a" * 64,
        "principal_id": "ops-1",
        "issued_at": now,
        "expires_at": now + timedelta(hours=8),
        "revoked_at": None,
    }
    with migration_engine.begin() as connection:
        connection.execute(insert(table).values(**valid))

    for changes in (
        {"id": "10000000-0000-0000-0000-000000000002", "token_hash": "A" * 64},
        {
            "id": "10000000-0000-0000-0000-000000000003",
            "token_hash": "b" * 64,
            "principal_id": " ",
        },
        {
            "id": "10000000-0000-0000-0000-000000000004",
            "token_hash": "c" * 64,
            "expires_at": now,
        },
        {
            "id": "10000000-0000-0000-0000-000000000005",
            "token_hash": "d" * 64,
            "revoked_at": now - timedelta(seconds=1),
        },
    ):
        with pytest.raises(IntegrityError):
            with migration_engine.begin() as connection:
                connection.execute(insert(table).values(**{**valid, **changes}))


def test_migration_head_is_0022(migration_engine: Engine) -> None:
    command.upgrade(_config(migration_engine), "head")
    with migration_engine.connect() as connection:
        assert connection.execute(
            text("SELECT version_num FROM alembic_version")
        ).scalar_one() == "0022"


def test_platform_session_migration_matches_model_metadata(
    migration_engine: Engine,
) -> None:
    config = _config(migration_engine)
    command.upgrade(config, "head")

    command.check(config)
