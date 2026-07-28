import time as time_module
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, time, timedelta
from queue import Queue
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import DateTime, Engine, inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.app.models import (
    IdempotencyRecord,
    Order,
    OrderStatus,
    Payment,
    PaymentState,
    Slot,
    SlotStatus,
    User,
)
from backend.tests.test_schema_constraints import add_pitch, add_slot, venue

pytestmark = pytest.mark.integration


def _user() -> User:
    return User(
        wechat_app_id="wx-test-app",
        wechat_openid=f"openid-{uuid.uuid4()}",
        phone_ciphertext=b"encrypted-phone-and-tag",
        phone_nonce=b"0123456789ab",
        phone_key_version=1,
        phone_verified_at=datetime.now(UTC),
        last_contact_name="张三",
    )


def _order(session: Session) -> tuple[Slot, Order]:
    pitch = add_pitch(session, venue())
    shanghai = ZoneInfo("Asia/Shanghai")
    tomorrow = datetime.now(shanghai).date() + timedelta(days=1)
    starts_at = datetime.combine(tomorrow, time(10), shanghai).astimezone(UTC)
    slot = add_slot(session, pitch, starts_at, starts_at + timedelta(hours=1))
    user = _user()
    order = Order(
        order_number=f"PB-{uuid.uuid4().hex}",
        user=user,
        slot=slot,
        status="PENDING_PAYMENT",
        price_cents=36000,
        contact_name="张三",
        contact_phone_ciphertext=b"encrypted-snapshot-and-tag",
        contact_phone_nonce=b"abcdefghijkl",
        contact_phone_key_version=1,
        expires_at=starts_at - timedelta(minutes=10),
        wechat_prepay_id=None,
    )
    session.add(order)
    session.flush()
    return slot, order


def _payment(order: Order, **overrides: object) -> Payment:
    values: dict[str, object] = {
        "order": order,
        "provider": "WECHAT_PAY",
        "merchant_order_no": f"merchant-{uuid.uuid4().hex}",
        "amount_cents": order.price_cents,
        "currency": "CNY",
        "status": PaymentState.CREATING,
        "reconcile_attempts": 0,
    }
    values.update(overrides)
    return Payment(**values)


def test_booking_tables_and_slot_version_exist(pg_engine: Engine) -> None:
    inspector = inspect(pg_engine)

    assert set(inspector.get_table_names()) >= {
        "users",
        "user_sessions",
        "orders",
        "idempotency_records",
    }
    slot_columns = {column["name"]: column for column in inspector.get_columns("slots")}
    assert slot_columns["checkout_version"]["nullable"] is False
    assert str(slot_columns["checkout_version"]["type"]) == "BIGINT"
    assert slot_columns["checkout_version"]["default"] == "1"
    user_columns = {column["name"]: column for column in inspector.get_columns("users")}
    assert user_columns["wechat_app_id"]["nullable"] is False
    assert str(user_columns["wechat_app_id"]["type"]) == "VARCHAR(128)"
    order_columns = {column["name"]: column for column in inspector.get_columns("orders")}
    expired_at_type = order_columns["expired_at"]["type"]
    assert isinstance(expired_at_type, DateTime)
    assert str(expired_at_type) == "TIMESTAMP"
    assert expired_at_type.timezone is True
    assert order_columns["expired_at"]["nullable"] is True


def test_booking_and_payment_enum_labels_are_stable(pg_engine: Engine) -> None:
    with pg_engine.connect() as connection:
        rows = connection.execute(
            text(
                "SELECT t.typname, e.enumlabel "
                "FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid "
                "WHERE t.typname IN ('order_status', 'idempotency_state', 'payment_state') "
                "ORDER BY t.typname, e.enumsortorder"
            )
        )
        labels: dict[str, list[str]] = {}
        for enum_name, label in rows:
            labels.setdefault(enum_name, []).append(label)

    assert labels == {
        "idempotency_state": ["CLAIMED", "PROCESSING", "COMPLETED"],
        "order_status": [
            "PENDING_PAYMENT",
            "CONFIRMED",
            "EXPIRED",
            "PAYMENT_EXCEPTION",
        ],
        "payment_state": [
            "CREATING",
            "PREPAY_CREATED",
            "CONFIRMING",
            "SUCCESS",
            "CLOSED",
            "UNKNOWN",
        ],
    }


