from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from backend.app.models import (
    VenueOnboardingEvidenceKind,
    VenueOnboardingKind,
    VenueOnboardingStatus,
)

PlatformOnboardingDecisionOutcome = Literal[
    VenueOnboardingStatus.APPROVED,
    VenueOnboardingStatus.REJECTED,
]


class ClosedModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PlatformOnboardingVenueSummary(ClosedModel):
    venue_id: uuid.UUID | None
    name: str
    address: str
    district_name: str


class PlatformOnboardingQueueItem(ClosedModel):
    application_id: uuid.UUID
    kind: VenueOnboardingKind
    status: VenueOnboardingStatus
    contact_name: str
    venue: PlatformOnboardingVenueSummary
    submitted_at: datetime
    reviewed_at: datetime | None


class PlatformOnboardingQueue(ClosedModel):
    items: list[PlatformOnboardingQueueItem]
    next_cursor: str | None


class PlatformOnboardingApplicant(ClosedModel):
    contact_name: str
    masked_phone: str


class PlatformOnboardingTargetVenue(ClosedModel):
    venue_id: uuid.UUID
    name: str
    address: str
    district_code: str
    district_name: str
    latitude: float
    longitude: float


class PlatformOnboardingProposedVenue(ClosedModel):
    name: str
    address: str
    district_code: str
    district_name: str
    latitude: float
    longitude: float


class PlatformOnboardingDuplicateCandidate(ClosedModel):
    venue_id: uuid.UUID
    name: str
    address: str
    district_name: str
    is_listed: bool
    exact_address_match: bool
    distance_meters: int


class PlatformOnboardingEvidence(ClosedModel):
    evidence_id: uuid.UUID
    kind: VenueOnboardingEvidenceKind
    content_type: str
    byte_size: int
    created_at: datetime


class PlatformOnboardingDecision(ClosedModel):
    application_id: uuid.UUID
    outcome: PlatformOnboardingDecisionOutcome
    reason: str
    reviewer_principal_id: str
    reviewed_at: datetime
    approved_venue_id: uuid.UUID | None


class PlatformOnboardingApplicationDetail(ClosedModel):
    application_id: uuid.UUID
    kind: VenueOnboardingKind
    status: VenueOnboardingStatus
    submitted_at: datetime
    applicant: PlatformOnboardingApplicant
    target_venue: PlatformOnboardingTargetVenue | None
    proposed_venue: PlatformOnboardingProposedVenue | None
    duplicate_candidates: list[PlatformOnboardingDuplicateCandidate]
    evidence: list[PlatformOnboardingEvidence]
    decision: PlatformOnboardingDecision | None


class PlatformOnboardingEvidenceDownload(ClosedModel):
    download_url: str
    expires_at: datetime


class PlatformOnboardingDecisionRequest(ClosedModel):
    outcome: PlatformOnboardingDecisionOutcome
    reason: str = Field(min_length=1, max_length=1000)

    @field_validator("reason")
    @classmethod
    def normalize_reason(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("review reason is required")
        return normalized
