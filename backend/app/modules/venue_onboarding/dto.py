from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from backend.app.models import (
    VenueOnboardingEvidenceKind,
    VenueOnboardingKind,
    VenueOnboardingStatus,
)


class ClosedModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class VenueOnboardingCandidate(ClosedModel):
    venue_id: uuid.UUID
    name: str = Field(min_length=1)
    district_name: str = Field(min_length=1)
    address: str = Field(min_length=1)


class VenueOnboardingCandidates(ClosedModel):
    items: list[VenueOnboardingCandidate]
    next_cursor: str | None


class CreateVenueOnboardingUploadIntent(ClosedModel):
    kind: VenueOnboardingEvidenceKind


class VenueOnboardingPostPolicy(ClosedModel):
    url: str
    method: Literal["POST"] = "POST"
    fields: dict[str, str]
    expires_at: datetime


class VenueOnboardingEvidenceConstraints(ClosedModel):
    kind: VenueOnboardingEvidenceKind
    accepted_mime_types: list[str]
    maximum_bytes: int


class VenueOnboardingUploadIntent(ClosedModel):
    evidence_id: uuid.UUID
    status: Literal["PENDING_UPLOAD"] = "PENDING_UPLOAD"
    post_policy: VenueOnboardingPostPolicy
    constraints: VenueOnboardingEvidenceConstraints


class VenueOnboardingEvidenceClosed(ClosedModel):
    evidence_id: uuid.UUID
    status: Literal["COMPLETED"] = "COMPLETED"


class VenueClaimEvidence(ClosedModel):
    MANAGEMENT_AUTHORIZATION: uuid.UUID
    VENUE_EXTERIOR: uuid.UUID


class VenueCreateEvidence(ClosedModel):
    BUSINESS_LICENSE: uuid.UUID
    MANAGEMENT_AUTHORIZATION: uuid.UUID
    VENUE_EXTERIOR: uuid.UUID
    VENUE_INTERIOR: uuid.UUID


class SubmitVenueClaim(ClosedModel):
    venue_id: uuid.UUID
    contact_name: Annotated[str, Field(min_length=1, max_length=40)]
    evidence: VenueClaimEvidence


class SubmitVenueCreate(ClosedModel):
    name: Annotated[str, Field(min_length=1, max_length=120)]
    address: Annotated[str, Field(min_length=1, max_length=300)]
    district_code: Annotated[str, Field(pattern=r"^[0-9]{6}$")]
    district_name: Annotated[str, Field(min_length=1, max_length=120)]
    latitude: Annotated[float, Field(ge=-90, le=90)]
    longitude: Annotated[float, Field(ge=-180, le=180)]
    contact_name: Annotated[str, Field(min_length=1, max_length=40)]
    evidence: VenueCreateEvidence


class VenueOnboardingApplicationVenue(ClosedModel):
    venue_id: uuid.UUID | None
    name: str = Field(min_length=1)
    address: str = Field(min_length=1)


class VenueOnboardingApplicationResponse(ClosedModel):
    application_id: uuid.UUID
    kind: VenueOnboardingKind
    status: VenueOnboardingStatus
    rejection_reason: str | None = Field(min_length=1)
    venue: VenueOnboardingApplicationVenue
    submitted_at: datetime
    updated_at: datetime


class VenueOnboardingApplications(ClosedModel):
    items: list[VenueOnboardingApplicationResponse]
    next_cursor: str | None


class MutationResult(ClosedModel):
    status_code: Literal[200, 201]
    body: dict[str, object]
