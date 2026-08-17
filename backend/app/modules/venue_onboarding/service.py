from __future__ import annotations

import base64
import hashlib
import json
import math
import unicodedata
import uuid
from datetime import UTC, datetime
from typing import Any, cast

from sqlalchemy.exc import IntegrityError

from backend.app.errors import AppError
from backend.app.models import (
    IdempotencyRecord,
    IdempotencyState,
    User,
    Venue,
    VenueOnboardingApplication,
    VenueOnboardingEvidence,
    VenueOnboardingEvidenceKind,
    VenueOnboardingEvidenceState,
    VenueOnboardingKind,
    VenueOnboardingStatus,
)
from backend.app.modules.venue_onboarding.dto import (
    CreateVenueOnboardingUploadIntent,
    MutationResult,
    SubmitVenueClaim,
    SubmitVenueCreate,
    VenueOnboardingApplicantApplication,
    VenueOnboardingApplicationResponse,
    VenueOnboardingApplications,
    VenueOnboardingApplicationVenue,
    VenueOnboardingCandidate,
    VenueOnboardingCandidates,
    VenueOnboardingEvidenceClosed,
    VenueOnboardingEvidenceConstraints,
    VenueOnboardingPostPolicy,
    VenueOnboardingUploadIntent,
)
from backend.app.modules.venue_onboarding.repository import VenueOnboardingRepository
from backend.app.modules.venue_onboarding.storage import (
    InvalidEvidenceError,
    PrivateObjectStateError,
    VenueOnboardingStore,
    evidence_constraints,
    validate_evidence_object,
)
from backend.app.security.phone_vault import PhoneVault, SealedPhone

_CLAIM_EVIDENCE = {
    "MANAGEMENT_AUTHORIZATION": VenueOnboardingEvidenceKind.MANAGEMENT_AUTHORIZATION,
    "VENUE_EXTERIOR": VenueOnboardingEvidenceKind.VENUE_EXTERIOR,
}
_CREATE_EVIDENCE = {
    "BUSINESS_LICENSE": VenueOnboardingEvidenceKind.BUSINESS_LICENSE,
    "MANAGEMENT_AUTHORIZATION": VenueOnboardingEvidenceKind.MANAGEMENT_AUTHORIZATION,
    "VENUE_EXTERIOR": VenueOnboardingEvidenceKind.VENUE_EXTERIOR,
    "VENUE_INTERIOR": VenueOnboardingEvidenceKind.VENUE_INTERIOR,
}


