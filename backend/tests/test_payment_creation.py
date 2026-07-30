import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session

from backend.app.errors import AppError
from backend.app.models import (
    IdempotencyRecord,
    IdempotencyState,
    Order,
    OrderStatus,
    Payment,
    PaymentState,
    SlotStatus,
    User,
)
from backend.app.modules.payments.mock_provider import MockCreateMode, MockPaymentProvider
from backend.app.modules.payments.provider import CreatePrepayRequest, PaymentProvider
from backend.app.modules.payments.service import PaymentCreationService
from backend.tests.test_schema_constraints import add_pitch, add_slot, venue

pytestmark = pytest.mark.integration


def seed_order(
    engine: Engine, *, status: OrderStatus = OrderStatus.PENDING_PAYMENT, expired: bool = False
) -> tuple[uuid.UUID, uuid.UUID]:
    with Session(engine) as session:
        now = datetime.now(UTC)
        is_expired = expired or status is OrderStatus.EXPIRED
        user = User(wechat_app_id="wx-test", wechat_openid=f"openid-{uuid.uuid4()}")
        pitch = add_pitch(session, venue())
        slot = add_slot(
            session,
            pitch,
            now + timedelta(days=1),
            now + timedelta(days=1, hours=2),
            price_cents=99999,
        )
        order = Order(
            id=uuid.uuid4(),
            order_number=f"PB-{uuid.uuid4().hex}",
            user=user,
            slot=slot,
            status=status,
            price_cents=32000,
            contact_name="张三",
            contact_phone_ciphertext=b"encrypted-phone-tag",
            contact_phone_nonce=b"abcdefghijkl",
            contact_phone_key_version=1,
            created_at=now - timedelta(minutes=20) if is_expired else now,
            expires_at=now - timedelta(seconds=1) if is_expired else now + timedelta(minutes=10),
            expired_at=(now if status is OrderStatus.EXPIRED else None),
        )
        session.add(order)
        session.flush()
        slot.status = SlotStatus.LOCKED
        slot.locked_by_order_id = order.id
        slot.locked_until = order.expires_at
        session.commit()
        return user.id, order.id


def service(engine: Engine, provider: PaymentProvider) -> PaymentCreationService:
    return PaymentCreationService(
        session_factory=lambda: Session(engine),
        provider=provider,
        now=lambda: datetime.now(UTC),
    )


def test_new_payment_uses_order_price_and_same_key_replays_200(pg_engine: Engine) -> None:
    user_id, order_id = seed_order(pg_engine)
    provider = MockPaymentProvider()
    payments = service(pg_engine, provider)

    first = payments.create_payment(
        user_id=user_id,
        order_id=order_id,
        idempotency_key="payment-key-00000001",
        payer_openid="secret-openid",
    )
    replay = payments.create_payment(
        user_id=user_id,
        order_id=order_id,
        idempotency_key="payment-key-00000001",
        payer_openid="secret-openid",
    )

    assert first.status_code == 201
    assert replay.status_code == 200
    assert replay.body == first.body
    with Session(pg_engine) as session:
        payment = session.scalar(select(Payment))
        assert payment is not None
        assert payment.amount_cents == 32000
        assert payment.currency == "CNY"
        assert payment.status is PaymentState.PREPAY_CREATED
        assert session.scalar(select(func.count()).select_from(Payment)) == 1
        record = session.scalar(select(IdempotencyRecord))
        assert record is not None and record.state is IdempotencyState.COMPLETED


def test_new_key_joins_current_payment_without_second_provider_order(pg_engine: Engine) -> None:
    user_id, order_id = seed_order(pg_engine)
    provider = MockPaymentProvider()
    payments = service(pg_engine, provider)
    first = payments.create_payment(
        user_id=user_id,
        order_id=order_id,
        idempotency_key="payment-key-00000001",
        payer_openid="openid",
    )

    second = payments.create_payment(
        user_id=user_id,
        order_id=order_id,
        idempotency_key="payment-key-00000002",
        payer_openid="openid",
    )

    assert second.status_code == 200
    assert second.body["payment_id"] == first.body["payment_id"]
    assert provider.provider_order_count == 1


def test_unknown_sets_anchor_once_and_remains_processing(pg_engine: Engine) -> None:
    user_id, order_id = seed_order(pg_engine)
    provider = MockPaymentProvider(create_mode=MockCreateMode.UNKNOWN_BEFORE_ACCEPTANCE)
    payments = service(pg_engine, provider)
    first = payments.create_payment(
        user_id=user_id,
        order_id=order_id,
        idempotency_key="payment-key-unknown",
        payer_openid="openid",
    )
    with Session(pg_engine) as session:
        anchor = session.scalar(select(Payment.authority_unknown_since))

    second = payments.create_payment(
        user_id=user_id,
        order_id=order_id,
        idempotency_key="payment-key-unknown",
        payer_openid="openid",
    )

    assert first.status_code == second.status_code == 202
    with Session(pg_engine) as session:
        payment = session.scalar(select(Payment))
        record = session.scalar(select(IdempotencyRecord))
        assert payment is not None and payment.authority_unknown_since == anchor
        assert payment.status is PaymentState.UNKNOWN
        assert record is not None and record.state is IdempotencyState.PROCESSING


