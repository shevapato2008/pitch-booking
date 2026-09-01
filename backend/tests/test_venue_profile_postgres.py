from __future__ import annotations

from contextlib import AbstractContextManager
from datetime import UTC, datetime

import pytest
from sqlalchemy import Engine, func, inspect, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.app.errors import AppError
from backend.app.models import (
    ContentModerationDecision,
    ContentModerationJob,
    ModerationDecisionOutcome,
    ModerationJobStatus,
    User,
    Venue,
    VenueFacility,
    VenueImage,
    VenueMembership,
    VenueProfileItemStatus,
    VenueProfileRevision,
    VenueProfileRevisionStatus,
)
from backend.app.modules.venue_profiles.dto import SaveVenueProfileRequest
from backend.app.modules.venue_profiles.local_storage import LocalMediaStorage
from backend.app.modules.venue_profiles.moderation import ModerationResult
from backend.app.modules.venue_profiles.publisher import VenueProfilePublisher
from backend.app.modules.venue_profiles.repository import VenueProfileRepository
from backend.app.modules.venue_profiles.service import VenueProfileService
from backend.app.modules.venue_profiles.worker import VenueProfileModerationWorker
from scripts.seed_demo import VENUE_ID, run_seed, stable_id

pytestmark = pytest.mark.integration
NOW = datetime(2026, 8, 12, 3, 0, tzinfo=UTC)
CLAIM_NOW = datetime(2099, 8, 12, 3, 0, tzinfo=UTC)


class NeverCalledProvider:
    provider_name = "acceptance-fake"
    model_name = "vision-fake"

    def moderate(self, _request: object) -> ModerationResult:
        raise AssertionError("provider must not be called by PostgreSQL acceptance tests")


def _factory(engine: Engine):  # type: ignore[no-untyped-def]
    def create() -> AbstractContextManager[Session]:
        return Session(engine)

    return create


def _seed(engine: Engine, monkeypatch: pytest.MonkeyPatch) -> tuple[Venue, User]:
    monkeypatch.setenv("APP_ENV", "test")
    run_seed(
        anchor="2026-08-12",
        days=2,
        database_url=engine.url.render_as_string(hide_password=False),
        now=NOW,
    )
    with Session(engine) as session:
        venue = session.get_one(Venue, VENUE_ID)
        user = session.get_one(User, stable_id("development-inventory-user"))
        session.expunge(venue)
        session.expunge(user)
        return venue, user


def _service(session: Session) -> VenueProfileService:
    return VenueProfileService(VenueProfileRepository(session), LocalMediaStorage())


def _worker(engine: Engine) -> VenueProfileModerationWorker:
    factory = _factory(engine)
    return VenueProfileModerationWorker(
        session_factory=factory,
        provider=NeverCalledProvider(),
        media_store=LocalMediaStorage(),
        publisher=VenueProfilePublisher(factory, LocalMediaStorage()),
        clock=lambda: CLAIM_NOW,
        batch_size=1,
    )


