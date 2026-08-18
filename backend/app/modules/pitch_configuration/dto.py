import uuid
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field


class ClosedModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ConfigurationVenueResponse(ClosedModel):
    id: uuid.UUID
    name: str
    timezone: str


class CapabilityResponse(ClosedModel):
    allowed: bool
    reason: str | None


class FutureBlockersResponse(ClosedModel):
    AVAILABLE: int = 0
    LOCKED: int = 0
    BOOKED: int = 0


class PitchCapabilitiesResponse(ClosedModel):
    edit_format: CapabilityResponse
    delete: CapabilityResponse
    deactivate: CapabilityResponse
    reactivate: CapabilityResponse
    future_blockers: FutureBlockersResponse


class ConfiguredPitchResponse(ClosedModel):
    id: uuid.UUID
    custom_name: str | None
    system_name: str
    display_name: str
    players_per_side: int = Field(ge=1, le=99)
    sequence: int = Field(ge=1)
    status: Literal["ACTIVE", "INACTIVE"]
    capabilities: PitchCapabilitiesResponse


class CreatedPitchMappingResponse(ClosedModel):
    client_ref: str
    pitch_id: uuid.UUID
    sequence: int
    system_name: str


class PitchConfigurationResponse(ClosedModel):
    venue: ConfigurationVenueResponse
    configuration_version: int = Field(ge=1)
    pitches: list[ConfiguredPitchResponse]
    created_pitch_mappings: list[CreatedPitchMappingResponse]


class CreatePitchChange(ClosedModel):
    operation: Literal["CREATE"]
    client_ref: str = Field(min_length=1, max_length=100)
    custom_name: str | None
    players_per_side: Annotated[int, Field(strict=True)]


class UpdatePitchChange(ClosedModel):
    operation: Literal["UPDATE"]
    pitch_id: uuid.UUID
    custom_name: str | None
    players_per_side: Annotated[int, Field(strict=True)]
    status: Literal["ACTIVE", "INACTIVE"]


class DeletePitchChange(ClosedModel):
    operation: Literal["DELETE"]
    pitch_id: uuid.UUID


PitchChange = Annotated[
    CreatePitchChange | UpdatePitchChange | DeletePitchChange,
    Field(discriminator="operation"),
]


class SavePitchConfigurationRequest(ClosedModel):
    expected_version: Annotated[int, Field(strict=True, ge=1)]
    changes: list[PitchChange]
