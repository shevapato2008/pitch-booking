import os
import re
import uuid

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.engine import URL

from backend.tests.postgres_test_database import (
    build_disposable_database_url,
    disposable_database,
    generate_disposable_database_name,
    override_test_database_url,
    require_postgresql_17,
    validate_test_database_url,
)


def test_disposable_name_is_generated_not_derived_from_quoted_source() -> None:
    source_name = f'{"s" * 61}\"x'
    source_url = URL.create(
        "postgresql+psycopg",
        username="pitch",
        password="booking",
        host="database",
        port=5432,
        database=source_name,
    )

    target_url = build_disposable_database_url(source_url, token_hex="a" * 32)
    target_name = target_url.database

    assert source_url.database == source_name
    assert target_name is not None
    assert target_name != source_name
    assert re.fullmatch(r"[a-z0-9_]+", target_name)
    assert len(target_name.encode("utf-8")) <= 63
    assert target_name == generate_disposable_database_name(token_hex="a" * 32)


@pytest.mark.parametrize(
    ("database_url", "message"),
    [
        (None, "TEST_DATABASE_URL is required"),
        ("sqlite+pysqlite:///:memory:", "must use PostgreSQL"),
        ("postgresql+psycopg://pitch:booking@database/postgres", "management database"),
        ("postgresql+psycopg://pitch:booking@database/template0", "management database"),
        ("postgresql+psycopg://pitch:booking@database/template1", "management database"),
    ],
)
def test_test_database_url_validation_fails_closed(
    database_url: str | None, message: str
) -> None:
    with pytest.raises(ValueError, match=message):
        validate_test_database_url(database_url)


def test_postgresql_17_validation_fails_closed() -> None:
    with pytest.raises(ValueError, match="PostgreSQL 17 is required"):
        require_postgresql_17(160009)


def test_test_database_url_override_restores_existing_value(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TEST_DATABASE_URL", "source-url")

    with pytest.raises(RuntimeError, match="sentinel"):
        with override_test_database_url("target-url"):
            assert os.environ["TEST_DATABASE_URL"] == "target-url"
            raise RuntimeError("sentinel")

    assert os.environ["TEST_DATABASE_URL"] == "source-url"


def test_test_database_url_override_restores_missing_value(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("TEST_DATABASE_URL", raising=False)

    with override_test_database_url("target-url"):
        assert os.environ["TEST_DATABASE_URL"] == "target-url"

    assert "TEST_DATABASE_URL" not in os.environ


@pytest.mark.integration
def test_disposable_database_cleans_up_exact_created_target_on_error(
    test_database_url: str,
) -> None:
    source_url = validate_test_database_url(test_database_url)
    target_name: str | None = None

    with pytest.raises(RuntimeError, match="sentinel"):
        with disposable_database(source_url) as target_url:
            target_name = target_url.database
            assert target_name != source_url.database
            raise RuntimeError("sentinel")

    assert target_name is not None
    admin_engine = create_engine(source_url.set(database="postgres"))
    try:
        with admin_engine.connect() as connection:
            assert connection.execute(
                text("SELECT 1 FROM pg_database WHERE datname = :name"),
                {"name": target_name},
            ).scalar_one_or_none() is None
    finally:
        admin_engine.dispose()


@pytest.mark.integration
def test_disposable_database_never_drops_an_existing_generated_target(
    test_database_url: str,
) -> None:
    source_url = validate_test_database_url(test_database_url)
    token_hex = "f" * 32

    with disposable_database(source_url, token_hex=token_hex) as first_target:
        with pytest.raises(RuntimeError, match="already exists"):
            with disposable_database(source_url, token_hex=token_hex):
                pytest.fail("existing target must never be reused")

        admin_engine = create_engine(source_url.set(database="postgres"))
        try:
            with admin_engine.connect() as connection:
                assert connection.execute(
                    text("SELECT 1 FROM pg_database WHERE datname = :name"),
                    {"name": first_target.database},
                ).scalar_one() == 1
        finally:
            admin_engine.dispose()


@pytest.mark.integration
def test_shared_engine_runs_in_a_distinct_disposable_database(
    test_database_url: str, pg_engine: Engine
) -> None:
    source_url = validate_test_database_url(test_database_url)
    target_database_url = pg_engine.url.render_as_string(hide_password=False)

    assert pg_engine.url.database is not None
    assert pg_engine.url.database != source_url.database
    assert pg_engine.url.database.startswith("pitch_booking_test_")
    assert os.environ["TEST_DATABASE_URL"] == target_database_url

    source_engine = create_engine(source_url)
    try:
        with source_engine.connect() as connection:
            assert connection.execute(text("SELECT current_database()")).scalar_one() == (
                source_url.database
            )
    finally:
        source_engine.dispose()


@pytest.mark.integration
def test_target_migration_preserves_source_database(
    test_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source_url = validate_test_database_url(test_database_url)
    marker_name = f"source_preserved_{uuid.uuid4().hex}"
    source_engine = create_engine(source_url)
    quoted_marker = source_engine.dialect.identifier_preparer.quote_identifier(marker_name)
    try:
        with source_engine.begin() as connection:
            connection.exec_driver_sql(f"CREATE TABLE {quoted_marker} (id integer)")

        with disposable_database(source_url) as target_url:
            with override_test_database_url(
                target_url.render_as_string(hide_password=False)
            ):
                config = Config("alembic.ini")
                config.set_main_option(
                    "sqlalchemy.url", target_url.render_as_string(hide_password=False)
                )
                command.upgrade(config, "head")

        with source_engine.connect() as connection:
            assert connection.execute(
                text("SELECT to_regclass(:name)"), {"name": marker_name}
            ).scalar_one() == marker_name
    finally:
        with source_engine.begin() as connection:
            connection.exec_driver_sql(f"DROP TABLE IF EXISTS {quoted_marker}")
        source_engine.dispose()
