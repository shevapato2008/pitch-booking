import uuid
from collections.abc import Iterator
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from backend.app.config import Settings
from backend.app.database import get_database
from backend.app.errors import AppError
from backend.app.main import create_app
from backend.app.models import Order, Payment, PaymentState
from backend.app.modules.payments.mock_provider import MockPaymentProvider
from backend.app.modules.payments.provider import CreatePrepayRequest
from backend.app.modules.payments.reconciliation import PaymentReconciliationService
from backend.tests.test_order_detail import KEY_BASE64, KEY_VERSION, RAW_TOKEN, _seed_detail
from backend.tests.test_payment_settlement import convergence, seed_payment, session_factory


def test_immediate_reconcile_returns_202_then_200_and_is_repeatable(pg_engine: Engine) -> None:
    order_id, payment_id, _, now = seed_payment(pg_engine, status=PaymentState.PREPAY_CREATED)
    provider = MockPaymentProvider()
    # Seed the provider using the same merchant number through the normal API.
    with Session(pg_engine) as session:
        merchant = session.get_one(Payment, payment_id).merchant_order_no
    provider.create_prepay(CreatePrepayRequest(merchant, "booking", 32000, "CNY", "openid"))
    service = PaymentReconciliationService(
        session_factory=session_factory(pg_engine),
        provider=provider,
        convergence=convergence(pg_engine),
        now=lambda: now,
    )

    unresolved = service.reconcile(
        user_id=_owner_id(pg_engine, order_id), order_id=order_id, payment_id=payment_id
    )
    provider.mark_success(
        merchant, provider_transaction_no="reconcile-tx", paid_at=datetime.now(UTC)
    )
    terminal = service.reconcile(
        user_id=_owner_id(pg_engine, order_id), order_id=order_id, payment_id=payment_id
    )
    repeated = service.reconcile(
        user_id=_owner_id(pg_engine, order_id), order_id=order_id, payment_id=payment_id
    )

    assert unresolved.status_code == 202
    assert terminal.status_code == repeated.status_code == 200
    assert [call.method for call in provider.calls].count("query_payment") == 3


def _owner_id(engine: Engine, order_id):
    with Session(engine) as session:
        return session.get_one(Order, order_id).user_id


def test_payment_http_routes_follow_frozen_201_202_200_and_401_matrix(
    pg_engine: Engine,
) -> None:
    order_id, _, _ = _seed_detail(pg_engine)
    app = create_app(
        settings=Settings(
            app_env="development",
            payment_provider="mock",
            enable_mock_payment_provider=True,
            wechat_provider="development",
            phone_encryption_key_base64=KEY_BASE64,
            phone_encryption_key_version=KEY_VERSION,
        )
    )

    def database_override() -> Iterator[Session]:
        with Session(pg_engine) as session:
            yield session

    app.dependency_overrides[get_database] = database_override
    auth = {"Authorization": f"Bearer {RAW_TOKEN}"}
    with TestClient(app, raise_server_exceptions=False) as client:
        unauthorized = client.post(
            f"/api/v1/orders/{order_id}/pay",
            headers={"Idempotency-Key": "payment-http-key-0001"},
        )
        created = client.post(
            f"/api/v1/orders/{order_id}/pay",
            headers=auth | {"Idempotency-Key": "payment-http-key-0001"},
        )
        payment_id = created.json()["payment_id"]
        unresolved = client.post(
            f"/api/v1/orders/{order_id}/payments/{payment_id}/reconcile",
            headers=auth,
        )
        with Session(pg_engine) as session:
            merchant_order_no = session.get_one(Payment, uuid.UUID(payment_id)).merchant_order_no
        provider = app.state.payment_provider
        provider.mark_success(
            merchant_order_no,
            provider_transaction_no="http-transaction",
            paid_at=datetime.now(UTC),
        )
        terminal = client.post(
            f"/api/v1/orders/{order_id}/payments/{payment_id}/reconcile",
            headers=auth,
        )

    assert unauthorized.status_code == 401
    assert created.status_code == 201
    assert set(created.json()) == {"order_id", "payment_id", "status", "launch_params"}
    assert unresolved.status_code == 202
    assert unresolved.json()["order"]["payment_confirming"] is True
    assert terminal.status_code == 200
    assert terminal.json()["status"] == "CONFIRMED"
    assert terminal.json()["payment_state"] == "SUCCESS"

    unbound = create_app(
        settings=Settings(
            app_env="test",
            payment_provider="wechat",
            wechat_provider="development",
            phone_encryption_key_base64=KEY_BASE64,
            phone_encryption_key_version=KEY_VERSION,
        )
    )
    unbound.dependency_overrides[get_database] = database_override
    with TestClient(unbound, raise_server_exceptions=False) as client:
        hidden = client.post(
            f"/api/v1/orders/{order_id}/payments/{payment_id}/reconcile",
            headers=auth,
        )
    assert hidden.status_code == 404
    assert hidden.json()["error"]["code"] == "ORDER_NOT_FOUND"


class WrongPaymentProvider(MockPaymentProvider):
    name = "wrong-provider"


def test_reconcile_refuses_cross_provider_before_external_query(pg_engine: Engine) -> None:
    order_id, payment_id, _, _ = seed_payment(pg_engine, status=PaymentState.PREPAY_CREATED)
    provider = WrongPaymentProvider()
    service = PaymentReconciliationService(
        session_factory=session_factory(pg_engine),
        provider=provider,
        convergence=convergence(pg_engine),
    )

    with pytest.raises(AppError) as raised:
        service.reconcile(
            user_id=_owner_id(pg_engine, order_id),
            order_id=order_id,
            payment_id=payment_id,
        )

    assert raised.value.status_code == 404
    assert provider.calls == ()
    with Session(pg_engine) as session:
        assert session.get_one(Payment, payment_id).status is PaymentState.PREPAY_CREATED


class TimeoutPaymentProvider(MockPaymentProvider):
    def query_payment(self, request):
        raise TimeoutError("secret-provider-host:443 timed out")


def test_unexpected_provider_query_failure_converges_to_safe_unknown_202(
    pg_engine: Engine,
) -> None:
    order_id, payment_id, _, _ = seed_payment(pg_engine, status=PaymentState.PREPAY_CREATED)
    service = PaymentReconciliationService(
        session_factory=session_factory(pg_engine),
        provider=TimeoutPaymentProvider(),
        convergence=convergence(pg_engine),
    )

    result = service.reconcile(
        user_id=_owner_id(pg_engine, order_id),
        order_id=order_id,
        payment_id=payment_id,
    )

    assert result.status_code == 202
    with Session(pg_engine) as session:
        payment = session.get_one(Payment, payment_id)
        assert payment.status is PaymentState.UNKNOWN
        assert payment.last_error_code == "PAYMENT_PROVIDER_QUERY_FAILED"
        assert "secret-provider-host" not in str(payment.last_error_code)
