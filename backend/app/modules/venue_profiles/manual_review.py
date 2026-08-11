from __future__ import annotations

import uuid
from collections.abc import Collection
from datetime import UTC, datetime
from typing import NoReturn
from urllib.parse import urlsplit

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from backend.app.errors import AppError
from backend.app.models import (
    ContentModerationDecision,
    ContentModerationJob,
    ModerationDecisionOutcome,
    ModerationDecisionSource,
    ModerationItemType,
    ModerationJobStatus,
    ModerationReasonCode,
    User,
    Venue,
    VenueProfileImageDraft,
    VenueProfileItemStatus,
    VenueProfileRevision,
    VenueProfileRevisionStatus,
)

from .dto import (
    ManualModerationDecisionRequest,
    ManualReviewItemResponse,
    ManualReviewQueueResponse,
)
from .publisher import VenueProfilePublisher
from .storage import VenueMediaStore


class ManualVenueProfileReviewService:
    def __init__(
        self,
        *,
        session: Session,
        media_store: VenueMediaStore,
        publisher: VenueProfilePublisher,
        reviewer_ids: Collection[uuid.UUID],
    ) -> None:
        self._session = session
        self._media_store = media_store
        self._publisher = publisher
        self._reviewer_ids = frozenset(reviewer_ids)

    def pending(
        self, *, user: User, cursor: str | None, limit: int
    ) -> ManualReviewQueueResponse:
        self._authorize(user)
        if cursor is not None:
            try:
                cursor_id = uuid.UUID(cursor)
            except ValueError:
                raise AppError(
                    422, "INVALID_ARGUMENT", "请求参数格式不正确，请检查后重试。"
                ) from None
        else:
            cursor_id = None
        jobs = list(
            self._session.scalars(
                select(ContentModerationJob)
                .where(ContentModerationJob.status == ModerationJobStatus.FAILED)
                .order_by(ContentModerationJob.updated_at, ContentModerationJob.id)
            )
        )
        items: list[ManualReviewItemResponse] = []
        seen: set[uuid.UUID] = set()
        started = cursor_id is None
        for job in jobs:
            revision = self._session.get(VenueProfileRevision, job.revision_id)
            if revision is None or not revision.is_current_editable:
                continue
            image = (
                self._session.get(VenueProfileImageDraft, job.image_draft_id)
                if job.image_draft_id is not None
                else None
            )
            item_id = (
                revision.id
                if job.item_type is ModerationItemType.DESCRIPTION
                else job.image_draft_id
            )
            if item_id is None or item_id in seen:
                continue
            current = (
                job.item_version == revision.description_item_version
                and revision.description_status is VenueProfileItemStatus.PENDING_MANUAL
                if job.item_type is ModerationItemType.DESCRIPTION
                else image is not None
                and job.item_version == image.item_version
                and image.moderation_status is VenueProfileItemStatus.PENDING_MANUAL
            )
            if not current:
                continue
            if not started:
                started = item_id == cursor_id
                continue
            venue = self._session.get(Venue, revision.venue_id)
            if venue is None:
                continue
            review_url: str | None = None
            if image is not None:
                if image.review_object_key is None:
                    continue
                review_url = self._media_store.signed_review_url(
                    venue.id, image.id, image.review_object_key
                )
                if urlsplit(review_url).scheme != "https":
                    raise AppError(500, "INTERNAL_ERROR", "服务内部错误")
            seen.add(item_id)
            items.append(
                ManualReviewItemResponse(
                    item_id=item_id, venue_id=venue.id, venue_name=venue.name,
                    revision_id=revision.id, revision_version=revision.revision_version,
                    item_version=job.item_version, item_type=job.item_type.value,
                    review_image_url=review_url, submitted_at=job.updated_at,
                )
            )
            if len(items) > limit:
                break
        next_cursor = str(items[limit - 1].item_id) if len(items) > limit else None
        return ManualReviewQueueResponse(items=items[:limit], next_cursor=next_cursor)

    def decide(
        self,
        *,
        item_id: uuid.UUID,
        user: User,
        request: ManualModerationDecisionRequest,
        idempotency_key: str,
    ) -> None:
        self._authorize(user)
        outcome, reason = self._choice(request.decision)
        replay = self._session.scalar(
            select(ContentModerationDecision)
            .join(ContentModerationJob)
            .where(
                ContentModerationDecision.idempotency_key == idempotency_key,
                or_(
                    (ContentModerationJob.item_type == ModerationItemType.DESCRIPTION)
                    & (ContentModerationJob.revision_id == item_id),
                    ContentModerationJob.image_draft_id == item_id,
                ),
            )
        )
        if replay is not None:
            if (
                replay.item_version != request.expected_item_version
                or replay.outcome is not outcome
                or replay.reason_code is not reason
                or replay.reviewer_user_id != user.id
            ):
                raise AppError(409, "IDEMPOTENCY_KEY_REUSED", "幂等键已用于其他请求")
            return

        revision = self._session.scalar(
            select(VenueProfileRevision)
            .where(
                VenueProfileRevision.id == item_id,
                VenueProfileRevision.is_current_editable.is_(True),
            )
            .with_for_update()
        )
        image: VenueProfileImageDraft | None = None
        item_type = ModerationItemType.DESCRIPTION
        if revision is None:
            image = self._session.scalar(
                select(VenueProfileImageDraft)
                .where(VenueProfileImageDraft.id == item_id)
                .with_for_update()
            )
            if image is None:
                self._not_found()
            revision = self._session.scalar(
                select(VenueProfileRevision)
                .where(
                    VenueProfileRevision.id == image.revision_id,
                    VenueProfileRevision.is_current_editable.is_(True),
                )
                .with_for_update()
            )
            if revision is None:
                self._not_found()
            item_type = ModerationItemType.IMAGE
        current_version = (
            revision.description_item_version if image is None else image.item_version
        )
        if request.expected_item_version != current_version:
            raise AppError(
                409, "VENUE_PROFILE_VERSION_CONFLICT", "场馆资料已更新，请重新载入后再提交。",
                {"current_item_version": current_version},
            )
        state = revision.description_status if image is None else image.moderation_status
        if state is not VenueProfileItemStatus.PENDING_MANUAL:
            raise AppError(
                422, "VENUE_PROFILE_VALIDATION_FAILED", "场馆资料未通过输入校验。",
                {"field": "item_id", "reason": "ITEM_NOT_PENDING_MANUAL"},
            )
        job = self._session.scalar(
            select(ContentModerationJob)
            .where(
                ContentModerationJob.revision_id == revision.id,
                ContentModerationJob.image_draft_id == (image.id if image else None),
                ContentModerationJob.item_type == item_type,
                ContentModerationJob.item_version == current_version,
                ContentModerationJob.status == ModerationJobStatus.FAILED,
            )
            .order_by(ContentModerationJob.updated_at.desc())
            .with_for_update()
            .limit(1)
        )
        if job is None:
            self._not_found()
        now = datetime.now(UTC)
        self._session.add(
            ContentModerationDecision(
                job_id=job.id, item_type=item_type, item_version=current_version,
                source=ModerationDecisionSource.MANUAL, outcome=outcome,
                reason_code=reason, reviewer_user_id=user.id,
                idempotency_key=idempotency_key, decided_at=now,
            )
        )
        status = (
            VenueProfileItemStatus.APPROVED
            if outcome is ModerationDecisionOutcome.PASS
            else VenueProfileItemStatus.REJECTED
        )
        if image is None:
            revision.description_status = status
            revision.description_reason_code = reason
        else:
            image.moderation_status = status
            image.moderation_reason_code = reason
        job.fixed_reason_code = reason
        self._summarize(revision)
        publish = revision.status is VenueProfileRevisionStatus.READY
        self._session.commit()
        if publish:
            self._publisher.publish_if_ready(revision.id)

    def _summarize(self, revision: VenueProfileRevision) -> None:
        images = list(
            self._session.scalars(
                select(VenueProfileImageDraft).where(
                    VenueProfileImageDraft.revision_id == revision.id
                )
            )
        )
        states = [revision.description_status, *(item.moderation_status for item in images)]
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

    def _authorize(self, user: User) -> None:
        if user.id not in self._reviewer_ids:
            raise AppError(403, "MANUAL_MODERATION_FORBIDDEN", "无权访问人工审核队列")

    @staticmethod
    def _choice(value: str) -> tuple[ModerationDecisionOutcome, ModerationReasonCode | None]:
        if value == "PASS":
            return ModerationDecisionOutcome.PASS, None
        return ModerationDecisionOutcome.REJECT, ModerationReasonCode(value)

    @staticmethod
    def _not_found() -> NoReturn:
        raise AppError(404, "VENUE_PROFILE_NOT_FOUND", "场馆资料不存在")