def test_circular_foreign_keys_and_restrict_actions_exist(pg_engine: Engine) -> None:
    with pg_engine.connect() as connection:
        rows = set(
            connection.execute(
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
        )

    assert rows == {
        ("fk_orders_slot_id_slots", "orders", "slots", "r"),
        ("fk_slots_locked_by_order_id_orders", "slots", "orders", "r"),
    }


def test_named_constraints_and_foreign_key_indexes_exist(pg_engine: Engine) -> None:
    inspector = inspect(pg_engine)

    assert {item["name"] for item in inspector.get_check_constraints("idempotency_records")} >= {
        "ck_idempotency_records_state_response",
        "ck_idempotency_records_request_sha256",
    }
    assert {
        item["name"] for item in inspector.get_unique_constraints("idempotency_records")
    } >= {"uq_idempotency_records_user_operation_key"}
    assert {item["name"] for item in inspector.get_indexes("orders")} >= {
        "ix_orders_user_id",
        "ix_orders_slot_id",
        "ix_orders_pending_expiry_candidates",
    }
    candidate_index = next(
        item
        for item in inspector.get_indexes("orders")
        if item["name"] == "ix_orders_pending_expiry_candidates"
    )
    assert candidate_index["column_names"] == ["expires_at", "id"]
    predicate = str(candidate_index["dialect_options"]["postgresql_where"]).lower()
    assert "status" in predicate and "pending_payment" in predicate
    assert "wechat_prepay_id" not in predicate
    assert {item["name"] for item in inspector.get_indexes("user_sessions")} >= {
        "ix_user_sessions_user_id"
    }
    assert {item["name"] for item in inspector.get_indexes("idempotency_records")} >= {
        "ix_idempotency_records_user_id",
        "ix_idempotency_records_payment_id",
    }
    assert {item["name"] for item in inspector.get_indexes("payments")} >= {
        "ix_payments_order_id",
        "ix_payments_reconciliation_due",
        "uq_payments_one_nonterminal_per_order",
    }
    assert {item["name"] for item in inspector.get_indexes("slots")} >= {
        "ix_slots_locked_by_order_id"
    }


def test_booking_foreign_key_catalog_is_complete(pg_engine: Engine) -> None:
    inspector = inspect(pg_engine)

    def foreign_keys(
        table: str,
    ) -> dict[str | None, tuple[tuple[str, ...], str, str | None]]:
        return {
            item["name"]: (
                tuple(item["constrained_columns"]),
                item["referred_table"],
                item["options"].get("ondelete"),
            )
            for item in inspector.get_foreign_keys(table)
        }

    assert foreign_keys("user_sessions") == {
        "fk_user_sessions_user_id_users": (("user_id",), "users", "CASCADE")
    }
    assert foreign_keys("orders") == {
        "fk_orders_slot_id_slots": (("slot_id",), "slots", "RESTRICT"),
        "fk_orders_user_id_users": (("user_id",), "users", "RESTRICT"),
    }
    assert foreign_keys("idempotency_records") == {
        "fk_idempotency_records_user_id_users": (
            ("user_id",),
            "users",
            "CASCADE",
        ),
        "fk_idempotency_records_payment_id_payments": (
            ("payment_id",),
            "payments",
            "RESTRICT",
        ),
    }
    assert foreign_keys("payments") == {
        "fk_payments_order_id_orders": (("order_id",), "orders", "RESTRICT")
    }
    assert foreign_keys("slots")["fk_slots_locked_by_order_id_orders"] == (
        ("locked_by_order_id",),
        "orders",
        "RESTRICT",
    )


def test_booking_check_and_unique_constraint_catalog_is_complete(pg_engine: Engine) -> None:
    inspector = inspect(pg_engine)

    assert {item["name"] for item in inspector.get_check_constraints("users")} >= {
        "ck_users_phone_encrypted_fields",
        "ck_users_phone_key_version",
        "ck_users_phone_nonce_length",
        "ck_users_phone_ciphertext_length",
    }
    assert {item["name"] for item in inspector.get_check_constraints("user_sessions")} >= {
        "ck_user_sessions_expiry",
        "ck_user_sessions_token_hash",
    }
    assert {item["name"] for item in inspector.get_check_constraints("orders")} >= {
        "ck_orders_contact_name",
        "ck_orders_contact_phone_encrypted_fields",
        "ck_orders_contact_phone_nonce_length",
        "ck_orders_contact_phone_ciphertext_length",
        "ck_orders_expiry",
        "ck_orders_status_expired_at",
        "ck_orders_price_cents",
    }
    assert {
        item["name"] for item in inspector.get_check_constraints("idempotency_records")
    } >= {
        "ck_idempotency_records_key",
        "ck_idempotency_records_operation",
        "ck_idempotency_records_request_sha256",
        "ck_idempotency_records_response_status",
        "ck_idempotency_records_state_response",
    }

    assert {item["name"] for item in inspector.get_unique_constraints("users")} >= {
        "uq_users_wechat_app_openid",
        "uq_users_wechat_unionid",
    }
    app_openid_constraint = next(
        item
        for item in inspector.get_unique_constraints("users")
        if item["name"] == "uq_users_wechat_app_openid"
    )
    assert app_openid_constraint["column_names"] == ["wechat_app_id", "wechat_openid"]
    assert {
        item["name"] for item in inspector.get_unique_constraints("user_sessions")
    } >= {"uq_user_sessions_token_hash"}
    assert {item["name"] for item in inspector.get_unique_constraints("orders")} >= {
        "uq_orders_order_number"
    }
    assert {
        item["name"] for item in inspector.get_unique_constraints("idempotency_records")
    } >= {"uq_idempotency_records_user_operation_key"}

    check_definitions = {
        table: {
            item["name"]: item["sqltext"].lower()
            for item in inspector.get_check_constraints(table)
        }
        for table in (
            "users",
            "user_sessions",
            "orders",
            "payments",
            "idempotency_records",
        )
    }
    assert all(
        column in check_definitions["users"]["ck_users_phone_encrypted_fields"]
        for column in (
            "phone_ciphertext",
            "phone_nonce",
            "phone_key_version",
            "phone_verified_at",
        )
    )
    assert "phone_key_version > 0" in check_definitions["users"][
        "ck_users_phone_key_version"
    ]
    assert "octet_length(phone_nonce) = 12" in check_definitions["users"][
        "ck_users_phone_nonce_length"
    ]
    assert "octet_length(phone_ciphertext) >= 16" in check_definitions["users"][
        "ck_users_phone_ciphertext_length"
    ]
    assert "token_hash" in check_definitions["user_sessions"][
        "ck_user_sessions_token_hash"
    ]
    assert "expires_at > issued_at" in check_definitions["user_sessions"][
        "ck_user_sessions_expiry"
    ]
    assert "price_cents >= 0" in check_definitions["orders"]["ck_orders_price_cents"]
    assert "contact_name" in check_definitions["orders"]["ck_orders_contact_name"]
    assert all(
        column
        in check_definitions["orders"]["ck_orders_contact_phone_encrypted_fields"]
        for column in (
            "contact_phone_ciphertext",
            "contact_phone_nonce",
            "contact_phone_key_version",
        )
    )
    assert "expires_at > created_at" in check_definitions["orders"]["ck_orders_expiry"]
    status_expiry_check = check_definitions["orders"]["ck_orders_status_expired_at"]
    assert all(
        token in status_expiry_check
        for token in ("status <> 'expired'", "expired", "expired_at", "expires_at")
    )
    assert "octet_length(contact_phone_nonce) = 12" in check_definitions["orders"][
        "ck_orders_contact_phone_nonce_length"
    ]
    assert "octet_length(contact_phone_ciphertext) >= 16" in check_definitions[
        "orders"
    ]["ck_orders_contact_phone_ciphertext_length"]
    idempotency_checks = check_definitions["idempotency_records"]
    assert "request_sha256" in idempotency_checks[
        "ck_idempotency_records_request_sha256"
    ]
    assert "response_status" in idempotency_checks[
        "ck_idempotency_records_response_status"
    ]
    assert all(
        token in idempotency_checks["ck_idempotency_records_state_response"]
        for token in (
            "claimed",
            "processing",
            "completed",
            "payment_id",
            "response_status",
            "response_body",
        )
    )
    payment_checks = check_definitions["payments"]
    assert "amount_cents >= 0" in payment_checks["ck_payments_amount_cents"]
    assert "reconcile_attempts >= 0" in payment_checks["ck_payments_reconcile_attempts"]
    assert all(
        token in payment_checks["ck_payments_success_paid_at"]
        for token in ("success", "paid_at", "is not null", "is null")
    )


def test_encrypted_phone_and_response_columns_have_expected_catalog_types(
    pg_engine: Engine,
) -> None:
    inspector = inspect(pg_engine)
    user_columns = {item["name"]: item for item in inspector.get_columns("users")}
    order_columns = {item["name"]: item for item in inspector.get_columns("orders")}

    assert {
        name: (str(user_columns[name]["type"]), user_columns[name]["nullable"])
        for name in ("phone_ciphertext", "phone_nonce", "phone_key_version")
    } == {
        "phone_ciphertext": ("BYTEA", True),
        "phone_nonce": ("BYTEA", True),
        "phone_key_version": ("INTEGER", True),
    }
    assert {
        name: (str(order_columns[name]["type"]), order_columns[name]["nullable"])
        for name in (
            "contact_phone_ciphertext",
            "contact_phone_nonce",
            "contact_phone_key_version",
        )
    } == {
        "contact_phone_ciphertext": ("BYTEA", False),
        "contact_phone_nonce": ("BYTEA", False),
        "contact_phone_key_version": ("INTEGER", False),
    }


def test_slot_checkout_version_defaults_to_one(pg_session: Session) -> None:
    pitch = add_pitch(pg_session, venue())
    starts_at = datetime(2026, 8, 1, 10, tzinfo=UTC)
    slot = add_slot(pg_session, pitch, starts_at, starts_at + timedelta(hours=1))
    pg_session.flush()

    assert slot.checkout_version == 1


@pytest.mark.parametrize(
    ("field", "value"),
    [("phone_nonce", b"short"), ("phone_ciphertext", b"short")],
)
def test_user_encrypted_phone_shape_is_database_enforced(
    pg_session: Session, field: str, value: bytes
) -> None:
    user = _user()
    setattr(user, field, value)
    pg_session.add(user)

    with pytest.raises(IntegrityError):
        pg_session.flush()


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("contact_phone_nonce", b"short"),
        ("contact_phone_ciphertext", b"short"),
    ],
)
def test_order_encrypted_phone_snapshot_shape_is_database_enforced(
    pg_session: Session, field: str, value: bytes
) -> None:
    _, order = _order(pg_session)
    setattr(order, field, value)

    with pytest.raises(IntegrityError):
        pg_session.flush()


