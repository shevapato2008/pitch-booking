import hashlib
import json
import uuid
from collections.abc import Callable
from contextlib import suppress
from typing import Any, NoReturn, cast

from pydantic import BaseModel

from backend.app.errors import AppError
from backend.app.models import (
    BookingMode,
    FacilityCode,
    ImageRole,
    ModerationItemType,
    ProfileMutationIdempotencyRecord,
    ProfileMutationState,
    User,
    Venue,
    VenueProfileImageDraft,
    VenueProfileItemStatus,
    VenueProfileRevision,
    VenueProfileRevisionStatus,
)
from backend.app.modules.venue_profiles.dto import (
    FACILITY_LABELS,
    REASON_LABELS,
    AdminVenueProfileResponse,
    AvailabilityTargetResponse,
    CatalogItem,
    CompleteUploadRequest,
    CreateUploadIntentRequest,
    CurrentRevisionResponse,
    DraftImageResponse,
    LivePriceResponse,
    OrderVenueProfileImagesRequest,
    PublishedFacilityResponse,
    PublishedImageResponse,
    PublishedProfileResponse,
    ReasonCatalogItem,
    SaveVenueProfileRequest,
    UploadIntentResponse,
    VenueProfileRevisionMutationRequest,
    VenueResponse,
)
from backend.app.modules.venue_profiles.repository import VenueProfileRepository
from backend.app.modules.venue_profiles.storage import (
    SUPPORTED_IMAGE_TYPES,
    InvalidMediaError,
    VenueMediaStore,
)


