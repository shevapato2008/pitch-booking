import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ClosedModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class VenueImageResponse(ClosedModel):
    url: str = Field(min_length=1)
    alt: str = Field(min_length=1)
    role: Literal["COVER", "GALLERY"]
    sort_order: int = Field(ge=0)


class VenueFacilityResponse(ClosedModel):
    code: Literal["LIGHTING", "CHANGING_ROOM", "DRINKING_WATER", "PARKING"]
    name: str = Field(min_length=1)
    sort_order: int = Field(ge=0)


class PitchTypeResponse(ClosedModel):
    code: Literal["FIVE_A_SIDE", "SEVEN_A_SIDE"]
    name: str = Field(min_length=1)
    sort_order: int = Field(ge=0)


class AvailabilityWindowResponse(ClosedModel):
    start_date: date
    end_date: date


class PrimaryVenueResponse(ClosedModel):
    id: uuid.UUID
    name: str = Field(min_length=1)
    description: str
    price_advantage_text: str = Field(min_length=1)
    timezone: str = Field(min_length=1)
    business_hours_text: str = Field(min_length=1)
    address: str = Field(min_length=1)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    parking_text: str = Field(min_length=1)
    phone: str = Field(min_length=1)
    refund_policy_summary: str = Field(min_length=1)
    images: list[VenueImageResponse] = Field(min_length=1)
    facilities: list[VenueFacilityResponse] = Field(min_length=1)
    pitch_types: list[PitchTypeResponse] = Field(min_length=1)
    availability_window: AvailabilityWindowResponse
    generated_at: datetime
