from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import DateTime, Engine, create_engine, inspect, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from backend.app.models import UserSession
from backend.app.modules.auth.dto import VerifiedPhone, WeChatIdentity
from backend.app.modules.auth.repository import AuthRepository
from backend.app.modules.auth.service import AuthService
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


def _make_legacy_identity_schema_at_0004(
    engine: Engine,
    *,
    with_user: bool,
) -> None:
    config = _config(engine)
    command.upgrade(config, "0004")
    with engine.begin() as connection:
        if with_user:
            connection.execute(
                text(
                    "INSERT INTO users "
                    "(id, wechat_app_id, wechat_openid, created_at) VALUES "
                    "('20000000-0000-0000-0000-000000000001', "
                    "'discarded-by-legacy-shape', 'legacy-openid', now())"
                )
            )
        connection.execute(
            text("ALTER TABLE users DROP CONSTRAINT uq_users_wechat_app_openid")
        )
        connection.execute(text("ALTER TABLE users DROP COLUMN wechat_app_id"))
        connection.execute(
            text(
                "ALTER TABLE users ADD CONSTRAINT uq_users_wechat_openid "
                "UNIQUE (wechat_openid)"
            )
        )


class _MigrationIdentityProvider:
    def __init__(self, app_id: str) -> None:
        self.app_id = app_id

    def exchange(self, _code: str) -> WeChatIdentity:
        return WeChatIdentity(
            openid="legacy-openid",
            unionid=None,
            session_key="migration-session-key",
            app_id=self.app_id,
        )


class _MigrationPhoneProvider:
    def exchange(self, _code: str) -> VerifiedPhone:
        return VerifiedPhone("13812345678")


def _identity_constraints(engine: Engine) -> dict[str | None, list[str]]:
    return {
        item["name"]: item["column_names"]
        for item in inspect(engine).get_unique_constraints("users")
    }


def test_fresh_migration_path_reaches_identity_repair_head(
    migration_engine: Engine,
) -> None:
    command.upgrade(_config(migration_engine), "head")

    with migration_engine.connect() as connection:
        assert connection.execute(
            text("SELECT version_num FROM alembic_version")
        ).scalar_one() == "0009"
    columns = {item["name"] for item in inspect(migration_engine).get_columns("users")}
    assert "wechat_app_id" in columns
    assert _identity_constraints(migration_engine)["uq_users_wechat_app_openid"] == [
        "wechat_app_id",
        "wechat_openid",
    ]


