from __future__ import annotations

import uuid
from enum import StrEnum
from typing import Annotated

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

from backend.app.models import (
    OpenGameCancellationSource,
    OpenGameRegistrationStatus,
    OpenGameReportCategory,
    OpenGameReportResolutionOutcome,
    OpenGameStatus,
)
from backend.app.modules.open_game_reports.dto import (
    OpenGameReportStatus,
    OpenGameReportTargetSummary,
)
from backend.app.modules.open_games.lifecycle import EffectiveOpenGameState


class _Closed(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class PlatformGameReportCancellationBlockedReason(StrEnum):
    GAME_ALREADY_STARTED = "GAME_ALREADY_STARTED"
    GAME_NOT_PUBLISHED = "GAME_NOT_PUBLISHED"
    GAME_AUTHORITY_UNHEALTHY = "GAME_AUTHORITY_UNHEALTHY"
    REPORT_ALREADY_RESOLVED = "REPORT_ALREADY_RESOLVED"


class PlatformGameReportQueueItem(_Closed):
    report_id: uuid.UUID
    category: OpenGameReportCategory
    status: OpenGameReportStatus
    target: OpenGameReportTargetSummary
    submitted_at: AwareDatetime


class PlatformGameReportList(_Closed):
    items: tuple[PlatformGameReportQueueItem, ...]
    next_cursor: Annotated[str | None, Field(min_length=1, max_length=1024)]


class PlatformGameReportAuthority(_Closed):
    persisted_status: OpenGameStatus
    effective_status: EffectiveOpenGameState
    cancellation_source: OpenGameCancellationSource | None
    version: Annotated[int, Field(ge=1)]
    cancellation_allowed: bool
    cancellation_blocker: PlatformGameReportCancellationBlockedReason | None

    @model_validator(mode="after")
    def validate_cancellation_pair(self) -> PlatformGameReportAuthority:
        if self.cancellation_allowed == (self.cancellation_blocker is None):
            return self
        raise ValueError("cancellation permission and blocker must be paired")


class PlatformGameReportResolution(_Closed):
    resolution_id: uuid.UUID
    outcome: OpenGameReportResolutionOutcome
    resolution_note: Annotated[str, Field(min_length=1, max_length=500)]
    resolved_by_principal_id: Annotated[str, Field(min_length=1, max_length=128)]
    resolved_at: AwareDatetime
    game_version_before: Annotated[int | None, Field(ge=1)]
    game_version_after: Annotated[int | None, Field(ge=2)]


class PlatformGameReportDetail(_Closed):
    report_id: uuid.UUID
    category: OpenGameReportCategory
    status: OpenGameReportStatus
    facts: Annotated[str, Field(min_length=1, max_length=500)]
    submitted_at: AwareDatetime
    reporter_display_name: Annotated[str, Field(min_length=2, max_length=24)]
    reporter_registration_status: OpenGameRegistrationStatus
    target: OpenGameReportTargetSummary
    authority: PlatformGameReportAuthority
    allowed_outcomes: tuple[OpenGameReportResolutionOutcome, ...]
    resolution: PlatformGameReportResolution | None


class PlatformGameReportResolutionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    outcome: OpenGameReportResolutionOutcome
    resolution_note: Annotated[str, Field(min_length=1, max_length=500)]
