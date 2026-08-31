"""Pure lifecycle projection for open-game registrations."""

from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum
from typing import Annotated, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from backend.app.models import (
    OpenGameAttendanceStatus,
    OpenGameRegistrationStatus,
    OpenGameStatus,
)
from backend.app.modules.open_games.lifecycle import EffectiveOpenGameState


class EffectiveRegistrationStatus(StrEnum):
    APPLIED = "APPLIED"
    WAITLISTED = "WAITLISTED"
    JOINED = "JOINED"
    REJECTED = "REJECTED"
    WITHDRAWN = "WITHDRAWN"
    REMOVED = "REMOVED"
    CANCELLED = "CANCELLED"


class WithdrawalAction(StrEnum):
    WITHDRAW_APPLICATION = "WITHDRAW_APPLICATION"
    WITHDRAW_WAITLIST = "WITHDRAW_WAITLIST"
    LEAVE_GAME = "LEAVE_GAME"


class AvailableWithdrawalAction(StrEnum):
    WITHDRAW_APPLICATION = "WITHDRAW_APPLICATION"
    WITHDRAW_WAITLIST = "WITHDRAW_WAITLIST"
    LEAVE_GAME = "LEAVE_GAME"


@dataclass(frozen=True, slots=True)
class AvailableWithdrawal:
    action: AvailableWithdrawalAction | None
    late_exit_will_be_recorded: bool


class ApplyBlockedReason(StrEnum):
    AUTH_REQUIRED = "AUTH_REQUIRED"
    OWNER_CANNOT_APPLY = "OWNER_CANNOT_APPLY"
    ALREADY_APPLIED = "ALREADY_APPLIED"
    GAME_NOT_PUBLISHED = "GAME_NOT_PUBLISHED"
    REGISTRATION_DEADLINE_PASSED = "REGISTRATION_DEADLINE_PASSED"
    GAME_SUSPENDED = "GAME_SUSPENDED"
    GAME_CANCELLED = "GAME_CANCELLED"
    GAME_COMPLETED = "GAME_COMPLETED"
    GAME_STARTED = "GAME_STARTED"


class ReviewBlockedReason(StrEnum):
    APPLICATION_NOT_PENDING = "APPLICATION_NOT_PENDING"
    GAME_SUSPENDED = "GAME_SUSPENDED"
    GAME_CANCELLED = "GAME_CANCELLED"
    GAME_COMPLETED = "GAME_COMPLETED"
    GAME_STARTED = "GAME_STARTED"
    GAME_FULL = "GAME_FULL"


class WaitlistBlockedReason(StrEnum):
    APPLICATION_NOT_PENDING = "APPLICATION_NOT_PENDING"
    GAME_SUSPENDED = "GAME_SUSPENDED"
    GAME_CANCELLED = "GAME_CANCELLED"
    GAME_COMPLETED = "GAME_COMPLETED"
    GAME_STARTED = "GAME_STARTED"
    GAME_NOT_FULL = "GAME_NOT_FULL"
    WAITLIST_NOT_ENABLED = "WAITLIST_NOT_ENABLED"


class MemberRemovalBlockedReason(StrEnum):
    GAME_NOT_PUBLISHED = "GAME_NOT_PUBLISHED"
    GAME_SUSPENDED = "GAME_SUSPENDED"
    GAME_CANCELLED = "GAME_CANCELLED"
    GAME_COMPLETED = "GAME_COMPLETED"
    GAME_STARTED = "GAME_STARTED"
    ORDER_AUTHORITY_UNHEALTHY = "ORDER_AUTHORITY_UNHEALTHY"
    ATTENDANCE_RECORDED = "ATTENDANCE_RECORDED"


_COMMON_REVIEW_BLOCKERS = frozenset(
    {
        ReviewBlockedReason.APPLICATION_NOT_PENDING,
        ReviewBlockedReason.GAME_SUSPENDED,
        ReviewBlockedReason.GAME_CANCELLED,
        ReviewBlockedReason.GAME_COMPLETED,
        ReviewBlockedReason.GAME_STARTED,
    }
)


class _FrozenClosedModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class ApplyActions(_FrozenClosedModel):
    can_apply: Annotated[bool, Field(strict=True)]
    apply_blocked_reason: ApplyBlockedReason | None

    @model_validator(mode="after")
    def validate_pairing(self) -> Self:
        if self.can_apply is not (self.apply_blocked_reason is None):
            raise ValueError("can_apply must correspond exactly to apply_blocked_reason")
        return self


