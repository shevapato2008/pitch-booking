from __future__ import annotations

import uuid
from collections.abc import Callable, Mapping
from datetime import datetime
from typing import Protocol

from backend.app.modules.payments.provider import (
    AuthoritativePaymentFacts,
    QueryPaymentResult,
    QueryPaymentStatus,
)
from backend.app.modules.refunds.provider import (
    AuthoritativeRefundFacts,
    QueryRefundResult,
    QueryRefundStatus,
)
from backend.app.modules.wechat_pay.crypto import WeChatPaySignatureError
from backend.app.modules.wechat_pay.transport import WeChatPayTransport


class PaymentConvergence(Protocol):
    def converge(
        self,
        *,
        payment_id: uuid.UUID,
        provider: str,
        result: QueryPaymentResult,
    ) -> object: ...


class RefundConvergence(Protocol):
    def converge(
        self,
        *,
        attempt_id: uuid.UUID,
        provider: str,
        result: QueryRefundResult,
    ) -> object: ...


class WeChatPayNotificationAdapter:
    """Verify/decrypt raw WeChat Pay notifications into sanitized provider results."""

    def __init__(
        self,
        *,
        transport: WeChatPayTransport,
        app_id: str,
        merchant_id: str,
    ) -> None:
        self._transport = transport
        self._app_id = app_id
        self._merchant_id = merchant_id

    def payment_result(self, *, raw_body: bytes, headers: Mapping[str, str]) -> QueryPaymentResult:
        data = self._transport.decrypt_notification(raw_body, headers)
        try:
            state = _required_string(data, "trade_state")
            if state != "SUCCESS":
                raise ValueError
            amount = _required_dict(data, "amount")
            app_id = _required_string(data, "appid")
            merchant_id = _required_string(data, "mchid")
            amount_cents = _required_nonnegative_int(amount, "total")
            currency = _required_string(amount, "currency")
            paid_at = _required_aware_datetime(data, "success_time")
            if app_id != self._app_id or merchant_id != self._merchant_id or currency != "CNY":
                raise ValueError
            facts = AuthoritativePaymentFacts(
                app_id=app_id,
                merchant_id=merchant_id,
                merchant_order_no=_required_string(data, "out_trade_no"),
                provider_transaction_no=_required_string(data, "transaction_id"),
                amount_cents=amount_cents,
                currency="CNY",
                paid_at=paid_at,
            )
        except (KeyError, TypeError, ValueError):
            raise WeChatPaySignatureError("authenticated payment notification is invalid") from None
        return QueryPaymentResult(QueryPaymentStatus.SUCCESS, facts=facts)

    def refund_result(
        self, *, raw_body: bytes, headers: Mapping[str, str]
    ) -> tuple[str, QueryRefundResult]:
        data = self._transport.decrypt_notification(raw_body, headers)
        try:
            merchant_id = _required_string(data, "mchid")
            merchant_refund_no = _required_string(data, "out_refund_no")
            if merchant_id != self._merchant_id:
                raise ValueError
            status = _required_string(data, "refund_status")
            if status == "PROCESSING":
                return merchant_refund_no, QueryRefundResult(QueryRefundStatus.PROCESSING)
            if status in {"CLOSED", "ABNORMAL"}:
                return merchant_refund_no, QueryRefundResult(
                    QueryRefundStatus.FAILED,
                    safe_error_code=f"WECHAT_PAY_REFUND_{status}",
                )
            if status != "SUCCESS":
                raise ValueError
            amount = _required_dict(data, "amount")
            amount_cents = _required_nonnegative_int(amount, "refund")
            total_cents = _required_nonnegative_int(amount, "total")
            currency = _required_string(amount, "currency")
            if amount_cents != total_cents or currency != "CNY":
                raise ValueError
            facts = AuthoritativeRefundFacts(
                provider="wechat",
                merchant_id=merchant_id,
                merchant_refund_no=merchant_refund_no,
                provider_refund_no=_required_string(data, "refund_id"),
                merchant_order_no=_required_string(data, "out_trade_no"),
                provider_transaction_no=_required_string(data, "transaction_id"),
                amount_cents=amount_cents,
                currency="CNY",
                refunded_at=_required_aware_datetime(data, "success_time"),
            )
            return merchant_refund_no, QueryRefundResult(QueryRefundStatus.SUCCESS, facts=facts)
        except (KeyError, TypeError, ValueError):
            raise WeChatPaySignatureError("authenticated refund notification is invalid") from None


class WeChatPayPaymentNotificationService:
    def __init__(
        self,
        *,
        adapter: WeChatPayNotificationAdapter,
        convergence: PaymentConvergence,
        locate_payment: Callable[[str, str], uuid.UUID | None],
        provider: str,
    ) -> None:
        self._adapter = adapter
        self._convergence = convergence
        self._locate_payment = locate_payment
        self._provider = provider

    def handle(self, *, raw_body: bytes, headers: Mapping[str, str]) -> object:
        result = self._adapter.payment_result(raw_body=raw_body, headers=headers)
        assert result.facts is not None
        payment_id = self._locate_payment(self._provider, result.facts.merchant_order_no)
        if payment_id is None:
            raise LookupError("payment not found")
        return self._convergence.converge(
            payment_id=payment_id,
            provider=self._provider,
            result=result,
        )


class WeChatPayRefundNotificationService:
    def __init__(
        self,
        *,
        adapter: WeChatPayNotificationAdapter,
        convergence: RefundConvergence,
        locate_attempt: Callable[[str, str], uuid.UUID | None],
        provider: str,
    ) -> None:
        self._adapter = adapter
        self._convergence = convergence
        self._locate_attempt = locate_attempt
        self._provider = provider

    def handle(self, *, raw_body: bytes, headers: Mapping[str, str]) -> object:
        merchant_refund_no, result = self._adapter.refund_result(raw_body=raw_body, headers=headers)
        attempt_id = self._locate_attempt(self._provider, merchant_refund_no)
        if attempt_id is None:
            raise LookupError("refund attempt not found")
        return self._convergence.converge(
            attempt_id=attempt_id,
            provider=self._provider,
            result=result,
        )


def _required_string(data: Mapping[str, object], key: str) -> str:
    value = data[key]
    if not isinstance(value, str) or not value:
        raise ValueError
    return value


def _required_dict(data: Mapping[str, object], key: str) -> dict[str, object]:
    value = data[key]
    if not isinstance(value, dict):
        raise ValueError
    return value


def _required_nonnegative_int(data: Mapping[str, object], key: str) -> int:
    value = data[key]
    if type(value) is not int or value < 0:
        raise ValueError
    return value


def _required_aware_datetime(data: Mapping[str, object], key: str) -> datetime:
    value = datetime.fromisoformat(_required_string(data, key))
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError
    return value
