from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest

from backend.app.modules.payments.provider import QueryPaymentStatus
from backend.app.modules.refunds.provider import QueryRefundStatus
from backend.app.modules.wechat_pay.crypto import WeChatPaySignatureError
from backend.app.modules.wechat_pay.notifications import (
    WeChatPayNotificationAdapter,
    WeChatPayPaymentNotificationService,
    WeChatPayRefundNotificationService,
)

NOW = datetime(2026, 8, 19, 4, tzinfo=UTC)
HEADERS = {
    "Wechatpay-Timestamp": "1787112000",
    "Wechatpay-Nonce": "notification-nonce",
    "Wechatpay-Signature": "signature",
    "Wechatpay-Serial": "PUB_KEY_ID_1",
}


class RecordingTransport:
    def __init__(self, decrypted: dict[str, object] | Exception) -> None:
        self.decrypted = decrypted
        self.calls: list[tuple[bytes, dict[str, str]]] = []

    def decrypt_notification(self, raw_body: bytes, headers: dict[str, str]) -> dict[str, object]:
        self.calls.append((raw_body, headers))
        if isinstance(self.decrypted, Exception):
            raise self.decrypted
        return self.decrypted


def payment_payload() -> dict[str, object]:
    return {
        "appid": "wx-app",
        "mchid": "1900000109",
        "out_trade_no": "PBORDER1",
        "transaction_id": "4200000000001",
        "trade_state": "SUCCESS",
        "success_time": "2026-08-19T12:00:00+08:00",
        "amount": {"total": 32000, "currency": "CNY"},
    }


def refund_payload(*, status: str = "SUCCESS") -> dict[str, object]:
    payload: dict[str, object] = {
        "mchid": "1900000109",
        "out_refund_no": "PBR1",
        "refund_id": "5030000000001",
        "out_trade_no": "PBORDER1",
        "transaction_id": "4200000000001",
        "refund_status": status,
        "amount": {"refund": 32000, "total": 32000, "currency": "CNY"},
    }
    if status == "SUCCESS":
        payload["success_time"] = "2026-08-19T12:01:00+08:00"
    return payload


def test_payment_notification_is_verified_and_decrypted_before_parsing() -> None:
    transport = RecordingTransport(payment_payload())
    adapter = WeChatPayNotificationAdapter(
        transport=transport, app_id="wx-app", merchant_id="1900000109"
    )

    result = adapter.payment_result(raw_body=b"exact-raw-body", headers=HEADERS)

    assert transport.calls == [(b"exact-raw-body", HEADERS)]
    assert result.status is QueryPaymentStatus.SUCCESS
    assert result.facts is not None
    assert result.facts.merchant_order_no == "PBORDER1"


def test_invalid_signature_stops_before_any_lookup() -> None:
    adapter = WeChatPayNotificationAdapter(
        transport=RecordingTransport(WeChatPaySignatureError("invalid")),
        app_id="wx-app",
        merchant_id="1900000109",
    )
    lookups = 0

    def locate(_provider: str, _merchant: str) -> uuid.UUID | None:
        nonlocal lookups
        lookups += 1
        return None

    service = WeChatPayPaymentNotificationService(
        adapter=adapter,
        convergence=object(),
        locate_payment=locate,
        provider="wechat",
    )

    with pytest.raises(WeChatPaySignatureError):
        service.handle(raw_body=b"tampered", headers=HEADERS)
    assert lookups == 0


class RecordingPaymentConvergence:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def converge(self, **kwargs: object) -> object:
        self.calls.append(kwargs)
        return object()


def test_valid_duplicate_payment_deliveries_each_enter_idempotent_convergence() -> None:
    payment_id = uuid.uuid4()
    convergence = RecordingPaymentConvergence()
    service = WeChatPayPaymentNotificationService(
        adapter=WeChatPayNotificationAdapter(
            transport=RecordingTransport(payment_payload()),
            app_id="wx-app",
            merchant_id="1900000109",
        ),
        convergence=convergence,
        locate_payment=lambda provider, merchant: (
            payment_id if (provider, merchant) == ("wechat", "PBORDER1") else None
        ),
        provider="wechat",
    )

    service.handle(raw_body=b"one", headers=HEADERS)
    service.handle(raw_body=b"one", headers=HEADERS)

    assert len(convergence.calls) == 2
    assert all(call["payment_id"] == payment_id for call in convergence.calls)


class RecordingRefundConvergence:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def converge(self, **kwargs: object) -> object:
        self.calls.append(kwargs)
        return object()


@pytest.mark.parametrize(
    ("provider_status", "expected"),
    [
        ("SUCCESS", QueryRefundStatus.SUCCESS),
        ("PROCESSING", QueryRefundStatus.PROCESSING),
        ("CLOSED", QueryRefundStatus.FAILED),
        ("ABNORMAL", QueryRefundStatus.FAILED),
    ],
)
def test_refund_notification_maps_closed_provider_statuses(
    provider_status: str, expected: QueryRefundStatus
) -> None:
    attempt_id = uuid.uuid4()
    convergence = RecordingRefundConvergence()
    service = WeChatPayRefundNotificationService(
        adapter=WeChatPayNotificationAdapter(
            transport=RecordingTransport(refund_payload(status=provider_status)),
            app_id="wx-app",
            merchant_id="1900000109",
        ),
        convergence=convergence,
        locate_attempt=lambda provider, merchant: (
            attempt_id if (provider, merchant) == ("wechat", "PBR1") else None
        ),
        provider="wechat",
    )

    service.handle(raw_body=b"refund", headers=HEADERS)

    assert convergence.calls[0]["attempt_id"] == attempt_id
    assert convergence.calls[0]["result"].status is expected


def test_authenticated_unknown_merchant_number_is_retryable() -> None:
    service = WeChatPayPaymentNotificationService(
        adapter=WeChatPayNotificationAdapter(
            transport=RecordingTransport(payment_payload()),
            app_id="wx-app",
            merchant_id="1900000109",
        ),
        convergence=RecordingPaymentConvergence(),
        locate_payment=lambda _provider, _merchant: None,
        provider="wechat",
    )

    with pytest.raises(LookupError, match="payment not found"):
        service.handle(raw_body=b"valid", headers=HEADERS)
