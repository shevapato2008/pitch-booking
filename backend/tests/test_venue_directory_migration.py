from collections.abc import Iterator
from importlib import import_module

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, create_engine, inspect, text

from backend.tests.postgres_test_database import (
    disposable_database,
    override_test_database_url,
)

PRIMARY_ID = "7e68d7d8-4b7e-4f04-a5c5-3fe263e69c6f"
DIRECTORY_ID = "e03d801d-1254-5c62-9a16-9a8800280162"
EXPECTED_DISTRICTS = {
    PRIMARY_ID: ("120111", "西青区"),
    DIRECTORY_ID: ("120104", "南开区"),
    "2a9640a5-f625-5ad8-9cb9-3440acb70967": ("120105", "河北区"),
    "80532433-8038-5ee5-9963-3e6282aa4abd": ("120101", "和平区"),
    "c0372328-6fa4-585a-b951-3324925763d6": ("120110", "东丽区"),
}
EXPECTED_SLUGS = {
    PRIMARY_ID: "test-xingyue-football-park",
    DIRECTORY_ID: "tianjin-olympic-center-five-a-side-football-pitch",
    "2a9640a5-f625-5ad8-9cb9-3440acb70967": "tianjin-locomotive-stadium",
    "80532433-8038-5ee5-9963-3e6282aa4abd": "tianjin-peoples-gymnasium-football-pitch",
    "c0372328-6fa4-585a-b951-3324925763d6": "dongli-sports-center-football-pitch",
}


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


def _insert_legacy_venue(
    engine: Engine,
    *,
    venue_id: str,
    slug: str,
    is_primary: bool,
    is_active: bool,
) -> None:
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO venues (id, slug, name, description, price_advantage_text, "
                "timezone, business_hours_text, address, parking_text, phone, "
                "refund_policy_text, latitude, longitude, is_primary, is_active) VALUES "
                "(:id, :slug, 'Legacy venue', 'Legacy description', 'Legacy price', "
                "'Asia/Shanghai', '09:00-23:00', 'Legacy address', 'Legacy parking', "
                "'+86-22-0000-0000', 'Legacy refund', 39.0, 117.0, :primary, :active)"
            ),
            {
                "id": venue_id,
                "slug": slug,
                "primary": is_primary,
                "active": is_active,
            },
        )


def test_revision_declares_fixed_identity_mapping_and_guarded_unload_command() -> None:
    migration = import_module(
        "backend.migrations.versions.0006_map_venue_directory"
    )
    assert migration.revision == "0006"
    assert migration.down_revision == "0005"
    assert migration.CANONICAL_PRIMARY_ID == PRIMARY_ID
    assert migration.LEGACY_PRIMARY_SLUG == "test-xingyue-football-park"
    assert migration.CANONICAL_PRIMARY_SLUG == "bohai-yuanfeng-football-pitch"
    assert "--unload-directory" in migration.UNSAFE_DOWNGRADE_MESSAGE


def test_district_revision_declares_the_reviewed_fixed_identity_mapping() -> None:
    migration = import_module("backend.migrations.versions.0007_venue_district")

    assert migration.revision == "0007"
    assert migration.down_revision == "0006"
    assert migration.VENUE_DISTRICTS == EXPECTED_DISTRICTS


@pytest.mark.integration
def test_district_upgrade_backfills_only_the_five_reviewed_venue_ids(
    migration_engine: Engine,
) -> None:
    config = _config(migration_engine)
    command.upgrade(config, "0005")
    for venue_id, slug in EXPECTED_SLUGS.items():
        _insert_legacy_venue(
            migration_engine,
            venue_id=venue_id,
            slug=slug,
            is_primary=venue_id == PRIMARY_ID,
            is_active=True,
        )

    command.upgrade(config, "head")

    with migration_engine.connect() as connection:
        rows = connection.execute(
            text(
                "SELECT id::text, district_code, district_name "
                "FROM venues ORDER BY sort_order"
            )
        ).all()
        version = connection.execute(
            text("SELECT version_num FROM alembic_version")
        ).scalar_one()
    assert {row[0]: (row[1], row[2]) for row in rows} == EXPECTED_DISTRICTS
    assert version == "0029"
    columns = {column["name"]: column for column in inspect(migration_engine).get_columns("venues")}
    assert columns["district_code"]["nullable"] is False
    assert columns["district_name"]["nullable"] is False


