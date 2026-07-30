import os
from collections.abc import Iterator
from typing import cast

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.orm import Session

from backend.app.database import get_database
from backend.app.main import create_app
from backend.tests.postgres_test_database import (
    disposable_database,
    override_test_database_url,
    validate_test_database_url,
)


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line(
        "markers", "integration: requires the configured PostgreSQL test database"
    )


@pytest.fixture(scope="session")
def test_database_url() -> str:
    database_url = os.environ.get("TEST_DATABASE_URL")
    try:
        validate_test_database_url(database_url)
    except ValueError as error:
        raise pytest.UsageError(str(error)) from error
    assert database_url is not None
    return database_url


@pytest.fixture(scope="session")
def pg_engine(test_database_url: str) -> Iterator[Engine]:
    with disposable_database(test_database_url) as target_url:
        target_database_url = target_url.render_as_string(hide_password=False)
        with override_test_database_url(target_database_url):
            engine = create_engine(target_url)
            migration_config = Config("alembic.ini")
            migration_config.set_main_option("sqlalchemy.url", target_database_url)
            try:
                command.upgrade(migration_config, "head")
                yield engine
            finally:
                engine.dispose()


@pytest.fixture(autouse=True)
def clean_postgresql_tables(request: pytest.FixtureRequest) -> Iterator[None]:
    if request.node.get_closest_marker("integration") is None:
        yield
        return

    engine = cast(Engine, request.getfixturevalue("pg_engine"))
    with engine.begin() as connection:
        connection.execute(
            text(
                "TRUNCATE TABLE idempotency_records, user_sessions, orders, slots, "
                "pitches, venue_transit_stops, venue_facilities, venue_images, "
                "venues, users CASCADE"
            )
        )
    yield


@pytest.fixture
def pg_session(pg_engine: Engine) -> Iterator[Session]:
    with pg_engine.connect() as connection:
        transaction = connection.begin()
        with Session(connection, join_transaction_mode="create_savepoint") as session:
            yield session
            session.rollback()
        transaction.rollback()


class RecordingDatabase:
    def __init__(self, *, broken: bool = False) -> None:
        self.broken = broken
        self.statements: list[str] = []

    def execute(self, statement: object) -> None:
        self.statements.append(str(statement))
        if self.broken:
            raise RuntimeError("postgresql://secret@database/pitch")


@pytest.fixture
def database() -> RecordingDatabase:
    return RecordingDatabase()


@pytest.fixture
def client(database: RecordingDatabase) -> Iterator[TestClient]:
    app = create_app(include_test_routes=True)
    app.dependency_overrides[get_database] = lambda: database
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client


@pytest.fixture
def broken_client() -> Iterator[TestClient]:
    app = create_app(include_test_routes=True)
    app.dependency_overrides[get_database] = lambda: RecordingDatabase(broken=True)
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client
