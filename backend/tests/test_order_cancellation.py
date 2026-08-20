import base64
import hashlib
import json
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from backend.app.config import Settings
from backend.app.database import get_database
from backend.app.main import create_app
from backend.app.models import (
    IdempotencyRecord,
    IdempotencyState,
    Order,
    OrderStatus,
    Payment,
    PaymentState,
    RefundAttempt,
    RefundCase,
    Slot,
    SlotStatus,
    User,
    UserSession,
    Venue,
)
from backend.app.modules.auth.router import get_phone_vault
from backend.app.modules.orders.repository import OrderRepository
from backend.app.modules.orders.router import get_order_clock
from backend.app.security.phone_vault import PhoneVault
from backend.tests.test_schema_constraints import add_pitch, add_slot, venue

pytestmark = pytest.mark.integration

NOW = datetime(2026, 8, 20, 7, tzinfo=UTC)
KEY_BASE64 = base64.b64encode(bytes(range(32))).decode("ascii")
KEY_VERSION = 7
FULL_PHONE = "13812345678"
OWNER_TOKEN = "owner-cancellation-business-token-with-enough-entropy"
STRANGER_TOKEN = "stranger-cancellation-business-token-with-enough-entropy"
CANCEL_KEY = "cancel-order-0000000000000001"


@dataclass(frozen=True, slots=True)
class SeededCancellation:
    owner_id: uuid.UUID
    stranger_id: uuid.UUID
    order_id: uuid.UUID
    slot_id: uuid.UUID
    checkout_version: int


def _add_session(session: Session, *, user: User, token: str) -> None:
    auth_now = datetime.now(UTC)
    session.add(
        UserSession(
            user=user,
            token_hash=hashlib.sha256(token.encode()).hexdigest(),
            issued_at=auth_now,
            expires_at=auth_now + timedelta(days=1),
        )
    )


def _snapshot_phone(order: Order) -> None:
    sealed = PhoneVault(
        key_base64=KEY_BASE64,
        key_version=KEY_VERSION,
    ).encrypt(
        FULL_PHONE,
        record_type="order",
        record_id=order.id,
        field="contact_phone",
    )
    order.contact_phone_ciphertext = sealed.ciphertext_with_tag
    order.contact_phone_nonce = sealed.nonce
    order.contact_phone_key_version = sealed.key_version


def _add_payment(
    session: Session,
    *,
    order: Order,
    status: PaymentState,
) -> Payment:
    payment_id = uuid.uuid4()
    row = Payment(
        id=payment_id,
        order=order,
        provider="mock",
        merchant_order_no=f"P{payment_id.hex}",
        provider_prepay_id=(
            f"wx-{payment_id.hex}"
            if status
            in {
                PaymentState.PREPAY_CREATED,
                PaymentState.CONFIRMING,
                PaymentState.UNKNOWN,
            }
            else None
        ),
        provider_transaction_no=(
            f"txn-{payment_id.hex}" if status is PaymentState.SUCCESS else None
        ),
        amount_cents=order.price_cents,
        currency="CNY",
        status=status,
        created_at=NOW - timedelta(minutes=4),
        paid_at=(
            NOW - timedelta(minutes=3)
            if status is PaymentState.SUCCESS
            else None
        ),
        applied_to_order_at=None,
    )
    session.add(row)
    session.flush()
    return row


