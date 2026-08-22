"""Pure lifecycle projection for captain open games."""

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict

from backend.app.models import OpenGameStatus, OrderStatus, RefundCasePurpose
from backend.app.modules.orders import lifecycle as order_lifecycle
from backend.app.modules.orders.lifecycle import OrderLifecycleFacts


class EffectiveOpenGameState(StrEnum):
    DRAFT = "DRAFT"
    PUBLISHED = "PUBLISHED"
    SUSPENDED = "SUSPENDED"
    CANCELLED = "CANCELLED"
    COMPLETED = "COMPLETED"


class OpenGameStateReason(StrEnum):
    REGISTRATION_WINDOW_CLOSED = "REGISTRATION_WINDOW_CLOSED"
    REGISTRATION_DEADLINE_PASSED = "REGISTRATION_DEADLINE_PASSED"
    CAPTAIN_CANCELLED = "CAPTAIN_CANCELLED"
    ORDER_CANCELLATION_PENDING = "ORDER_CANCELLATION_PENDING"
    ORDER_PAYMENT_EXCEPTION = "ORDER_PAYMENT_EXCEPTION"
    ORDER_REFUND_PENDING = "ORDER_REFUND_PENDING"
    ORDER_REFUND_FAILED = "ORDER_REFUND_FAILED"
    ORDER_CANCELLED = "ORDER_CANCELLED"
    ORDER_REFUNDED = "ORDER_REFUNDED"
    ORDER_COMPLETED = "ORDER_COMPLETED"


class OpenGamePublicStateReason(StrEnum):
    REGISTRATION_WINDOW_CLOSED = "REGISTRATION_WINDOW_CLOSED"
    REGISTRATION_DEADLINE_PASSED = "REGISTRATION_DEADLINE_PASSED"
    CAPTAIN_CANCELLED = "CAPTAIN_CANCELLED"
    BOOKING_UNAVAILABLE = "BOOKING_UNAVAILABLE"
    BOOKING_COMPLETED = "BOOKING_COMPLETED"


@dataclass(frozen=True, slots=True)
class OpenGameFacts:
    stored_status: OpenGameStatus
    order_facts: OrderLifecycleFacts
    registration_deadline: datetime


class OpenGameAllowedActions(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    can_edit: bool
    can_publish: bool
    can_share: bool
    can_cancel: bool
    can_preview: bool


def project_open_game_state(facts: OpenGameFacts) -> EffectiveOpenGameState:
    """Project the effective state from persisted B2 and authoritative B1 facts."""
    if facts.stored_status is OpenGameStatus.CANCELLED:
        return EffectiveOpenGameState.CANCELLED
    if facts.order_facts.status in {OrderStatus.CANCELLED, OrderStatus.REFUNDED}:
        return EffectiveOpenGameState.CANCELLED
    if facts.order_facts.status is OrderStatus.COMPLETED:
        return EffectiveOpenGameState.COMPLETED
    if facts.order_facts.cancel_requested_at is not None or facts.order_facts.status in {
        OrderStatus.PAYMENT_EXCEPTION,
        OrderStatus.REFUND_PENDING,
        OrderStatus.REFUND_FAILED,
    }:
        return EffectiveOpenGameState.SUSPENDED
    return EffectiveOpenGameState(facts.stored_status.value)


def project_open_game_reason(
    facts: OpenGameFacts, *, now: datetime
) -> OpenGameStateReason | None:
    """Return the one closed reason that explains the effective state."""
    if facts.stored_status is OpenGameStatus.CANCELLED:
        return OpenGameStateReason.CAPTAIN_CANCELLED

    status_reasons = {
        OrderStatus.CANCELLED: OpenGameStateReason.ORDER_CANCELLED,
        OrderStatus.REFUNDED: OpenGameStateReason.ORDER_REFUNDED,
        OrderStatus.COMPLETED: OpenGameStateReason.ORDER_COMPLETED,
        OrderStatus.PAYMENT_EXCEPTION: OpenGameStateReason.ORDER_PAYMENT_EXCEPTION,
        OrderStatus.REFUND_PENDING: OpenGameStateReason.ORDER_REFUND_PENDING,
        OrderStatus.REFUND_FAILED: OpenGameStateReason.ORDER_REFUND_FAILED,
    }
    status_reason = status_reasons.get(facts.order_facts.status)
    if status_reason is not None:
        return status_reason
    if facts.order_facts.cancel_requested_at is not None:
        return OpenGameStateReason.ORDER_CANCELLATION_PENDING

    if facts.stored_status is OpenGameStatus.PUBLISHED:
        if facts.registration_deadline <= now:
            return OpenGameStateReason.REGISTRATION_DEADLINE_PASSED
        return None

    order_eligible = order_lifecycle.is_b2_open_game_eligible(
        facts.order_facts, now=now
    )
    if not order_eligible:
        return OpenGameStateReason.REGISTRATION_WINDOW_CLOSED
    if facts.registration_deadline <= now:
        return OpenGameStateReason.REGISTRATION_DEADLINE_PASSED
    return None


def project_open_game_actions(
    facts: OpenGameFacts, *, now: datetime
) -> OpenGameAllowedActions:
    """Project real owner actions without accepting request-derived authority."""
    state = project_open_game_state(facts)
    if state is EffectiveOpenGameState.CANCELLED:
        return _actions()
    if state is EffectiveOpenGameState.COMPLETED:
        return _actions(can_preview=True)
    if state is EffectiveOpenGameState.SUSPENDED:
        return _actions(can_cancel=True, can_preview=True)
    if state is EffectiveOpenGameState.PUBLISHED:
        if not _published_authority_is_healthy(facts.order_facts):
            return _actions(can_cancel=True, can_preview=True)
        return _actions(
            can_edit=True,
            can_share=True,
            can_cancel=True,
            can_preview=True,
        )

    order_eligible = order_lifecycle.is_b2_open_game_eligible(
        facts.order_facts, now=now
    )
    return _actions(
        can_edit=order_eligible,
        can_publish=order_eligible and facts.registration_deadline > now,
        can_cancel=True,
        can_preview=True,
    )


def _published_authority_is_healthy(facts: OrderLifecycleFacts) -> bool:
    return (
        facts.status is OrderStatus.CONFIRMED
        and facts.cancel_requested_at is None
        and facts.controlling_refund_purpose
        not in {
            RefundCasePurpose.ORDER_CANCELLATION,
            RefundCasePurpose.PAYMENT_INVENTORY_CONFLICT,
        }
    )


def _actions(
    *,
    can_edit: bool = False,
    can_publish: bool = False,
    can_share: bool = False,
    can_cancel: bool = False,
    can_preview: bool = False,
) -> OpenGameAllowedActions:
    return OpenGameAllowedActions(
        can_edit=can_edit,
        can_publish=can_publish,
        can_share=can_share,
        can_cancel=can_cancel,
        can_preview=can_preview,
    )