def test_locked_slot_references_order_and_restricts_order_delete(pg_session: Session) -> None:
    slot, order = _order(pg_session)
    slot.status = SlotStatus.LOCKED
    slot.locked_until = datetime.now(UTC) + timedelta(minutes=10)
    slot.locked_by_order_id = order.id
    pg_session.flush()

    assert slot.locked_by_order_id == order.id

    pg_session.delete(order)
    with pytest.raises(IntegrityError):
        pg_session.flush()


@pytest.mark.parametrize(
    ("state", "response_status", "response_body", "valid"),
    [
        ("CLAIMED", None, None, True),
        ("CLAIMED", 201, None, False),
        ("CLAIMED", None, {"id": "order"}, False),
        ("COMPLETED", 201, {"id": "order"}, True),
        ("COMPLETED", None, {"id": "order"}, False),
        ("COMPLETED", 201, None, False),
    ],
)
def test_idempotency_state_requires_a_complete_response_pair(
    pg_session: Session,
    state: str,
    response_status: int | None,
    response_body: dict[str, str] | None,
    valid: bool,
) -> None:
    user = _user()
    record = IdempotencyRecord(
        user=user,
        operation="CREATE_ORDER",
        key=str(uuid.uuid4()),
        request_sha256="a" * 64,
        state=state,
        response_status=response_status,
        response_body=response_body,
    )
    pg_session.add(record)

    if valid:
        pg_session.flush()
    else:
        with pytest.raises(IntegrityError):
            pg_session.flush()


