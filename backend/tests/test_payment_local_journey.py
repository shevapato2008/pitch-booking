import base64
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session

from backend.app.config import Settings
from backend.app.database import get_database
from backend.app.main import create_app
from backend.app.models import Order, OrderStatus, Payment, PaymentState, Slot, SlotStatus
from backend.app.modules.payments.mock_provider import MockPaymentProvider
from scripts.seed_demo import run_seed

pytestmark = pytest.mark.integration

PHONE_KEY_BASE64 = base64.b64encode(bytes(32)).decode("ascii")
ORDER_IDEMPOTENCY_KEY = "local-payment-order-key-0001"
PAYMENT_IDEMPOTENCY_KEY = "local-payment-attempt-key-0001"


def _development_client(engine: Engine) -> tuple[FastAPI, TestClient]:
    app = create_app(
        settings=Settings(
            app_env="development",
            wechat_provider="development",
            payment_provider="mock",
            enable_mock_payment_provider=True,
            phone_encryption_key_base64=PHONE_KEY_BASE64,
            phone_encryption_key_version=1,
        )
    )

    def database_override() -> Iterator[Session]:
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_database] = database_override
    return app, TestClient(app, raise_server_exceptions=False)


def _create_pending_order(
    engine: Engine,
    client: TestClient,
) -> tuple[dict[str, str], uuid.UUID, uuid.UUID]:
    seed_now = datetime.now(UTC)
    run_seed(
        anchor="today",
        days=1,
        database_url=engine.url.render_as_string(hide_password=False),
        now=seed_now,
    )
    with Session(engine) as session:
        slot = session.scalar(
            select(Slot)
            .where(Slot.status == SlotStatus.AVAILABLE, Slot.starts_at > seed_now)
            .order_by(Slot.starts_at, Slot.id)
            .limit(1)
        )
        assert slot is not None
        slot_id = slot.id

    session_response = client.post(
        "/api/v1/auth/wechat/session",
        json={"code": "dev-local-payment-user"},
    )
    assert session_response.status_code == 200
    auth = {"Authorization": f"Bearer {session_response.json()['session_token']}"}
    phone_response = client.post(
        "/api/v1/auth/wechat/phone",
        headers=auth,
        json={"code": "dev-local-payment-phone"},
    )
    assert phone_response.status_code == 200

    checkout = client.get(f"/api/v1/slots/{slot_id}/checkout", headers=auth)
    assert checkout.status_code == 200
    created = client.post(
        "/api/v1/orders",
        headers={**auth, "Idempotency-Key": ORDER_IDEMPOTENCY_KEY},
        json={
            "slot_id": str(slot_id),
            "checkout_version": checkout.json()["checkout_version"],
            "contact_name": "本地支付验收",
        },
    )
    assert created.status_code == 201
    return auth, uuid.UUID(created.json()["id"]), slot_id


