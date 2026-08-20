from datetime import UTC, datetime, timedelta

import pytest

from backend.app.models import OrderStatus, RefundCasePurpose
from backend.app.modules.orders import lifecycle as order_lifecycle
from backend.app.modules.orders.lifecycle import (
    OrderActorCapability,
    OrderLifecycleFacts,
    is_b2_open_game_eligible,
    project_allowed_actions,
)

NOW = datetime(2026, 8, 18, 12, tzinfo=UTC)


def _facts(
    *,
    status: OrderStatus,
    starts_at: datetime = NOW + timedelta(days=3),
    ends_at: datetime | None = None,
    cancel_requested_at: datetime | None = None,
    checked_in_at: datetime | None = None,
    payment_may_exist: bool = False,
    controlling_refund_purpose: RefundCasePurpose | None = None,
) -> OrderLifecycleFacts:
    return OrderLifecycleFacts(
        status=status,
        starts_at=starts_at,
        ends_at=ends_at or starts_at + timedelta(hours=1),
        cancel_requested_at=cancel_requested_at,
        checked_in_at=checked_in_at,
        payment_may_exist=payment_may_exist,
        controlling_refund_purpose=controlling_refund_purpose,
    )


@pytest.mark.parametrize(
    ("case", "facts", "expected_pay", "expected_cancel", "blocked_reason"),
    [
        (
            "pending order without a payment can be paid or cancelled",
            _facts(status=OrderStatus.PENDING_PAYMENT),
            True,
            True,
            None,
        ),
        (
            "pending order with a possible payment cannot be paid or cancelled",
            _facts(status=OrderStatus.PENDING_PAYMENT, payment_may_exist=True),
            False,
            False,
            "PAYMENT_RESULT_PENDING",
        ),
        (
            "pending cancellation request waits for the payment result",
            _facts(
                status=OrderStatus.PENDING_PAYMENT,
                payment_may_exist=True,
                cancel_requested_at=NOW,
            ),
            False,
            False,
            "PAYMENT_RESULT_PENDING",
        ),
        (
            "confirmed order at the 24 hour cancellation boundary can be cancelled",
            _facts(status=OrderStatus.CONFIRMED, starts_at=NOW + timedelta(hours=24)),
            False,
            True,
            None,
        ),
        (
            "confirmed order inside the 24 hour cancellation window is blocked",
            _facts(
                status=OrderStatus.CONFIRMED,
                starts_at=NOW + timedelta(hours=24) - timedelta(microseconds=1),
            ),
            False,
            False,
            "CANCELLATION_WINDOW_CLOSED",
        ),
        (
            "confirmed order with unresolved cancellation inside 24 hours needs support",
            _facts(
                status=OrderStatus.CONFIRMED,
                starts_at=NOW + timedelta(hours=12),
                cancel_requested_at=NOW,
            ),
            False,
            False,
            "CANCELLATION_REQUIRES_SUPPORT",
        ),
    ],
    ids=lambda case: case,
)
def test_owner_action_projection(
    case: str,
    facts: OrderLifecycleFacts,
    expected_pay: bool,
    expected_cancel: bool,
    blocked_reason: str | None,
) -> None:
    actions = project_allowed_actions(
        facts,
        actor=OrderActorCapability.OWNER,
        now=NOW,
    )

    assert actions.can_pay is expected_pay
    assert actions.can_cancel is expected_cancel
    assert actions.can_check_in is False
    assert actions.can_complete is False
    assert actions.can_refund is False
    assert actions.blocked_reason == blocked_reason


