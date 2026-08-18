from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import StrEnum
from typing import Literal, Protocol

PAYMENT_PROVIDER_MAX_REQUEST_DURATION = timedelta(seconds=30)


def _validate_merchant_order_no(value: str) -> None:
    if not value.strip() or len(value) > 32:
        raise ValueError("merchant_order_no must be non-empty and at most 32 characters")


def _validate_aware_expiry(value: datetime) -> None:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("time_expire must be timezone-aware")


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
    time_expire: datetime

    def __post_init__(self) -> None:
        _validate_merchant_order_no(self.merchant_order_no)
        _validate_aware_expiry(self.time_expire)


@dataclass(frozen=True, slots=True)
class QueryPaymentRequest:
    merchant_order_no: str

    def __post_init__(self) -> None:
        _validate_merchant_order_no(self.merchant_order_no)


@dataclass(frozen=True, slots=True)
class ClosePaymentRequest:
    merchant_order_no: str

    def __post_init__(self) -> None:
        _validate_merchant_order_no(self.merchant_order_no)


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

    def __post_init__(self) -> None:
        if self.status is QueryPaymentStatus.SUCCESS:
            if self.facts is None:
                raise ValueError("SUCCESS requires facts")
        elif self.facts is not None:
            raise ValueError("non-SUCCESS must not include facts")

        has_prepay_data = self.provider_prepay_id is not None or self.launch_params is not None
        if self.status is not QueryPaymentStatus.NOT_PAID and has_prepay_data:
            raise ValueError("only NOT_PAID may include prepay launch data")
        if self.launch_params is not None and self.provider_prepay_id is None:
            raise ValueError("launch_params requires provider_prepay_id")

        if self.status is QueryPaymentStatus.UNKNOWN:
            if not self.safe_error_code:
                raise ValueError("UNKNOWN requires safe_error_code")
        elif self.status is not QueryPaymentStatus.CLOSED and self.safe_error_code is not None:
            raise ValueError("safe_error_code is allowed only for CLOSED or UNKNOWN")


class ClosePaymentStatus(StrEnum):
    CLOSED = "CLOSED"
    SUCCESS = "SUCCESS"
    UNKNOWN = "UNKNOWN"


@dataclass(frozen=True, slots=True)
class ClosePaymentResult:
    status: ClosePaymentStatus
    facts: AuthoritativePaymentFacts | None = None
    safe_error_code: str | None = None

    def __post_init__(self) -> None:
        if self.status is ClosePaymentStatus.SUCCESS:
            if self.facts is None:
                raise ValueError("SUCCESS requires facts")
        elif self.facts is not None:
            raise ValueError("non-SUCCESS must not include facts")

        if self.status is ClosePaymentStatus.UNKNOWN:
            if not self.safe_error_code:
                raise ValueError("UNKNOWN requires safe_error_code")
        elif self.status is ClosePaymentStatus.SUCCESS and self.safe_error_code is not None:
            raise ValueError("SUCCESS must not include safe_error_code")


class PaymentProvider(Protocol):
    """Calls must enforce PAYMENT_PROVIDER_MAX_REQUEST_DURATION as their timeout."""

    name: str

    @property
    def app_id(self) -> str: ...

    @property
    def merchant_id(self) -> str: ...

    def create_prepay(self, request: CreatePrepayRequest) -> CreatePrepayResult: ...

    def query_payment(self, request: QueryPaymentRequest) -> QueryPaymentResult: ...

    def close_payment(self, request: ClosePaymentRequest) -> ClosePaymentResult: ...
