from collections.abc import Iterator

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import DateTime, Engine, create_engine, inspect, text

from backend.tests.postgres_test_database import (
    disposable_database,
    override_test_database_url,
)

pytestmark = pytest.mark.integration


@pytest.fixture
def migration_engine(test_database_url: str) -> Iterator[Engine]:
    with disposable_database(test_database_url) as migration_url:
        migration_database_url = migration_url.render_as_string(hide_password=False)
        with override_test_database_url(migration_database_url):
            engine = create_engine(migration_url)
            try:
                yield engine
            finally:
                engine.dispose()


def _config(engine: Engine) -> Config:
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", engine.url.render_as_string(hide_password=False))
    return config


def _circular_foreign_keys(engine: Engine) -> set[tuple[str, str, str, str]]:
    with engine.connect() as connection:
        rows = connection.execute(
            text(
                "SELECT con.conname, src.relname, dst.relname, con.confdeltype "
                "FROM pg_constraint con "
                "JOIN pg_class src ON src.oid = con.conrelid "
                "JOIN pg_class dst ON dst.oid = con.confrelid "
                "WHERE con.contype = 'f' "
                "AND ((src.relname = 'orders' AND dst.relname = 'slots') "
                "OR (src.relname = 'slots' AND dst.relname = 'orders'))"
            )
        )
        return {
            (str(row[0]), str(row[1]), str(row[2]), str(row[3])) for row in rows
        }


def test_booking_migration_downgrades_and_reupgrades_cleanly(
    migration_engine: Engine,
) -> None:
    config = _config(migration_engine)
    command.upgrade(config, "head")

    assert _circular_foreign_keys(migration_engine) == {
        ("fk_orders_slot_id_slots", "orders", "slots", "r"),
        ("fk_slots_locked_by_order_id_orders", "slots", "orders", "r"),
    }

    command.downgrade(config, "0001")
    inspector = inspect(migration_engine)
    assert not {
        "users",
        "user_sessions",
        "orders",
        "idempotency_records",
    } & set(inspector.get_table_names())
    assert "checkout_version" not in {
        column["name"] for column in inspector.get_columns("slots")
    }
    assert _circular_foreign_keys(migration_engine) == set()

    existing_slot_id = "00000000-0000-0000-0000-000000000003"
    with migration_engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO venues "
                "(id, slug, name, description, price_advantage_text, timezone, "
                "business_hours_text, address, parking_text, phone, refund_policy_text, "
                "latitude, longitude, is_primary, is_active) VALUES "
                "('00000000-0000-0000-0000-000000000001', 'migration-venue', "
                "'Migration Venue', '', 'price', 'Asia/Shanghai', 'hours', 'address', "
                "'parking', 'phone', 'refund', 31, 121, false, true)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO pitches (id, venue_id, code, name, pitch_type, sort_order) "
                "VALUES ('00000000-0000-0000-0000-000000000002', "
                "'00000000-0000-0000-0000-000000000001', 'P1', 'Pitch 1', "
                "'FIVE_A_SIDE', 0)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO slots "
                "(id, pitch_id, starts_at, ends_at, status, price_cents, "
                "locked_until, locked_by_order_id) VALUES "
                "(:slot_id, '00000000-0000-0000-0000-000000000002', "
                "'2026-08-01T02:00:00Z', '2026-08-01T03:00:00Z', "
                "'AVAILABLE', 36000, NULL, NULL)"
            ),
            {"slot_id": existing_slot_id},
        )

    command.upgrade(config, "head")
    assert _circular_foreign_keys(migration_engine) == {
        ("fk_orders_slot_id_slots", "orders", "slots", "r"),
        ("fk_slots_locked_by_order_id_orders", "slots", "orders", "r"),
    }
    with migration_engine.connect() as connection:
        checkout_version = connection.execute(
            text("SELECT checkout_version FROM slots WHERE id = :slot_id"),
            {"slot_id": existing_slot_id},
        ).scalar_one()
    assert checkout_version == 1
    order_columns = {
        column["name"]: column for column in inspect(migration_engine).get_columns("orders")
    }
    expired_at_type = order_columns["expired_at"]["type"]
    assert isinstance(expired_at_type, DateTime)
    assert str(expired_at_type) == "TIMESTAMP"
    assert expired_at_type.timezone is True
    assert order_columns["expired_at"]["nullable"] is True
    candidate_index = next(
        item
        for item in inspect(migration_engine).get_indexes("orders")
        if item["name"] == "ix_orders_pending_expiry_candidates"
    )
    assert candidate_index["column_names"] == ["expires_at", "id"]
    predicate = str(candidate_index["dialect_options"]["postgresql_where"]).lower()
    assert "status" in predicate and "pending_payment" in predicate
    assert "wechat_prepay_id is null" in predicate


def test_upgrade_releases_legacy_locked_slots_before_adding_order_fk(
    migration_engine: Engine,
) -> None:
    config = _config(migration_engine)
    command.upgrade(config, "0001")
    available_slot_id = "00000000-0000-0000-0000-000000000013"
    locked_slot_id = "00000000-0000-0000-0000-000000000014"
    with migration_engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO venues "
                "(id, slug, name, description, price_advantage_text, timezone, "
                "business_hours_text, address, parking_text, phone, refund_policy_text, "
                "latitude, longitude, is_primary, is_active) VALUES "
                "('00000000-0000-0000-0000-000000000011', 'legacy-lock-venue', "
                "'Legacy Lock Venue', '', 'price', 'Asia/Shanghai', 'hours', 'address', "
                "'parking', 'phone', 'refund', 31, 121, false, true)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO pitches (id, venue_id, code, name, pitch_type, sort_order) "
                "VALUES ('00000000-0000-0000-0000-000000000012', "
                "'00000000-0000-0000-0000-000000000011', 'P1', 'Pitch 1', "
                "'FIVE_A_SIDE', 0)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO slots "
                "(id, pitch_id, starts_at, ends_at, status, price_cents, "
                "locked_until, locked_by_order_id) VALUES "
                "(:available_id, '00000000-0000-0000-0000-000000000012', "
                "'2026-08-01T01:00:00Z', '2026-08-01T02:00:00Z', "
                "'AVAILABLE', 36000, NULL, NULL), "
                "(:locked_id, '00000000-0000-0000-0000-000000000012', "
                "'2026-08-01T02:00:00Z', '2026-08-01T03:00:00Z', "
                "'LOCKED', 36000, '2026-08-01T02:15:00Z', "
                "'00000000-0000-0000-0000-000000000099')"
            ),
            {"available_id": available_slot_id, "locked_id": locked_slot_id},
        )

    command.upgrade(config, "head")

    with migration_engine.connect() as connection:
        rows = connection.execute(
            text(
                "SELECT id::text, status::text, locked_until, locked_by_order_id, "
                "checkout_version FROM slots WHERE id IN (:available_id, :locked_id) "
                "ORDER BY id"
            ),
            {"available_id": available_slot_id, "locked_id": locked_slot_id},
        )
        migrated = {row[0]: tuple(row[1:]) for row in rows}

    assert migrated[available_slot_id] == ("AVAILABLE", None, None, 1)
    assert migrated[locked_slot_id] == ("AVAILABLE", None, None, 1)
    assert _circular_foreign_keys(migration_engine) == {
        ("fk_orders_slot_id_slots", "orders", "slots", "r"),
        ("fk_slots_locked_by_order_id_orders", "slots", "orders", "r"),
    }
