import base64
import hashlib
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session

from backend.app.config import Settings
from backend.app.database import get_database
from backend.app.main import create_app
from backend.app.models import (
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
)
from backend.app.modules.orders.expiry import ExpiryResult, PendingOrderExpiryService
from backend.app.modules.orders.repository import OrderRepository
from backend.app.modules.orders.router import get_order_clock
from backend.app.modules.orders.service import OrderService
from backend.app.security.phone_vault import PhoneVault
from backend.tests.test_schema_constraints import add_pitch, add_slot, venue

pytestmark = pytest.mark.integration

KEY_BASE64 = base64.b64encode(bytes(range(32))).decode("ascii")
KEY_VERSION = 7
RAW_TOKEN = "order-detail-business-token-with-at-least-256-bits"
FULL_PHONE = "13812345678"
NOW = datetime(2026, 8, 18, 5, tzinfo=UTC)
APPROVED_CANCELLATION_SUMMARY = (
    "开场前至少 24 小时可自助取消并全额退款；不足 24 小时请联系客服。"
)


def _seed_detail(
    engine: Engine,
    *,
    expires_delta: timedelta = timedelta(minutes=5),
    prepay_id: str | None = None,
    expired_bearer: bool = False,
) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    auth_now = datetime.now(UTC)
    with Session(engine) as session:
        owner = User(
            wechat_app_id="wx-test-app",
            wechat_openid=f"detail-owner-{uuid.uuid4()}",
        )
        stranger = User(
            wechat_app_id="wx-test-app",
            wechat_openid=f"detail-stranger-{uuid.uuid4()}",
        )
        session.add_all((owner, stranger))
        session.flush()
        sealed = PhoneVault(key_base64=KEY_BASE64, key_version=KEY_VERSION).encrypt(
            FULL_PHONE,
            record_type="user",
            record_id=owner.id,
            field="phone",
        )
        owner.phone_ciphertext = sealed.ciphertext_with_tag
        owner.phone_nonce = sealed.nonce
        owner.phone_key_version = sealed.key_version
        owner.phone_verified_at = NOW
        session.add(
            UserSession(
                user=owner,
                token_hash=hashlib.sha256(RAW_TOKEN.encode()).hexdigest(),
                issued_at=(
                    auth_now - timedelta(days=2) if expired_bearer else auth_now
                ),
                expires_at=(
                    auth_now - timedelta(days=1)
                    if expired_bearer
                    else auth_now + timedelta(days=1)
                ),
            )
        )
        parent = venue(
            timezone="Asia/Shanghai",
            refund_policy_text="开场前 24 小时可免费取消",
        )
        pitch = add_pitch(session, parent)
        slot = add_slot(
            session,
            pitch,
            NOW + timedelta(days=1),
            NOW + timedelta(days=1, hours=2),
            checkout_version=4,
        )
        order = Order(
            id=uuid.uuid4(),
            order_number=f"PB-{uuid.uuid4().hex}",
            user=owner,
            slot=slot,
            status=OrderStatus.PENDING_PAYMENT,
            price_cents=32000,
            contact_name="张三",
            contact_phone_ciphertext=b"temporary-encrypted-value",
            contact_phone_nonce=b"abcdefghijkl",
            contact_phone_key_version=1,
            created_at=NOW - timedelta(minutes=1),
            expires_at=NOW + expires_delta,
            wechat_prepay_id=prepay_id,
        )
        session.add(order)
        session.flush()
        snapshot = PhoneVault(key_base64=KEY_BASE64, key_version=KEY_VERSION).encrypt(
            FULL_PHONE,
            record_type="order",
            record_id=order.id,
            field="contact_phone",
        )
        order.contact_phone_ciphertext = snapshot.ciphertext_with_tag
        order.contact_phone_nonce = snapshot.nonce
        order.contact_phone_key_version = snapshot.key_version
        slot.status = SlotStatus.LOCKED
        slot.locked_until = order.expires_at
        slot.locked_by_order_id = order.id
        if prepay_id is not None:
            session.add(
                Payment(
                    order=order,
                    provider="mock",
                    merchant_order_no=f"M-{uuid.uuid4().hex}",
                    provider_prepay_id=prepay_id,
                    amount_cents=order.price_cents,
                    currency="CNY",
                    status=PaymentState.PREPAY_CREATED,
                )
            )
        session.commit()
        return order.id, owner.id, stranger.id


