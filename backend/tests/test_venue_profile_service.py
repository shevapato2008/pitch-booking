from __future__ import annotations

import hashlib
import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.app.errors import AppError
from backend.app.models import (
    ContentModerationJob,
    FacilityCode,
    ImageRole,
    ProfileMutationIdempotencyRecord,
    ProfileMutationState,
    User,
    Venue,
    VenueFacility,
    VenueImage,
    VenueMembership,
    VenueProfileImageDraft,
    VenueProfileItemStatus,
    VenueProfileRevision,
)
from backend.app.modules.venue_profiles.dto import (
    CreateUploadIntentRequest,
    OrderVenueProfileImagesRequest,
    SaveVenueProfileRequest,
    VenueProfileRevisionMutationRequest,
)
from backend.app.modules.venue_profiles.local_storage import LocalMediaStorage
from backend.app.modules.venue_profiles.repository import VenueProfileRepository
from backend.app.modules.venue_profiles.service import VenueProfileService

pytestmark = pytest.mark.integration


def _seed(session: Session) -> tuple[Venue, User, User]:
    venue = Venue(
        slug=f"profile-{uuid.uuid4().hex}",
        name="测试足球场",
        description="公开介绍",
        price_advantage_text="价格透明",
        timezone="Asia/Shanghai",
        business_hours_text="09:00-23:00",
        address="测试路 1 号",
        district_code="120101",
        district_name="和平区",
        parking_text="可停车",
        phone="13800000000",
        refund_policy_text="按规则退款",
        latitude=39.1,
        longitude=117.2,
        navigation_poi_name="测试足球场",
        navigation_latitude=39.1,
        navigation_longitude=117.2,
        public_pitch_types=["FIVE_A_SIDE"],
        content_verified_at=datetime.now(UTC),
        is_active=True,
    )
    admin = User(wechat_app_id="wx", wechat_openid=f"admin-{uuid.uuid4()}")
    outsider = User(wechat_app_id="wx", wechat_openid=f"outside-{uuid.uuid4()}")
    session.add_all([venue, admin, outsider])
    session.flush()
    session.add(
        VenueMembership(
            venue_id=venue.id, user_id=admin.id, is_active=True, can_manage_inventory=True
        )
    )
    session.add_all(
        [
            VenueFacility(
                venue_id=venue.id, code=FacilityCode.PARKING, name="停车场", sort_order=0
            ),
            VenueImage(
                venue_id=venue.id,
                url="https://assets.example/cover.webp",
                alt="原始文案",
                role=ImageRole.COVER,
                sort_order=0,
            ),
        ]
    )
    session.commit()
    return venue, admin, outsider


def _service(session: Session) -> VenueProfileService:
    return VenueProfileService(VenueProfileRepository(session), LocalMediaStorage())


def test_bootstrap_requires_active_membership_and_inherits_published_images(
    pg_session: Session,
) -> None:
    venue, admin, outsider = _seed(pg_session)
    snapshot = _service(pg_session).get(venue_id=venue.id, user=admin)
    assert snapshot.current_revision.description == "公开介绍"
    assert snapshot.current_revision.images[0].state == "APPROVED"
    assert snapshot.current_revision.images[0].alt == "测试足球场第1张图片"
    assert len(snapshot.facility_catalog) == 17
    with pytest.raises(AppError, match="VENUE_PROFILE_FORBIDDEN"):
        _service(pg_session).get(venue_id=venue.id, user=outsider)


def test_save_accepts_300_code_points_and_atomically_updates_versions(
    pg_session: Session,
) -> None:
    venue, admin, _ = _seed(pg_session)
    service = _service(pg_session)
    initial = service.get(venue_id=venue.id, user=admin)
    saved = service.save(
        venue_id=venue.id,
        user=admin,
        idempotency_key="save-profile-00000001",
        request=SaveVenueProfileRequest(
            expected_facility_version=initial.facility_version,
            expected_revision_version=initial.revision_version,
            description="足" * 300,
            facilities=["PARKING", "SHOWER"],
        ),
    )
    assert saved.facility_version == initial.facility_version + 1
    assert saved.revision_version == initial.revision_version + 1
    assert saved.current_revision.facilities == ["PARKING", "SHOWER"]
    assert saved.published.facilities == initial.published.facilities
    assert [item.code.value for item in pg_session.scalars(
        select(VenueFacility).where(VenueFacility.venue_id == venue.id)
    )] == [item.code for item in initial.published.facilities]
    assert pg_session.scalar(select(func.count()).select_from(ContentModerationJob)) == 1

    replay = service.save(
        venue_id=venue.id,
        user=admin,
        idempotency_key="save-profile-00000001",
        request=SaveVenueProfileRequest(
            expected_facility_version=initial.facility_version,
            expected_revision_version=initial.revision_version,
            description="足" * 300,
            facilities=["PARKING", "SHOWER"],
        ),
    )
    assert replay == saved


