from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, create_engine, inspect, text
from sqlalchemy.exc import DBAPIError, IntegrityError

from backend.tests.postgres_test_database import (
    disposable_database,
    override_test_database_url,
)

pytestmark = pytest.mark.integration

_USER_ID = "10000000-0000-0000-0000-000000000004"
_SLOT_ID = "10000000-0000-0000-0000-000000000003"
_ORDER_ID = "10000000-0000-0000-0000-000000000010"
_PAYMENT_ID = "10000000-0000-0000-0000-000000000020"
_PAID_AT = datetime(2026, 8, 1, 0, 5, tzinfo=UTC)


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


def _seed_booking_at_0002(engine: Engine) -> None:
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO venues "
                "(id, slug, name, description, price_advantage_text, timezone, "
                "business_hours_text, address, parking_text, phone, refund_policy_text, "
                "latitude, longitude, is_primary, is_active) VALUES "
                "('7e68d7d8-4b7e-4f04-a5c5-3fe263e69c6f', "
                "'test-xingyue-football-park', "
                "'Lifecycle Venue', '', 'price', 'Asia/Shanghai', 'hours', 'address', "
                "'parking', 'phone', 'refund', 31, 121, false, true)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO pitches (id, venue_id, code, name, pitch_type, sort_order) "
                "VALUES ('10000000-0000-0000-0000-000000000002', "
                "'7e68d7d8-4b7e-4f04-a5c5-3fe263e69c6f', 'P1', 'Pitch 1', "
                "'FIVE_A_SIDE', 0)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO slots "
                "(id, pitch_id, starts_at, ends_at, status, price_cents, "
                "locked_until, locked_by_order_id, checkout_version) VALUES "
                "(:slot_id, '10000000-0000-0000-0000-000000000002', "
                "'2026-08-02T02:00:00Z', '2026-08-02T03:00:00Z', "
                "'AVAILABLE', 36000, NULL, NULL, 1)"
            ),
            {"slot_id": _SLOT_ID},
        )
        connection.execute(
            text(
                "INSERT INTO users "
                "(id, wechat_app_id, wechat_openid, created_at) VALUES "
                "(:user_id, 'wx-app', 'lifecycle-user', '2026-08-01T00:00:00Z')"
            ),
            {"user_id": _USER_ID},
        )
        connection.execute(
            text(
                "INSERT INTO orders "
                "(id, order_number, user_id, slot_id, status, price_cents, contact_name, "
                "contact_phone_ciphertext, contact_phone_nonce, contact_phone_key_version, "
                "created_at, expires_at, expired_at) VALUES "
                "(:order_id, 'PB-LIFECYCLE', :user_id, :slot_id, 'PENDING_PAYMENT', "
                "36000, '张三', decode('00112233445566778899aabbccddeeff', 'hex'), "
                "decode('00112233445566778899aabb', 'hex'), 1, "
                "'2026-08-01T00:00:00Z', '2026-08-01T01:00:00Z', NULL)"
            ),
            {"order_id": _ORDER_ID, "user_id": _USER_ID, "slot_id": _SLOT_ID},
        )


def _prepare_0012(
    engine: Engine,
    *,
    order_status: str = "PENDING_PAYMENT",
    successful_payments: int = 0,
) -> Config:
    config = _config(engine)
    command.upgrade(config, "0002")
    _seed_booking_at_0002(engine)
    command.upgrade(config, "0012")
    with engine.begin() as connection:
        connection.execute(
            text("UPDATE orders SET status = CAST(:status AS order_status) WHERE id = :id"),
            {"status": order_status, "id": _ORDER_ID},
        )
        for offset in range(successful_payments):
            _insert_payment(
                connection,
                payment_id=f"10000000-0000-0000-0000-{32 + offset:012d}",
                merchant_order_no=f"PB-MIGRATION-{offset}",
                transaction_no=f"tx-migration-{offset}",
                status="SUCCESS",
                paid_at=_PAID_AT + timedelta(seconds=offset),
            )
    return config


