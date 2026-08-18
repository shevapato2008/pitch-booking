from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.errors import AppError, app_error_handler
from backend.app.modules.wechat_pay.crypto import WeChatPaySignatureError
from backend.app.modules.wechat_pay.router import router
from backend.app.request_id import RequestIdMiddleware

HEADERS = {
    "Wechatpay-Timestamp": "1787112000",
    "Wechatpay-Nonce": "nonce",
    "Wechatpay-Signature": "signature",
    "Wechatpay-Serial": "PUB_KEY_ID_1",
    "Authorization": "Bearer must-not-be-required",
}


class RecordingService:
    def __init__(self, error: Exception | None = None) -> None:
        self.error = error
        self.calls: list[tuple[bytes, dict[str, str]]] = []

    def handle(self, *, raw_body: bytes, headers: dict[str, str]) -> object:
        self.calls.append((raw_body, headers))
        if self.error is not None:
            raise self.error
        return object()


def client(
    *, payment: RecordingService | None = None, refund: RecordingService | None = None
) -> TestClient:
    app = FastAPI()
    app.add_middleware(RequestIdMiddleware, app_revision="test")
    app.add_exception_handler(AppError, app_error_handler)
    app.state.wechat_payment_notification_service = payment
    app.state.wechat_refund_notification_service = refund
    app.include_router(router)
    return TestClient(app)


def test_payment_route_passes_exact_raw_body_and_headers_without_bearer_auth() -> None:
    service = RecordingService()
    raw = b'{"amount": 32000, "spacing": true}'

    response = client(payment=service).post(
        "/api/v1/payments/wechat/notify", content=raw, headers=HEADERS
    )

    assert response.status_code == 204
    assert response.content == b""
    assert service.calls == [
        (
            raw,
            {
                "Wechatpay-Timestamp": "1787112000",
                "Wechatpay-Nonce": "nonce",
                "Wechatpay-Signature": "signature",
                "Wechatpay-Serial": "PUB_KEY_ID_1",
            },
        )
    ]


def test_refund_route_accepts_a_valid_duplicate_after_durable_convergence() -> None:
    service = RecordingService()
    test_client = client(refund=service)

    first = test_client.post("/api/v1/refunds/wechat/notify", content=b"same", headers=HEADERS)
    duplicate = test_client.post("/api/v1/refunds/wechat/notify", content=b"same", headers=HEADERS)

    assert first.status_code == duplicate.status_code == 204
    assert len(service.calls) == 2


def test_missing_header_returns_closed_invalid_response_instead_of_422() -> None:
    response = client(payment=RecordingService()).post(
        "/api/v1/payments/wechat/notify",
        content=b"body",
        headers={key: value for key, value in HEADERS.items() if key != "Wechatpay-Nonce"},
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "WECHAT_NOTIFICATION_INVALID"


def test_invalid_signature_returns_400_and_durable_failure_returns_503() -> None:
    invalid = client(payment=RecordingService(WeChatPaySignatureError("do not expose"))).post(
        "/api/v1/payments/wechat/notify", content=b"body", headers=HEADERS
    )
    unavailable = client(payment=RecordingService(RuntimeError("database down"))).post(
        "/api/v1/payments/wechat/notify", content=b"body", headers=HEADERS
    )

    assert invalid.status_code == 400
    assert invalid.json()["error"]["code"] == "WECHAT_NOTIFICATION_INVALID"
    assert unavailable.status_code == 503
    assert unavailable.json()["error"]["code"] == "SERVICE_UNAVAILABLE"


def test_unconfigured_notification_service_returns_retryable_503() -> None:
    response = client().post("/api/v1/payments/wechat/notify", content=b"body", headers=HEADERS)
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "SERVICE_UNAVAILABLE"
