import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ClosedModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CheckoutVenueResponse(ClosedModel):
    id: uuid.UUID
    name: str = Field(min_length=1)


class CheckoutPitchResponse(ClosedModel):
    id: uuid.UUID
    name: str = Field(min_length=1)


class CheckoutContactResponse(ClosedModel):
    masked_phone: str | None = Field(
        pattern=r"^1[0-9]{2}\*{4}[0-9]{4}$",
    )
    last_contact_name: str | None = Field(min_length=1, max_length=40)


class CheckoutResponse(ClosedModel):
    slot_id: uuid.UUID
    venue: CheckoutVenueResponse
    pitch: CheckoutPitchResponse
    date: date
    starts_at: datetime
    ends_at: datetime
    duration_minutes: int = Field(ge=1)
    price_cents: int = Field(ge=0)
    currency: Literal["CNY"]
    available: Literal[True]
    cancellation_summary: str = Field(min_length=1)
    lock_duration_seconds: int = Field(ge=1)
    contact: CheckoutContactResponse
    checkout_version: int = Field(ge=1)