def test_processing_idempotency_requires_payment_and_no_response(
    pg_session: Session,
) -> None:
    _, order = _order(pg_session)
    payment = _payment(order)
    pg_session.add(payment)
    pg_session.flush()
    record = IdempotencyRecord(
        user=order.user,
        operation="CREATE_PAYMENT",
        key=str(uuid.uuid4()),
        request_sha256="c" * 64,
        state="PROCESSING",
        payment=payment,
    )
    pg_session.add(record)
    pg_session.flush()

    assert record.payment_id == payment.id


def test_processing_idempotency_without_payment_is_rejected(pg_session: Session) -> None:
    pg_session.add(
        IdempotencyRecord(
            user=_user(),
            operation="CREATE_PAYMENT",
            key=str(uuid.uuid4()),
            request_sha256="d" * 64,
            state="PROCESSING",
        )
    )

    with pytest.raises(IntegrityError):
        pg_session.flush()


@pytest.mark.parametrize(
    ("status", "paid_at", "valid"),
    [
        (PaymentState.SUCCESS, datetime.now(UTC), True),
        (PaymentState.SUCCESS, None, False),
        (PaymentState.CLOSED, None, True),
        (PaymentState.CLOSED, datetime.now(UTC), False),
    ],
)
def test_payment_success_is_exactly_the_state_with_paid_at(
    pg_session: Session,
    status: PaymentState,
    paid_at: datetime | None,
    valid: bool,
) -> None:
    _, order = _order(pg_session)
    pg_session.add(_payment(order, status=status, paid_at=paid_at))

    if valid:
        pg_session.flush()
    else:
        with pytest.raises(IntegrityError):
            pg_session.flush()


