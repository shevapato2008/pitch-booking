from __future__ import annotations

import hashlib
import threading
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum

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


class MockCreateMode(StrEnum):
    CREATED = "CREATED"
    REJECTED = "REJECTED"
    UNKNOWN_BEFORE_ACCEPTANCE = "UNKNOWN_BEFORE_ACCEPTANCE"
    UNKNOWN_AFTER_ACCEPTANCE = "UNKNOWN_AFTER_ACCEPTANCE"


@dataclass(frozen=True, slots=True)
class MockProviderCall:
    method: str
    merchant_order_no: str


@dataclass(slots=True)
class _MockOrder:
    request_sha256: str
    amount_cents: int
    currency: str
    created: Created
    status: QueryPaymentStatus = QueryPaymentStatus.NOT_PAID
    facts: AuthoritativePaymentFacts | None = None


class MockPaymentProvider:
    name = "mock"

    def __init__(
        self,
        *,
        create_mode: MockCreateMode = MockCreateMode.CREATED,
        app_id: str = "mock-app-id",
        merchant_id: str = "mock-merchant-id",
    ) -> None:
        self._create_mode = create_mode
        self._app_id = app_id
        self._merchant_id = merchant_id
        self._lock = threading.RLock()
        self._orders: dict[str, _MockOrder] = {}
        self._calls: list[MockProviderCall] = []
        self._close_unknown: set[str] = set()
        self._pending_notifications: list[str] = []

    @property
    def calls(self) -> tuple[MockProviderCall, ...]:
        with self._lock:
            return tuple(self._calls)

    @property
    def provider_order_count(self) -> int:
        with self._lock:
            return len(self._orders)

    def create_prepay(self, request: CreatePrepayRequest) -> CreatePrepayResult:
        with self._lock:
            self._calls.append(MockProviderCall("create_prepay", request.merchant_order_no))
            existing = self._orders.get(request.merchant_order_no)
            if existing is not None:
                if existing.request_sha256 != _request_sha256(request):
                    return Rejected("MOCK_IDEMPOTENCY_MISMATCH")
                return existing.created
            if self._create_mode is MockCreateMode.REJECTED:
                return Rejected("MOCK_PREPAY_REJECTED")
            if self._create_mode is MockCreateMode.UNKNOWN_BEFORE_ACCEPTANCE:
                return Unknown("MOCK_ACCEPTANCE_UNKNOWN")

            prepay_id = f"mock-{request.merchant_order_no}"
            created = Created(
                provider_prepay_id=prepay_id,
                launch_params=PaymentLaunchParams(
                    timeStamp="1785146640",
                    nonceStr=f"nonce-{request.merchant_order_no}",
                    package=f"prepay_id={prepay_id}",
                    signType="RSA",
                    paySign=f"signature-{request.merchant_order_no}",
                ),
            )
            self._orders[request.merchant_order_no] = _MockOrder(
                _request_sha256(request), request.amount_cents, request.currency, created
            )
            if self._create_mode is MockCreateMode.UNKNOWN_AFTER_ACCEPTANCE:
                return Unknown("MOCK_RESPONSE_LOST")
            return created

    def query_payment(self, request: QueryPaymentRequest) -> QueryPaymentResult:
        with self._lock:
            self._calls.append(MockProviderCall("query_payment", request.merchant_order_no))
            order = self._orders.get(request.merchant_order_no)
            if order is None:
                return QueryPaymentResult(QueryPaymentStatus.NOT_FOUND)
            if order.status is QueryPaymentStatus.NOT_PAID:
                return QueryPaymentResult(
                    order.status,
                    provider_prepay_id=order.created.provider_prepay_id,
                    launch_params=order.created.launch_params,
                )
            if order.status is QueryPaymentStatus.SUCCESS:
                return QueryPaymentResult(order.status, facts=order.facts)
            if order.status is QueryPaymentStatus.UNKNOWN:
                return QueryPaymentResult(order.status, safe_error_code="MOCK_QUERY_UNKNOWN")
            return QueryPaymentResult(order.status)

    def close_payment(self, request: ClosePaymentRequest) -> ClosePaymentResult:
        with self._lock:
            self._calls.append(MockProviderCall("close_payment", request.merchant_order_no))
            order = self._orders.get(request.merchant_order_no)
            if request.merchant_order_no in self._close_unknown:
                return ClosePaymentResult(
                    ClosePaymentStatus.UNKNOWN, safe_error_code="MOCK_CLOSE_UNKNOWN"
                )
            if order is not None and order.status is QueryPaymentStatus.SUCCESS:
                return ClosePaymentResult(ClosePaymentStatus.SUCCESS, facts=order.facts)
            if order is not None:
                order.status = QueryPaymentStatus.CLOSED
            return ClosePaymentResult(ClosePaymentStatus.CLOSED)

    def mark_success(
        self,
        merchant_order_no: str,
        *,
        provider_transaction_no: str,
        paid_at: datetime,
        notification_copies: int = 1,
    ) -> None:
        with self._lock:
            order = self._orders[merchant_order_no]
            order.status = QueryPaymentStatus.SUCCESS
            order.facts = AuthoritativePaymentFacts(
                app_id=self._app_id,
                merchant_id=self._merchant_id,
                merchant_order_no=merchant_order_no,
                provider_transaction_no=provider_transaction_no,
                amount_cents=order.amount_cents,
                currency="CNY",
                paid_at=paid_at,
            )
            self._pending_notifications.extend([merchant_order_no] * notification_copies)

    def set_unknown(self, merchant_order_no: str) -> None:
        with self._lock:
            self._orders[merchant_order_no].status = QueryPaymentStatus.UNKNOWN

    def set_close_unknown(self, merchant_order_no: str, *, enabled: bool = True) -> None:
        with self._lock:
            if enabled:
                self._close_unknown.add(merchant_order_no)
            else:
                self._close_unknown.discard(merchant_order_no)

    def drain_notifications(self, *, limit: int | None = None) -> tuple[str, ...]:
        with self._lock:
            count = len(self._pending_notifications) if limit is None else limit
            drained = tuple(self._pending_notifications[:count])
            del self._pending_notifications[:count]
            return drained


def _request_sha256(request: CreatePrepayRequest) -> str:
    digest = hashlib.sha256()
    for value in (
        request.description,
        str(request.amount_cents),
        request.currency,
        request.payer_openid,
    ):
        digest.update(value.encode())
        digest.update(b"\0")
    return digest.hexdigest()
