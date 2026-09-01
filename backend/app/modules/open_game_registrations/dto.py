"""Closed DTOs and approved text validation for open-game registrations."""

import re
import unicodedata
import uuid
from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal, Self
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

from backend.app.models import (
    OpenGameAttendanceStatus,
    OpenGameRegistrationPosition,
)
from backend.app.modules.open_game_registrations.lifecycle import (
    ApplyActions,
    AvailableWithdrawalAction,
    EffectiveRegistrationStatus,
    MemberRemovalActions,
    ReviewActions,
    WithdrawalAction,
)
from backend.app.modules.open_games.dto import OpenGamePublic
from backend.app.modules.open_games.lifecycle import EffectiveOpenGameState

OPEN_GAME_REGISTRATION_CONSENT_VERSION = "c1a-2026-08-24"


_MAINLAND_MOBILE_RE = re.compile(
    r"(?:^|[^0-9])(?:\+?86[\s-]?)?1[3-9](?:[\s-]?[0-9]){9}(?:$|[^0-9])"
)
_WECHAT_RE = re.compile(
    r"微信(?:号)?|微\s*信|(?:^|[\s,:：])(?:vx|wx|wechat)(?:[\s,:：]|$)",
    re.IGNORECASE,
)
_URL_RE = re.compile(
    r"https?://|www\.|(?:^|\s)[a-z0-9-]+\.(?:com|cn|net|org)(?:/|\s|$)",
    re.IGNORECASE,
)
_MAINLAND_ID_RE = re.compile(r"(?:^|[^0-9])(?:[0-9]{17}[0-9Xx]|[0-9]{15})(?:$|[^0-9])")


class _ClosedModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class _FrozenClosedModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class ApplicationDecision(StrEnum):
    ACCEPT = "ACCEPT"
    REJECT = "REJECT"
    WAITLIST = "WAITLIST"


class DecisionResultStatus(StrEnum):
    WAITLISTED = "WAITLISTED"
    JOINED = "JOINED"
    REJECTED = "REJECTED"


class RegistrationPersistedStatus(StrEnum):
    APPLIED = "APPLIED"
    WAITLISTED = "WAITLISTED"
    JOINED = "JOINED"
    REJECTED = "REJECTED"
    WITHDRAWN = "WITHDRAWN"
    REMOVED = "REMOVED"


class RegistrationWithdrawalKind(StrEnum):
    APPLICATION_WITHDRAWAL = "APPLICATION_WITHDRAWAL"
    WAITLIST_WITHDRAWAL = "WAITLIST_WITHDRAWAL"
    GAME_EXIT = "GAME_EXIT"


class CreateApplicationRequest(_ClosedModel):
    display_name: Annotated[str, Field(strict=True, min_length=2, max_length=24)]
    position: OpenGameRegistrationPosition
    note: Annotated[str, Field(strict=True, max_length=120)] | None
    adult_confirmed: Literal[True]
    risk_confirmed: Literal[True]

    @field_validator("adult_confirmed", "risk_confirmed", mode="before")
    @classmethod
    def require_strict_true(cls, value: object) -> object:
        if value is not True:
            raise ValueError("confirmation must be the boolean true")
        return value

    @field_validator("display_name", mode="before")
    @classmethod
    def trim_display_name(cls, value: object) -> object:
        if not isinstance(value, str):
            raise ValueError("display_name must be a string")
        return value.strip()

    @field_validator("note", mode="before")
    @classmethod
    def trim_note(cls, value: object) -> object:
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("note must be a string or null")
        return value.strip() or None

    @field_validator("display_name", "note")
    @classmethod
    def reject_private_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return validate_registration_visible_text(value)


