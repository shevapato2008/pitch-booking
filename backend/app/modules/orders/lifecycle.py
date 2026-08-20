"""Pure, server-authoritative order lifecycle policy."""

from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum
from typing import Literal

from backend.app.models import OrderStatus, RefundCasePurpose


class OrderActorCapability(StrEnum):
    OWNER = "OWNER"
    VENUE_MANAGER = "VENUE_MANAGER"


class OwnerCancellationDecision(StrEnum):
    CANCEL_LOCALLY = "CANCEL_LOCALLY"
    WAIT_FOR_PAYMENT_RESULT = "WAIT_FOR_PAYMENT_RESULT"
    ENQUEUE_REFUND = "ENQUEUE_REFUND"
    RETRY_REFUND = "RETRY_REFUND"
    RETURN_CANCELLED = "RETURN_CANCELLED"
    REFUND_IN_PROGRESS = "REFUND_IN_PROGRESS"
    REJECT_ORDER_STATE = "REJECT_ORDER_STATE"


BlockedReason = Literal[
    "PAYMENT_RESULT_PENDING",
    "CANCELLATION_WINDOW_CLOSED",
    "REFUND_IN_PROGRESS",
    "CHECK_IN_TOO_EARLY",
    "CHECK_IN_REQUIRED",
    "SESSION_NOT_ENDED",
    "ORDER_TERMINAL",
    "CANCELLATION_REQUIRES_SUPPORT",
]


@dataclass(frozen=True, slots=True)
class OrderLifecycleFacts:
    """Facts projected from server-owned order, payment, and refund state.

    ``payment_may_exist`` is calculated from locked payment rows and is never a
    request input.
    """

    status: OrderStatus
    starts_at: datetime
    ends_at: datetime
    cancel_requested_at: datetime | None
    checked_in_at: datetime | None
    payment_may_exist: bool
    controlling_refund_purpose: RefundCasePurpose | None


@dataclass(frozen=True, slots=True)
class OrderAllowedActions:
    can_pay: bool
    can_cancel: bool
    can_check_in: bool
    can_complete: bool
    can_refund: bool
    blocked_reason: BlockedReason | None


def project_allowed_actions(
    facts: OrderLifecycleFacts,
    *,
    actor: OrderActorCapability,
    now: datetime,
) -> OrderAllowedActions:
    """Project the actions available to the already-authorized actor capability."""
    if actor is OrderActorCapability.OWNER:
        return _project_owner_actions(facts, now=now)
    return _project_venue_manager_actions(facts, now=now)


def is_b2_open_game_eligible(facts: OrderLifecycleFacts, *, now: datetime) -> bool:
    """Return whether a confirmed booking can seed a B2 open game."""
    return (
        facts.status is OrderStatus.CONFIRMED
        and facts.cancel_requested_at is None
        and facts.controlling_refund_purpose
        not in {
            RefundCasePurpose.ORDER_CANCELLATION,
            RefundCasePurpose.PAYMENT_INVENTORY_CONFLICT,
        }
        and facts.starts_at > now + timedelta(hours=2)
    )


def decide_owner_cancellation(
    facts: OrderLifecycleFacts,
    *,
    now: datetime,
) -> OwnerCancellationDecision:
    """Choose the owner cancellation command without performing any writes."""
    if facts.status is OrderStatus.PENDING_PAYMENT:
        if facts.payment_may_exist:
            return OwnerCancellationDecision.WAIT_FOR_PAYMENT_RESULT
        return OwnerCancellationDecision.CANCEL_LOCALLY

    if facts.status is OrderStatus.CANCELLED:
        return OwnerCancellationDecision.RETURN_CANCELLED
    if facts.status is OrderStatus.REFUND_PENDING:
        return OwnerCancellationDecision.REFUND_IN_PROGRESS
    if facts.status is OrderStatus.REFUND_FAILED:
        return OwnerCancellationDecision.RETRY_REFUND

    if facts.status is OrderStatus.CONFIRMED:
        if (
            facts.checked_in_at is not None
            or facts.starts_at - now < timedelta(hours=24)
        ):
            return OwnerCancellationDecision.REJECT_ORDER_STATE
        if facts.controlling_refund_purpose is not None:
            return OwnerCancellationDecision.REFUND_IN_PROGRESS
        return OwnerCancellationDecision.ENQUEUE_REFUND

    return OwnerCancellationDecision.REJECT_ORDER_STATE


def _project_owner_actions(
    facts: OrderLifecycleFacts, *, now: datetime
) -> OrderAllowedActions:
    if facts.status is OrderStatus.PENDING_PAYMENT:
        if facts.payment_may_exist or facts.cancel_requested_at is not None:
            return _blocked("PAYMENT_RESULT_PENDING")
        return OrderAllowedActions(True, True, False, False, False, None)

    if facts.status is OrderStatus.REFUND_FAILED:
        return OrderAllowedActions(False, True, False, False, False, None)

    if facts.status is OrderStatus.REFUND_PENDING:
        return _blocked("REFUND_IN_PROGRESS")

    if facts.status is OrderStatus.CONFIRMED:
        if facts.cancel_requested_at is not None:
            if facts.starts_at - now < timedelta(hours=24):
                return _blocked("CANCELLATION_REQUIRES_SUPPORT")
            return _blocked("REFUND_IN_PROGRESS")
        if facts.starts_at - now >= timedelta(hours=24):
            return OrderAllowedActions(False, True, False, False, False, None)
        return _blocked("CANCELLATION_WINDOW_CLOSED")

    return _blocked("ORDER_TERMINAL")


def _project_venue_manager_actions(
    facts: OrderLifecycleFacts, *, now: datetime
) -> OrderAllowedActions:
    if facts.status is OrderStatus.REFUND_PENDING:
        return _blocked("REFUND_IN_PROGRESS")
    if facts.status is not OrderStatus.CONFIRMED:
        return _blocked("ORDER_TERMINAL")

    can_refund = facts.checked_in_at is None
    if facts.checked_in_at is not None:
        if now >= facts.ends_at:
            return OrderAllowedActions(False, False, False, True, False, None)
        return _blocked("SESSION_NOT_ENDED")

    if now >= facts.ends_at:
        return OrderAllowedActions(False, False, True, False, can_refund, "CHECK_IN_REQUIRED")
    if now < facts.starts_at - timedelta(hours=2):
        return OrderAllowedActions(False, False, False, False, can_refund, "CHECK_IN_TOO_EARLY")
    return OrderAllowedActions(False, False, True, False, can_refund, None)


def _blocked(reason: BlockedReason) -> OrderAllowedActions:
    return OrderAllowedActions(False, False, False, False, False, reason)
