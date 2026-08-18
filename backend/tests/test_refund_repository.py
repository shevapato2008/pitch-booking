import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from threading import Barrier

import pytest
from sqlalchemy import Engine, event, func, select
from sqlalchemy.orm import Session

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
    SlotStatus,
    User,
)
from backend.app.modules.refunds.repository import (
    RefundPurposeMismatchError,
    RefundRepository,
)
from backend.tests.test_schema_constraints import add_pitch, add_slot, venue

pytestmark = pytest.mark.integration

NOW = datetime(2026, 8, 18, 4, tzinfo=UTC)


def _merchant_number(prefix: str = "PB") -> str:
    return f"{prefix}{uuid.uuid4().hex[:30]}"


def _seed_successful_payment(
    engine: Engine,
    *,
    applied: bool,
    with_other_applied: bool = False,
) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    with Session(engine) as session:
        user = User(wechat_app_id="wx-test", wechat_openid=f"openid-{uuid.uuid4()}")
        pitch = add_pitch(session, venue())
        slot = add_slot(
            session,
            pitch,
            NOW + timedelta(days=1),
            NOW + timedelta(days=1, hours=2),
        )
        order = Order(
            id=uuid.uuid4(),
            order_number=_merchant_number("O"),
            user=user,
            slot=slot,
            status=OrderStatus.CONFIRMED,
            price_cents=32000,
            contact_name="张三",
            contact_phone_ciphertext=b"encrypted-phone-value",
            contact_phone_nonce=b"abcdefghijkl",
            contact_phone_key_version=1,
            created_at=NOW,
            expires_at=NOW + timedelta(minutes=10),
        )
        target = Payment(
            id=uuid.uuid4(),
            order=order,
            provider="wechat",
            merchant_order_no=_merchant_number(),
            provider_transaction_no=f"tx-{uuid.uuid4()}",
            amount_cents=32000,
            currency="CNY",
            status=PaymentState.SUCCESS,
            paid_at=NOW,
            applied_to_order_at=NOW if applied else None,
        )
        session.add_all([order, target])
        if with_other_applied:
            session.add(
                Payment(
                    id=uuid.uuid4(),
                    order=order,
                    provider="wechat",
                    merchant_order_no=_merchant_number(),
                    provider_transaction_no=f"tx-{uuid.uuid4()}",
                    amount_cents=32000,
                    currency="CNY",
                    status=PaymentState.SUCCESS,
                    paid_at=NOW,
                    applied_to_order_at=NOW,
                )
            )
        slot.status = SlotStatus.BOOKED
        session.commit()
        return order.id, target.id, slot.id


def _add_case(
    session: Session,
    *,
    order_id: uuid.UUID,
    payment_id: uuid.UUID,
    purpose: RefundCasePurpose,
) -> RefundCase:
    refund_case = RefundCase(
        id=uuid.uuid4(),
        order_id=order_id,
        payment_id=payment_id,
        purpose=purpose,
        reason=RefundReason.AUTOMATIC_RECOVERY,
        reason_note=None,
        requested_by_user_id=None,
        amount_cents=32000,
        currency="CNY",
    )
    session.add(refund_case)
    session.flush()
    return refund_case


def _add_attempt(
    session: Session,
    *,
    refund_case_id: uuid.UUID,
    attempt_no: int,
    status: RefundAttemptStatus,
    next_reconcile_at: datetime | None = None,
) -> RefundAttempt:
    attempt = RefundAttempt(
        id=uuid.uuid4(),
        refund_case_id=refund_case_id,
        provider="wechat",
        merchant_refund_no=_merchant_number("R"),
        status=status,
        attempt_no=attempt_no,
        next_reconcile_at=next_reconcile_at,
        refunded_at=NOW if status is RefundAttemptStatus.SUCCESS else None,
    )
    session.add(attempt)
    session.flush()
    return attempt


