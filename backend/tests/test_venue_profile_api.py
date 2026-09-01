from __future__ import annotations

import hashlib
import io
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from backend.app.database import get_database
from backend.app.main import create_app
from backend.app.models import (
    ImageRole,
    User,
    UserSession,
    Venue,
    VenueImage,
    VenueMembership,
    VenueProfileRevision,
)
from backend.app.modules.venue_profiles.local_storage import LocalMediaStorage

pytestmark = pytest.mark.integration
TOKEN = "venue-profile-token-00000000001"


def _client(engine: Engine, storage: LocalMediaStorage) -> TestClient:
    app = create_app(venue_media_store=storage)

    def database_override() -> Iterator[Session]:
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_database] = database_override
    return TestClient(app, raise_server_exceptions=False)


def _seed(engine: Engine) -> Venue:
    with Session(engine) as session:
        venue = Venue(
            slug=f"profile-api-{uuid.uuid4().hex}",
            name="API 足球场",
            description="公开",
            price_advantage_text="价格透明",
            timezone="Asia/Shanghai",
            business_hours_text="09:00-23:00",
            address="测试路",
            district_code="120101",
            district_name="和平区",
            parking_text="可停车",
            phone="13800000000",
            refund_policy_text="按规则退款",
            latitude=39.1,
            longitude=117.2,
            navigation_poi_name="API 足球场",
            navigation_latitude=39.1,
            navigation_longitude=117.2,
            public_pitch_types=["FIVE_A_SIDE"],
            is_active=True,
        )
        user = User(wechat_app_id="wx", wechat_openid=f"api-{uuid.uuid4()}")
        session.add_all([venue, user])
        session.flush()
        session.add_all(
            [
                VenueMembership(
                    venue_id=venue.id, user_id=user.id, is_active=True, can_manage_profile=True
                ),
                UserSession(
                    user_id=user.id,
                    token_hash=hashlib.sha256(TOKEN.encode()).hexdigest(),
                    issued_at=datetime.now(UTC) - timedelta(minutes=1),
                    expires_at=datetime.now(UTC) + timedelta(hours=1),
                ),
            ]
        )
        session.commit()
        session.refresh(venue)
        session.expunge(venue)
        return venue


def _headers(key: str | None = None) -> dict[str, str]:
    value = {"Authorization": f"Bearer {TOKEN}"}
    if key:
        value["Idempotency-Key"] = key
    return value


def _jpeg() -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (8, 8), "green").save(output, "JPEG")
    return output.getvalue()


def _add_published_images(engine: Engine, venue_id: uuid.UUID, count: int) -> None:
    with Session(engine) as session:
        session.add_all(
            VenueImage(
                venue_id=venue_id,
                url=f"https://assets.example/{index}.webp",
                alt=str(index),
                role=ImageRole.COVER if index == 0 else ImageRole.GALLERY,
                sort_order=index,
            )
            for index in range(count)
        )
        session.commit()


def test_runtime_openapi_exposes_eight_admin_operations() -> None:
    paths = create_app().openapi()["paths"]
    expected = {
        ("get", "/api/v1/admin/venues/{venue_id}/profile"),
        ("put", "/api/v1/admin/venues/{venue_id}/profile"),
        ("post", "/api/v1/admin/venues/{venue_id}/profile/images/upload-intents"),
        ("post", "/api/v1/admin/venues/{venue_id}/profile/images/{image_id}/complete"),
        ("delete", "/api/v1/admin/venues/{venue_id}/profile/images/{image_id}"),
        ("put", "/api/v1/admin/venues/{venue_id}/profile/images/order"),
        ("put", "/api/v1/admin/venues/{venue_id}/profile/images/{image_id}/cover"),
        ("post", "/api/v1/admin/venues/{venue_id}/profile/moderation/{item_id}/retry"),
    }
    assert all(method in paths[path] for method, path in expected)