def test_empty_legacy_users_upgrade_without_app_id(
    migration_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _make_legacy_identity_schema_at_0004(migration_engine, with_user=False)
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("WECHAT_APP_ID", raising=False)

    command.upgrade(_config(migration_engine), "head")

    columns = {
        item["name"]: item for item in inspect(migration_engine).get_columns("users")
    }
    assert columns["wechat_app_id"]["nullable"] is False
    assert "uq_users_wechat_openid" not in _identity_constraints(migration_engine)


def test_legacy_user_explicit_app_id_backfills_and_login_reuses_user(
    migration_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _make_legacy_identity_schema_at_0004(migration_engine, with_user=True)
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("WECHAT_APP_ID", "wx-explicit-repair")

    command.upgrade(_config(migration_engine), "head")

    with Session(migration_engine) as session:
        response = AuthService(
            repository=AuthRepository(session),
            identity_provider=_MigrationIdentityProvider("wx-explicit-repair"),
            phone_provider=_MigrationPhoneProvider(),
            phone_vault=None,
            session_ttl=timedelta(days=30),
            now=lambda: datetime(2026, 7, 29, tzinfo=UTC),
        ).create_session("migration-login")
        assert str(response.user.id) == "20000000-0000-0000-0000-000000000001"
        assert session.query(UserSession).count() == 1
        assert session.execute(
            text("SELECT wechat_app_id FROM users WHERE wechat_openid='legacy-openid'")
        ).scalar_one() == "wx-explicit-repair"


@pytest.mark.parametrize("app_env", ["development", "test"])
def test_legacy_user_development_environments_use_development_app_id(
    migration_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
    app_env: str,
) -> None:
    _make_legacy_identity_schema_at_0004(migration_engine, with_user=True)
    monkeypatch.setenv("APP_ENV", app_env)
    monkeypatch.delenv("WECHAT_APP_ID", raising=False)

    command.upgrade(_config(migration_engine), "head")

    with migration_engine.connect() as connection:
        assert connection.execute(
            text("SELECT wechat_app_id FROM users WHERE wechat_openid='legacy-openid'")
        ).scalar_one() == "development"


@pytest.mark.parametrize("app_env", ["staging", "production"])
def test_legacy_user_deployed_upgrade_without_app_id_fails_atomically(
    migration_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
    app_env: str,
) -> None:
    _make_legacy_identity_schema_at_0004(migration_engine, with_user=True)
    monkeypatch.setenv("APP_ENV", app_env)
    monkeypatch.delenv("WECHAT_APP_ID", raising=False)

    with pytest.raises(RuntimeError, match="application identity") as captured:
        command.upgrade(_config(migration_engine), "head")
    assert app_env not in str(captured.value)

    with migration_engine.connect() as connection:
        assert connection.execute(
            text("SELECT version_num FROM alembic_version")
        ).scalar_one() == "0004"
    columns = {item["name"] for item in inspect(migration_engine).get_columns("users")}
    assert "wechat_app_id" not in columns
    assert _identity_constraints(migration_engine)["uq_users_wechat_openid"] == [
        "wechat_openid"
    ]


def test_corrective_identity_downgrade_preserves_0004_identity_contract(
    migration_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _make_legacy_identity_schema_at_0004(migration_engine, with_user=True)
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.delenv("WECHAT_APP_ID", raising=False)
    config = _config(migration_engine)
    command.upgrade(config, "0005")

    command.downgrade(config, "0004")

    columns = {item["name"] for item in inspect(migration_engine).get_columns("users")}
    assert "wechat_app_id" in columns
    assert _identity_constraints(migration_engine)["uq_users_wechat_app_openid"] == [
        "wechat_app_id",
        "wechat_openid",
    ]


def test_booking_migration_downgrades_and_reupgrades_cleanly(
    migration_engine: Engine,
) -> None:
    config = _config(migration_engine)
    command.upgrade(config, "0005")

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
        "payments",
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

    command.upgrade(config, "0005")
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
    assert "wechat_prepay_id" not in predicate
    payment_columns = {
        column["name"]: column
        for column in inspect(migration_engine).get_columns("payments")
    }
    assert payment_columns["authority_unknown_since"]["nullable"] is True
    assert payment_columns["paid_at"]["nullable"] is True
    assert "paid_at" not in {
        column["name"] for column in inspect(migration_engine).get_columns("orders")
    }


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

    command.upgrade(config, "0005")

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


def _insert_legacy_booking_rows(engine: Engine) -> None:
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO venues "
                "(id, slug, name, description, price_advantage_text, timezone, "
                "business_hours_text, address, parking_text, phone, refund_policy_text, "
                "latitude, longitude, is_primary, is_active) VALUES "
                "('10000000-0000-0000-0000-000000000001', 'data-venue', "
                "'Data Venue', '', 'price', 'Asia/Shanghai', 'hours', 'address', "
                "'parking', 'phone', 'refund', 31, 121, false, true)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO pitches (id, venue_id, code, name, pitch_type, sort_order) "
                "VALUES ('10000000-0000-0000-0000-000000000002', "
                "'10000000-0000-0000-0000-000000000001', 'P1', 'Pitch 1', "
                "'FIVE_A_SIDE', 0)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO slots "
                "(id, pitch_id, starts_at, ends_at, status, price_cents, locked_until, "
                "locked_by_order_id, checkout_version) VALUES "
                "('10000000-0000-0000-0000-000000000003', "
                "'10000000-0000-0000-0000-000000000002', "
                "'2026-08-01T02:00:00Z', '2026-08-01T03:00:00Z', "
                "'AVAILABLE', 36000, NULL, NULL, 1)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO users "
                "(id, wechat_app_id, wechat_openid, created_at) VALUES "
                "('10000000-0000-0000-0000-000000000004', 'wx-app', "
                "'migration-user', '2026-08-01T00:00:00Z')"
            )
        )


def test_upgrade_preserves_existing_booking_and_idempotency_enum_rows(
    migration_engine: Engine,
) -> None:
    config = _config(migration_engine)
    command.upgrade(config, "0002")
    _insert_legacy_booking_rows(migration_engine)
    with migration_engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO orders "
                "(id, order_number, user_id, slot_id, status, price_cents, contact_name, "
                "contact_phone_ciphertext, contact_phone_nonce, contact_phone_key_version, "
                "created_at, expires_at, expired_at) VALUES "
                "('10000000-0000-0000-0000-000000000010', 'PB-PENDING', "
                "'10000000-0000-0000-0000-000000000004', "
                "'10000000-0000-0000-0000-000000000003', 'PENDING_PAYMENT', 36000, "
                "'张三', decode('00112233445566778899aabbccddeeff', 'hex'), "
                "decode('00112233445566778899aabb', 'hex'), 1, "
                "'2026-08-01T00:00:00Z', '2026-08-01T01:00:00Z', NULL), "
                "('10000000-0000-0000-0000-000000000011', 'PB-EXPIRED', "
                "'10000000-0000-0000-0000-000000000004', "
                "'10000000-0000-0000-0000-000000000003', 'EXPIRED', 36000, "
                "'李四', decode('00112233445566778899aabbccddeeff', 'hex'), "
                "decode('00112233445566778899aabb', 'hex'), 1, "
                "'2026-08-01T00:00:00Z', '2026-08-01T01:00:00Z', "
                "'2026-08-01T01:00:00Z')"
            )
        )
        connection.execute(
            text(
                "INSERT INTO idempotency_records "
                "(id, user_id, operation, key, request_sha256, state, response_status, "
                "response_body) VALUES "
                "('10000000-0000-0000-0000-000000000020', "
                "'10000000-0000-0000-0000-000000000004', 'CREATE_ORDER', "
                "'claimed-key', :claimed_digest, 'CLAIMED', NULL, NULL), "
                "('10000000-0000-0000-0000-000000000021', "
                "'10000000-0000-0000-0000-000000000004', 'CREATE_ORDER', "
                "'completed-key', :completed_digest, 'COMPLETED', 201, "
                "'{\"order_id\":\"legacy\"}'::jsonb)"
            ),
            {"claimed_digest": "a" * 64, "completed_digest": "b" * 64},
        )

    command.upgrade(config, "0003")

    with migration_engine.connect() as connection:
        order_states = connection.execute(
            text("SELECT status::text FROM orders ORDER BY order_number")
        ).scalars().all()
        idempotency_states = connection.execute(
            text("SELECT state::text FROM idempotency_records ORDER BY key")
        ).scalars().all()

    assert order_states == ["EXPIRED", "PENDING_PAYMENT"]
    assert idempotency_states == ["CLAIMED", "COMPLETED"]


