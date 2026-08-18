import hashlib
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from backend.app.config import Settings
from backend.app.database import get_database
from backend.app.main import create_app
from backend.app.models import (
    Order,
    OrderStatus,
    Payment,
    PaymentState,
    Slot,
    SlotStatus,
    User,
    UserSession,
)
from backend.app.modules.orders.repository import OrderRepository
from backend.app.modules.orders.router import get_order_clock
from backend.tests.test_schema_constraints import add_pitch, add_slot, venue

pytestmark = pytest.mark.integration

NOW = datetime(2026, 8, 18, 5, tzinfo=UTC)
RAW_TOKEN = "my-orders-owner-token-with-at-least-256-bits"


def _client(engine: Engine) -> TestClient:
    app = create_app(
        settings=Settings(app_env="test", wechat_provider="development")
    )

    def database_override() -> Iterator[Session]:
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_database] = database_override
    app.dependency_overrides[get_order_clock] = lambda: NOW
    return TestClient(app, raise_server_exceptions=False)


def _auth(token: str = RAW_TOKEN) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _add_user(
    session: Session,
    *,
    token: str | None = None,
) -> User:
    user = User(
        wechat_app_id="wx-test-app",
        wechat_openid=f"my-orders-{uuid.uuid4()}",
    )
    session.add(user)
    session.flush()
    if token is not None:
        session.add(
            UserSession(
                user=user,
                token_hash=hashlib.sha256(token.encode()).hexdigest(),
                issued_at=datetime.now(UTC) - timedelta(minutes=1),
                expires_at=datetime.now(UTC) + timedelta(days=1),
            )
        )
    return user


def _add_order(
    session: Session,
    *,
    user: User,
    sequence: int,
    created_at: datetime,
    order_id: uuid.UUID | None = None,
    status: OrderStatus = OrderStatus.PENDING_PAYMENT,
    expires_at: datetime | None = None,
    payment_state: PaymentState | None = None,
) -> Order:
    parent = venue(
        name=f"测试场馆 {sequence}",
        timezone="Asia/Shanghai",
    )
    pitch = add_pitch(session, parent)
    pitch.name = f"七人制 {sequence} 场"
    starts_at = NOW + timedelta(days=sequence + 1)
    slot = add_slot(
        session,
        pitch,
        starts_at,
        starts_at + timedelta(hours=1),
        checkout_version=7,
    )
    resolved_expiry = expires_at or created_at + timedelta(minutes=10)
    order = Order(
        id=order_id or uuid.uuid4(),
        order_number=f"PB-LIST-{sequence:03d}-{uuid.uuid4().hex[:8]}",
        user=user,
        slot=slot,
        status=status,
        price_cents=36000 + sequence,
        contact_name="不应出现在列表",
        contact_phone_ciphertext=b"private-encrypted-phone-and-tag",
        contact_phone_nonce=b"abcdefghijkl",
        contact_phone_key_version=1,
        created_at=created_at,
        expires_at=resolved_expiry,
        expired_at=(
            resolved_expiry + timedelta(seconds=1)
            if status is OrderStatus.EXPIRED
            else None
        ),
    )
    session.add(order)
    session.flush()

    if status is OrderStatus.PENDING_PAYMENT:
        slot.status = SlotStatus.LOCKED
        slot.locked_until = resolved_expiry
        slot.locked_by_order_id = order.id
    elif status is OrderStatus.CONFIRMED:
        slot.status = SlotStatus.BOOKED

    if payment_state is not None:
        session.add(
            Payment(
                order=order,
                provider="mock",
                merchant_order_no=f"M-{uuid.uuid4().hex}",
                provider_prepay_id=(
                    f"wx-{uuid.uuid4().hex}"
                    if payment_state is not PaymentState.CLOSED
                    else None
                ),
                provider_transaction_no=(
                    f"T-{uuid.uuid4().hex}"
                    if payment_state is PaymentState.SUCCESS
                    else None
                ),
                amount_cents=order.price_cents,
                currency="CNY",
                status=payment_state,
                created_at=created_at + timedelta(seconds=1),
                paid_at=(
                    created_at + timedelta(seconds=2)
                    if payment_state is PaymentState.SUCCESS
                    else None
                ),
            )
        )
    session.flush()
    return order


