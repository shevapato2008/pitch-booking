import uuid
from datetime import date, datetime
from typing import Annotated, Literal

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


PublicPitchTypeCode = Literal["FIVE_A_SIDE", "SEVEN_A_SIDE", "ELEVEN_A_SIDE"]


class VenueTransitResponse(ClosedModel):
    kind: Literal["SUBWAY", "BUS"]
    name: str = Field(min_length=1)
    lines: list[str]
    distance_meters: int = Field(ge=0)
    distance_basis: Literal["STRAIGHT_LINE", "MAP_VERIFIED"]


class VenueMapItemResponse(ClosedModel):
    id: uuid.UUID
    name: str = Field(min_length=1)
    address: str = Field(min_length=1)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    booking_mode: Literal["ONLINE", "DIRECTORY_ONLY"]
    pitch_types: list[PublicPitchTypeCode]
    cover_image: str | None
    nearest_transit: list[VenueTransitResponse]
    content_verified_at: datetime


class VenueMapResponse(ClosedModel):
    coordinate_system: Literal["GCJ02"] = "GCJ02"
    venues: list[VenueMapItemResponse] = Field(min_length=1)


class VenueDetailBase(ClosedModel):
    id: uuid.UUID
    slug: str = Field(min_length=1)
    name: str = Field(min_length=1)
    description: str
    address: str = Field(min_length=1)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    coordinate_system: Literal["GCJ02"] = "GCJ02"
    navigation_poi_name: str = Field(min_length=1)
    navigation_latitude: float = Field(ge=-90, le=90)
    navigation_longitude: float = Field(ge=-180, le=180)
    pitch_types: list[PublicPitchTypeCode]
    cover_image: str | None
    nearest_transit: list[VenueTransitResponse]
    content_verified_at: datetime


class OnlineVenueDetailResponse(VenueDetailBase):
    booking_mode: Literal["ONLINE"] = "ONLINE"
    price_advantage_text: str = Field(min_length=1)
    timezone: Literal["Asia/Shanghai"]
    business_hours_text: str = Field(min_length=1)
    parking_text: str = Field(min_length=1)
    phone: str = Field(min_length=1)
    refund_policy_summary: str = Field(min_length=1)
    images: list[VenueImageResponse] = Field(min_length=1)
    facilities: list[VenueFacilityResponse] = Field(min_length=1)
    availability_window: AvailabilityWindowResponse


class DirectoryVenueDetailResponse(VenueDetailBase):
    booking_mode: Literal["DIRECTORY_ONLY"] = "DIRECTORY_ONLY"
    business_hours_text: str | None
    parking_text: str | None
    images: list[str]
    facilities: list[str]


VenueDetailResponse = Annotated[
    OnlineVenueDetailResponse | DirectoryVenueDetailResponse,
    Field(discriminator="booking_mode"),
]
