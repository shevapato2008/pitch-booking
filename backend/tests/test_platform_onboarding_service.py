from __future__ import annotations

import base64
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlsplit

import pytest
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session

from backend.app.errors import AppError
from backend.app.models import (
    BookingMode,
    User,
    Venue,
    VenueMembership,
    VenueOnboardingApplication,
    VenueOnboardingEvidence,
    VenueOnboardingEvidenceKind,
    VenueOnboardingEvidenceState,
    VenueOnboardingKind,
    VenueOnboardingStatus,
)
from backend.app.modules.platform_onboarding.dto import PlatformOnboardingDecisionRequest
from backend.app.modules.platform_onboarding.repository import PlatformOnboardingRepository
from backend.app.modules.platform_onboarding.service import PlatformOnboardingService
from backend.app.modules.venue_onboarding.oss_storage import OssOnboardingStorage
from backend.app.modules.venue_onboarding.storage import (
    MemoryOnboardingStorage,
    PrivateObjectStateError,
    PrivateStorageUnavailableError,
)
from backend.app.security.phone_vault import PhoneVault

pytestmark = pytest.mark.integration

KEY_BASE64 = base64.b64encode(bytes(range(32))).decode("ascii")
KEY_VERSION = 9
DOWNLOAD_TOKEN_SECRET = base64.b64encode(bytes(reversed(range(32)))).decode("ascii")


class RecordingDownloadStore:
    def __init__(self) -> None:
        self.calls: list[tuple[str, int]] = []

    def open_private_object(
        self,
        object_key: str,
        expected_bytes: int,
    ) -> bytes:
        self.calls.append((object_key, expected_bytes))
        return b"x" * expected_bytes


def _venue(*, name: str, address: str, latitude: float = 39.12) -> Venue:
    return Venue(
        slug=f"platform-review-{uuid.uuid4().hex}",
        name=name,
        description="",
        address=address,
        district_code="120101",
        district_name="和平区",
        latitude=latitude,
        longitude=117.20,
        booking_mode=BookingMode.DIRECTORY_ONLY,
        navigation_poi_name=name,
        navigation_latitude=latitude,
        navigation_longitude=117.20,
        is_listed=True,
        is_active=True,
        public_pitch_types=[],
    )


def _application(
    session: Session,
    *,
    kind: VenueOnboardingKind,
    target: Venue | None = None,
    name: str = "新建足球公园",
    address: str = "天津市和平区新建路 8 号",
    latitude: float = 39.22,
    submitted_at: datetime | None = None,
) -> VenueOnboardingApplication:
    user = User(
        wechat_app_id="wx-platform-review",
        wechat_openid=f"openid-{uuid.uuid4()}",
        last_contact_name="申请人",
    )
    session.add(user)
    session.flush()
    application_id = uuid.uuid4()
    sealed = PhoneVault(key_base64=KEY_BASE64, key_version=KEY_VERSION).encrypt(
        "13800138000",
        record_type="venue_onboarding_application",
        record_id=application_id,
        field="contact_phone",
    )
    application = VenueOnboardingApplication(
        id=application_id,
        applicant_user_id=user.id,
        kind=kind,
        target_venue_id=target.id if target else None,
        proposed_name=name if kind is VenueOnboardingKind.CREATE else None,
        proposed_address=address if kind is VenueOnboardingKind.CREATE else None,
        proposed_district_code="120101" if kind is VenueOnboardingKind.CREATE else None,
        proposed_district_name="和平区" if kind is VenueOnboardingKind.CREATE else None,
        proposed_latitude=latitude if kind is VenueOnboardingKind.CREATE else None,
        proposed_longitude=117.21 if kind is VenueOnboardingKind.CREATE else None,
        normalized_proposed_name=name.casefold() if kind is VenueOnboardingKind.CREATE else None,
        normalized_proposed_address=address.casefold()
        if kind is VenueOnboardingKind.CREATE
        else None,
        contact_phone_ciphertext=sealed.ciphertext_with_tag,
        contact_phone_nonce=sealed.nonce,
        contact_phone_key_version=sealed.key_version,
        contact_name="申请人",
        status=VenueOnboardingStatus.SUBMITTED,
        submitted_at=submitted_at or datetime.now(UTC),
    )
    session.add(application)
    session.flush()
    kind_value = (
        VenueOnboardingEvidenceKind.MANAGEMENT_AUTHORIZATION
        if kind is VenueOnboardingKind.CLAIM
        else VenueOnboardingEvidenceKind.BUSINESS_LICENSE
    )
    session.add(
        VenueOnboardingEvidence(
            owner_user_id=user.id,
            application_id=application.id,
            kind=kind_value,
            state=VenueOnboardingEvidenceState.COMPLETED,
            object_key=f"venue-onboarding/{user.id}/{uuid.uuid4()}/proof.pdf",
            content_type="application/pdf",
            byte_size=1200,
            content_sha256="a" * 64,
        )
    )
    session.commit()
    return application


