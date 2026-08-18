import ast
import uuid
from collections.abc import Iterator
from datetime import datetime, timedelta
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
)
from backend.app.modules.refunds.repository import RefundRepository
from backend.app.modules.venue_fulfillment.refund import VenueRefundService
from backend.app.modules.venue_fulfillment.router import (
    get_fulfillment_clock,
    get_refund_provider_name_resolver,
    refund_router,
)
from backend.tests.test_venue_fulfillment import (
    NOW,
    PHONE_VAULT,
    _auth,
    _managed_venue,
    _manager,
    _order,
)

pytestmark = pytest.mark.integration


def _client(
    engine: Engine,
    *,
    provider_name: str | None = "wechatpay-live",
) -> TestClient:
    app = create_app(settings=Settings(app_env="test", wechat_provider="development"))
    app.include_router(refund_router)

    def database_override() -> Iterator[Session]:
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_database] = database_override
    app.dependency_overrides[get_fulfillment_clock] = lambda: NOW
    app.dependency_overrides[get_refund_provider_name_resolver] = lambda: (
        lambda: provider_name
    )
    return TestClient(app, raise_server_exceptions=False)


def _payment(
    session: Session,
    order: Order,
    *,
    applied: bool = True,
    status: PaymentState = PaymentState.SUCCESS,
) -> Payment:
    row = Payment(
        order=order,
        provider="wechatpay-live",
        merchant_order_no=f"P{uuid.uuid4().hex}",
        provider_transaction_no=(
            f"T{uuid.uuid4().hex}" if status is PaymentState.SUCCESS else None
        ),
        amount_cents=order.price_cents,
        currency="CNY",
        status=status,
        paid_at=NOW if status is PaymentState.SUCCESS else None,
        applied_to_order_at=(
            NOW if applied and status is PaymentState.SUCCESS else None
        ),
    )
    session.add(row)
    session.flush()
    return row


def _seed(
    engine: Engine,
    *,
    starts_at: datetime = NOW + timedelta(hours=1),
    with_payment: bool = True,
    applied: bool = True,
    order_status: OrderStatus = OrderStatus.CONFIRMED,
) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID | None, uuid.UUID]:
    with Session(engine) as session:
        manager = _manager(session)
        parent = _managed_venue(session, manager)
        order = _order(
            session,
            parent=parent,
            starts_at=starts_at,
            status=order_status,
        )
        payment = _payment(session, order, applied=applied) if with_payment else None
        ids = (
            manager.id,
            parent.id,
            order.id,
            payment.id if payment is not None else None,
            order.slot_id,
        )
        session.commit()
        return ids


def _post(
    client: TestClient,
    *,
    venue_id: uuid.UUID,
    order_id: uuid.UUID,
    key: str = "venue-refund-key-0001",
    reason: str = "暴雨停场",
) -> object:
    return client.post(
        f"/api/v1/venues/{venue_id}/fulfillment/orders/{order_id}/refund",
        headers={**_auth(), "Idempotency-Key": key},
        json={"reason_note": reason},
    )


