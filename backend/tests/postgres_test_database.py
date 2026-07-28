import os
import re
import uuid
from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import URL, Connection, create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError

_DATABASE_NAME_PREFIX = "pitch_booking_test_"
_SAFE_DATABASE_NAME = re.compile(r"[a-z0-9_]+", re.ASCII)
_MANAGEMENT_DATABASES = frozenset({"postgres", "template0", "template1"})


def validate_test_database_url(database_url: str | URL | None) -> URL:
    if database_url is None:
        raise ValueError("TEST_DATABASE_URL is required for PostgreSQL integration tests")
    try:
        url = database_url if isinstance(database_url, URL) else make_url(database_url)
    except ArgumentError as error:
        raise ValueError("TEST_DATABASE_URL is invalid") from error
    if url.get_backend_name() != "postgresql":
        raise ValueError("TEST_DATABASE_URL must use PostgreSQL")
    if url.database is None or not url.database:
        raise ValueError("TEST_DATABASE_URL must name a source database")
    if url.database.casefold() in _MANAGEMENT_DATABASES:
        raise ValueError("TEST_DATABASE_URL must not target a PostgreSQL management database")
    return url


def require_postgresql_17(server_version_num: int) -> None:
    if server_version_num // 10000 != 17:
        raise ValueError("PostgreSQL 17 is required for integration tests")


def generate_disposable_database_name(*, token_hex: str | None = None) -> str:
    token = token_hex if token_hex is not None else uuid.uuid4().hex
    if re.fullmatch(r"[0-9a-f]{32}", token) is None:
        raise ValueError("disposable database token must be 32 lowercase hex characters")
    database_name = f"{_DATABASE_NAME_PREFIX}{token}"
    if _SAFE_DATABASE_NAME.fullmatch(database_name) is None:
        raise AssertionError("generated database name is not a safe identifier")
    if len(database_name.encode("ascii")) > 63:
        raise AssertionError("generated database name exceeds PostgreSQL's identifier limit")
    return database_name


def build_disposable_database_url(
    source_url: URL, *, token_hex: str | None = None
) -> URL:
    target_name = generate_disposable_database_name(token_hex=token_hex)
    if source_url.database == target_name:
        raise ValueError("disposable database must be distinct from its source database")
    return source_url.set(database=target_name)


@contextmanager
def override_test_database_url(database_url: str) -> Iterator[None]:
    previous = os.environ.get("TEST_DATABASE_URL")
    os.environ["TEST_DATABASE_URL"] = database_url
    try:
        yield
    finally:
        if previous is None:
            os.environ.pop("TEST_DATABASE_URL", None)
        else:
            os.environ["TEST_DATABASE_URL"] = previous


def _quoted_database_name(connection: Connection, database_name: str) -> str:
    if _SAFE_DATABASE_NAME.fullmatch(database_name) is None:
        raise ValueError("refusing unsafe generated database name")
    return connection.dialect.identifier_preparer.quote_identifier(database_name)


@contextmanager
def disposable_database(
    database_url: str | URL, *, token_hex: str | None = None
) -> Iterator[URL]:
    source_url = validate_test_database_url(database_url)
    source_engine = create_engine(source_url)
    try:
        with source_engine.connect() as connection:
            server_version_num = connection.execute(
                text("SELECT current_setting('server_version_num')::integer")
            ).scalar_one()
    finally:
        source_engine.dispose()
    require_postgresql_17(server_version_num)

    target_url = build_disposable_database_url(source_url, token_hex=token_hex)
    target_name = target_url.database
    if target_name is None or target_name == source_url.database:
        raise AssertionError("disposable database target must be present and distinct")

    admin_engine = create_engine(
        source_url.set(database="postgres"), isolation_level="AUTOCOMMIT"
    )
    created = False
    try:
        with admin_engine.connect() as connection:
            exists = connection.execute(
                text("SELECT 1 FROM pg_database WHERE datname = :name"),
                {"name": target_name},
            ).scalar_one_or_none()
            if exists is not None:
                raise RuntimeError("generated disposable database already exists")
            quoted_target = _quoted_database_name(connection, target_name)
            connection.exec_driver_sql(f"CREATE DATABASE {quoted_target}")
            created = True
        yield target_url
    finally:
        try:
            if created:
                with admin_engine.connect() as connection:
                    connection.execute(
                        text(
                            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                            "WHERE datname = :name AND pid <> pg_backend_pid()"
                        ),
                        {"name": target_name},
                    )
                    quoted_target = _quoted_database_name(connection, target_name)
                    connection.exec_driver_sql(f"DROP DATABASE {quoted_target}")
        finally:
            admin_engine.dispose()