def _service(
    session: Session,
    store: RecordingDownloadStore | None = None,
) -> PlatformOnboardingService:
    return PlatformOnboardingService(
        repository=PlatformOnboardingRepository(session),
        storage=store or RecordingDownloadStore(),
        phone_vault=PhoneVault(key_base64=KEY_BASE64, key_version=KEY_VERSION),
        download_token_secret=DOWNLOAD_TOKEN_SECRET,
    )


def test_private_storage_opens_only_an_exact_private_namespaced_object() -> None:
    memory = MemoryOnboardingStorage()
    prefix = f"venue-onboarding/{uuid.uuid4()}/{uuid.uuid4()}/"
    object_key = f"{prefix}secret.pdf"
    memory.accept_upload(prefix, "secret.pdf", b"private")

    content = memory.open_private_object(object_key, 7)

    assert content == b"private"
    with pytest.raises(ValueError):
        memory.open_private_object("public/secret.pdf", 7)


class _OssDownloadResult:
    def __init__(
        self,
        data: bytes,
        *,
        content_length: int = 7,
        read_error: Exception | None = None,
        close_error: Exception | None = None,
    ) -> None:
        self.content_length = content_length
        self.data = bytearray(data)
        self.read_error = read_error
        self.close_error = close_error
        self.read_sizes: list[int] = []
        self.close_calls = 0

    def read(self, size: int) -> bytes:
        self.read_sizes.append(size)
        if self.read_error is not None:
            raise self.read_error
        chunk = bytes(self.data[:size])
        del self.data[:size]
        return chunk

    def close(self) -> None:
        self.close_calls += 1
        if self.close_error is not None:
            raise self.close_error


class _OssDownloadBucket:
    def __init__(self, result: _OssDownloadResult) -> None:
        self.calls: list[str] = []
        self.result = result

    def get_object(self, key: str) -> _OssDownloadResult:
        self.calls.append(key)
        return self.result


def _oss_download_adapter(result: _OssDownloadResult) -> OssOnboardingStorage:
    return OssOnboardingStorage(
        bucket=_OssDownloadBucket(result),
        endpoint="https://oss-cn-beijing.aliyuncs.com",
        bucket_name="private-onboarding",
        access_key_id="access-key",
        access_key_secret="access-secret",
    )


def test_oss_download_reads_exact_private_key_before_returning() -> None:
    result = _OssDownloadResult(b"private")
    adapter = _oss_download_adapter(result)
    object_key = f"venue-onboarding/{uuid.uuid4()}/{uuid.uuid4()}/proof.jpg"

    content = adapter.open_private_object(object_key, 7)

    assert content == b"private"
    assert result.read_sizes == [8, 1]
    assert result.close_calls == 1


