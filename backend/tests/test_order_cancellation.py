import ast
import base64
import hashlib
import json
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

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
    RefundAttemptStatus,
    RefundCase,
    RefundCasePurpose,
    RefundReason,
    Slot,
    SlotStatus,
    User,
    UserSession,
    Venue,
)
from backend.app.modules.auth.router import get_phone_vault
from backend.app.modules.orders.repository import OrderRepository
from backend.app.modules.orders.router import get_order_clock
from backend.app.modules.refunds.repository import (
    LockedRefundGraph,
    RefundPurposeMismatchError,
    RefundRepository,
)
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
    payment_id: uuid.UUID | None = None


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
    applied: bool = False,
    provider: str = "mock",
    currency: str = "CNY",
) -> Payment:
    payment_id = uuid.uuid4()
    row = Payment(
        id=payment_id,
        order=order,
        provider=provider,
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
        currency=currency,
        status=status,
        created_at=NOW - timedelta(minutes=4),
        paid_at=(
            NOW - timedelta(minutes=3)
            if status is PaymentState.SUCCESS
            else None
        ),
        applied_to_order_at=(
            NOW - timedelta(minutes=2)
            if applied and status is PaymentState.SUCCESS
            else None
        ),
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


def _seed_confirmed_order(
    engine: Engine,
    *,
    starts_at: datetime = NOW + timedelta(days=3),
    applied: bool = True,
    checked_in: bool = False,
    completed: bool = False,
    currency: str = "CNY",
    add_extra_success: bool = False,
) -> SeededCancellation:
    seeded = _seed_pending_order(engine)
    with Session(engine) as session:
        order = session.get_one(Order, seeded.order_id)
        slot = session.get_one(Slot, seeded.slot_id)
        slot.starts_at = starts_at
        slot.ends_at = starts_at + timedelta(hours=2)
        slot.status = SlotStatus.BOOKED
        slot.locked_until = None
        slot.locked_by_order_id = None
        order.status = OrderStatus.COMPLETED if completed else OrderStatus.CONFIRMED
        if checked_in or completed:
            order.checked_in_at = NOW - timedelta(hours=1)
            order.checked_in_by_user_id = seeded.owner_id
        if completed:
            order.completed_at = NOW
            order.completed_by_user_id = seeded.owner_id
        payment = _add_payment(
            session,
            order=order,
            status=PaymentState.SUCCESS,
            applied=applied,
            provider="wechatpay-test",
            currency=currency,
        )
        if add_extra_success:
            _add_payment(
                session,
                order=order,
                status=PaymentState.SUCCESS,
                applied=False,
                provider="wechatpay-test",
                currency=currency,
            )
        session.commit()
        return SeededCancellation(
            owner_id=seeded.owner_id,
            stranger_id=seeded.stranger_id,
            order_id=seeded.order_id,
            slot_id=seeded.slot_id,
            checkout_version=seeded.checkout_version,
            payment_id=payment.id,
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


def test_confirmed_owner_cancellation_enqueues_one_full_main_payment_refund(
    pg_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seeded = _seed_confirmed_order(pg_engine, add_extra_success=True)
    assert seeded.payment_id is not None
    predicate_calls = 0
    original_predicate = RefundRepository.purpose_is_valid

    def record_purpose_check(
        *, graph: LockedRefundGraph, purpose: RefundCasePurpose
    ) -> bool:
        nonlocal predicate_calls
        predicate_calls += 1
        return original_predicate(graph=graph, purpose=purpose)

    monkeypatch.setattr(
        RefundRepository,
        "purpose_is_valid",
        staticmethod(record_purpose_check),
    )

    with _client(pg_engine) as client:
        response = client.post(
            f"/api/v1/orders/{seeded.order_id}/cancel",
            headers=_headers(),
        )

    assert response.status_code == 202
    assert response.json()["status"] == "REFUND_PENDING"
    assert response.json()["cancel_requested_at"] is not None
    assert response.json()["cancelled_at"] is not None
    assert response.json()["allowed_actions"]["blocked_reason"] == "REFUND_IN_PROGRESS"
    assert predicate_calls >= 1
    with Session(pg_engine) as session:
        order = session.get_one(Order, seeded.order_id)
        slot = session.get_one(Slot, seeded.slot_id)
        refund_case = session.scalar(select(RefundCase))
        assert refund_case is not None
        attempt = session.scalar(
            select(RefundAttempt).where(
                RefundAttempt.refund_case_id == refund_case.id
            )
        )
        assert attempt is not None
        assert order.status is OrderStatus.REFUND_PENDING
        assert order.cancel_requested_at == NOW
        assert order.cancelled_at == NOW
        assert order.expired_at is None
        assert slot.status is SlotStatus.BOOKED
        assert slot.locked_until is None
        assert slot.locked_by_order_id is None
        assert refund_case.order_id == seeded.order_id
        assert refund_case.payment_id == seeded.payment_id
        assert refund_case.purpose is RefundCasePurpose.ORDER_CANCELLATION
        assert refund_case.reason is RefundReason.USER_CANCELLED
        assert refund_case.reason_note is None
        assert refund_case.requested_by_user_id == seeded.owner_id
        assert refund_case.amount_cents == 36000
        assert refund_case.currency == "CNY"
        assert attempt.provider == "wechatpay-test"
        assert attempt.status is RefundAttemptStatus.CREATING
        assert attempt.attempt_no == 1
        assert attempt.next_reconcile_at == NOW
        assert len(attempt.merchant_refund_no) <= 32
        assert attempt.provider_refund_no is None
        assert attempt.failure_code is None
        assert attempt.refunded_at is None
        record = session.scalar(select(IdempotencyRecord))
        assert record is not None
        assert record.state is IdempotencyState.COMPLETED
        assert record.response_status == 202
        assert record.response_body == response.json()


def test_confirmed_refund_replays_same_key_and_rejects_new_key_while_active(
    pg_engine: Engine,
) -> None:
    seeded = _seed_confirmed_order(pg_engine)

    with _client(pg_engine) as client:
        first = client.post(
            f"/api/v1/orders/{seeded.order_id}/cancel",
            headers=_headers(),
        )
        with Session(pg_engine) as session:
            first_attempt = session.scalar(select(RefundAttempt))
            assert first_attempt is not None
            first_merchant_refund_no = first_attempt.merchant_refund_no
        replay = client.post(
            f"/api/v1/orders/{seeded.order_id}/cancel",
            headers=_headers(),
        )
        active = client.post(
            f"/api/v1/orders/{seeded.order_id}/cancel",
            headers=_headers(key="cancel-order-active-new-key-0001"),
        )

    assert first.status_code == replay.status_code == 202
    assert first.content == replay.content
    assert active.status_code == 409
    assert active.json()["error"]["code"] == "REFUND_IN_PROGRESS"
    with Session(pg_engine) as session:
        assert session.scalar(select(func.count()).select_from(RefundCase)) == 1
        assert session.scalar(select(func.count()).select_from(RefundAttempt)) == 1
        assert session.scalar(select(func.count()).select_from(IdempotencyRecord)) == 1
        attempt = session.scalar(select(RefundAttempt))
        assert attempt is not None
        assert attempt.merchant_refund_no == first_merchant_refund_no


def test_confirmed_refund_replays_same_key_after_authoritative_completion(
    pg_engine: Engine,
) -> None:
    seeded = _seed_confirmed_order(pg_engine)

    with _client(pg_engine) as client:
        first = client.post(
            f"/api/v1/orders/{seeded.order_id}/cancel",
            headers=_headers(),
        )
        assert first.status_code == 202

        with Session(pg_engine) as session:
            order = session.get_one(Order, seeded.order_id)
            slot = session.get_one(Slot, seeded.slot_id)
            attempt = session.scalar(select(RefundAttempt))
            assert attempt is not None
            order.status = OrderStatus.REFUNDED
            slot.status = SlotStatus.AVAILABLE
            attempt.status = RefundAttemptStatus.SUCCESS
            attempt.provider_refund_no = "authoritative-refund-number"
            attempt.refunded_at = NOW + timedelta(minutes=1)
            attempt.next_reconcile_at = None
            session.commit()

        replay = client.post(
            f"/api/v1/orders/{seeded.order_id}/cancel",
            headers=_headers(),
        )

    assert replay.status_code == 202
    assert replay.content == first.content
    with Session(pg_engine) as session:
        assert session.get_one(Order, seeded.order_id).status is OrderStatus.REFUNDED
        assert session.get_one(Slot, seeded.slot_id).status is SlotStatus.AVAILABLE
        assert session.scalar(select(func.count()).select_from(RefundCase)) == 1
        assert session.scalar(select(func.count()).select_from(RefundAttempt)) == 1
        assert session.scalar(select(func.count()).select_from(IdempotencyRecord)) == 1


def test_failed_owner_refund_retries_in_the_same_case_without_mutating_attempt_one(
    pg_engine: Engine,
) -> None:
    seeded = _seed_confirmed_order(pg_engine)
    with _client(pg_engine) as client:
        first = client.post(
            f"/api/v1/orders/{seeded.order_id}/cancel",
            headers=_headers(),
        )
    assert first.status_code == 202

    with Session(pg_engine) as session:
        refund_case = session.scalar(select(RefundCase))
        first_attempt = session.scalar(select(RefundAttempt))
        assert refund_case is not None
        assert first_attempt is not None
        case_id = refund_case.id
        first_number = first_attempt.merchant_refund_no
        first_attempt.status = RefundAttemptStatus.FAILED
        first_attempt.failure_code = "PROVIDER_REJECTED"
        first_attempt.provider_refund_no = "provider-terminal-failure"
        first_attempt.next_reconcile_at = None
        order = session.get_one(Order, seeded.order_id)
        order.status = OrderStatus.REFUND_FAILED
        session.commit()

    with _client(pg_engine) as client:
        retried = client.post(
            f"/api/v1/orders/{seeded.order_id}/cancel",
            headers=_headers(key="cancel-order-retry-new-key-0001"),
        )

    assert retried.status_code == 202
    assert retried.json()["status"] == "REFUND_PENDING"
    with Session(pg_engine) as session:
        assert session.scalar(select(func.count()).select_from(RefundCase)) == 1
        refund_case = session.get_one(RefundCase, case_id)
        assert refund_case.reason is RefundReason.USER_CANCELLED
        assert refund_case.requested_by_user_id == seeded.owner_id
        attempts = list(
            session.scalars(select(RefundAttempt).order_by(RefundAttempt.attempt_no))
        )
        assert [attempt.attempt_no for attempt in attempts] == [1, 2]
        assert attempts[0].status is RefundAttemptStatus.FAILED
        assert attempts[0].merchant_refund_no == first_number
        assert attempts[0].failure_code == "PROVIDER_REJECTED"
        assert attempts[0].provider_refund_no == "provider-terminal-failure"
        assert attempts[0].refunded_at is None
        assert attempts[1].status is RefundAttemptStatus.CREATING
        assert attempts[1].merchant_refund_no != first_number
        assert len(attempts[1].merchant_refund_no) <= 32
        assert attempts[1].provider == "wechatpay-test"
        assert attempts[1].provider_refund_no is None
        assert attempts[1].failure_code is None
        assert attempts[1].refunded_at is None
        assert session.get_one(Order, seeded.order_id).status is OrderStatus.REFUND_PENDING
        assert session.get_one(Slot, seeded.slot_id).status is SlotStatus.BOOKED


@pytest.mark.parametrize(
    "active_status",
    [
        RefundAttemptStatus.CREATING,
        RefundAttemptStatus.PROCESSING,
        RefundAttemptStatus.UNKNOWN,
    ],
)
def test_active_owner_refund_attempt_is_never_retried(
    pg_engine: Engine,
    active_status: RefundAttemptStatus,
) -> None:
    seeded = _seed_confirmed_order(pg_engine)
    with _client(pg_engine) as client:
        first = client.post(
            f"/api/v1/orders/{seeded.order_id}/cancel",
            headers=_headers(),
        )
    assert first.status_code == 202
    with Session(pg_engine) as session:
        attempt = session.scalar(select(RefundAttempt))
        assert attempt is not None
        attempt.status = active_status
        attempt.provider_refund_no = f"provider-{active_status.value.lower()}"
        original = (
            attempt.id,
            attempt.merchant_refund_no,
            attempt.provider_refund_no,
            attempt.failure_code,
            attempt.refunded_at,
        )
        session.commit()

    with _client(pg_engine) as client:
        response = client.post(
            f"/api/v1/orders/{seeded.order_id}/cancel",
            headers=_headers(key=f"cancel-order-active-{active_status.value.lower()}-key"),
        )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "REFUND_IN_PROGRESS"
    with Session(pg_engine) as session:
        attempts = list(session.scalars(select(RefundAttempt)))
        assert len(attempts) == 1
        attempt = attempts[0]
        assert (
            attempt.id,
            attempt.merchant_refund_no,
            attempt.provider_refund_no,
            attempt.failure_code,
            attempt.refunded_at,
        ) == original


@pytest.mark.parametrize("ineligible", ["inside-window", "checked-in", "completed"])
def test_owner_refund_rejects_ineligible_order_states(
    pg_engine: Engine,
    ineligible: str,
) -> None:
    if ineligible == "inside-window":
        seeded = _seed_confirmed_order(
            pg_engine,
            starts_at=NOW + timedelta(hours=24) - timedelta(microseconds=1),
        )
    elif ineligible == "checked-in":
        seeded = _seed_confirmed_order(pg_engine, checked_in=True)
    else:
        seeded = _seed_confirmed_order(pg_engine, completed=True)

    with _client(pg_engine) as client:
        response = client.post(
            f"/api/v1/orders/{seeded.order_id}/cancel",
            headers=_headers(),
        )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "ORDER_STATE_CHANGED"
    with Session(pg_engine) as session:
        assert session.scalar(select(func.count()).select_from(RefundCase)) == 0
        assert session.scalar(select(func.count()).select_from(RefundAttempt)) == 0
        assert session.scalar(select(func.count()).select_from(IdempotencyRecord)) == 0
        assert session.get_one(Slot, seeded.slot_id).status is SlotStatus.BOOKED


def test_confirmed_cancellation_hides_non_owner_without_refund_writes(
    pg_engine: Engine,
) -> None:
    seeded = _seed_confirmed_order(pg_engine)

    with _client(pg_engine) as client:
        response = client.post(
            f"/api/v1/orders/{seeded.order_id}/cancel",
            headers=_headers(token=STRANGER_TOKEN),
        )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "ORDER_NOT_FOUND"
    with Session(pg_engine) as session:
        assert session.scalar(select(func.count()).select_from(RefundCase)) == 0
        assert session.scalar(select(func.count()).select_from(RefundAttempt)) == 0
        assert session.scalar(select(func.count()).select_from(IdempotencyRecord)) == 0
        assert session.get_one(Order, seeded.order_id).status is OrderStatus.CONFIRMED


def test_confirmed_cancellation_rejects_a_success_payment_that_is_not_main(
    pg_engine: Engine,
) -> None:
    seeded = _seed_confirmed_order(pg_engine, applied=False)

    with _client(pg_engine) as client:
        response = client.post(
            f"/api/v1/orders/{seeded.order_id}/cancel",
            headers=_headers(),
        )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "ORDER_STATE_CHANGED"
    with Session(pg_engine) as session:
        assert session.scalar(select(func.count()).select_from(RefundCase)) == 0
        assert session.scalar(select(func.count()).select_from(RefundAttempt)) == 0
        assert session.scalar(select(func.count()).select_from(IdempotencyRecord)) == 0
        assert session.get_one(Order, seeded.order_id).status is OrderStatus.CONFIRMED


def test_confirmed_cancellation_rejects_a_corrupted_multiple_main_graph(
    pg_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seeded = _seed_confirmed_order(pg_engine, add_extra_success=True)
    original_lock = RefundRepository.lock_refund_graph
    graph_calls = 0

    def corrupt_graph(
        repository: RefundRepository,
        payment_id: uuid.UUID,
    ) -> LockedRefundGraph:
        nonlocal graph_calls
        graph_calls += 1
        graph = original_lock(repository, payment_id)
        extra = next(payment for payment in graph.payments if payment.id != payment_id)
        repository.session.expunge(extra)
        extra.applied_to_order_at = NOW
        return graph

    monkeypatch.setattr(RefundRepository, "lock_refund_graph", corrupt_graph)
    with _client(pg_engine) as client:
        response = client.post(
            f"/api/v1/orders/{seeded.order_id}/cancel",
            headers=_headers(),
        )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "ORDER_STATE_CHANGED"
    assert graph_calls == 1
    with Session(pg_engine) as session:
        payments = list(
            session.scalars(select(Payment).where(Payment.order_id == seeded.order_id))
        )
        assert sum(payment.applied_to_order_at is not None for payment in payments) == 1
        assert session.scalar(select(func.count()).select_from(RefundCase)) == 0
        assert session.scalar(select(func.count()).select_from(RefundAttempt)) == 0
        assert session.scalar(select(func.count()).select_from(IdempotencyRecord)) == 0


def test_refund_enqueue_database_error_rolls_back_the_whole_owner_command(
    pg_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seeded = _seed_confirmed_order(pg_engine)

    def fail_commit(_repository: OrderRepository) -> None:
        raise SQLAlchemyError("private durable enqueue failure")

    monkeypatch.setattr(OrderRepository, "commit", fail_commit)
    with _client(pg_engine) as client:
        response = client.post(
            f"/api/v1/orders/{seeded.order_id}/cancel",
            headers=_headers(),
        )

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "SERVICE_UNAVAILABLE"
    assert "private durable" not in response.text
    with Session(pg_engine) as session:
        order = session.get_one(Order, seeded.order_id)
        assert order.status is OrderStatus.CONFIRMED
        assert order.cancel_requested_at is None
        assert order.cancelled_at is None
        assert session.get_one(Slot, seeded.slot_id).status is SlotStatus.BOOKED
        assert session.scalar(select(func.count()).select_from(RefundCase)) == 0
        assert session.scalar(select(func.count()).select_from(RefundAttempt)) == 0
        assert session.scalar(select(func.count()).select_from(IdempotencyRecord)) == 0


def test_refund_purpose_mismatch_rolls_back_and_uses_the_closed_409_error(
    pg_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seeded = _seed_confirmed_order(pg_engine)

    def reject_purpose(*_args: object, **_kwargs: object) -> object:
        raise RefundPurposeMismatchError("private purpose mismatch")

    monkeypatch.setattr(RefundRepository, "get_or_create_case", reject_purpose)
    with _client(pg_engine) as client:
        response = client.post(
            f"/api/v1/orders/{seeded.order_id}/cancel",
            headers=_headers(),
        )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "ORDER_STATE_CHANGED"
    assert "private purpose" not in response.text
    with Session(pg_engine) as session:
        order = session.get_one(Order, seeded.order_id)
        assert order.status is OrderStatus.CONFIRMED
        assert order.cancel_requested_at is None
        assert order.cancelled_at is None
        assert session.scalar(select(func.count()).select_from(RefundCase)) == 0
        assert session.scalar(select(func.count()).select_from(RefundAttempt)) == 0
        assert session.scalar(select(func.count()).select_from(IdempotencyRecord)) == 0


def test_refund_graph_change_rolls_back_and_uses_the_closed_409_error(
    pg_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seeded = _seed_confirmed_order(pg_engine)

    def missing_payment(*_args: object, **_kwargs: object) -> object:
        raise LookupError("private successful payment disappeared")

    monkeypatch.setattr(RefundRepository, "lock_refund_graph", missing_payment)
    with _client(pg_engine) as client:
        response = client.post(
            f"/api/v1/orders/{seeded.order_id}/cancel",
            headers=_headers(),
        )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "ORDER_STATE_CHANGED"
    assert "private successful" not in response.text
    with Session(pg_engine) as session:
        assert session.get_one(Order, seeded.order_id).status is OrderStatus.CONFIRMED
        assert session.scalar(select(func.count()).select_from(RefundCase)) == 0
        assert session.scalar(select(func.count()).select_from(RefundAttempt)) == 0
        assert session.scalar(select(func.count()).select_from(IdempotencyRecord)) == 0


def test_owner_cancellation_module_only_enqueues_refund_work() -> None:
    source = Path("backend/app/modules/orders/cancellation.py").read_text()
    tree = ast.parse(source)
    imported_modules = {
        alias.name
        for node in ast.walk(tree)
        if isinstance(node, ast.Import)
        for alias in node.names
    } | {
        node.module or ""
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom)
    }
    called_attributes = {
        node.func.attr
        for node in ast.walk(tree)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
    }
    assert not any(name.endswith(".provider") for name in imported_modules)
    assert not any(name.endswith(".convergence") for name in imported_modules)
    assert {"create_refund", "query_refund"}.isdisjoint(called_attributes)