def test_description_item_version_changes_only_for_description_work(
    pg_session: Session,
) -> None:
    venue, admin, _ = _seed(pg_session)
    service = _service(pg_session)
    initial = service.get(venue_id=venue.id, user=admin)
    revision = pg_session.get(VenueProfileRevision, initial.current_revision.id)
    assert revision is not None
    assert revision.description_item_version == 1

    facilities_only = service.save(
        venue_id=venue.id,
        user=admin,
        idempotency_key="facility-only-000001",
        request=SaveVenueProfileRequest(
            expected_facility_version=initial.facility_version,
            expected_revision_version=initial.revision_version,
            description=initial.current_revision.description,
            facilities=["PARKING", "SHOWER"],
        ),
    )
    pg_session.refresh(revision)
    assert revision.description_item_version == 1

    service.save(
        venue_id=venue.id,
        user=admin,
        idempotency_key="description-00000001",
        request=SaveVenueProfileRequest(
            expected_facility_version=facilities_only.facility_version,
            expected_revision_version=facilities_only.revision_version,
            description="需要重新审核的介绍",
            facilities=["PARKING", "SHOWER"],
        ),
    )
    pg_session.refresh(revision)
    assert revision.description_item_version == 2
    job = pg_session.scalar(
        select(ContentModerationJob).where(ContentModerationJob.revision_id == revision.id)
    )
    assert job is not None
    assert job.item_version == 2
    assert job.content_sha256 == hashlib.sha256("需要重新审核的介绍".encode()).hexdigest()
    assert job.policy_version == "venue-profile-v1"

    revision.description_status = VenueProfileItemStatus.REJECTED
    revision.description_reason_code = "UNRELATED_CONTENT"
    pg_session.commit()
    current = service.get(venue_id=venue.id, user=admin)
    service.retry(
        venue_id=venue.id,
        item_id=revision.id,
        user=admin,
        idempotency_key="description-retry-001",
        request=VenueProfileRevisionMutationRequest(
            expected_revision_version=current.revision_version
        ),
    )
    pg_session.refresh(revision)
    assert revision.description_item_version == 3
    assert pg_session.scalar(
        select(func.max(ContentModerationJob.item_version)).where(
            ContentModerationJob.revision_id == revision.id
        )
    ) == 3


@pytest.mark.parametrize("gallery_count", [0, 1])
def test_delete_rejects_current_cover_until_replacement_is_set(
    pg_session: Session, gallery_count: int
) -> None:
    venue, admin, _ = _seed(pg_session)
    service = _service(pg_session)
    initial = service.get(venue_id=venue.id, user=admin)
    if gallery_count:
        published = VenueImage(
            venue_id=venue.id,
            url="https://assets.example/gallery.webp",
            alt="gallery",
            role=ImageRole.GALLERY,
            sort_order=1,
        )
        pg_session.add(published)
        pg_session.flush()
        pg_session.add(
            VenueProfileImageDraft(
                revision_id=initial.current_revision.id,
                published_image_id=published.id,
                role=ImageRole.GALLERY,
                sort_order=1,
                moderation_status=VenueProfileItemStatus.APPROVED,
                item_version=1,
            )
        )
        pg_session.commit()

    cover_id = initial.current_revision.images[0].id
    with pytest.raises(AppError) as rejected:
        service.delete(
            venue_id=venue.id,
            image_id=cover_id,
            user=admin,
            idempotency_key=f"delete-cover-{gallery_count:08d}",
            request=VenueProfileRevisionMutationRequest(
                expected_revision_version=initial.revision_version
            ),
        )
    assert rejected.value.code == "VENUE_PROFILE_VALIDATION_FAILED"
    assert rejected.value.message == "请先设置新的封面图片，再删除当前封面。"
    current = service.get(venue_id=venue.id, user=admin)
    assert current.revision_version == initial.revision_version
    assert current.current_revision.images[0].id == cover_id
    assert len(current.current_revision.images) == gallery_count + 1