@pytest.mark.parametrize(
    ("result", "error_type"),
    [
        (
            _OssDownloadResult(b"private", read_error=OSError("read failed")),
            PrivateStorageUnavailableError,
        ),
        (_OssDownloadResult(b"priv"), PrivateObjectStateError),
        (_OssDownloadResult(b"private!"), PrivateObjectStateError),
        (
            _OssDownloadResult(b"private", content_length=6),
            PrivateObjectStateError,
        ),
        (
            _OssDownloadResult(b"private", close_error=OSError("close failed")),
            PrivateStorageUnavailableError,
        ),
    ],
)
def test_oss_download_rejects_failures_before_returning(
    result: _OssDownloadResult,
    error_type: type[Exception],
) -> None:
    adapter = _oss_download_adapter(result)
    object_key = f"venue-onboarding/{uuid.uuid4()}/{uuid.uuid4()}/proof.jpg"

    with pytest.raises(error_type):
        adapter.open_private_object(object_key, 7)

    assert result.close_calls == 1


def test_queue_filters_and_uses_stable_cursor(pg_engine: Engine) -> None:
    with Session(pg_engine) as session:
        target = _venue(name="现有球场", address="天津市和平区现有路 1 号")
        session.add(target)
        session.commit()
        earlier = datetime.now(UTC) - timedelta(minutes=5)
        claim = _application(
            session,
            kind=VenueOnboardingKind.CLAIM,
            target=target,
            submitted_at=earlier,
        )
        create = _application(session, kind=VenueOnboardingKind.CREATE)

        first = _service(session).list_applications(
            kind=None,
            status=VenueOnboardingStatus.SUBMITTED,
            cursor=None,
            limit=1,
        )
        assert [item.application_id for item in first.items] == [create.id]
        assert first.next_cursor is not None

        second = _service(session).list_applications(
            kind=VenueOnboardingKind.CLAIM,
            status=VenueOnboardingStatus.SUBMITTED,
            cursor=first.next_cursor,
            limit=1,
        )
        assert [item.application_id for item in second.items] == [claim.id]
        assert second.next_cursor is None

        with pytest.raises(AppError) as invalid:
            _service(session).list_applications(
                kind=None,
                status=None,
                cursor="not-a-valid-cursor",
                limit=20,
            )
        assert invalid.value.code == "INVALID_ARGUMENT"


def test_detail_masks_phone_and_never_exposes_private_storage_fields(pg_engine: Engine) -> None:
    with Session(pg_engine) as session:
        application = _application(session, kind=VenueOnboardingKind.CREATE)
        detail = _service(session).get_application(application.id)
        payload = detail.model_dump(mode="json")

        assert payload["applicant"] == {
            "contact_name": "申请人",
            "masked_phone": "138****8000",
        }
        assert payload["proposed_venue"]["name"] == "新建足球公园"
        assert "contact_phone_ciphertext" not in str(payload)
        assert "object_key" not in str(payload)
        assert "content_sha256" not in str(payload)


def test_unlisted_duplicate_identity_is_not_disclosed_in_detail_or_conflict(
    pg_engine: Engine,
) -> None:
    with Session(pg_engine) as session:
        application = _application(session, kind=VenueOnboardingKind.CREATE)
        duplicate = _venue(
            name="未公开内部场馆",
            address=application.proposed_address or "",
            latitude=application.proposed_latitude or 39.22,
        )
        duplicate.is_listed = False
        session.add(duplicate)
        session.commit()

        detail = _service(session).get_application(application.id)
        assert detail.duplicate_candidates == []

        with pytest.raises(AppError) as conflict:
            _service(session).decide(
                application_id=application.id,
                principal_id="ops-1",
                request=PlatformOnboardingDecisionRequest(
                    outcome=VenueOnboardingStatus.APPROVED,
                    reason="材料完整",
                ),
            )
        assert conflict.value.code == "POSSIBLE_DUPLICATE_VENUE"
        assert conflict.value.details == {}
        assert str(duplicate.id) not in str(conflict.value.details)


