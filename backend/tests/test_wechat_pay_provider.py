from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta, timezone

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from backend.app.modules.payments.provider import (
    ClosePaymentRequest,
    ClosePaymentStatus,
    Created,
    CreatePrepayRequest,
    QueryPaymentRequest,
    QueryPaymentStatus,
    Rejected,
    Unknown,
)
from backend.app.modules.refunds.provider import (
    CreateRefundRequest,
    QueryRefundRequest,
    QueryRefundStatus,
    RefundAccepted,
    RefundRejected,
    RefundUnknown,
)
from backend.app.modules.wechat_pay.crypto import WeChatPaySignatureError
from backend.app.modules.wechat_pay.provider import WeChatPayProvider
from backend.app.modules.wechat_pay.transport import (
    WeChatPayResponse,
    WeChatPayUnavailable,
)

NOW = datetime(2026, 8, 18, 4, 0, tzinfo=UTC)


class FakeTransport:
    def __init__(self, *responses: object) -> None:
        self.responses = list(responses)
        self.calls: list[tuple[str, str, bytes]] = []

    def request_json(self, method: str, path: str, body: bytes = b"") -> object:
        self.calls.append((method, path, body))
        return self.responses.pop(0)


@pytest.fixture
def private_key_pem() -> bytes:
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return private.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )


def response(status: int, data: dict[str, object] | None = None) -> WeChatPayResponse:
    raw = json.dumps(data, separators=(",", ":")).encode() if data is not None else b""
    return WeChatPayResponse(status, data, raw)


def provider(
    transport: FakeTransport, private_key_pem: bytes, *, nonce: str = "launch-nonce"
) -> WeChatPayProvider:
    return WeChatPayProvider(
        transport=transport,
        app_id="wx6b988ca75ad753c",
        merchant_id="1900000109",
        merchant_private_key_pem=private_key_pem,
        payment_notification_url="https://api.example.test/api/v1/payments/wechat/notify",
        refund_notification_url="https://api.example.test/api/v1/refunds/wechat/notify",
        clock=lambda: NOW,
        nonce_factory=lambda: nonce,
    )


def test_create_jsapi_prepay_serializes_expiry_and_signs_launch_params(
    private_key_pem: bytes,
) -> None:
    transport = FakeTransport(response(200, {"prepay_id": "wx-prepay-1"}))
    adapter = provider(transport, private_key_pem)
    expiry = datetime(2026, 8, 18, 13, 45, tzinfo=timezone(timedelta(hours=8)))

    result = adapter.create_prepay(
        CreatePrepayRequest(
            merchant_order_no="PBP202608180001",
            description="七人制 A 场",
            amount_cents=36000,
            currency="CNY",
            payer_openid="openid-private",
            time_expire=expiry,
        )
    )

    assert isinstance(result, Created)
    assert result.provider_prepay_id == "wx-prepay-1"
    assert result.launch_params.timeStamp == str(int(NOW.timestamp()))
    assert result.launch_params.nonceStr == "launch-nonce"
    assert result.launch_params.package == "prepay_id=wx-prepay-1"
    assert result.launch_params.signType == "RSA"
    assert result.launch_params.paySign
    method, path, raw = transport.calls[0]
    assert (method, path) == ("POST", "/v3/pay/transactions/jsapi")
    assert json.loads(raw) == {
        "appid": "wx6b988ca75ad753c",
        "mchid": "1900000109",
        "description": "七人制 A 场",
        "out_trade_no": "PBP202608180001",
        "time_expire": "2026-08-18T13:45:00+08:00",
        "notify_url": "https://api.example.test/api/v1/payments/wechat/notify",
        "amount": {"total": 36000, "currency": "CNY"},
        "payer": {"openid": "openid-private"},
    }

    public = serialization.load_pem_private_key(private_key_pem, password=None).public_key()
    from backend.app.modules.wechat_pay.crypto import verify_rsa_sha256

    verify_rsa_sha256(
        public,
        (
            f"wx6b988ca75ad753c\n{int(NOW.timestamp())}\nlaunch-nonce\nprepay_id=wx-prepay-1\n"
        ).encode(),
        result.launch_params.paySign,
    )