def _client(engine: Engine) -> TestClient:
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
    app.dependency_overrides[get_order_clock] = lambda: NOW
    return TestClient(app, raise_server_exceptions=False)


def _add_payment(
    session: Session,
    order: Order,
    *,
    status: PaymentState,
    paid_at: datetime | None = None,
    applied: bool = False,
) -> Payment:
    payment_id = uuid.uuid4()
    payment = Payment(
        id=payment_id,
        order=order,
        provider="mock",
        merchant_order_no=f"PB{payment_id.hex[:30]}",
        provider_prepay_id=(
            f"wx-{payment_id.hex}"
            if status not in {PaymentState.CREATING, PaymentState.CLOSED}
            else None
        ),
        provider_transaction_no=(
            f"txn-{payment_id.hex}" if status is PaymentState.SUCCESS else None
        ),
        amount_cents=order.price_cents,
        currency="CNY",
        status=status,
        created_at=NOW - timedelta(minutes=20),
        paid_at=paid_at if status is PaymentState.SUCCESS else None,
        applied_to_order_at=paid_at if applied else None,
    )
    session.add(payment)
    session.flush()
    return payment


def _add_refund_case(
    session: Session,
    *,
    order: Order,
    payment: Payment,
    purpose: RefundCasePurpose,
    created_at: datetime,
) -> RefundCase:
    refund_case = RefundCase(
        id=uuid.uuid4(),
        order=order,
        payment=payment,
        purpose=purpose,
        reason=RefundReason.AUTOMATIC_RECOVERY,
        reason_note=None,
        requested_by_user_id=None,
        amount_cents=payment.amount_cents,
        currency=payment.currency,
        created_at=created_at,
        updated_at=created_at,
    )
    session.add(refund_case)
    session.flush()
    return refund_case


def _add_refund_attempt(
    session: Session,
    *,
    refund_case: RefundCase,
    attempt_no: int,
    status: RefundAttemptStatus,
) -> RefundAttempt:
    attempt_id = uuid.uuid4()
    attempt = RefundAttempt(
        id=attempt_id,
        refund_case=refund_case,
        provider="mock",
        merchant_refund_no=f"RF{attempt_id.hex[:30]}",
        provider_refund_no=(
            f"provider-{attempt_id.hex}"
            if status is RefundAttemptStatus.SUCCESS
            else None
        ),
        status=status,
        attempt_no=attempt_no,
        failure_code="DECLINED" if status is RefundAttemptStatus.FAILED else None,
        refunded_at=NOW if status is RefundAttemptStatus.SUCCESS else None,
        created_at=NOW + timedelta(seconds=attempt_no),
        updated_at=NOW + timedelta(seconds=attempt_no),
    )
    session.add(attempt)
    session.flush()
    return attempt


def _auth() -> dict[str, str]:
    return {"Authorization": f"Bearer {RAW_TOKEN}"}


def test_order_detail_declares_frozen_public_contract() -> None:
    document = create_app(
        settings=Settings(app_env="test", wechat_provider="development")
    ).openapi()

    operation = document["paths"]["/api/v1/orders/{order_id}"]["get"]

    assert set(operation["responses"]) == {"200", "401", "404", "422"}
    assert operation["responses"]["200"]["content"]["application/json"]["schema"][
        "$ref"
    ].endswith("/OrderDetailResponse")


def test_order_detail_requires_valid_unexpired_bearer(pg_engine: Engine) -> None:
    order_id, _, _ = _seed_detail(pg_engine)
    with _client(pg_engine) as client:
        missing = client.get(f"/api/v1/orders/{order_id}")
        invalid = client.get(
            f"/api/v1/orders/{order_id}",
            headers={"Authorization": "Bearer invalid"},
        )

    assert missing.status_code == invalid.status_code == 401
    assert missing.json()["error"]["code"] == "AUTH_REQUIRED"
    assert invalid.json()["error"]["code"] == "AUTH_REQUIRED"