def test_list_is_owner_only_newest_first_and_private(pg_engine: Engine) -> None:
    same_created_at = NOW - timedelta(minutes=3)
    low_id = uuid.UUID("00000000-0000-4000-8000-000000000010")
    high_id = uuid.UUID("00000000-0000-4000-8000-000000000011")
    with Session(pg_engine) as session:
        owner = _add_user(session, token=RAW_TOKEN)
        stranger = _add_user(session)
        oldest = _add_order(
            session,
            user=owner,
            sequence=1,
            created_at=NOW - timedelta(minutes=4),
        )
        lower_tie = _add_order(
            session,
            user=owner,
            sequence=2,
            created_at=same_created_at,
            order_id=low_id,
        )
        higher_tie = _add_order(
            session,
            user=owner,
            sequence=3,
            created_at=same_created_at,
            order_id=high_id,
        )
        newest = _add_order(
            session,
            user=owner,
            sequence=4,
            created_at=NOW - timedelta(minutes=2),
        )
        _add_order(
            session,
            user=stranger,
            sequence=5,
            created_at=NOW - timedelta(minutes=1),
        )
        expected_ids = [
            str(newest.id),
            str(higher_tie.id),
            str(lower_tie.id),
            str(oldest.id),
        ]
        session.commit()

    with _client(pg_engine) as client:
        response = client.get("/api/v1/orders", headers=_auth())

    assert response.status_code == 200
    body = response.json()
    assert [row["id"] for row in body["orders"]] == expected_ids
    assert body["next_cursor"] is None
    assert set(body["orders"][0]) == {
        "id",
        "order_number",
        "status",
        "venue",
        "pitch",
        "starts_at",
        "ends_at",
        "price_cents",
        "currency",
        "created_at",
        "expires_at",
        "payment_confirming",
        "closing_payment",
        "cancel_requested_at",
        "cancelled_at",
        "checked_in_at",
        "completed_at",
        "allowed_actions",
        "funding_alerts",
    }
    assert body["orders"][0]["cancel_requested_at"] is None
    assert body["orders"][0]["cancelled_at"] is None
    assert body["orders"][0]["checked_in_at"] is None
    assert body["orders"][0]["completed_at"] is None
    assert body["orders"][0]["allowed_actions"] == {
        "can_pay": True,
        "can_cancel": True,
        "can_check_in": False,
        "can_complete": False,
        "can_refund": False,
        "blocked_reason": None,
    }
    assert body["orders"][0]["funding_alerts"] == []
    assert set(body["orders"][0]["venue"]) == {"id", "name"}
    assert set(body["orders"][0]["pitch"]) == {"id", "name"}
    for private_field in (
        "contact",
        "contact_name",
        "phone",
        "address",
        "latitude",
        "longitude",
        "payment_state",
        "paid_at",
        "wechat_prepay_id",
        "payment_id",
        "refund_id",
        "refund_case_id",
        "refund_attempt_id",
        "provider",
        "provider_refund_no",
        "merchant_order_no",
        "merchant_refund_no",
        "requested_by_user_id",
        "checked_in_by_user_id",
        "completed_by_user_id",
    ):
        assert private_field not in response.text


