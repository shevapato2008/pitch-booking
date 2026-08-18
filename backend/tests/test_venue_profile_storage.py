from __future__ import annotations

import hashlib
import io
from dataclasses import dataclass
from typing import Any
from uuid import UUID

import pytest
from PIL import Image
from pydantic import ValidationError

from backend.app.config import Settings
from backend.app.modules.venue_profiles.local_storage import LocalMediaStorage
from backend.app.modules.venue_profiles.oss_storage import OssMediaStorage
from backend.app.modules.venue_profiles.storage import (
    MAX_IMAGE_BYTES,
    InvalidMediaError,
    StorageBoundaryError,
    UploadIntent,
)

VENUE_ID = UUID("0558e728-af58-4572-8680-656516cb76ad")
OTHER_VENUE_ID = UUID("3bdde313-fbca-42dd-ae0c-9b3fd04e17e0")
IMAGE_ID = UUID("88536891-b882-4289-93f6-8b77fa4f5dcc")
OTHER_IMAGE_ID = UUID("d5664fb0-1d8a-4cf7-bad2-835d4644a8e8")


def image_bytes(image_format: str, *, size: tuple[int, int] = (32, 24)) -> bytes:
    output = io.BytesIO()
    Image.new("RGB", size, (32, 128, 224)).save(output, image_format)
    return output.getvalue()


def uploaded_local(
    storage: LocalMediaStorage,
    content_type: str,
    image_format: str,
    size: tuple[int, int] = (32, 24),
) -> tuple[UploadIntent, bytes]:
    payload = image_bytes(image_format, size=size)
    intent = storage.create_upload_intent(VENUE_ID, IMAGE_ID, content_type, len(payload))
    storage.accept_upload(intent.object_key, payload, intent.required_headers)
    return intent, payload


@pytest.mark.parametrize(
    ("content_type", "image_format", "extension"),
    [
        ("image/jpeg", "JPEG", "jpg"),
        ("image/png", "PNG", "png"),
        ("image/webp", "WEBP", "webp"),
    ],
)
def test_local_upload_intents_validate_real_jpeg_png_and_webp(
    content_type: str, image_format: str, extension: str
) -> None:
    storage = LocalMediaStorage()
    intent, payload = uploaded_local(storage, content_type, image_format)
    validated = storage.read_bounded(VENUE_ID, IMAGE_ID, intent.object_key)

    assert intent.object_key == (
        f"private/venues/{VENUE_ID}/images/{IMAGE_ID}/original.{extension}"
    )
    assert intent.expires_in_seconds <= 300
    assert intent.max_bytes == MAX_IMAGE_BYTES
    assert intent.required_headers == {
        "Content-Type": content_type,
        "Content-Length": str(len(payload)),
        "x-oss-forbid-overwrite": "true",
        "x-oss-object-acl": "private",
    }
    assert validated.content_type == content_type
    assert validated.sha256 == hashlib.sha256(validated.data).hexdigest()
    assert validated.byte_size == len(validated.data)


def test_local_keys_are_immutable_and_isolated_by_venue() -> None:
    storage = LocalMediaStorage()
    first, payload = uploaded_local(storage, "image/jpeg", "JPEG")
    second = storage.create_upload_intent(
        VENUE_ID, OTHER_IMAGE_ID, "image/jpeg", len(payload)
    )

    assert first.object_key != second.object_key
    with pytest.raises(StorageBoundaryError):
        storage.read_bounded(OTHER_VENUE_ID, IMAGE_ID, first.object_key)
    with pytest.raises(StorageBoundaryError):
        storage.delete_objects(OTHER_VENUE_ID, IMAGE_ID, [first.object_key])
    with pytest.raises(StorageBoundaryError):
        storage.read_bounded(VENUE_ID, OTHER_IMAGE_ID, first.object_key)


def test_local_upload_object_cannot_be_overwritten() -> None:
    storage = LocalMediaStorage()
    intent, _ = uploaded_local(storage, "image/jpeg", "JPEG")

    with pytest.raises(FileExistsError):
        storage.accept_upload(intent.object_key, image_bytes("JPEG"), intent.required_headers)


@pytest.mark.parametrize(
    ("claimed_type", "actual_format"),
    [("image/png", "JPEG"), ("image/jpeg", "PNG"), ("image/webp", "PNG")],
)
def test_local_rejects_spoofed_mime_and_deletes_invalid_upload(
    claimed_type: str, actual_format: str
) -> None:
    storage = LocalMediaStorage()
    intent, _ = uploaded_local(storage, claimed_type, actual_format)

    with pytest.raises(InvalidMediaError, match="signature"):
        storage.read_bounded(VENUE_ID, IMAGE_ID, intent.object_key)

    assert not storage.contains(intent.object_key)