def test_payment_authority_unknown_anchor_can_survive_terminal_state(
    pg_session: Session,
) -> None:
    _, order = _order(pg_session)
    anchor = datetime.now(UTC)
    payment = _payment(
        order,
        status=PaymentState.CLOSED,
        authority_unknown_since=anchor,
    )
    pg_session.add(payment)
    pg_session.flush()

    assert payment.authority_unknown_since == anchor


def test_only_one_nonterminal_payment_is_allowed_per_order(pg_session: Session) -> None:
    _, order = _order(pg_session)
    pg_session.add_all(
        [
            _payment(order, status=PaymentState.CREATING),
            _payment(order, status=PaymentState.UNKNOWN),
        ]
    )

    with pytest.raises(IntegrityError):
        pg_session.flush()


def test_multiple_closed_payment_attempts_are_allowed(pg_session: Session) -> None:
    _, order = _order(pg_session)
    pg_session.add_all(
        [_payment(order, status=PaymentState.CLOSED), _payment(order, status=PaymentState.CLOSED)]
    )
    pg_session.flush()


@pytest.mark.parametrize("field", ["merchant_order_no", "provider_transaction_no"])
def test_provider_payment_identifiers_are_unique(
    pg_session: Session, field: str
) -> None:
    _, first_order = _order(pg_session)
    _, second_order = _order(pg_session)
    identifier = f"identifier-{uuid.uuid4().hex}"
    overrides = {field: identifier}
    pg_session.add_all(
        [
            _payment(first_order, status=PaymentState.CLOSED, **overrides),
            _payment(second_order, status=PaymentState.CLOSED, **overrides),
        ]
    )

    with pytest.raises(IntegrityError):
        pg_session.flush()


@pytest.mark.parametrize("blocking_status", [PaymentState.CREATING, PaymentState.SUCCESS])
def test_payment_authority_blocks_order_expiry(
    pg_session: Session, blocking_status: PaymentState
) -> None:
    _, order = _order(pg_session)
    paid_at = datetime.now(UTC) if blocking_status is PaymentState.SUCCESS else None
    pg_session.add(_payment(order, status=blocking_status, paid_at=paid_at))
    pg_session.flush()
    order.status = OrderStatus.EXPIRED
    order.expired_at = order.expires_at

    with pytest.raises(IntegrityError):
        pg_session.flush()


