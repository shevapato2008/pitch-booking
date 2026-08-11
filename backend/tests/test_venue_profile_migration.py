from collections.abc import Iterator
from io import StringIO
from typing import cast

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, Table, UniqueConstraint, create_engine, inspect, text

from backend.app.models import ProfileMutationIdempotencyRecord
from backend.tests.postgres_test_database import (
    disposable_database,
    override_test_database_url,
)

VENUE_ID = "10000000-0000-0000-0000-000000000010"
IMAGE_ID = "10000000-0000-0000-0000-000000000011"
FACILITY_ID = "10000000-0000-0000-0000-000000000012"


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


def _insert_published_profile(engine: Engine) -> None:
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO venues (id, slug, name, description, price_advantage_text, "
                "timezone, business_hours_text, address, district_code, district_name, "
                "parking_text, phone, refund_policy_text, latitude, longitude, booking_mode, "
                "navigation_poi_name, navigation_latitude, navigation_longitude, sort_order, "
                "content_verified_at, is_listed, public_pitch_types, is_primary, is_active, "
                "configuration_version) VALUES (:id, 'legacy-profile', 'Legacy venue', "
                "'Published description', 'Published price', 'Asia/Shanghai', '09:00-23:00', "
                "'Published address', '120111', '西青区', 'Published parking', "
                "'+86-22-0000-0000', 'Published refund', 39, 117, 'ONLINE', 'Published POI', "
                "39, 117, 0, now(), true, '[\"FIVE_A_SIDE\"]'::jsonb, false, true, 7)"
            ),
            {"id": VENUE_ID},
        )
        connection.execute(
            text(
                "INSERT INTO venue_images (id, venue_id, url, alt, role, sort_order) VALUES "
                "(:id, :venue_id, 'https://img.example/published.jpg', 'Published cover', "
                "'COVER', 0)"
            ),
            {"id": IMAGE_ID, "venue_id": VENUE_ID},
        )
        connection.execute(
            text(
                "INSERT INTO venue_facilities (id, venue_id, code, name, sort_order) VALUES "
                "(:id, :venue_id, 'LIGHTING', 'Published lighting', 0)"
            ),
            {"id": FACILITY_ID, "venue_id": VENUE_ID},
        )


def _published_rows(engine: Engine) -> tuple[tuple[object, ...], tuple[object, ...]]:
    with engine.connect() as connection:
        image = connection.execute(
            text(
                "SELECT id::text, venue_id::text, url, alt, role::text, sort_order "
                "FROM venue_images WHERE id = :id"
            ),
            {"id": IMAGE_ID},
        ).one()
        facility = connection.execute(
            text(
                "SELECT id::text, venue_id::text, code::text, name, sort_order "
                "FROM venue_facilities WHERE id = :id"
            ),
            {"id": FACILITY_ID},
        ).one()
    return tuple(image), tuple(facility)


def test_profile_mutation_idempotency_scope_includes_actor_and_venue() -> None:
    constraint = cast(
        UniqueConstraint,
        next(
            item
            for item in cast(Table, ProfileMutationIdempotencyRecord.__table__).constraints
            if item.name == "uq_profile_mutations_scope_key"
        ),
    )
    assert tuple(constraint.columns.keys()) == ("venue_id", "actor_user_id", "scope", "key")


def test_upgrade_sql_scopes_profile_idempotency_by_actor_and_venue(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    output = StringIO()
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://unused@localhost/unused")
    config = Config("alembic.ini", output_buffer=output)

    command.upgrade(config, "0009:0010", sql=True)

    assert "UNIQUE (venue_id, actor_user_id, scope, key)" in output.getvalue()


def test_downgrade_sql_deletes_facilities_unsupported_by_0009(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    output = StringIO()
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://unused@localhost/unused")
    config = Config("alembic.ini", output_buffer=output)
    config.set_main_option("sqlalchemy.url", "postgresql+psycopg://unused@localhost/unused")

    command.downgrade(config, "0010:0009", sql=True)

    sql = output.getvalue()
    assert "DELETE FROM venue_facilities" in sql
    assert "SHOWER" in sql


@pytest.mark.integration
def test_upgrade_and_downgrade_preserve_legacy_published_profile(
    migration_engine: Engine,
) -> None:
    config = _config(migration_engine)
    command.upgrade(config, "0009")
    _insert_published_profile(migration_engine)
    published_before = _published_rows(migration_engine)

    command.upgrade(config, "0010")

    inspector = inspect(migration_engine)
    assert set(inspector.get_table_names()) >= {
        "venue_profile_revisions",
        "venue_profile_image_drafts",
        "content_moderation_jobs",
        "content_moderation_decisions",
        "profile_mutation_idempotency_records",
    }
    columns = {column["name"]: column for column in inspector.get_columns("venues")}
    assert columns["profile_version"]["default"] == "1"
    assert columns["facility_version"]["default"] == "1"
    with migration_engine.connect() as connection:
        venue = connection.execute(
            text(
                "SELECT description, configuration_version, profile_version, facility_version "
                "FROM venues WHERE id = :id"
            ),
            {"id": VENUE_ID},
        ).one()
    assert tuple(venue) == ("Published description", 7, 1, 1)
    assert _published_rows(migration_engine) == published_before

    command.downgrade(config, "0009")

    inspector = inspect(migration_engine)
    assert not {
        "venue_profile_revisions",
        "venue_profile_image_drafts",
        "content_moderation_jobs",
        "content_moderation_decisions",
        "profile_mutation_idempotency_records",
    } & set(inspector.get_table_names())
    assert {column["name"] for column in inspector.get_columns("venues")} >= {
        "configuration_version"
    }
    assert not {"profile_version", "facility_version"} & {
        column["name"] for column in inspector.get_columns("venues")
    }
    assert _published_rows(migration_engine) == published_before
    with migration_engine.connect() as connection:
        assert (
            connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
            == "0009"
        )


@pytest.mark.integration
def test_downgrade_removes_facilities_not_supported_by_0009(
    migration_engine: Engine,
) -> None:
    config = _config(migration_engine)
    command.upgrade(config, "0009")
    _insert_published_profile(migration_engine)
    command.upgrade(config, "0010")
    with migration_engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO venue_facilities (id, venue_id, code, name, sort_order) VALUES "
                "('10000000-0000-0000-0000-000000000013', :venue_id, "
                "'SHOWER', 'Published shower', 1)"
            ),
            {"venue_id": VENUE_ID},
        )

    command.downgrade(config, "0009")

    with migration_engine.connect() as connection:
        rows = connection.execute(
            text(
                "SELECT code::text, name FROM venue_facilities "
                "WHERE venue_id = :venue_id ORDER BY sort_order"
            ),
            {"venue_id": VENUE_ID},
        ).all()
        facilities = [(row[0], row[1]) for row in rows]
    assert facilities == [("LIGHTING", "Published lighting")]
