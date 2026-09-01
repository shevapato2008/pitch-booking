import uuid
from datetime import datetime
from enum import StrEnum

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, field_validator

from backend.app.models import (
    VenueMembershipAuditAction,
    VenueMembershipRole,
    VenueStaffInvitationStatus,
)


class ClosedModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class VenueStaffPermission(StrEnum):
    MANAGE_PROFILE = "MANAGE_PROFILE"
    MANAGE_PITCHES = "MANAGE_PITCHES"
    MANAGE_INVENTORY = "MANAGE_INVENTORY"
    FULFILL_ORDERS = "FULFILL_ORDERS"


class PermissionRequest(ClosedModel):
    permissions: list[VenueStaffPermission] = Field(min_length=1, max_length=4)

    @field_validator("permissions")
    @classmethod
    def permissions_are_unique(
        cls, value: list[VenueStaffPermission]
    ) -> list[VenueStaffPermission]:
        if len(set(value)) != len(value):
            raise ValueError("permissions must be unique")
        return value


class CreateVenueStaffInvitationRequest(PermissionRequest):
    contact_label: str = Field(min_length=1, max_length=40)

    @field_validator("contact_label")
    @classmethod
    def normalize_contact_label(cls, value: str) -> str:
        normalized = value.strip()
        if value != normalized:
            raise ValueError("contact_label must be trimmed")
        return value


class UpdateVenueStaffPermissionsRequest(PermissionRequest):
    expected_version: int = Field(ge=1)


class RemoveVenueStaffMemberRequest(ClosedModel):
    expected_version: int = Field(ge=1)
    reason: str = Field(min_length=1, max_length=200)

    @field_validator("reason")
    @classmethod
    def normalize_reason(cls, value: str) -> str:
        normalized = value.strip()
        if value != normalized:
            raise ValueError("reason must be trimmed")
        return value


class TransferVenueOwnerRequest(ClosedModel):
    target_membership_id: uuid.UUID
    expected_source_version: int = Field(ge=1)
    expected_target_version: int = Field(ge=1)
    reason: str = Field(min_length=1, max_length=200)

    @field_validator("reason")
    @classmethod
    def normalize_reason(cls, value: str) -> str:
        normalized = value.strip()
        if value != normalized:
            raise ValueError("reason must be trimmed")
        return value


class VenueStaffMember(ClosedModel):
    id: uuid.UUID
    display_name: str = Field(min_length=1, max_length=40)
    avatar_url: AnyHttpUrl | None
    role: VenueMembershipRole
    permissions: list[VenueStaffPermission] = Field(min_length=1, max_length=4)
    is_self: bool
    is_active: bool
    version: int = Field(ge=1)


class VenueStaffInvitation(ClosedModel):
    id: uuid.UUID
    contact_label: str = Field(min_length=1, max_length=40)
    status: VenueStaffInvitationStatus
    permissions: list[VenueStaffPermission] = Field(min_length=1, max_length=4)
    expires_at: datetime
    created_at: datetime


class VenueStaffInvitationCreated(VenueStaffInvitation):
    invitation_path: str = Field(
        pattern=r"^/pages/venue-staff-invitation/index\?token=[A-Za-z0-9_-]{43}$"
    )


class CurrentVenueStaffInvitation(ClosedModel):
    id: uuid.UUID
    venue_id: uuid.UUID
    venue_name: str = Field(min_length=1, max_length=200)
    status: VenueStaffInvitationStatus
    permissions: list[VenueStaffPermission] = Field(min_length=1, max_length=4)
    expires_at: datetime


class VenueStaffAuditSummary(ClosedModel):
    id: uuid.UUID
    action: VenueMembershipAuditAction
    target_display_name: str = Field(min_length=1, max_length=40)
    created_at: datetime


class VenueStaffOverview(ClosedModel):
    venue_id: uuid.UUID
    venue_name: str = Field(min_length=1, max_length=200)
    viewer_role: VenueMembershipRole
    viewer_permissions: list[VenueStaffPermission] = Field(min_length=1, max_length=4)
    can_manage: bool
    members: list[VenueStaffMember]
    active_invitations: list[VenueStaffInvitation]
    recent_audits: list[VenueStaffAuditSummary] = Field(max_length=20)


class VenueStaffMembershipAccepted(ClosedModel):
    venue_id: uuid.UUID
    venue_name: str = Field(min_length=1, max_length=200)
    membership: VenueStaffMember
    workspace_path: str


class VenueOwnerTransferResult(ClosedModel):
    venue_id: uuid.UUID
    previous_owner: VenueStaffMember
    current_owner: VenueStaffMember
    transferred_at: datetime


class CreateInvitationResult:
    def __init__(
        self,
        *,
        response: VenueStaffInvitation | VenueStaffInvitationCreated,
        created: bool,
    ) -> None:
        self.response = response
        self.created = created
