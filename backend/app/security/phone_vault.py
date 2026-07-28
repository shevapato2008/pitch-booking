import base64
import binascii
import os
import re
from dataclasses import dataclass, field
from typing import cast
from uuid import UUID

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


class PhoneVaultError(Exception):
    """Base class for safe PhoneVault domain failures."""


class PhoneVaultConfigurationError(PhoneVaultError):
    """Raised when PhoneVault key material is unusable."""


class PhoneDecryptionError(PhoneVaultError):
    """Raised when a sealed phone cannot be authenticated or decoded."""


class PhoneVaultContextError(PhoneVaultError):
    """Raised when encryption context cannot form an unambiguous AAD."""


class SealedPhoneDataError(PhoneVaultError):
    """Raised when encrypted phone storage values are malformed."""


class PhoneMaskingError(PhoneVaultError):
    """Raised when a value is not a canonical phone number."""


class PhoneEncryptionInputError(PhoneVaultError):
    """Raised when plaintext input is not a canonical phone number."""


_AAD_TOKEN = re.compile(r"[A-Za-z][A-Za-z0-9_-]{0,63}", re.ASCII)
_MAINLAND_CHINA_PHONE = re.compile(r"1[3-9][0-9]{9}", re.ASCII)
_AES_GCM_NONCE_BYTES = 12
_AES_GCM_TAG_BYTES = 16


@dataclass(frozen=True)
class SealedPhone:
    ciphertext_with_tag: bytes = field(repr=False)
    nonce: bytes = field(repr=False)
    key_version: int

    def __post_init__(self) -> None:
        ciphertext_with_tag = self._copy_bytes(self.ciphertext_with_tag)
        nonce = self._copy_bytes(self.nonce)
        if len(ciphertext_with_tag) < _AES_GCM_TAG_BYTES:
            raise SealedPhoneDataError("sealed phone data is invalid")
        if len(nonce) != _AES_GCM_NONCE_BYTES:
            raise SealedPhoneDataError("sealed phone data is invalid")
        if type(self.key_version) is not int or self.key_version <= 0:
            raise SealedPhoneDataError("sealed phone data is invalid")
        object.__setattr__(self, "ciphertext_with_tag", ciphertext_with_tag)
        object.__setattr__(self, "nonce", nonce)

    @staticmethod
    def _copy_bytes(value: object) -> bytes:
        if type(value) not in {bytes, bytearray}:
            raise SealedPhoneDataError("sealed phone data is invalid")
        return memoryview(cast(bytes | bytearray, value)).tobytes()


class PhoneVault:
    def __init__(self, *, key_base64: str, key_version: int | None) -> None:
        if type(key_version) is not int or key_version <= 0:
            raise PhoneVaultConfigurationError("phone encryption key version must be positive")
        if type(key_base64) is not str:
            raise PhoneVaultConfigurationError("phone encryption key must be canonical Base64")

        try:
            key = base64.b64decode(key_base64, validate=True)
        except (binascii.Error, UnicodeEncodeError, ValueError) as error:
            raise PhoneVaultConfigurationError(
                "phone encryption key must be valid Base64"
            ) from error
        if len(key) != 32:
            raise PhoneVaultConfigurationError("phone encryption key must be exactly 32 bytes")
        if base64.b64encode(key).decode("ascii") != key_base64:
            raise PhoneVaultConfigurationError("phone encryption key must be canonical Base64")

        self._cipher = AESGCM(key)
        self._key_version = key_version

    def encrypt(
        self,
        phone: str,
        *,
        record_type: str,
        record_id: UUID,
        field: str,
    ) -> SealedPhone:
        phone = self._validate_phone(phone, PhoneEncryptionInputError)
        aad = self._aad(record_type=record_type, record_id=record_id, field=field)
        nonce = os.urandom(_AES_GCM_NONCE_BYTES)
        ciphertext_with_tag = self._cipher.encrypt(
            nonce,
            phone.encode("utf-8"),
            aad,
        )
        return SealedPhone(
            ciphertext_with_tag=ciphertext_with_tag,
            nonce=nonce,
            key_version=self._key_version,
        )

    def decrypt(
        self,
        sealed: SealedPhone,
        *,
        record_type: str,
        record_id: UUID,
        field: str,
    ) -> str:
        try:
            if type(sealed) is not SealedPhone:
                raise SealedPhoneDataError("sealed phone data is invalid")
            sealed = SealedPhone(
                ciphertext_with_tag=sealed.ciphertext_with_tag,
                nonce=sealed.nonce,
                key_version=sealed.key_version,
            )
        except SealedPhoneDataError:
            raise PhoneDecryptionError("sealed phone could not be decrypted") from None

        if sealed.key_version != self._key_version:
            raise PhoneDecryptionError("sealed phone could not be decrypted")

        try:
            plaintext = self._cipher.decrypt(
                sealed.nonce,
                sealed.ciphertext_with_tag,
                self._aad(record_type=record_type, record_id=record_id, field=field),
            )
            return plaintext.decode("utf-8")
        except (InvalidTag, TypeError, UnicodeDecodeError, ValueError):
            raise PhoneDecryptionError("sealed phone could not be decrypted") from None

    @staticmethod
    def mask(phone: str) -> str:
        phone = PhoneVault._validate_phone(phone, PhoneMaskingError)
        return f"{phone[:3]}****{phone[-4:]}"

    @staticmethod
    def _validate_phone(phone: object, error_type: type[PhoneVaultError]) -> str:
        if type(phone) is not str or _MAINLAND_CHINA_PHONE.fullmatch(phone) is None:
            raise error_type("phone number is invalid")
        return phone

    @staticmethod
    def _aad(*, record_type: str, record_id: UUID, field: str) -> bytes:
        if (
            type(record_type) is not str
            or _AAD_TOKEN.fullmatch(record_type) is None
            or type(field) is not str
            or _AAD_TOKEN.fullmatch(field) is None
            or type(record_id) is not UUID
        ):
            raise PhoneVaultContextError("phone encryption context is invalid")
        return f"{record_type}:{str(record_id)}:{field}".encode()
