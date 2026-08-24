"""Pure lifecycle projection for open-game registrations."""

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Annotated, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from backend.app.models import OpenGameRegistrationStatus, OpenGameStatus
from backend.app.modules.open_games.lifecycle import EffectiveOpenGameState


class EffectiveRegistrationStatus(StrEnum):
    APPLIED = "APPLIED"
    JOINED = "JOINED"
    REJECTED = "REJECTED"
    CANCELLED = "CANCELLED"


class ApplyBlockedReason(StrEnum):
    AUTH_REQUIRED = "AUTH_REQUIRED"
    OWNER_CANNOT_APPLY = "OWNER_CANNOT_APPLY"
    ALREADY_APPLIED = "ALREADY_APPLIED"
    GAME_NOT_PUBLISHED = "GAME_NOT_PUBLISHED"
    REGISTRATION_DEADLINE_PASSED = "REGISTRATION_DEADLINE_PASSED"
    GAME_FULL = "GAME_FULL"
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
    can_reject: Annotated[bool, Field(strict=True)]
    reject_blocked_reason: ReviewBlockedReason | None

    @model_validator(mode="after")
    def validate_pairing(self) -> Self:
        if self.can_accept is not (self.accept_blocked_reason is None):
            raise ValueError(
                "can_accept must correspond exactly to accept_blocked_reason"
            )
        if self.can_reject is not (self.reject_blocked_reason is None):
            raise ValueError(
                "can_reject must correspond exactly to reject_blocked_reason"
            )
        if self.reject_blocked_reason is ReviewBlockedReason.GAME_FULL:
            raise ValueError("GAME_FULL must not block rejection")
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
    elif remaining_spots(
        open_spots=facts.open_spots, joined_count=facts.joined_count
    ) == 0:
        blocker = ApplyBlockedReason.GAME_FULL
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
            can_reject=False,
            reject_blocked_reason=common_blocker,
        )
    if remaining_spots(
        open_spots=facts.open_spots, joined_count=facts.joined_count
    ) == 0:
        return ReviewActions(
            can_accept=False,
            accept_blocked_reason=ReviewBlockedReason.GAME_FULL,
            can_reject=True,
            reject_blocked_reason=None,
        )
    return ReviewActions(
        can_accept=True,
        accept_blocked_reason=None,
        can_reject=True,
        reject_blocked_reason=None,
    )


def project_effective_registration_status(
    persisted_status: OpenGameRegistrationStatus,
    game_state: EffectiveOpenGameState,
) -> EffectiveRegistrationStatus:
    if game_state is EffectiveOpenGameState.CANCELLED:
        return EffectiveRegistrationStatus.CANCELLED
    return EffectiveRegistrationStatus(persisted_status.value)


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
