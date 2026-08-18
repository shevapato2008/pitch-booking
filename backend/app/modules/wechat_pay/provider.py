from __future__ import annotations

import json
from collections.abc import Callable
from datetime import UTC, datetime
from urllib.parse import quote

import httpx

from backend.app.modules.payments.provider import (
    AuthoritativePaymentFacts,
    ClosePaymentRequest,
    ClosePaymentResult,
    ClosePaymentStatus,
    Created,
    CreatePrepayRequest,
    CreatePrepayResult,
    PaymentLaunchParams,
    QueryPaymentRequest,
    QueryPaymentResult,
    QueryPaymentStatus,
    Rejected,
    Unknown,
)
from backend.app.modules.refunds.provider import (
    AuthoritativeRefundFacts,
    CreateRefundRequest,
    CreateRefundResult,
    QueryRefundRequest,
    QueryRefundResult,
    QueryRefundStatus,
    RefundAccepted,
    RefundRejected,
    RefundUnknown,
)
from backend.app.modules.wechat_pay.crypto import load_rsa_private_key, sign_rsa_sha256
from backend.app.modules.wechat_pay.transport import (
    WeChatPayTransport,
    WeChatPayUnavailable,
)


class WeChatPayProvider:
    name = "wechat"

    def __init__(
        self,
        *,
        transport: WeChatPayTransport,
        app_id: str,
        merchant_id: str,
        merchant_private_key_pem: bytes,
        payment_notification_url: str,
        refund_notification_url: str,
        clock: Callable[[], datetime] | None = None,
        nonce_factory: Callable[[], str],
        owned_client: httpx.Client | None = None,
    ) -> None:
        self._transport = transport
        self._app_id = app_id
        self._merchant_id = merchant_id
        self._merchant_private_key = load_rsa_private_key(merchant_private_key_pem)
        self._payment_notification_url = payment_notification_url
        self._refund_notification_url = refund_notification_url
        self._clock = clock or (lambda: datetime.now(UTC))
        self._nonce_factory = nonce_factory
        self._owned_client = owned_client

    @property
    def app_id(self) -> str:
        return self._app_id

    @property
    def merchant_id(self) -> str:
        return self._merchant_id

    def close(self) -> None:
        if self._owned_client is not None:
            self._owned_client.close()
            self._owned_client = None

    def create_prepay(self, request: CreatePrepayRequest) -> CreatePrepayResult:
        body = self._encode(
            {
                "appid": self._app_id,
                "mchid": self._merchant_id,
                "description": request.description,
                "out_trade_no": request.merchant_order_no,
                "time_expire": request.time_expire.isoformat(timespec="seconds"),
                "notify_url": self._payment_notification_url,
                "amount": {
                    "total": request.amount_cents,
                    "currency": request.currency,
                },
                "payer": {"openid": request.payer_openid},
            }
        )
        response = self._transport.request_json("POST", "/v3/pay/transactions/jsapi", body)
        if isinstance(response, WeChatPayUnavailable):
            return Unknown("PAYMENT_PROVIDER_UNAVAILABLE")
        if not 200 <= response.status_code < 300:
            return Rejected("PAYMENT_PROVIDER_REJECTED")
        prepay_id = self._string(response.data, "prepay_id")
        if prepay_id is None:
            return Unknown("PAYMENT_PROVIDER_RESPONSE_INVALID")
        now = self._clock()
        timestamp = str(int(now.timestamp()))
        nonce = self._nonce_factory()
        package = f"prepay_id={prepay_id}"
        signature = sign_rsa_sha256(
            self._merchant_private_key,
            f"{self._app_id}\n{timestamp}\n{nonce}\n{package}\n".encode(),
        )
        return Created(
            provider_prepay_id=prepay_id,
            launch_params=PaymentLaunchParams(
                timeStamp=timestamp,
                nonceStr=nonce,
                package=package,
                signType="RSA",
                paySign=signature,
            ),
        )

    def query_payment(self, request: QueryPaymentRequest) -> QueryPaymentResult:
        merchant_order_no = quote(request.merchant_order_no, safe="")
        merchant_id = quote(self._merchant_id, safe="")
        response = self._transport.request_json(
            "GET",
            f"/v3/pay/transactions/out-trade-no/{merchant_order_no}?mchid={merchant_id}",
        )
        if isinstance(response, WeChatPayUnavailable):
            return QueryPaymentResult(
                QueryPaymentStatus.UNKNOWN,
                safe_error_code="PAYMENT_PROVIDER_UNAVAILABLE",
            )
        if response.status_code == 404:
            return QueryPaymentResult(QueryPaymentStatus.NOT_FOUND)
        if not 200 <= response.status_code < 300 or response.data is None:
            return QueryPaymentResult(
                QueryPaymentStatus.UNKNOWN,
                safe_error_code="PAYMENT_PROVIDER_QUERY_FAILED",
            )
        trade_state = response.data.get("trade_state")
        if trade_state in {"NOTPAY", "USERPAYING"}:
            return QueryPaymentResult(QueryPaymentStatus.NOT_PAID)
        if trade_state in {"CLOSED", "REVOKED", "PAYERROR"}:
            return QueryPaymentResult(
                QueryPaymentStatus.CLOSED,
                safe_error_code="WECHAT_PAY_CLOSED",
            )
        if trade_state != "SUCCESS":
            return QueryPaymentResult(
                QueryPaymentStatus.UNKNOWN,
                safe_error_code="PAYMENT_PROVIDER_STATUS_UNKNOWN",
            )
        facts = self._payment_facts(response.data, request.merchant_order_no)
        if facts is None:
            return QueryPaymentResult(
                QueryPaymentStatus.UNKNOWN,
                safe_error_code="PAYMENT_PROVIDER_RESPONSE_INVALID",
            )
        return QueryPaymentResult(QueryPaymentStatus.SUCCESS, facts=facts)

    def close_payment(self, request: ClosePaymentRequest) -> ClosePaymentResult:
        merchant_order_no = quote(request.merchant_order_no, safe="")
        response = self._transport.request_json(
            "POST",
            f"/v3/pay/transactions/out-trade-no/{merchant_order_no}/close",
            self._encode({"mchid": self._merchant_id}),
        )
        if isinstance(response, WeChatPayUnavailable):
            return ClosePaymentResult(
                ClosePaymentStatus.UNKNOWN,
                safe_error_code="PAYMENT_PROVIDER_UNAVAILABLE",
            )
        if response.status_code == 204:
            return ClosePaymentResult(ClosePaymentStatus.CLOSED)
        return ClosePaymentResult(
            ClosePaymentStatus.UNKNOWN,
            safe_error_code="PAYMENT_PROVIDER_CLOSE_FAILED",
        )

    def create_refund(self, request: CreateRefundRequest) -> CreateRefundResult:
        response = self._transport.request_json(
            "POST",
            "/v3/refund/domestic/refunds",
            self._encode(
                {
                    "transaction_id": request.provider_transaction_no,
                    "out_refund_no": request.merchant_refund_no,
                    "notify_url": self._refund_notification_url,
                    "amount": {
                        "refund": request.amount_cents,
                        "total": request.amount_cents,
                        "currency": request.currency,
                    },
                }
            ),
        )
        if isinstance(response, WeChatPayUnavailable):
            return RefundUnknown("REFUND_PROVIDER_UNAVAILABLE")
        if not 200 <= response.status_code < 300:
            return RefundRejected("REFUND_PROVIDER_REJECTED")
        provider_refund_no = self._string(response.data, "refund_id")
        provider_status = response.data.get("status") if response.data else None
        if provider_refund_no is None or provider_status not in {"PROCESSING", "SUCCESS"}:
            return RefundUnknown("REFUND_PROVIDER_RESPONSE_INVALID")
        return RefundAccepted(provider_refund_no)

    def query_refund(self, request: QueryRefundRequest) -> QueryRefundResult:
        merchant_refund_no = quote(request.merchant_refund_no, safe="")
        response = self._transport.request_json(
            "GET", f"/v3/refund/domestic/refunds/{merchant_refund_no}"
        )
        if isinstance(response, WeChatPayUnavailable):
            return QueryRefundResult(
                QueryRefundStatus.UNKNOWN,
                safe_error_code="REFUND_PROVIDER_UNAVAILABLE",
            )
        if response.status_code == 404:
            return QueryRefundResult(QueryRefundStatus.NOT_FOUND)
        if not 200 <= response.status_code < 300 or response.data is None:
            return QueryRefundResult(
                QueryRefundStatus.UNKNOWN,
                safe_error_code="REFUND_PROVIDER_QUERY_FAILED",
            )
        provider_status = response.data.get("status")
        if provider_status == "PROCESSING":
            return QueryRefundResult(QueryRefundStatus.PROCESSING)
        if provider_status in {"CLOSED", "ABNORMAL"}:
            return QueryRefundResult(
                QueryRefundStatus.FAILED,
                safe_error_code=f"WECHAT_PAY_REFUND_{provider_status}",
            )
        if provider_status != "SUCCESS":
            return QueryRefundResult(
                QueryRefundStatus.UNKNOWN,
                safe_error_code="REFUND_PROVIDER_STATUS_UNKNOWN",
            )
        facts = self._refund_facts(response.data, request.merchant_refund_no)
        if facts is None:
            return QueryRefundResult(
                QueryRefundStatus.UNKNOWN,
                safe_error_code="REFUND_PROVIDER_RESPONSE_INVALID",
            )
        return QueryRefundResult(QueryRefundStatus.SUCCESS, facts=facts)

    def _payment_facts(
        self, data: dict[str, object], expected_order_no: str
    ) -> AuthoritativePaymentFacts | None:
        try:
            amount = data["amount"]
            if not isinstance(amount, dict):
                return None
            app_id = self._required_string(data["appid"])
            merchant_id = self._required_string(data["mchid"])
            merchant_order_no = self._required_string(data["out_trade_no"])
            transaction_no = self._required_string(data["transaction_id"])
            amount_cents = amount["total"]
            currency = amount["currency"]
            paid_at = datetime.fromisoformat(self._required_string(data["success_time"]))
            if (
                app_id != self._app_id
                or merchant_id != self._merchant_id
                or merchant_order_no != expected_order_no
                or type(amount_cents) is not int
                or amount_cents < 0
                or currency != "CNY"
                or paid_at.tzinfo is None
                or paid_at.utcoffset() is None
            ):
                return None
            return AuthoritativePaymentFacts(
                app_id=app_id,
                merchant_id=merchant_id,
                merchant_order_no=merchant_order_no,
                provider_transaction_no=transaction_no,
                amount_cents=amount_cents,
                currency="CNY",
                paid_at=paid_at,
            )
        except (KeyError, TypeError, ValueError):
            return None

    def _refund_facts(
        self, data: dict[str, object], expected_refund_no: str
    ) -> AuthoritativeRefundFacts | None:
        try:
            amount = data["amount"]
            if not isinstance(amount, dict):
                return None
            refund_no = self._required_string(data["out_refund_no"])
            provider_refund_no = self._required_string(data["refund_id"])
            merchant_order_no = self._required_string(data["out_trade_no"])
            transaction_no = self._required_string(data["transaction_id"])
            amount_cents = amount["refund"]
            total_cents = amount["total"]
            currency = amount["currency"]
            refunded_at = datetime.fromisoformat(self._required_string(data["success_time"]))
            if (
                refund_no != expected_refund_no
                or type(amount_cents) is not int
                or type(total_cents) is not int
                or amount_cents != total_cents
                or amount_cents < 0
                or currency != "CNY"
                or refunded_at.tzinfo is None
                or refunded_at.utcoffset() is None
            ):
                return None
            return AuthoritativeRefundFacts(
                provider="wechat",
                merchant_id=self._merchant_id,
                merchant_refund_no=refund_no,
                provider_refund_no=provider_refund_no,
                merchant_order_no=merchant_order_no,
                provider_transaction_no=transaction_no,
                amount_cents=amount_cents,
                currency="CNY",
                refunded_at=refunded_at,
            )
        except (KeyError, TypeError, ValueError):
            return None

    @staticmethod
    def _encode(data: dict[str, object]) -> bytes:
        return json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode()

    @staticmethod
    def _string(data: dict[str, object] | None, key: str) -> str | None:
        if data is None:
            return None
        value = data.get(key)
        return value if isinstance(value, str) and value else None

    @staticmethod
    def _required_string(value: object) -> str:
        if not isinstance(value, str) or not value:
            raise ValueError
        return value