def test_downgrade_with_new_enum_rows_fails_atomically(
    migration_engine: Engine,
) -> None:
    config = _config(migration_engine)
    command.upgrade(config, "0003")
    _insert_legacy_booking_rows(migration_engine)
    with migration_engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO orders "
                "(id, order_number, user_id, slot_id, status, price_cents, contact_name, "
                "contact_phone_ciphertext, contact_phone_nonce, contact_phone_key_version, "
                "created_at, expires_at, expired_at) VALUES "
                "('10000000-0000-0000-0000-000000000030', 'PB-CONFIRMED', "
                "'10000000-0000-0000-0000-000000000004', "
                "'10000000-0000-0000-0000-000000000003', 'CONFIRMED', 36000, "
                "'张三', decode('00112233445566778899aabbccddeeff', 'hex'), "
                "decode('00112233445566778899aabb', 'hex'), 1, "
                "'2026-08-01T00:00:00Z', '2026-08-01T01:00:00Z', NULL), "
                "('10000000-0000-0000-0000-000000000031', 'PB-EXCEPTION', "
                "'10000000-0000-0000-0000-000000000004', "
                "'10000000-0000-0000-0000-000000000003', 'PAYMENT_EXCEPTION', 36000, "
                "'李四', decode('00112233445566778899aabbccddeeff', 'hex'), "
                "decode('00112233445566778899aabb', 'hex'), 1, "
                "'2026-08-01T00:00:00Z', '2026-08-01T01:00:00Z', NULL)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO payments "
                "(id, order_id, provider, merchant_order_no, amount_cents, currency, "
                "status, reconcile_attempts) VALUES "
                "('10000000-0000-0000-0000-000000000040', "
                "'10000000-0000-0000-0000-000000000030', 'WECHAT_PAY', "
                "'migration-payment', 36000, 'CNY', 'CLOSED', 0)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO idempotency_records "
                "(id, user_id, operation, key, request_sha256, state, payment_id) VALUES "
                "('10000000-0000-0000-0000-000000000041', "
                "'10000000-0000-0000-0000-000000000004', 'CREATE_PAYMENT', "
                "'processing-key', :digest, 'PROCESSING', "
                "'10000000-0000-0000-0000-000000000040')"
            ),
            {"digest": "c" * 64},
        )

    with pytest.raises(DBAPIError):
        command.downgrade(config, "0002")

    with migration_engine.connect() as connection:
        revision = connection.execute(
            text("SELECT version_num FROM alembic_version")
        ).scalar_one()
        assert revision == "0003"
        assert connection.execute(
            text("SELECT count(*) FROM payments")
        ).scalar_one() == 1
        assert connection.execute(
            text("SELECT state::text FROM idempotency_records WHERE key = 'processing-key'")
        ).scalar_one() == "PROCESSING"
        assert connection.execute(
            text(
                "SELECT array_agg(status::text ORDER BY order_number) FROM orders"
            )
        ).scalar_one() == ["CONFIRMED", "PAYMENT_EXCEPTION"]