def _insert_payment(
    connection: Any,
    *,
    payment_id: str = _PAYMENT_ID,
    order_id: str = _ORDER_ID,
    merchant_order_no: str = "PB-MIGRATION",
    transaction_no: str | None = "tx-migration",
    status: str = "SUCCESS",
    paid_at: datetime | None = _PAID_AT,
    amount_cents: int = 36000,
    currency: str = "CNY",
) -> None:
    connection.execute(
        text(
            "INSERT INTO payments "
            "(id, order_id, provider, merchant_order_no, provider_transaction_no, "
            "amount_cents, currency, status, paid_at, reconcile_attempts) VALUES "
            "(:id, :order_id, 'WECHAT_PAY', :merchant_order_no, :transaction_no, "
            ":amount_cents, :currency, CAST(:status AS payment_state), :paid_at, 0)"
        ),
        {
            "id": payment_id,
            "order_id": order_id,
            "merchant_order_no": merchant_order_no,
            "transaction_no": transaction_no,
            "amount_cents": amount_cents,
            "currency": currency,
            "status": status,
            "paid_at": paid_at,
        },
    )


def _constraint_name(error: IntegrityError | DBAPIError) -> str | None:
    diagnostic = getattr(error.orig, "diag", None)
    return getattr(diagnostic, "constraint_name", None)


def test_0013_upgrade_preserves_rows_and_backfills_exact_confirmed_payment(
    migration_engine: Engine,
) -> None:
    config = _prepare_0012(
        migration_engine,
        order_status="CONFIRMED",
        successful_payments=1,
    )

    command.upgrade(config, "0013")

    with migration_engine.connect() as connection:
        assert connection.execute(
            text("SELECT version_num FROM alembic_version")
        ).scalar_one() == "0013"
        assert connection.execute(text("SELECT count(*) FROM orders")).scalar_one() == 1
        payment = connection.execute(
            text("SELECT status::text, paid_at, applied_to_order_at FROM payments")
        ).one()
        assert tuple(payment) == ("SUCCESS", _PAID_AT, _PAID_AT)
        order_labels = set(
            connection.execute(
                text(
                    "SELECT enumlabel FROM pg_enum "
                    "JOIN pg_type ON pg_type.oid = pg_enum.enumtypid "
                    "WHERE typname = 'order_status'"
                )
            ).scalars()
        )
    assert {
        "CANCELLED",
        "REFUND_PENDING",
        "REFUND_FAILED",
        "REFUNDED",
        "COMPLETED",
    } <= order_labels
    assert {"refund_cases", "refund_attempts"} <= set(
        inspect(migration_engine).get_table_names()
    )


@pytest.mark.parametrize("successful_payments", [0, 2])
def test_0013_upgrade_refuses_ambiguous_confirmed_payment_backfill(
    migration_engine: Engine,
    successful_payments: int,
) -> None:
    config = _prepare_0012(
        migration_engine,
        order_status="CONFIRMED",
        successful_payments=successful_payments,
    )

    with pytest.raises(DBAPIError, match="confirmed order"):
        command.upgrade(config, "0013")

    with migration_engine.connect() as connection:
        assert connection.execute(
            text("SELECT version_num FROM alembic_version")
        ).scalar_one() == "0012"
    assert "applied_to_order_at" not in {
        column["name"] for column in inspect(migration_engine).get_columns("payments")
    }


def test_order_lifecycle_timestamp_and_operator_matrix_is_enforced(
    migration_engine: Engine,
) -> None:
    config = _prepare_0012(migration_engine)
    command.upgrade(config, "0013")
    requested_at = datetime(2026, 8, 1, 0, 10, tzinfo=UTC)
    with migration_engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE orders SET status = 'CONFIRMED', cancel_requested_at = :at "
                "WHERE id = :id"
            ),
            {"at": requested_at, "id": _ORDER_ID},
        )

    invalid_updates = (
        "UPDATE orders SET checked_in_at = now() WHERE id = :id",
        "UPDATE orders SET checked_in_by_user_id = :user_id WHERE id = :id",
        "UPDATE orders SET completed_at = now(), completed_by_user_id = :user_id "
        "WHERE id = :id",
        "UPDATE orders SET status = 'CANCELLED' WHERE id = :id",
    )
    for statement in invalid_updates:
        with pytest.raises(IntegrityError):
            with migration_engine.begin() as connection:
                connection.execute(
                    text(statement),
                    {"id": _ORDER_ID, "user_id": _USER_ID},
                )

    with migration_engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE orders SET checked_in_at = :at, checked_in_by_user_id = :user_id "
                "WHERE id = :id"
            ),
            {"at": requested_at, "user_id": _USER_ID, "id": _ORDER_ID},
        )
        connection.execute(
            text(
                "UPDATE orders SET status = 'COMPLETED', completed_at = :at, "
                "completed_by_user_id = :user_id WHERE id = :id"
            ),
            {"at": requested_at, "user_id": _USER_ID, "id": _ORDER_ID},
        )


