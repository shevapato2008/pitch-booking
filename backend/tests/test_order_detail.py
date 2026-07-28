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
from backend.app.models import Order, OrderStatus, Slot, SlotStatus, User, UserSession
from backend.app.modules.orders.expiry import ExpiryResult, PendingOrderExpiryService
from backend.app.modules.orders.repository import OrderRepository
from backend.app.modules.orders.service import OrderService
from backend.app.security.phone_vault import PhoneVault
from backend.tests.test_schema_constraints import add_pitch, add_slot, venue

pytestmark = pytest.mark.integration

KEY_BASE64 = base64.b64encode(bytes(range(32))).decode("ascii")
KEY_VERSION = 7
RAW_TOKEN = "order-detail-business-token-with-at-least-256-bits"
FULL_PHONE = "13812345678"


def _seed_detail(
    engine: Engine,
    *,
    expires_delta: timedelta = timedelta(minutes=5),
    prepay_id: str | None = None,
    expired_bearer: bool = False,
) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    now = datetime.now(UTC)
    with Session(engine) as session:
        owner = User(wechat_openid=f"detail-owner-{uuid.uuid4()}")
        stranger = User(wechat_openid=f"detail-stranger-{uuid.uuid4()}")
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
        owner.phone_verified_at = now
        session.add(
            UserSession(
                user=owner,
                token_hash=hashlib.sha256(RAW_TOKEN.encode()).hexdigest(),
                issued_at=now - timedelta(days=2) if expired_bearer else now,
                expires_at=(
                    now - timedelta(days=1)
                    if expired_bearer
                    else now + timedelta(days=1)
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
            now + timedelta(days=1),
            now + timedelta(days=1, hours=2),
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
            created_at=now - timedelta(minutes=1),
            expires_at=now + expires_delta,
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
    return TestClient(app, raise_server_exceptions=False)


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
    assert response.json()["contact"] == {
        "name": "张三",
        "masked_phone": "138****5678",
    }
    with Session(pg_engine) as session:
        order = session.get_one(Order, order_id)
        slot = session.get_one(Slot, order.slot_id)
        assert slot.status is SlotStatus.LOCKED
        assert slot.locked_by_order_id == order.id


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