def test_closed_payment_allows_order_expiry(pg_session: Session) -> None:
    _, order = _order(pg_session)
    pg_session.add(_payment(order, status=PaymentState.CLOSED))
    pg_session.flush()
    order.status = OrderStatus.EXPIRED
    order.expired_at = order.expires_at
    pg_session.flush()


@pytest.mark.parametrize(
    "blocking_status",
    [
        PaymentState.CREATING,
        PaymentState.PREPAY_CREATED,
        PaymentState.CONFIRMING,
        PaymentState.UNKNOWN,
        PaymentState.SUCCESS,
    ],
)
def test_expired_order_rejects_new_payment_authority(
    pg_session: Session, blocking_status: PaymentState
) -> None:
    _, order = _order(pg_session)
    order.status = OrderStatus.EXPIRED
    order.expired_at = order.expires_at
    pg_session.flush()
    paid_at = datetime.now(UTC) if blocking_status is PaymentState.SUCCESS else None
    pg_session.add(_payment(order, status=blocking_status, paid_at=paid_at))

    with pytest.raises(IntegrityError):
        pg_session.flush()


@pytest.mark.parametrize(
    "blocking_status",
    [
        PaymentState.CREATING,
        PaymentState.PREPAY_CREATED,
        PaymentState.CONFIRMING,
        PaymentState.UNKNOWN,
        PaymentState.SUCCESS,
    ],
)
def test_expired_order_rejects_closed_payment_becoming_authoritative(
    pg_session: Session, blocking_status: PaymentState
) -> None:
    _, order = _order(pg_session)
    payment = _payment(order, status=PaymentState.CLOSED)
    pg_session.add(payment)
    pg_session.flush()
    order.status = OrderStatus.EXPIRED
    order.expired_at = order.expires_at
    pg_session.flush()
    payment.status = blocking_status
    payment.paid_at = datetime.now(UTC) if blocking_status is PaymentState.SUCCESS else None

    with pytest.raises(IntegrityError):
        pg_session.flush()


def test_authoritative_payment_rejects_move_to_expired_order(pg_session: Session) -> None:
    _, source_order = _order(pg_session)
    _, expired_order = _order(pg_session)
    payment = _payment(source_order)
    pg_session.add(payment)
    expired_order.status = OrderStatus.EXPIRED
    expired_order.expired_at = expired_order.expires_at
    pg_session.flush()
    payment.order_id = expired_order.id

    with pytest.raises(IntegrityError):
        pg_session.flush()


def _wait_for_database_lock(engine: Engine, backend_pid: int) -> None:
    deadline = time_module.monotonic() + 5
    while time_module.monotonic() < deadline:
        with engine.connect() as observer:
            wait_event_type = observer.execute(
                text(
                    "SELECT wait_event_type FROM pg_stat_activity "
                    "WHERE pid = :backend_pid"
                ),
                {"backend_pid": backend_pid},
            ).scalar_one_or_none()
        if wait_event_type == "Lock":
            return
        time_module.sleep(0.01)
    pytest.fail(f"backend {backend_pid} did not block on a database lock")