def test_list_projects_all_nine_lifecycle_statuses_and_required_timestamps(
    pg_engine: Engine,
) -> None:
    statuses = list(OrderStatus)
    assert statuses == [
        OrderStatus.PENDING_PAYMENT,
        OrderStatus.CONFIRMED,
        OrderStatus.EXPIRED,
        OrderStatus.PAYMENT_EXCEPTION,
        OrderStatus.CANCELLED,
        OrderStatus.REFUND_PENDING,
        OrderStatus.REFUND_FAILED,
        OrderStatus.REFUNDED,
        OrderStatus.COMPLETED,
    ]
    with Session(pg_engine) as session:
        owner = _add_user(session, token=RAW_TOKEN)
        expected: dict[
            str,
            tuple[datetime | None, datetime | None, datetime | None, datetime | None],
        ] = {}
        for sequence, status in enumerate(statuses, start=1):
            created_at = NOW - timedelta(minutes=sequence)
            seeded_status = (
                OrderStatus.PENDING_PAYMENT
                if status
                in {
                    OrderStatus.CANCELLED,
                    OrderStatus.REFUND_PENDING,
                    OrderStatus.REFUND_FAILED,
                    OrderStatus.REFUNDED,
                }
                else OrderStatus.CONFIRMED
                if status is OrderStatus.COMPLETED
                else status
            )
            order = _add_order(
                session,
                user=owner,
                sequence=sequence,
                created_at=created_at,
                status=seeded_status,
                expires_at=created_at + timedelta(minutes=10),
            )
            if status in {
                OrderStatus.CANCELLED,
                OrderStatus.REFUND_PENDING,
                OrderStatus.REFUND_FAILED,
                OrderStatus.REFUNDED,
            }:
                order.cancel_requested_at = created_at + timedelta(minutes=1)
                order.cancelled_at = created_at + timedelta(minutes=2)
            if status is OrderStatus.COMPLETED:
                order.checked_in_at = order.slot.starts_at
                order.checked_in_by_user_id = owner.id
                order.completed_at = order.slot.ends_at
                order.completed_by_user_id = owner.id
            order.status = status
            expected[str(order.id)] = (
                order.cancel_requested_at,
                order.cancelled_at,
                order.checked_in_at,
                order.completed_at,
            )
        session.commit()

    with _client(pg_engine) as client:
        response = client.get("/api/v1/orders", headers=_auth())

    assert response.status_code == 200
    rows = {row["id"]: row for row in response.json()["orders"]}
    assert set(rows) == set(expected)
    assert {row["status"] for row in rows.values()} == {
        status.value for status in statuses
    }
    for order_id, timestamps in expected.items():
        row = rows[order_id]
        assert set(row["allowed_actions"]) == {
            "can_pay",
            "can_cancel",
            "can_check_in",
            "can_complete",
            "can_refund",
            "blocked_reason",
        }
        assert row["funding_alerts"] == []
        cancel_requested_at, cancelled_at, checked_in_at, completed_at = timestamps
        assert (
            datetime.fromisoformat(row["cancel_requested_at"])
            if row["cancel_requested_at"] is not None
            else None
        ) == cancel_requested_at
        assert (
            datetime.fromisoformat(row["cancelled_at"])
            if row["cancelled_at"] is not None
            else None
        ) == cancelled_at
        assert (
            datetime.fromisoformat(row["checked_in_at"])
            if row["checked_in_at"] is not None
            else None
        ) == checked_in_at
        assert (
            datetime.fromisoformat(row["completed_at"])
            if row["completed_at"] is not None
            else None
        ) == completed_at


def test_keyset_cursor_pages_without_duplicates(pg_engine: Engine) -> None:
    with Session(pg_engine) as session:
        owner = _add_user(session, token=RAW_TOKEN)
        expected = [
            _add_order(
                session,
                user=owner,
                sequence=sequence,
                created_at=NOW - timedelta(minutes=sequence),
            )
            for sequence in range(5)
        ]
        session.commit()
        expected_ids = [str(order.id) for order in expected]

    seen: list[str] = []
    cursor: str | None = None
    with _client(pg_engine) as client:
        while True:
            params: dict[str, object] = {"limit": 2}
            if cursor is not None:
                params["cursor"] = cursor
            response = client.get("/api/v1/orders", headers=_auth(), params=params)
            assert response.status_code == 200
            page = response.json()
            seen.extend(row["id"] for row in page["orders"])
            next_cursor = page["next_cursor"]
            if next_cursor is None:
                break
            assert isinstance(next_cursor, str)
            assert next_cursor
            assert all(order_id not in next_cursor for order_id in expected_ids)
            cursor = next_cursor

    assert seen == expected_ids
    assert len(seen) == len(set(seen)) == 5


