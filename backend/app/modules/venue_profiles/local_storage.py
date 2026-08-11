from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from uuid import UUID

from .storage import (
    MAX_IMAGE_BYTES,
    REVIEW_URL_TTL_SECONDS,
    UPLOAD_URL_TTL_SECONDS,
    ImageContentType,
    InvalidMediaError,
    PublishedImage,
    StorageBoundaryError,
    UploadIntent,
    ValidatedImage,
    compressed_review_data,
    extension_for,
    require_byte_size,
    require_content_type,
    validate_image,
)


@dataclass(frozen=True)
class _StoredObject:
    data: bytes
    content_type: ImageContentType


class LocalMediaStorage:
    """Deterministic process-local storage for development and unit tests."""

    def __init__(self, public_base_url: str = "https://local.invalid/media") -> None:
        self._public_base_url = public_base_url.rstrip("/")
        self._objects: dict[str, _StoredObject] = {}

    def create_upload_intent(
        self, venue_id: UUID, image_id: UUID, content_type: str, byte_size: int
    ) -> UploadIntent:
        accepted = require_content_type(content_type)
        accepted_size = require_byte_size(byte_size)
        key = (
            f"private/venues/{venue_id}/images/{image_id}/original."
            f"{extension_for(accepted)}"
        )
        return UploadIntent(
            object_key=key,
            url=f"memory://upload/{venue_id}/{image_id}",
            expires_in_seconds=UPLOAD_URL_TTL_SECONDS,
            max_bytes=MAX_IMAGE_BYTES,
            required_headers={
                "Content-Type": accepted,
                "Content-Length": str(accepted_size),
                "x-oss-forbid-overwrite": "true",
                "x-oss-object-acl": "private",
            },
        )

    def accept_upload(
        self, object_key: str, data: bytes, headers: Mapping[str, str]
    ) -> None:
        content_type = require_content_type(headers.get("Content-Type", ""))
        if headers.get("Content-Length") != str(len(data)):
            raise InvalidMediaError("uploaded body does not match signed Content-Length")
        if headers.get("x-oss-forbid-overwrite") != "true":
            raise ValueError("immutable upload header is required")
        if headers.get("x-oss-object-acl") != "private":
            raise ValueError("private object ACL is required")
        if (
            "/images/" not in object_key
            or "/original." not in object_key
            or not object_key.startswith("private/venues/")
        ):
            raise StorageBoundaryError("upload key is outside private venue storage")
        if object_key in self._objects:
            raise FileExistsError("upload object already exists")
        self._objects[object_key] = _StoredObject(data, content_type)

    def read_bounded(
        self, venue_id: UUID, image_id: UUID, object_key: str
    ) -> ValidatedImage:
        self._require_original_key(venue_id, image_id, object_key)
        stored = self._objects[object_key]
        try:
            bounded = stored.data[: MAX_IMAGE_BYTES + 1]
            return validate_image(object_key, bounded, stored.content_type)
        except ValueError:
            self._objects.pop(object_key, None)
            raise

    def write_review_copy(
        self, venue_id: UUID, image_id: UUID, image: ValidatedImage
    ) -> ValidatedImage:
        self._require_original_key(venue_id, image_id, image.object_key)
        key = f"private/venues/{venue_id}/images/{image_id}/review.jpg"
        review_data = compressed_review_data(image.data)
        self._objects[key] = _StoredObject(review_data, "image/jpeg")
        return validate_image(key, review_data, "image/jpeg")

    def signed_review_url(self, venue_id: UUID, image_id: UUID, object_key: str) -> str:
        self._require_review_key(venue_id, image_id, object_key)
        return f"memory://review/{venue_id}/{image_id}?expires={REVIEW_URL_TTL_SECONDS}"

    def promote_and_verify(
        self, venue_id: UUID, image_id: UUID, image: ValidatedImage
    ) -> PublishedImage:
        self._require_original_key(venue_id, image_id, image.object_key)
        key = (
            f"published/venues/{venue_id}/images/{image_id}."
            f"{extension_for(image.content_type)}"
        )
        self._objects[key] = _StoredObject(image.data, image.content_type)
        stored = self._objects[key]
        verified = validate_image(key, stored.data, stored.content_type)
        return PublishedImage(
            object_key=key,
            url=f"{self._public_base_url}/{key}",
            content_type=verified.content_type,
            byte_size=verified.byte_size,
            sha256=verified.sha256,
        )

    def delete_objects(
        self, venue_id: UUID, image_id: UUID, object_keys: list[str]
    ) -> None:
        for key in object_keys:
            self._require_deletable_key(venue_id, image_id, key)
        for key in object_keys:
            self._objects.pop(key, None)

    def contains(self, object_key: str) -> bool:
        return object_key in self._objects

    @staticmethod
    def _require_original_key(venue_id: UUID, image_id: UUID, object_key: str) -> None:
        prefix = f"private/venues/{venue_id}/images/{image_id}/original."
        extension = object_key.removeprefix(prefix)
        if object_key == extension or extension not in {"jpg", "png", "webp"}:
            raise StorageBoundaryError("object key is outside the venue boundary")

    @staticmethod
    def _require_review_key(venue_id: UUID, image_id: UUID, object_key: str) -> None:
        expected = f"private/venues/{venue_id}/images/{image_id}/review.jpg"
        if object_key != expected:
            raise StorageBoundaryError("object key is outside the venue boundary")

    @staticmethod
    def _require_deletable_key(venue_id: UUID, image_id: UUID, object_key: str) -> None:
        private_base = f"private/venues/{venue_id}/images/{image_id}/"
        published_base = f"published/venues/{venue_id}/images/{image_id}."
        allowed = {
            f"{private_base}original.jpg",
            f"{private_base}original.png",
            f"{private_base}original.webp",
            f"{private_base}review.jpg",
            f"{published_base}jpg",
            f"{published_base}png",
            f"{published_base}webp",
        }
        if object_key not in allowed:
            raise StorageBoundaryError("object key is outside the venue boundary")