def test_lock_graph_uses_slot_order_payment_case_attempt_order(pg_engine: Engine) -> None:
    order_id, payment_id, _ = _seed_successful_payment(pg_engine, applied=True)
    with Session(pg_engine) as session:
        refund_case = _add_case(
            session,
            order_id=order_id,
            payment_id=payment_id,
            purpose=RefundCasePurpose.ORDER_CANCELLATION,
        )
        _add_attempt(
            session,
            refund_case_id=refund_case.id,
            attempt_no=1,
            status=RefundAttemptStatus.UNKNOWN,
        )
        session.commit()

    statements: list[str] = []

    def record_lock_statement(
        _conn: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        if "FOR UPDATE" in statement.upper():
            statements.append(statement.lower())

    event.listen(pg_engine, "before_cursor_execute", record_lock_statement)
    try:
        with Session(pg_engine) as session:
            graph = RefundRepository(session).lock_refund_graph(payment_id)
            assert graph.refund_case is not None
            assert graph.latest_attempt is not None
            session.rollback()
    finally:
        event.remove(pg_engine, "before_cursor_execute", record_lock_statement)

    lock_tables = [
        next(
            table
            for table in (
                "slots",
                "orders",
                "payments",
                "refund_cases",
                "refund_attempts",
            )
            if f"from {table}" in statement
        )
        for statement in statements
    ]
    assert lock_tables == [
        "slots",
        "orders",
        "payments",
        "refund_cases",
        "refund_attempts",
    ]


def test_lookup_and_create_case_are_bound_to_successful_payment_id(
    pg_engine: Engine,
) -> None:
    order_id, payment_id, _ = _seed_successful_payment(pg_engine, applied=True)

    with Session(pg_engine) as session:
        repository = RefundRepository(session)
        assert repository.locate_successful_payment(payment_id) is not None
        graph = repository.lock_refund_graph(payment_id)
        refund_case, created = repository.get_or_create_case(
            graph=graph,
            purpose=RefundCasePurpose.ORDER_CANCELLATION,
            reason=RefundReason.USER_CANCELLED,
            reason_note=None,
            requested_by_user_id=None,
        )
        assert refund_case.order_id == order_id
        assert refund_case.payment_id == payment_id
        assert refund_case.amount_cents == 32000
        assert refund_case.currency == "CNY"
        session.commit()

    assert created is True

    _, non_success_payment_id, _ = _seed_successful_payment(pg_engine, applied=False)
    with Session(pg_engine) as session:
        payment = session.get_one(Payment, non_success_payment_id)
        payment.status = PaymentState.CLOSED
        payment.paid_at = None
        session.commit()
    with Session(pg_engine) as session:
        repository = RefundRepository(session)
        assert repository.locate_successful_payment(non_success_payment_id) is None
        with pytest.raises(LookupError, match="successful payment"):
            repository.lock_refund_graph(non_success_payment_id)


@pytest.mark.parametrize(
    ("purpose", "applied", "with_other_applied", "allowed"),
    [
        (RefundCasePurpose.ORDER_CANCELLATION, True, False, True),
        (RefundCasePurpose.ORDER_CANCELLATION, False, False, False),
        (RefundCasePurpose.DUPLICATE_CHARGE, False, True, True),
        (RefundCasePurpose.DUPLICATE_CHARGE, False, False, False),
        (RefundCasePurpose.DUPLICATE_CHARGE, True, False, False),
        (RefundCasePurpose.PAYMENT_INVENTORY_CONFLICT, False, False, True),
        (RefundCasePurpose.PAYMENT_INVENTORY_CONFLICT, False, True, False),
        (RefundCasePurpose.PAYMENT_INVENTORY_CONFLICT, True, False, False),
    ],
)
def test_case_creation_enforces_shared_purpose_predicate(
    pg_engine: Engine,
    purpose: RefundCasePurpose,
    applied: bool,
    with_other_applied: bool,
    allowed: bool,
) -> None:
    _, payment_id, _ = _seed_successful_payment(
        pg_engine,
        applied=applied,
        with_other_applied=with_other_applied,
    )

    with Session(pg_engine) as session:
        repository = RefundRepository(session)
        graph = repository.lock_refund_graph(payment_id)
        assert repository.purpose_is_valid(graph=graph, purpose=purpose) is allowed
        if allowed:
            _, created = repository.get_or_create_case(
                graph=graph,
                purpose=purpose,
                reason=RefundReason.AUTOMATIC_RECOVERY,
                reason_note=None,
                requested_by_user_id=None,
            )
            assert created is True
        else:
            with pytest.raises(RefundPurposeMismatchError):
                repository.get_or_create_case(
                    graph=graph,
                    purpose=purpose,
                    reason=RefundReason.AUTOMATIC_RECOVERY,
                    reason_note=None,
                    requested_by_user_id=None,
                )
        session.rollback()


def _add_competing_order(
    engine: Engine,
    *,
    slot_id: uuid.UUID,
    status: OrderStatus,
) -> None:
    with Session(engine) as session:
        actor = User(wechat_app_id="wx-test", wechat_openid=f"other-{uuid.uuid4()}")
        session.add(actor)
        session.flush()
        timestamps: dict[str, object] = {}
        if status in {OrderStatus.REFUND_PENDING, OrderStatus.REFUND_FAILED}:
            timestamps = {"cancel_requested_at": NOW, "cancelled_at": NOW}
        elif status is OrderStatus.COMPLETED:
            timestamps = {
                "checked_in_at": NOW,
                "checked_in_by_user_id": actor.id,
                "completed_at": NOW,
                "completed_by_user_id": actor.id,
            }
        session.add(
            Order(
                id=uuid.uuid4(),
                order_number=_merchant_number("O"),
                user=actor,
                slot_id=slot_id,
                status=status,
                price_cents=32000,
                contact_name="李四",
                contact_phone_ciphertext=b"encrypted-phone-value",
                contact_phone_nonce=b"abcdefghijkl",
                contact_phone_key_version=1,
                created_at=NOW,
                expires_at=NOW + timedelta(minutes=10),
                **timestamps,
            )
        )
        session.commit()


@pytest.mark.parametrize(
    "status",
    [
        OrderStatus.CONFIRMED,
        OrderStatus.REFUND_PENDING,
        OrderStatus.REFUND_FAILED,
        OrderStatus.COMPLETED,
    ],
)
def test_inventory_authority_denies_another_booking_owner(
    pg_engine: Engine,
    status: OrderStatus,
) -> None:
    order_id, payment_id, slot_id = _seed_successful_payment(pg_engine, applied=True)
    with Session(pg_engine) as session:
        _add_case(
            session,
            order_id=order_id,
            payment_id=payment_id,
            purpose=RefundCasePurpose.ORDER_CANCELLATION,
        )
        session.commit()
    _add_competing_order(pg_engine, slot_id=slot_id, status=status)

    with Session(pg_engine) as session:
        repository = RefundRepository(session)
        graph = repository.lock_refund_graph(payment_id)
        assert repository.inventory_mutation_authority(graph) is None
        session.rollback()


def test_inventory_authority_requires_case_order_slot_ownership(pg_engine: Engine) -> None:
    order_id, payment_id, _ = _seed_successful_payment(pg_engine, applied=True)
    with Session(pg_engine) as session:
        _add_case(
            session,
            order_id=order_id,
            payment_id=payment_id,
            purpose=RefundCasePurpose.ORDER_CANCELLATION,
        )
        session.commit()

    with Session(pg_engine) as session:
        repository = RefundRepository(session)
        graph = repository.lock_refund_graph(payment_id)
        authority = repository.inventory_mutation_authority(graph)
        assert authority is not None
        assert authority.slot_id == graph.slot.id
        assert authority.order_id == graph.order.id

        other_order_id, other_payment_id, _ = _seed_successful_payment(
            pg_engine, applied=True
        )
        with Session(pg_engine) as other_session:
            other_graph = RefundRepository(other_session).lock_refund_graph(other_payment_id)
            mismatched = replace(graph, slot=other_graph.slot)
            assert repository.inventory_mutation_authority(mismatched) is None
            other_session.rollback()
        session.rollback()
    assert other_order_id != order_id


def test_latest_attempt_and_due_lease_claim(pg_engine: Engine) -> None:
    order_id, payment_id, _ = _seed_successful_payment(pg_engine, applied=True)
    with Session(pg_engine) as session:
        refund_case = _add_case(
            session,
            order_id=order_id,
            payment_id=payment_id,
            purpose=RefundCasePurpose.ORDER_CANCELLATION,
        )
        _add_attempt(
            session,
            refund_case_id=refund_case.id,
            attempt_no=1,
            status=RefundAttemptStatus.FAILED,
        )
        latest = _add_attempt(
            session,
            refund_case_id=refund_case.id,
            attempt_no=2,
            status=RefundAttemptStatus.UNKNOWN,
            next_reconcile_at=NOW,
        )
        latest_id = latest.id
        session.commit()

    with Session(pg_engine) as session:
        repository = RefundRepository(session)
        graph = repository.lock_refund_graph(payment_id)
        assert repository.latest_attempt(graph) is not None
        assert repository.latest_attempt(graph).id == latest_id  # type: ignore[union-attr]
        session.rollback()

    lease_until = NOW + timedelta(minutes=10)
    with Session(pg_engine) as first:
        claim = RefundRepository(first).claim_next_due_attempt(
            now=NOW,
            provider="wechat",
            lease_until=lease_until,
        )
        assert claim is not None and claim.attempt_id == latest_id
        first.commit()
    with Session(pg_engine) as second:
        assert (
            RefundRepository(second).claim_next_due_attempt(
                now=NOW,
                provider="wechat",
                lease_until=lease_until,
            )
            is None
        )
        second.rollback()


def test_two_sessions_cannot_create_two_cases_for_same_payment(pg_engine: Engine) -> None:
    _, payment_id, _ = _seed_successful_payment(pg_engine, applied=True)
    barrier = Barrier(2)

    def create_case() -> tuple[uuid.UUID, bool]:
        with Session(pg_engine) as session:
            barrier.wait()
            repository = RefundRepository(session)
            graph = repository.lock_refund_graph(payment_id)
            refund_case, created = repository.get_or_create_case(
                graph=graph,
                purpose=RefundCasePurpose.ORDER_CANCELLATION,
                reason=RefundReason.USER_CANCELLED,
                reason_note=None,
                requested_by_user_id=None,
            )
            session.commit()
            return refund_case.id, created

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _index: create_case(), range(2)))

    assert len({case_id for case_id, _created in results}) == 1
    assert sorted(created for _case_id, created in results) == [False, True]
    with Session(pg_engine) as session:
        assert session.scalar(select(func.count()).select_from(RefundCase)) == 1


