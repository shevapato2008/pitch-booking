from __future__ import annotations

import json
import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import httpx
from cryptography.hazmat.primitives.asymmetric import rsa

from backend.app.modules.wechat_pay.crypto import (
    WeChatPayConfigurationError,
    WeChatPaySignatureError,
    decrypt_notification_resource,
    load_api_v3_key,
    load_rsa_private_key,
    load_rsa_public_key,
    sign_rsa_sha256,
    verify_rsa_sha256,
)

_PUBLIC_KEY_ID = re.compile(r"PUB_KEY_ID_[0-9]+", re.ASCII)
_CERTIFICATE_SERIAL = re.compile(r"[0-9A-F]+", re.ASCII)
_MAX_CLOCK_SKEW_SECONDS = 300
_REQUEST_TIMEOUT_SECONDS = 30.0


def canonical_request_message(
    method: str,
    path_with_query: str,
    timestamp: int,
    nonce: str,
    body: bytes,
) -> bytes:
    prefix = f"{method.upper()}\n{path_with_query}\n{timestamp}\n{nonce}\n".encode()
    return prefix + body + b"\n"


def canonical_response_message(timestamp: str, nonce: str, raw_body: bytes) -> bytes:
    return f"{timestamp}\n{nonce}\n".encode() + raw_body + b"\n"


@dataclass(frozen=True, slots=True)
class WeChatPayResponse:
    status_code: int
    data: dict[str, object] | None
    raw_body: bytes = field(repr=False)


@dataclass(frozen=True, slots=True)
class WeChatPayUnavailable:
    safe_error_code: str


type WeChatPayTransportResult = WeChatPayResponse | WeChatPayUnavailable


class WeChatPayTransport:
    def __init__(
        self,
        *,
        client: httpx.Client,
        merchant_id: str,
        merchant_certificate_serial: str,
        merchant_private_key_pem: bytes,
        wechat_pay_public_key_id: str,
        wechat_pay_public_key_pem: bytes,
        api_v3_key: str,
        clock: Callable[[], datetime] | None = None,
        nonce_factory: Callable[[], str],
        base_url: str = "https://api.mch.weixin.qq.com",
    ) -> None:
        if not merchant_id.isascii() or not merchant_id.isdigit():
            raise WeChatPayConfigurationError("merchant ID is invalid")
        if _CERTIFICATE_SERIAL.fullmatch(merchant_certificate_serial) is None:
            raise WeChatPayConfigurationError("merchant certificate serial is invalid")
        if _PUBLIC_KEY_ID.fullmatch(wechat_pay_public_key_id) is None:
            raise WeChatPayConfigurationError("WeChat Pay public key ID is invalid")
        if base_url != "https://api.mch.weixin.qq.com":
            raise WeChatPayConfigurationError("WeChat Pay base URL is invalid")
        self._client = client
        self._merchant_id = merchant_id
        self._merchant_certificate_serial = merchant_certificate_serial
        self._merchant_private_key: rsa.RSAPrivateKey = load_rsa_private_key(
            merchant_private_key_pem
        )
        self._wechat_pay_public_key_id = wechat_pay_public_key_id
        self._wechat_pay_public_key: rsa.RSAPublicKey = load_rsa_public_key(
            wechat_pay_public_key_pem
        )
        self._api_v3_key = load_api_v3_key(api_v3_key)
        self._clock = clock or (lambda: datetime.now(UTC))
        self._nonce_factory = nonce_factory
        self._base_url = base_url

    @property
    def merchant_id(self) -> str:
        return self._merchant_id

    def request_json(
        self, method: str, path_with_query: str, body: bytes = b""
    ) -> WeChatPayTransportResult:
        now = self._clock()
        timestamp = int(now.timestamp())
        nonce = self._nonce_factory()
        message = canonical_request_message(
            method, path_with_query, timestamp, nonce, body
        )
        signature = sign_rsa_sha256(self._merchant_private_key, message)
        authorization = (
            "WECHATPAY2-SHA256-RSA2048 "
            f'mchid="{self._merchant_id}",nonce_str="{nonce}",'
            f'signature="{signature}",timestamp="{timestamp}",'
            f'serial_no="{self._merchant_certificate_serial}"'
        )
        headers = {
            "Accept": "application/json",
            "Authorization": authorization,
            "Content-Type": "application/json",
            "User-Agent": "pitch-booking/1.0",
        }
        try:
            response = self._client.request(
                method.upper(),
                self._base_url + path_with_query,
                content=body,
                headers=headers,
                timeout=httpx.Timeout(_REQUEST_TIMEOUT_SECONDS),
            )
        except httpx.HTTPError:
            return WeChatPayUnavailable("WECHAT_PAY_UNAVAILABLE")

        raw_body = response.content
        self._verify_signed_message(raw_body, response.headers)
        if not raw_body:
            data = None
        else:
            try:
                decoded: Any = json.loads(raw_body)
            except (UnicodeDecodeError, json.JSONDecodeError):
                raise WeChatPaySignatureError("authenticated response JSON is invalid") from None
            if not isinstance(decoded, dict):
                raise WeChatPaySignatureError("authenticated response JSON is invalid")
            data = decoded
        return WeChatPayResponse(response.status_code, data, raw_body)

    def decrypt_notification(
        self, raw_body: bytes, headers: Mapping[str, str]
    ) -> dict[str, object]:
        self._verify_signed_message(raw_body, headers)
        try:
            envelope = json.loads(raw_body)
            if not isinstance(envelope, dict) or not isinstance(
                envelope.get("resource"), dict
            ):
                raise ValueError
        except (UnicodeDecodeError, ValueError, json.JSONDecodeError):
            raise WeChatPaySignatureError("notification envelope is invalid") from None
        return decrypt_notification_resource(self._api_v3_key, envelope["resource"])

    def _verify_signed_message(
        self, raw_body: bytes, headers: Mapping[str, str]
    ) -> None:
        try:
            timestamp = headers["Wechatpay-Timestamp"]
            nonce = headers["Wechatpay-Nonce"]
            serial = headers["Wechatpay-Serial"]
            signature = headers["Wechatpay-Signature"]
            parsed_timestamp = int(timestamp)
        except (KeyError, TypeError, ValueError):
            raise WeChatPaySignatureError("required signature headers are invalid") from None
        if serial != self._wechat_pay_public_key_id:
            raise WeChatPaySignatureError("unknown WeChat Pay public key ID")
        now_timestamp = int(self._clock().timestamp())
        if abs(now_timestamp - parsed_timestamp) > _MAX_CLOCK_SKEW_SECONDS:
            raise WeChatPaySignatureError("signed message timestamp is stale")
        verify_rsa_sha256(
            self._wechat_pay_public_key,
            canonical_response_message(timestamp, nonce, raw_body),
            signature,
        )
