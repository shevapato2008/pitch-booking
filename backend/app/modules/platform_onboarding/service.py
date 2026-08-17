from __future__ import annotations

import base64
import hashlib
import hmac
import json
import math
import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import PurePosixPath
from urllib.parse import urlencode

from backend.app.errors import AppError
from backend.app.models import (
    BookingMode,
    Venue,
    VenueMembership,
    VenueOnboardingApplication,
    VenueOnboardingEvidence,
    VenueOnboardingKind,
    VenueOnboardingStatus,
)
from backend.app.modules.platform_onboarding.dto import (
    PlatformOnboardingApplicant,
    PlatformOnboardingApplicationDetail,
    PlatformOnboardingDecision,
    PlatformOnboardingDecisionRequest,
    PlatformOnboardingDuplicateCandidate,
    PlatformOnboardingEvidence,
    PlatformOnboardingEvidenceDownload,
    PlatformOnboardingProposedVenue,
    PlatformOnboardingQueue,
    PlatformOnboardingQueueItem,
    PlatformOnboardingTargetVenue,
    PlatformOnboardingVenueSummary,
)
from backend.app.modules.platform_onboarding.repository import (
    PlatformOnboardingRepository,
)
from backend.app.modules.venue_onboarding.service import normalize_identity
from backend.app.modules.venue_onboarding.storage import (
    PrivateObjectStateError,
    PrivateStorageUnavailableError,
    VenueOnboardingStore,
)
from backend.app.security.phone_vault import (
    PhoneDecryptionError,
    PhoneVault,
    SealedPhone,
)

DOWNLOAD_TTL_SECONDS = 300
DOWNLOAD_TOKEN_PURPOSE = "platform-onboarding-evidence-download:v1"


@dataclass(frozen=True)
class EvidenceDownloadContent:
    chunks: Iterable[bytes]
    content_type: str
    byte_size: int
    filename: str