def test_order_detail_rejects_expired_bearer(pg_engine: Engine) -> None:
    order_id, _, _ = _seed_detail(pg_engine, expired_bearer=True)
    with _client(pg_engine) as client:
        response = client.get(f"/api/v1/orders/{order_id}", headers=_auth())

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_REQUIRED"


def test_order_detail_hides_missing_and_other_users_orders_as_404(
    pg_engine: Engine,
) -> None:
    order_id, _, stranger_id = _seed_detail(pg_engine)
    stranger_token = f"stranger-{uuid.uuid4()}"
    with Session(pg_engine) as session:
        session.add(
            UserSession(
                user_id=stranger_id,
                token_hash=hashlib.sha256(stranger_token.encode()).hexdigest(),
                issued_at=datetime.now(UTC),
                expires_at=datetime.now(UTC) + timedelta(days=1),
            )
        )
        session.commit()

    with _client(pg_engine) as client:
        hidden = client.get(
            f"/api/v1/orders/{order_id}",
            headers={"Authorization": f"Bearer {stranger_token}"},
        )
        missing = client.get(f"/api/v1/orders/{uuid.uuid4()}", headers=_auth())

    assert hidden.status_code == missing.status_code == 404
    assert hidden.json()["error"]["code"] == "ORDER_NOT_FOUND"
    assert missing.json()["error"]["code"] == "ORDER_NOT_FOUND"


def test_pending_detail_before_deadline_keeps_lock(pg_engine: Engine) -> None:
    order_id, _, _ = _seed_detail(pg_engine)
    with _client(pg_engine) as client:
        response = client.get(f"/api/v1/orders/{order_id}", headers=_auth())

    assert response.status_code == 200
    assert response.json()["status"] == "PENDING_PAYMENT"
    assert response.json()["closing_payment"] is False
    assert response.json()["expired_at"] is None
    assert response.json()["cancel_requested_at"] is None
    assert response.json()["cancelled_at"] is None
    assert response.json()["checked_in_at"] is None
    assert response.json()["completed_at"] is None
    assert response.json()["allowed_actions"] == {
        "can_pay": True,
        "can_cancel": True,
        "can_check_in": False,
        "can_complete": False,
        "can_refund": False,
        "blocked_reason": None,
    }
    assert response.json()["funding_alerts"] == []
    assert (
        response.json()["cancellation_summary"] == APPROVED_CANCELLATION_SUMMARY
    )
    assert response.json()["contact"] == {
        "name": "张三",
        "masked_phone": "138****5678",
    }
    assert set(response.json()["venue"]) == {
        "id",
        "name",
        "address",
        "latitude",
        "longitude",
    }
    assert "customer_service_phone" not in response.text
    with Session(pg_engine) as session:
        order = session.get_one(Order, order_id)
        slot = session.get_one(Slot, order.slot_id)
        assert slot.status is SlotStatus.LOCKED
        assert slot.locked_by_order_id == order.id


@pytest.mark.parametrize(
    ("payment_state", "may_exist"),
    [
        (PaymentState.CREATING, True),
        (PaymentState.PREPAY_CREATED, True),
        (PaymentState.CONFIRMING, True),
        (PaymentState.UNKNOWN, True),
        (PaymentState.SUCCESS, True),
        (PaymentState.CLOSED, False),
    ],
)
def test_detail_payment_may_exist_uses_the_closed_authority_set(
    pg_engine: Engine,
    payment_state: PaymentState,
    may_exist: bool,
) -> None:
    order_id, _, _ = _seed_detail(pg_engine)
    with Session(pg_engine) as session:
        order = session.get_one(Order, order_id)
        _add_payment(
            session,
            order,
            status=payment_state,
            paid_at=NOW - timedelta(minutes=1),
        )
        session.commit()

    with _client(pg_engine) as client:
        response = client.get(f"/api/v1/orders/{order_id}", headers=_auth())

    assert response.status_code == 200
    actions = response.json()["allowed_actions"]
    if may_exist:
        assert actions == {
            "can_pay": False,
            "can_cancel": False,
            "can_check_in": False,
            "can_complete": False,
            "can_refund": False,
            "blocked_reason": "PAYMENT_RESULT_PENDING",
        }
    else:
        assert actions == {
            "can_pay": True,
            "can_cancel": True,
            "can_check_in": False,
            "can_complete": False,
            "can_refund": False,
            "blocked_reason": None,
        }


