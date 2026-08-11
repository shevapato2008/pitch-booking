import uuid
from datetime import UTC, datetime

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from backend.app.models import (
    ContentModerationJob,
    FacilityCode,
    ModerationItemType,
    ModerationJobStatus,
    Pitch,
    PitchStatus,
    ProfileMutationIdempotencyRecord,
    ProfileMutationState,
    Slot,
    SlotStatus,
    User,
    Venue,
    VenueFacility,
    VenueImage,
    VenueMembership,
    VenueProfileImageDraft,
    VenueProfileItemStatus,
    VenueProfileRevision,
    VenueProfileRevisionStatus,
)


class VenueProfileRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def get_venue(self, venue_id: uuid.UUID, *, for_update: bool = False) -> Venue | None:
        statement = select(Venue).where(Venue.id == venue_id, Venue.is_active.is_(True))
        if for_update:
            statement = statement.with_for_update()
        return self.session.scalar(statement)

    def can_manage(self, venue_id: uuid.UUID, user_id: uuid.UUID) -> bool:
        return bool(
            self.session.scalar(
                select(VenueMembership.id).where(
                    VenueMembership.venue_id == venue_id,
                    VenueMembership.user_id == user_id,
                    VenueMembership.is_active.is_(True),
                    VenueMembership.can_manage_inventory.is_(True),
                )
            )
        )

    def current_revision(
        self, venue_id: uuid.UUID, *, for_update: bool = False
    ) -> VenueProfileRevision | None:
        statement = select(VenueProfileRevision).where(
            VenueProfileRevision.venue_id == venue_id,
            VenueProfileRevision.is_current_editable.is_(True),
        )
        if for_update:
            statement = statement.with_for_update()
        return self.session.scalar(statement)

    def create_current_revision(self, venue: Venue, user: User) -> VenueProfileRevision:
        last_version = self.session.scalar(
            select(func.max(VenueProfileRevision.revision_version)).where(
                VenueProfileRevision.venue_id == venue.id
            )
        )
        revision = VenueProfileRevision(
            venue_id=venue.id,
            base_published_version=venue.profile_version,
            revision_version=max(venue.profile_version, (last_version or 0) + 1),
            target_description=venue.description,
            status=VenueProfileRevisionStatus.READY,
            description_status=VenueProfileItemStatus.APPROVED,
            created_by_user_id=user.id,
            is_current_editable=True,
        )
        self.session.add(revision)
        self.session.flush()
        for image in self.published_images(venue.id):
            self.session.add(
                VenueProfileImageDraft(
                    revision_id=revision.id,
                    published_image_id=image.id,
                    role=image.role,
                    sort_order=image.sort_order,
                    moderation_status=VenueProfileItemStatus.APPROVED,
                    item_version=1,
                )
            )
        self.session.flush()
        return revision

    def lock_facilities(self, venue_id: uuid.UUID) -> list[VenueFacility]:
        return list(
            self.session.scalars(
                select(VenueFacility)
                .where(VenueFacility.venue_id == venue_id)
                .order_by(VenueFacility.sort_order, VenueFacility.id)
                .with_for_update()
            )
        )

    def facilities(self, venue_id: uuid.UUID) -> list[VenueFacility]:
        return list(
            self.session.scalars(
                select(VenueFacility)
                .where(VenueFacility.venue_id == venue_id)
                .order_by(VenueFacility.sort_order, VenueFacility.id)
            )
        )

    def replace_facilities(
        self, venue_id: uuid.UUID, codes: list[FacilityCode], labels: dict[FacilityCode, str]
    ) -> None:
        self.session.execute(delete(VenueFacility).where(VenueFacility.venue_id == venue_id))
        self.session.add_all(
            [
                VenueFacility(venue_id=venue_id, code=code, name=labels[code], sort_order=index)
                for index, code in enumerate(codes)
            ]
        )
        self.session.flush()

    def published_images(self, venue_id: uuid.UUID) -> list[VenueImage]:
        return list(
            self.session.scalars(
                select(VenueImage)
                .where(VenueImage.venue_id == venue_id)
                .order_by(VenueImage.sort_order, VenueImage.id)
            )
        )

    def draft_images(
        self, revision_id: uuid.UUID, *, for_update: bool = False
    ) -> list[VenueProfileImageDraft]:
        statement = (
            select(VenueProfileImageDraft)
            .where(VenueProfileImageDraft.revision_id == revision_id)
            .order_by(VenueProfileImageDraft.sort_order, VenueProfileImageDraft.id)
        )
        if for_update:
            statement = statement.with_for_update()
        return list(self.session.scalars(statement))

    def get_draft_image(
        self, revision_id: uuid.UUID, image_id: uuid.UUID, *, for_update: bool = False
    ) -> VenueProfileImageDraft | None:
        statement = select(VenueProfileImageDraft).where(
            VenueProfileImageDraft.revision_id == revision_id,
            VenueProfileImageDraft.id == image_id,
        )
        if for_update:
            statement = statement.with_for_update()
        return self.session.scalar(statement)

    def add_image(self, image: VenueProfileImageDraft) -> None:
        self.session.add(image)
        self.session.flush()

    def delete_image(self, image: VenueProfileImageDraft) -> None:
        self.session.delete(image)
        self.session.flush()

    def flush(self) -> None:
        self.session.flush()

    def add_job(
        self,
        revision: VenueProfileRevision,
        item_type: ModerationItemType,
        item_version: int,
        image: VenueProfileImageDraft | None = None,
    ) -> ContentModerationJob:
        job = ContentModerationJob(
            revision_id=revision.id,
            image_draft_id=image.id if image else None,
            item_type=item_type,
            item_version=item_version,
            status=ModerationJobStatus.PENDING,
            attempt_count=0,
            next_run_at=datetime.now(UTC),
        )
        self.session.add(job)
        self.session.flush()
        return job

    def minimum_available_price(self, venue_id: uuid.UUID) -> int | None:
        return self.session.scalar(
            select(func.min(Slot.price_cents))
            .join(Pitch)
            .where(
                Pitch.venue_id == venue_id,
                Pitch.status == PitchStatus.ACTIVE,
                Slot.status == SlotStatus.AVAILABLE,
                Slot.starts_at > datetime.now(UTC),
            )
        )

    def claim_idempotency(
        self,
        *,
        venue_id: uuid.UUID,
        user: User,
        scope: str,
        key: str,
        request_sha256: str,
    ) -> tuple[ProfileMutationIdempotencyRecord, bool]:
        inserted_id = self.session.scalar(
            insert(ProfileMutationIdempotencyRecord)
            .values(
                id=uuid.uuid4(),
                venue_id=venue_id,
                actor_user_id=user.id,
                scope=scope,
                key=key,
                request_sha256=request_sha256,
                state=ProfileMutationState.CLAIMED,
            )
            .on_conflict_do_nothing(constraint="uq_profile_mutations_scope_key")
            .returning(ProfileMutationIdempotencyRecord.id)
        )
        if inserted_id is not None:
            return self.session.get_one(ProfileMutationIdempotencyRecord, inserted_id), True
        record = self.session.scalar(
            select(ProfileMutationIdempotencyRecord)
            .where(
                ProfileMutationIdempotencyRecord.venue_id == venue_id,
                ProfileMutationIdempotencyRecord.actor_user_id == user.id,
                ProfileMutationIdempotencyRecord.scope == scope,
                ProfileMutationIdempotencyRecord.key == key,
            )
            .with_for_update()
        )
        if record is None:
            raise RuntimeError("profile idempotency record disappeared")
        return record, False

    def complete(
        self,
        record: ProfileMutationIdempotencyRecord,
        response_status: int,
        response_body: dict[str, object],
    ) -> None:
        record.state = ProfileMutationState.COMPLETED
        record.response_status = response_status
        record.response_body = response_body
        self.session.flush()

    def commit(self) -> None:
        self.session.commit()

    def rollback(self) -> None:
        self.session.rollback()