class ViewerRegistration(_FrozenClosedModel):
    id: uuid.UUID
    display_name: Annotated[str, Field(strict=True, min_length=2, max_length=24)]
    position: OpenGameRegistrationPosition
    note: Annotated[str, Field(strict=True, max_length=120)] | None
    persisted_status: RegistrationPersistedStatus
    effective_status: EffectiveRegistrationStatus
    version: Annotated[int, Field(strict=True, ge=1)]
    applied_at: AwareDatetime
    decided_at: AwareDatetime | None
    withdrawn_at: AwareDatetime | None
    withdrawal_kind: RegistrationWithdrawalKind | None
    late_exit_recorded: Annotated[bool, Field(strict=True)]
    available_withdrawal_action: AvailableWithdrawalAction | None
    late_exit_will_be_recorded: Annotated[bool, Field(strict=True)]
    waitlist_position: Annotated[int, Field(strict=True, ge=1)] | None
    waitlisted_at: AwareDatetime | None
    promoted_at: AwareDatetime | None
    attendance_status: OpenGameAttendanceStatus | None
    attendance_recorded_at: AwareDatetime | None
    attendance_corrected_at: AwareDatetime | None
    removed_at: AwareDatetime | None

    @model_validator(mode="after")
    def validate_lifecycle(self) -> Self:
        expected_effective = EffectiveRegistrationStatus(self.persisted_status.value)
        if self.effective_status not in {
            expected_effective,
            EffectiveRegistrationStatus.CANCELLED,
        }:
            raise ValueError("effective status must preserve persisted status or cancel it")
        for field_name in (
            "decided_at",
            "withdrawn_at",
            "waitlisted_at",
            "promoted_at",
            "removed_at",
        ):
            value = getattr(self, field_name)
            if value is not None and value < self.applied_at:
                raise ValueError(f"{field_name} must not precede applied_at")
        if (
            self.decided_at is not None
            and self.waitlisted_at is not None
            and self.waitlisted_at < self.decided_at
        ):
            raise ValueError("waitlisted_at must not precede decided_at")
        if self.promoted_at is not None and (
            self.waitlisted_at is None or self.promoted_at < self.waitlisted_at
        ):
            raise ValueError("promoted_at must follow waitlisted_at")
        if self.withdrawn_at is not None:
            for field_name in ("decided_at", "waitlisted_at", "promoted_at"):
                value = getattr(self, field_name)
                if value is not None and self.withdrawn_at < value:
                    raise ValueError(f"withdrawn_at must not precede {field_name}")

        no_waitlist_history = (
            self.waitlist_position is None
            and self.waitlisted_at is None
            and self.promoted_at is None
        )
        promoted_history = (
            self.waitlist_position is None
            and self.waitlisted_at is not None
            and self.promoted_at is not None
        )
        status = self.persisted_status
        if status is RegistrationPersistedStatus.APPLIED:
            if self.decided_at is not None or not no_waitlist_history:
                raise ValueError("APPLIED lifecycle is inconsistent")
        elif status is RegistrationPersistedStatus.WAITLISTED:
            if (
                self.decided_at is None
                or self.waitlist_position is None
                or self.waitlisted_at is None
                or self.promoted_at is not None
            ):
                raise ValueError("WAITLISTED lifecycle is inconsistent")
        elif status is RegistrationPersistedStatus.JOINED:
            if self.decided_at is None or not (no_waitlist_history or promoted_history):
                raise ValueError("JOINED lifecycle is inconsistent")
        elif status is RegistrationPersistedStatus.REMOVED:
            if self.decided_at is None or not (no_waitlist_history or promoted_history):
                raise ValueError("REMOVED lifecycle is inconsistent")
        elif status is RegistrationPersistedStatus.REJECTED:
            if self.decided_at is None or not no_waitlist_history:
                raise ValueError("REJECTED lifecycle is inconsistent")

        if status is not RegistrationPersistedStatus.WITHDRAWN:
            if (
                self.withdrawn_at is not None
                or self.withdrawal_kind is not None
                or self.late_exit_recorded
            ):
                raise ValueError("non-withdrawn lifecycle contains withdrawal audit")
        else:
            if self.withdrawn_at is None or self.withdrawal_kind is None:
                raise ValueError("WITHDRAWN lifecycle requires withdrawal audit")
            if self.withdrawal_kind is RegistrationWithdrawalKind.APPLICATION_WITHDRAWAL:
                if (
                    self.decided_at is not None
                    or not no_waitlist_history
                    or self.late_exit_recorded
                ):
                    raise ValueError("application withdrawal lifecycle is inconsistent")
            elif self.withdrawal_kind is RegistrationWithdrawalKind.WAITLIST_WITHDRAWAL:
                if (
                    self.decided_at is None
                    or self.waitlist_position is not None
                    or self.waitlisted_at is None
                    or self.promoted_at is not None
                    or self.late_exit_recorded
                ):
                    raise ValueError("waitlist withdrawal lifecycle is inconsistent")
            elif self.decided_at is None or not (no_waitlist_history or promoted_history):
                raise ValueError("game exit lifecycle is inconsistent")

        expected_action = {
            RegistrationPersistedStatus.APPLIED: (AvailableWithdrawalAction.WITHDRAW_APPLICATION),
            RegistrationPersistedStatus.WAITLISTED: (AvailableWithdrawalAction.WITHDRAW_WAITLIST),
            RegistrationPersistedStatus.JOINED: AvailableWithdrawalAction.LEAVE_GAME,
            RegistrationPersistedStatus.REJECTED: None,
            RegistrationPersistedStatus.WITHDRAWN: None,
            RegistrationPersistedStatus.REMOVED: None,
        }[status]
        if self.available_withdrawal_action not in {None, expected_action}:
            raise ValueError("available withdrawal action does not match lifecycle")
        if (
            self.effective_status is EffectiveRegistrationStatus.CANCELLED
            and self.available_withdrawal_action is not None
        ):
            raise ValueError("cancelled registration cannot expose a withdrawal action")
        if self.late_exit_will_be_recorded and (
            self.available_withdrawal_action is not AvailableWithdrawalAction.LEAVE_GAME
        ):
            raise ValueError("late exit warning requires LEAVE_GAME")
        if status is RegistrationPersistedStatus.WITHDRAWN and (
            self.available_withdrawal_action is not None or self.late_exit_will_be_recorded
        ):
            raise ValueError("withdrawn registration cannot expose another withdrawal")
        if status is RegistrationPersistedStatus.REMOVED:
            if self.removed_at is None:
                raise ValueError("REMOVED lifecycle requires removed_at")
            if self.removed_at < self.decided_at:
                raise ValueError("removed_at must not precede decided_at")
        elif self.removed_at is not None:
            raise ValueError("non-removed lifecycle cannot contain removed_at")
        _validate_self_attendance(
            status=self.attendance_status,
            recorded_at=self.attendance_recorded_at,
            corrected_at=self.attendance_corrected_at,
        )
        return self


