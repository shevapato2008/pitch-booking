from __future__ import annotations

import base64
import binascii
import json
from collections.abc import Mapping

from cryptography.exceptions import InvalidSignature, InvalidTag
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


class WeChatPayConfigurationError(ValueError):
    """A production credential is missing or malformed."""


class WeChatPaySignatureError(ValueError):
    """An authenticated WeChat Pay message failed closed."""


def load_rsa_private_key(value: bytes) -> rsa.RSAPrivateKey:
    try:
        loaded = serialization.load_pem_private_key(value, password=None)
    except (TypeError, ValueError):
        raise WeChatPayConfigurationError("invalid RSA private key PEM") from None
    if not isinstance(loaded, rsa.RSAPrivateKey) or loaded.key_size < 2048:
        raise WeChatPayConfigurationError("invalid RSA private key PEM")
    return loaded


def load_rsa_public_key(value: bytes) -> rsa.RSAPublicKey:
    try:
        loaded = serialization.load_pem_public_key(value)
    except (TypeError, ValueError):
        raise WeChatPayConfigurationError("invalid RSA public key PEM") from None
    if not isinstance(loaded, rsa.RSAPublicKey) or loaded.key_size < 2048:
        raise WeChatPayConfigurationError("invalid RSA public key PEM")
    return loaded


def load_api_v3_key(value: str) -> bytes:
    try:
        encoded = value.encode("ascii")
    except UnicodeEncodeError:
        raise WeChatPayConfigurationError("API v3 key must be exactly 32 bytes") from None
    if len(encoded) != 32:
        raise WeChatPayConfigurationError("API v3 key must be exactly 32 bytes")
    return encoded


def sign_rsa_sha256(private_key: rsa.RSAPrivateKey, message: bytes) -> str:
    signature = private_key.sign(message, padding.PKCS1v15(), hashes.SHA256())
    return base64.b64encode(signature).decode("ascii")


def verify_rsa_sha256(
    public_key: rsa.RSAPublicKey, message: bytes, signature: str
) -> None:
    try:
        decoded = base64.b64decode(signature, validate=True)
        public_key.verify(decoded, message, padding.PKCS1v15(), hashes.SHA256())
    except (binascii.Error, InvalidSignature, ValueError):
        raise WeChatPaySignatureError("signature verification failed") from None


def decrypt_notification_resource(
    api_v3_key: bytes, resource: Mapping[str, object]
) -> dict[str, object]:
    try:
        if resource["algorithm"] != "AEAD_AES_256_GCM":
            raise ValueError
        nonce = resource["nonce"]
        associated_data = resource["associated_data"]
        ciphertext = resource["ciphertext"]
        if not all(isinstance(value, str) for value in (nonce, associated_data, ciphertext)):
            raise ValueError
        plaintext = AESGCM(api_v3_key).decrypt(
            nonce.encode("utf-8"),
            base64.b64decode(ciphertext, validate=True),
            associated_data.encode("utf-8"),
        )
        decoded = json.loads(plaintext)
        if not isinstance(decoded, dict):
            raise ValueError
        return decoded
    except (KeyError, TypeError, ValueError, binascii.Error, InvalidTag, json.JSONDecodeError):
        raise WeChatPaySignatureError("resource decryption failed") from None
