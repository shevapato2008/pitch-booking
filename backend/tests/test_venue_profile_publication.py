from __future__ import annotations

import io
import uuid
from contextlib import AbstractContextManager

import pytest
from PIL import Image
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session

from backend.app.models import (
    ImageRole,
    User,
    Venue,
    VenueImage,
    VenueProfileImageDraft,
    VenueProfileItemStatus,
    VenueProfileRevision,
    VenueProfileRevisionStatus,
)
from backend.app.modules.venue_profiles.local_storage import LocalMediaStorage
from backend.app.modules.venue_profiles.publisher import VenueProfilePublisher

pytestmark = pytest.mark.integration


def _factory(engine: Engine):  # type: ignore[no-untyped-def]
    def create() -> AbstractContextManager[Session]:
        return Session(engine)

    return create


def _jpeg() -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (12, 12), "green").save(output, "JPEG")
    return output.getvalue()


def _seed(engine: Engine, storage: LocalMediaStorage) -> tuple[uuid.UUID, uuid.UUID]:
    with Session(engine) as session:
        user = User(wechat_app_id="wx", wechat_openid=f"publisher-{uuid.uuid4()}")
        venue = Venue(
            slug=f"publisher-{uuid.uuid4().hex}", name="发布球场", description="旧介绍",
            price_advantage_text="价格透明", timezone="Asia/Shanghai",
            business_hours_text="09:00-23:00", address="测试路", district_code="120101",
            district_name="和平区", parking_text="可停车", phone="13800000000",
            refund_policy_text="按规则退款", latitude=39.1, longitude=117.2,
            navigation_poi_name="发布球场", navigation_latitude=39.1,
            navigation_longitude=117.2, public_pitch_types=["FIVE_A_SIDE"], is_active=True,
        )
        session.add_all([user, venue])
        session.flush()
        old = VenueImage(
            venue_id=venue.id, url="https://assets.example/old.jpg", alt="旧图",
            role=ImageRole.COVER, sort_order=0,
        )
        revision = VenueProfileRevision(
            venue_id=venue.id, base_published_version=venue.profile_version,
            revision_version=2, target_description="新介绍",
            status=VenueProfileRevisionStatus.READY,
            description_status=VenueProfileItemStatus.APPROVED,
            created_by_user_id=user.id, is_current_editable=True,
        )
        session.add_all([old, revision])
        session.flush()
        image_id = uuid.uuid4()
        intent = storage.create_upload_intent(venue.id, image_id, "image/jpeg", len(_jpeg()))
        storage.accept_upload(intent.object_key, _jpeg(), intent.required_headers)
        original = storage.read_bounded(venue.id, image_id, intent.object_key)
        review = storage.write_review_copy(venue.id, image_id, original)
        session.add(
            VenueProfileImageDraft(
                id=image_id, revision_id=revision.id, original_object_key=intent.object_key,
                review_object_key=review.object_key, role=ImageRole.COVER, sort_order=0,
                content_sha256=original.sha256, actual_mime_type=original.content_type,
                byte_size=original.byte_size, moderation_status=VenueProfileItemStatus.APPROVED,
                item_version=1,
            )
        )
        session.commit()
        return venue.id, revision.id


def test_publisher_promotes_then_atomically_switches_public_profile(pg_engine: Engine) -> None:
    storage = LocalMediaStorage("https://cdn.example/media")
    venue_id, revision_id = _seed(pg_engine, storage)

    assert VenueProfilePublisher(_factory(pg_engine), storage).publish_if_ready(revision_id)

    with Session(pg_engine) as session:
        venue = session.get_one(Venue, venue_id)
        revision = session.get_one(VenueProfileRevision, revision_id)
        images = list(session.scalars(select(VenueImage).where(VenueImage.venue_id == venue_id)))
        assert venue.description == "新介绍"
        assert venue.profile_version == 2
        assert revision.status is VenueProfileRevisionStatus.PUBLISHED
        assert revision.is_current_editable is False
        assert len(images) == 1
        assert images[0].url.startswith("https://cdn.example/media/published/")


def test_publisher_leaves_old_rows_when_promotion_fails(pg_engine: Engine) -> None:
    class BrokenStorage(LocalMediaStorage):
        def promote_and_verify(self, *args, **kwargs):  # type: ignore[no-untyped-def]
            raise RuntimeError("injected promotion failure")

    storage = BrokenStorage()
    venue_id, revision_id = _seed(pg_engine, storage)
    with pytest.raises(RuntimeError, match="promotion failure"):
        VenueProfilePublisher(_factory(pg_engine), storage).publish_if_ready(revision_id)
    with Session(pg_engine) as session:
        venue = session.get_one(Venue, venue_id)
        assert venue.description == "旧介绍"
        assert venue.profile_version == 1
        assert session.scalar(
            select(VenueImage.url).where(VenueImage.venue_id == venue_id)
        ) == "https://assets.example/old.jpg"