class CaptainApplication(_FrozenClosedModel):
    id: uuid.UUID
    display_name: Annotated[str, Field(strict=True, min_length=2, max_length=24)]
    position: OpenGameRegistrationPosition
    note: Annotated[str, Field(strict=True, max_length=120)] | None
    applied_at: datetime
    version: Annotated[int, Field(strict=True, ge=1)]
    allowed_actions: ReviewActions


class RegistrationContext(_FrozenClosedModel):
    game: OpenGamePublic
    remaining_spots: Annotated[int, Field(strict=True, ge=0)]
    viewer_authenticated: Annotated[bool, Field(strict=True)]
    viewer_registration: ViewerRegistration | None
    allowed_actions: ApplyActions


class CaptainWaitlistApplication(_FrozenClosedModel):
    id: uuid.UUID
    display_name: Annotated[str, Field(strict=True, min_length=2, max_length=24)]
    position: OpenGameRegistrationPosition
    note: Annotated[str, Field(strict=True, max_length=120)] | None
    applied_at: AwareDatetime
    waitlisted_at: AwareDatetime
    waitlist_position: Annotated[int, Field(strict=True, ge=1)]

    @model_validator(mode="after")
    def validate_lifecycle(self) -> Self:
        if self.waitlisted_at < self.applied_at:
            raise ValueError("waitlisted_at must not precede applied_at")
        return self


class Queue(_FrozenClosedModel):
    remaining_spots: Annotated[int, Field(strict=True, ge=0)]
    pending_count: Annotated[int, Field(strict=True, ge=0)]
    applications: tuple[CaptainApplication, ...]
    waitlist_count: Annotated[int, Field(strict=True, ge=0)]
    waitlist: tuple[CaptainWaitlistApplication, ...]

    @model_validator(mode="after")
    def validate_counts_and_order(self) -> Self:
        if self.pending_count != len(self.applications):
            raise ValueError("pending_count must equal applications length")
        if self.waitlist_count != len(self.waitlist):
            raise ValueError("waitlist_count must equal waitlist length")
        if any(
            item.waitlist_position != index for index, item in enumerate(self.waitlist, start=1)
        ):
            raise ValueError("waitlist must be in contiguous one-based server order")
        return self


