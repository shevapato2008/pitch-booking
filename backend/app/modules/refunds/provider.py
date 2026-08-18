from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Literal, Protocol


def _validate_merchant_number(field: str, value: str) -> None:
    if not value.strip() or len(value) > 32:
        raise ValueError(f"{field} must be non-empty and at most 32 characters")


def _validate_nonempty(field: str, value: str) -> None:
    if not value.strip():
        raise ValueError(f"{field} must be non-empty")


def _validate_cny(currency: str) -> None:
    if currency != "CNY":
        raise ValueError("currency must be CNY")


def _validate_amount(amount_cents: int) -> None:
    if amount_cents < 0:
        raise ValueError("amount_cents must be non-negative")


def _validate_aware(field: str, value: datetime) -> None:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{field} must be timezone-aware")


@dataclass(frozen=True, slots=True)
class CreateRefundRequest:
    merchant_refund_no: str
    merchant_order_no: str
    provider_transaction_no: str
    amount_cents: int
    currency: Literal["CNY"]

    def __post_init__(self) -> None:
        _validate_merchant_number("merchant_refund_no", self.merchant_refund_no)
        _validate_merchant_number("merchant_order_no", self.merchant_order_no)
        _validate_nonempty("provider_transaction_no", self.provider_transaction_no)
        _validate_amount(self.amount_cents)
        _validate_cny(self.currency)


@dataclass(frozen=True, slots=True)
class QueryRefundRequest:
    merchant_refund_no: str

    def __post_init__(self) -> None:
        _validate_merchant_number("merchant_refund_no", self.merchant_refund_no)


@dataclass(frozen=True, slots=True)
class RefundAccepted:
    provider_refund_no: str

    def __post_init__(self) -> None:
        _validate_nonempty("provider_refund_no", self.provider_refund_no)


@dataclass(frozen=True, slots=True)
class RefundRejected:
    safe_error_code: str

    def __post_init__(self) -> None:
        _validate_nonempty("safe_error_code", self.safe_error_code)


@dataclass(frozen=True, slots=True)
class RefundUnknown:
    safe_error_code: str

    def __post_init__(self) -> None:
        _validate_nonempty("safe_error_code", self.safe_error_code)


type CreateRefundResult = RefundAccepted | RefundRejected | RefundUnknown


@dataclass(frozen=True, slots=True)
class AuthoritativeRefundFacts:
    provider: str
    merchant_id: str
    merchant_refund_no: str
    provider_refund_no: str
    merchant_order_no: str
    provider_transaction_no: str
    amount_cents: int
    currency: Literal["CNY"]
    refunded_at: datetime

    def __post_init__(self) -> None:
        _validate_nonempty("provider", self.provider)
        _validate_nonempty("merchant_id", self.merchant_id)
        _validate_merchant_number("merchant_refund_no", self.merchant_refund_no)
        _validate_nonempty("provider_refund_no", self.provider_refund_no)
        _validate_merchant_number("merchant_order_no", self.merchant_order_no)
        _validate_nonempty("provider_transaction_no", self.provider_transaction_no)
        _validate_amount(self.amount_cents)
        _validate_cny(self.currency)
        _validate_aware("refunded_at", self.refunded_at)


class QueryRefundStatus(StrEnum):
    NOT_FOUND = "NOT_FOUND"
    PROCESSING = "PROCESSING"
    SUCCESS = "SUCCESS"
    FAILED = "FAILED"
    UNKNOWN = "UNKNOWN"


@dataclass(frozen=True, slots=True)
class QueryRefundResult:
    status: QueryRefundStatus
    facts: AuthoritativeRefundFacts | None = None
    safe_error_code: str | None = None

    def __post_init__(self) -> None:
        if self.status is QueryRefundStatus.SUCCESS:
            if self.facts is None:
                raise ValueError("SUCCESS requires facts")
        elif self.facts is not None:
            raise ValueError("non-SUCCESS must not include facts")

        if self.status is QueryRefundStatus.UNKNOWN and not self.safe_error_code:
            raise ValueError("UNKNOWN requires safe_error_code")
        if self.status is QueryRefundStatus.FAILED and not self.safe_error_code:
            raise ValueError("FAILED requires safe_error_code")
        if self.status not in {QueryRefundStatus.UNKNOWN, QueryRefundStatus.FAILED}:
            if self.safe_error_code is not None:
                raise ValueError("safe_error_code is allowed only for FAILED or UNKNOWN")


@dataclass(frozen=True, slots=True)
class ExpectedRefundFacts:
    provider: str
    merchant_id: str
    merchant_refund_no: str
    merchant_order_no: str
    provider_transaction_no: str
    amount_cents: int
    currency: str


class RefundFactsMismatchCode(StrEnum):
    PROVIDER = "REFUND_PROVIDER_MISMATCH"
    MERCHANT_ID = "REFUND_MERCHANT_ID_MISMATCH"
    MERCHANT_REFUND_NO = "REFUND_MERCHANT_REFUND_NO_MISMATCH"
    MERCHANT_ORDER_NO = "REFUND_MERCHANT_ORDER_NO_MISMATCH"
    PROVIDER_TRANSACTION_NO = "REFUND_PROVIDER_TRANSACTION_NO_MISMATCH"
    AMOUNT = "REFUND_AMOUNT_MISMATCH"
    CURRENCY = "REFUND_CURRENCY_MISMATCH"


def authoritative_refund_facts_mismatch(
    *, facts: AuthoritativeRefundFacts, expected: ExpectedRefundFacts
) -> RefundFactsMismatchCode | None:
    checks = (
        (facts.provider != expected.provider, RefundFactsMismatchCode.PROVIDER),
        (facts.merchant_id != expected.merchant_id, RefundFactsMismatchCode.MERCHANT_ID),
        (
            facts.merchant_refund_no != expected.merchant_refund_no,
            RefundFactsMismatchCode.MERCHANT_REFUND_NO,
        ),
        (
            facts.merchant_order_no != expected.merchant_order_no,
            RefundFactsMismatchCode.MERCHANT_ORDER_NO,
        ),
        (
            facts.provider_transaction_no != expected.provider_transaction_no,
            RefundFactsMismatchCode.PROVIDER_TRANSACTION_NO,
        ),
        (facts.amount_cents != expected.amount_cents, RefundFactsMismatchCode.AMOUNT),
        (facts.currency != expected.currency, RefundFactsMismatchCode.CURRENCY),
    )
    return next((code for differs, code in checks if differs), None)


class RefundProvider(Protocol):
    def create_refund(self, request: CreateRefundRequest) -> CreateRefundResult: ...

    def query_refund(self, request: QueryRefundRequest) -> QueryRefundResult: ...