class VenueOnboardingService:
    def __init__(
        self,
        *,
        repository: VenueOnboardingRepository,
        storage: VenueOnboardingStore,
        phone_vault: PhoneVault | None,
    ) -> None:
        self.repository = repository
        self.storage = storage
        self.phone_vault = phone_vault

    def search_candidates(
        self,
        *,
        query: str,
        cursor: str | None,
        limit: int,
    ) -> VenueOnboardingCandidates:
        normalized_query = normalize_identity(query)
        if len(normalized_query) < 2:
            raise _invalid_argument()
        after = _decode_candidate_cursor(cursor) if cursor else None
        venues = [
            venue
            for venue in self.repository.list_candidates()
            if any(
                normalized_query in normalize_identity(value)
                for value in (venue.name, venue.address, venue.district_name)
            )
        ]
        venues.sort(key=lambda venue: (normalize_identity(venue.name), venue.id))
        if after is not None:
            venues = [
                venue
                for venue in venues
                if (normalize_identity(venue.name), venue.id) > after
            ]
        venues = venues[: limit + 1]
        visible = venues[:limit]
        next_cursor = None
        if len(venues) > limit:
            last = visible[-1]
            next_cursor = _encode_cursor([normalize_identity(last.name), str(last.id)])
        return VenueOnboardingCandidates(
            items=[_candidate(venue) for venue in visible],
            next_cursor=next_cursor,
        )

    def create_upload_intent(
        self,
        *,
        user: User,
        idempotency_key: str,
        request: CreateVenueOnboardingUploadIntent,
    ) -> MutationResult:
        request_hash = _request_hash(request.model_dump(mode="json"))
        try:
            record, claimed = self.repository.claim_idempotency(
                user_id=user.id,
                operation="venue_onboarding_upload_intent",
                key=idempotency_key,
                request_sha256=request_hash,
            )
            replay = self._replay(record, claimed, request_hash)
            if replay is not None:
                self.repository.commit()
                return replay

            evidence_id = uuid.uuid4()
            constraints = evidence_constraints(request.kind)
            policy = self.storage.create_upload_policy(
                user.id,
                evidence_id,
                constraints.maximum_bytes,
            )
            expected_prefix = f"venue-onboarding/{user.id}/{evidence_id}/"
            if policy.object_prefix != expected_prefix:
                raise RuntimeError("onboarding storage returned an unsafe object prefix")
            evidence = VenueOnboardingEvidence(
                id=evidence_id,
                owner_user_id=user.id,
                application_id=None,
                kind=request.kind,
                state=VenueOnboardingEvidenceState.UPLOADING,
                object_key=policy.object_prefix,
                content_type="application/octet-stream",
                byte_size=None,
                content_sha256=None,
            )
            self.repository.add_evidence(evidence)
            response = VenueOnboardingUploadIntent(
                evidence_id=evidence.id,
                post_policy=VenueOnboardingPostPolicy(
                    url=policy.url,
                    fields=policy.fields,
                    expires_at=policy.expires_at,
                ),
                constraints=VenueOnboardingEvidenceConstraints(
                    kind=request.kind,
                    accepted_mime_types=list(constraints.accepted_mime_types),
                    maximum_bytes=constraints.maximum_bytes,
                ),
            )
            return self._complete(record, 201, response)
        except Exception:
            self.repository.rollback()
            raise

    def complete_evidence(
        self,
        *,
        user: User,
        evidence_id: uuid.UUID,
        idempotency_key: str,
    ) -> MutationResult:
        request_hash = _request_hash({"evidence_id": str(evidence_id)})
        try:
            record, claimed = self.repository.claim_idempotency(
                user_id=user.id,
                operation="venue_onboarding_complete_evidence",
                key=idempotency_key,
                request_sha256=request_hash,
            )
            replay = self._replay(record, claimed, request_hash)
            if replay is not None:
                self.repository.commit()
                return replay
            evidence = self.repository.get_owned_evidence_for_update(
                evidence_id=evidence_id,
                owner_user_id=user.id,
            )
            if evidence is None:
                raise AppError(
                    404,
                    "ONBOARDING_APPLICATION_NOT_FOUND",
                    "未找到待完成的申请材料。",
                )
            if evidence.state is not VenueOnboardingEvidenceState.UPLOADING:
                raise _state_changed()
            prefix = evidence.object_key
            constraints = evidence_constraints(evidence.kind)
            try:
                private_object = self.storage.read_private_object(
                    prefix,
                    constraints.maximum_bytes,
                )
                if (
                    not private_object.object_key.startswith(prefix)
                    or private_object.object_key == prefix
                    or "/" in private_object.object_key.removeprefix(prefix)
                ):
                    raise InvalidEvidenceError("object crossed its evidence prefix")
                validated = validate_evidence_object(
                    evidence.kind,
                    private_object.object_key,
                    private_object.data,
                )
            except (
                InvalidEvidenceError,
                PrivateObjectStateError,
                KeyError,
                ValueError,
            ):
                raise AppError(
                    422,
                    "ONBOARDING_EVIDENCE_INVALID",
                    "申请材料无效，请重新上传。",
                ) from None
            evidence.object_key = validated.object_key
            evidence.content_type = validated.content_type
            evidence.byte_size = validated.byte_size
            evidence.content_sha256 = validated.sha256
            evidence.state = VenueOnboardingEvidenceState.COMPLETED
            response = VenueOnboardingEvidenceClosed(evidence_id=evidence.id)
            return self._complete(record, 200, response)
        except Exception:
            self.repository.rollback()
            raise

    def submit_claim(
        self,
        *,
        user: User,
        idempotency_key: str,
        request: SubmitVenueClaim,
    ) -> MutationResult:
        request_hash = _request_hash(request.model_dump(mode="json"))
        try:
            record, claimed = self.repository.claim_idempotency(
                user_id=user.id,
                operation="venue_onboarding_submit_claim",
                key=idempotency_key,
                request_sha256=request_hash,
            )
            replay = self._replay(record, claimed, request_hash)
            if replay is not None:
                self.repository.commit()
                return replay
            venue = self.repository.get_public_candidate(request.venue_id, for_update=True)
            if venue is None:
                raise _state_changed()
            if self.repository.find_submitted_claim(
                applicant_user_id=user.id,
                venue_id=venue.id,
            ) is not None:
                raise _application_exists()
            application_id = uuid.uuid4()
            sealed = self._snapshot_phone(user, application_id)
            evidence = self._validated_submission_evidence(
                user.id,
                request.evidence.model_dump(),
                _CLAIM_EVIDENCE,
            )
            now = datetime.now(UTC)
            application = VenueOnboardingApplication(
                id=application_id,
                applicant_user_id=user.id,
                kind=VenueOnboardingKind.CLAIM,
                target_venue_id=venue.id,
                proposed_name=None,
                proposed_address=None,
                proposed_district_code=None,
                proposed_district_name=None,
                proposed_latitude=None,
                proposed_longitude=None,
                normalized_proposed_name=None,
                normalized_proposed_address=None,
                contact_phone_ciphertext=sealed.ciphertext_with_tag,
                contact_phone_nonce=sealed.nonce,
                contact_phone_key_version=sealed.key_version,
                contact_name=_required_display(request.contact_name),
                status=VenueOnboardingStatus.SUBMITTED,
                submitted_at=now,
            )
            self.repository.add_application(application)
            for item in evidence:
                item.application_id = application.id
            response = _application_response(application, venue)
            return self._complete(record, 201, response)
        except Exception:
            self.repository.rollback()
            raise

    def submit_create(
        self,
        *,
        user: User,
        idempotency_key: str,
        request: SubmitVenueCreate,
    ) -> MutationResult:
        request_hash = _request_hash(request.model_dump(mode="json"))
        try:
            record, claimed = self.repository.claim_idempotency(
                user_id=user.id,
                operation="venue_onboarding_submit_create",
                key=idempotency_key,
                request_sha256=request_hash,
            )
            replay = self._replay(record, claimed, request_hash)
            if replay is not None:
                self.repository.commit()
                return replay
            name = _required_display(request.name)
            address = _required_display(request.address)
            district_name = _required_display(request.district_name)
            normalized_name = normalize_identity(name)
            normalized_address = normalize_identity(address)
            duplicate = next(
                (
                    venue
                    for venue in self.repository.active_venues()
                    if normalize_identity(venue.address) == normalized_address
                    or _distance_meters(
                        request.latitude,
                        request.longitude,
                        venue.latitude,
                        venue.longitude,
                    )
                    <= 300
                ),
                None,
            )
            if duplicate is not None:
                details: dict[str, object] = {}
                if duplicate.is_listed:
                    details["claim_candidate"] = _candidate(duplicate).model_dump(
                        mode="json"
                    )
                raise AppError(
                    409,
                    "POSSIBLE_DUPLICATE_VENUE",
                    "可能已存在该场馆。",
                    details,
                )
            if self.repository.find_submitted_create(
                applicant_user_id=user.id,
                normalized_name=normalized_name,
                normalized_address=normalized_address,
            ) is not None:
                raise _application_exists()
            application_id = uuid.uuid4()
            sealed = self._snapshot_phone(user, application_id)
            evidence = self._validated_submission_evidence(
                user.id,
                request.evidence.model_dump(),
                _CREATE_EVIDENCE,
            )
            now = datetime.now(UTC)
            application = VenueOnboardingApplication(
                id=application_id,
                applicant_user_id=user.id,
                kind=VenueOnboardingKind.CREATE,
                target_venue_id=None,
                proposed_name=name,
                proposed_address=address,
                proposed_district_code=request.district_code,
                proposed_district_name=district_name,
                proposed_latitude=request.latitude,
                proposed_longitude=request.longitude,
                normalized_proposed_name=normalized_name,
                normalized_proposed_address=normalized_address,
                contact_phone_ciphertext=sealed.ciphertext_with_tag,
                contact_phone_nonce=sealed.nonce,
                contact_phone_key_version=sealed.key_version,
                contact_name=_required_display(request.contact_name),
                status=VenueOnboardingStatus.SUBMITTED,
                submitted_at=now,
            )
            self.repository.add_application(application)
            for item in evidence:
                item.application_id = application.id
            response = _application_response(application, None)
            return self._complete(record, 201, response)
        except IntegrityError as error:
            self.repository.rollback()
            if (
                _integrity_constraint_name(error)
                == "uq_venue_onboarding_submitted_create"
            ):
                raise _application_exists() from None
            raise
        except Exception:
            self.repository.rollback()
            raise

    def list_applications(
        self,
        *,
        user_id: uuid.UUID,
        cursor: str | None,
        limit: int,
    ) -> VenueOnboardingApplications:
        after = _decode_application_cursor(cursor) if cursor else None
        records = self.repository.list_applications(
            applicant_user_id=user_id,
            after=after,
            limit=limit + 1,
        )
        visible = records[:limit]
        next_cursor = None
        if len(records) > limit:
            last = visible[-1][0]
            next_cursor = _encode_cursor(
                [last.submitted_at.isoformat(), str(last.id)]
            )
        return VenueOnboardingApplications(
            items=[
                _applicant_application_response(application, venue)
                for application, venue in visible
            ],
            next_cursor=next_cursor,
        )

    def _validated_submission_evidence(
        self,
        user_id: uuid.UUID,
        supplied: dict[str, uuid.UUID],
        required: dict[str, VenueOnboardingEvidenceKind],
    ) -> list[VenueOnboardingEvidence]:
        if set(supplied) != set(required) or len(set(supplied.values())) != len(required):
            raise _evidence_required()
        locked = self.repository.lock_evidence(list(supplied.values()))
        by_id = {item.id: item for item in locked}
        if len(by_id) != len(required):
            raise _evidence_required()
        result: list[VenueOnboardingEvidence] = []
        for field, kind in required.items():
            item = by_id[supplied[field]]
            if (
                item.owner_user_id != user_id
                or item.kind is not kind
                or item.state is not VenueOnboardingEvidenceState.COMPLETED
                or item.application_id is not None
            ):
                raise AppError(
                    422,
                    "ONBOARDING_EVIDENCE_INVALID",
                    "申请材料无效，请重新上传。",
                )
            result.append(item)
        return result

    def _snapshot_phone(self, user: User, application_id: uuid.UUID) -> SealedPhone:
        if (
            user.phone_ciphertext is None
            or user.phone_nonce is None
            or user.phone_key_version is None
            or user.phone_verified_at is None
            or self.phone_vault is None
        ):
            raise AppError(422, "PHONE_AUTH_REQUIRED", "请先授权微信手机号。")
        phone = self.phone_vault.decrypt(
            SealedPhone(
                user.phone_ciphertext,
                user.phone_nonce,
                user.phone_key_version,
            ),
            record_type="user",
            record_id=user.id,
            field="phone",
        )
        return self.phone_vault.encrypt(
            phone,
            record_type="venue_onboarding_application",
            record_id=application_id,
            field="contact_phone",
        )

    def _replay(
        self,
        record: IdempotencyRecord,
        claimed: bool,
        request_hash: str,
    ) -> MutationResult | None:
        if claimed:
            return None
        if record.request_sha256 != request_hash:
            raise AppError(
                409,
                "IDEMPOTENCY_KEY_REUSED",
                "该幂等键已用于其他请求，请生成新键后重试。",
            )
        if (
            record.state is not IdempotencyState.COMPLETED
            or record.response_body is None
        ):
            raise _state_changed()
        return MutationResult(status_code=200, body=record.response_body)

    def _complete(
        self,
        record: IdempotencyRecord,
        status_code: int,
        response: Any,
    ) -> MutationResult:
        body = cast(dict[str, object], response.model_dump(mode="json"))
        self.repository.complete_idempotency(
            record,
            response_status=status_code,
            response_body=body,
        )
        self.repository.commit()
        return MutationResult(status_code=cast(Any, status_code), body=body)