def test_payment_recovery_scheduling_migration_backfills_and_downgrades(
    migration_engine: Engine,
) -> None:
    config = _config(migration_engine)
    command.upgrade(config, "0003")
    _insert_legacy_booking_rows(migration_engine)
    with migration_engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO orders "
                "(id, order_number, user_id, slot_id, status, price_cents, contact_name, "
                "contact_phone_ciphertext, contact_phone_nonce, contact_phone_key_version, "
                "created_at, expires_at, expired_at) VALUES "
                "('10000000-0000-0000-0000-000000000010', 'PB-RECOVERY', "
                "'10000000-0000-0000-0000-000000000004', "
                "'10000000-0000-0000-0000-000000000003', 'PENDING_PAYMENT', 36000, "
                "'张三', decode('00112233445566778899aabbccddeeff', 'hex'), "
                "decode('00112233445566778899aabb', 'hex'), 1, "
                "'2026-08-01T00:00:00Z', '2026-08-01T01:00:00Z', NULL)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO payments "
                "(id, order_id, provider, merchant_order_no, amount_cents, currency, "
                "status, reconcile_attempts, next_reconcile_at) VALUES "
                "('10000000-0000-0000-0000-000000000042', "
                "'10000000-0000-0000-0000-000000000010', 'WECHAT_PAY', "
                "'migration-recovery', 36000, 'CNY', 'UNKNOWN', 3, "
                "'2026-08-01T00:05:00Z')"
            )
        )

    command.upgrade(config, "0005")

    with migration_engine.connect() as connection:
        row = connection.execute(
            text(
                "SELECT reconcile_claim_token, reconcile_lease_until, "
                "expiry_reconciled_at, creation_recovery_pending "
                "FROM payments WHERE merchant_order_no = 'migration-recovery'"
            )
        ).one()
        assert tuple(row) == (None, None, None, False)
        assert connection.execute(
            text("SELECT version_num FROM alembic_version")
        ).scalar_one() == "0005"

    command.downgrade(config, "0003")

    with migration_engine.connect() as connection:
        columns = {
            row[0]
            for row in connection.execute(
                text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_name = 'payments'"
                )
            )
        }
        assert {
            "reconcile_claim_token",
            "reconcile_lease_until",
            "expiry_reconciled_at",
            "creation_recovery_pending",
        }.isdisjoint(columns)
