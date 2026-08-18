import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

from backend.app.models import OrderStatus
from backend.app.modules.checkout.dto import (
    CheckoutPitchResponse,
    CheckoutVenueResponse,
)
from backend.app.modules.orders.dto import OrderAllowedActionsResponse


class ClosedModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class VenueFulfillmentOrderResponse(ClosedModel):
    id: uuid.UUID
    order_number: str = Field(min_length=1)
    status: OrderStatus
    pitch: CheckoutPitchResponse
    starts_at: datetime
    ends_at: datetime
    masked_phone: str = Field(pattern=r"^1[0-9]{2}\*{4}[0-9]{4}$")
    checked_in_at: datetime | None
    allowed_actions: OrderAllowedActionsResponse


class VenueFulfillmentOrdersResponse(ClosedModel):
    venue: CheckoutVenueResponse
    service_date: date
    generated_at: datetime
    orders: list[VenueFulfillmentOrderResponse]
    next_cursor: str | None = Field(min_length=1)