def normalize_identity(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).split()).casefold()


def _required_display(value: str) -> str:
    normalized = " ".join(unicodedata.normalize("NFKC", value).split())
    if not normalized:
        raise _invalid_argument()
    return normalized


def _candidate(venue: Venue) -> VenueOnboardingCandidate:
    return VenueOnboardingCandidate(
        venue_id=venue.id,
        name=venue.name.strip(),
        district_name=venue.district_name.strip(),
        address=venue.address.strip(),
    )


def _application_response(
    application: VenueOnboardingApplication,
    venue: Venue | None,
) -> VenueOnboardingApplicationResponse:
    if application.kind is VenueOnboardingKind.CLAIM:
        if venue is None:
            raise RuntimeError("claim application venue disappeared")
        application_venue = VenueOnboardingApplicationVenue(
            venue_id=venue.id,
            name=venue.name.strip(),
            address=venue.address.strip(),
        )
    else:
        if application.proposed_name is None or application.proposed_address is None:
            raise RuntimeError("create application proposal disappeared")
        application_venue = VenueOnboardingApplicationVenue(
            venue_id=application.approved_venue_id,
            name=application.proposed_name,
            address=application.proposed_address,
        )
    return VenueOnboardingApplicationResponse(
        application_id=application.id,
        kind=application.kind,
        status=application.status,
        venue=application_venue,
        submitted_at=application.submitted_at,
        updated_at=application.reviewed_at or application.submitted_at,
    )


