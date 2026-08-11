from __future__ import annotations

from typing import Any, cast
from uuid import UUID

import oss2  # type: ignore[import-untyped]

from backend.app.config import Settings

from .storage import (
    MAX_IMAGE_BYTES,
    REVIEW_URL_TTL_SECONDS,
    UPLOAD_URL_TTL_SECONDS,
    PublishedImage,
    StorageBoundaryError,
    StorageVerificationError,
    UploadIntent,
    ValidatedImage,
    compressed_review_data,
    extension_for,
    require_byte_size,
    require_content_type,
    validate_image,
)


class OssMediaStorage:
    """Aliyun OSS adapter; its public methods expose domain values only."""

    def __init__(
        self,
        *,
        bucket: Any,
        public_base_url: str,
    ) -> None:
        self._bucket = bucket
        self._public_base_url = public_base_url.rstrip("/")

    @classmethod
    def from_settings(cls, settings: Settings) -> OssMediaStorage:
        required = (
            settings.oss_endpoint,
            settings.oss_bucket,
            settings.oss_public_base_url,
            settings.oss_access_key_id,
            settings.oss_access_key_secret,
        )
        if any(value is None for value in required):
            raise ValueError("OSS storage configuration is incomplete")
        assert settings.oss_access_key_secret is not None
        auth = oss2.AuthV2(
            cast(str, settings.oss_access_key_id),
            settings.oss_access_key_secret.get_secret_value(),
        )
        bucket = oss2.Bucket(auth, str(settings.oss_endpoint), cast(str, settings.oss_bucket))
        return cls(bucket=bucket, public_base_url=str(settings.oss_public_base_url))

    def create_upload_intent(
        self, venue_id: UUID, image_id: UUID, content_type: str, byte_size: int
    ) -> UploadIntent:
        accepted = require_content_type(content_type)
        accepted_size = require_byte_size(byte_size)
        key = (
            f"private/venues/{venue_id}/images/{image_id}/original."
            f"{extension_for(accepted)}"
        )
        headers = {
            "Content-Type": accepted,
            "Content-Length": str(accepted_size),
            "x-oss-forbid-overwrite": "true",
            "x-oss-object-acl": "private",
        }
        url = self._bucket.sign_url(
            "PUT",
            key,
            UPLOAD_URL_TTL_SECONDS,
            headers=headers,
            additional_headers={"content-length"},
        )
        return UploadIntent(
            object_key=key,
            url=url,
            expires_in_seconds=UPLOAD_URL_TTL_SECONDS,
            max_bytes=MAX_IMAGE_BYTES,
            required_headers=headers,
        )

    def read_bounded(
        self, venue_id: UUID, image_id: UUID, object_key: str
    ) -> ValidatedImage:
        self._require_original_key(venue_id, image_id, object_key)
        result = self._bucket.get_object(object_key)
        try:
            chunks: list[bytes] = []
            total = 0
            while total <= MAX_IMAGE_BYTES:
                chunk = result.read(MAX_IMAGE_BYTES + 1 - total)
                if not chunk:
                    break
                chunks.append(chunk)
                total += len(chunk)
            data = b"".join(chunks)
            content_type = getattr(result, "content_type", None)
            if content_type is None:
                content_type = result.headers.get("Content-Type", "")
            return validate_image(object_key, data, content_type)
        except ValueError:
            self._bucket.delete_object(object_key)
            raise
        finally:
            result.close()

    def write_review_copy(
        self, venue_id: UUID, image_id: UUID, image: ValidatedImage
    ) -> ValidatedImage:
        self._require_original_key(venue_id, image_id, image.object_key)
        key = f"private/venues/{venue_id}/images/{image_id}/review.jpg"
        data = compressed_review_data(image.data)
        headers = {"Content-Type": "image/jpeg", "x-oss-object-acl": "private"}
        self._bucket.put_object(key, data, headers=headers)
        return validate_image(key, data, "image/jpeg")

    def signed_review_url(self, venue_id: UUID, image_id: UUID, object_key: str) -> str:
        self._require_review_key(venue_id, image_id, object_key)
        return cast(
            str,
            self._bucket.sign_url("GET", object_key, REVIEW_URL_TTL_SECONDS),
        )

    def promote_and_verify(
        self, venue_id: UUID, image_id: UUID, image: ValidatedImage
    ) -> PublishedImage:
        self._require_original_key(venue_id, image_id, image.object_key)
        key = (
            f"published/venues/{venue_id}/images/{image_id}."
            f"{extension_for(image.content_type)}"
        )
        self._bucket.copy_object(self._bucket.bucket_name, image.object_key, key)
        head = self._bucket.head_object(key)
        if (
            head.content_length != image.byte_size
            or self._normalized_content_type(head.content_type) != image.content_type
        ):
            raise StorageVerificationError("promoted image HEAD verification failed")
        return PublishedImage(
            object_key=key,
            url=f"{self._public_base_url}/{key}",
            content_type=image.content_type,
            byte_size=image.byte_size,
            sha256=image.sha256,
        )

    def delete_objects(
        self, venue_id: UUID, image_id: UUID, object_keys: list[str]
    ) -> None:
        for key in object_keys:
            self._require_deletable_key(venue_id, image_id, key)
        for key in object_keys:
            self._bucket.delete_object(key)

    @staticmethod
    def _normalized_content_type(value: str) -> str:
        return value.partition(";")[0].strip().lower()

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