@pytest.mark.integration
def test_district_upgrade_aborts_atomically_for_unknown_preexisting_venue(
    migration_engine: Engine,
) -> None:
    config = _config(migration_engine)
    command.upgrade(config, "0006")
    with migration_engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO venues (id, slug, name, description, price_advantage_text, "
                "timezone, business_hours_text, address, parking_text, phone, "
                "refund_policy_text, latitude, longitude, booking_mode, navigation_poi_name, "
                "navigation_latitude, navigation_longitude, sort_order, content_verified_at, "
                "is_listed, public_pitch_types, is_primary, is_active) VALUES "
                "('90000000-0000-0000-0000-000000000007', 'unknown-at-0006', 'Unknown', '', "
                "'Price', 'Asia/Shanghai', 'Always', 'Unknown address', 'Parking', 'Phone', "
                "'Refund', 39.0, 117.0, 'ONLINE', 'Unknown', 39.0, 117.0, 99, now(), true, "
                "'[]'::jsonb, false, true)"
            )
        )

    with pytest.raises(RuntimeError, match="district mapping missing"):
        command.upgrade(config, "head")

    column_names = {
        column["name"] for column in inspect(migration_engine).get_columns("venues")
    }
    assert "district_code" not in column_names
    assert "district_name" not in column_names
    with migration_engine.connect() as connection:
        assert connection.execute(
            text("SELECT version_num FROM alembic_version")
        ).scalar_one() == "0006"


@pytest.mark.integration
def test_district_downgrade_removes_only_district_columns(
    migration_engine: Engine,
) -> None:
    config = _config(migration_engine)
    command.upgrade(config, "0005")
    _insert_legacy_venue(
        migration_engine,
        venue_id=PRIMARY_ID,
        slug="test-xingyue-football-park",
        is_primary=True,
        is_active=True,
    )
    with migration_engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO pitches (id, venue_id, code, name, pitch_type, sort_order) "
                "VALUES ('10000000-0000-0000-0000-000000000007', :venue_id, "
                "'preserved', 'Preserved pitch', 'FIVE_A_SIDE', 0)"
            ),
            {"venue_id": PRIMARY_ID},
        )
    command.upgrade(config, "0006")
    before_columns = {
        column["name"] for column in inspect(migration_engine).get_columns("venues")
    }
    with migration_engine.connect() as connection:
        before_venue = connection.execute(
            text(
                "SELECT id::text, slug, booking_mode::text, navigation_poi_name, "
                "navigation_latitude, navigation_longitude, sort_order, content_verified_at, "
                "is_listed, public_pitch_types, is_primary, is_active FROM venues"
            )
        ).one()
        before_pitch = connection.execute(
            text("SELECT id::text, venue_id::text, code, name, pitch_type, sort_order FROM pitches")
        ).one()

    command.upgrade(config, "0007")
    command.downgrade(config, "0006")

    after_columns = {
        column["name"] for column in inspect(migration_engine).get_columns("venues")
    }
    with migration_engine.connect() as connection:
        after_venue = connection.execute(
            text(
                "SELECT id::text, slug, booking_mode::text, navigation_poi_name, "
                "navigation_latitude, navigation_longitude, sort_order, content_verified_at, "
                "is_listed, public_pitch_types, is_primary, is_active FROM venues"
            )
        ).one()
        after_pitch = connection.execute(
            text("SELECT id::text, venue_id::text, code, name, pitch_type, sort_order FROM pitches")
        ).one()
        version = connection.execute(
            text("SELECT version_num FROM alembic_version")
        ).scalar_one()
    assert after_columns == before_columns
    assert after_venue == before_venue
    assert after_pitch == before_pitch
    assert version == "0006"