class MyOpenGameApplication(_FrozenClosedModel):
    id: uuid.UUID
    effective_status: EffectiveRegistrationStatus
    applied_at: AwareDatetime
    waitlist_position: Annotated[int, Field(strict=True, ge=1)] | None
    waitlisted_at: AwareDatetime | None
    promoted_at: AwareDatetime | None
    attendance_status: OpenGameAttendanceStatus | None
    attendance_recorded_at: AwareDatetime | None
    attendance_corrected_at: AwareDatetime | None
    detail_path: Annotated[
        str,
        Field(
            strict=True,
            pattern=(
                r"^/pages/captain-game-public/index\?token=[A-Za-z0-9_-]{32}"
                r"&game_id=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-"
                r"[0-9a-f]{4}-[0-9a-f]{12}$"
            ),
        ),
    ]
    game_name: Annotated[str, Field(strict=True)]
    starts_at: AwareDatetime
    ends_at: AwareDatetime
    time_zone: Annotated[str, Field(strict=True)]
    venue_name: Annotated[str, Field(strict=True)]
    pitch_name: Annotated[str, Field(strict=True)]
    pitch_specification: Annotated[str, Field(strict=True)]

    @field_validator("time_zone")
    @classmethod
    def require_iana_time_zone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError as error:
            raise ValueError("time_zone must identify an IANA time zone") from error
        return value

    @model_validator(mode="after")
    def validate_waitlist_history(self) -> Self:
        if self.waitlisted_at is not None and self.waitlisted_at < self.applied_at:
            raise ValueError("waitlisted_at must not precede applied_at")
        if self.promoted_at is not None and (
            self.waitlisted_at is None or self.promoted_at < self.waitlisted_at
        ):
            raise ValueError("promoted_at must follow waitlisted_at")
        no_history = (
            self.waitlist_position is None
            and self.waitlisted_at is None
            and self.promoted_at is None
        )
        current_waitlist = (
            self.waitlist_position is not None
            and self.waitlisted_at is not None
            and self.promoted_at is None
        )
        waitlist_history = (
            self.waitlist_position is None
            and self.waitlisted_at is not None
            and self.promoted_at is None
        )
        promoted_history = (
            self.waitlist_position is None
            and self.waitlisted_at is not None
            and self.promoted_at is not None
        )
        if self.effective_status is EffectiveRegistrationStatus.WAITLISTED:
            valid = current_waitlist
        elif self.effective_status is EffectiveRegistrationStatus.JOINED:
            valid = no_history or promoted_history
        elif self.effective_status in {
            EffectiveRegistrationStatus.APPLIED,
            EffectiveRegistrationStatus.REJECTED,
        }:
            valid = no_history
        elif self.effective_status is EffectiveRegistrationStatus.WITHDRAWN:
            valid = no_history or waitlist_history or promoted_history
        else:
            valid = no_history or current_waitlist or waitlist_history or promoted_history
        if not valid:
            raise ValueError("waitlist history does not match effective status")
        _validate_self_attendance(
            status=self.attendance_status,
            recorded_at=self.attendance_recorded_at,
            corrected_at=self.attendance_corrected_at,
        )
        return self


class MyOpenGameApplicationsResponse(_FrozenClosedModel):
    items: tuple[MyOpenGameApplication, ...]
    next_cursor: Annotated[str, Field(strict=True, min_length=1)] | None


class DecisionRequest(_ClosedModel):
    decision: ApplicationDecision
    expected_version: Annotated[int, Field(strict=True, ge=1)]


class WithdrawalRequest(_ClosedModel):
    action: WithdrawalAction
    expected_version: Annotated[int, Field(strict=True, ge=1)]


class DecisionResult(_FrozenClosedModel):
    application_id: uuid.UUID
    status: DecisionResultStatus
    version: Annotated[int, Field(strict=True, ge=1)]
    decided_at: datetime | None
    remaining_spots: Annotated[int, Field(strict=True, ge=0)]
    allowed_actions: ReviewActions


class OpenGameMemberRemovalRequest(_ClosedModel):
    expected_version: Annotated[int, Field(strict=True, ge=1)]
    reason: Annotated[str, Field(strict=True, min_length=1, max_length=120)]

    @field_validator("reason", mode="before")
    @classmethod
    def trim_reason(cls, value: object) -> object:
        if not isinstance(value, str):
            raise ValueError("reason must be a string")
        return value.strip()

    @field_validator("reason")
    @classmethod
    def reject_private_text(cls, value: str) -> str:
        return validate_registration_visible_text(value)