class PlatformOnboardingService:
    def __init__(
        self,
        *,
        repository: PlatformOnboardingRepository,
        storage: VenueOnboardingStore,
        phone_vault: PhoneVault | None,
        download_token_secret: str | None,
    ) -> None:
        self.repository = repository
        self.storage = storage
        self.phone_vault = phone_vault
        self.download_token_key = _decode_download_token_key(download_token_secret)

    def list_applications(
        self,
        *,
        kind: VenueOnboardingKind | None,
        status: VenueOnboardingStatus | None,
        cursor: str | None,
        limit: int,
    ) -> PlatformOnboardingQueue:
        after = _decode_cursor(cursor) if cursor else None
        rows = self.repository.list_applications(
            kind=kind,
            status=status,
            after=after,
            limit=limit + 1,
        )
        visible = rows[:limit]
        next_cursor = None
        if len(rows) > limit:
            last = visible[-1][0]
            next_cursor = _encode_cursor(last.submitted_at, last.id)
        return PlatformOnboardingQueue(
            items=[_queue_item(application, venue) for application, venue in visible],
            next_cursor=next_cursor,
        )

    def get_application(
        self,
        application_id: uuid.UUID,
    ) -> PlatformOnboardingApplicationDetail:
        record = self.repository.get_application_detail(application_id)
        if record is None:
            raise _not_found()
        application, target, _user = record
        phone = self._decrypt_phone(application)
        evidence = self.repository.list_application_evidence(application.id)
        target_response = _target_venue(target) if target is not None else None
        proposed = _proposed_venue(application)
        duplicates = (
            self._duplicate_candidates(application)
            if application.kind is VenueOnboardingKind.CREATE
            else []
        )
        return PlatformOnboardingApplicationDetail(
            application_id=application.id,
            kind=application.kind,
            status=application.status,
            submitted_at=application.submitted_at,
            applicant=PlatformOnboardingApplicant(
                contact_name=application.contact_name,
                masked_phone=PhoneVault.mask(phone),
            ),
            target_venue=target_response,
            proposed_venue=proposed,
            duplicate_candidates=duplicates,
            evidence=[_evidence(item) for item in evidence],
            decision=_decision(application),
        )

    def create_evidence_download(
        self,
        evidence_id: uuid.UUID,
        *,
        principal_id: str,
        content_base_url: str,
    ) -> PlatformOnboardingEvidenceDownload:
        evidence = self.repository.get_attached_evidence(evidence_id)
        if evidence is None:
            raise _not_found()
        expires_at_unix = int(datetime.now(UTC).timestamp()) + DOWNLOAD_TTL_SECONDS
        signature = self._download_signature(
            evidence_id=evidence.id,
            principal_id=principal_id,
            expires_at=expires_at_unix,
        )
        query = urlencode(
            {"expires": expires_at_unix, "signature": signature},
        )
        return PlatformOnboardingEvidenceDownload(
            download_url=f"{content_base_url}?{query}",
            expires_at=datetime.fromtimestamp(expires_at_unix, UTC),
        )

    def open_evidence_download(
        self,
        evidence_id: uuid.UUID,
        *,
        principal_id: str,
        expires_at: int,
        signature: str,
    ) -> EvidenceDownloadContent:
        expected_signature = self._download_signature(
            evidence_id=evidence_id,
            principal_id=principal_id,
            expires_at=expires_at,
        )
        now_unix = int(datetime.now(UTC).timestamp())
        if (
            not hmac.compare_digest(signature, expected_signature)
            or expires_at < now_unix
            or expires_at > now_unix + DOWNLOAD_TTL_SECONDS
        ):
            raise _invalid_download()
        evidence = self.repository.get_attached_evidence(evidence_id)
        if evidence is None:
            raise _not_found()
        if evidence.byte_size is None:
            raise _state_changed()
        filename = _attachment_filename(evidence)
        try:
            chunks = self.storage.open_private_object(
                evidence.object_key,
                evidence.byte_size,
            )
        except (PrivateObjectStateError, PrivateStorageUnavailableError, ValueError):
            raise AppError(
                503,
                "SERVICE_UNAVAILABLE",
                "私密证据暂时无法下载。",
            ) from None
        return EvidenceDownloadContent(
            chunks=chunks,
            content_type=evidence.content_type,
            byte_size=evidence.byte_size,
            filename=filename,
        )

    def _download_signature(
        self,
        *,
        evidence_id: uuid.UUID,
        principal_id: str,
        expires_at: int,
    ) -> str:
        if self.download_token_key is None:
            raise AppError(503, "SERVICE_UNAVAILABLE", "私密证据暂时无法下载。")
        payload = (
            f"{DOWNLOAD_TOKEN_PURPOSE}:{evidence_id}:{principal_id}:{expires_at}"
        )
        return hmac.new(
            self.download_token_key,
            payload.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

    def decide(
        self,
        *,
        application_id: uuid.UUID,
        principal_id: str,
        request: PlatformOnboardingDecisionRequest,
    ) -> PlatformOnboardingDecision:
        try:
            application = self.repository.lock_application(application_id)
            if application is None:
                raise _not_found()
            if application.status is not VenueOnboardingStatus.SUBMITTED:
                if (
                    application.status.value == request.outcome
                    and application.review_reason == request.reason
                ):
                    decision = _decision(application)
                    if decision is None:
                        raise RuntimeError("decided application lost decision fields")
                    self.repository.commit()
                    return decision
                raise _state_changed()

            approved_venue_id: uuid.UUID | None = None
            if request.outcome == VenueOnboardingStatus.APPROVED:
                if application.kind is VenueOnboardingKind.CLAIM:
                    approved_venue_id = self._approve_claim(application)
                else:
                    approved_venue_id = self._approve_create(application)

            reviewed_at = datetime.now(UTC)
            application.status = VenueOnboardingStatus(request.outcome)
            application.reviewer_principal_id = principal_id.strip()
            application.reviewed_at = reviewed_at
            application.review_reason = request.reason
            application.approved_venue_id = approved_venue_id
            self.repository.flush()
            result = _decision(application)
            if result is None:
                raise RuntimeError("decision projection was not finalized")
            self.repository.commit()
            return result
        except Exception:
            self.repository.rollback()
            raise

    def _approve_claim(self, application: VenueOnboardingApplication) -> uuid.UUID:
        if application.target_venue_id is None:
            raise _state_changed()
        venue = self.repository.lock_venue(application.target_venue_id)
        if venue is None or not venue.is_active:
            raise _state_changed()
        membership = self.repository.get_membership_for_update(
            venue_id=venue.id,
            user_id=application.applicant_user_id,
        )
        if membership is None:
            membership = VenueMembership(
                venue_id=venue.id,
                user_id=application.applicant_user_id,
                is_active=True,
                can_manage_inventory=True,
            )
            self.repository.add(membership)
        else:
            membership.is_active = True
            membership.can_manage_inventory = True
            self.repository.flush()
        return venue.id

    def _approve_create(self, application: VenueOnboardingApplication) -> uuid.UUID:
        self.repository.acquire_create_approval_lock()
        duplicate = self._find_duplicate(application)
        if duplicate is not None:
            details: dict[str, object] = {}
            if duplicate.is_listed:
                details["claim_candidate"] = {
                    "venue_id": str(duplicate.id),
                    "name": duplicate.name,
                    "district_name": duplicate.district_name,
                    "address": duplicate.address,
                }
            raise AppError(
                409,
                "POSSIBLE_DUPLICATE_VENUE",
                "发现可能重复的场馆，未执行审核决定。",
                details,
            )
        proposed = _required_proposal(application)
        venue = Venue(
            id=uuid.uuid4(),
            slug=f"venue-{application.id.hex}",
            name=proposed.name,
            description="",
            price_advantage_text=None,
            timezone=None,
            business_hours_text=None,
            address=proposed.address,
            district_code=proposed.district_code,
            district_name=proposed.district_name,
            parking_text=None,
            phone=None,
            refund_policy_text=None,
            latitude=proposed.latitude,
            longitude=proposed.longitude,
            booking_mode=BookingMode.DIRECTORY_ONLY,
            navigation_poi_name=proposed.name,
            navigation_latitude=proposed.latitude,
            navigation_longitude=proposed.longitude,
            is_listed=False,
            is_active=True,
            is_primary=False,
            public_pitch_types=[],
        )
        self.repository.add(venue)
        self.repository.add(
            VenueMembership(
                venue_id=venue.id,
                user_id=application.applicant_user_id,
                is_active=True,
                can_manage_inventory=True,
            )
        )
        return venue.id

    def _find_duplicate(self, application: VenueOnboardingApplication) -> Venue | None:
        proposed = _required_proposal(application)
        normalized_address = application.normalized_proposed_address
        if normalized_address is None:
            raise _state_changed()
        return next(
            (
                venue
                for venue in self.repository.active_venues()
                if normalize_identity(venue.address) == normalized_address
                or _distance_meters(
                    proposed.latitude,
                    proposed.longitude,
                    venue.latitude,
                    venue.longitude,
                )
                <= 300
            ),
            None,
        )

    def _duplicate_candidates(
        self,
        application: VenueOnboardingApplication,
    ) -> list[PlatformOnboardingDuplicateCandidate]:
        proposed = _required_proposal(application)
        normalized_address = application.normalized_proposed_address or ""
        candidates: list[PlatformOnboardingDuplicateCandidate] = []
        for venue in self.repository.active_venues():
            if not venue.is_listed:
                continue
            distance = round(
                _distance_meters(
                    proposed.latitude,
                    proposed.longitude,
                    venue.latitude,
                    venue.longitude,
                )
            )
            exact = normalize_identity(venue.address) == normalized_address
            if exact or distance <= 300:
                candidates.append(
                    PlatformOnboardingDuplicateCandidate(
                        venue_id=venue.id,
                        name=venue.name,
                        address=venue.address,
                        district_name=venue.district_name,
                        is_listed=venue.is_listed,
                        exact_address_match=exact,
                        distance_meters=max(distance, 0),
                    )
                )
        candidates.sort(key=lambda item: (item.distance_meters, item.venue_id))
        return candidates

    def _decrypt_phone(self, application: VenueOnboardingApplication) -> str:
        if self.phone_vault is None:
            raise AppError(503, "SERVICE_UNAVAILABLE", "联系电话暂时无法核验。")
        try:
            return self.phone_vault.decrypt(
                SealedPhone(
                    application.contact_phone_ciphertext,
                    application.contact_phone_nonce,
                    application.contact_phone_key_version,
                ),
                record_type="venue_onboarding_application",
                record_id=application.id,
                field="contact_phone",
            )
        except PhoneDecryptionError:
            raise AppError(
                503,
                "SERVICE_UNAVAILABLE",
                "联系电话暂时无法核验。",
            ) from None


def _queue_item(
    application: VenueOnboardingApplication,
    target: Venue | None,
) -> PlatformOnboardingQueueItem:
    if application.kind is VenueOnboardingKind.CLAIM:
        if target is None:
            raise RuntimeError("claim target venue disappeared")
        venue = PlatformOnboardingVenueSummary(
            venue_id=target.id,
            name=target.name,
            address=target.address,
            district_name=target.district_name,
        )
    else:
        proposed = _required_proposal(application)
        venue = PlatformOnboardingVenueSummary(
            venue_id=application.approved_venue_id,
            name=proposed.name,
            address=proposed.address,
            district_name=proposed.district_name,
        )
    return PlatformOnboardingQueueItem(
        application_id=application.id,
        kind=application.kind,
        status=application.status,
        contact_name=application.contact_name,
        venue=venue,
        submitted_at=application.submitted_at,
        reviewed_at=application.reviewed_at,
    )


def _target_venue(venue: Venue) -> PlatformOnboardingTargetVenue:
    return PlatformOnboardingTargetVenue(
        venue_id=venue.id,
        name=venue.name,
        address=venue.address,
        district_code=venue.district_code,
        district_name=venue.district_name,
        latitude=venue.latitude,
        longitude=venue.longitude,
    )


def _proposed_venue(
    application: VenueOnboardingApplication,
) -> PlatformOnboardingProposedVenue | None:
    if application.kind is VenueOnboardingKind.CLAIM:
        return None
    return _required_proposal(application)


def _required_proposal(
    application: VenueOnboardingApplication,
) -> PlatformOnboardingProposedVenue:
    values = (
        application.proposed_name,
        application.proposed_address,
        application.proposed_district_code,
        application.proposed_district_name,
        application.proposed_latitude,
        application.proposed_longitude,
    )
    if any(value is None for value in values):
        raise _state_changed()
    assert application.proposed_name is not None
    assert application.proposed_address is not None
    assert application.proposed_district_code is not None
    assert application.proposed_district_name is not None
    assert application.proposed_latitude is not None
    assert application.proposed_longitude is not None
    return PlatformOnboardingProposedVenue(
        name=application.proposed_name,
        address=application.proposed_address,
        district_code=application.proposed_district_code,
        district_name=application.proposed_district_name,
        latitude=application.proposed_latitude,
        longitude=application.proposed_longitude,
    )


def _evidence(item: VenueOnboardingEvidence) -> PlatformOnboardingEvidence:
    if item.byte_size is None:
        raise RuntimeError("completed evidence lost byte size")
    return PlatformOnboardingEvidence(
        evidence_id=item.id,
        kind=item.kind,
        content_type=item.content_type,
        byte_size=item.byte_size,
        created_at=item.created_at,
    )


def _decision(
    application: VenueOnboardingApplication,
) -> PlatformOnboardingDecision | None:
    if application.status is VenueOnboardingStatus.SUBMITTED:
        return None
    if (
        application.reviewer_principal_id is None
        or application.reviewed_at is None
        or application.review_reason is None
    ):
        raise RuntimeError("decided application lost review authority")
    return PlatformOnboardingDecision(
        application_id=application.id,
        outcome=application.status,
        reason=application.review_reason,
        reviewer_principal_id=application.reviewer_principal_id,
        reviewed_at=application.reviewed_at,
        approved_venue_id=application.approved_venue_id,
    )


def _attachment_filename(evidence: VenueOnboardingEvidence) -> str:
    stem = evidence.kind.value.casefold().replace("_", "-")
    extension = {
        "application/pdf": ".pdf",
        "image/jpeg": ".jpg",
        "image/png": ".png",
    }.get(evidence.content_type)
    if extension is None or PurePosixPath(stem).name != stem:
        raise _state_changed()
    return f"{stem}{extension}"


def _encode_cursor(submitted_at: datetime, application_id: uuid.UUID) -> str:
    raw = json.dumps(
        [submitted_at.isoformat(), str(application_id)],
        separators=(",", ":"),
    ).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _decode_cursor(value: str) -> tuple[datetime, uuid.UUID]:
    try:
        padding = "=" * (-len(value) % 4)
        decoded = json.loads(base64.urlsafe_b64decode(value + padding))
        if (
            not isinstance(decoded, list)
            or len(decoded) != 2
            or not all(isinstance(item, str) for item in decoded)
        ):
            raise ValueError
        submitted_at = datetime.fromisoformat(decoded[0])
        application_id = uuid.UUID(decoded[1])
        if submitted_at.tzinfo is None:
            raise ValueError
        return submitted_at, application_id
    except (ValueError, TypeError, json.JSONDecodeError):
        raise AppError(422, "INVALID_ARGUMENT", "分页游标无效。") from None


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


def _not_found() -> AppError:
    return AppError(404, "ONBOARDING_APPLICATION_NOT_FOUND", "申请或材料不存在。")


def _state_changed() -> AppError:
    return AppError(
        409,
        "ONBOARDING_APPLICATION_STATE_CHANGED",
        "申请状态已变化，请刷新后重试。",
    )


def _invalid_download() -> AppError:
    return AppError(403, "PLATFORM_CSRF_INVALID", "证据下载链接无效或已过期。")


def _decode_download_token_key(secret_base64: str | None) -> bytes | None:
    if secret_base64 is None:
        return None
    try:
        key = base64.b64decode(secret_base64, validate=True)
    except (ValueError, UnicodeEncodeError):
        return None
    return key if len(key) >= 32 else None