def test_download_requires_evidence_attached_to_application_and_is_short_lived(
    pg_engine: Engine,
) -> None:
    store = RecordingDownloadStore()
    with Session(pg_engine) as session:
        application = _application(session, kind=VenueOnboardingKind.CREATE)
        evidence = session.scalar(
            select(VenueOnboardingEvidence).where(
                VenueOnboardingEvidence.application_id == application.id
            )
        )
        assert evidence is not None

        content_base_url = (
            f"https://api.example.test/platform-admin/api/v1/onboarding/"
            f"evidence/{evidence.id}/content"
        )
        result = _service(session, store).create_evidence_download(
            evidence.id,
            principal_id="ops-1",
            content_base_url=content_base_url,
        )

        assert result.download_url.startswith(content_base_url)
        assert evidence.object_key not in result.download_url
        assert 0 < (result.expires_at - datetime.now(UTC)).total_seconds() <= 300
        assert store.calls == []

        query = parse_qs(urlsplit(result.download_url).query)
        content = _service(session, store).open_evidence_download(
            evidence.id,
            principal_id="ops-1",
            expires_at=int(query["expires"][0]),
            signature=query["signature"][0],
        )
        assert content.content_type == "application/pdf"
        assert content.filename == "business-license.pdf"
        assert content.byte_size == evidence.byte_size
        assert len(content.data) == evidence.byte_size
        assert store.calls == [(evidence.object_key, evidence.byte_size)]

        unattached = VenueOnboardingEvidence(
            owner_user_id=evidence.owner_user_id,
            application_id=None,
            kind=VenueOnboardingEvidenceKind.VENUE_EXTERIOR,
            state=VenueOnboardingEvidenceState.COMPLETED,
            object_key=f"venue-onboarding/{evidence.owner_user_id}/{uuid.uuid4()}/proof.jpg",
            content_type="image/jpeg",
            byte_size=12,
            content_sha256="b" * 64,
        )
        session.add(unattached)
        session.commit()
        with pytest.raises(AppError) as missing:
            _service(session, store).create_evidence_download(
                unattached.id,
                principal_id="ops-1",
                content_base_url=content_base_url,
            )
        assert missing.value.code == "ONBOARDING_APPLICATION_NOT_FOUND"


def test_claim_approval_reactivates_one_membership_without_creating_venue(
    pg_engine: Engine,
) -> None:
    with Session(pg_engine) as session:
        target = _venue(name="可认领球场", address="天津市和平区认领路 1 号")
        session.add(target)
        session.commit()
        application = _application(session, kind=VenueOnboardingKind.CLAIM, target=target)
        session.add(
            VenueMembership(
                venue_id=target.id,
                user_id=application.applicant_user_id,
                is_active=False,
                can_manage_inventory=False,
            )
        )
        session.commit()
        before = session.scalar(select(func.count()).select_from(Venue))

        decision = _service(session).decide(
            application_id=application.id,
            principal_id="ops-1",
            request=PlatformOnboardingDecisionRequest(
                outcome=VenueOnboardingStatus.APPROVED,
                reason="  授权材料一致  ",
            ),
        )

        assert decision.outcome is VenueOnboardingStatus.APPROVED
        assert decision.reason == "授权材料一致"
        assert decision.approved_venue_id == target.id
        assert session.scalar(select(func.count()).select_from(Venue)) == before
        memberships = list(
            session.scalars(
                select(VenueMembership).where(
                    VenueMembership.user_id == application.applicant_user_id,
                    VenueMembership.venue_id == target.id,
                )
            )
        )
        assert len(memberships) == 1
        assert memberships[0].is_active is True
        assert memberships[0].can_manage_inventory is True