def test_profile_http_journey_covers_save_upload_complete_order_cover_delete_retry(
    pg_engine: Engine,
) -> None:
    venue = _seed(pg_engine)
    _add_published_images(pg_engine, venue.id, 1)
    storage = LocalMediaStorage("https://local.invalid/media")
    client = _client(pg_engine, storage)
    unauthorized = client.get(f"/api/v1/admin/venues/{venue.id}/profile")
    assert unauthorized.status_code == 401
    assert unauthorized.json()["error"]["code"] == "AUTH_REQUIRED"

    initial = client.get(f"/api/v1/admin/venues/{venue.id}/profile", headers=_headers())
    assert initial.status_code == 200
    profile = initial.json()
    inherited_image_id = profile["current_revision"]["images"][0]["id"]
    saved = client.put(
        f"/api/v1/admin/venues/{venue.id}/profile",
        headers=_headers("save-api-000000001"),
        json={
            "expected_facility_version": profile["facility_version"],
            "expected_revision_version": profile["revision_version"],
            "description": "新的介绍",
            "facilities": ["PARKING", "SHOWER"],
        },
    )
    assert saved.status_code == 200
    profile = saved.json()
    revision_id = profile["current_revision"]["id"]

    data = _jpeg()
    intent_response = client.post(
        f"/api/v1/admin/venues/{venue.id}/profile/images/upload-intents",
        headers=_headers("intent-api-00000001"),
        json={
            "expected_revision_version": profile["revision_version"],
            "filename": "pitch.jpg",
            "mime_type": "image/jpeg",
            "byte_size": len(data),
        },
    )
    assert intent_response.status_code == 201
    intent = intent_response.json()
    assert set(intent) == {
        "image_id",
        "object_key",
        "signed_put_url",
        "required_headers",
        "maximum_bytes",
        "accepted_mime_types",
    }
    storage.accept_upload(intent["object_key"], data, intent["required_headers"])

    profile = client.post(
        f"/api/v1/admin/venues/{venue.id}/profile/images/{intent['image_id']}/complete",
        headers=_headers("complete-api-000001"),
        json={"expected_revision_version": profile["revision_version"] + 1},
    ).json()
    image_id = intent["image_id"]
    uploaded = next(
        image for image in profile["current_revision"]["images"] if image["id"] == image_id
    )
    assert uploaded["state"] == "REVIEWING"
    assert "object_key" not in str(profile)

    ordered = client.put(
        f"/api/v1/admin/venues/{venue.id}/profile/images/order",
        headers=_headers("order-api-00000001"),
        json={
            "expected_revision_version": profile["revision_version"],
            "image_ids": [image_id, inherited_image_id],
        },
    )
    assert ordered.status_code == 200
    profile = ordered.json()
    covered = client.put(
        f"/api/v1/admin/venues/{venue.id}/profile/images/{image_id}/cover",
        headers=_headers("cover-api-00000001"),
        json={"expected_revision_version": profile["revision_version"]},
    )
    assert covered.status_code == 200
    profile = covered.json()

    retry = client.post(
        f"/api/v1/admin/venues/{venue.id}/profile/moderation/{image_id}/retry",
        headers=_headers("retry-api-00000001"),
        json={"expected_revision_version": profile["revision_version"]},
    )
    assert retry.status_code == 422
    assert retry.json()["error"]["code"] == "VENUE_PROFILE_VALIDATION_FAILED"

    deleted = client.request(
        "DELETE",
        f"/api/v1/admin/venues/{venue.id}/profile/images/{inherited_image_id}",
        headers=_headers("delete-api-0000001"),
        json={"expected_revision_version": profile["revision_version"]},
    )
    assert deleted.status_code == 200
    assert [image["id"] for image in deleted.json()["current_revision"]["images"]] == [
        image_id
    ]
    with Session(pg_engine) as session:
        revision = session.get(VenueProfileRevision, revision_id)
        assert revision is not None
        assert revision.description_item_version == 2


@pytest.mark.parametrize("image_count", [1, 2])
def test_api_rejects_deleting_current_cover(
    pg_engine: Engine, image_count: int
) -> None:
    venue = _seed(pg_engine)
    _add_published_images(pg_engine, venue.id, image_count)
    client = _client(pg_engine, LocalMediaStorage())
    profile = client.get(
        f"/api/v1/admin/venues/{venue.id}/profile", headers=_headers()
    ).json()
    cover = next(
        image for image in profile["current_revision"]["images"] if image["role"] == "COVER"
    )

    response = client.request(
        "DELETE",
        f"/api/v1/admin/venues/{venue.id}/profile/images/{cover['id']}",
        headers=_headers(f"delete-cover-api-{image_count:04d}"),
        json={"expected_revision_version": profile["revision_version"]},
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VENUE_PROFILE_VALIDATION_FAILED"
    assert response.json()["error"]["message"] == "请先设置新的封面图片，再删除当前封面。"


def test_api_rejects_unknown_fields_and_cross_venue_access(pg_engine: Engine) -> None:
    venue = _seed(pg_engine)
    with Session(pg_engine) as session:
        other = Venue(
            slug=f"other-{uuid.uuid4().hex}",
            name="其他场馆",
            description="公开",
            price_advantage_text="价格透明",
            timezone="Asia/Shanghai",
            business_hours_text="09:00-23:00",
            address="其他路",
            district_code="120101",
            district_name="和平区",
            parking_text="可停车",
            phone="13800000000",
            refund_policy_text="按规则退款",
            latitude=39.1,
            longitude=117.2,
            navigation_poi_name="其他场馆",
            navigation_latitude=39.1,
            navigation_longitude=117.2,
            public_pitch_types=[],
            is_active=True,
        )
        session.add(other)
        session.commit()
        session.refresh(other)
        session.expunge(other)
    client = _client(pg_engine, LocalMediaStorage())
    denied = client.get(f"/api/v1/admin/venues/{other.id}/profile", headers=_headers())
    assert denied.status_code == 403
    assert denied.json()["error"]["code"] == "VENUE_PROFILE_FORBIDDEN"
    invalid = client.put(
        f"/api/v1/admin/venues/{venue.id}/profile",
        headers=_headers("invalid-api-000001"),
        json={
            "expected_facility_version": 1,
            "expected_revision_version": 1,
            "description": "ok",
            "facilities": [],
            "unknown": True,
        },
    )
    assert invalid.status_code == 422
    assert set(invalid.json()["error"]) == {"code", "message", "request_id", "details"}
    assert invalid.json()["error"]["code"] == "VENUE_PROFILE_VALIDATION_FAILED"
