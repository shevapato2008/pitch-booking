from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from backend.app.models import (
    Order,
    OrderStatus,
    RefundAttempt,
    RefundAttemptStatus,
    RefundCase,
    RefundCasePurpose,
    RefundReason,
    Slot,
    SlotStatus,
)
from backend.app.modules.refunds.convergence import RefundConvergenceService
from backend.app.modules.refunds.provider import (
    AuthoritativeRefundFacts,
    QueryRefundResult,
    QueryRefundStatus,
)
from backend.tests.test_payment_settlement import session_factory
from backend.tests.test_refund_repository import (
    _add_attempt,
    _add_case,
    _seed_successful_payment,
)

pytestmark = pytest.mark.integration
NOW = datetime(2026, 8, 19, 4, tzinfo=UTC)


def seed_refund(
    engine: Engine,
    *,
    purpose: RefundCasePurpose,
    reason: RefundReason,
    applied: bool,
    with_other_applied: bool = False,
) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID]:
    order_id, payment_id, slot_id = _seed_successful_payment(
        engine, applied=applied, with_other_applied=with_other_applied
    )
    with Session(engine) as session:
        refund_case = _add_case(session, order_id=order_id, payment_id=payment_id, purpose=purpose)
        refund_case.reason = reason
        if reason is RefundReason.VENUE_CANCELLED:
            refund_case.reason_note = "场馆临时关闭"
        attempt = _add_attempt(
            session,
            refund_case_id=refund_case.id,
            attempt_no=1,
            status=RefundAttemptStatus.PROCESSING,
            next_reconcile_at=NOW,
        )
        if purpose is not RefundCasePurpose.DUPLICATE_CHARGE:
            order = session.get_one(Order, order_id)
            order.status = OrderStatus.REFUND_PENDING
            order.cancel_requested_at = NOW
            order.cancelled_at = NOW
        session.commit()
        return order_id, payment_id, slot_id, attempt.id


def service(engine: Engine) -> RefundConvergenceService:
    return RefundConvergenceService(
        session_factory=session_factory(engine),
        expected_merchant_id="1900000109",
        now=lambda: NOW,
    )


def success_result(engine: Engine, attempt_id: uuid.UUID) -> QueryRefundResult:
    with Session(engine) as session:
        attempt = session.get_one(RefundAttempt, attempt_id)
        refund_case = session.get_one(RefundCase, attempt.refund_case_id)
        payment = refund_case.payment
        facts = AuthoritativeRefundFacts(
            provider="wechat",
            merchant_id="1900000109",
            merchant_refund_no=attempt.merchant_refund_no,
            provider_refund_no=f"refund-{uuid.uuid4()}",
            merchant_order_no=payment.merchant_order_no,
            provider_transaction_no=payment.provider_transaction_no or "",
            amount_cents=payment.amount_cents,
            currency="CNY",
            refunded_at=NOW,
        )
    return QueryRefundResult(QueryRefundStatus.SUCCESS, facts=facts)


def test_user_cancellation_releases_only_owned_slot_after_authoritative_success(
    pg_engine: Engine,
) -> None:
    order_id, _, slot_id, attempt_id = seed_refund(
        pg_engine,
        purpose=RefundCasePurpose.ORDER_CANCELLATION,
        reason=RefundReason.USER_CANCELLED,
        applied=True,
    )

    service(pg_engine).converge(
        attempt_id=attempt_id,
        provider="wechat",
        result=success_result(pg_engine, attempt_id),
    )

    with Session(pg_engine) as session:
        attempt = session.get_one(RefundAttempt, attempt_id)
        assert attempt.status is RefundAttemptStatus.SUCCESS
        assert attempt.refunded_at == NOW
        assert session.get_one(Order, order_id).status is OrderStatus.REFUNDED
        assert session.get_one(Slot, slot_id).status is SlotStatus.AVAILABLE


def test_venue_cancellation_closes_owned_slot_while_processing_and_after_success(
    pg_engine: Engine,
) -> None:
    order_id, _, slot_id, attempt_id = seed_refund(
        pg_engine,
        purpose=RefundCasePurpose.ORDER_CANCELLATION,
        reason=RefundReason.VENUE_CANCELLED,
        applied=True,
    )

    service(pg_engine).converge(
        attempt_id=attempt_id,
        provider="wechat",
        result=QueryRefundResult(QueryRefundStatus.PROCESSING),
    )
    with Session(pg_engine) as session:
        assert session.get_one(Order, order_id).status is OrderStatus.REFUND_PENDING
        assert session.get_one(Slot, slot_id).status is SlotStatus.CLOSED

    service(pg_engine).converge(
        attempt_id=attempt_id,
        provider="wechat",
        result=success_result(pg_engine, attempt_id),
    )
    with Session(pg_engine) as session:
        assert session.get_one(Order, order_id).status is OrderStatus.REFUNDED
        assert session.get_one(Slot, slot_id).status is SlotStatus.CLOSED