@pytest.mark.parametrize(
    ("case", "facts", "expected"),
    [
        (
            "pending without possible funds cancels locally",
            _facts(status=OrderStatus.PENDING_PAYMENT),
            "CANCEL_LOCALLY",
        ),
        (
            "pending with possible funds records intent and waits",
            _facts(status=OrderStatus.PENDING_PAYMENT, payment_may_exist=True),
            "WAIT_FOR_PAYMENT_RESULT",
        ),
        (
            "confirmed at the 24 hour boundary enqueues a refund",
            _facts(status=OrderStatus.CONFIRMED, starts_at=NOW + timedelta(hours=24)),
            "ENQUEUE_REFUND",
        ),
        (
            "confirmed inside 24 hours is rejected",
            _facts(
                status=OrderStatus.CONFIRMED,
                starts_at=NOW + timedelta(hours=24) - timedelta(microseconds=1),
            ),
            "REJECT_ORDER_STATE",
        ),
        (
            "checked in confirmed order is rejected",
            _facts(
                status=OrderStatus.CONFIRMED,
                checked_in_at=NOW - timedelta(minutes=1),
            ),
            "REJECT_ORDER_STATE",
        ),
        (
            "failed owner refund can be retried",
            _facts(status=OrderStatus.REFUND_FAILED),
            "RETRY_REFUND",
        ),
        (
            "active owner refund is not duplicated",
            _facts(status=OrderStatus.REFUND_PENDING),
            "REFUND_IN_PROGRESS",
        ),
        (
            "cancelled order returns its terminal projection",
            _facts(status=OrderStatus.CANCELLED),
            "RETURN_CANCELLED",
        ),
    ],
    ids=lambda case: case,
)
def test_owner_cancellation_command_decision(
    case: str,
    facts: OrderLifecycleFacts,
    expected: str,
) -> None:
    assert order_lifecycle.decide_owner_cancellation(facts, now=NOW) == expected


@pytest.mark.parametrize(
    ("case", "actor", "facts", "expected_refund", "blocked_reason"),
    [
        (
            "venue manager can refund an unfulfilled confirmed order",
            OrderActorCapability.VENUE_MANAGER,
            _facts(status=OrderStatus.CONFIRMED),
            True,
            "CHECK_IN_TOO_EARLY",
        ),
        (
            "owner cannot use venue refund action",
            OrderActorCapability.OWNER,
            _facts(status=OrderStatus.CONFIRMED, starts_at=NOW + timedelta(hours=12)),
            False,
            "CANCELLATION_WINDOW_CLOSED",
        ),
        (
            "terminal order cannot be refunded",
            OrderActorCapability.VENUE_MANAGER,
            _facts(status=OrderStatus.CANCELLED),
            False,
            "ORDER_TERMINAL",
        ),
        (
            "checked-in order cannot be refunded",
            OrderActorCapability.VENUE_MANAGER,
            _facts(
                status=OrderStatus.CONFIRMED,
                starts_at=NOW - timedelta(minutes=30),
                checked_in_at=NOW - timedelta(minutes=15),
            ),
            False,
            "SESSION_NOT_ENDED",
        ),
    ],
    ids=lambda case: case,
)
def test_venue_refund_projection(
    case: str,
    actor: OrderActorCapability,
    facts: OrderLifecycleFacts,
    expected_refund: bool,
    blocked_reason: str | None,
) -> None:
    actions = project_allowed_actions(facts, actor=actor, now=NOW)

    assert actions.can_refund is expected_refund
    assert actions.blocked_reason == blocked_reason


@pytest.mark.parametrize(
    "actor",
    [OrderActorCapability.OWNER, OrderActorCapability.VENUE_MANAGER],
)
def test_refund_pending_blocks_every_action_for_each_actor(
    actor: OrderActorCapability,
) -> None:
    actions = project_allowed_actions(
        _facts(status=OrderStatus.REFUND_PENDING),
        actor=actor,
        now=NOW,
    )

    assert actions.can_pay is False
    assert actions.can_cancel is False
    assert actions.can_check_in is False
    assert actions.can_complete is False
    assert actions.can_refund is False
    assert actions.blocked_reason == "REFUND_IN_PROGRESS"