def _add_pending_order(
    session: Session,
    *,
    owner: User,
    parent: Venue,
    payment_state: PaymentState | None = None,
    slot_status: SlotStatus = SlotStatus.LOCKED,
    another_order_owns_lock: bool = False,
    pitch_name: str = "五人制 A 场",
) -> tuple[Order, Slot]:
    pitch = add_pitch(session, parent)
    pitch.name = pitch_name
    slot = add_slot(
        session,
        pitch,
        NOW + timedelta(days=3),
        NOW + timedelta(days=3, hours=2),
        checkout_version=8,
    )
    order = Order(
        id=uuid.uuid4(),
        order_number=f"PB-{uuid.uuid4().hex}",
        user=owner,
        slot=slot,
        status=OrderStatus.PENDING_PAYMENT,
        price_cents=36000,
        contact_name="张三",
        contact_phone_ciphertext=b"temporary-encrypted-value",
        contact_phone_nonce=b"abcdefghijkl",
        contact_phone_key_version=1,
        created_at=NOW - timedelta(minutes=5),
        expires_at=NOW + timedelta(minutes=5),
    )
    session.add(order)
    session.flush()
    _snapshot_phone(order)

    if another_order_owns_lock:
        other_pitch = add_pitch(session, venue(timezone="Asia/Shanghai"))
        other_pitch.name = "其他订单场地"
        other_slot = add_slot(
            session,
            other_pitch,
            NOW + timedelta(days=4),
            NOW + timedelta(days=4, hours=2),
        )
        other_order = Order(
            id=uuid.uuid4(),
            order_number=f"PB-{uuid.uuid4().hex}",
            user=owner,
            slot=other_slot,
            status=OrderStatus.PENDING_PAYMENT,
            price_cents=36000,
            contact_name="其他用户",
            contact_phone_ciphertext=b"other-encrypted-phone-tag",
            contact_phone_nonce=b"abcdefghijkl",
            contact_phone_key_version=1,
            created_at=NOW - timedelta(minutes=4),
            expires_at=NOW + timedelta(minutes=6),
        )
        session.add(other_order)
        session.flush()
        slot.status = SlotStatus.LOCKED
        slot.locked_until = order.expires_at
        slot.locked_by_order_id = other_order.id
    elif slot_status is SlotStatus.LOCKED:
        slot.status = SlotStatus.LOCKED
        slot.locked_until = order.expires_at
        slot.locked_by_order_id = order.id
    else:
        slot.status = slot_status
        slot.locked_until = None
        slot.locked_by_order_id = None

    if payment_state is not None:
        _add_payment(session, order=order, status=payment_state)
    session.flush()
    return order, slot


def _seed_pending_order(
    engine: Engine,
    *,
    payment_state: PaymentState | None = None,
    slot_status: SlotStatus = SlotStatus.LOCKED,
    another_order_owns_lock: bool = False,
) -> SeededCancellation:
    with Session(engine) as session:
        owner = User(
            wechat_app_id="wx-test-app",
            wechat_openid=f"cancel-owner-{uuid.uuid4()}",
        )
        stranger = User(
            wechat_app_id="wx-test-app",
            wechat_openid=f"cancel-stranger-{uuid.uuid4()}",
        )
        session.add_all((owner, stranger))
        session.flush()
        _add_session(session, user=owner, token=OWNER_TOKEN)
        _add_session(session, user=stranger, token=STRANGER_TOKEN)
        parent = venue(timezone="Asia/Shanghai")
        order, slot = _add_pending_order(
            session,
            owner=owner,
            parent=parent,
            payment_state=payment_state,
            slot_status=slot_status,
            another_order_owns_lock=another_order_owns_lock,
        )
        session.commit()
        return SeededCancellation(
            owner_id=owner.id,
            stranger_id=stranger.id,
            order_id=order.id,
            slot_id=slot.id,
            checkout_version=slot.checkout_version,
        )


def _add_second_pending_order(
    engine: Engine,
    *,
    owner_id: uuid.UUID,
) -> tuple[uuid.UUID, uuid.UUID]:
    with Session(engine) as session:
        owner = session.get_one(User, owner_id)
        parent = venue(timezone="Asia/Shanghai")
        order, slot = _add_pending_order(
            session,
            owner=owner,
            parent=parent,
            pitch_name="七人制 B 场",
        )
        session.commit()
        return order.id, slot.id


def _client(
    engine: Engine,
    *,
    phone_vault_available: bool = True,
) -> TestClient:
    app = create_app(
        settings=Settings(
            app_env="test",
            wechat_provider="development",
            phone_encryption_key_base64=KEY_BASE64,
            phone_encryption_key_version=KEY_VERSION,
        )
    )

    def database_override() -> Iterator[Session]:
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_database] = database_override
    phone_vault = (
        PhoneVault(
            key_base64=KEY_BASE64,
            key_version=KEY_VERSION,
        )
        if phone_vault_available
        else None
    )
    app.dependency_overrides[get_phone_vault] = lambda: phone_vault
    app.dependency_overrides[get_order_clock] = lambda: NOW
    return TestClient(app, raise_server_exceptions=False)