@pytest.mark.parametrize(
    ("purpose", "applied", "with_other_applied", "expected_order"),
    [
        (RefundCasePurpose.DUPLICATE_CHARGE, False, True, OrderStatus.CONFIRMED),
        (
            RefundCasePurpose.PAYMENT_INVENTORY_CONFLICT,
            False,
            False,
            OrderStatus.REFUNDED,
        ),
    ],
)
def test_automatic_refund_success_never_mutates_slot(
    pg_engine: Engine,
    purpose: RefundCasePurpose,
    applied: bool,
    with_other_applied: bool,
    expected_order: OrderStatus,
) -> None:
    order_id, _, slot_id, attempt_id = seed_refund(
        pg_engine,
        purpose=purpose,
        reason=RefundReason.AUTOMATIC_RECOVERY,
        applied=applied,
        with_other_applied=with_other_applied,
    )
    with Session(pg_engine) as session:
        original_slot = session.get_one(Slot, slot_id).status

    service(pg_engine).converge(
        attempt_id=attempt_id,
        provider="wechat",
        result=success_result(pg_engine, attempt_id),
    )

    with Session(pg_engine) as session:
        assert session.get_one(Order, order_id).status is expected_order
        assert session.get_one(Slot, slot_id).status is original_slot


def test_authoritative_mismatch_stays_unknown_and_never_releases_inventory(
    pg_engine: Engine,
) -> None:
    order_id, _, slot_id, attempt_id = seed_refund(
        pg_engine,
        purpose=RefundCasePurpose.ORDER_CANCELLATION,
        reason=RefundReason.USER_CANCELLED,
        applied=True,
    )
    valid = success_result(pg_engine, attempt_id)
    assert valid.facts is not None
    invalid = QueryRefundResult(
        QueryRefundStatus.SUCCESS,
        facts=AuthoritativeRefundFacts(
            provider=valid.facts.provider,
            merchant_id=valid.facts.merchant_id,
            merchant_refund_no=valid.facts.merchant_refund_no,
            provider_refund_no=valid.facts.provider_refund_no,
            merchant_order_no=valid.facts.merchant_order_no,
            provider_transaction_no=valid.facts.provider_transaction_no,
            amount_cents=1,
            currency="CNY",
            refunded_at=valid.facts.refunded_at,
        ),
    )

    service(pg_engine).converge(attempt_id=attempt_id, provider="wechat", result=invalid)

    with Session(pg_engine) as session:
        attempt = session.get_one(RefundAttempt, attempt_id)
        assert attempt.status is RefundAttemptStatus.UNKNOWN
        assert attempt.failure_code == "REFUND_AMOUNT_MISMATCH"
        assert session.get_one(Order, order_id).status is OrderStatus.REFUND_PENDING
        assert session.get_one(Slot, slot_id).status is SlotStatus.BOOKED


def test_failed_and_stale_claim_have_closed_results(pg_engine: Engine) -> None:
    order_id, _, _, attempt_id = seed_refund(
        pg_engine,
        purpose=RefundCasePurpose.ORDER_CANCELLATION,
        reason=RefundReason.USER_CANCELLED,
        applied=True,
    )
    with Session(pg_engine) as session:
        attempt = session.get_one(RefundAttempt, attempt_id)
        attempt.reconcile_claim_token = uuid.uuid4()
        attempt.reconcile_lease_until = NOW + timedelta(minutes=10)
        claim = attempt.reconcile_claim_token
        session.commit()

    stale = service(pg_engine).converge(
        attempt_id=attempt_id,
        provider="wechat",
        result=QueryRefundResult(
            QueryRefundStatus.FAILED, safe_error_code="WECHAT_PAY_REFUND_CLOSED"
        ),
        claim_token=uuid.uuid4(),
    )
    assert stale.terminal is False
    service(pg_engine).converge(
        attempt_id=attempt_id,
        provider="wechat",
        result=QueryRefundResult(
            QueryRefundStatus.FAILED, safe_error_code="WECHAT_PAY_REFUND_CLOSED"
        ),
        claim_token=claim,
    )
    with Session(pg_engine) as session:
        assert session.get_one(RefundAttempt, attempt_id).status is RefundAttemptStatus.FAILED
        assert session.get_one(Order, order_id).status is OrderStatus.REFUND_FAILED