@pytest.mark.parametrize("first_writer", ["payment", "expiry"])
def test_payment_authority_and_expiry_are_serialized(
    pg_engine: Engine, first_writer: str
) -> None:
    with Session(pg_engine) as setup_session:
        _, order = _order(setup_session)
        setup_session.commit()
        order_id = order.id
        expires_at = order.expires_at

    payment_id = uuid.uuid4()
    blocked_backend: Queue[int] = Queue()

    def insert_payment() -> str:
        try:
            with pg_engine.begin() as connection:
                blocked_backend.put(
                    connection.execute(text("SELECT pg_backend_pid()")).scalar_one()
                )
                connection.execute(
                    text(
                        "INSERT INTO payments "
                        "(id, order_id, provider, merchant_order_no, amount_cents, "
                        "currency, status, reconcile_attempts) VALUES "
                        "(:id, :order_id, 'WECHAT_PAY', :merchant_order_no, 36000, "
                        "'CNY', 'CREATING', 0)"
                    ),
                    {
                        "id": payment_id,
                        "order_id": order_id,
                        "merchant_order_no": f"merchant-{payment_id.hex}",
                    },
                )
        except IntegrityError:
            return "rejected"
        return "committed"

    def expire_order() -> str:
        try:
            with pg_engine.begin() as connection:
                blocked_backend.put(
                    connection.execute(text("SELECT pg_backend_pid()")).scalar_one()
                )
                connection.execute(
                    text(
                        "UPDATE orders SET status = 'EXPIRED', expired_at = :expired_at "
                        "WHERE id = :order_id"
                    ),
                    {"expired_at": expires_at, "order_id": order_id},
                )
        except IntegrityError:
            return "rejected"
        return "committed"

    first_connection = pg_engine.connect()
    first_transaction = first_connection.begin()
    try:
        if first_writer == "payment":
            first_connection.execute(
                text(
                    "INSERT INTO payments "
                    "(id, order_id, provider, merchant_order_no, amount_cents, "
                    "currency, status, reconcile_attempts) VALUES "
                    "(:id, :order_id, 'WECHAT_PAY', :merchant_order_no, 36000, "
                    "'CNY', 'CREATING', 0)"
                ),
                {
                    "id": payment_id,
                    "order_id": order_id,
                    "merchant_order_no": f"merchant-{payment_id.hex}",
                },
            )
            second_writer = expire_order
        else:
            first_connection.execute(
                text(
                    "UPDATE orders SET status = 'EXPIRED', expired_at = :expired_at "
                    "WHERE id = :order_id"
                ),
                {"expired_at": expires_at, "order_id": order_id},
            )
            second_writer = insert_payment

        with ThreadPoolExecutor(max_workers=1) as executor:
            result = executor.submit(second_writer)
            backend_pid = blocked_backend.get(timeout=5)
            _wait_for_database_lock(pg_engine, backend_pid)
            first_transaction.commit()
            assert result.result(timeout=5) == "rejected"
    finally:
        if first_transaction.is_active:
            first_transaction.rollback()
        first_connection.close()

    with pg_engine.connect() as connection:
        order_status = connection.execute(
            text("SELECT status::text FROM orders WHERE id = :order_id"),
            {"order_id": order_id},
        ).scalar_one()
        payment_count = connection.execute(
            text("SELECT count(*) FROM payments WHERE order_id = :order_id"),
            {"order_id": order_id},
        ).scalar_one()

    if first_writer == "payment":
        assert (order_status, payment_count) == ("PENDING_PAYMENT", 1)
    else:
        assert (order_status, payment_count) == ("EXPIRED", 0)


@pytest.mark.parametrize(
    ("status", "expired_at"),
    [
        (OrderStatus.PENDING_PAYMENT, datetime.now(UTC)),
        (OrderStatus.EXPIRED, None),
        (OrderStatus.EXPIRED, datetime(2000, 1, 1, tzinfo=UTC)),
    ],
    ids=["pending-with-expired-at", "expired-without-time", "expired-before-deadline"],
)
def test_order_status_and_expired_at_are_database_enforced(
    pg_session: Session,
    status: OrderStatus,
    expired_at: datetime | None,
) -> None:
    _, order = _order(pg_session)
    order.status = status
    order.expired_at = expired_at

    with pytest.raises(IntegrityError):
        pg_session.flush()


def test_idempotency_scope_is_unique_per_user_operation_and_key(pg_session: Session) -> None:
    user = _user()
    common = {
        "user": user,
        "operation": "CREATE_ORDER",
        "key": str(uuid.uuid4()),
        "request_sha256": "b" * 64,
        "state": "CLAIMED",
    }
    pg_session.add_all([IdempotencyRecord(**common), IdempotencyRecord(**common)])

    with pytest.raises(IntegrityError):
        pg_session.flush()


def test_request_digest_must_be_canonical_sha256(pg_session: Session) -> None:
    pg_session.add(
        IdempotencyRecord(
            user=_user(),
            operation="CREATE_ORDER",
            key=str(uuid.uuid4()),
            request_sha256="too-short",
            state="CLAIMED",
        )
    )

    with pytest.raises(IntegrityError):
        pg_session.flush()