def test_rejection_is_replayable_and_new_key_can_make_new_attempt(pg_engine: Engine) -> None:
    user_id, order_id = seed_order(pg_engine)
    rejected = MockPaymentProvider(create_mode=MockCreateMode.REJECTED)
    payments = service(pg_engine, rejected)

    with pytest.raises(AppError) as first:
        payments.create_payment(
            user_id=user_id,
            order_id=order_id,
            idempotency_key="payment-key-rejected",
            payer_openid="openid",
        )
    with pytest.raises(AppError) as replay:
        payments.create_payment(
            user_id=user_id,
            order_id=order_id,
            idempotency_key="payment-key-rejected",
            payer_openid="openid",
        )

    assert first.value.status_code == replay.value.status_code == 503
    with Session(pg_engine) as session:
        assert session.scalar(select(Payment.status)) is PaymentState.CLOSED
        assert session.scalar(select(IdempotencyRecord.state)) is IdempotencyState.COMPLETED

    recovered = service(pg_engine, MockPaymentProvider()).create_payment(
        user_id=user_id,
        order_id=order_id,
        idempotency_key="payment-key-new-attempt",
        payer_openid="openid",
    )
    assert recovered.status_code == 201


@pytest.mark.parametrize(
    ("status", "expired", "code"),
    [
        (OrderStatus.EXPIRED, False, "ORDER_EXPIRED"),
        (OrderStatus.PAYMENT_EXCEPTION, False, "PAYMENT_EXCEPTION"),
        (OrderStatus.PENDING_PAYMENT, True, "ORDER_EXPIRED"),
    ],
)
def test_invalid_order_states_are_frozen(
    pg_engine: Engine, status: OrderStatus, expired: bool, code: str
) -> None:
    user_id, order_id = seed_order(pg_engine, status=status, expired=expired)
    with pytest.raises(AppError, match=code):
        service(pg_engine, MockPaymentProvider()).create_payment(
            user_id=user_id,
            order_id=order_id,
            idempotency_key="payment-key-invalid",
            payer_openid="openid",
        )
    with Session(pg_engine) as session:
        record = session.scalar(select(IdempotencyRecord))
        assert record is not None and record.state is IdempotencyState.COMPLETED


def test_provider_success_is_left_for_authoritative_convergence(pg_engine: Engine) -> None:
    user_id, order_id = seed_order(pg_engine)
    provider = MockPaymentProvider()
    payments = service(pg_engine, provider)
    payments._phase_one(  # noqa: SLF001 - creates the durable crash-window record
        user_id=user_id, order_id=order_id, idempotency_key="payment-success-query"
    )
    with Session(pg_engine) as session:
        payment = session.scalar(select(Payment))
        assert payment is not None
        merchant_order_no = payment.merchant_order_no
    now = datetime.now(UTC)
    provider.create_prepay(
        CreatePrepayRequest(merchant_order_no, "预订场地", 32000, "CNY", "openid")
    )
    provider.mark_success(merchant_order_no, provider_transaction_no="tx-success", paid_at=now)

    result = payments.create_payment(
        user_id=user_id,
        order_id=order_id,
        idempotency_key="payment-success-query",
        payer_openid="openid",
    )

    assert result.status_code == 202
    with Session(pg_engine) as session:
        payment = session.scalar(select(Payment))
        assert payment is not None and payment.status is PaymentState.CONFIRMING
        assert payment.next_reconcile_at is not None
        assert payment.provider_transaction_no is None


def test_ownership_is_hidden_and_key_cannot_move_to_another_order(pg_engine: Engine) -> None:
    first_user, first_order = seed_order(pg_engine)
    second_user, second_order = seed_order(pg_engine)
    with Session(pg_engine) as session:
        second = session.get_one(Order, second_order)
        second.user_id = first_user
        session.commit()
    payments = service(pg_engine, MockPaymentProvider())
    payments.create_payment(
        user_id=first_user,
        order_id=first_order,
        idempotency_key="shared-payment-key",
        payer_openid="openid",
    )

    with pytest.raises(AppError, match="ORDER_NOT_FOUND"):
        payments.create_payment(
            user_id=second_user,
            order_id=first_order,
            idempotency_key="other-user-key",
            payer_openid="openid",
        )
    with pytest.raises(AppError, match="IDEMPOTENCY_KEY_REUSED"):
        payments.create_payment(
            user_id=first_user,
            order_id=second_order,
            idempotency_key="shared-payment-key",
            payer_openid="openid",
        )


def test_already_confirmed_returns_200_without_provider_call(pg_engine: Engine) -> None:
    user_id, order_id = seed_order(pg_engine, status=OrderStatus.CONFIRMED)
    provider = MockPaymentProvider()

    result = service(pg_engine, provider).create_payment(
        user_id=user_id,
        order_id=order_id,
        idempotency_key="confirmed-payment-key",
        payer_openid="openid",
    )

    assert result.status_code == 200
    assert result.body == {"order_id": str(order_id), "status": "ALREADY_CONFIRMED"}
    assert provider.calls == ()
