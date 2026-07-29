import uuid
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, ConfigDict

from backend.app.modules.orders.dto import OrderDetailResponse


class _ClosedModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PaymentLaunchParamsResponse(_ClosedModel):
    timeStamp: str
    nonceStr: str
    package: str
    signType: Literal["RSA"]
    paySign: str


class PaymentPrepayCreatedResponse(_ClosedModel):
    order_id: uuid.UUID
    payment_id: uuid.UUID
    status: Literal["PREPAY_CREATED"]
    launch_params: PaymentLaunchParamsResponse


class PaymentConfirmingResponse(_ClosedModel):
    order_id: uuid.UUID
    payment_id: uuid.UUID
    status: Literal["PAYMENT_CONFIRMING"]
    order: OrderDetailResponse


class PaymentAlreadyConfirmedResponse(_ClosedModel):
    order_id: uuid.UUID
    status: Literal["ALREADY_CONFIRMED"]
    order: OrderDetailResponse


@dataclass(frozen=True, slots=True)
class CreatePaymentResult:
    status_code: Literal[200, 201, 202]
    body: dict[str, object]
