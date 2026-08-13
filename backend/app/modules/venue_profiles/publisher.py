from __future__ import annotations

import logging
import uuid
from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from backend.app.models import (
    FacilityCode,
    ImageRole,
    Venue,
    VenueFacility,
    VenueImage,
    VenueProfileImageDraft,
    VenueProfileItemStatus,
    VenueProfileRevision,
    VenueProfileRevisionStatus,
)

from .dto import FACILITY_LABELS
from .storage import PublishedImage, VenueMediaStore

SessionFactory = Callable[[], AbstractContextManager[Session]]
logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class _PreparedImage:
    draft_id: uuid.UUID
    inherited_id: uuid.UUID | None
    url: str
    role: ImageRole
    sort_order: int
    alt: str
    promoted: PublishedImage | None = None
    temporary_keys: tuple[str, ...] = ()


class VenueProfilePublisher:
    def __init__(self, session_factory: SessionFactory, media_store: VenueMediaStore) -> None:
        self._session_factory = session_factory
        self._media_store = media_store

    def publish_if_ready(self, revision_id: uuid.UUID) -> bool:
        with self._session_factory() as session:
            snapshot = self._load(session, revision_id)
            if snapshot is None:
                return False
            revision, venue, drafts = snapshot
            if revision.status is VenueProfileRevisionStatus.PUBLISHED:
                return venue.profile_version == revision.base_published_version + 1
            if not self._ready(revision, venue, drafts):
                return False
            venue_id = venue.id
            venue_name = venue.name
            prepared: list[_PreparedImage] = []
            for index, draft in enumerate(drafts):
                alt = f"{venue_name}第{index + 1}张图片"
                if draft.published_image_id is not None:
                    inherited = session.get(VenueImage, draft.published_image_id)
                    if inherited is None or inherited.venue_id != venue_id:
                        return False
                    prepared.append(
                        _PreparedImage(
                            draft.id, inherited.id, inherited.url, draft.role,
                            draft.sort_order, inherited.alt,
                        )
                    )
                    continue
                if (
                    draft.original_object_key is None
                    or draft.content_sha256 is None
                    or draft.actual_mime_type is None
                    or draft.byte_size is None
                ):
                    return False
                original = self._media_store.read_bounded(
                    venue_id, draft.id, draft.original_object_key
                )
                if (
                    original.sha256 != draft.content_sha256
                    or original.content_type != draft.actual_mime_type
                    or original.byte_size != draft.byte_size
                ):
                    return False
                published = self._media_store.promote_and_verify(venue_id, draft.id, original)
                prepared.append(
                    _PreparedImage(
                        draft.id, None, published.url, draft.role, draft.sort_order,
                        alt, published,
                        tuple(
                            key
                            for key in (draft.original_object_key, draft.review_object_key)
                            if key
                        ),
                    )
                )

        try:
            with self._session_factory() as session:
                locked_venue = session.scalar(
                    select(Venue).where(Venue.id == venue_id).with_for_update()
                )
                locked_revision = session.scalar(
                    select(VenueProfileRevision)
                    .where(VenueProfileRevision.id == revision_id)
                    .with_for_update()
                )
                if locked_venue is None or locked_revision is None:
                    self._cleanup_promoted(venue_id, prepared)
                    return False
                drafts = list(
                    session.scalars(
                        select(VenueProfileImageDraft)
                        .where(VenueProfileImageDraft.revision_id == revision_id)
                        .order_by(
                            VenueProfileImageDraft.sort_order,
                            VenueProfileImageDraft.id,
                        )
                        .with_for_update()
                    )
                )
                if locked_revision.status is VenueProfileRevisionStatus.PUBLISHED:
                    already_published = (
                        locked_venue.profile_version
                        == locked_revision.base_published_version + 1
                    )
                    if not already_published:
                        self._cleanup_promoted(venue_id, prepared)
                    return already_published
                if not self._ready(locked_revision, locked_venue, drafts):
                    self._cleanup_promoted(venue_id, prepared)
                    return False
                if [item.draft_id for item in prepared] != [draft.id for draft in drafts]:
                    self._cleanup_promoted(venue_id, prepared)
                    return False
                inherited_ids = {
                    item.inherited_id for item in prepared if item.inherited_id is not None
                }
                session.execute(
                    delete(VenueImage).where(
                        VenueImage.venue_id == venue_id,
                        VenueImage.id.not_in(inherited_ids),
                    )
                )
                session.execute(delete(VenueFacility).where(VenueFacility.venue_id == venue_id))
                session.add_all(
                    VenueFacility(
                        venue_id=venue_id,
                        code=FacilityCode(code),
                        name=FACILITY_LABELS[FacilityCode(code).value],
                        sort_order=index,
                    )
                    for index, code in enumerate(locked_revision.target_facilities)
                )
                for item in prepared:
                    if item.inherited_id is not None:
                        public = session.get_one(VenueImage, item.inherited_id)
                        public.role = item.role
                        public.sort_order = item.sort_order
                        public.alt = item.alt
                    else:
                        session.add(
                            VenueImage(
                                venue_id=venue_id, url=item.url, alt=item.alt,
                                role=item.role, sort_order=item.sort_order,
                            )
                        )
                locked_venue.description = locked_revision.target_description
                locked_venue.profile_version += 1
                locked_revision.status = VenueProfileRevisionStatus.PUBLISHED
                locked_revision.published_at = datetime.now(UTC)
                locked_revision.is_current_editable = False
                session.commit()
        except Exception:
            self._cleanup_promoted(venue_id, prepared)
            raise

        for item in prepared:
            if item.promoted is None:
                continue
            if item.temporary_keys:
                try:
                    self._media_store.delete_objects(
                        venue_id, item.draft_id, list(item.temporary_keys)
                    )
                except Exception:
                    logger.warning(
                        "Venue profile temporary media cleanup failed image_id=%s",
                        item.draft_id,
                    )
        return True

    @staticmethod
    def _load(
        session: Session, revision_id: uuid.UUID
    ) -> tuple[VenueProfileRevision, Venue, list[VenueProfileImageDraft]] | None:
        revision = session.get(VenueProfileRevision, revision_id)
        if revision is None:
            return None
        venue = session.get(Venue, revision.venue_id)
        if venue is None:
            return None
        drafts = list(
            session.scalars(
                select(VenueProfileImageDraft)
                .where(VenueProfileImageDraft.revision_id == revision_id)
                .order_by(VenueProfileImageDraft.sort_order, VenueProfileImageDraft.id)
            )
        )
        return revision, venue, drafts

    @staticmethod
    def _ready(
        revision: VenueProfileRevision,
        venue: Venue,
        drafts: list[VenueProfileImageDraft],
    ) -> bool:
        return (
            revision.is_current_editable
            and revision.base_published_version == venue.profile_version
            and revision.description_status is VenueProfileItemStatus.APPROVED
            and 1 <= len(drafts) <= 8
            and all(
                image.moderation_status is VenueProfileItemStatus.APPROVED
                for image in drafts
            )
            and sum(image.role is ImageRole.COVER for image in drafts) == 1
        )

    def _cleanup_promoted(
        self, venue_id: uuid.UUID, prepared: list[_PreparedImage]
    ) -> None:
        for item in prepared:
            if item.promoted is None:
                continue
            try:
                self._media_store.delete_objects(
                    venue_id, item.draft_id, [item.promoted.object_key]
                )
            except Exception:
                logger.warning(
                    "Venue profile promoted media cleanup failed image_id=%s",
                    item.draft_id,
                )
