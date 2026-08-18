import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from backend.app.models import OrderStatus, PaymentState
from backend.app.modules.checkout.dto import (
    CheckoutPitchResponse,
    CheckoutVenueResponse,
)


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


class OrderPitchResponse(ClosedModel):
    id: uuid.UUID
    name: str = Field(min_length=1)


class OrderContactResponse(ClosedModel):
    name: str = Field(min_length=1, max_length=40)
    masked_phone: str = Field(pattern=r"^1[0-9]{2}\*{4}[0-9]{4}$")


class OrderAllowedActionsResponse(ClosedModel):
    can_pay: bool
    can_cancel: bool
    can_check_in: bool
    can_complete: bool
    can_refund: bool
    blocked_reason: Literal[
        "PAYMENT_RESULT_PENDING",
        "CANCELLATION_WINDOW_CLOSED",
        "REFUND_IN_PROGRESS",
        "CHECK_IN_TOO_EARLY",
        "CHECK_IN_REQUIRED",
        "SESSION_NOT_ENDED",
        "ORDER_TERMINAL",
        "CANCELLATION_REQUIRES_SUPPORT",
    ] | None


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
    payment_state: PaymentState | None
    payment_confirming: bool
    closing_payment: bool
    paid_at: datetime | None
    detail_path: str = Field(pattern=r"^/api/v1/orders/[0-9a-f-]{36}$")


class OrderSummaryResponse(ClosedModel):
    id: uuid.UUID
    order_number: str = Field(min_length=1)
    status: OrderStatus
    venue: CheckoutVenueResponse
    pitch: CheckoutPitchResponse
    starts_at: datetime
    ends_at: datetime
    price_cents: int = Field(ge=0)
    currency: Literal["CNY"]
    created_at: datetime
    expires_at: datetime
    payment_confirming: bool
    closing_payment: bool


class OrderListResponse(ClosedModel):
    orders: list[OrderSummaryResponse]
    next_cursor: str | None = Field(min_length=1)


class CreateOrderResult(ClosedModel):
    status_code: Literal[200, 201]
    body: dict[str, object]
