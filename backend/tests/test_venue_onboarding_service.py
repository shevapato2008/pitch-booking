from __future__ import annotations

import base64
import hashlib
import io
import json
import uuid
from importlib import import_module

import pytest
from PIL import Image
from pydantic import ValidationError

from backend.app.config import Settings
from backend.app.models import VenueOnboardingEvidenceKind
from backend.app.modules.venue_onboarding.oss_storage import OssOnboardingStorage


def _service_module():
    try:
        return import_module("backend.app.modules.venue_onboarding.service")
    except ModuleNotFoundError:
        pytest.fail("venue onboarding service module is not implemented")


def _storage_module():
    try:
        return import_module("backend.app.modules.venue_onboarding.storage")
    except ModuleNotFoundError:
        pytest.fail("venue onboarding storage module is not implemented")


def _image_bytes(image_format: str) -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (24, 16), (20, 120, 220)).save(output, image_format)
    return output.getvalue()


def test_normalize_identity_uses_nfkc_collapsed_whitespace_and_casefold() -> None:
    service = _service_module()

    assert service.normalize_identity("  Ａlpha\u3000  FOOTBALL  ") == "alpha football"


@pytest.mark.parametrize(
    ("kind", "filename", "payload", "expected_type"),
    [
        (
            VenueOnboardingEvidenceKind.BUSINESS_LICENSE,
            "license.jpg",
            _image_bytes("JPEG"),
            "image/jpeg",
        ),
        (
            VenueOnboardingEvidenceKind.VENUE_EXTERIOR,
            "outside.png",
            _image_bytes("PNG"),
            "image/png",
        ),
        (
            VenueOnboardingEvidenceKind.MANAGEMENT_AUTHORIZATION,
            "authorization.pdf",
            b"%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n",
            "application/pdf",
        ),
    ],
)
def test_private_evidence_validation_uses_actual_bytes_and_digest(
    kind: VenueOnboardingEvidenceKind,
    filename: str,
    payload: bytes,
    expected_type: str,
) -> None:
    storage = _storage_module()

    result = storage.validate_evidence_object(kind, filename, payload)

    assert result.content_type == expected_type
    assert result.byte_size == len(payload)
    assert result.sha256 == hashlib.sha256(payload).hexdigest()


@pytest.mark.parametrize(
    ("kind", "filename", "payload"),
    [
        (
            VenueOnboardingEvidenceKind.VENUE_EXTERIOR,
            "outside.png",
            _image_bytes("JPEG"),
        ),
        (
            VenueOnboardingEvidenceKind.VENUE_INTERIOR,
            "inside.pdf",
            b"%PDF-1.7\n%%EOF",
        ),
        (
            VenueOnboardingEvidenceKind.BUSINESS_LICENSE,
            "license.pdf",
            b"%PDF-1.7\nmissing-ending",
        ),
        (
            VenueOnboardingEvidenceKind.BUSINESS_LICENSE,
            "license.jpg",
            b"not-an-image",
        ),
    ],
)
def test_private_evidence_rejects_extension_kind_and_byte_mismatch(
    kind: VenueOnboardingEvidenceKind,
    filename: str,
    payload: bytes,
) -> None:
    storage = _storage_module()

    with pytest.raises(storage.InvalidEvidenceError):
        storage.validate_evidence_object(kind, filename, payload)


def test_private_evidence_enforces_kind_hard_limit_before_decode() -> None:
    storage = _storage_module()
    limit = storage.evidence_constraints(
        VenueOnboardingEvidenceKind.BUSINESS_LICENSE
    ).maximum_bytes

    with pytest.raises(storage.InvalidEvidenceError):
        storage.validate_evidence_object(
            VenueOnboardingEvidenceKind.BUSINESS_LICENSE,
            "license.pdf",
            b"x" * (limit + 1),
        )


@pytest.mark.parametrize("count", [0, 2])
def test_private_storage_requires_exactly_one_object_under_evidence_prefix(
    count: int,
) -> None:
    storage = _storage_module()
    objects = [
        storage.PrivateObject(f"venue-onboarding/user/evidence/{index}.jpg", b"bytes")
        for index in range(count)
    ]

    with pytest.raises(storage.PrivateObjectStateError):
        storage.require_single_private_object(objects)


def test_oss_policy_is_short_lived_private_and_prefix_bounded() -> None:
    user_id = uuid.uuid4()
    evidence_id = uuid.uuid4()
    adapter = OssOnboardingStorage(
        bucket=object(),
        endpoint="https://oss-cn-hangzhou.aliyuncs.com",
        bucket_name="venue-onboarding-private",
        access_key_id="test-access-key",
        access_key_secret="test-secret",
    )

    policy = adapter.create_upload_policy(user_id, evidence_id, 10 * 1024 * 1024)
    document = json.loads(base64.b64decode(policy.fields["policy"]))
    prefix = f"venue-onboarding/{user_id}/{evidence_id}/"

    assert policy.url == "https://venue-onboarding-private.oss-cn-hangzhou.aliyuncs.com"
    assert policy.fields["key"] == f"{prefix}${{filename}}"
    assert policy.fields["x-oss-object-acl"] == "private"
    assert ["starts-with", "$key", prefix] in document["conditions"]
    assert ["content-length-range", 1, 10 * 1024 * 1024] in document["conditions"]
    assert {"x-oss-object-acl": "private"} in document["conditions"]


def test_onboarding_bucket_cannot_reuse_public_media_bucket() -> None:
    with pytest.raises(ValidationError, match="must be separate"):
        Settings(
            oss_bucket="venue-media-test",
            onboarding_oss_bucket="venue-media-test",
        )


def test_onboarding_bucket_uses_frozen_environment_variable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ONBOARDING_OSS_BUCKET", "venue-onboarding-private")

    settings = Settings(_env_file=None)

    assert settings.onboarding_oss_bucket == "venue-onboarding-private"
