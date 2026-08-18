from __future__ import annotations

import base64
import json

import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

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


@pytest.fixture
def rsa_pems() -> tuple[bytes, bytes]:
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = private.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    public_pem = private.public_key().public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    return private_pem, public_pem


def test_rsa_signatures_bind_the_exact_message(rsa_pems: tuple[bytes, bytes]) -> None:
    private_pem, public_pem = rsa_pems
    private = load_rsa_private_key(private_pem)
    public = load_rsa_public_key(public_pem)

    signature = sign_rsa_sha256(private, b"exact raw bytes\n")

    verify_rsa_sha256(public, b"exact raw bytes\n", signature)
    with pytest.raises(WeChatPaySignatureError, match="signature verification failed"):
        verify_rsa_sha256(public, b"altered raw bytes\n", signature)


@pytest.mark.parametrize(
    ("loader", "value"),
    [
        (load_rsa_private_key, b"private-secret-marker"),
        (load_rsa_public_key, b"public-secret-marker"),
    ],
)
def test_pem_parse_failures_are_closed_and_redacted(loader, value: bytes) -> None:
    with pytest.raises(WeChatPayConfigurationError) as error:
        loader(value)

    rendered = str(error.value)
    assert "invalid RSA" in rendered
    assert value.decode() not in rendered


def test_api_v3_key_requires_exactly_32_bytes_without_leaking_value() -> None:
    secret = "api-v3-secret-marker"
    with pytest.raises(WeChatPayConfigurationError) as error:
        load_api_v3_key(secret)

    assert "exactly 32 bytes" in str(error.value)
    assert secret not in str(error.value)


def test_notification_resource_uses_aes_256_gcm_and_rejects_tampering() -> None:
    key = b"0123456789abcdef0123456789abcdef"
    nonce = b"0123456789ab"
    associated_data = b"transaction"
    plaintext = json.dumps({"out_trade_no": "order-1"}).encode()
    ciphertext = AESGCM(key).encrypt(nonce, plaintext, associated_data)
    resource = {
        "algorithm": "AEAD_AES_256_GCM",
        "nonce": nonce.decode(),
        "associated_data": associated_data.decode(),
        "ciphertext": base64.b64encode(ciphertext).decode(),
    }

    assert decrypt_notification_resource(key, resource) == {
        "out_trade_no": "order-1"
    }

    resource["ciphertext"] = base64.b64encode(ciphertext[:-1] + b"x").decode()
    with pytest.raises(WeChatPaySignatureError, match="resource decryption failed"):
        decrypt_notification_resource(key, resource)


def test_signing_uses_sha256_rsa_pkcs1v15(rsa_pems: tuple[bytes, bytes]) -> None:
    private_pem, _ = rsa_pems
    private = load_rsa_private_key(private_pem)
    signature = base64.b64decode(sign_rsa_sha256(private, b"message\n"))

    private.public_key().verify(
        signature,
        b"message\n",
        padding.PKCS1v15(),
        hashes.SHA256(),
    )