def test_save_rejects_invalid_input_version_and_rolls_back_both_authorities(
    pg_session: Session,
) -> None:
    venue, admin, _ = _seed(pg_session)
    service = _service(pg_session)
    initial = service.get(venue_id=venue.id, user=admin)
    with pytest.raises(AppError) as too_long:
        service.save(
            venue_id=venue.id,
            user=admin,
            idempotency_key="save-profile-00000002",
            request=SaveVenueProfileRequest.model_construct(
                expected_facility_version=initial.facility_version,
                expected_revision_version=initial.revision_version,
                description="足" * 301,
                facilities=["PARKING"],
            ),
        )
    assert too_long.value.code == "VENUE_PROFILE_VALIDATION_FAILED"
    current = service.get(venue_id=venue.id, user=admin)
    assert (current.facility_version, current.revision_version) == (
        initial.facility_version,
        initial.revision_version,
    )

    with pytest.raises(AppError) as stale:
        service.save(
            venue_id=venue.id,
            user=admin,
            idempotency_key="save-profile-00000003",
            request=SaveVenueProfileRequest(
                expected_facility_version=99,
                expected_revision_version=initial.revision_version,
                description="changed",
                facilities=["PARKING"],
            ),
        )
    assert stale.value.code == "VENUE_PROFILE_VERSION_CONFLICT"
    assert stale.value.details == {
        "current_facility_version": initial.facility_version,
        "current_revision_version": initial.revision_version,
    }


def test_facility_decoder_is_closed_whitelisted_and_unique() -> None:
    with pytest.raises(ValueError):
        SaveVenueProfileRequest(
            expected_facility_version=1,
            expected_revision_version=1,
            description="ok",
            facilities=["WIFI"],
        )  # type: ignore[list-item]
    with pytest.raises(ValueError):
        SaveVenueProfileRequest(
            expected_facility_version=1,
            expected_revision_version=1,
            description="ok",
            facilities=["PARKING", "PARKING"],
        )
    with pytest.raises(ValueError):
        SaveVenueProfileRequest(
            expected_facility_version=1,
            expected_revision_version=1,
            description="ok",
            facilities=[],
            surprise=True,
        )  # type: ignore[call-arg]


def test_idempotency_scope_includes_actor_venue_scope_and_detects_reuse(
    pg_session: Session,
) -> None:
    venue, admin, _ = _seed(pg_session)
    service = _service(pg_session)
    initial = service.get(venue_id=venue.id, user=admin)
    request = SaveVenueProfileRequest(
        expected_facility_version=initial.facility_version,
        expected_revision_version=initial.revision_version,
        description="new",
        facilities=["PARKING"],
    )
    service.save(
        venue_id=venue.id, user=admin, request=request, idempotency_key="same-key-000000001"
    )
    with pytest.raises(AppError, match="IDEMPOTENCY_KEY_REUSED"):
        service.save(
            venue_id=venue.id,
            user=admin,
            idempotency_key="same-key-000000001",
            request=request.model_copy(update={"description": "different"}),
        )
    current = service.get(venue_id=venue.id, user=admin)
    service.set_cover(
        venue_id=venue.id,
        image_id=current.current_revision.images[0].id,
        user=admin,
        idempotency_key="same-key-000000001",
        request=VenueProfileRevisionMutationRequest(
            expected_revision_version=current.revision_version
        ),
    )
    retry_request = VenueProfileRevisionMutationRequest(
        expected_revision_version=service.get(venue_id=venue.id, user=admin).revision_version
    )
    pg_session.add(
        ProfileMutationIdempotencyRecord(
            venue_id=venue.id,
            actor_user_id=admin.id,
            scope="set_cover",
            key="in-progress-0000001",
            request_sha256=service._hash(
                venue.id,
                {
                    "image_id": str(initial.current_revision.images[0].id),
                    **retry_request.model_dump(mode="json"),
                },
            ),
            state=ProfileMutationState.CLAIMED,
        )
    )
    pg_session.commit()
    with pytest.raises(AppError, match="REQUEST_IN_PROGRESS"):
        service.set_cover(
            venue_id=venue.id,
            image_id=initial.current_revision.images[0].id,
            user=admin,
            idempotency_key="in-progress-0000001",
            request=retry_request,
        )