def test_head_migration_and_seed_create_published_profile_authority(
    pg_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _seed(pg_engine, monkeypatch)

    assert inspect(pg_engine).has_table("venue_profile_revisions")
    with Session(pg_engine) as session:
        revision = session.execute(
            text("SELECT version_num FROM alembic_version")
        ).scalar_one()
        assert revision == "0024"
        venue = session.get_one(Venue, VENUE_ID)
        membership = session.scalar(
            select(VenueMembership).where(
                VenueMembership.venue_id == VENUE_ID,
                VenueMembership.user_id == stable_id("development-inventory-user"),
            )
        )
        images = list(
            session.scalars(
                select(VenueImage)
                .where(VenueImage.venue_id == VENUE_ID)
                .order_by(VenueImage.sort_order)
            )
        )
        facilities = list(
            session.scalars(
                select(VenueFacility)
                .where(VenueFacility.venue_id == VENUE_ID)
                .order_by(VenueFacility.sort_order)
            )
        )

    assert membership is not None and membership.can_manage_inventory
    assert venue.profile_version == 1 and venue.facility_version == 1
    assert venue.description and len(venue.description) <= 300
    assert [image.role.value for image in images] == ["COVER", "GALLERY"]
    assert [item.code.value for item in facilities] == [
        "PARKING",
        "TOILET",
        "CHANGING_ROOM",
        "DRINKING_WATER",
        "OUTDOOR",
        "LIGHTING",
        "ARTIFICIAL_TURF",
    ]


def test_version_conflict_rolls_back_and_database_allows_one_current_revision(
    pg_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    venue, user = _seed(pg_engine, monkeypatch)
    with Session(pg_engine) as session:
        service = _service(session)
        initial = service.get(venue_id=venue.id, user=user)
        before_codes = list(initial.current_revision.facilities)

        with pytest.raises(AppError) as conflict:
            service.save(
                venue_id=venue.id,
                user=user,
                idempotency_key="acceptance-stale-version-0001",
                request=SaveVenueProfileRequest(
                    expected_facility_version=initial.facility_version + 1,
                    expected_revision_version=initial.revision_version,
                    description="不应写入的介绍",
                    facilities=["PARKING"],
                ),
            )
        assert conflict.value.code == "VENUE_PROFILE_VERSION_CONFLICT"
        current = service.get(venue_id=venue.id, user=user)
        assert current.current_revision.description == initial.current_revision.description
        assert current.current_revision.facilities == before_codes
        assert current.facility_version == initial.facility_version

        session.add(
            VenueProfileRevision(
                venue_id=venue.id,
                base_published_version=1,
                revision_version=initial.revision_version + 1,
                target_description="另一个当前草稿",
                status=VenueProfileRevisionStatus.READY,
                description_status=VenueProfileItemStatus.APPROVED,
                created_by_user_id=user.id,
                is_current_editable=True,
            )
        )
        with pytest.raises(IntegrityError):
            session.flush()
        session.rollback()
        assert session.scalar(
            select(func.count())
            .select_from(VenueProfileRevision)
            .where(
                VenueProfileRevision.venue_id == venue.id,
                VenueProfileRevision.is_current_editable.is_(True),
            )
        ) == 1


def test_job_lease_blocks_second_claim_and_stale_result_is_discarded(
    pg_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    venue, user = _seed(pg_engine, monkeypatch)
    with Session(pg_engine) as session:
        service = _service(session)
        initial = service.get(venue_id=venue.id, user=user)
        saved = service.save(
            venue_id=venue.id,
            user=user,
            idempotency_key="acceptance-job-lease-000001",
            request=SaveVenueProfileRequest(
                expected_facility_version=initial.facility_version,
                expected_revision_version=initial.revision_version,
                description="等待审核的新场馆介绍",
                facilities=list(initial.current_revision.facilities),
            ),
        )
        revision_id = saved.current_revision.id

    first = _worker(pg_engine)
    claim = first._claim_next()  # noqa: SLF001 - verifies durable lease boundary
    assert claim is not None
    assert _worker(pg_engine)._claim_next() is None  # noqa: SLF001

    with Session(pg_engine) as session:
        revision = session.get_one(VenueProfileRevision, revision_id)
        revision.description_item_version += 1
        session.commit()

    first._apply(  # noqa: SLF001 - simulates a provider result arriving after an edit
        claim,
        ModerationResult(
            ModerationDecisionOutcome.PASS,
            raw_response_sha256="a" * 64,
        ),
    )
    with Session(pg_engine) as session:
        job = session.get_one(ContentModerationJob, claim.job_id)
        revision = session.get_one(VenueProfileRevision, revision_id)
        decision_count = session.scalar(
            select(func.count()).select_from(ContentModerationDecision)
        )
    assert job.status is ModerationJobStatus.COMPLETED
    assert job.claim_token is None and job.lease_until is None
    assert revision.description_status is VenueProfileItemStatus.REVIEWING
    assert decision_count == 0


def test_publication_keeps_old_profile_until_atomic_switch(
    pg_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    venue, user = _seed(pg_engine, monkeypatch)
    with Session(pg_engine) as session:
        service = _service(session)
        initial = service.get(venue_id=venue.id, user=user)
        old_description = initial.published.description
        old_images = [image.url for image in initial.published.images]
        saved = service.save(
            venue_id=venue.id,
            user=user,
            idempotency_key="acceptance-publish-000001",
            request=SaveVenueProfileRequest(
                expected_facility_version=initial.facility_version,
                expected_revision_version=initial.revision_version,
                description="审核通过后一次性发布的新介绍",
                facilities=list(initial.current_revision.facilities),
            ),
        )
        revision = session.get_one(VenueProfileRevision, saved.current_revision.id)
        assert session.get_one(Venue, venue.id).description == old_description
        revision.description_status = VenueProfileItemStatus.APPROVED
        revision.status = VenueProfileRevisionStatus.READY
        session.commit()
        revision_id = revision.id

    factory = _factory(pg_engine)
    assert VenueProfilePublisher(factory, LocalMediaStorage()).publish_if_ready(revision_id)

    with Session(pg_engine) as session:
        published = session.get_one(Venue, venue.id)
        revision = session.get_one(VenueProfileRevision, revision_id)
        image_urls = list(
            session.scalars(
                select(VenueImage.url)
                .where(VenueImage.venue_id == venue.id)
                .order_by(VenueImage.sort_order)
            )
        )
    assert published.description == "审核通过后一次性发布的新介绍"
    assert published.profile_version == 2
    assert image_urls == old_images
    assert revision.status is VenueProfileRevisionStatus.PUBLISHED
    assert revision.is_current_editable is False
