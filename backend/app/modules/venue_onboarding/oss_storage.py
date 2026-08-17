from __future__ import annotations

import base64
import hashlib
import hmac
import json
from datetime import UTC, datetime, timedelta
from typing import Any, cast
from urllib.parse import urlsplit
from uuid import UUID

import oss2  # type: ignore[import-untyped]

from backend.app.config import Settings

from .storage import (
    UPLOAD_POLICY_TTL_SECONDS,
    PrivateObject,
    PrivateObjectStateError,
    PrivateStorageUnavailableError,
    PrivateUploadPolicy,
    _require_safe_private_object_request,
)


class OssOnboardingStorage:
    """Dedicated private-bucket adapter for applicant onboarding evidence."""

    def __init__(
        self,
        *,
        bucket: Any,
        endpoint: str,
        bucket_name: str,
        access_key_id: str,
        access_key_secret: str,
    ) -> None:
        self._bucket = bucket
        self._bucket_name = bucket_name
        self._access_key_id = access_key_id
        self._access_key_secret = access_key_secret
        parsed = urlsplit(endpoint)
        self._upload_url = f"{parsed.scheme}://{bucket_name}.{parsed.netloc}"

    @classmethod
    def from_settings(cls, settings: Settings) -> OssOnboardingStorage:
        required = (
            settings.oss_endpoint,
            settings.onboarding_oss_bucket,
            settings.oss_access_key_id,
            settings.oss_access_key_secret,
        )
        if any(value is None for value in required):
            raise ValueError("private onboarding OSS configuration is incomplete")
        assert settings.oss_access_key_secret is not None
        assert settings.oss_endpoint is not None
        assert settings.onboarding_oss_bucket is not None
        assert settings.oss_access_key_id is not None
        secret = settings.oss_access_key_secret.get_secret_value()
        auth = oss2.AuthV2(settings.oss_access_key_id, secret)
        bucket = oss2.Bucket(
            auth,
            str(settings.oss_endpoint),
            settings.onboarding_oss_bucket,
        )
        return cls(
            bucket=bucket,
            endpoint=str(settings.oss_endpoint),
            bucket_name=settings.onboarding_oss_bucket,
            access_key_id=settings.oss_access_key_id,
            access_key_secret=secret,
        )

    def create_upload_policy(
        self,
        user_id: UUID,
        evidence_id: UUID,
        maximum_bytes: int,
    ) -> PrivateUploadPolicy:
        prefix = f"venue-onboarding/{user_id}/{evidence_id}/"
        expires_at = datetime.now(UTC) + timedelta(
            seconds=UPLOAD_POLICY_TTL_SECONDS
        )
        policy_document = {
            "expiration": expires_at.isoformat().replace("+00:00", "Z"),
            "conditions": [
                ["starts-with", "$key", prefix],
                ["content-length-range", 1, maximum_bytes],
                {"x-oss-object-acl": "private"},
                {"x-oss-forbid-overwrite": "true"},
                {"success_action_status": "201"},
            ],
        }
        policy = base64.b64encode(
            json.dumps(policy_document, separators=(",", ":")).encode()
        ).decode()
        signature = base64.b64encode(
            hmac.new(
                self._access_key_secret.encode(),
                policy.encode(),
                hashlib.sha1,
            ).digest()
        ).decode()
        return PrivateUploadPolicy(
            object_prefix=prefix,
            url=self._upload_url,
            fields={
                "key": f"{prefix}${{filename}}",
                "OSSAccessKeyId": self._access_key_id,
                "policy": policy,
                "Signature": signature,
                "x-oss-object-acl": "private",
                "x-oss-forbid-overwrite": "true",
                "success_action_status": "201",
            },
            expires_at=expires_at,
        )

    def read_private_object(
        self,
        object_prefix: str,
        maximum_bytes: int,
    ) -> PrivateObject:
        try:
            listing = self._bucket.list_objects(prefix=object_prefix, max_keys=2)
        except Exception as error:
            raise PrivateStorageUnavailableError(
                "private evidence listing failed"
            ) from error
        objects = [item for item in listing.object_list if item.key != object_prefix]
        if len(objects) != 1 or bool(getattr(listing, "is_truncated", False)):
            raise PrivateObjectStateError(
                "private evidence prefix must contain exactly one object"
            )
        object_key = cast(str, objects[0].key)
        if not object_key.startswith(object_prefix):
            raise PrivateObjectStateError("private object crossed its evidence prefix")
        try:
            result = self._bucket.get_object(object_key)
        except Exception as error:
            raise PrivateStorageUnavailableError("private evidence read failed") from error
        try:
            chunks: list[bytes] = []
            total = 0
            while total <= maximum_bytes:
                chunk = result.read(maximum_bytes + 1 - total)
                if not chunk:
                    break
                chunks.append(chunk)
                total += len(chunk)
            return PrivateObject(object_key=object_key, data=b"".join(chunks))
        except Exception as error:
            raise PrivateStorageUnavailableError("private evidence read failed") from error
        finally:
            result.close()

    def open_private_object(
        self,
        object_key: str,
        expected_bytes: int,
    ) -> bytes:
        _require_safe_private_object_request(object_key, expected_bytes)
        try:
            result = self._bucket.get_object(object_key)
        except Exception as error:
            raise PrivateStorageUnavailableError(
                "private evidence download failed"
            ) from error
        try:
            if getattr(result, "content_length", None) != expected_bytes:
                raise PrivateObjectStateError(
                    "private evidence length no longer matches the verified record"
                )
            chunks: list[bytes] = []
            total = 0
            maximum_read = expected_bytes + 1
            while total < maximum_read:
                chunk = result.read(min(64 * 1024, maximum_read - total))
                if not chunk:
                    break
                chunks.append(cast(bytes, chunk))
                total += len(chunk)
            if total != expected_bytes:
                raise PrivateObjectStateError(
                    "private evidence length no longer matches the verified record"
                )
            return b"".join(chunks)
        except PrivateObjectStateError:
            raise
        except Exception as error:
            raise PrivateStorageUnavailableError(
                "private evidence download failed"
            ) from error
        finally:
            try:
                result.close()
            except Exception as error:
                raise PrivateStorageUnavailableError(
                    "private evidence download failed"
                ) from error