@pytest.mark.parametrize(
    "cursor",
    (
        "not-base64",
        "_w",
        "eyJ2IjoxLjAsImNyZWF0ZWRfYXQiOiIyMDI2LTA4LTE4VDA1OjAwOjAwKzAwOjAwIiwiaWQiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDEifQ",
        "eyJ2IjoyLCJjcmVhdGVkX2F0IjoiMjAyNi0wOC0xOFQwNTowMDowMCswMDowMCIsImlkIjoiMDAwMDAwMDAtMDAwMC00MDAwLTgwMDAtMDAwMDAwMDAwMDAxIn0",
        "eyJ2IjoxLCJjcmVhdGVkX2F0Ijoibm90LWEtZGF0ZSIsImlkIjoiYmFkIn0",
    ),
)
def test_invalid_versioned_cursor_returns_422(
    pg_engine: Engine,
    cursor: str,
) -> None:
    with Session(pg_engine) as session:
        _add_user(session, token=RAW_TOKEN)
        session.commit()

    with _client(pg_engine) as client:
        response = client.get(
            "/api/v1/orders",
            headers=_auth(),
            params={"cursor": cursor},
        )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_ARGUMENT"


def test_list_projects_six_honest_states_and_converges_safe_expiry(
    pg_engine: Engine,
) -> None:
    with Session(pg_engine) as session:
        owner = _add_user(session, token=RAW_TOKEN)
        pending = _add_order(
            session,
            user=owner,
            sequence=1,
            created_at=NOW - timedelta(minutes=5),
            expires_at=NOW + timedelta(minutes=5),
        )
        closing = _add_order(
            session,
            user=owner,
            sequence=2,
            created_at=NOW - timedelta(hours=2),
            expires_at=NOW - timedelta(hours=1),
            payment_state=PaymentState.PREPAY_CREATED,
        )
        confirming = _add_order(
            session,
            user=owner,
            sequence=3,
            created_at=NOW - timedelta(minutes=4),
            expires_at=NOW + timedelta(minutes=6),
            payment_state=PaymentState.CONFIRMING,
        )
        confirmed = _add_order(
            session,
            user=owner,
            sequence=4,
            created_at=NOW - timedelta(minutes=3),
            expires_at=NOW + timedelta(minutes=7),
            status=OrderStatus.CONFIRMED,
            payment_state=PaymentState.SUCCESS,
        )
        safe_expiry = _add_order(
            session,
            user=owner,
            sequence=5,
            created_at=NOW - timedelta(hours=3),
            expires_at=NOW - timedelta(hours=2),
        )
        payment_exception = _add_order(
            session,
            user=owner,
            sequence=6,
            created_at=NOW - timedelta(minutes=2),
            expires_at=NOW + timedelta(minutes=8),
            status=OrderStatus.PAYMENT_EXCEPTION,
            payment_state=PaymentState.CLOSED,
        )
        safe_slot_id = safe_expiry.slot_id
        ids = {
            "pending": str(pending.id),
            "closing": str(closing.id),
            "confirming": str(confirming.id),
            "confirmed": str(confirmed.id),
            "safe_expiry": str(safe_expiry.id),
            "payment_exception": str(payment_exception.id),
        }
        safe_expiry_id = safe_expiry.id
        closing_id = closing.id
        session.commit()

    with _client(pg_engine) as client:
        response = client.get("/api/v1/orders", headers=_auth())

    assert response.status_code == 200
    rows = {row["id"]: row for row in response.json()["orders"]}
    assert rows[ids["pending"]]["status"] == "PENDING_PAYMENT"
    assert rows[ids["pending"]]["payment_confirming"] is False
    assert rows[ids["pending"]]["closing_payment"] is False
    assert rows[ids["closing"]]["status"] == "PENDING_PAYMENT"
    assert rows[ids["closing"]]["payment_confirming"] is True
    assert rows[ids["closing"]]["closing_payment"] is True
    assert rows[ids["confirming"]]["payment_confirming"] is True
    assert rows[ids["confirming"]]["closing_payment"] is False
    assert rows[ids["confirmed"]]["status"] == "CONFIRMED"
    assert rows[ids["confirmed"]]["payment_confirming"] is False
    assert rows[ids["confirmed"]]["closing_payment"] is False
    assert rows[ids["safe_expiry"]]["status"] == "EXPIRED"
    assert rows[ids["safe_expiry"]]["closing_payment"] is False
    assert rows[ids["payment_exception"]]["status"] == "PAYMENT_EXCEPTION"
    assert rows[ids["payment_exception"]]["payment_confirming"] is False
    assert rows[ids["payment_exception"]]["closing_payment"] is False

    with Session(pg_engine) as session:
        persisted = session.get_one(Order, safe_expiry_id)
        slot = session.get_one(Slot, safe_slot_id)
        closing_persisted = session.get_one(Order, closing_id)
        assert persisted.status is OrderStatus.EXPIRED
        assert persisted.expired_at is not None
        assert slot.status is SlotStatus.AVAILABLE
        assert slot.locked_by_order_id is None
        assert slot.checkout_version == 8
        assert closing_persisted.status is OrderStatus.PENDING_PAYMENT