def _headers(*, token: str = OWNER_TOKEN, key: str = CANCEL_KEY) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Idempotency-Key": key,
    }


def test_cancel_requires_valid_bearer_and_hides_other_owners_orders(
    pg_engine: Engine,
) -> None:
    seeded = _seed_pending_order(pg_engine)
    path = f"/api/v1/orders/{seeded.order_id}/cancel"

    with _client(pg_engine) as client:
        missing_bearer = client.post(
            path,
            headers={"Idempotency-Key": CANCEL_KEY},
        )
        invalid_bearer = client.post(
            path,
            headers=_headers(token="invalid-token"),
        )
        hidden = client.post(
            path,
            headers=_headers(token=STRANGER_TOKEN),
        )
        missing_order = client.post(
            f"/api/v1/orders/{uuid.uuid4()}/cancel",
            headers=_headers(key="cancel-missing-order-00001"),
        )

    assert missing_bearer.status_code == invalid_bearer.status_code == 401
    assert missing_bearer.json()["error"]["code"] == "AUTH_REQUIRED"
    assert invalid_bearer.json()["error"]["code"] == "AUTH_REQUIRED"
    assert hidden.status_code == missing_order.status_code == 404
    assert hidden.json()["error"]["code"] == "ORDER_NOT_FOUND"
    assert missing_order.json()["error"]["code"] == "ORDER_NOT_FOUND"
    with Session(pg_engine) as session:
        assert session.scalar(select(func.count()).select_from(IdempotencyRecord)) == 0


