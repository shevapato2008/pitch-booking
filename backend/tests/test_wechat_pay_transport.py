from __future__ import annotations

import base64
import json
from datetime import UTC, datetime

import httpx
import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from backend.app.modules.wechat_pay.crypto import WeChatPaySignatureError
from backend.app.modules.wechat_pay.transport import (
    WeChatPayTransport,
    WeChatPayUnavailable,
    canonical_request_message,
    canonical_response_message,
)

NOW = datetime(2026, 8, 18, 4, 0, tzinfo=UTC)


@pytest.fixture
def key_material() -> dict[str, object]:
    merchant_private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    wechat_private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return {
        "merchant_private": merchant_private,
        "merchant_private_pem": merchant_private.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ),
        "wechat_private": wechat_private,
        "wechat_public_pem": wechat_private.public_key().public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        ),
    }


def _sign(private: rsa.RSAPrivateKey, message: bytes) -> str:
    return base64.b64encode(
        private.sign(message, padding.PKCS1v15(), hashes.SHA256())
    ).decode()


def _transport(
    key_material: dict[str, object],
    handler,
    *,
    clock=lambda: NOW,
) -> WeChatPayTransport:
    return WeChatPayTransport(
        client=httpx.Client(transport=httpx.MockTransport(handler)),
        merchant_id="1900000109",
        merchant_certificate_serial="0123456789ABCDEF",
        merchant_private_key_pem=key_material["merchant_private_pem"],
        wechat_pay_public_key_id="PUB_KEY_ID_3000000001",
        wechat_pay_public_key_pem=key_material["wechat_public_pem"],
        api_v3_key="0123456789abcdef0123456789abcdef",
        clock=clock,
        nonce_factory=lambda: "fixed-nonce",
    )


def test_canonical_request_message_includes_path_query_and_terminal_newline() -> None:
    assert canonical_request_message(
        "GET",
        "/v3/pay/transactions/out-trade-no/order-1?mchid=1900000109",
        1_660_812_800,
        "fixed-nonce",
        b"",
    ) == (
        b"GET\n/v3/pay/transactions/out-trade-no/order-1?mchid=1900000109\n"
        b"1660812800\nfixed-nonce\n\n"
    )


def test_signed_request_has_exact_authorization_and_bounded_timeout(
    key_material: dict[str, object],
) -> None:
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["request"] = request
        raw = b'{"prepay_id":"wx-prepay-1"}'
        timestamp = str(int(NOW.timestamp()))
        nonce = "response-nonce"
        signature = _sign(
            key_material["wechat_private"],
            canonical_response_message(timestamp, nonce, raw),
        )
        return httpx.Response(
            200,
            content=raw,
            headers={
                "Wechatpay-Timestamp": timestamp,
                "Wechatpay-Nonce": nonce,
                "Wechatpay-Serial": "PUB_KEY_ID_3000000001",
                "Wechatpay-Signature": signature,
            },
        )

    transport = _transport(key_material, handler)
    body = b'{"amount":{"currency":"CNY","total":100}}'
    result = transport.request_json("POST", "/v3/pay/transactions/jsapi", body)

    assert result.status_code == 200
    request = captured["request"]
    assert isinstance(request, httpx.Request)
    timestamp = str(int(NOW.timestamp()))
    expected_message = canonical_request_message(
        "POST", "/v3/pay/transactions/jsapi", int(timestamp), "fixed-nonce", body
    )
    signature = request.headers["Authorization"].split('signature="', 1)[1].split(
        '"', 1
    )[0]
    key_material["merchant_private"].public_key().verify(
        base64.b64decode(signature),
        expected_message,
        padding.PKCS1v15(),
        hashes.SHA256(),
    )
    assert request.headers["Authorization"].startswith(
        'WECHATPAY2-SHA256-RSA2048 mchid="1900000109",'
        'nonce_str="fixed-nonce",signature="'
    )
    assert request.headers["Authorization"].endswith(
        f'",timestamp="{timestamp}",serial_no="0123456789ABCDEF"'
    )
    timeout = request.extensions["timeout"]
    assert max(timeout.values()) <= 30.0