class ReviewActions(_FrozenClosedModel):
    can_accept: Annotated[bool, Field(strict=True)]
    accept_blocked_reason: ReviewBlockedReason | None
    can_waitlist: Annotated[bool, Field(strict=True)]
    waitlist_blocked_reason: WaitlistBlockedReason | None
    can_reject: Annotated[bool, Field(strict=True)]
    reject_blocked_reason: ReviewBlockedReason | None

    @model_validator(mode="after")
    def validate_pairing(self) -> Self:
        if self.can_accept is not (self.accept_blocked_reason is None):
            raise ValueError("can_accept must correspond exactly to accept_blocked_reason")
        if self.can_waitlist is not (self.waitlist_blocked_reason is None):
            raise ValueError("can_waitlist must correspond exactly to waitlist_blocked_reason")
        if self.can_reject is not (self.reject_blocked_reason is None):
            raise ValueError("can_reject must correspond exactly to reject_blocked_reason")
        if self.reject_blocked_reason is ReviewBlockedReason.GAME_FULL:
            raise ValueError("GAME_FULL must not block rejection")
        if self.can_accept and self.can_waitlist:
            raise ValueError("accept and waitlist actions must be mutually exclusive")
        capacity_available = (
            self.can_accept
            and not self.can_waitlist
            and self.waitlist_blocked_reason is WaitlistBlockedReason.GAME_NOT_FULL
            and self.can_reject
        )
        full_capacity = (
            not self.can_accept
            and self.accept_blocked_reason is ReviewBlockedReason.GAME_FULL
            and self.can_reject
            and (
                self.can_waitlist
                or self.waitlist_blocked_reason is WaitlistBlockedReason.WAITLIST_NOT_ENABLED
            )
        )
        common_blocked = (
            not self.can_accept
            and not self.can_waitlist
            and not self.can_reject
            and self.accept_blocked_reason in _COMMON_REVIEW_BLOCKERS
            and self.reject_blocked_reason is self.accept_blocked_reason
            and self.waitlist_blocked_reason is not None
            and self.waitlist_blocked_reason.value == self.accept_blocked_reason.value
        )
        if not (capacity_available or full_capacity or common_blocked):
            raise ValueError("review actions do not match a supported authority matrix")
        return self


class MemberRemovalActions(_FrozenClosedModel):
    can_remove: Annotated[bool, Field(strict=True)]
    remove_blocked_reason: MemberRemovalBlockedReason | None

    @model_validator(mode="after")
    def validate_pairing(self) -> Self:
        if self.can_remove is not (self.remove_blocked_reason is None):
            raise ValueError("can_remove must correspond exactly to remove_blocked_reason")
        return self


@dataclass(frozen=True, slots=True)
class RegistrationFacts:
    game_state: EffectiveOpenGameState
    stored_game_status: OpenGameStatus
    viewer_authenticated: bool
    viewer_is_owner: bool
    viewer_has_registration: bool
    registration_deadline: datetime
    starts_at: datetime
    open_spots: int
    joined_count: int


@dataclass(frozen=True, slots=True)
class MemberRemovalFacts:
    game_state: EffectiveOpenGameState
    stored_game_status: OpenGameStatus
    order_authority_healthy: bool
    starts_at: datetime
    attendance_status: OpenGameAttendanceStatus


def remaining_spots(*, open_spots: int, joined_count: int) -> int:
    return max(open_spots - joined_count, 0)


def project_apply_actions(facts: RegistrationFacts, now: datetime) -> ApplyActions:
    blocker: ApplyBlockedReason | None
    if facts.game_state is EffectiveOpenGameState.CANCELLED:
        blocker = ApplyBlockedReason.GAME_CANCELLED
    elif facts.game_state is EffectiveOpenGameState.COMPLETED:
        blocker = ApplyBlockedReason.GAME_COMPLETED
    elif facts.game_state is EffectiveOpenGameState.SUSPENDED:
        blocker = ApplyBlockedReason.GAME_SUSPENDED
    elif now >= facts.starts_at:
        blocker = ApplyBlockedReason.GAME_STARTED
    elif facts.stored_game_status != OpenGameStatus.PUBLISHED:
        blocker = ApplyBlockedReason.GAME_NOT_PUBLISHED
    elif facts.viewer_has_registration:
        blocker = ApplyBlockedReason.ALREADY_APPLIED
    elif facts.viewer_is_owner:
        blocker = ApplyBlockedReason.OWNER_CANNOT_APPLY
    elif now >= facts.registration_deadline:
        blocker = ApplyBlockedReason.REGISTRATION_DEADLINE_PASSED
    elif not facts.viewer_authenticated:
        blocker = ApplyBlockedReason.AUTH_REQUIRED
    else:
        blocker = None
    return ApplyActions(can_apply=blocker is None, apply_blocked_reason=blocker)