@pytest.mark.parametrize(
    ("case", "facts", "expected_check_in", "blocked_reason"),
    [
        (
            "check-in opens exactly two hours before the booking",
            _facts(status=OrderStatus.CONFIRMED, starts_at=NOW + timedelta(hours=2)),
            True,
            None,
        ),
        (
            "check-in remains closed one microsecond before its window",
            _facts(
                status=OrderStatus.CONFIRMED,
                starts_at=NOW + timedelta(hours=2, microseconds=1),
            ),
            False,
            "CHECK_IN_TOO_EARLY",
        ),
    ],
    ids=lambda case: case,
)
def test_check_in_projection(
    case: str,
    facts: OrderLifecycleFacts,
    expected_check_in: bool,
    blocked_reason: str | None,
) -> None:
    actions = project_allowed_actions(
        facts,
        actor=OrderActorCapability.VENUE_MANAGER,
        now=NOW,
    )

    assert actions.can_check_in is expected_check_in
    assert actions.blocked_reason == blocked_reason


@pytest.mark.parametrize(
    ("case", "facts", "expected_complete", "blocked_reason"),
    [
        (
            "checked-in confirmed order can complete at its end time",
            _facts(
                status=OrderStatus.CONFIRMED,
                starts_at=NOW - timedelta(hours=1),
                ends_at=NOW,
                checked_in_at=NOW - timedelta(minutes=30),
            ),
            True,
            None,
        ),
        (
            "completion requires check-in",
            _facts(
                status=OrderStatus.CONFIRMED,
                starts_at=NOW - timedelta(hours=2),
                ends_at=NOW - timedelta(hours=1),
            ),
            False,
            "CHECK_IN_REQUIRED",
        ),
        (
            "completion waits for the booking to end",
            _facts(
                status=OrderStatus.CONFIRMED,
                starts_at=NOW - timedelta(minutes=30),
                ends_at=NOW + timedelta(minutes=30),
                checked_in_at=NOW - timedelta(minutes=15),
            ),
            False,
            "SESSION_NOT_ENDED",
        ),
    ],
    ids=lambda case: case,
)
def test_completion_projection(
    case: str,
    facts: OrderLifecycleFacts,
    expected_complete: bool,
    blocked_reason: str | None,
) -> None:
    actions = project_allowed_actions(
        facts,
        actor=OrderActorCapability.VENUE_MANAGER,
        now=NOW,
    )

    assert actions.can_complete is expected_complete
    assert actions.blocked_reason == blocked_reason


@pytest.mark.parametrize(
    ("case", "facts", "expected"),
    [
        (
            "confirmed order more than two hours away is eligible",
            _facts(
                status=OrderStatus.CONFIRMED,
                starts_at=NOW + timedelta(hours=2, microseconds=1),
            ),
            True,
        ),
        (
            "order at exactly two hours is not eligible",
            _facts(status=OrderStatus.CONFIRMED, starts_at=NOW + timedelta(hours=2)),
            False,
        ),
        (
            "cancel request blocks eligibility",
            _facts(
                status=OrderStatus.CONFIRMED,
                cancel_requested_at=NOW,
            ),
            False,
        ),
        (
            "order cancellation case blocks eligibility",
            _facts(
                status=OrderStatus.CONFIRMED,
                controlling_refund_purpose=RefundCasePurpose.ORDER_CANCELLATION,
            ),
            False,
        ),
        (
            "payment inventory conflict blocks eligibility",
            _facts(
                status=OrderStatus.CONFIRMED,
                controlling_refund_purpose=RefundCasePurpose.PAYMENT_INVENTORY_CONFLICT,
            ),
            False,
        ),
        (
            "duplicate charge case does not block eligibility",
            _facts(
                status=OrderStatus.CONFIRMED,
                controlling_refund_purpose=RefundCasePurpose.DUPLICATE_CHARGE,
            ),
            True,
        ),
        (
            "non-confirmed order is not eligible",
            _facts(status=OrderStatus.PENDING_PAYMENT),
            False,
        ),
    ],
    ids=lambda case: case,
)
def test_b2_open_game_eligibility(
    case: str,
    facts: OrderLifecycleFacts,
    expected: bool,
) -> None:
    assert is_b2_open_game_eligible(facts, now=NOW) is expected