def test_reorder_requires_exact_set_preserves_approval_and_cover(pg_session: Session) -> None:
    venue, admin, _ = _seed(pg_session)
    service = _service(pg_session)
    initial = service.get(venue_id=venue.id, user=admin)
    revision_id = initial.current_revision.id
    second = VenueProfileImageDraft(
        revision_id=revision_id,
        published_image_id=uuid.uuid4(),
        role=ImageRole.GALLERY,
        sort_order=1,
        moderation_status=VenueProfileItemStatus.APPROVED,
        item_version=1,
    )
    # Use a real published source for the inherited reference constraint.
    published = VenueImage(
        venue_id=venue.id,
        url="https://assets.example/second.webp",
        alt="second",
        role=ImageRole.GALLERY,
        sort_order=1,
    )
    pg_session.add(published)
    pg_session.flush()
    second.published_image_id = published.id
    pg_session.add(second)
    pg_session.commit()
    before_jobs = pg_session.scalar(select(func.count()).select_from(ContentModerationJob))
    result = service.reorder(
        venue_id=venue.id,
        user=admin,
        idempotency_key="order-profile-000001",
        request=OrderVenueProfileImagesRequest(
            expected_revision_version=initial.revision_version,
            image_ids=[second.id, initial.current_revision.images[0].id],
        ),
    )
    assert [image.id for image in result.current_revision.images] == [
        second.id,
        initial.current_revision.images[0].id,
    ]
    assert sum(image.role == "COVER" for image in result.current_revision.images) == 1
    assert all(image.state == "APPROVED" for image in result.current_revision.images)
    assert pg_session.scalar(select(func.count()).select_from(ContentModerationJob)) == before_jobs
    revision = pg_session.get(VenueProfileRevision, revision_id)
    assert revision is not None
    assert revision.description_item_version == 1


def test_set_cover_on_approved_inherited_images_updates_public_cover(pg_session: Session) -> None:
    venue, admin, _ = _seed(pg_session)
    second = VenueImage(
        venue_id=venue.id,
        url="https://assets.example/second-cover.webp",
        alt="second",
        role=ImageRole.GALLERY,
        sort_order=1,
    )
    pg_session.add(second)
    pg_session.commit()
    service = _service(pg_session)
    initial = service.get(venue_id=venue.id, user=admin)
    second_draft = next(image for image in initial.current_revision.images if image.sort_order == 1)

    service.set_cover(
        venue_id=venue.id,
        image_id=second_draft.id,
        user=admin,
        idempotency_key="set-approved-cover-1",
        request=VenueProfileRevisionMutationRequest(
            expected_revision_version=initial.revision_version
        ),
    )

    public_cover = pg_session.scalar(
        select(VenueImage).where(
            VenueImage.venue_id == venue.id, VenueImage.role == ImageRole.COVER
        )
    )
    assert public_cover is not None
    assert public_cover.id == second.id
    refreshed = service.get(venue_id=venue.id, user=admin)
    assert refreshed.current_revision.images[0].id == second_draft.id
    assert refreshed.current_revision.images[0].role == "COVER"


def test_upload_intent_enforces_eight_image_maximum(pg_session: Session) -> None:
    venue, admin, _ = _seed(pg_session)
    service = _service(pg_session)
    initial = service.get(venue_id=venue.id, user=admin)
    for index in range(1, 8):
        published = VenueImage(
            venue_id=venue.id,
            url=f"https://assets.example/{index}.webp",
            alt=str(index),
            role=ImageRole.GALLERY,
            sort_order=index,
        )
        pg_session.add(published)
        pg_session.flush()
        pg_session.add(
            VenueProfileImageDraft(
                revision_id=initial.current_revision.id,
                published_image_id=published.id,
                role=ImageRole.GALLERY,
                sort_order=index,
                moderation_status=VenueProfileItemStatus.APPROVED,
                item_version=1,
            )
        )
    pg_session.commit()
    with pytest.raises(AppError) as error:
        service.create_upload_intent(
            venue_id=venue.id,
            user=admin,
            idempotency_key="max-images-00000001",
            request=CreateUploadIntentRequest(
                expected_revision_version=initial.revision_version,
                filename="ninth.jpg",
                mime_type="image/jpeg",
                byte_size=100,
            ),
        )
    assert error.value.code == "VENUE_PROFILE_VALIDATION_FAILED"
