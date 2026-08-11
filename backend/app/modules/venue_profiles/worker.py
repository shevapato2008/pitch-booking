from __future__ import annotations

import logging
import uuid
from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from backend.app.models import (
    ContentModerationDecision,
    ContentModerationJob,
    ModerationDecisionOutcome,
    ModerationDecisionSource,
    ModerationItemType,
    ModerationJobStatus,
    ModerationReasonCode,
    VenueProfileImageDraft,
    VenueProfileItemStatus,
    VenueProfileRevision,
    VenueProfileRevisionStatus,
)

from .moderation import (
    ContentModerationProvider,
    ModerationRequest,
    ModerationResult,
    uncertain_failure,
)
from .publisher import VenueProfilePublisher
from .storage import VenueMediaStore

MAX_ATTEMPTS = 3
CLAIM_LEASE = timedelta(minutes=2)
BACKOFF_SECONDS = (30, 120)
DEFAULT_BATCH_SIZE = 20
SessionFactory = Callable[[], AbstractContextManager[Session]]
logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ModerationClaim:
    job_id: uuid.UUID
    claim_token: uuid.UUID


class VenueProfileModerationWorker:
    def __init__(
        self,
        *,
        session_factory: SessionFactory,
        provider: ContentModerationProvider,
        media_store: VenueMediaStore,
        publisher: VenueProfilePublisher,
        clock: Callable[[], datetime] | None = None,
        batch_size: int = DEFAULT_BATCH_SIZE,
    ) -> None:
        if not 1 <= batch_size <= 100:
            raise ValueError("moderation batch size must be between 1 and 100")
        self._session_factory = session_factory
        self._provider = provider
        self._media_store = media_store
        self._publisher = publisher
        self._clock = clock or (lambda: datetime.now(UTC))
        self._batch_size = batch_size

    def run_once(self) -> int:
        processed = 0
        for _ in range(self._batch_size):
            claim = self._claim_next()
            if claim is None:
                break
            processed += 1
            self._process(claim)
        return processed

    def _claim_next(self) -> ModerationClaim | None:
        now = self._clock()
        with self._session_factory() as session:
            job = session.scalar(
                select(ContentModerationJob)
                .where(
                    ContentModerationJob.next_run_at <= now,
                    or_(
                        ContentModerationJob.status == ModerationJobStatus.PENDING,
                        (
                            (ContentModerationJob.status == ModerationJobStatus.CLAIMED)
                            & (ContentModerationJob.lease_until <= now)
                        ),
                    ),
                )
                .order_by(ContentModerationJob.next_run_at, ContentModerationJob.id)
                .with_for_update(skip_locked=True)
                .limit(1)
            )
            if job is None:
                return None
            token = uuid.uuid4()
            job.status = ModerationJobStatus.CLAIMED
            job.claim_token = token
            job.lease_until = now + CLAIM_LEASE
            job.attempt_count += 1
            session.commit()
            return ModerationClaim(job.id, token)

    def _process(self, claim: ModerationClaim) -> None:
        with self._session_factory() as session:
            job = session.get(ContentModerationJob, claim.job_id)
            if job is None or job.claim_token != claim.claim_token:
                return
            revision = session.get(VenueProfileRevision, job.revision_id)
            image = (
                session.get(VenueProfileImageDraft, job.image_draft_id)
                if job.image_draft_id is not None
                else None
            )
            if not self._current(job, revision, image):
                self._finish_stale(session, job)
                session.commit()
                return
            reused = self._reused_result(session, job)
            if reused is not None:
                request = None
            elif job.item_type is ModerationItemType.DESCRIPTION:
                assert revision is not None
                request = ModerationRequest(job.item_type, text=revision.target_description)
            else:
                assert revision is not None and image is not None
                if image.review_object_key is None:
                    request = None
                else:
                    review_url = self._media_store.signed_review_url(
                        revision.venue_id, image.id, image.review_object_key
                    )
                    request = ModerationRequest(job.item_type, image_url=review_url)

        if reused is not None:
            result = reused
        elif request is None:
            result = uncertain_failure()
        else:
            try:
                result = self._provider.moderate(request)
            except Exception:
                logger.warning("Venue profile moderation provider failed job_id=%s", claim.job_id)
                result = uncertain_failure()
        self._apply(claim, result)

    def _apply(self, claim: ModerationClaim, result: ModerationResult) -> None:
        publish_revision_id: uuid.UUID | None = None
        now = self._clock()
        with self._session_factory() as session:
            job = session.scalar(
                select(ContentModerationJob)
                .where(
                    ContentModerationJob.id == claim.job_id,
                    ContentModerationJob.status == ModerationJobStatus.CLAIMED,
                    ContentModerationJob.claim_token == claim.claim_token,
                )
                .with_for_update()
            )
            if job is None:
                return
            revision = session.scalar(
                select(VenueProfileRevision)
                .where(VenueProfileRevision.id == job.revision_id)
                .with_for_update()
            )
            image = (
                session.scalar(
                    select(VenueProfileImageDraft)
                    .where(VenueProfileImageDraft.id == job.image_draft_id)
                    .with_for_update()
                )
                if job.image_draft_id is not None
                else None
            )
            if not self._current(job, revision, image):
                self._finish_stale(session, job)
                session.commit()
                return
            if result.outcome is ModerationDecisionOutcome.REJECT and result.reason_code is None:
                result = uncertain_failure()
            self._record_decision(session, job, result, now, claim.claim_token)
            if result.outcome is ModerationDecisionOutcome.UNCERTAIN:
                if job.attempt_count < MAX_ATTEMPTS:
                    delay = BACKOFF_SECONDS[min(job.attempt_count - 1, len(BACKOFF_SECONDS) - 1)]
                    job.status = ModerationJobStatus.PENDING
                    job.next_run_at = now + timedelta(seconds=delay)
                else:
                    job.status = ModerationJobStatus.FAILED
                    self._set_item(job, revision, image, VenueProfileItemStatus.PENDING_MANUAL)
                job.claim_token = None
                job.lease_until = None
                self._summarize(revision, self._images(session, job.revision_id))
                session.commit()
                return
            job.status = ModerationJobStatus.COMPLETED
            job.fixed_reason_code = result.reason_code
            job.completed_at = now
            job.claim_token = None
            job.lease_until = None
            item_status = (
                VenueProfileItemStatus.APPROVED
                if result.outcome is ModerationDecisionOutcome.PASS
                else VenueProfileItemStatus.REJECTED
            )
            self._set_item(job, revision, image, item_status, result.reason_code)
            self._summarize(revision, self._images(session, job.revision_id))
            if revision is not None and revision.status is VenueProfileRevisionStatus.READY:
                publish_revision_id = revision.id
            session.commit()
        if publish_revision_id is not None:
            try:
                self._publisher.publish_if_ready(publish_revision_id)
            except Exception:
                logger.exception(
                    "Venue profile publication failed revision_id=%s", publish_revision_id
                )

    def _reused_result(
        self, session: Session, job: ContentModerationJob
    ) -> ModerationResult | None:
        decision = session.scalar(
            select(ContentModerationDecision)
            .join(ContentModerationJob, ContentModerationDecision.job_id == ContentModerationJob.id)
            .where(
                ContentModerationJob.id != job.id,
                ContentModerationJob.content_sha256 == job.content_sha256,
                ContentModerationJob.policy_version == job.policy_version,
                ContentModerationDecision.provider == self._provider.provider_name,
                ContentModerationDecision.provider_model == self._provider.model_name,
                ContentModerationDecision.outcome.in_(
                    [ModerationDecisionOutcome.PASS, ModerationDecisionOutcome.REJECT]
                ),
            )
            .order_by(ContentModerationDecision.decided_at.desc())
            .limit(1)
        )
        if decision is None:
            return None
        return ModerationResult(
            decision.outcome,
            reason_code=decision.reason_code,
            confidence=decision.provider_confidence,
            request_id=decision.provider_request_id,
            raw_response_sha256=decision.raw_response_sha256,
        )

    def _record_decision(
        self,
        session: Session,
        job: ContentModerationJob,
        result: ModerationResult,
        now: datetime,
        token: uuid.UUID,
    ) -> None:
        session.add(
            ContentModerationDecision(
                job_id=job.id, item_type=job.item_type, item_version=job.item_version,
                source=ModerationDecisionSource.PROVIDER, outcome=result.outcome,
                reason_code=result.reason_code, provider=self._provider.provider_name,
                provider_model=self._provider.model_name,
                provider_request_id=result.request_id, provider_confidence=result.confidence,
                raw_response_sha256=result.raw_response_sha256,
                idempotency_key=f"provider:{token}", decided_at=now,
            )
        )

    @staticmethod
    def _current(
        job: ContentModerationJob,
        revision: VenueProfileRevision | None,
        image: VenueProfileImageDraft | None,
    ) -> bool:
        if revision is None or not revision.is_current_editable:
            return False
        if job.item_type is ModerationItemType.DESCRIPTION:
            return job.item_version == revision.description_item_version
        return (
            image is not None
            and image.revision_id == revision.id
            and image.item_version == job.item_version
        )

    @staticmethod
    def _finish_stale(session: Session, job: ContentModerationJob) -> None:
        job.status = ModerationJobStatus.COMPLETED
        job.completed_at = datetime.now(UTC)
        job.claim_token = None
        job.lease_until = None
        session.flush()

    @staticmethod
    def _set_item(
        job: ContentModerationJob,
        revision: VenueProfileRevision | None,
        image: VenueProfileImageDraft | None,
        status: VenueProfileItemStatus,
        reason: ModerationReasonCode | None = None,
    ) -> None:
        assert revision is not None
        if job.item_type is ModerationItemType.DESCRIPTION:
            revision.description_status = status
            revision.description_reason_code = reason
        else:
            assert image is not None
            image.moderation_status = status
            image.moderation_reason_code = reason

    @staticmethod
    def _images(session: Session, revision_id: uuid.UUID) -> list[VenueProfileImageDraft]:
        return list(
            session.scalars(
                select(VenueProfileImageDraft).where(
                    VenueProfileImageDraft.revision_id == revision_id
                )
            )
        )

    @staticmethod
    def _summarize(
        revision: VenueProfileRevision | None, images: list[VenueProfileImageDraft]
    ) -> None:
        assert revision is not None
        states = [revision.description_status, *(image.moderation_status for image in images)]
        if VenueProfileItemStatus.PENDING_MANUAL in states:
            revision.status = VenueProfileRevisionStatus.PENDING_MANUAL
        elif VenueProfileItemStatus.REJECTED in states:
            revision.status = VenueProfileRevisionStatus.REJECTED
        elif any(
            state in {VenueProfileItemStatus.REVIEWING, VenueProfileItemStatus.UPLOADING}
            for state in states
        ):
            revision.status = VenueProfileRevisionStatus.REVIEWING
        else:
            revision.status = VenueProfileRevisionStatus.READY