def test_local_rejects_truncated_image_and_deletes_it() -> None:
    storage = LocalMediaStorage()
    payload = image_bytes("JPEG")[:20]
    intent = storage.create_upload_intent(VENUE_ID, IMAGE_ID, "image/jpeg", len(payload))
    storage.accept_upload(intent.object_key, payload, intent.required_headers)

    with pytest.raises(InvalidMediaError, match="decode"):
        storage.read_bounded(VENUE_ID, IMAGE_ID, intent.object_key)

    assert not storage.contains(intent.object_key)


def test_local_rejects_decompression_bomb_warning_and_deletes_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    storage = LocalMediaStorage()
    intent, _ = uploaded_local(storage, "image/png", "PNG", (20, 20))
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 300)

    with pytest.raises(InvalidMediaError, match="pixel limit"):
        storage.read_bounded(VENUE_ID, IMAGE_ID, intent.object_key)

    assert not storage.contains(intent.object_key)


def test_local_review_copy_is_private_compressed_and_signed_for_five_minutes() -> None:
    storage = LocalMediaStorage()
    intent, _ = uploaded_local(storage, "image/png", "PNG", (1200, 900))
    validated = storage.read_bounded(VENUE_ID, IMAGE_ID, intent.object_key)

    review = storage.write_review_copy(VENUE_ID, IMAGE_ID, validated)
    review_url = storage.signed_review_url(VENUE_ID, IMAGE_ID, review.object_key)

    assert review.object_key == f"private/venues/{VENUE_ID}/images/{IMAGE_ID}/review.jpg"
    assert review.content_type == "image/jpeg"
    assert review.byte_size < validated.byte_size
    assert "expires=300" in review_url


def test_local_promotion_is_stable_verified_and_cleanup_is_idempotent() -> None:
    storage = LocalMediaStorage(public_base_url="https://images.example.test/media")
    intent, _ = uploaded_local(storage, "image/webp", "WEBP")
    validated = storage.read_bounded(VENUE_ID, IMAGE_ID, intent.object_key)

    first = storage.promote_and_verify(VENUE_ID, IMAGE_ID, validated)
    second = storage.promote_and_verify(VENUE_ID, IMAGE_ID, validated)
    storage.delete_objects(VENUE_ID, IMAGE_ID, [intent.object_key])
    storage.delete_objects(VENUE_ID, IMAGE_ID, [intent.object_key])

    assert first == second
    assert first.object_key == f"published/venues/{VENUE_ID}/images/{IMAGE_ID}.webp"
    assert first.url == f"https://images.example.test/media/{first.object_key}"
    assert storage.contains(first.object_key)


@dataclass
class FakeObject:
    data: bytes
    content_type: str


class FakeReadResult:
    def __init__(self, stored: FakeObject, max_chunk_size: int | None) -> None:
        self._stored = stored
        self._offset = 0
        self._max_chunk_size = max_chunk_size
        self.content_type = stored.content_type
        self.read_sizes: list[int] = []
        self.closed = False

    def read(self, size: int) -> bytes:
        self.read_sizes.append(size)
        read_size = min(size, self._max_chunk_size or size)
        chunk = self._stored.data[self._offset : self._offset + read_size]
        self._offset += len(chunk)
        return chunk

    def close(self) -> None:
        self.closed = True


class FakeBucket:
    bucket_name = "venue-media-test"

    def __init__(self) -> None:
        self.objects: dict[str, FakeObject] = {}
        self.sign_calls: list[
            tuple[str, str, int, dict[str, str] | None, set[str] | None]
        ] = []
        self.read_results: list[FakeReadResult] = []
        self.put_calls: list[tuple[str, dict[str, str]]] = []
        self.copy_calls: list[tuple[str, str, str]] = []
        self.acl_calls: list[tuple[str, str]] = []
        self.head_calls: list[str] = []
        self.delete_calls: list[str] = []
        self.read_chunk_size: int | None = None

    def sign_url(
        self,
        method: str,
        key: str,
        expires: int,
        headers: dict[str, str] | None = None,
        additional_headers: set[str] | None = None,
    ) -> str:
        self.sign_calls.append((method, key, expires, headers, additional_headers))
        return f"https://signed.example.test/{key}?method={method}&expires={expires}"

    def get_object(self, key: str) -> FakeReadResult:
        result = FakeReadResult(self.objects[key], self.read_chunk_size)
        self.read_results.append(result)
        return result

    def put_object(self, key: str, data: bytes, headers: dict[str, str]) -> None:
        self.put_calls.append((key, headers))
        self.objects[key] = FakeObject(data, headers["Content-Type"])

    def copy_object(
        self, source_bucket: str, source_key: str, target_key: str, headers: Any = None
    ) -> None:
        del headers
        self.copy_calls.append((source_bucket, source_key, target_key))
        self.objects[target_key] = self.objects[source_key]

    def head_object(self, key: str) -> Any:
        self.head_calls.append(key)
        stored = self.objects[key]
        return type(
            "Head",
            (),
            {"content_length": len(stored.data), "content_type": stored.content_type},
        )()

    def put_object_acl(self, key: str, acl: str) -> None:
        self.acl_calls.append((key, acl))

    def delete_object(self, key: str) -> None:
        self.delete_calls.append(key)
        self.objects.pop(key, None)


