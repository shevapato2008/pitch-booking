from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from backend.app.models import VenueRecruitmentInvitationStatus


class ClosedModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RecruitmentInvitationVenue(ClosedModel):
    venue_id: uuid.UUID
    name: Annotated[str, Field(min_length=1, max_length=120)]
    district_name: Annotated[str, Field(min_length=1, max_length=120)]
    address: Annotated[str, Field(min_length=1, max_length=300)]


class RecruitmentInvitationEligibleVenues(ClosedModel):
    items: list[RecruitmentInvitationVenue]
    next_cursor: str | None


class RecruitmentInvitation(ClosedModel):
    id: uuid.UUID
    venue: RecruitmentInvitationVenue
    status: VenueRecruitmentInvitationStatus
    contact_label: Annotated[str, Field(min_length=1, max_length=40)]
    expires_at: datetime
    created_at: datetime
    claimed_at: datetime | None
    application_id: uuid.UUID | None
    revoked_at: datetime | None
    revocation_reason: Annotated[str | None, Field(min_length=1, max_length=120)]
    version: Annotated[int, Field(ge=1)]


class RecruitmentInvitations(ClosedModel):
    items: list[RecruitmentInvitation]
    next_cursor: str | None


class RecruitmentInvitationCreateRequest(ClosedModel):
    venue_id: uuid.UUID
    contact_label: Annotated[str, Field(min_length=1, max_length=40)]

    @field_validator("contact_label")
    @classmethod
    def normalize_contact_label(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("contact label is required")
        return normalized


class RecruitmentInvitationCreateResult(ClosedModel):
    invitation: RecruitmentInvitation
    token: Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{43}$")]
    invitation_path: Annotated[
        str,
        Field(pattern=r"^pages/venue-invitation/index\?token=[A-Za-z0-9_-]{43}$"),
    ]


class RecruitmentInvitationRevokeRequest(ClosedModel):
    reason: Annotated[str, Field(min_length=1, max_length=120)]

    @field_validator("reason")
    @classmethod
    def normalize_reason(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("revocation reason is required")
        return normalized


class VenueRecruitmentInvitation(ClosedModel):
    viewer_state: Literal[
        "AVAILABLE",
        "CLAIMED_BY_VIEWER",
        "SUBMITTED_BY_VIEWER",
    ]
    venue: RecruitmentInvitationVenue
    expires_at: datetime
    application_id: uuid.UUID | None
    version: Annotated[int, Field(ge=1)]


class VenueClaimEvidence(ClosedModel):
    MANAGEMENT_AUTHORIZATION: uuid.UUID
    VENUE_EXTERIOR: uuid.UUID


class InvitedVenueClaimRequest(ClosedModel):
    contact_name: Annotated[str, Field(min_length=1, max_length=40)]
    evidence: VenueClaimEvidence

    @field_validator("contact_name")
    @classmethod
    def normalize_contact_name(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("contact name is required")
        return normalized


class MutationResult(ClosedModel):
    status_code: Literal[200, 201]
    body: dict[str, object]