def test_pending_order_without_payment_is_cancelled_and_releases_its_lock(
    pg_engine: Engine,
) -> None:
    seeded = _seed_pending_order(pg_engine)

    with _client(pg_engine) as client:
        response = client.post(
            f"/api/v1/orders/{seeded.order_id}/cancel",
            headers=_headers(),
        )

    assert response.status_code == 200
    assert response.json()["status"] == "CANCELLED"
    assert response.json()["expired_at"] is None
    assert response.json()["allowed_actions"] == {
        "can_pay": False,
        "can_cancel": False,
        "can_check_in": False,
        "can_complete": False,
        "can_refund": False,
        "blocked_reason": "ORDER_TERMINAL",
    }
    with Session(pg_engine) as session:
        order = session.get_one(Order, seeded.order_id)
        slot = session.get_one(Slot, seeded.slot_id)
        record = session.scalar(select(IdempotencyRecord))
        assert order.status is OrderStatus.CANCELLED
        assert order.expired_at is None
        assert order.cancel_requested_at == NOW
        assert order.cancelled_at == NOW
        assert slot.status is SlotStatus.AVAILABLE
        assert slot.locked_until is None
        assert slot.locked_by_order_id is None
        assert slot.checkout_version == seeded.checkout_version + 1
        assert record is not None
        assert record.state is IdempotencyState.COMPLETED
        assert record.operation == "cancel_order"
        assert record.response_status == 200
        assert record.response_body == response.json()
        canonical = json.dumps(
            {
                "operation": "cancel_order",
                "order_id": str(seeded.order_id),
                "version": 1,
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        assert record.request_sha256 == hashlib.sha256(canonical.encode()).hexdigest()


def test_pending_order_with_only_closed_payments_is_safe_to_cancel_locally(
    pg_engine: Engine,
) -> None:
    seeded = _seed_pending_order(pg_engine, payment_state=PaymentState.CLOSED)
    with Session(pg_engine) as session:
        order = session.get_one(Order, seeded.order_id)
        _add_payment(session, order=order, status=PaymentState.CLOSED)
        session.commit()

    with _client(pg_engine) as client:
        response = client.post(
            f"/api/v1/orders/{seeded.order_id}/cancel",
            headers=_headers(),
        )

    assert response.status_code == 200
    assert response.json()["status"] == "CANCELLED"
    assert response.json()["payment_state"] == "CLOSED"
    with Session(pg_engine) as session:
        assert session.get_one(Order, seeded.order_id).status is OrderStatus.CANCELLED
        assert session.get_one(Slot, seeded.slot_id).status is SlotStatus.AVAILABLE


@pytest.mark.parametrize(
    "payment_state",
    [
        PaymentState.CREATING,
        PaymentState.PREPAY_CREATED,
        PaymentState.CONFIRMING,
        PaymentState.UNKNOWN,
        PaymentState.SUCCESS,
    ],
)
def test_maybe_paid_pending_order_records_only_cancellation_intent(
    pg_engine: Engine,
    payment_state: PaymentState,
) -> None:
    seeded = _seed_pending_order(pg_engine, payment_state=payment_state)

    with _client(pg_engine) as client:
        response = client.post(
            f"/api/v1/orders/{seeded.order_id}/cancel",
            headers=_headers(),
        )

    assert response.status_code == 202
    assert response.json()["status"] == "PENDING_PAYMENT"
    assert response.json()["cancel_requested_at"] is not None
    assert response.json()["cancelled_at"] is None
    assert response.json()["allowed_actions"]["can_cancel"] is False
    assert (
        response.json()["allowed_actions"]["blocked_reason"]
        == "PAYMENT_RESULT_PENDING"
    )
    with Session(pg_engine) as session:
        order = session.get_one(Order, seeded.order_id)
        slot = session.get_one(Slot, seeded.slot_id)
        assert order.status is OrderStatus.PENDING_PAYMENT
        assert order.cancel_requested_at == NOW
        assert order.cancelled_at is None
        assert slot.status is SlotStatus.LOCKED
        assert slot.locked_by_order_id == order.id
        assert slot.locked_until == order.expires_at
        assert session.scalar(select(func.count()).select_from(RefundCase)) == 0
        assert session.scalar(select(func.count()).select_from(RefundAttempt)) == 0


@pytest.mark.parametrize(
    "slot_status",
    [SlotStatus.AVAILABLE, SlotStatus.BOOKED, SlotStatus.CLOSED],
)
def test_local_cancellation_never_mutates_a_slot_without_an_owned_lock(
    pg_engine: Engine,
    slot_status: SlotStatus,
) -> None:
    seeded = _seed_pending_order(pg_engine, slot_status=slot_status)

    with _client(pg_engine) as client:
        response = client.post(
            f"/api/v1/orders/{seeded.order_id}/cancel",
            headers=_headers(),
        )

    assert response.status_code == 200
    with Session(pg_engine) as session:
        order = session.get_one(Order, seeded.order_id)
        slot = session.get_one(Slot, seeded.slot_id)
        assert order.status is OrderStatus.CANCELLED
        assert slot.status is slot_status
        assert slot.locked_until is None
        assert slot.locked_by_order_id is None
        assert slot.checkout_version == seeded.checkout_version


def test_local_cancellation_never_releases_another_orders_lock(
    pg_engine: Engine,
) -> None:
    seeded = _seed_pending_order(pg_engine, another_order_owns_lock=True)
    with Session(pg_engine) as session:
        locked_by = session.get_one(Slot, seeded.slot_id).locked_by_order_id
        assert locked_by is not None
        assert locked_by != seeded.order_id

    with _client(pg_engine) as client:
        response = client.post(
            f"/api/v1/orders/{seeded.order_id}/cancel",
            headers=_headers(),
        )

    assert response.status_code == 200
    with Session(pg_engine) as session:
        order = session.get_one(Order, seeded.order_id)
        slot = session.get_one(Slot, seeded.slot_id)
        assert order.status is OrderStatus.CANCELLED
        assert slot.status is SlotStatus.LOCKED
        assert slot.locked_by_order_id == locked_by
        assert slot.checkout_version == seeded.checkout_version


def test_same_idempotency_key_replays_the_first_response_exactly(
    pg_engine: Engine,
) -> None:
    seeded = _seed_pending_order(pg_engine)

    with _client(pg_engine) as client:
        first = client.post(
            f"/api/v1/orders/{seeded.order_id}/cancel",
            headers=_headers(),
        )
        replay = client.post(
            f"/api/v1/orders/{seeded.order_id}/cancel",
            headers=_headers(),
        )

    assert first.status_code == replay.status_code == 200
    assert first.content == replay.content
    with Session(pg_engine) as session:
        assert session.scalar(select(func.count()).select_from(IdempotencyRecord)) == 1
        slot = session.get_one(Slot, seeded.slot_id)
        assert slot.checkout_version == seeded.checkout_version + 1


def test_same_idempotency_key_for_another_order_is_rejected(
    pg_engine: Engine,
) -> None:
    seeded = _seed_pending_order(pg_engine)
    other_order_id, other_slot_id = _add_second_pending_order(
        pg_engine,
        owner_id=seeded.owner_id,
    )

    with _client(pg_engine) as client:
        first = client.post(
            f"/api/v1/orders/{seeded.order_id}/cancel",
            headers=_headers(),
        )
        reused = client.post(
            f"/api/v1/orders/{other_order_id}/cancel",
            headers=_headers(),
        )

    assert first.status_code == 200
    assert reused.status_code == 409
    assert reused.json()["error"]["code"] == "IDEMPOTENCY_KEY_REUSED"
    with Session(pg_engine) as session:
        assert session.get_one(Order, other_order_id).status is OrderStatus.PENDING_PAYMENT
        other_slot = session.get_one(Slot, other_slot_id)
        assert other_slot.status is SlotStatus.LOCKED
        assert other_slot.locked_by_order_id == other_order_id
        assert session.scalar(select(func.count()).select_from(IdempotencyRecord)) == 1


def test_new_key_on_already_cancelled_order_returns_terminal_projection_once(
    pg_engine: Engine,
) -> None:
    seeded = _seed_pending_order(pg_engine)

    with _client(pg_engine) as client:
        first = client.post(
            f"/api/v1/orders/{seeded.order_id}/cancel",
            headers=_headers(),
        )
        with Session(pg_engine) as session:
            order = session.get_one(Order, seeded.order_id)
            first_transition = (order.cancel_requested_at, order.cancelled_at)
        second = client.post(
            f"/api/v1/orders/{seeded.order_id}/cancel",
            headers=_headers(key="cancel-order-new-key-000000001"),
        )

    assert first.status_code == second.status_code == 200
    assert second.json()["status"] == "CANCELLED"
    with Session(pg_engine) as session:
        order = session.get_one(Order, seeded.order_id)
        slot = session.get_one(Slot, seeded.slot_id)
        assert (order.cancel_requested_at, order.cancelled_at) == first_transition
        assert slot.checkout_version == seeded.checkout_version + 1
        assert session.scalar(select(func.count()).select_from(IdempotencyRecord)) == 2


def test_commit_failure_rolls_back_order_slot_and_idempotency_and_returns_503(
    pg_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seeded = _seed_pending_order(pg_engine)

    def fail_commit(_repository: OrderRepository) -> None:
        raise SQLAlchemyError("injected cancellation commit failure")

    monkeypatch.setattr(OrderRepository, "commit", fail_commit)
    with _client(pg_engine) as client:
        response = client.post(
            f"/api/v1/orders/{seeded.order_id}/cancel",
            headers=_headers(),
        )

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "SERVICE_UNAVAILABLE"
    with Session(pg_engine) as session:
        order = session.get_one(Order, seeded.order_id)
        slot = session.get_one(Slot, seeded.slot_id)
        assert order.status is OrderStatus.PENDING_PAYMENT
        assert order.cancel_requested_at is None
        assert order.cancelled_at is None
        assert slot.status is SlotStatus.LOCKED
        assert slot.locked_by_order_id == order.id
        assert slot.checkout_version == seeded.checkout_version
        assert session.scalar(select(func.count()).select_from(IdempotencyRecord)) == 0


def test_projection_failure_rolls_back_cancellation_and_returns_503(
    pg_engine: Engine,
) -> None:
    seeded = _seed_pending_order(pg_engine)

    with _client(pg_engine, phone_vault_available=False) as client:
        response = client.post(
            f"/api/v1/orders/{seeded.order_id}/cancel",
            headers=_headers(),
        )

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "SERVICE_UNAVAILABLE"
    with Session(pg_engine) as session:
        order = session.get_one(Order, seeded.order_id)
        slot = session.get_one(Slot, seeded.slot_id)
        assert order.status is OrderStatus.PENDING_PAYMENT
        assert order.cancel_requested_at is None
        assert order.cancelled_at is None
        assert slot.status is SlotStatus.LOCKED
        assert slot.locked_by_order_id == order.id
        assert slot.checkout_version == seeded.checkout_version
        assert session.scalar(select(func.count()).select_from(IdempotencyRecord)) == 0