class VenueProfileService:
    def __init__(self, repository: VenueProfileRepository, storage: VenueMediaStore) -> None:
        self.repository = repository
        self.storage = storage

    def get(self, *, venue_id: uuid.UUID, user: User) -> AdminVenueProfileResponse:
        venue = self._authorized_venue(venue_id, user.id)
        revision = self.repository.current_revision(venue.id)
        if revision is None:
            try:
                locked_venue = self.repository.get_venue(venue.id, for_update=True)
                assert locked_venue is not None
                venue = locked_venue
                revision = self.repository.current_revision(locked_venue.id, for_update=True)
                if revision is None:
                    revision = self.repository.create_current_revision(venue, user)
                self.repository.commit()
            except Exception:
                self.repository.rollback()
                raise
        return self._response(venue, revision)

    def save(
        self,
        *,
        venue_id: uuid.UUID,
        user: User,
        request: SaveVenueProfileRequest,
        idempotency_key: str,
    ) -> AdminVenueProfileResponse:
        if len(request.description) > 300:
            self._validation("description", "MAX_300_CODE_POINTS")
        codes = [FacilityCode(code) for code in request.facilities]

        def mutate(venue: Venue, revision: VenueProfileRevision) -> AdminVenueProfileResponse:
            self.repository.lock_facilities(venue.id)
            self._versions(
                venue,
                revision,
                request.expected_facility_version,
                request.expected_revision_version,
            )
            labels = {FacilityCode(code): label for code, label in FACILITY_LABELS.items()}
            self.repository.replace_facilities(venue.id, codes, labels)
            venue.facility_version += 1
            changed = revision.target_description != request.description
            revision.revision_version += 1
            if changed:
                revision.target_description = request.description
                revision.description_status = VenueProfileItemStatus.REVIEWING
                revision.description_reason_code = None
                self.repository.add_description_job(revision)
            self._summary(revision, self.repository.draft_images(revision.id))
            return self._response(venue, revision)

        return self._profile_mutation(
            venue_id, user, "save_profile", idempotency_key, request, 200, mutate
        )

    def create_upload_intent(
        self,
        *,
        venue_id: uuid.UUID,
        user: User,
        request: CreateUploadIntentRequest,
        idempotency_key: str,
    ) -> UploadIntentResponse:
        self._authorized_venue(venue_id, user.id)
        request_hash = self._hash(venue_id, request)
        try:
            record, claimed = self.repository.claim_idempotency(
                venue_id=venue_id,
                user=user,
                scope="create_upload_intent",
                key=idempotency_key,
                request_sha256=request_hash,
            )
            replay = self._replay(record, claimed, request_hash, UploadIntentResponse)
            if replay is not None:
                return replay
            venue, revision = self._locked_current(venue_id)
            self._versions(venue, revision, None, request.expected_revision_version)
            images = self.repository.draft_images(revision.id, for_update=True)
            if len(images) >= 8:
                self._validation("images", "MAX_8_IMAGES")
            image_id = uuid.uuid4()
            intent = self.storage.create_upload_intent(
                venue.id, image_id, request.mime_type, request.byte_size
            )
            image = VenueProfileImageDraft(
                id=image_id,
                revision_id=revision.id,
                original_object_key=intent.object_key,
                role=ImageRole.COVER if not images else ImageRole.GALLERY,
                sort_order=len(images),
                moderation_status=VenueProfileItemStatus.UPLOADING,
                item_version=1,
            )
            self.repository.add_image(image)
            revision.revision_version += 1
            self._summary(revision, [*images, image])
            response = UploadIntentResponse(
                image_id=image_id,
                object_key=intent.object_key,
                signed_put_url=intent.url,
                required_headers=dict(intent.required_headers),
                maximum_bytes=cast(Any, intent.max_bytes),
                accepted_mime_types=cast(Any, SUPPORTED_IMAGE_TYPES),
            )
            self.repository.complete(
                record, 201, cast(dict[str, object], response.model_dump(mode="json"))
            )
            self.repository.commit()
            return response
        except Exception:
            self.repository.rollback()
            raise

    def complete_upload(
        self,
        *,
        venue_id: uuid.UUID,
        image_id: uuid.UUID,
        user: User,
        request: CompleteUploadRequest,
        idempotency_key: str,
    ) -> AdminVenueProfileResponse:
        def mutate(venue: Venue, revision: VenueProfileRevision) -> AdminVenueProfileResponse:
            self._versions(venue, revision, None, request.expected_revision_version)
            image = self.repository.get_draft_image(revision.id, image_id, for_update=True)
            if image is None:
                self._not_found()
            if (
                image.moderation_status is not VenueProfileItemStatus.UPLOADING
                or not image.original_object_key
            ):
                self._validation("image_id", "UPLOAD_NOT_COMPLETABLE")
            try:
                validated = self.storage.read_bounded(venue.id, image.id, image.original_object_key)
                review = self.storage.write_review_copy(venue.id, image.id, validated)
            except (InvalidMediaError, KeyError, ValueError):
                self._validation("image", "INVALID_UPLOADED_IMAGE")
            image.review_object_key = review.object_key
            image.content_sha256 = validated.sha256
            image.actual_mime_type = validated.content_type
            image.byte_size = validated.byte_size
            image.moderation_status = VenueProfileItemStatus.REVIEWING
            image.moderation_reason_code = None
            revision.revision_version += 1
            self.repository.add_job(revision, ModerationItemType.IMAGE, image.item_version, image)
            self._summary(revision, self.repository.draft_images(revision.id))
            return self._response(venue, revision)

        subject = {"image_id": str(image_id), **request.model_dump(mode="json")}
        # fmt: off
        return self._profile_mutation(venue_id, user, "complete_upload", idempotency_key, subject, 202, mutate)  # noqa: E501
        # fmt: on

    def delete(
        self,
        *,
        venue_id: uuid.UUID,
        image_id: uuid.UUID,
        user: User,
        request: VenueProfileRevisionMutationRequest,
        idempotency_key: str,
    ) -> AdminVenueProfileResponse:
        keys_to_delete: list[str] = []

        def mutate(venue: Venue, revision: VenueProfileRevision) -> AdminVenueProfileResponse:
            self._versions(venue, revision, None, request.expected_revision_version)
            images = self.repository.draft_images(revision.id, for_update=True)
            target = next((image for image in images if image.id == image_id), None)
            if target is None:
                self._not_found()
            if target.role is ImageRole.COVER:
                raise AppError(
                    422,
                    "VENUE_PROFILE_VALIDATION_FAILED",
                    "请先设置新的封面图片，再删除当前封面。",
                    {"field": "image_id", "reason": "REPLACEMENT_COVER_REQUIRED"},
                )
            keys_to_delete.extend(
                key for key in (target.original_object_key, target.review_object_key) if key
            )
            remaining = [image for image in images if image.id != image_id]
            self.repository.delete_image(target)
            for index, image in enumerate(remaining):
                image.sort_order = index
            revision.revision_version += 1
            self._summary(revision, remaining)
            return self._response(venue, revision)

        subject = {"image_id": str(image_id), **request.model_dump(mode="json")}
        # fmt: off
        response = self._profile_mutation(venue_id, user, "delete_image", idempotency_key, subject, 200, mutate)  # noqa: E501
        # fmt: on
        if keys_to_delete:
            with suppress(Exception):
                self.storage.delete_objects(venue_id, image_id, keys_to_delete)
        return response

    def reorder(
        self,
        *,
        venue_id: uuid.UUID,
        user: User,
        request: OrderVenueProfileImagesRequest,
        idempotency_key: str,
    ) -> AdminVenueProfileResponse:
        def mutate(venue: Venue, revision: VenueProfileRevision) -> AdminVenueProfileResponse:
            self._versions(venue, revision, None, request.expected_revision_version)
            images = self.repository.draft_images(revision.id, for_update=True)
            if set(request.image_ids) != {image.id for image in images}:
                self._validation("image_ids", "EXACT_CURRENT_IMAGE_SET_REQUIRED")
            by_id = {image.id: image for image in images}
            for index, image in enumerate(images):
                image.sort_order = 100 + index
            self.repository.flush()
            for index, image_id in enumerate(request.image_ids):
                by_id[image_id].sort_order = index
            revision.revision_version += 1
            return self._response(venue, revision)

        return self._profile_mutation(
            venue_id, user, "reorder_images", idempotency_key, request, 200, mutate
        )

    def set_cover(
        self,
        *,
        venue_id: uuid.UUID,
        image_id: uuid.UUID,
        user: User,
        request: VenueProfileRevisionMutationRequest,
        idempotency_key: str,
    ) -> AdminVenueProfileResponse:
        def mutate(venue: Venue, revision: VenueProfileRevision) -> AdminVenueProfileResponse:
            self._versions(venue, revision, None, request.expected_revision_version)
            images = self.repository.draft_images(revision.id, for_update=True)
            if image_id not in {image.id for image in images}:
                self._not_found()
            for image in images:
                image.role = ImageRole.COVER if image.id == image_id else ImageRole.GALLERY
            revision.revision_version += 1
            return self._response(venue, revision)

        subject = {"image_id": str(image_id), **request.model_dump(mode="json")}
        # fmt: off
        return self._profile_mutation(venue_id, user, "set_cover", idempotency_key, subject, 200, mutate)  # noqa: E501
        # fmt: on

    def retry(
        self,
        *,
        venue_id: uuid.UUID,
        item_id: uuid.UUID,
        user: User,
        request: VenueProfileRevisionMutationRequest,
        idempotency_key: str,
    ) -> AdminVenueProfileResponse:
        def mutate(venue: Venue, revision: VenueProfileRevision) -> AdminVenueProfileResponse:
            self._versions(venue, revision, None, request.expected_revision_version)
            if item_id == revision.id:
                if revision.description_status not in {
                    VenueProfileItemStatus.REJECTED,
                    VenueProfileItemStatus.PENDING_MANUAL,
                }:
                    self._validation("item_id", "ITEM_NOT_RETRYABLE")
                revision.revision_version += 1
                revision.description_status = VenueProfileItemStatus.REVIEWING
                revision.description_reason_code = None
                self.repository.add_description_job(revision)
            else:
                image = self.repository.get_draft_image(revision.id, item_id, for_update=True)
                if image is None:
                    self._not_found()
                if image.moderation_status not in {
                    VenueProfileItemStatus.REJECTED,
                    VenueProfileItemStatus.PENDING_MANUAL,
                }:
                    self._validation("item_id", "ITEM_NOT_RETRYABLE")
                image.item_version += 1
                image.moderation_status = VenueProfileItemStatus.REVIEWING
                image.moderation_reason_code = None
                revision.revision_version += 1
                self.repository.add_job(
                    revision, ModerationItemType.IMAGE, image.item_version, image
                )
            self._summary(revision, self.repository.draft_images(revision.id))
            return self._response(venue, revision)

        subject = {"item_id": str(item_id), **request.model_dump(mode="json")}
        # fmt: off
        return self._profile_mutation(venue_id, user, "retry_moderation", idempotency_key, subject, 202, mutate)  # noqa: E501
        # fmt: on

    def _profile_mutation(
        self,
        venue_id: uuid.UUID,
        user: User,
        scope: str,
        key: str,
        request: object,
        status: int,
        mutate: Callable[[Venue, VenueProfileRevision], AdminVenueProfileResponse],
    ) -> AdminVenueProfileResponse:
        self._authorized_venue(venue_id, user.id)
        request_hash = self._hash(venue_id, request)
        try:
            record, claimed = self.repository.claim_idempotency(
                venue_id=venue_id, user=user, scope=scope, key=key, request_sha256=request_hash
            )
            replay = self._replay(record, claimed, request_hash, AdminVenueProfileResponse)
            if replay is not None:
                return replay
            venue, revision = self._locked_current(venue_id)
            response = mutate(venue, revision)
            self.repository.complete(
                record, status, cast(dict[str, object], response.model_dump(mode="json"))
            )
            self.repository.commit()
            return response
        except Exception:
            self.repository.rollback()
            raise

    def _locked_current(self, venue_id: uuid.UUID) -> tuple[Venue, VenueProfileRevision]:
        venue = self.repository.get_venue(venue_id, for_update=True)
        if venue is None:
            self._not_found()
        revision = self.repository.current_revision(venue.id, for_update=True)
        if revision is None:
            self._not_found()
        return venue, revision

    def _response(self, venue: Venue, revision: VenueProfileRevision) -> AdminVenueProfileResponse:
        images = self.repository.draft_images(revision.id)
        published_images = self.repository.published_images(venue.id)
        facilities = self.repository.facilities(venue.id)
        minimum = self.repository.minimum_available_price(venue.id)
        return AdminVenueProfileResponse(
            venue=VenueResponse(id=venue.id, name=venue.name, timezone=cast(Any, venue.timezone)),
            facility_version=venue.facility_version,
            revision_version=revision.revision_version,
            published=PublishedProfileResponse(
                publication_state="PUBLISHED",
                published_version=venue.profile_version,
                description=venue.description,
                cover_image=next(
                    (image.url for image in published_images if image.role is ImageRole.COVER), None
                ),
                images=[
                    PublishedImageResponse(
                        url=image.url,
                        alt=image.alt,
                        role=image.role.value,
                        sort_order=image.sort_order,
                    )
                    for image in published_images
                ],
                facilities=[
                    PublishedFacilityResponse(
                        code=item.code.value, name=item.name, sort_order=item.sort_order
                    )
                    for item in facilities
                ],
                pitch_sizes=cast(Any, venue.public_pitch_types),
                live_price=LivePriceResponse(
                    available=minimum is not None,
                    from_price_cents=minimum,
                    currency="CNY",
                    unit="HOUR",
                ),
                availability_target=AvailabilityTargetResponse(
                    enabled=venue.booking_mode is BookingMode.ONLINE,
                    label="查看可订时段",
                    path=(
                        f"/api/v1/venues/{venue.id}/availability"
                        if venue.booking_mode is BookingMode.ONLINE
                        else None
                    ),
                ),
            ),
            current_revision=CurrentRevisionResponse(
                id=revision.id,
                revision_version=revision.revision_version,
                base_published_version=revision.base_published_version,
                summary_state=revision.status.value,
                description=revision.target_description,
                description_state=revision.description_status.value,
                description_reason_code=(
                    revision.description_reason_code.value
                    if revision.description_reason_code
                    else None
                ),
                facilities=[item.code.value for item in facilities],
                images=[
                    DraftImageResponse(
                        id=image.id,
                        alt=f"{venue.name}第{index + 1}张图片",
                        role=image.role.value,
                        sort_order=index,
                        state=image.moderation_status.value,
                        reason_code=(
                            image.moderation_reason_code.value
                            if image.moderation_reason_code
                            else None
                        ),
                        item_version=image.item_version,
                    )
                    for index, image in enumerate(images)
                ],
                updated_at=revision.updated_at,
            ),
            facility_catalog=[
                CatalogItem(code=code, label=label) for code, label in FACILITY_LABELS.items()
            ],
            rejection_reason_catalog=[
                ReasonCatalogItem(code=code, label=label) for code, label in REASON_LABELS.items()
            ],
        )

    def _authorized_venue(self, venue_id: uuid.UUID, user_id: uuid.UUID) -> Venue:
        venue = self.repository.get_venue(venue_id)
        if venue is None:
            self._not_found()
        if not self.repository.can_manage(venue_id, user_id):
            raise AppError(403, "VENUE_PROFILE_FORBIDDEN", "无权管理该场馆资料")
        if venue.timezone != "Asia/Shanghai":
            raise AppError(500, "INTERNAL_ERROR", "服务内部错误")
        return venue

    @staticmethod
    def _versions(
        venue: Venue, revision: VenueProfileRevision, facility: int | None, current: int
    ) -> None:
        if current != revision.revision_version or (
            facility is not None and facility != venue.facility_version
        ):
            raise AppError(
                409,
                "VENUE_PROFILE_VERSION_CONFLICT",
                "场馆资料已更新，请重新载入后再提交。",
                {
                    "current_facility_version": venue.facility_version,
                    "current_revision_version": revision.revision_version,
                },
            )

    @staticmethod
    def _summary(revision: VenueProfileRevision, images: list[VenueProfileImageDraft]) -> None:
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

    @staticmethod
    def _hash(venue_id: uuid.UUID, request: object) -> str:
        body = request.model_dump(mode="json") if hasattr(request, "model_dump") else request
        canonical = json.dumps(
            {"venue_id": str(venue_id), "body": body},
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        return hashlib.sha256(canonical.encode()).hexdigest()

    @staticmethod
    def _replay[ResponseModel: BaseModel](
        record: ProfileMutationIdempotencyRecord,
        claimed: bool,
        request_hash: str,
        model: type[ResponseModel],
    ) -> ResponseModel | None:
        if claimed:
            return None
        if record.request_sha256 != request_hash:
            raise AppError(409, "IDEMPOTENCY_KEY_REUSED", "幂等键已用于其他请求")
        if record.state is not ProfileMutationState.COMPLETED or record.response_body is None:
            raise AppError(409, "REQUEST_IN_PROGRESS", "请求正在处理中")
        return model.model_validate(record.response_body)

    @staticmethod
    def _validation(field: str, reason: str) -> NoReturn:
        raise AppError(
            422,
            "VENUE_PROFILE_VALIDATION_FAILED",
            "场馆资料未通过输入校验。",
            {"field": field, "reason": reason},
        )

    @staticmethod
    def _not_found() -> NoReturn:
        raise AppError(404, "VENUE_PROFILE_NOT_FOUND", "场馆资料不存在")