def _applicant_application_response(
    application: VenueOnboardingApplication,
    venue: Venue | None,
) -> VenueOnboardingApplicantApplication:
    response = _application_response(application, venue)
    rejection_reason = None
    if application.status is VenueOnboardingStatus.REJECTED:
        rejection_reason = (application.review_reason or "").strip()
        if not rejection_reason:
            raise RuntimeError("rejected application reason disappeared")
    return VenueOnboardingApplicantApplication(
        **response.model_dump(),
        rejection_reason=rejection_reason,
    )


def _request_hash(value: object) -> str:
    canonical = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode()).hexdigest()


def _encode_cursor(values: list[str]) -> str:
    raw = json.dumps(values, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _decode_cursor(value: str) -> list[str]:
    try:
        padding = "=" * (-len(value) % 4)
        decoded = json.loads(base64.urlsafe_b64decode(value + padding))
    except (ValueError, TypeError, json.JSONDecodeError):
        raise _invalid_argument() from None
    if not isinstance(decoded, list) or not all(isinstance(item, str) for item in decoded):
        raise _invalid_argument()
    return decoded


def _decode_candidate_cursor(value: str) -> tuple[str, uuid.UUID]:
    decoded = _decode_cursor(value)
    if len(decoded) != 2:
        raise _invalid_argument()
    try:
        return decoded[0], uuid.UUID(decoded[1])
    except ValueError:
        raise _invalid_argument() from None


def _decode_application_cursor(value: str) -> tuple[datetime, uuid.UUID]:
    decoded = _decode_cursor(value)
    if len(decoded) != 2:
        raise _invalid_argument()
    try:
        submitted_at = datetime.fromisoformat(decoded[0])
        application_id = uuid.UUID(decoded[1])
    except ValueError:
        raise _invalid_argument() from None
    if submitted_at.tzinfo is None:
        raise _invalid_argument()
    return submitted_at, application_id


def _distance_meters(
    latitude_a: float,
    longitude_a: float,
    latitude_b: float,
    longitude_b: float,
) -> float:
    radius = 6_371_000.0
    phi_a = math.radians(latitude_a)
    phi_b = math.radians(latitude_b)
    delta_phi = math.radians(latitude_b - latitude_a)
    delta_lambda = math.radians(longitude_b - longitude_a)
    haversine = (
        math.sin(delta_phi / 2) ** 2
        + math.cos(phi_a) * math.cos(phi_b) * math.sin(delta_lambda / 2) ** 2
    )
    return radius * 2 * math.atan2(math.sqrt(haversine), math.sqrt(1 - haversine))


def _invalid_argument() -> AppError:
    return AppError(422, "INVALID_ARGUMENT", "请求参数无效，请检查后重试。")


def _evidence_required() -> AppError:
    return AppError(422, "ONBOARDING_EVIDENCE_REQUIRED", "请上传全部必需材料。")


def _application_exists() -> AppError:
    return AppError(409, "ONBOARDING_APPLICATION_EXISTS", "已有待处理的申请。")


def _integrity_constraint_name(error: IntegrityError) -> str | None:
    diagnostic = getattr(error.orig, "diag", None)
    constraint_name = getattr(diagnostic, "constraint_name", None)
    return constraint_name if isinstance(constraint_name, str) else None


def _state_changed() -> AppError:
    return AppError(
        409,
        "ONBOARDING_APPLICATION_STATE_CHANGED",
        "申请状态已变化，请刷新后重试。",
    )
