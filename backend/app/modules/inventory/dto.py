import uuid
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field


class ClosedModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class InventoryVenueResponse(ClosedModel):
    id: uuid.UUID
    name: str = Field(min_length=1)
    timezone: str = Field(min_length=1)


class InventoryPitchResponse(ClosedModel):
    id: uuid.UUID
    name: str = Field(min_length=1)
    display_name: str = Field(min_length=1)
    pitch_type: Literal["FIVE_A_SIDE", "SEVEN_A_SIDE"] | None
    players_per_side: int = Field(ge=1, le=99)


class InventoryWindowResponse(ClosedModel):
    start_date: date
    end_date: date


class InventorySlotResponse(ClosedModel):
    id: uuid.UUID
    pitch_id: uuid.UUID
    starts_at: datetime
    ends_at: datetime
    start_time: str = Field(pattern=r"^[0-2][0-9]:[0-5][0-9]$")
    end_time: str = Field(pattern=r"^[0-2][0-9]:[0-5][0-9]$")
    price_cents: int = Field(ge=0)
    status: Literal["AVAILABLE", "LOCKED", "BOOKED", "CLOSED"]
    checkout_version: int = Field(ge=1)
    editable: bool
    read_only_reason: Literal[
        "HELD_FOR_PAYMENT", "ALREADY_BOOKED", "TIME_PASSED"
    ] | None


class InventoryResponse(ClosedModel):
    venue: InventoryVenueResponse
    local_date: date
    availability_window: InventoryWindowResponse
    pitches: list[InventoryPitchResponse]
    selected_pitch_id: uuid.UUID
    slots: list[InventorySlotResponse]
    generated_at: datetime


class CreateInventorySlotRequest(ClosedModel):
    pitch_id: uuid.UUID
    local_date: date
    start_time: str = Field(pattern=r"^[0-2][0-9]:[0-5][0-9]$")
    end_time: str = Field(pattern=r"^[0-2][0-9]:[0-5][0-9]$")
    price_cents: Annotated[int, Field(strict=True, ge=0)]


class UpdateInventorySlotRequest(ClosedModel):
    price_cents: Annotated[int, Field(strict=True, ge=0)]
    status: Literal["AVAILABLE", "CLOSED"]
    expected_checkout_version: Annotated[int, Field(strict=True, ge=1)]