@pytest.mark.parametrize(
    ("upstream", "expected_type"),
    [
        (WeChatPayUnavailable("WECHAT_PAY_UNAVAILABLE"), Unknown),
        (response(400, {"code": "PARAM_ERROR", "message": "private"}), Rejected),
        (response(200, {"prepay_id": 123}), Unknown),
    ],
)
def test_create_prepay_maps_failures_without_inventing_success(
    private_key_pem: bytes, upstream: object, expected_type: type[object]
) -> None:
    result = provider(FakeTransport(upstream), private_key_pem).create_prepay(
        CreatePrepayRequest(
            merchant_order_no="PBP1",
            description="场地",
            amount_cents=100,
            currency="CNY",
            payer_openid="openid",
            time_expire=NOW + timedelta(minutes=15),
        )
    )
    assert isinstance(result, expected_type)
    assert "private" not in repr(result)


@pytest.mark.parametrize(
    ("upstream", "expected_type"),
    [
        (response(500, {"code": "SYSTEM_ERROR"}), Unknown),
        (response(429, {"code": "FREQUENCY_LIMITED"}), Unknown),
        (response(404, {"code": "UNKNOWN_CODE"}), Unknown),
        (response(400, {"code": "SYSTEM_ERROR"}), Unknown),
        (response(400, {"code": "PARAM_ERROR"}), Rejected),
        (WeChatPaySignatureError("bad signed response"), Unknown),
    ],
)
def test_create_prepay_only_rejects_documented_terminal_business_codes(
    private_key_pem: bytes, upstream: object, expected_type: type[object]
) -> None:
    transport = FakeTransport(upstream)
    if isinstance(upstream, Exception):
        def fail(*_args: object, **_kwargs: object) -> object:
            raise upstream

        transport.request_json = fail  # type: ignore[method-assign]
    result = provider(transport, private_key_pem).create_prepay(
        CreatePrepayRequest(
            merchant_order_no="PBP1",
            description="场地",
            amount_cents=100,
            currency="CNY",
            payer_openid="openid",
            time_expire=NOW + timedelta(minutes=15),
        )
    )
    assert isinstance(result, expected_type)


def test_query_payment_maps_success_with_complete_authoritative_facts(
    private_key_pem: bytes,
) -> None:
    transport = FakeTransport(
        response(
            200,
            {
                "appid": "wx6b988ca75ad753c",
                "mchid": "1900000109",
                "out_trade_no": "PBP1",
                "transaction_id": "42000000001",
                "trade_state": "SUCCESS",
                "success_time": "2026-08-18T12:01:02+08:00",
                "amount": {"total": 36000, "currency": "CNY"},
            },
        )
    )

    result = provider(transport, private_key_pem).query_payment(QueryPaymentRequest("PBP1"))

    assert result.status is QueryPaymentStatus.SUCCESS
    assert result.facts is not None
    assert result.facts.provider_transaction_no == "42000000001"
    assert result.facts.amount_cents == 36000
    assert result.facts.paid_at == datetime.fromisoformat("2026-08-18T12:01:02+08:00")
    assert transport.calls == [
        (
            "GET",
            "/v3/pay/transactions/out-trade-no/PBP1?mchid=1900000109",
            b"",
        )
    ]


@pytest.mark.parametrize(
    ("upstream", "status"),
    [
        (response(200, {"trade_state": "NOTPAY"}), QueryPaymentStatus.NOT_PAID),
        (response(200, {"trade_state": "USERPAYING"}), QueryPaymentStatus.NOT_PAID),
        (response(200, {"trade_state": "CLOSED"}), QueryPaymentStatus.CLOSED),
        (response(404, {"code": "ORDER_NOT_EXIST"}), QueryPaymentStatus.NOT_FOUND),
        (response(200, {"trade_state": "UNRECOGNIZED"}), QueryPaymentStatus.UNKNOWN),
        (WeChatPayUnavailable("WECHAT_PAY_UNAVAILABLE"), QueryPaymentStatus.UNKNOWN),
    ],
)
def test_query_payment_maps_closed_state_set(
    private_key_pem: bytes, upstream: object, status: QueryPaymentStatus
) -> None:
    result = provider(FakeTransport(upstream), private_key_pem).query_payment(
        QueryPaymentRequest("PBP1")
    )
    assert result.status is status