def test_refund_enqueues_full_applied_payment_and_persists_normalized_audit(
    pg_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manager_id, venue_id, order_id, payment_id, slot_id = _seed(pg_engine)
    assert payment_id is not None
    predicate_calls = 0
    original = RefundRepository.purpose_is_valid

    def record_purpose(*, graph: object, purpose: RefundCasePurpose) -> bool:
        nonlocal predicate_calls
        predicate_calls += 1
        return original(graph=graph, purpose=purpose)  # type: ignore[arg-type]

    monkeypatch.setattr(
        RefundRepository,
        "purpose_is_valid",
        staticmethod(record_purpose),
    )
    with Session(pg_engine) as session:
        _payment(session, session.get_one(Order, order_id), applied=False)
        session.commit()
    with _client(pg_engine) as client:
        original_replay = _post(
            client,
            venue_id=venue_id,
            order_id=order_id,
        )
        response = _post(
            client,
            venue_id=venue_id,
            order_id=order_id,
            reason="  暴雨停场  ",
        )

    assert original_replay.status_code == 202
    assert response.status_code == 202
    assert response.json() == {"order_id": str(order_id), "status": "REFUND_PENDING"}
    assert predicate_calls >= 1
    with Session(pg_engine) as session:
        order = session.get_one(Order, order_id)
        slot = session.get_one(Slot, slot_id)
        refund_case = session.scalar(select(RefundCase).where(RefundCase.order_id == order_id))
        assert refund_case is not None
        attempt = session.scalar(
            select(RefundAttempt).where(RefundAttempt.refund_case_id == refund_case.id)
        )
        assert attempt is not None
        assert order.status is OrderStatus.REFUND_PENDING
        assert order.cancel_requested_at == NOW
        assert order.cancelled_at == NOW
        assert slot.status is SlotStatus.CLOSED
        assert refund_case.payment_id == payment_id
        assert refund_case.purpose is RefundCasePurpose.ORDER_CANCELLATION
        assert refund_case.reason is RefundReason.VENUE_CANCELLED
        assert refund_case.reason_note == "暴雨停场"
        assert refund_case.requested_by_user_id == manager_id
        assert refund_case.amount_cents == 36000
        assert refund_case.currency == "CNY"
        assert attempt.provider == "wechatpay-live"
        assert attempt.status is RefundAttemptStatus.CREATING
        assert attempt.next_reconcile_at == NOW
        assert attempt.provider_refund_no is None
        assert attempt.failure_code is None
        assert attempt.refunded_at is None
        assert len(attempt.merchant_refund_no) <= 32
        idem = session.scalar(
            select(IdempotencyRecord).where(
                IdempotencyRecord.operation == "VENUE_REFUND"
            )
        )
        assert idem is not None
        assert idem.response_status == 202


def test_provider_resolver_fails_closed_before_any_database_mutation(
    pg_engine: Engine,
) -> None:
    _, venue_id, order_id, _, slot_id = _seed(pg_engine)
    with _client(pg_engine, provider_name=None) as client:
        response = _post(client, venue_id=venue_id, order_id=order_id)

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "SERVICE_UNAVAILABLE"
    with Session(pg_engine) as session:
        assert session.scalar(select(func.count()).select_from(RefundCase)) == 0
        assert session.scalar(select(func.count()).select_from(RefundAttempt)) == 0
        assert session.scalar(select(func.count()).select_from(IdempotencyRecord)) == 0
        assert session.get_one(Order, order_id).status is OrderStatus.CONFIRMED
        assert session.get_one(Slot, slot_id).status is SlotStatus.BOOKED


def test_refund_rejects_blank_reason_and_ineligible_or_hidden_orders(
    pg_engine: Engine,
) -> None:
    manager_id, venue_id, order_id, _, _ = _seed(pg_engine)
    with Session(pg_engine) as session:
        manager = session.get_one(User, manager_id)
        checked_in = session.get_one(Order, order_id)
        checked_in.checked_in_at = NOW
        checked_in.checked_in_by_user_id = checked_in.user_id
        parent = checked_in.slot.pitch.venue
        no_payment = _order(
            session,
            parent=parent,
            starts_at=NOW + timedelta(hours=3),
            pitch_name="无支付场地",
        )
        completed = _order(
            session,
            parent=parent,
            starts_at=NOW - timedelta(hours=4),
            pitch_name="已履约场地",
        )
        _payment(session, completed)
        completed.checked_in_at = NOW - timedelta(hours=3)
        completed.checked_in_by_user_id = manager.id
        completed.status = OrderStatus.COMPLETED
        completed.completed_at = NOW - timedelta(hours=1)
        completed.completed_by_user_id = manager.id
        refunded = _order(
            session,
            parent=parent,
            starts_at=NOW + timedelta(hours=4),
            pitch_name="异常已退款场地",
        )
        _payment(session, refunded)
        refunded.status = OrderStatus.REFUNDED
        refunded.cancel_requested_at = NOW - timedelta(minutes=2)
        refunded.cancelled_at = NOW - timedelta(minutes=1)
        no_payment_order_id = no_payment.id
        completed_order_id = completed.id
        refunded_order_id = refunded.id
        session.commit()

    with _client(pg_engine) as client:
        blank = _post(client, venue_id=venue_id, order_id=order_id, reason="   ")
        checked = _post(
            client,
            venue_id=venue_id,
            order_id=order_id,
            key="venue-refund-key-0002",
        )
        missing_payment = _post(
            client,
            venue_id=venue_id,
            order_id=no_payment_order_id,
            key="venue-refund-key-0003",
        )
        completed = _post(
            client,
            venue_id=venue_id,
            order_id=completed_order_id,
            key="venue-refund-key-0004",
        )
        refunded = _post(
            client,
            venue_id=venue_id,
            order_id=refunded_order_id,
            key="venue-refund-key-0005",
        )
        hidden = _post(
            client,
            venue_id=uuid.uuid4(),
            order_id=order_id,
            key="venue-refund-key-0006",
        )

    assert blank.status_code == 422
    assert blank.json()["error"]["code"] == "INVALID_ARGUMENT"
    for response in (checked, missing_payment, completed, refunded):
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "ORDER_STATE_CHANGED"
    assert hidden.status_code == 404
    assert hidden.json()["error"]["code"] == "ORDER_NOT_FOUND"


def test_idempotency_replays_and_active_attempt_is_reused(
    pg_engine: Engine,
) -> None:
    _, venue_id, order_id, _, _ = _seed(pg_engine)
    with Session(pg_engine) as session:
        first_order = session.get_one(Order, order_id)
        second_order = _order(
            session,
            parent=first_order.slot.pitch.venue,
            starts_at=NOW + timedelta(hours=3),
            pitch_name="幂等键其他场地",
        )
        _payment(session, second_order)
        second_order_id = second_order.id
        session.commit()
    with _client(pg_engine) as client:
        first = _post(
            client,
            venue_id=venue_id,
            order_id=order_id,
            reason="  暴雨停场  ",
        )
        replay = _post(client, venue_id=venue_id, order_id=order_id)
        mismatch = _post(
            client,
            venue_id=venue_id,
            order_id=order_id,
            reason="设备故障",
        )
        active_reuse = _post(
            client,
            venue_id=venue_id,
            order_id=order_id,
            key="venue-refund-key-0007",
            reason="设备故障",
        )
        resource_mismatch = _post(
            client,
            venue_id=venue_id,
            order_id=second_order_id,
            key="venue-refund-key-0007",
            reason="设备故障",
        )

    assert first.status_code == replay.status_code == active_reuse.status_code == 202
    assert first.json() == replay.json() == active_reuse.json()
    assert mismatch.status_code == 409
    assert mismatch.json()["error"]["code"] == "IDEMPOTENCY_KEY_REUSED"
    assert resource_mismatch.status_code == 409
    assert resource_mismatch.json()["error"]["code"] == "IDEMPOTENCY_KEY_REUSED"
    with Session(pg_engine) as session:
        assert session.scalar(select(func.count()).select_from(RefundCase)) == 1
        assert session.scalar(select(func.count()).select_from(RefundAttempt)) == 1


def test_failed_attempt_retries_with_next_stable_merchant_number(
    pg_engine: Engine,
) -> None:
    _, venue_id, order_id, _, _ = _seed(pg_engine)
    with _client(pg_engine) as client:
        first = _post(client, venue_id=venue_id, order_id=order_id)
    assert first.status_code == 202
    with Session(pg_engine) as session:
        first_attempt = session.scalar(select(RefundAttempt))
        assert first_attempt is not None
        first_number = first_attempt.merchant_refund_no
        first_attempt.status = RefundAttemptStatus.FAILED
        first_attempt.failure_code = "PROVIDER_REJECTED"
        first_attempt.next_reconcile_at = None
        order = session.get_one(Order, order_id)
        order.status = OrderStatus.REFUND_FAILED
        session.commit()

    with _client(pg_engine) as client:
        retried = _post(
            client,
            venue_id=venue_id,
            order_id=order_id,
            key="venue-refund-key-retry-0001",
        )

    assert retried.status_code == 202
    with Session(pg_engine) as session:
        attempts = list(
            session.scalars(select(RefundAttempt).order_by(RefundAttempt.attempt_no))
        )
        assert [row.attempt_no for row in attempts] == [1, 2]
        assert attempts[1].merchant_refund_no != first_number
        assert len(attempts[1].merchant_refund_no) <= 32
        assert attempts[1].provider == "wechatpay-live"
        assert attempts[1].next_reconcile_at == NOW
        assert session.get_one(Order, order_id).status is OrderStatus.REFUND_PENDING


def test_authoritative_success_is_read_only_200(pg_engine: Engine) -> None:
    _, venue_id, order_id, _, _ = _seed(pg_engine)
    with _client(pg_engine) as client:
        accepted = _post(client, venue_id=venue_id, order_id=order_id)
    assert accepted.status_code == 202
    with Session(pg_engine) as session:
        attempt = session.scalar(select(RefundAttempt))
        assert attempt is not None
        attempt.status = RefundAttemptStatus.SUCCESS
        attempt.provider_refund_no = "provider-refund-authoritative"
        attempt.refunded_at = NOW + timedelta(minutes=1)
        attempt.next_reconcile_at = None
        session.get_one(Order, order_id).status = OrderStatus.REFUNDED
        before_idempotency = session.scalar(
            select(func.count()).select_from(IdempotencyRecord)
        )
        session.commit()

    with _client(pg_engine) as client:
        original_replay = _post(
            client,
            venue_id=venue_id,
            order_id=order_id,
        )
        response = _post(
            client,
            venue_id=venue_id,
            order_id=order_id,
            key="venue-refund-key-success-0001",
        )

    assert original_replay.status_code == 202
    assert original_replay.json() == {
        "order_id": str(order_id),
        "status": "REFUND_PENDING",
    }
    assert response.status_code == 200
    assert response.json() == {"order_id": str(order_id), "status": "REFUNDED"}
    with Session(pg_engine) as session:
        assert (
            session.scalar(select(func.count()).select_from(IdempotencyRecord))
            == before_idempotency
        )
        attempt = session.scalar(select(RefundAttempt))
        assert attempt is not None
        assert attempt.provider_refund_no == "provider-refund-authoritative"


def test_slot_stays_booked_without_shared_inventory_authority(pg_engine: Engine) -> None:
    _, venue_id, order_id, _, slot_id = _seed(pg_engine)
    with Session(pg_engine) as session:
        target = session.get_one(Order, order_id)
        other_id = uuid.uuid4()
        sealed = PHONE_VAULT.encrypt(
            "13912345678",
            record_type="order",
            record_id=other_id,
            field="contact_phone",
        )
        session.add(
            Order(
                id=other_id,
                order_number=f"PB-{other_id.hex}",
                user=_manager(session, token=f"owner-{other_id.hex}"),
                slot_id=target.slot_id,
                status=OrderStatus.CONFIRMED,
                price_cents=target.price_cents,
                contact_name="并发订单",
                contact_phone_ciphertext=sealed.ciphertext_with_tag,
                contact_phone_nonce=sealed.nonce,
                contact_phone_key_version=sealed.key_version,
                created_at=NOW,
                expires_at=NOW + timedelta(minutes=10),
            )
        )
        session.commit()

    with _client(pg_engine) as client:
        response = _post(client, venue_id=venue_id, order_id=order_id)

    assert response.status_code == 202
    with Session(pg_engine) as session:
        assert session.get_one(Slot, slot_id).status is SlotStatus.BOOKED


def test_database_failure_rolls_back_and_hides_private_error(
    pg_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, venue_id, order_id, _, slot_id = _seed(pg_engine)

    def fail_attempt(*_args: object, **_kwargs: object) -> object:
        raise SQLAlchemyError("private-provider-and-database-detail")

    monkeypatch.setattr(RefundRepository, "get_or_create_attempt", fail_attempt)
    with _client(pg_engine) as client:
        response = _post(client, venue_id=venue_id, order_id=order_id)

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "SERVICE_UNAVAILABLE"
    assert "private-provider" not in response.text
    with Session(pg_engine) as session:
        assert session.scalar(select(func.count()).select_from(RefundCase)) == 0
        assert session.scalar(select(func.count()).select_from(RefundAttempt)) == 0
        assert session.scalar(select(func.count()).select_from(IdempotencyRecord)) == 0
        assert session.get_one(Order, order_id).status is OrderStatus.CONFIRMED
        assert session.get_one(Slot, slot_id).status is SlotStatus.BOOKED


def test_venue_refund_module_has_enqueue_only_boundaries() -> None:
    module_dir = Path(VenueRefundService.__module__.replace(".", "/")).parent
    source = "\n".join(
        path.read_text()
        for path in sorted((Path.cwd() / module_dir).glob("*.py"))
    )
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
    assert not any(name.endswith(".provider") for name in imported_modules)
    assert not any(name.endswith(".convergence") for name in imported_modules)
    repository_source = Path(
        "backend/app/modules/venue_fulfillment/repository.py"
    ).read_text()
    assert "inventory_mutation_authority" not in repository_source
