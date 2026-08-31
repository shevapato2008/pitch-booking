from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from backend.app.models import (
    OpenGameAttendanceStatus,
    OpenGameRegistrationPosition,
    OpenGameRegistrationStatus,
)
from backend.app.modules.open_games.lifecycle import EffectiveOpenGameState

TerminalAttendanceStatus = Literal[
    OpenGameAttendanceStatus.PRESENT,
    OpenGameAttendanceStatus.NO_SHOW,
]
AttendanceCorrectionBlockedReason = Literal[
    "GAME_NOT_COMPLETED",
    "REGISTRATION_NOT_JOINED",
    "ATTENDANCE_UNMARKED",
    "ATTENDANCE_AUDIT_INCOMPLETE",
]


class ClosedModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class PlatformAttendanceCorrectionRequest(ClosedModel):
    attendance_status: TerminalAttendanceStatus
    expected_version: int = Field(ge=1)
    reason: str = Field(min_length=1, max_length=1000, pattern=r".*\S.*")

    @field_validator("reason", mode="before")
    @classmethod
    def normalize_reason(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class PlatformAttendanceAllowedCorrection(ClosedModel):
    target_status: TerminalAttendanceStatus | None
    blocked_reason: AttendanceCorrectionBlockedReason | None

    @model_validator(mode="after")
    def validate_exclusive_state(self) -> PlatformAttendanceAllowedCorrection:
        if (self.target_status is None) == (self.blocked_reason is None):
            raise ValueError("target status and blocked reason must be mutually exclusive")
        return self


class PlatformAttendanceCorrectionEvent(ClosedModel):
    id: uuid.UUID
    registration_id: uuid.UUID
    from_status: TerminalAttendanceStatus
    to_status: TerminalAttendanceStatus
    reason: str = Field(min_length=1, max_length=1000, pattern=r".*\S.*")
    corrected_by_principal_id: str = Field(min_length=1, max_length=128)
    corrected_at: datetime
    registration_version_before: int = Field(ge=1)
    registration_version_after: int = Field(ge=2)

    @model_validator(mode="after")
    def validate_transition(self) -> PlatformAttendanceCorrectionEvent:
        if self.from_status is self.to_status:
            raise ValueError("attendance correction must change terminal status")
        if self.registration_version_after != self.registration_version_before + 1:
            raise ValueError("attendance correction must increment registration version")
        return self


class PlatformAttendanceRegistrationDetail(ClosedModel):
    registration_id: uuid.UUID
    registration_status: OpenGameRegistrationStatus
    player_display_name: str = Field(min_length=1, max_length=24)
    intended_position: OpenGameRegistrationPosition
    game_name: str = Field(min_length=1, max_length=30)
    game_status: EffectiveOpenGameState
    venue_name: str = Field(min_length=1)
    pitch_name: str = Field(min_length=1)
    starts_at: datetime
    ends_at: datetime
    time_zone: Literal["Asia/Shanghai"]
    original_attendance_status: TerminalAttendanceStatus | None
    attendance_recorded_at: datetime | None
    attendance_status: OpenGameAttendanceStatus
    version: int = Field(ge=1)
    corrections: tuple[PlatformAttendanceCorrectionEvent, ...]
    allowed_correction: PlatformAttendanceAllowedCorrection
