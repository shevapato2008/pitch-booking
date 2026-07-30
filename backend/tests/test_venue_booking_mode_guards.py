import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session

from backend.app.errors import AppError
from backend.app.models import (
    BookingMode,
    IdempotencyRecord,
    Order,
    OrderStatus,
    Payment,
    Slot,
    SlotStatus,
    User,
)
from backend.app.modules.availability.repository import AvailabilityRepository
from backend.app.modules.availability.service import AvailabilityService
from backend.app.modules.checkout.repository import CheckoutRepository
from backend.app.modules.checkout.service import CheckoutService
from backend.app.modules.orders.dto import CreateOrderRequest
from backend.app.modules.orders.repository import OrderRepository
from backend.app.modules.orders.service import OrderService
from backend.app.modules.payments.mock_provider import MockPaymentProvider
from backend.app.modules.payments.service import PaymentCreationService
from backend.tests.test_schema_constraints import add_pitch, add_slot, venue

pytestmark = pytest.mark.integration


@dataclass(frozen=True, slots=True)
class DirectoryGraph:
    venue_id: uuid.UUID
    slot_id: uuid.UUID
    user_id: uuid.UUID
    order_id: uuid.UUID | None


def _seed_directory_graph(engine: Engine, *, with_order: bool = False) -> DirectoryGraph:
    with Session(engine) as session:
        now = datetime.now(UTC)
        parent = venue(
            booking_mode=BookingMode.DIRECTORY_ONLY,
            is_listed=True,
            public_pitch_types=["FIVE_A_SIDE"],
        )
        pitch = add_pitch(session, parent)
        slot = add_slot(
            session,
            pitch,
            now + timedelta(days=1),
            now + timedelta(days=1, hours=2),
            checkout_version=7,
        )
        user = User(
            wechat_app_id="wx-directory-guard",
            wechat_openid=f"directory-user-{uuid.uuid4()}",
        )
        session.add(user)
        session.flush()

        order_id: uuid.UUID | None = None
        if with_order:
            order = Order(
                id=uuid.uuid4(),
                order_number=f"PB-{uuid.uuid4().hex}",
                user=user,
                slot=slot,
                status=OrderStatus.PENDING_PAYMENT,
                price_cents=slot.price_cents,
                contact_name="历史用户",
                contact_phone_ciphertext=b"encrypted-phone-tag",
                contact_phone_nonce=b"abcdefghijkl",
                contact_phone_key_version=1,
                created_at=now,
                expires_at=now + timedelta(minutes=10),
            )
            session.add(order)
            session.flush()
            slot.status = SlotStatus.LOCKED
            slot.locked_until = order.expires_at
            slot.locked_by_order_id = order.id
            order_id = order.id

        session.commit()
        return DirectoryGraph(parent.id, slot.id, user.id, order_id)


def _assert_hidden(error: pytest.ExceptionInfo[AppError]) -> None:
    assert error.value.status_code == 404
    assert error.value.code == "VENUE_NOT_FOUND"


def test_directory_venue_has_no_availability(pg_engine: Engine) -> None:
    graph = _seed_directory_graph(pg_engine)
    with Session(pg_engine) as session:
        service = AvailabilityService(AvailabilityRepository(session))
        with pytest.raises(AppError) as raised:
            service.get_availability(
                graph.venue_id,
                str(datetime.now(UTC).date()),
                "FIVE_A_SIDE",
            )

    _assert_hidden(raised)


def test_directory_checkout_is_rejected_before_slot_mutation(pg_engine: Engine) -> None:
    graph = _seed_directory_graph(pg_engine)
    with Session(pg_engine) as session:
        before = session.get_one(Slot, graph.slot_id)
        snapshot = (before.status, before.checkout_version, before.locked_until)
        user = session.get_one(User, graph.user_id)
        service = CheckoutService(
            repository=CheckoutRepository(session),
            phone_vault=None,
        )
        with pytest.raises(AppError) as raised:
            service.get_checkout(graph.slot_id, user)

    _assert_hidden(raised)
    with Session(pg_engine) as session:
        after = session.get_one(Slot, graph.slot_id)
        assert (after.status, after.checkout_version, after.locked_until) == snapshot


def test_directory_order_is_rejected_before_idempotency_or_order_mutation(
    pg_engine: Engine,
) -> None:
    graph = _seed_directory_graph(pg_engine)
    with Session(pg_engine) as session:
        user = session.get_one(User, graph.user_id)
        service = OrderService(repository=OrderRepository(session), phone_vault=None)
        with pytest.raises(AppError) as raised:
            service.create_order(
                user=user,
                idempotency_key="directory-order-key-0001",
                request=CreateOrderRequest(
                    slot_id=graph.slot_id,
                    checkout_version=7,
                    contact_name="目录用户",
                ),
            )

    _assert_hidden(raised)
    with Session(pg_engine) as session:
        assert session.scalar(select(func.count()).select_from(Order)) == 0
        assert session.scalar(select(func.count()).select_from(IdempotencyRecord)) == 0
        slot = session.get_one(Slot, graph.slot_id)
        assert slot.status is SlotStatus.AVAILABLE
        assert slot.checkout_version == 7


def test_directory_payment_is_rejected_before_claim_or_provider_call(
    pg_engine: Engine,
) -> None:
    graph = _seed_directory_graph(pg_engine, with_order=True)
    assert graph.order_id is not None
    provider = MockPaymentProvider()
    service = PaymentCreationService(
        session_factory=lambda: Session(pg_engine),
        provider=provider,
    )

    with pytest.raises(AppError) as raised:
        service.create_payment(
            user_id=graph.user_id,
            order_id=graph.order_id,
            idempotency_key="directory-payment-key-0001",
            payer_openid="private-openid",
        )

    _assert_hidden(raised)
    assert provider.calls == ()
    with Session(pg_engine) as session:
        assert session.scalar(select(func.count()).select_from(Payment)) == 0
        assert session.scalar(select(func.count()).select_from(IdempotencyRecord)) == 0
        order = session.get_one(Order, graph.order_id)
        assert order.status is OrderStatus.PENDING_PAYMENT
