from __future__ import annotations

from collections.abc import Mapping
from typing import Protocol, cast

from fastapi import APIRouter, Request, Response

from backend.app.errors import AppError
from backend.app.modules.wechat_pay.crypto import WeChatPaySignatureError

router = APIRouter(tags=["wechat-pay-notifications"])

_SIGNATURE_HEADERS = (
    "Wechatpay-Timestamp",
    "Wechatpay-Nonce",
    "Wechatpay-Signature",
    "Wechatpay-Serial",
)


class NotificationService(Protocol):
    def handle(self, *, raw_body: bytes, headers: Mapping[str, str]) -> object: ...


@router.post("/api/v1/payments/wechat/notify", status_code=204)
async def receive_payment_notification(request: Request) -> Response:
    return await _receive(request, "wechat_payment_notification_service")


@router.post("/api/v1/refunds/wechat/notify", status_code=204)
async def receive_refund_notification(request: Request) -> Response:
    return await _receive(request, "wechat_refund_notification_service")


async def _receive(request: Request, state_name: str) -> Response:
    headers = _signature_headers(request)
    service = cast(NotificationService | None, getattr(request.app.state, state_name, None))
    if service is None:
        raise _unavailable()
    raw_body = await request.body()
    try:
        service.handle(raw_body=raw_body, headers=headers)
    except WeChatPaySignatureError:
        raise _invalid() from None
    except Exception:
        raise _unavailable() from None
    return Response(status_code=204)


def _signature_headers(request: Request) -> dict[str, str]:
    headers: dict[str, str] = {}
    for name in _SIGNATURE_HEADERS:
        value = request.headers.get(name)
        if value is None or not value.strip():
            raise _invalid()
        headers[name] = value
    return headers


def _invalid() -> AppError:
    return AppError(400, "WECHAT_NOTIFICATION_INVALID", "微信支付通知无效。")


def _unavailable() -> AppError:
    return AppError(503, "SERVICE_UNAVAILABLE", "服务暂时不可用。")