def test_attempt_creation_starts_at_one_and_retries_only_after_failed(
    pg_engine: Engine,
) -> None:
    _, payment_id, _ = _seed_successful_payment(pg_engine, applied=True)
    with Session(pg_engine) as session:
        repository = RefundRepository(session)
        graph = repository.lock_refund_graph(payment_id)
        repository.get_or_create_case(
            graph=graph,
            purpose=RefundCasePurpose.ORDER_CANCELLATION,
            reason=RefundReason.USER_CANCELLED,
            reason_note=None,
            requested_by_user_id=None,
        )
        first, created = repository.get_or_create_attempt(
            graph=graph,
            provider="wechat",
            merchant_refund_no=_merchant_number("R"),
            next_reconcile_at=NOW,
        )
        assert created is True
        assert first.attempt_no == 1
        assert first.status is RefundAttemptStatus.CREATING
        first_id = first.id
        session.commit()

    with Session(pg_engine) as session:
        first = session.get_one(RefundAttempt, first_id)
        first.status = RefundAttemptStatus.FAILED
        session.commit()

    with Session(pg_engine) as session:
        repository = RefundRepository(session)
        graph = repository.lock_refund_graph(payment_id)
        second, created = repository.get_or_create_attempt(
            graph=graph,
            provider="wechat",
            merchant_refund_no=_merchant_number("R"),
            next_reconcile_at=NOW,
        )
        assert created is True
        assert second.id != first_id
        assert second.attempt_no == 2
        assert second.status is RefundAttemptStatus.CREATING
        session.commit()


def test_unknown_active_attempt_prevents_second_active_attempt(pg_engine: Engine) -> None:
    order_id, payment_id, _ = _seed_successful_payment(pg_engine, applied=True)
    with Session(pg_engine) as session:
        refund_case = _add_case(
            session,
            order_id=order_id,
            payment_id=payment_id,
            purpose=RefundCasePurpose.ORDER_CANCELLATION,
        )
        existing = _add_attempt(
            session,
            refund_case_id=refund_case.id,
            attempt_no=1,
            status=RefundAttemptStatus.UNKNOWN,
            next_reconcile_at=NOW,
        )
        existing_id = existing.id
        session.commit()

    with Session(pg_engine) as session:
        repository = RefundRepository(session)
        graph = repository.lock_refund_graph(payment_id)
        attempt, created = repository.get_or_create_attempt(
            graph=graph,
            provider="wechat",
            merchant_refund_no=_merchant_number("R"),
            next_reconcile_at=NOW,
        )
        assert attempt.id == existing_id
        session.commit()

    assert created is False
    with Session(pg_engine) as session:
        assert session.scalar(select(func.count()).select_from(RefundAttempt)) == 1