def test_commit_failure_rolls_back_expiry_and_returns_503(
    pg_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with Session(pg_engine) as session:
        owner = _add_user(session, token=RAW_TOKEN)
        order = _add_order(
            session,
            user=owner,
            sequence=1,
            created_at=NOW - timedelta(hours=2),
            expires_at=NOW - timedelta(hours=1),
        )
        slot_id = order.slot_id
        order_id = order.id
        session.commit()

    def fail_commit(_repository: OrderRepository) -> None:
        raise SQLAlchemyError("injected commit failure")

    monkeypatch.setattr(OrderRepository, "commit", fail_commit)
    with _client(pg_engine) as client:
        response = client.get("/api/v1/orders", headers=_auth())

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "SERVICE_UNAVAILABLE"
    with Session(pg_engine) as session:
        persisted = session.get_one(Order, order_id)
        slot = session.get_one(Slot, slot_id)
        assert persisted.status is OrderStatus.PENDING_PAYMENT
        assert persisted.expired_at is None
        assert slot.status is SlotStatus.LOCKED
        assert slot.locked_by_order_id == order_id
        assert slot.checkout_version == 7


def test_list_requires_business_session(pg_engine: Engine) -> None:
    with _client(pg_engine) as client:
        missing = client.get("/api/v1/orders")
        invalid = client.get("/api/v1/orders", headers=_auth("invalid-session"))

    for response in (missing, invalid):
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "AUTH_REQUIRED"


def test_list_auth_database_failure_rolls_back_and_returns_503() -> None:
    class FailingAuthDatabase:
        rollback_called = False

        def scalar(self, _statement: object) -> object:
            raise SQLAlchemyError("injected auth lookup failure")

        def rollback(self) -> None:
            self.rollback_called = True

    database = FailingAuthDatabase()
    app = create_app(
        settings=Settings(app_env="test", wechat_provider="development")
    )
    app.dependency_overrides[get_database] = lambda: database

    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get("/api/v1/orders", headers=_auth())

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "SERVICE_UNAVAILABLE"
    assert database.rollback_called is True
