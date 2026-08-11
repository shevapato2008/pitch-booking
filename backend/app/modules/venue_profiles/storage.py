from __future__ import annotations

import hashlib
import io
import warnings
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal, Protocol
from uuid import UUID

from PIL import Image, UnidentifiedImageError

ImageContentType = Literal["image/jpeg", "image/png", "image/webp"]
SUPPORTED_IMAGE_TYPES: tuple[ImageContentType, ...] = (
    "image/jpeg",
    "image/png",
    "image/webp",
)
MAX_IMAGE_BYTES = 10 * 1024 * 1024
UPLOAD_URL_TTL_SECONDS = 300
REVIEW_URL_TTL_SECONDS = 300

_FORMAT_TO_CONTENT_TYPE: dict[str, ImageContentType] = {
    "JPEG": "image/jpeg",
    "PNG": "image/png",
    "WEBP": "image/webp",
}
_CONTENT_TYPE_TO_EXTENSION: dict[ImageContentType, str] = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}


class InvalidMediaError(ValueError):
    """The uploaded object is not a supported, decodable image."""


class StorageBoundaryError(ValueError):
    """An object key crossed its venue or lifecycle boundary."""


class StorageVerificationError(RuntimeError):
    """A promoted object could not be verified."""


@dataclass(frozen=True)
class UploadIntent:
    object_key: str
    url: str
    expires_in_seconds: int
    max_bytes: int
    required_headers: Mapping[str, str]


@dataclass(frozen=True)
class ValidatedImage:
    object_key: str
    content_type: ImageContentType
    byte_size: int
    sha256: str
    data: bytes


@dataclass(frozen=True)
class PublishedImage:
    object_key: str
    url: str
    content_type: ImageContentType
    byte_size: int
    sha256: str


class VenueMediaStore(Protocol):
    def create_upload_intent(
        self, venue_id: UUID, image_id: UUID, content_type: str, byte_size: int
    ) -> UploadIntent: ...

    def read_bounded(
        self, venue_id: UUID, image_id: UUID, object_key: str
    ) -> ValidatedImage: ...

    def write_review_copy(
        self, venue_id: UUID, image_id: UUID, image: ValidatedImage
    ) -> ValidatedImage: ...

    def signed_review_url(
        self, venue_id: UUID, image_id: UUID, object_key: str
    ) -> str: ...

    def promote_and_verify(
        self, venue_id: UUID, image_id: UUID, image: ValidatedImage
    ) -> PublishedImage: ...

    def delete_objects(
        self, venue_id: UUID, image_id: UUID, object_keys: list[str]
    ) -> None: ...


def require_content_type(value: str) -> ImageContentType:
    if value not in SUPPORTED_IMAGE_TYPES:
        raise InvalidMediaError("content type must be JPEG, PNG, or WebP")
    return value


def require_byte_size(value: int) -> int:
    if type(value) is not int or not 1 <= value <= MAX_IMAGE_BYTES:
        raise InvalidMediaError("declared byte size must be between 1 byte and 10 MiB")
    return value


def extension_for(content_type: ImageContentType) -> str:
    return _CONTENT_TYPE_TO_EXTENSION[content_type]


def validate_image(
    object_key: str, data: bytes, claimed_content_type: str
) -> ValidatedImage:
    content_type = require_content_type(claimed_content_type)
    if len(data) > MAX_IMAGE_BYTES:
        raise InvalidMediaError("image exceeds the 10 MiB limit")
    if not data:
        raise InvalidMediaError("image could not be decoded")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as opened:
                actual_content_type = _FORMAT_TO_CONTENT_TYPE.get(opened.format or "")
                opened.verify()
            with Image.open(io.BytesIO(data)) as decoded:
                decoded.load()
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
        raise InvalidMediaError("image exceeds pixel limit") from error
    except (OSError, UnidentifiedImageError, ValueError) as error:
        raise InvalidMediaError("image could not be decoded") from error
    if actual_content_type != content_type:
        raise InvalidMediaError("image signature does not match Content-Type")
    return ValidatedImage(
        object_key=object_key,
        content_type=content_type,
        byte_size=len(data),
        sha256=hashlib.sha256(data).hexdigest(),
        data=data,
    )


def compressed_review_data(data: bytes) -> bytes:
    output = io.BytesIO()
    with Image.open(io.BytesIO(data)) as image:
        image.thumbnail((640, 640))
        image.convert("RGB").save(output, "JPEG", quality=72, optimize=True)
    return output.getvalue()