@pytest.mark.integration
def test_upgrade_maps_primary_once_and_preserves_inventory_foreign_keys(
    migration_engine: Engine,
) -> None:
    config = _config(migration_engine)
    command.upgrade(config, "0005")
    _insert_legacy_venue(
        migration_engine,
        venue_id=PRIMARY_ID,
        slug="test-xingyue-football-park",
        is_primary=True,
        is_active=True,
    )
    _insert_legacy_venue(
        migration_engine,
        venue_id=DIRECTORY_ID,
        slug="tianjin-olympic-center-five-a-side-football-pitch",
        is_primary=False,
        is_active=False,
    )
    with migration_engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO pitches (id, venue_id, code, name, pitch_type, sort_order) "
                "VALUES ('10000000-0000-0000-0000-000000000001', :venue_id, "
                "'legacy', 'Legacy pitch', 'FIVE_A_SIDE', 0)"
            ),
            {"venue_id": PRIMARY_ID},
        )

    command.upgrade(config, "head")

    with migration_engine.connect() as connection:
        rows = connection.execute(
            text(
                "SELECT id::text, slug, booking_mode::text, is_primary, is_listed "
                "FROM venues ORDER BY id"
            )
        ).all()
        pitch_venue_id = connection.execute(
            text("SELECT venue_id::text FROM pitches")
        ).scalar_one()
    by_id = {row[0]: row for row in rows}
    assert by_id[PRIMARY_ID][1:] == (
        "bohai-yuanfeng-football-pitch",
        "ONLINE",
        True,
        True,
    )
    assert by_id[DIRECTORY_ID][2:] == ("DIRECTORY_ONLY", False, True)
    assert pitch_venue_id == PRIMARY_ID


@pytest.mark.integration
def test_unmapped_legacy_venue_aborts_the_upgrade_atomically(
    migration_engine: Engine,
) -> None:
    config = _config(migration_engine)
    command.upgrade(config, "0005")
    _insert_legacy_venue(
        migration_engine,
        venue_id="90000000-0000-0000-0000-000000000001",
        slug="unknown-legacy-venue",
        is_primary=False,
        is_active=False,
    )

    with pytest.raises(RuntimeError, match="unmapped legacy venue"):
        command.upgrade(config, "head")

    assert "booking_mode" not in {
        column["name"] for column in inspect(migration_engine).get_columns("venues")
    }
    with migration_engine.connect() as connection:
        version = connection.execute(
            text("SELECT version_num FROM alembic_version")
        ).scalar_one()
        assert version == "0005"


@pytest.mark.integration
def test_directory_identity_with_inventory_aborts_before_mode_change(
    migration_engine: Engine,
) -> None:
    config = _config(migration_engine)
    command.upgrade(config, "0005")
    _insert_legacy_venue(
        migration_engine,
        venue_id=DIRECTORY_ID,
        slug="tianjin-olympic-center-five-a-side-football-pitch",
        is_primary=False,
        is_active=True,
    )
    with migration_engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO pitches (id, venue_id, code, name, pitch_type, sort_order) "
                "VALUES ('10000000-0000-0000-0000-000000000099', :venue_id, "
                "'unsafe', 'Unsafe pitch', 'FIVE_A_SIDE', 0)"
            ),
            {"venue_id": DIRECTORY_ID},
        )

    with pytest.raises(RuntimeError, match="directory identity has booking inventory"):
        command.upgrade(config, "head")

    assert "booking_mode" not in {
        column["name"] for column in inspect(migration_engine).get_columns("venues")
    }


@pytest.mark.integration
def test_directory_rows_guard_downgrade_before_schema_mutation(
    migration_engine: Engine,
) -> None:
    config = _config(migration_engine)
    command.upgrade(config, "0005")
    _insert_legacy_venue(
        migration_engine,
        venue_id=PRIMARY_ID,
        slug="test-xingyue-football-park",
        is_primary=True,
        is_active=True,
    )
    _insert_legacy_venue(
        migration_engine,
        venue_id=DIRECTORY_ID,
        slug="tianjin-olympic-center-five-a-side-football-pitch",
        is_primary=False,
        is_active=True,
    )
    command.upgrade(config, "head")

    with pytest.raises(RuntimeError, match="--unload-directory"):
        command.downgrade(config, "0005")

    assert "booking_mode" in {
        column["name"] for column in inspect(migration_engine).get_columns("venues")
    }
    with migration_engine.connect() as connection:
        version = connection.execute(
            text("SELECT version_num FROM alembic_version")
        ).scalar_one()
        assert version == "0029"

    with migration_engine.begin() as connection:
        connection.execute(
            text("DELETE FROM venues WHERE booking_mode = 'DIRECTORY_ONLY'")
        )
    command.downgrade(config, "0005")
    command.upgrade(config, "head")
    with migration_engine.connect() as connection:
        version = connection.execute(
            text("SELECT version_num FROM alembic_version")
        ).scalar_one()
        assert version == "0029"
