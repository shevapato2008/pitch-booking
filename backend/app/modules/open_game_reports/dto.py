from __future__ import annotations

import uuid
from enum import StrEnum
from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field

from backend.app.models import (
    OpenGameReportCategory,
    OpenGameReportResolutionOutcome,
)


class _Closed(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class OpenGameReportStatus(StrEnum):
    PENDING = "PENDING"
    RESOLVED = "RESOLVED"


class OpenGameReportSubmissionBlocker(StrEnum):
    REPORTING_WINDOW_CLOSED = "REPORTING_WINDOW_CLOSED"
    REPORT_ALREADY_EXISTS = "REPORT_ALREADY_EXISTS"


class OpenGameReportTargetSummary(_Closed):
    game_id: uuid.UUID
    game_name: Annotated[str, Field(min_length=1, max_length=30)]
    organizer_team_name: Annotated[str, Field(min_length=1, max_length=30)]
    venue_name: Annotated[str, Field(min_length=1)]
    pitch_name: Annotated[str, Field(min_length=1)]
    starts_at: AwareDatetime
    ends_at: AwareDatetime
    time_zone: Literal["Asia/Shanghai"]


class OpenGameReportForReporter(_Closed):
    report_id: uuid.UUID
    category: OpenGameReportCategory
    facts: Annotated[str, Field(min_length=1, max_length=500)]
    submitted_at: AwareDatetime
    status: OpenGameReportStatus
    outcome: OpenGameReportResolutionOutcome | None
    resolved_at: AwareDatetime | None
    result_title: str | None
    result_message: str | None


class OpenGameReportContext(_Closed):
    target: OpenGameReportTargetSummary
    report_deadline: AwareDatetime
    submission_allowed: bool
    submission_blocker: OpenGameReportSubmissionBlocker | None
    report: OpenGameReportForReporter | None


class OpenGameReportSubmissionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category: OpenGameReportCategory
    facts: Annotated[str, Field(min_length=1, max_length=500)]


class OpenGameReportSubmissionResult(_Closed):
    report: OpenGameReportForReporter
    created: bool