def test_create_approval_is_atomic_unlisted_and_decisions_are_immutable(
    pg_engine: Engine,
) -> None:
    with Session(pg_engine) as session:
        application = _application(session, kind=VenueOnboardingKind.CREATE)

        first = _service(session).decide(
            application_id=application.id,
            principal_id="ops-1",
            request=PlatformOnboardingDecisionRequest(
                outcome=VenueOnboardingStatus.APPROVED,
                reason="  材料完整  ",
            ),
        )
        replay = _service(session).decide(
            application_id=application.id,
            principal_id="ops-2",
            request=PlatformOnboardingDecisionRequest(
                outcome=VenueOnboardingStatus.APPROVED,
                reason="材料完整",
            ),
        )

        assert replay == first
        assert first.approved_venue_id is not None
        venue = session.get_one(Venue, first.approved_venue_id)
        assert venue.booking_mode is BookingMode.DIRECTORY_ONLY
        assert venue.is_listed is False
        assert venue.is_active is True
        assert venue.slug == f"venue-{application.id.hex}"
        membership = session.scalar(
            select(VenueMembership).where(
                VenueMembership.venue_id == venue.id,
                VenueMembership.user_id == application.applicant_user_id,
            )
        )
        assert membership is not None
        assert membership.is_active is True
        assert membership.can_manage_inventory is True

        with pytest.raises(AppError) as changed:
            _service(session).decide(
                application_id=application.id,
                principal_id="ops-1",
                request=PlatformOnboardingDecisionRequest(
                    outcome=VenueOnboardingStatus.REJECTED,
                    reason="不同结论",
                ),
            )
        assert changed.value.code == "ONBOARDING_APPLICATION_STATE_CHANGED"


def test_concurrent_equivalent_create_approvals_create_one_venue_and_membership(
    pg_engine: Engine,
) -> None:
    with Session(pg_engine) as session:
        application = _application(session, kind=VenueOnboardingKind.CREATE)
        application_id = application.id
        applicant_user_id = application.applicant_user_id

    start = threading.Barrier(2)

    def approve(principal_id: str) -> tuple[uuid.UUID | None, str]:
        with Session(pg_engine) as session:
            start.wait(timeout=5)
            decision = _service(session).decide(
                application_id=application_id,
                principal_id=principal_id,
                request=PlatformOnboardingDecisionRequest(
                    outcome=VenueOnboardingStatus.APPROVED,
                    reason="并发审核材料完整",
                ),
            )
            return decision.approved_venue_id, decision.reviewer_principal_id

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(approve, ("ops-1", "ops-2")))

    approved_venue_ids = {approved_venue_id for approved_venue_id, _ in results}
    assert len(approved_venue_ids) == 1
    approved_venue_id = approved_venue_ids.pop()
    assert approved_venue_id is not None
    assert len({reviewer for _, reviewer in results}) == 1
    with Session(pg_engine) as session:
        assert (
            session.scalar(
                select(func.count())
                .select_from(Venue)
                .where(Venue.id == approved_venue_id)
            )
            == 1
        )
        assert (
            session.scalar(
                select(func.count())
                .select_from(VenueMembership)
                .where(
                    VenueMembership.venue_id == approved_venue_id,
                    VenueMembership.user_id == applicant_user_id,
                )
            )
            == 1
        )


def test_create_duplicate_conflict_rolls_back_all_review_mutations(pg_engine: Engine) -> None:
    with Session(pg_engine) as session:
        application = _application(session, kind=VenueOnboardingKind.CREATE)
        duplicate = _venue(
            name="已存在球场",
            address=application.proposed_address or "",
            latitude=application.proposed_latitude or 39.22,
        )
        session.add(duplicate)
        session.commit()
        venue_count = session.scalar(select(func.count()).select_from(Venue))

        with pytest.raises(AppError) as conflict:
            _service(session).decide(
                application_id=application.id,
                principal_id="ops-1",
                request=PlatformOnboardingDecisionRequest(
                    outcome=VenueOnboardingStatus.APPROVED,
                    reason="材料完整",
                ),
            )
        assert conflict.value.code == "POSSIBLE_DUPLICATE_VENUE"
        session.expire_all()
        unchanged = session.get_one(VenueOnboardingApplication, application.id)
        assert unchanged.status is VenueOnboardingStatus.SUBMITTED
        assert unchanged.reviewer_principal_id is None
        assert session.scalar(select(func.count()).select_from(Venue)) == venue_count
        assert (
            session.scalar(
                select(func.count())
                .select_from(VenueMembership)
                .where(VenueMembership.user_id == application.applicant_user_id)
            )
            == 0
        )