def test_detail_uses_only_applied_success_as_primary_and_projects_closed_alerts(
    pg_engine: Engine,
) -> None:
    order_id, _, _ = _seed_detail(pg_engine)
    main_paid_at = NOW - timedelta(minutes=30)
    extra_paid_at = NOW - timedelta(minutes=1)
    expected_alert_statuses = [
        "REFUND_PENDING",
        "REFUND_FAILED",
        "REFUND_PENDING",
        "REFUNDED",
    ]
    with Session(pg_engine) as session:
        order = session.get_one(Order, order_id)
        order.status = OrderStatus.REFUND_PENDING
        order.cancel_requested_at = NOW - timedelta(minutes=10)
        order.cancelled_at = NOW - timedelta(minutes=9)
        order.slot.status = SlotStatus.BOOKED
        order.slot.locked_until = None
        order.slot.locked_by_order_id = None

        main = _add_payment(
            session,
            order,
            status=PaymentState.SUCCESS,
            paid_at=main_paid_at,
            applied=True,
        )
        controlling = _add_refund_case(
            session,
            order=order,
            payment=main,
            purpose=RefundCasePurpose.ORDER_CANCELLATION,
            created_at=NOW - timedelta(minutes=8),
        )
        _add_refund_attempt(
            session,
            refund_case=controlling,
            attempt_no=1,
            status=RefundAttemptStatus.PROCESSING,
        )

        cases: list[RefundCase] = []
        for index in range(4):
            extra = _add_payment(
                session,
                order,
                status=PaymentState.SUCCESS,
                paid_at=extra_paid_at + timedelta(seconds=index),
            )
            cases.append(
                _add_refund_case(
                    session,
                    order=order,
                    payment=extra,
                    purpose=RefundCasePurpose.DUPLICATE_CHARGE,
                    created_at=NOW + timedelta(minutes=index),
                )
            )
        _add_refund_attempt(
            session,
            refund_case=cases[1],
            attempt_no=1,
            status=RefundAttemptStatus.FAILED,
        )
        _add_refund_attempt(
            session,
            refund_case=cases[2],
            attempt_no=1,
            status=RefundAttemptStatus.UNKNOWN,
        )
        _add_refund_attempt(
            session,
            refund_case=cases[3],
            attempt_no=1,
            status=RefundAttemptStatus.FAILED,
        )
        _add_refund_attempt(
            session,
            refund_case=cases[3],
            attempt_no=2,
            status=RefundAttemptStatus.SUCCESS,
        )
        session.commit()

    with _client(pg_engine) as client:
        response = client.get(f"/api/v1/orders/{order_id}", headers=_auth())

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "REFUND_PENDING"
    assert datetime.fromisoformat(body["paid_at"]) == main_paid_at
    assert body["allowed_actions"] == {
        "can_pay": False,
        "can_cancel": False,
        "can_check_in": False,
        "can_complete": False,
        "can_refund": False,
        "blocked_reason": "REFUND_IN_PROGRESS",
    }
    assert body["funding_alerts"] == [
        {"code": "DUPLICATE_CHARGE_REFUND", "status": status}
        for status in expected_alert_statuses
    ]
    assert body["cancellation_summary"] == APPROVED_CANCELLATION_SUMMARY
    serialized = response.text
    for forbidden in (
        "refund_case_id",
        "refund_attempt_id",
        "payment_id",
        "provider_refund_no",
        "merchant_order_no",
        "merchant_refund_no",
        "amount_cents",
    ):
        assert forbidden not in serialized