def test_local_http_mock_authority_confirms_once_without_trusting_cashier_callback(
    pg_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("APP_ENV", "development")
    app, client = _development_client(pg_engine)
    with client:
        auth, order_id, slot_id = _create_pending_order(pg_engine, client)

        pending = client.get(f"/api/v1/orders/{order_id}", headers=auth)
        assert pending.status_code == 200
        assert pending.json()["status"] == "PENDING_PAYMENT"

        created = client.post(
            f"/api/v1/orders/{order_id}/pay",
            headers={**auth, "Idempotency-Key": PAYMENT_IDEMPOTENCY_KEY},
        )
        same_key_replay = client.post(
            f"/api/v1/orders/{order_id}/pay",
            headers={**auth, "Idempotency-Key": PAYMENT_IDEMPOTENCY_KEY},
        )
        duplicate_click = client.post(
            f"/api/v1/orders/{order_id}/pay",
            headers={**auth, "Idempotency-Key": "local-payment-attempt-key-0002"},
        )
        assert created.status_code == 201
        assert same_key_replay.status_code == duplicate_click.status_code == 200
        payment_id = uuid.UUID(created.json()["payment_id"])
        assert same_key_replay.json()["payment_id"] == str(payment_id)
        assert duplicate_click.json()["payment_id"] == str(payment_id)

        # A Mini Program cashier-success callback is deliberately client-local. Until
        # server authority changes, the real HTTP projection must remain pending.
        after_cashier_callback = client.get(f"/api/v1/orders/{order_id}", headers=auth)
        assert after_cashier_callback.status_code == 200
        assert after_cashier_callback.json()["status"] == "PENDING_PAYMENT"
        assert after_cashier_callback.json()["payment_state"] == "PREPAY_CREATED"

        mismatched_body = client.post(
            f"/api/v1/development/payments/{payment_id}/authority",
            json={"status": "SUCCESS", "amount_cents": 1},
        )
        assert mismatched_body.status_code == 422
        still_pending = client.get(f"/api/v1/orders/{order_id}", headers=auth)
        assert still_pending.json()["status"] == "PENDING_PAYMENT"

        authoritative_success = client.post(
            f"/api/v1/development/payments/{payment_id}/authority",
            json={"status": "SUCCESS", "provider_transaction_no": "local-payment-tx-0001"},
        )
        duplicate_authority = client.post(
            f"/api/v1/development/payments/{payment_id}/authority",
            json={"status": "SUCCESS", "provider_transaction_no": "local-payment-tx-0001"},
        )
        stale_close = client.post(
            f"/api/v1/development/payments/{payment_id}/authority",
            json={"status": "CLOSED"},
        )
        assert authoritative_success.status_code == 200
        assert duplicate_authority.status_code == 200
        assert stale_close.status_code == 200

        confirmed = client.get(f"/api/v1/orders/{order_id}", headers=auth)
        assert confirmed.status_code == 200
        assert confirmed.json()["status"] == "CONFIRMED"
        assert confirmed.json()["payment_state"] == "SUCCESS"

    provider = app.state.payment_provider
    assert isinstance(provider, MockPaymentProvider)
    assert provider.provider_order_count == 1
    assert [call.method for call in provider.calls].count("create_prepay") == 1
    with Session(pg_engine) as session:
        payment = session.get_one(Payment, payment_id)
        order = session.get_one(Order, order_id)
        slot = session.get_one(Slot, slot_id)
        assert session.scalar(select(func.count()).select_from(Payment)) == 1
        assert payment.status is PaymentState.SUCCESS
        assert payment.provider_transaction_no == "local-payment-tx-0001"
        assert payment.paid_at is not None
        assert order.status is OrderStatus.CONFIRMED
        assert slot.status is SlotStatus.BOOKED
        assert slot.locked_by_order_id is None
        assert slot.locked_until is None


@pytest.mark.parametrize("app_env", ["test", "staging", "production"])
def test_runtime_mock_payment_provider_cannot_be_enabled_outside_development(
    app_env: str,
) -> None:
    settings: dict[str, object] = {
        "app_env": app_env,
        "payment_provider": "mock",
        "enable_mock_payment_provider": True,
    }
    if app_env in {"staging", "production"}:
        settings.update(
            database_url="postgresql+psycopg://pitch:password@postgres:5432/pitch",
            public_api_base_url="https://api.example.test",
            public_image_hosts=("cdn.example.test",),
            oss_endpoint="https://oss-cn-hangzhou.aliyuncs.com",
            oss_bucket="venue-media-staging",
            oss_public_base_url="https://cdn.example.test/media",
            oss_access_key_id="staging-access-key-id",
            oss_access_key_secret="staging-access-key-secret",
            dashscope_api_key="staging-dashscope-key",
            wechat_provider="real",
            wechat_app_id="wx-app",
            wechat_app_secret="secret",
            phone_encryption_key_base64=PHONE_KEY_BASE64,
            phone_encryption_key_version=1,
        )

    with pytest.raises(ValueError, match="Mock payment provider"):
        Settings(**settings)