class OpenGameMemberGameSummary(_FrozenClosedModel):
    id: uuid.UUID
    name: Annotated[str, Field(strict=True, min_length=2, max_length=30)]
    venue_name: Annotated[str, Field(strict=True, min_length=1)]
    pitch_name: Annotated[str, Field(strict=True, min_length=1)]
    starts_at: AwareDatetime
    ends_at: AwareDatetime
    time_zone: Annotated[str, Field(strict=True)]
    state: EffectiveOpenGameState

    @field_validator("time_zone")
    @classmethod
    def require_iana_time_zone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError as error:
            raise ValueError("time_zone must identify an IANA time zone") from error
        return value

    @model_validator(mode="after")
    def validate_times(self) -> Self:
        if self.ends_at <= self.starts_at:
            raise ValueError("ends_at must be after starts_at")
        return self


class OpenGameMemberRosterItem(_FrozenClosedModel):
    registration_id: uuid.UUID
    display_name: Annotated[str, Field(strict=True, min_length=2, max_length=24)]
    position: OpenGameRegistrationPosition
    joined_at: AwareDatetime
    promoted_from_waitlist: Annotated[bool, Field(strict=True)]
    version: Annotated[int, Field(strict=True, ge=1)]
    allowed_actions: MemberRemovalActions


class OpenGameMemberRoster(_FrozenClosedModel):
    game: OpenGameMemberGameSummary
    joined_count: Annotated[int, Field(strict=True, ge=0)]
    remaining_spots: Annotated[int, Field(strict=True, ge=0)]
    waitlist_count: Annotated[int, Field(strict=True, ge=0)]
    members: tuple[OpenGameMemberRosterItem, ...]

    @model_validator(mode="after")
    def validate_counts(self) -> Self:
        if self.joined_count != len(self.members):
            raise ValueError("joined_count must equal members length")
        return self


class OpenGamePromotedMember(_FrozenClosedModel):
    registration_id: uuid.UUID
    display_name: Annotated[str, Field(strict=True, min_length=2, max_length=24)]
    position: OpenGameRegistrationPosition
    version: Annotated[int, Field(strict=True, ge=2)]


class OpenGameMemberRemovalResult(_FrozenClosedModel):
    removed_registration_id: uuid.UUID
    removed_display_name: Annotated[str, Field(strict=True, min_length=2, max_length=24)]
    status: Literal["REMOVED"]
    version: Annotated[int, Field(strict=True, ge=2)]
    removed_at: AwareDatetime
    joined_count: Annotated[int, Field(strict=True, ge=0)]
    remaining_spots: Annotated[int, Field(strict=True, ge=0)]
    waitlist_count: Annotated[int, Field(strict=True, ge=0)]
    promoted_member: OpenGamePromotedMember | None

    @model_validator(mode="after")
    def validate_capacity(self) -> Self:
        if self.promoted_member is not None and self.remaining_spots != 0:
            raise ValueError("promotion must refill the opened spot")
        return self


class OpenGameAttendanceGameSummary(_FrozenClosedModel):
    id: uuid.UUID
    name: Annotated[str, Field(strict=True, min_length=2, max_length=30)]
    venue_name: Annotated[str, Field(strict=True, min_length=1)]
    pitch_name: Annotated[str, Field(strict=True, min_length=1)]
    starts_at: AwareDatetime
    ends_at: AwareDatetime
    time_zone: Annotated[str, Field(strict=True)]
    state: Literal["COMPLETED"]

    @field_validator("time_zone")
    @classmethod
    def require_iana_time_zone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError as error:
            raise ValueError("time_zone must identify an IANA time zone") from error
        return value

    @model_validator(mode="after")
    def validate_times(self) -> Self:
        if self.ends_at <= self.starts_at:
            raise ValueError("ends_at must be after starts_at")
        return self