def test_post_deadline_detail_commits_safe_expiry_before_reporting_it(
    pg_engine: Engine,
) -> None:
    order_id, _, _ = _seed_detail(pg_engine, expires_delta=-timedelta(seconds=1))
    with _client(pg_engine) as client:
        response = client.get(f"/api/v1/orders/{order_id}", headers=_auth())

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "EXPIRED"
    assert body["closing_payment"] is False
    assert datetime.fromisoformat(body["expired_at"]) > datetime.fromisoformat(
        body["expires_at"]
    )
    with Session(pg_engine) as session:
        order = session.get_one(Order, order_id)
        slot = session.get_one(Slot, order.slot_id)
        assert order.status is OrderStatus.EXPIRED
        assert order.expired_at == datetime.fromisoformat(body["expired_at"])
        assert slot.status is SlotStatus.AVAILABLE
        assert slot.locked_by_order_id is None


def test_post_deadline_prepay_order_stays_locked_and_reports_closing(
    pg_engine: Engine,
) -> None:
    order_id, _, _ = _seed_detail(
        pg_engine,
        expires_delta=-timedelta(seconds=1),
        prepay_id="wx-prepay-123",
    )
    with _client(pg_engine) as client:
        response = client.get(f"/api/v1/orders/{order_id}", headers=_auth())

    assert response.status_code == 200
    assert response.json()["status"] == "PENDING_PAYMENT"
    assert response.json()["closing_payment"] is True
    with Session(pg_engine) as session:
        order = session.get_one(Order, order_id)
        slot = session.get_one(Slot, order.slot_id)
        assert order.expired_at is None
        assert slot.status is SlotStatus.LOCKED
        assert slot.locked_by_order_id == order.id


class _FailingExpiry(PendingOrderExpiryService):
    def expire_by_order_id(
        self,
        session: Session,
        order_id: uuid.UUID,
        now: datetime,
    ) -> ExpiryResult:
        raise RuntimeError("injected expiry failure")


def test_processing_failure_rolls_back_and_returns_honest_closing_state(
    pg_engine: Engine,
) -> None:
    order_id, owner_id, _ = _seed_detail(
        pg_engine, expires_delta=-timedelta(seconds=1)
    )
    with Session(pg_engine) as session:
        result = OrderService(
            repository=OrderRepository(session),
            phone_vault=PhoneVault(key_base64=KEY_BASE64, key_version=KEY_VERSION),
            expiry_service=_FailingExpiry(),
            now=lambda: NOW,
        ).get_order_detail(user_id=owner_id, order_id=order_id)

    assert result.status is OrderStatus.PENDING_PAYMENT
    assert result.closing_payment is True
    with Session(pg_engine) as session:
        order = session.get_one(Order, order_id)
        slot = session.get_one(Slot, order.slot_id)
        assert order.status is OrderStatus.PENDING_PAYMENT
        assert order.expired_at is None
        assert slot.status is SlotStatus.LOCKED


def test_repeated_detail_converges_on_persisted_expired_state(pg_engine: Engine) -> None:
    order_id, _, _ = _seed_detail(pg_engine, expires_delta=-timedelta(seconds=1))
    with _client(pg_engine) as client:
        first = client.get(f"/api/v1/orders/{order_id}", headers=_auth())
        second = client.get(f"/api/v1/orders/{order_id}", headers=_auth())

    assert first.status_code == second.status_code == 200
    assert first.json() == second.json()
    assert second.json()["status"] == "EXPIRED"
    with Session(pg_engine) as session:
        persisted = session.get_one(Order, order_id)
        assert persisted.expired_at == datetime.fromisoformat(second.json()["expired_at"])
        slot_id = session.scalar(select(Order.slot_id).where(Order.id == order_id))
        slot = session.get_one(Slot, slot_id)
        assert slot.checkout_version == 5
