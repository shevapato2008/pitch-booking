from __future__ import annotations

import uuid
from contextlib import AbstractContextManager
from datetime import UTC, datetime

import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from backend.app.models import (
    ContentModerationJob,
    ImageRole,
    ModerationDecisionOutcome,
    ModerationItemType,
    ModerationJobStatus,
    User,
    Venue,
    VenueImage,
    VenueProfileImageDraft,
    VenueProfileItemStatus,
    VenueProfileRevision,
    VenueProfileRevisionStatus,
)
from backend.app.modules.venue_profiles.local_storage import LocalMediaStorage
from backend.app.modules.venue_profiles.moderation import ModerationRequest, ModerationResult
from backend.app.modules.venue_profiles.publisher import VenueProfilePublisher
from backend.app.modules.venue_profiles.repository import VenueProfileRepository
from backend.app.modules.venue_profiles.worker import MAX_ATTEMPTS, VenueProfileModerationWorker
from backend.app.worker import ExpiryWorker

pytestmark = pytest.mark.integration


class FakeProvider:
    provider_name = "fake"
    model_name = "vision-v1"

    def __init__(self, outcome: ModerationDecisionOutcome) -> None:
        self.outcome = outcome
        self.requests: list[ModerationRequest] = []

    def moderate(self, request: ModerationRequest) -> ModerationResult:
        self.requests.append(request)
        return ModerationResult(self.outcome, raw_response_sha256="a" * 64)


def _factory(engine: Engine):  # type: ignore[no-untyped-def]
    def create() -> AbstractContextManager[Session]:
        return Session(engine)

    return create


def _seed(engine: Engine) -> tuple[uuid.UUID, uuid.UUID]:
    with Session(engine) as session:
        user = User(wechat_app_id="wx", wechat_openid=f"worker-{uuid.uuid4()}")
        venue = Venue(
            slug=f"worker-{uuid.uuid4().hex}", name="审核球场", description="旧介绍",
            price_advantage_text="价格透明", timezone="Asia/Shanghai",
            business_hours_text="09:00-23:00", address="测试路", district_code="120101",
            district_name="和平区", parking_text="可停车", phone="13800000000",
            refund_policy_text="按规则退款", latitude=39.1, longitude=117.2,
            navigation_poi_name="审核球场", navigation_latitude=39.1,
            navigation_longitude=117.2, public_pitch_types=["FIVE_A_SIDE"], is_active=True,
        )
        session.add_all([user, venue])
        session.flush()
        public = VenueImage(
            venue_id=venue.id, url="https://assets.example/cover.jpg", alt="封面",
            role=ImageRole.COVER, sort_order=0,
        )
        revision = VenueProfileRevision(
            venue_id=venue.id, base_published_version=1, revision_version=2,
            target_description="需要审核的准确文本", status=VenueProfileRevisionStatus.REVIEWING,
            description_status=VenueProfileItemStatus.REVIEWING,
            description_item_version=2, created_by_user_id=user.id, is_current_editable=True,
        )
        session.add_all([public, revision])
        session.flush()
        session.add(
            VenueProfileImageDraft(
                revision_id=revision.id, published_image_id=public.id, role=ImageRole.COVER,
                sort_order=0, moderation_status=VenueProfileItemStatus.APPROVED, item_version=1,
            )
        )
        job = VenueProfileRepository(session).add_job(
            revision, ModerationItemType.DESCRIPTION, revision.description_item_version
        )
        session.commit()
        return revision.id, job.id


def test_worker_claims_commits_provider_result_and_publishes(pg_engine: Engine) -> None:
    revision_id, job_id = _seed(pg_engine)
    provider = FakeProvider(ModerationDecisionOutcome.PASS)
    factory = _factory(pg_engine)
    worker = VenueProfileModerationWorker(
        session_factory=factory,
        provider=provider,
        media_store=LocalMediaStorage(),
        publisher=VenueProfilePublisher(factory, LocalMediaStorage()),
        clock=lambda: datetime.now(UTC),
    )

    assert worker.run_once() == 1
    assert provider.requests == [
        ModerationRequest(
            item_type=ModerationItemType.DESCRIPTION, text="需要审核的准确文本"
        )
    ]
    with Session(pg_engine) as session:
        assert session.get_one(ContentModerationJob, job_id).status is ModerationJobStatus.COMPLETED
        assert (
            session.get_one(VenueProfileRevision, revision_id).status
            is VenueProfileRevisionStatus.PUBLISHED
        )


def test_worker_discards_stale_job_without_provider_call(pg_engine: Engine) -> None:
    revision_id, job_id = _seed(pg_engine)
    with Session(pg_engine) as session:
        session.get_one(VenueProfileRevision, revision_id).description_item_version += 1
        session.commit()
    provider = FakeProvider(ModerationDecisionOutcome.PASS)
    factory = _factory(pg_engine)
    assert VenueProfileModerationWorker(
        session_factory=factory, provider=provider, media_store=LocalMediaStorage(),
        publisher=VenueProfilePublisher(factory, LocalMediaStorage()),
    ).run_once() == 1
    assert provider.requests == []
    with Session(pg_engine) as session:
        assert session.get_one(ContentModerationJob, job_id).status is ModerationJobStatus.COMPLETED


def test_exhausted_uncertainty_enters_manual_queue(pg_engine: Engine) -> None:
    revision_id, job_id = _seed(pg_engine)
    with Session(pg_engine) as session:
        session.get_one(ContentModerationJob, job_id).attempt_count = MAX_ATTEMPTS - 1
        session.commit()
    provider = FakeProvider(ModerationDecisionOutcome.UNCERTAIN)
    factory = _factory(pg_engine)
    VenueProfileModerationWorker(
        session_factory=factory, provider=provider, media_store=LocalMediaStorage(),
        publisher=VenueProfilePublisher(factory, LocalMediaStorage()),
    ).run_once()
    with Session(pg_engine) as session:
        job = session.get_one(ContentModerationJob, job_id)
        revision = session.get_one(VenueProfileRevision, revision_id)
        assert job.status is ModerationJobStatus.FAILED
        assert revision.description_status is VenueProfileItemStatus.PENDING_MANUAL
        assert revision.status is VenueProfileRevisionStatus.PENDING_MANUAL


def test_root_worker_includes_moderation_count_without_changing_expiry_count(
    pg_engine: Engine,
) -> None:
    class FakeModerationWorker:
        def run_once(self) -> int:
            return 3

    assert ExpiryWorker(
        session_factory=_factory(pg_engine),
        profile_moderation=FakeModerationWorker(),
    ).run_once() == 3