class OpenGameAttendanceRosterItem(_FrozenClosedModel):
    registration_id: uuid.UUID
    display_name: Annotated[str, Field(strict=True, min_length=2, max_length=24)]
    position: OpenGameRegistrationPosition
    attendance_status: OpenGameAttendanceStatus
    attendance_recorded_at: AwareDatetime | None
    attendance_corrected_at: AwareDatetime | None
    version: Annotated[int, Field(strict=True, ge=1)]

    @model_validator(mode="after")
    def validate_attendance(self) -> Self:
        _validate_attendance_pair(
            status=self.attendance_status,
            recorded_at=self.attendance_recorded_at,
            corrected_at=self.attendance_corrected_at,
        )
        return self


class OpenGameAttendanceRoster(_FrozenClosedModel):
    game: OpenGameAttendanceGameSummary
    recorded_count: Annotated[int, Field(strict=True, ge=0)]
    total_count: Annotated[int, Field(strict=True, ge=0)]
    attendance_complete: Annotated[bool, Field(strict=True)]
    registrations: tuple[OpenGameAttendanceRosterItem, ...]

    @model_validator(mode="after")
    def validate_counts(self) -> Self:
        recorded = sum(
            item.attendance_status is not OpenGameAttendanceStatus.UNMARKED
            for item in self.registrations
        )
        if self.total_count != len(self.registrations):
            raise ValueError("total_count must equal registrations length")
        if self.recorded_count != recorded:
            raise ValueError("recorded_count must equal terminal attendance rows")
        if self.attendance_complete is not (recorded == self.total_count):
            raise ValueError("attendance_complete must match the counts")
        return self


class OpenGameAttendanceMarkRequest(_ClosedModel):
    attendance_status: Literal[
        OpenGameAttendanceStatus.PRESENT,
        OpenGameAttendanceStatus.NO_SHOW,
    ]
    expected_version: Annotated[int, Field(strict=True, ge=1)]


class OpenGameAttendanceMarkResult(_FrozenClosedModel):
    registration_id: uuid.UUID
    attendance_status: Literal[
        OpenGameAttendanceStatus.PRESENT,
        OpenGameAttendanceStatus.NO_SHOW,
    ]
    attendance_recorded_at: AwareDatetime
    version: Annotated[int, Field(strict=True, ge=2)]
    recorded_count: Annotated[int, Field(strict=True, ge=1)]
    total_count: Annotated[int, Field(strict=True, ge=1)]
    attendance_complete: Annotated[bool, Field(strict=True)]

    @model_validator(mode="after")
    def validate_counts(self) -> Self:
        if self.recorded_count > self.total_count:
            raise ValueError("recorded_count must not exceed total_count")
        if self.attendance_complete is not (self.recorded_count == self.total_count):
            raise ValueError("attendance_complete must match the counts")
        return self


def _validate_self_attendance(
    *,
    status: OpenGameAttendanceStatus | None,
    recorded_at: datetime | None,
    corrected_at: datetime | None,
) -> None:
    if status in {None, OpenGameAttendanceStatus.UNMARKED}:
        if recorded_at is not None or corrected_at is not None:
            raise ValueError("unavailable or unmarked attendance has no audit time")
        return
    if recorded_at is None:
        raise ValueError("recorded attendance requires a recorded time")
    if corrected_at is not None and corrected_at < recorded_at:
        raise ValueError("corrected attendance cannot precede its original record")


def _validate_attendance_pair(
    *,
    status: OpenGameAttendanceStatus,
    recorded_at: datetime | None,
    corrected_at: datetime | None,
) -> None:
    if status is OpenGameAttendanceStatus.UNMARKED:
        if recorded_at is not None or corrected_at is not None:
            raise ValueError("unmarked attendance has no audit time")
        return
    if recorded_at is None:
        raise ValueError("terminal attendance requires a recorded time")
    if corrected_at is not None and corrected_at < recorded_at:
        raise ValueError("corrected attendance cannot precede its original record")


def validate_registration_visible_text(value: str) -> str:
    """Reject the approved C1a contact, URL, and mainland-ID patterns."""
    detection_value = unicodedata.normalize("NFKC", value)
    if _MAINLAND_MOBILE_RE.search(detection_value):
        raise ValueError("must not include a mainland mobile number")
    if _WECHAT_RE.search(detection_value):
        raise ValueError("must not include an explicit WeChat identifier")
    if _URL_RE.search(detection_value):
        raise ValueError("must not include a URL")
    if _MAINLAND_ID_RE.search(detection_value):
        raise ValueError("must not include a mainland identity number")
    return value
