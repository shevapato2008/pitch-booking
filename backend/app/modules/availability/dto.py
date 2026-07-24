import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from backend.app.modules.venues.dto import AvailabilityWindowResponse


class ClosedModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SlotResponse(ClosedModel):
    id: uuid.UUID
    starts_at: datetime
    ends_at: datetime
    price_cents: int = Field(ge=0)
    status: Literal["AVAILABLE", "TEMPORARILY_LOCKED", "BOOKED", "CLOSED", "EXPIRED"]
    unavailable_reason: Literal[
        "HELD_FOR_PAYMENT", "ALREADY_BOOKED", "VENUE_CLOSED", "TIME_PASSED"
    ] | None


class PitchAvailabilityResponse(ClosedModel):
    id: uuid.UUID
    name: str = Field(min_length=1)
    pitch_type: Literal["FIVE_A_SIDE", "SEVEN_A_SIDE"]
    sort_order: int = Field(ge=0)
    slots: list[SlotResponse]


class AvailabilityResponse(ClosedModel):
    venue_id: uuid.UUID
    timezone: str = Field(min_length=1)
    date: date
    pitch_type: Literal["FIVE_A_SIDE", "SEVEN_A_SIDE"]
    availability_window: AvailabilityWindowResponse
    pitches: list[PitchAvailabilityResponse]
    generated_at: datetime