@pytest.mark.parametrize(
    "upstream",
    [
        response(404, {"code": "SYSTEM_ERROR"}),
        response(500, {"code": "SYSTEM_ERROR"}),
        response(429, {"code": "FREQUENCY_LIMITED"}),
        WeChatPaySignatureError("bad signed response"),
    ],
)
def test_query_payment_only_maps_exact_not_exist_and_closes_signature_failures(
    private_key_pem: bytes, upstream: object
) -> None:
    transport = FakeTransport(upstream)
    if isinstance(upstream, Exception):
        def fail(*_args: object, **_kwargs: object) -> object:
            raise upstream

        transport.request_json = fail  # type: ignore[method-assign]
    result = provider(transport, private_key_pem).query_payment(QueryPaymentRequest("PBP1"))
    assert result.status is QueryPaymentStatus.UNKNOWN


def test_query_payment_rejects_mismatched_or_malformed_success(
    private_key_pem: bytes,
) -> None:
    payload = {
        "appid": "wrong-app",
        "mchid": "1900000109",
        "out_trade_no": "PBP1",
        "transaction_id": "42000000001",
        "trade_state": "SUCCESS",
        "success_time": "2026-08-18T12:01:02+08:00",
        "amount": {"total": 36000, "currency": "CNY"},
    }
    result = provider(FakeTransport(response(200, payload)), private_key_pem).query_payment(
        QueryPaymentRequest("PBP1")
    )
    assert result.status is QueryPaymentStatus.UNKNOWN
    assert result.facts is None


def test_close_payment_posts_merchant_id_and_does_not_invent_paid_state(
    private_key_pem: bytes,
) -> None:
    successful = FakeTransport(response(204))
    result = provider(successful, private_key_pem).close_payment(ClosePaymentRequest("PBP1"))
    assert result.status is ClosePaymentStatus.CLOSED
    assert successful.calls == [
        (
            "POST",
            "/v3/pay/transactions/out-trade-no/PBP1/close",
            b'{"mchid":"1900000109"}',
        )
    ]

    uncertain = provider(
        FakeTransport(response(400, {"code": "ORDERPAID"})), private_key_pem
    ).close_payment(ClosePaymentRequest("PBP1"))
    assert uncertain.status is ClosePaymentStatus.UNKNOWN
    assert uncertain.facts is None


def test_create_and_query_full_refund_map_authoritative_facts(
    private_key_pem: bytes,
) -> None:
    transport = FakeTransport(
        response(
            200,
            {
                "refund_id": "50300000001",
                "out_refund_no": "PBR1",
                "status": "PROCESSING",
            },
        ),
        response(
            200,
            {
                "refund_id": "50300000001",
                "out_refund_no": "PBR1",
                "out_trade_no": "PBP1",
                "transaction_id": "42000000001",
                "status": "SUCCESS",
                "success_time": "2026-08-18T12:05:00+08:00",
                "amount": {"refund": 36000, "total": 36000, "currency": "CNY"},
            },
        ),
    )
    adapter = provider(transport, private_key_pem)

    created = adapter.create_refund(
        CreateRefundRequest(
            merchant_refund_no="PBR1",
            merchant_order_no="PBP1",
            provider_transaction_no="42000000001",
            amount_cents=36000,
            currency="CNY",
        )
    )
    queried = adapter.query_refund(QueryRefundRequest("PBR1"))

    assert created == RefundAccepted("50300000001")
    assert queried.status is QueryRefundStatus.SUCCESS
    assert queried.facts is not None
    assert queried.facts.provider == "wechat"
    assert queried.facts.merchant_id == "1900000109"
    assert queried.facts.merchant_refund_no == "PBR1"
    assert queried.facts.merchant_order_no == "PBP1"
    assert queried.facts.provider_transaction_no == "42000000001"
    assert queried.facts.amount_cents == 36000
    assert transport.calls[0] == (
        "POST",
        "/v3/refund/domestic/refunds",
        b'{"transaction_id":"42000000001","out_refund_no":"PBR1",'
        b'"notify_url":"https://api.example.test/api/v1/refunds/wechat/notify",'
        b'"amount":{"refund":36000,"total":36000,"currency":"CNY"}}',
    )
    assert transport.calls[1] == (
        "GET",
        "/v3/refund/domestic/refunds/PBR1",
        b"",
    )


