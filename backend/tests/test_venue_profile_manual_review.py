from __future__ import annotations

import hashlib
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session

from backend.app.config import Settings
from backend.app.database import get_database
from backend.app.main import create_app
from backend.app.models import (
    ContentModerationDecision,
    ContentModerationJob,
    ImageRole,
    ModerationItemType,
    ModerationJobStatus,
    User,
    UserSession,
    Venue,
    VenueImage,
    VenueProfileImageDraft,
    VenueProfileItemStatus,
    VenueProfileRevision,
    VenueProfileRevisionStatus,
)
from backend.app.modules.venue_profiles.local_storage import LocalMediaStorage
from backend.app.modules.venue_profiles.moderation import POLICY_VERSION

pytestmark = pytest.mark.integration
REVIEWER_TOKEN = "reviewer-token-00000000001"
OUTSIDER_TOKEN = "outsider-token-000000000001"


class HttpsReviewStorage(LocalMediaStorage):
    def signed_review_url(self, venue_id, image_id, object_key):  # type: ignore[no-untyped-def]
        return f"https://review.example/{venue_id}/{image_id}?signature=short-lived"


def _seed(engine: Engine) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    with Session(engine) as session:
        reviewer = User(wechat_app_id="wx", wechat_openid=f"reviewer-{uuid.uuid4()}")
        outsider = User(wechat_app_id="wx", wechat_openid=f"outsider-{uuid.uuid4()}")
        venue = Venue(
            slug=f"manual-{uuid.uuid4().hex}", name="人工审核球场", description="旧介绍",
            price_advantage_text="价格透明", timezone="Asia/Shanghai",
            business_hours_text="09:00-23:00", address="测试路", district_code="120101",
            district_name="和平区", parking_text="可停车", phone="13800000000",
            refund_policy_text="按规则退款", latitude=39.1, longitude=117.2,
            navigation_poi_name="人工审核球场", navigation_latitude=39.1,
            navigation_longitude=117.2, public_pitch_types=["FIVE_A_SIDE"], is_active=True,
        )
        session.add_all([reviewer, outsider, venue])
        session.flush()
        now = datetime.now(UTC)
        session.add_all(
            [
                UserSession(
                    user_id=reviewer.id,
                    token_hash=hashlib.sha256(REVIEWER_TOKEN.encode()).hexdigest(),
                    issued_at=now - timedelta(minutes=1), expires_at=now + timedelta(hours=1),
                ),
                UserSession(
                    user_id=outsider.id,
                    token_hash=hashlib.sha256(OUTSIDER_TOKEN.encode()).hexdigest(),
                    issued_at=now - timedelta(minutes=1), expires_at=now + timedelta(hours=1),
                ),
            ]
        )
        public = VenueImage(
            venue_id=venue.id, url="https://assets.example/cover.jpg", alt="封面",
            role=ImageRole.COVER, sort_order=0,
        )
        revision = VenueProfileRevision(
            venue_id=venue.id, base_published_version=1, revision_version=2,
            target_description="人工确认后的介绍", status=VenueProfileRevisionStatus.PENDING_MANUAL,
            description_status=VenueProfileItemStatus.PENDING_MANUAL,
            description_item_version=2, created_by_user_id=reviewer.id, is_current_editable=True,
        )
        session.add_all([public, revision])
        session.flush()
        session.add(
            VenueProfileImageDraft(
                revision_id=revision.id, published_image_id=public.id, role=ImageRole.COVER,
                sort_order=0, moderation_status=VenueProfileItemStatus.APPROVED, item_version=1,
            )
        )
        session.add(
            ContentModerationJob(
                revision_id=revision.id, item_type=ModerationItemType.DESCRIPTION,
                item_version=2, content_sha256=hashlib.sha256(
                    revision.target_description.encode()
                ).hexdigest(), policy_version=POLICY_VERSION, status=ModerationJobStatus.FAILED,
                attempt_count=3, next_run_at=now,
            )
        )
        session.commit()
        return reviewer.id, venue.id, revision.id


def _client(engine: Engine, reviewer_id: uuid.UUID) -> TestClient:
    app = create_app(
        settings=Settings(MODERATION_REVIEWER_USER_IDS=str(reviewer_id)),
        venue_media_store=HttpsReviewStorage(),
    )

    def database_override() -> Iterator[Session]:
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_database] = database_override
    return TestClient(app, raise_server_exceptions=False)


def _headers(token: str, key: str | None = None) -> dict[str, str]:
    result = {"Authorization": f"Bearer {token}"}
    if key:
        result["Idempotency-Key"] = key
    return result


def test_manual_queue_is_reviewer_only_and_description_url_is_null(pg_engine: Engine) -> None:
    reviewer_id, venue_id, revision_id = _seed(pg_engine)
    client = _client(pg_engine, reviewer_id)
    forbidden = client.get(
        "/api/v1/admin/moderation/venue-profiles/pending",
        headers=_headers(OUTSIDER_TOKEN),
    )
    assert forbidden.status_code == 403

    response = client.get(
        "/api/v1/admin/moderation/venue-profiles/pending",
        headers=_headers(REVIEWER_TOKEN),
    )
    assert response.status_code == 200
    assert response.json() == {
        "items": [
            {
                "item_id": str(revision_id), "venue_id": str(venue_id),
                "venue_name": "人工审核球场", "revision_id": str(revision_id),
                "revision_version": 2, "item_version": 2, "item_type": "DESCRIPTION",
                "state": "PENDING_MANUAL", "review_image_url": None,
                "submitted_at": response.json()["items"][0]["submitted_at"],
            }
        ],
        "next_cursor": None,
    }


def test_manual_pass_is_versioned_idempotent_and_invokes_publisher(pg_engine: Engine) -> None:
    reviewer_id, venue_id, revision_id = _seed(pg_engine)
    client = _client(pg_engine, reviewer_id)
    url = f"/api/v1/admin/moderation/venue-profiles/{revision_id}/decisions"
    body = {"expected_item_version": 2, "decision": "PASS"}
    headers = _headers(REVIEWER_TOKEN, "manual-decision-000001")

    assert client.post(url, headers=headers, json=body).status_code == 204
    assert client.post(url, headers=headers, json=body).status_code == 204

    with Session(pg_engine) as session:
        venue = session.get_one(Venue, venue_id)
        assert venue.description == "人工确认后的介绍"
        assert venue.profile_version == 2
        decisions = list(session.scalars(select(ContentModerationDecision)))
        assert len(decisions) == 1
        assert decisions[0].reviewer_user_id == reviewer_id


def test_manual_decision_rejects_stale_item_version(pg_engine: Engine) -> None:
    reviewer_id, _, revision_id = _seed(pg_engine)
    response = _client(pg_engine, reviewer_id).post(
        f"/api/v1/admin/moderation/venue-profiles/{revision_id}/decisions",
        headers=_headers(REVIEWER_TOKEN, "manual-decision-000002"),
        json={"expected_item_version": 1, "decision": "PASS"},
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "VENUE_PROFILE_VERSION_CONFLICT"
