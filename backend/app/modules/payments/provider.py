from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import Literal, Protocol


@dataclass(frozen=True, slots=True)
class PaymentLaunchParams:
    timeStamp: str
    nonceStr: str
    package: str
    signType: Literal["RSA"]
    paySign: str

    def as_dict(self) -> dict[str, str]:
        return {
            "timeStamp": self.timeStamp,
            "nonceStr": self.nonceStr,
            "package": self.package,
            "signType": self.signType,
            "paySign": self.paySign,
        }


@dataclass(frozen=True, slots=True)
class CreatePrepayRequest:
    merchant_order_no: str
    description: str
    amount_cents: int
    currency: Literal["CNY"]
    payer_openid: str = field(repr=False)


@dataclass(frozen=True, slots=True)
class QueryPaymentRequest:
    merchant_order_no: str


@dataclass(frozen=True, slots=True)
class ClosePaymentRequest:
    merchant_order_no: str


@dataclass(frozen=True, slots=True)
class Created:
    provider_prepay_id: str
    launch_params: PaymentLaunchParams


@dataclass(frozen=True, slots=True)
class Rejected:
    safe_error_code: str


@dataclass(frozen=True, slots=True)
class Unknown:
    safe_error_code: str


type CreatePrepayResult = Created | Rejected | Unknown


class QueryPaymentStatus(StrEnum):
    NOT_FOUND = "NOT_FOUND"
    NOT_PAID = "NOT_PAID"
    SUCCESS = "SUCCESS"
    CLOSED = "CLOSED"
    UNKNOWN = "UNKNOWN"


@dataclass(frozen=True, slots=True)
class AuthoritativePaymentFacts:
    app_id: str
    merchant_id: str
    merchant_order_no: str
    provider_transaction_no: str
    amount_cents: int
    currency: Literal["CNY"]
    paid_at: datetime


@dataclass(frozen=True, slots=True)
class QueryPaymentResult:
    status: QueryPaymentStatus
    facts: AuthoritativePaymentFacts | None = None
    provider_prepay_id: str | None = None
    launch_params: PaymentLaunchParams | None = None
    safe_error_code: str | None = None


class ClosePaymentStatus(StrEnum):
    CLOSED = "CLOSED"
    SUCCESS = "SUCCESS"
    UNKNOWN = "UNKNOWN"


@dataclass(frozen=True, slots=True)
class ClosePaymentResult:
    status: ClosePaymentStatus
    facts: AuthoritativePaymentFacts | None = None
    safe_error_code: str | None = None


class PaymentProvider(Protocol):
    name: str

    def create_prepay(self, request: CreatePrepayRequest) -> CreatePrepayResult: ...

    def query_payment(self, request: QueryPaymentRequest) -> QueryPaymentResult: ...

    def close_payment(self, request: ClosePaymentRequest) -> ClosePaymentResult: ...