@pytest.mark.parametrize("mutation", ["body", "serial", "timestamp"])
def test_response_verification_rejects_tampering_wrong_key_or_stale_timestamp(
    key_material: dict[str, object], mutation: str
) -> None:
    raw = b'{"trade_state":"SUCCESS"}'
    timestamp = str(int(NOW.timestamp()))
    nonce = "response-nonce"
    signature = _sign(
        key_material["wechat_private"],
        canonical_response_message(timestamp, nonce, raw),
    )

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            content=raw + (b" " if mutation == "body" else b""),
            headers={
                "Wechatpay-Timestamp": (
                    str(int(NOW.timestamp()) - 301)
                    if mutation == "timestamp"
                    else timestamp
                ),
                "Wechatpay-Nonce": nonce,
                "Wechatpay-Serial": (
                    "PUB_KEY_ID_9999999999"
                    if mutation == "serial"
                    else "PUB_KEY_ID_3000000001"
                ),
                "Wechatpay-Signature": signature,
            },
        )

    with pytest.raises(WeChatPaySignatureError):
        _transport(key_material, handler).request_json("GET", "/v3/order", b"")


def test_notification_is_verified_before_resource_decryption(
    key_material: dict[str, object],
) -> None:
    key = b"0123456789abcdef0123456789abcdef"
    nonce = b"0123456789ab"
    resource_nonce = b"abcdefghijkl"
    plaintext = b'{"trade_state":"SUCCESS"}'
    ciphertext = AESGCM(key).encrypt(resource_nonce, plaintext, b"transaction")
    raw = json.dumps(
        {
            "resource": {
                "algorithm": "AEAD_AES_256_GCM",
                "ciphertext": base64.b64encode(ciphertext).decode(),
                "nonce": resource_nonce.decode(),
                "associated_data": "transaction",
            }
        },
        separators=(",", ":"),
    ).encode()
    timestamp = str(int(NOW.timestamp()))
    headers = {
        "Wechatpay-Timestamp": timestamp,
        "Wechatpay-Nonce": nonce.decode(),
        "Wechatpay-Serial": "PUB_KEY_ID_3000000001",
        "Wechatpay-Signature": _sign(
            key_material["wechat_private"],
            canonical_response_message(timestamp, nonce.decode(), raw),
        ),
    }

    transport = _transport(key_material, lambda _: httpx.Response(500))
    assert transport.decrypt_notification(raw, headers) == {"trade_state": "SUCCESS"}

    headers["Wechatpay-Signature"] = _sign(
        key_material["wechat_private"], b"wrong\n"
    )
    with pytest.raises(WeChatPaySignatureError, match="signature verification failed"):
        transport.decrypt_notification(raw, headers)


def test_transport_failure_returns_typed_unavailable_without_raw_details(
    key_material: dict[str, object],
) -> None:
    marker = "private-upstream-marker"

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout(marker, request=request)

    result = _transport(key_material, handler).request_json("GET", "/v3/order", b"")

    assert result == WeChatPayUnavailable("WECHAT_PAY_UNAVAILABLE")
    assert marker not in repr(result)


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("merchant_certificate_serial", "secret-serial", "certificate serial"),
        ("wechat_pay_public_key_id", "secret-key-id", "public key ID"),
    ],
)
def test_signing_key_ids_fail_closed_without_exposing_values(
    key_material: dict[str, object], field: str, value: str, message: str
) -> None:
    arguments = {
        "client": httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(500))),
        "merchant_id": "1900000109",
        "merchant_certificate_serial": "0123456789ABCDEF",
        "merchant_private_key_pem": key_material["merchant_private_pem"],
        "wechat_pay_public_key_id": "PUB_KEY_ID_3000000001",
        "wechat_pay_public_key_pem": key_material["wechat_public_pem"],
        "api_v3_key": "0123456789abcdef0123456789abcdef",
        "nonce_factory": lambda: "nonce",
    }
    arguments[field] = value

    with pytest.raises(ValueError, match=message) as error:
        WeChatPayTransport(**arguments)

    assert value not in str(error.value)
