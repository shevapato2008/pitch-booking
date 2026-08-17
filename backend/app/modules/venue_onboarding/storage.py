from __future__ import annotations

import hashlib
import io
import warnings
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Protocol
from uuid import UUID

from PIL import Image, UnidentifiedImageError

from backend.app.models import VenueOnboardingEvidenceKind

DOCUMENT_MAXIMUM_BYTES = 10 * 1024 * 1024
PHOTO_MAXIMUM_BYTES = 15 * 1024 * 1024
UPLOAD_POLICY_TTL_SECONDS = 300


class InvalidEvidenceError(ValueError):
    """The private object is not valid evidence for its reserved kind."""


class PrivateObjectStateError(ValueError):
    """An evidence prefix does not resolve to exactly one private object."""


class PrivateStorageUnavailableError(RuntimeError):
    """The configured private object store could not serve the operation."""


@dataclass(frozen=True)
class EvidenceConstraints:
    accepted_mime_types: tuple[str, ...]
    maximum_bytes: int


@dataclass(frozen=True)
class PrivateUploadPolicy:
    object_prefix: str
    url: str
    fields: dict[str, str]
    expires_at: datetime


@dataclass(frozen=True)
class PrivateObject:
    object_key: str
    data: bytes


@dataclass(frozen=True)
class ValidatedEvidence:
    object_key: str
    content_type: str
    byte_size: int
    sha256: str


class VenueOnboardingStore(Protocol):
    def create_upload_policy(
        self,
        user_id: UUID,
        evidence_id: UUID,
        maximum_bytes: int,
    ) -> PrivateUploadPolicy: ...

    def read_private_object(
        self,
        object_prefix: str,
        maximum_bytes: int,
    ) -> PrivateObject: ...


class MemoryOnboardingStorage:
    """Non-networked development adapter; tests may inject their own protocol fake."""

    def __init__(self) -> None:
        self._objects: dict[str, list[PrivateObject]] = {}

    def create_upload_policy(
        self,
        user_id: UUID,
        evidence_id: UUID,
        maximum_bytes: int,
    ) -> PrivateUploadPolicy:
        prefix = f"venue-onboarding/{user_id}/{evidence_id}/"
        return PrivateUploadPolicy(
            object_prefix=prefix,
            url="https://local.invalid/venue-onboarding",
            fields={
                "key": f"{prefix}${{filename}}",
                "policy": "development-only",
                "signature": "development-only",
                "x-oss-object-acl": "private",
                "x-oss-forbid-overwrite": "true",
                "success_action_status": "201",
            },
            expires_at=datetime.now(UTC)
            + timedelta(seconds=UPLOAD_POLICY_TTL_SECONDS),
        )

    def read_private_object(
        self,
        object_prefix: str,
        maximum_bytes: int,
    ) -> PrivateObject:
        item = require_single_private_object(self._objects.get(object_prefix, []))
        return PrivateObject(item.object_key, item.data[: maximum_bytes + 1])

    def accept_upload(self, object_prefix: str, filename: str, data: bytes) -> None:
        self._objects.setdefault(object_prefix, []).append(
            PrivateObject(f"{object_prefix}{filename}", bytes(data))
        )


class UnavailableOnboardingStorage:
    """Safe deployed fallback when no dedicated private bucket is configured."""

    def create_upload_policy(
        self,
        user_id: UUID,
        evidence_id: UUID,
        maximum_bytes: int,
    ) -> PrivateUploadPolicy:
        del user_id, evidence_id, maximum_bytes
        raise PrivateStorageUnavailableError(
            "dedicated private onboarding bucket is not configured"
        )

    def read_private_object(
        self,
        object_prefix: str,
        maximum_bytes: int,
    ) -> PrivateObject:
        del object_prefix, maximum_bytes
        raise PrivateStorageUnavailableError(
            "dedicated private onboarding bucket is not configured"
        )


def evidence_constraints(kind: VenueOnboardingEvidenceKind) -> EvidenceConstraints:
    if kind in {
        VenueOnboardingEvidenceKind.BUSINESS_LICENSE,
        VenueOnboardingEvidenceKind.MANAGEMENT_AUTHORIZATION,
    }:
        return EvidenceConstraints(
            ("image/jpeg", "image/png", "application/pdf"),
            DOCUMENT_MAXIMUM_BYTES,
        )
    return EvidenceConstraints(("image/jpeg", "image/png"), PHOTO_MAXIMUM_BYTES)


def require_single_private_object(objects: Sequence[PrivateObject]) -> PrivateObject:
    if len(objects) != 1:
        raise PrivateObjectStateError(
            "private evidence prefix must contain exactly one object"
        )
    return objects[0]


def validate_evidence_object(
    kind: VenueOnboardingEvidenceKind,
    object_key: str,
    data: bytes,
) -> ValidatedEvidence:
    constraints = evidence_constraints(kind)
    if not data or len(data) > constraints.maximum_bytes:
        raise InvalidEvidenceError("evidence violates its byte limit")

    suffix = object_key.rsplit("/", 1)[-1].casefold()
    if data.startswith(b"%PDF-"):
        content_type = "application/pdf"
        if not data.rstrip().endswith(b"%%EOF"):
            raise InvalidEvidenceError("PDF signature or ending is invalid")
    else:
        content_type = _validated_image_content_type(data)

    allowed_extensions = {
        "image/jpeg": (".jpg", ".jpeg"),
        "image/png": (".png",),
        "application/pdf": (".pdf",),
    }[content_type]
    if content_type not in constraints.accepted_mime_types or not suffix.endswith(
        allowed_extensions
    ):
        raise InvalidEvidenceError("evidence bytes, kind, and extension do not match")
    return ValidatedEvidence(
        object_key=object_key,
        content_type=content_type,
        byte_size=len(data),
        sha256=hashlib.sha256(data).hexdigest(),
    )


def _validated_image_content_type(data: bytes) -> str:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as opened:
                image_format = opened.format
                opened.verify()
            with Image.open(io.BytesIO(data)) as decoded:
                decoded.load()
    except (
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
        OSError,
        UnidentifiedImageError,
        ValueError,
    ) as error:
        raise InvalidEvidenceError("evidence image could not be decoded") from error
    content_type = {"JPEG": "image/jpeg", "PNG": "image/png"}.get(
        image_format or ""
    )
    if content_type is None:
        raise InvalidEvidenceError("evidence image type is not allowed")
    return content_type