def test_applied_payment_is_unique_per_order_and_immutable(
    migration_engine: Engine,
) -> None:
    config = _prepare_0012(
        migration_engine,
        order_status="CONFIRMED",
        successful_payments=1,
    )
    command.upgrade(config, "0013")
    second_id = "10000000-0000-0000-0000-000000000099"
    with migration_engine.begin() as connection:
        _insert_payment(
            connection,
            payment_id=second_id,
            merchant_order_no="PB-SECOND",
            transaction_no="tx-second",
        )

    with pytest.raises(IntegrityError) as duplicate:
        with migration_engine.begin() as connection:
            connection.execute(
                text("UPDATE payments SET applied_to_order_at = paid_at WHERE id = :id"),
                {"id": second_id},
            )
    assert _constraint_name(duplicate.value) == "uq_payments_one_applied_per_order"

    with pytest.raises(DBAPIError) as immutable:
        with migration_engine.begin() as connection:
            connection.execute(
                text(
                    "UPDATE payments SET applied_to_order_at = applied_to_order_at + "
                    "interval '1 second' WHERE applied_to_order_at IS NOT NULL"
                )
            )
    assert _constraint_name(immutable.value) == "ck_payments_applied_to_order_immutable"


def _insert_refund_case(
    connection: Any,
    *,
    case_id: str,
    payment_id: str,
    order_id: str = _ORDER_ID,
    purpose: str = "ORDER_CANCELLATION",
    reason: str = "USER_CANCELLED",
    reason_note: str | None = None,
    amount_cents: int = 36000,
    currency: str = "CNY",
) -> None:
    connection.execute(
        text(
            "INSERT INTO refund_cases "
            "(id, order_id, payment_id, purpose, reason, reason_note, "
            "requested_by_user_id, amount_cents, currency) VALUES "
            "(:id, :order_id, :payment_id, CAST(:purpose AS refund_case_purpose), "
            "CAST(:reason AS refund_reason), :reason_note, NULL, :amount_cents, :currency)"
        ),
        {
            "id": case_id,
            "order_id": order_id,
            "payment_id": payment_id,
            "purpose": purpose,
            "reason": reason,
            "reason_note": reason_note,
            "amount_cents": amount_cents,
            "currency": currency,
        },
    )


def test_refund_case_uses_payment_authority_and_is_not_unique_by_order(
    migration_engine: Engine,
) -> None:
    config = _prepare_0012(
        migration_engine,
        order_status="CONFIRMED",
        successful_payments=1,
    )
    command.upgrade(config, "0013")
    with migration_engine.connect() as connection:
        first_payment_id = str(
            connection.execute(
                text("SELECT id FROM payments WHERE applied_to_order_at IS NOT NULL")
            ).scalar_one()
        )
    second_payment_id = "10000000-0000-0000-0000-000000000099"
    with migration_engine.begin() as connection:
        _insert_payment(
            connection,
            payment_id=second_payment_id,
            merchant_order_no="PB-SECOND",
            transaction_no="tx-second",
        )
        _insert_refund_case(
            connection,
            case_id="20000000-0000-0000-0000-000000000001",
            payment_id=first_payment_id,
        )
        _insert_refund_case(
            connection,
            case_id="20000000-0000-0000-0000-000000000002",
            payment_id=second_payment_id,
            purpose="DUPLICATE_CHARGE",
            reason="AUTOMATIC_RECOVERY",
        )

    with pytest.raises(IntegrityError):
        with migration_engine.begin() as connection:
            _insert_refund_case(
                connection,
                case_id="20000000-0000-0000-0000-000000000003",
                payment_id=first_payment_id,
            )

    for changes in (
        {"amount_cents": 1},
        {"currency": "USD"},
        {"order_id": "20000000-0000-0000-0000-000000000099"},
    ):
        with pytest.raises(DBAPIError) as mismatch:
            with migration_engine.begin() as connection:
                _insert_refund_case(
                    connection,
                    case_id="20000000-0000-0000-0000-000000000010",
                    payment_id=second_payment_id,
                    purpose="DUPLICATE_CHARGE",
                    reason="AUTOMATIC_RECOVERY",
                    **changes,
                )
        assert _constraint_name(mismatch.value) == "ck_refund_cases_payment_authority"


