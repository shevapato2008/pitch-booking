import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from backend.app.models import OrderStatus


class ClosedModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CreateOrderRequest(ClosedModel):
    slot_id: uuid.UUID
    checkout_version: Annotated[int, Field(strict=True, ge=1)]
    contact_name: Annotated[
        str,
        Field(min_length=1, max_length=40),
    ]


class OrderVenueResponse(ClosedModel):
    id: uuid.UUID
    name: str = Field(min_length=1)
    address: str = Field(min_length=1)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    customer_service_phone: str = Field(min_length=1)


class OrderPitchResponse(ClosedModel):
    id: uuid.UUID
    name: str = Field(min_length=1)


class OrderContactResponse(ClosedModel):
    name: str = Field(min_length=1, max_length=40)
    masked_phone: str = Field(pattern=r"^1[0-9]{2}\*{4}[0-9]{4}$")


class OrderDetailResponse(ClosedModel):
    id: uuid.UUID
    order_number: str = Field(min_length=1)
    status: OrderStatus
    slot_id: uuid.UUID
    venue: OrderVenueResponse
    pitch: OrderPitchResponse
    starts_at: datetime
    ends_at: datetime
    duration_minutes: int = Field(ge=1)
    price_cents: int = Field(ge=0)
    currency: Literal["CNY"]
    contact: OrderContactResponse
    created_at: datetime
    expires_at: datetime
    expired_at: datetime | None
    cancellation_summary: str = Field(min_length=1)
    closing_payment: bool
    detail_path: str = Field(pattern=r"^/api/v1/orders/[0-9a-f-]{36}$")


class CreateOrderResult(ClosedModel):
    status_code: Literal[200, 201]
    body: dict[str, object]