@pytest.mark.parametrize(
    ("upstream", "expected"),
    [
        (response(200, {"status": "PROCESSING"}), QueryRefundStatus.PROCESSING),
        (response(200, {"status": "CLOSED"}), QueryRefundStatus.FAILED),
        (response(200, {"status": "ABNORMAL"}), QueryRefundStatus.FAILED),
        (response(404, {"code": "RESOURCE_NOT_EXISTS"}), QueryRefundStatus.NOT_FOUND),
        (response(200, {"status": "OTHER"}), QueryRefundStatus.UNKNOWN),
        (WeChatPayUnavailable("WECHAT_PAY_UNAVAILABLE"), QueryRefundStatus.UNKNOWN),
    ],
)
def test_query_refund_maps_closed_status_set(
    private_key_pem: bytes, upstream: object, expected: QueryRefundStatus
) -> None:
    result = provider(FakeTransport(upstream), private_key_pem).query_refund(
        QueryRefundRequest("PBR1")
    )
    assert result.status is expected


@pytest.mark.parametrize(
    "upstream",
    [
        response(404, {"code": "SYSTEM_ERROR"}),
        response(500, {"code": "SYSTEM_ERROR"}),
        response(429, {"code": "FREQUENCY_LIMITED"}),
        WeChatPaySignatureError("bad signed response"),
    ],
)
def test_query_refund_only_maps_exact_not_exist_and_closes_signature_failures(
    private_key_pem: bytes, upstream: object
) -> None:
    transport = FakeTransport(upstream)
    if isinstance(upstream, Exception):
        def fail(*_args: object, **_kwargs: object) -> object:
            raise upstream

        transport.request_json = fail  # type: ignore[method-assign]
    result = provider(transport, private_key_pem).query_refund(QueryRefundRequest("PBR1"))
    assert result.status is QueryRefundStatus.UNKNOWN


@pytest.mark.parametrize(
    ("upstream", "expected_type"),
    [
        (WeChatPayUnavailable("WECHAT_PAY_UNAVAILABLE"), RefundUnknown),
        (response(400, {"code": "INVALID_REQUEST"}), RefundRejected),
        (response(200, {"refund_id": 123, "status": "PROCESSING"}), RefundUnknown),
    ],
)
def test_create_refund_maps_failures_without_inventing_acceptance(
    private_key_pem: bytes, upstream: object, expected_type: type[object]
) -> None:
    result = provider(FakeTransport(upstream), private_key_pem).create_refund(
        CreateRefundRequest(
            merchant_refund_no="PBR1",
            merchant_order_no="PBP1",
            provider_transaction_no="42000000001",
            amount_cents=36000,
            currency="CNY",
        )
    )
    assert isinstance(result, expected_type)


@pytest.mark.parametrize(
    ("upstream", "expected_type"),
    [
        (response(500, {"code": "SYSTEM_ERROR"}), RefundUnknown),
        (response(429, {"code": "FREQUENCY_LIMITED"}), RefundUnknown),
        (response(404, {"code": "UNKNOWN_CODE"}), RefundUnknown),
        (response(400, {"code": "SYSTEM_ERROR"}), RefundUnknown),
        (response(400, {"code": "INVALID_REQUEST"}), RefundRejected),
        (WeChatPaySignatureError("bad signed response"), RefundUnknown),
    ],
)
def test_create_refund_only_rejects_documented_terminal_business_codes(
    private_key_pem: bytes, upstream: object, expected_type: type[object]
) -> None:
    transport = FakeTransport(upstream)
    if isinstance(upstream, Exception):
        def fail(*_args: object, **_kwargs: object) -> object:
            raise upstream

        transport.request_json = fail  # type: ignore[method-assign]
    result = provider(transport, private_key_pem).create_refund(
        CreateRefundRequest(
            merchant_refund_no="PBR1",
            merchant_order_no="PBP1",
            provider_transaction_no="42000000001",
            amount_cents=36000,
            currency="CNY",
        )
    )
    assert isinstance(result, expected_type)
