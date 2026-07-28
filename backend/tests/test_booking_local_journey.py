import base64
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session

from backend.app.config import Settings
from backend.app.database import get_database
from backend.app.main import create_app
from backend.app.models import (
    IdempotencyRecord,
    IdempotencyState,
    Order,
    OrderStatus,
    Slot,
    SlotStatus,
    User,
)
from backend.app.modules.orders import router as orders_router_module
from backend.app.security.phone_vault import PhoneVault, SealedPhone
from scripts.seed_demo import run_seed

pytestmark = pytest.mark.integration

KEY_BASE64 = base64.b64encode(bytes(32)).decode("ascii")
KEY_VERSION = 1
IDEMPOTENCY_KEY = "local-journey-order-key-0001"


def _client(engine: Engine) -> tuple[FastAPI, TestClient]:
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
    return app, TestClient(app, raise_server_exceptions=False)


def test_order_clock_defaults_to_an_aware_utc_timestamp() -> None:
    now = orders_router_module.get_order_clock()

    assert now.tzinfo is UTC
    assert now.utcoffset() == timedelta(0)


def test_local_development_provider_booking_journey_is_transactional_and_expires_safely(
    pg_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("APP_ENV", "test")
    seed_now = datetime.now(UTC)
    run_seed(
        anchor="today",
        days=1,
        database_url=pg_engine.url.render_as_string(hide_password=False),
        now=seed_now,
    )
    with Session(pg_engine) as session:
        slot = session.scalar(
            select(Slot)
            .where(Slot.status == SlotStatus.AVAILABLE, Slot.starts_at > seed_now)
            .order_by(Slot.starts_at, Slot.id)
            .limit(1)
        )
        assert slot is not None
        slot_id = slot.id
        seeded_price = slot.price_cents

    app, client = _client(pg_engine)
    with client:
        session_response = client.post(
            "/api/v1/auth/wechat/session",
            json={"code": "dev-login-code"},
        )
        assert session_response.status_code == 200
        token = session_response.json()["session_token"]
        auth = {"Authorization": f"Bearer {token}"}

        phone_response = client.post(
            "/api/v1/auth/wechat/phone",
            headers=auth,
            json={"code": "dev-phone-code"},
        )
        assert phone_response.status_code == 200
        assert phone_response.json()["masked_phone"] == "138****5678"

        checkout = client.get(f"/api/v1/slots/{slot_id}/checkout", headers=auth)
        assert checkout.status_code == 200
        checkout_body = checkout.json()
        assert checkout_body["price_cents"] == seeded_price

        request_body = {
            "slot_id": str(slot_id),
            "checkout_version": checkout_body["checkout_version"],
            "contact_name": "  张三  ",
        }
        create = client.post(
            "/api/v1/orders",
            headers={**auth, "Idempotency-Key": IDEMPOTENCY_KEY},
            json=request_body,
        )
        replay = client.post(
            "/api/v1/orders",
            headers={**auth, "Idempotency-Key": IDEMPOTENCY_KEY},
            json=request_body,
        )
        assert create.status_code == replay.status_code == 201
        assert create.content == replay.content
        created_body = create.json()
        order_id = uuid.UUID(created_body["id"])

        pending_detail = client.get(f"/api/v1/orders/{order_id}", headers=auth)
        assert pending_detail.status_code == 200
        assert pending_detail.json()["status"] == "PENDING_PAYMENT"

    vault = PhoneVault(key_base64=KEY_BASE64, key_version=KEY_VERSION)
    with Session(pg_engine) as session:
        assert session.scalar(select(func.count()).select_from(Order)) == 1
        assert session.scalar(select(func.count()).select_from(IdempotencyRecord)) == 1
        order = session.get_one(Order, order_id)
        slot = session.get_one(Slot, slot_id)
        user = session.get_one(User, order.user_id)
        record = session.scalar(select(IdempotencyRecord))
        assert record is not None
        assert record.state is IdempotencyState.COMPLETED
        assert record.response_status == 201
        assert record.response_body == created_body
        assert order.price_cents == seeded_price
        assert order.contact_name == "张三"
        assert slot.status is SlotStatus.LOCKED
        assert slot.locked_by_order_id == order.id
        assert slot.locked_until == order.expires_at
        assert user.phone_ciphertext is not None
        assert user.phone_nonce is not None
        assert user.phone_key_version is not None
        assert vault.decrypt(
            SealedPhone(
                user.phone_ciphertext,
                user.phone_nonce,
                user.phone_key_version,
            ),
            record_type="user",
            record_id=user.id,
            field="phone",
        ) == "13812345678"
        assert vault.decrypt(
            SealedPhone(
                order.contact_phone_ciphertext,
                order.contact_phone_nonce,
                order.contact_phone_key_version,
            ),
            record_type="order",
            record_id=order.id,
            field="contact_phone",
        ) == "13812345678"
        forced_now = order.expires_at + timedelta(microseconds=1)

    clock_dependency = orders_router_module.get_order_clock
    app.dependency_overrides[clock_dependency] = lambda: forced_now
    try:
        with client:
            expired_detail = client.get(f"/api/v1/orders/{order_id}", headers=auth)
        assert expired_detail.status_code == 200
        assert expired_detail.json()["status"] == "EXPIRED"
        assert datetime.fromisoformat(expired_detail.json()["expired_at"]) == forced_now
    finally:
        app.dependency_overrides.pop(clock_dependency, None)

    with Session(pg_engine) as session:
        order = session.get_one(Order, order_id)
        slot = session.get_one(Slot, slot_id)
        assert order.status is OrderStatus.EXPIRED
        assert order.expired_at == forced_now
        assert slot.status is SlotStatus.AVAILABLE
        assert slot.locked_by_order_id is None
        assert slot.locked_until is None