def project_review_actions(
    facts: RegistrationFacts,
    decision_status: OpenGameRegistrationStatus,
    now: datetime,
) -> ReviewActions:
    common_blocker = _review_common_blocker(facts, decision_status, now)
    if common_blocker is not None:
        return ReviewActions(
            can_accept=False,
            accept_blocked_reason=common_blocker,
            can_waitlist=False,
            waitlist_blocked_reason=WaitlistBlockedReason(common_blocker.value),
            can_reject=False,
            reject_blocked_reason=common_blocker,
        )
    if remaining_spots(open_spots=facts.open_spots, joined_count=facts.joined_count) == 0:
        return ReviewActions(
            can_accept=False,
            accept_blocked_reason=ReviewBlockedReason.GAME_FULL,
            can_waitlist=True,
            waitlist_blocked_reason=None,
            can_reject=True,
            reject_blocked_reason=None,
        )
    return ReviewActions(
        can_accept=True,
        accept_blocked_reason=None,
        can_waitlist=False,
        waitlist_blocked_reason=WaitlistBlockedReason.GAME_NOT_FULL,
        can_reject=True,
        reject_blocked_reason=None,
    )


def project_member_removal_actions(
    facts: MemberRemovalFacts, *, now: datetime
) -> MemberRemovalActions:
    blocker: MemberRemovalBlockedReason | None
    if facts.game_state is EffectiveOpenGameState.CANCELLED:
        blocker = MemberRemovalBlockedReason.GAME_CANCELLED
    elif facts.game_state is EffectiveOpenGameState.COMPLETED:
        blocker = MemberRemovalBlockedReason.GAME_COMPLETED
    elif facts.game_state is EffectiveOpenGameState.SUSPENDED:
        blocker = MemberRemovalBlockedReason.GAME_SUSPENDED
    elif now >= facts.starts_at:
        blocker = MemberRemovalBlockedReason.GAME_STARTED
    elif (
        facts.game_state is not EffectiveOpenGameState.PUBLISHED
        or facts.stored_game_status is not OpenGameStatus.PUBLISHED
    ):
        blocker = MemberRemovalBlockedReason.GAME_NOT_PUBLISHED
    elif not facts.order_authority_healthy:
        blocker = MemberRemovalBlockedReason.ORDER_AUTHORITY_UNHEALTHY
    elif facts.attendance_status is not OpenGameAttendanceStatus.UNMARKED:
        blocker = MemberRemovalBlockedReason.ATTENDANCE_RECORDED
    else:
        blocker = None
    return MemberRemovalActions(
        can_remove=blocker is None,
        remove_blocked_reason=blocker,
    )


def project_effective_registration_status(
    persisted_status: OpenGameRegistrationStatus,
    game_state: EffectiveOpenGameState,
) -> EffectiveRegistrationStatus:
    if game_state is EffectiveOpenGameState.CANCELLED:
        return EffectiveRegistrationStatus.CANCELLED
    return EffectiveRegistrationStatus(persisted_status.value)


def project_available_withdrawal(
    *,
    persisted_status: OpenGameRegistrationStatus,
    game_state: EffectiveOpenGameState,
    starts_at: datetime,
    now: datetime,
) -> AvailableWithdrawal:
    if (
        game_state not in {EffectiveOpenGameState.PUBLISHED, EffectiveOpenGameState.SUSPENDED}
        or now >= starts_at
    ):
        return AvailableWithdrawal(action=None, late_exit_will_be_recorded=False)
    if persisted_status is OpenGameRegistrationStatus.APPLIED:
        return AvailableWithdrawal(
            action=AvailableWithdrawalAction.WITHDRAW_APPLICATION,
            late_exit_will_be_recorded=False,
        )
    if persisted_status is OpenGameRegistrationStatus.WAITLISTED:
        return AvailableWithdrawal(
            action=AvailableWithdrawalAction.WITHDRAW_WAITLIST,
            late_exit_will_be_recorded=False,
        )
    if persisted_status is OpenGameRegistrationStatus.JOINED:
        return AvailableWithdrawal(
            action=AvailableWithdrawalAction.LEAVE_GAME,
            late_exit_will_be_recorded=now > starts_at - timedelta(hours=6),
        )
    return AvailableWithdrawal(action=None, late_exit_will_be_recorded=False)


def _review_common_blocker(
    facts: RegistrationFacts,
    decision_status: OpenGameRegistrationStatus,
    now: datetime,
) -> ReviewBlockedReason | None:
    if decision_status is not OpenGameRegistrationStatus.APPLIED:
        return ReviewBlockedReason.APPLICATION_NOT_PENDING
    if facts.game_state is EffectiveOpenGameState.CANCELLED:
        return ReviewBlockedReason.GAME_CANCELLED
    if facts.game_state is EffectiveOpenGameState.COMPLETED:
        return ReviewBlockedReason.GAME_COMPLETED
    if facts.game_state is EffectiveOpenGameState.SUSPENDED:
        return ReviewBlockedReason.GAME_SUSPENDED
    if now >= facts.starts_at:
        return ReviewBlockedReason.GAME_STARTED
    return None
