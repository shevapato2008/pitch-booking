import uuid

from pydantic import BaseModel, ConfigDict, Field

from backend.app.models import VenueMembershipRole
from backend.app.modules.venue_staff.dto import VenueStaffPermission


class ClosedModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ManagedVenueResponse(ClosedModel):
    id: uuid.UUID
    name: str = Field(min_length=1)
    district_name: str = Field(min_length=1)
    address: str = Field(min_length=1)
    role: VenueMembershipRole
    permissions: list[VenueStaffPermission] = Field(min_length=1, max_length=4)


class ManagedVenuesResponse(ClosedModel):
    venues: list[ManagedVenueResponse]