def oss_storage(bucket: FakeBucket) -> OssMediaStorage:
    return OssMediaStorage(bucket=bucket, public_base_url="https://cdn.example.test/media")


def test_upload_intents_reject_zero_or_oversized_declared_length() -> None:
    for storage in (LocalMediaStorage(), oss_storage(FakeBucket())):
        for byte_size in (0, MAX_IMAGE_BYTES + 1):
            with pytest.raises(InvalidMediaError, match="byte size"):
                storage.create_upload_intent(VENUE_ID, IMAGE_ID, "image/jpeg", byte_size)


def test_local_upload_rejects_body_with_different_content_length() -> None:
    storage = LocalMediaStorage()
    payload = image_bytes("JPEG")
    intent = storage.create_upload_intent(VENUE_ID, IMAGE_ID, "image/jpeg", len(payload) + 1)

    with pytest.raises(InvalidMediaError, match="Content-Length"):
        storage.accept_upload(intent.object_key, payload, intent.required_headers)


def test_oss_put_intent_signs_required_content_type_without_credentials() -> None:
    bucket = FakeBucket()
    storage = oss_storage(bucket)

    intent = storage.create_upload_intent(VENUE_ID, IMAGE_ID, "image/jpeg", 1234)

    assert bucket.sign_calls == [
        (
            "PUT",
            intent.object_key,
            intent.expires_in_seconds,
            {
                "Content-Type": "image/jpeg",
                "Content-Length": "1234",
                "x-oss-forbid-overwrite": "true",
                "x-oss-object-acl": "private",
            },
            {"content-length"},
        )
    ]
    assert "credential" not in intent.url.casefold()
    assert intent.max_bytes == 10 * 1024 * 1024


def test_oss_read_is_bounded_and_computes_server_digest() -> None:
    bucket = FakeBucket()
    storage = oss_storage(bucket)
    payload = image_bytes("PNG")
    intent = storage.create_upload_intent(VENUE_ID, IMAGE_ID, "image/png", len(payload))
    bucket.objects[intent.object_key] = FakeObject(payload, "image/png")

    validated = storage.read_bounded(VENUE_ID, IMAGE_ID, intent.object_key)

    assert bucket.read_results[0].read_sizes[0] == MAX_IMAGE_BYTES + 1
    assert bucket.read_results[0].closed is True
    assert validated.sha256 == hashlib.sha256(payload).hexdigest()


def test_oss_bounded_read_handles_partial_stream_chunks_and_closes_result() -> None:
    bucket = FakeBucket()
    bucket.read_chunk_size = 17
    storage = oss_storage(bucket)
    payload = image_bytes("PNG")
    intent = storage.create_upload_intent(VENUE_ID, IMAGE_ID, "image/png", len(payload))
    bucket.objects[intent.object_key] = FakeObject(payload, "image/png")

    validated = storage.read_bounded(VENUE_ID, IMAGE_ID, intent.object_key)

    assert validated.data == payload
    assert len(bucket.read_results[0].read_sizes) > 1
    assert bucket.read_results[0].closed is True


def test_oss_oversized_stream_is_rejected_and_deleted() -> None:
    bucket = FakeBucket()
    storage = oss_storage(bucket)
    intent = storage.create_upload_intent(VENUE_ID, IMAGE_ID, "image/png", MAX_IMAGE_BYTES)
    bucket.objects[intent.object_key] = FakeObject(b"x" * (MAX_IMAGE_BYTES + 1), "image/png")

    with pytest.raises(InvalidMediaError, match="10 MiB"):
        storage.read_bounded(VENUE_ID, IMAGE_ID, intent.object_key)

    assert bucket.read_results[0].read_sizes == [MAX_IMAGE_BYTES + 1]
    assert bucket.read_results[0].closed is True
    assert bucket.delete_calls == [intent.object_key]