@pytest.mark.parametrize(
    ("reason", "reason_note"),
    [
        ("VENUE_CANCELLED", None),
        ("VENUE_CANCELLED", "   "),
        ("VENUE_CANCELLED", "x" * 501),
        ("USER_CANCELLED", "not allowed"),
        ("AUTOMATIC_RECOVERY", "not allowed"),
    ],
)
def test_refund_reason_note_is_closed_and_trimmed(
    migration_engine: Engine,
    reason: str,
    reason_note: str | None,
) -> None:
    config = _prepare_0012(
        migration_engine,
        order_status="CONFIRMED",
        successful_payments=1,
    )
    command.upgrade(config, "0013")
    with migration_engine.connect() as connection:
        payment_id = str(connection.execute(text("SELECT id FROM payments")).scalar_one())

    with pytest.raises(IntegrityError) as invalid:
        with migration_engine.begin() as connection:
            _insert_refund_case(
                connection,
                case_id="20000000-0000-0000-0000-000000000020",
                payment_id=payment_id,
                reason=reason,
                reason_note=reason_note,
            )
    assert _constraint_name(invalid.value) == "ck_refund_cases_reason_note"


def test_refund_attempt_allows_only_one_active_attempt_and_unique_sequence(
    migration_engine: Engine,
) -> None:
    config = _prepare_0012(
        migration_engine,
        order_status="CONFIRMED",
        successful_payments=1,
    )
    command.upgrade(config, "0013")
    case_id = "20000000-0000-0000-0000-000000000030"
    with migration_engine.begin() as connection:
        payment_id = str(connection.execute(text("SELECT id FROM payments")).scalar_one())
        _insert_refund_case(connection, case_id=case_id, payment_id=payment_id)
        connection.execute(
            text(
                "INSERT INTO refund_attempts "
                "(id, refund_case_id, provider, merchant_refund_no, status, attempt_no) "
                "VALUES ('30000000-0000-0000-0000-000000000001', :case_id, "
                "'WECHAT_PAY', 'RF-1', 'UNKNOWN', 1)"
            ),
            {"case_id": case_id},
        )
        connection.execute(
            text(
                "INSERT INTO refund_attempts "
                "(id, refund_case_id, provider, merchant_refund_no, status, attempt_no, "
                "failure_code) VALUES "
                "('30000000-0000-0000-0000-000000000002', :case_id, "
                "'WECHAT_PAY', 'RF-2', 'FAILED', 2, 'PROVIDER_FAILED')"
            ),
            {"case_id": case_id},
        )

    with pytest.raises(IntegrityError) as active:
        with migration_engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO refund_attempts "
                    "(id, refund_case_id, provider, merchant_refund_no, status, attempt_no) "
                    "VALUES ('30000000-0000-0000-0000-000000000003', :case_id, "
                    "'WECHAT_PAY', 'RF-3', 'PROCESSING', 3)"
                ),
                {"case_id": case_id},
            )
    assert _constraint_name(active.value) == "uq_refund_attempts_one_active_per_case"

    with pytest.raises(IntegrityError) as sequence:
        with migration_engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO refund_attempts "
                    "(id, refund_case_id, provider, merchant_refund_no, status, attempt_no, "
                    "failure_code) VALUES "
                    "('30000000-0000-0000-0000-000000000004', :case_id, "
                    "'WECHAT_PAY', 'RF-4', 'FAILED', 2, 'PROVIDER_FAILED')"
                ),
                {"case_id": case_id},
            )
    assert _constraint_name(sequence.value) == "uq_refund_attempts_case_attempt_no"


def test_0013_downgrades_clean_data_but_refuses_new_order_states(
    migration_engine: Engine,
) -> None:
    config = _prepare_0012(migration_engine)
    command.upgrade(config, "0013")
    command.downgrade(config, "0012")
    assert {"refund_cases", "refund_attempts"}.isdisjoint(
        inspect(migration_engine).get_table_names()
    )
    assert "applied_to_order_at" not in {
        column["name"] for column in inspect(migration_engine).get_columns("payments")
    }

    command.upgrade(config, "0013")
    with migration_engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE orders SET status = 'CANCELLED', cancel_requested_at = now(), "
                "cancelled_at = now() WHERE id = :id"
            ),
            {"id": _ORDER_ID},
        )

    with pytest.raises(DBAPIError):
        command.downgrade(config, "0012")
    with migration_engine.connect() as connection:
        assert connection.execute(
            text("SELECT version_num FROM alembic_version")
        ).scalar_one() == "0013"
        assert connection.execute(
            text("SELECT status::text FROM orders WHERE id = :id"),
            {"id": _ORDER_ID},
        ).scalar_one() == "CANCELLED"
