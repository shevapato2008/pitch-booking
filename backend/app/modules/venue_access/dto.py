import uuid

from pydantic import BaseModel, ConfigDict, Field


class ClosedModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ManagedVenueResponse(ClosedModel):
    id: uuid.UUID
    name: str = Field(min_length=1)
    district_name: str = Field(min_length=1)
    address: str = Field(min_length=1)


class ManagedVenuesResponse(ClosedModel):
    venues: list[ManagedVenueResponse]