def test_oss_review_promotion_head_verification_and_cleanup() -> None:
    bucket = FakeBucket()
    storage = oss_storage(bucket)
    payload = image_bytes("JPEG")
    intent = storage.create_upload_intent(VENUE_ID, IMAGE_ID, "image/jpeg", len(payload))
    bucket.objects[intent.object_key] = FakeObject(payload, "image/jpeg")
    validated = storage.read_bounded(VENUE_ID, IMAGE_ID, intent.object_key)

    review = storage.write_review_copy(VENUE_ID, IMAGE_ID, validated)
    signed_url = storage.signed_review_url(VENUE_ID, IMAGE_ID, review.object_key)
    published = storage.promote_and_verify(VENUE_ID, IMAGE_ID, validated)
    storage.delete_objects(VENUE_ID, IMAGE_ID, [intent.object_key, review.object_key])
    storage.delete_objects(VENUE_ID, IMAGE_ID, [intent.object_key, review.object_key])

    assert bucket.put_calls[-1][1] == {
        "Content-Type": "image/jpeg",
        "x-oss-object-acl": "private",
    }
    assert bucket.sign_calls[-1] == ("GET", review.object_key, 300, None, None)
    assert "expires=300" in signed_url
    assert bucket.copy_calls == [(bucket.bucket_name, intent.object_key, published.object_key)]
    assert bucket.acl_calls == [(published.object_key, "public-read")]
    assert bucket.head_calls == [published.object_key]
    assert published.url == f"https://cdn.example.test/media/{published.object_key}"
    assert set(bucket.delete_calls) >= {intent.object_key, review.object_key}


def test_oss_refuses_cross_venue_keys_before_touching_bucket() -> None:
    bucket = FakeBucket()
    storage = oss_storage(bucket)
    key = f"private/venues/{OTHER_VENUE_ID}/images/{IMAGE_ID}/original.jpg"

    with pytest.raises(StorageBoundaryError):
        storage.read_bounded(VENUE_ID, IMAGE_ID, key)

    assert bucket.read_results == []


def test_oss_refuses_nested_or_traversal_like_private_keys() -> None:
    bucket = FakeBucket()
    storage = oss_storage(bucket)

    for key in (
        f"private/venues/{VENUE_ID}/images/{IMAGE_ID}/nested/original.jpg",
        f"private/venues/{VENUE_ID}/images/{IMAGE_ID}/../review.jpg",
    ):
        with pytest.raises(StorageBoundaryError):
            storage.read_bounded(VENUE_ID, IMAGE_ID, key)

    assert bucket.read_results == []


def deployed_settings(**overrides: object) -> dict[str, object]:
    values: dict[str, object] = {
        "app_env": "staging",
        "database_url": "postgresql+psycopg://pitch:password@postgres:5432/pitch",
        "public_api_base_url": "https://api.example.test",
        "public_image_hosts": ("cdn.example.test",),
        "wechat_provider": "real",
        "wechat_app_id": "wx-app-id",
        "wechat_app_secret": "wechat-secret",
        "phone_encryption_key_base64": (
            "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="
        ),
        "phone_encryption_key_version": 1,
        "oss_endpoint": "https://oss-cn-hangzhou.aliyuncs.com",
        "oss_bucket": "venue-media-staging",
        "oss_public_base_url": "https://cdn.example.test/media",
        "oss_access_key_id": "access-key-id",
        "oss_access_key_secret": "OSS_SECRET_SENTINEL",
        "dashscope_api_key": "staging-dashscope-key",
    }
    values.update(overrides)
    return values


@pytest.mark.parametrize(
    "missing_field",
    [
        "oss_endpoint",
        "oss_bucket",
        "oss_public_base_url",
        "oss_access_key_id",
        "oss_access_key_secret",
    ],
)
def test_deployed_settings_require_complete_oss_configuration(missing_field: str) -> None:
    with pytest.raises(ValidationError, match="OSS storage configuration is required"):
        Settings(**deployed_settings(**{missing_field: None}))


def test_oss_settings_require_https_public_url_and_redact_secret() -> None:
    secret = "OSS_SECRET_SENTINEL"

    with pytest.raises(ValidationError) as captured:
        Settings(
            **deployed_settings(
                oss_public_base_url="http://cdn.example.test/SECRET_URL_SENTINEL",
                oss_access_key_secret=secret,
            )
        )

    rendered = f"{captured.value!s}\n{captured.value!r}\n{captured.value.json()}"
    assert "OSS_PUBLIC_BASE_URL must use HTTPS" in rendered
    assert secret not in rendered
    assert "SECRET_URL_SENTINEL" not in rendered
