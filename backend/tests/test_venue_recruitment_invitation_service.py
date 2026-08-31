from __future__ import annotations

import hashlib
import uuid
from datetime import UTC, datetime, timedelta

import pytest

from backend.app.errors import AppError
from backend.app.models import (
    BookingMode,
    User,
    Venue,
    VenueOnboardingApplication,
    VenueOnboardingKind,
    VenueOnboardingStatus,
    VenueRecruitmentInvitation,
    VenueRecruitmentInvitationStatus,
)

NOW = datetime(2026, 9, 1, 12, 0, tzinfo=UTC)
VENUE_ID = uuid.UUID("20000000-0000-4000-8000-000000000002")
USER_ID = uuid.UUID("30000000-0000-4000-8000-000000000003")
OTHER_USER_ID = uuid.UUID("30000000-0000-4000-8000-000000000004")
TOKEN = "Wm8Lk3R6uQ2pV9sH7xTa4bNcE5fG1jK0dZyR3qP6uQx"


def _venue() -> Venue:
    return Venue(
        id=VENUE_ID,
        slug="d1a-target",
        name="天津海河东体育中心足球场",
        description="",
        address="天津市河东区津塘路156号院内东侧",
        district_code="120102",
        district_name="河东区",
        latitude=39.12,
        longitude=117.25,
        booking_mode=BookingMode.DIRECTORY_ONLY,
        navigation_poi_name="天津海河东体育中心足球场",
        navigation_latitude=39.12,
        navigation_longitude=117.25,
        sort_order=0,
        content_verified_at=NOW,
        is_listed=True,
        is_primary=False,
        is_active=True,
    )


def _user(user_id: uuid.UUID = USER_ID) -> User:
    return User(
        id=user_id,
        wechat_app_id="wx-d1a",
        wechat_openid=f"openid-{user_id}",
    )


def _invitation(
    *,
    status: VenueRecruitmentInvitationStatus = VenueRecruitmentInvitationStatus.ACTIVE,
    claimed_by: uuid.UUID | None = None,
    application_id: uuid.UUID | None = None,
) -> VenueRecruitmentInvitation:
    claimed_at = NOW if claimed_by is not None else None
    return VenueRecruitmentInvitation(
        id=uuid.UUID("10000000-0000-4000-8000-000000000001"),
        venue_id=VENUE_ID,
        token_sha256=hashlib.sha256(TOKEN.encode("ascii")).hexdigest(),
        status=status,
        contact_label="海河东场馆负责人",
        expires_at=NOW + timedelta(days=7),
        created_at=NOW,
        created_by_principal_id="platform-yangfan",
        create_idempotency_key="create-invitation-0001",
        create_request_sha256="a" * 64,
        claimed_by_user_id=claimed_by,
        claimed_at=claimed_at,
        application_id=application_id,
        version=(3 if application_id else 2 if claimed_by else 1),
    )


class FakeRepository:
    def __init__(self) -> None:
        self.venue = _venue()
        self.invitation: VenueRecruitmentInvitation | None = None
        self.active_membership = False
        self.commits = 0
        self.rollbacks = 0
        self.idempotency: dict[
            tuple[uuid.UUID, str, str], tuple[str, dict[str, object] | None]
        ] = {}

    def lock_venue(self, venue_id: uuid.UUID) -> Venue | None:
        return self.venue if self.venue.id == venue_id else None

    def has_active_membership(self, venue_id: uuid.UUID) -> bool:
        return venue_id == self.venue.id and self.active_membership

    def find_create_by_key(self, principal_id: str, key: str) -> VenueRecruitmentInvitation | None:
        item = self.invitation
        return (
            item
            if item
            and item.created_by_principal_id == principal_id
            and item.create_idempotency_key == key
            else None
        )

    def find_revoke_by_key(self, principal_id: str, key: str) -> VenueRecruitmentInvitation | None:
        item = self.invitation
        return (
            item
            if item
            and item.revoked_by_principal_id == principal_id
            and item.revoke_idempotency_key == key
            else None
        )

    def find_live_for_venue(self, venue_id: uuid.UUID) -> VenueRecruitmentInvitation | None:
        item = self.invitation
        return (
            item
            if item
            and item.venue_id == venue_id
            and item.status
            in {
                VenueRecruitmentInvitationStatus.ACTIVE,
                VenueRecruitmentInvitationStatus.CLAIMED,
            }
            else None
        )

    def find_by_token_sha256(
        self, digest: str, *, for_update: bool = False
    ) -> VenueRecruitmentInvitation | None:
        del for_update
        return (
            self.invitation if self.invitation and self.invitation.token_sha256 == digest else None
        )

    def get_with_venue(self, invitation_id: uuid.UUID, *, for_update: bool = False):
        del for_update
        return (
            (self.invitation, self.venue)
            if self.invitation and self.invitation.id == invitation_id
            else None
        )

    def venue_for_invitation(self, invitation: VenueRecruitmentInvitation) -> Venue:
        assert invitation.venue_id == self.venue.id
        return self.venue

    def add(self, invitation: VenueRecruitmentInvitation) -> None:
        self.invitation = invitation

    def flush(self) -> None:
        return None

    def commit(self) -> None:
        self.commits += 1

    def rollback(self) -> None:
        self.rollbacks += 1
        self.idempotency = {
            key: value for key, value in self.idempotency.items() if value[1] is not None
        }

    def claim_idempotency(
        self, *, user_id: uuid.UUID, operation: str, key: str, request_sha256: str
    ):
        identity = (user_id, operation, key)
        existing = self.idempotency.get(identity)
        if existing is None:
            self.idempotency[identity] = (request_sha256, None)
            return identity, True
        return identity, False

    def read_idempotency(self, record):
        return self.idempotency[record]

    def complete_idempotency(
        self, record, *, response_status: int, response_body: dict[str, object]
    ) -> None:
        del response_status
        request_hash, _response = self.idempotency[record]
        self.idempotency[record] = (request_hash, response_body)


class FakeClaimBoundary:
    def __init__(self) -> None:
        self.fail = False
        self.calls: list[tuple[uuid.UUID, uuid.UUID, str]] = []

    def create_claim_application(
        self, *, user: User, venue: Venue, contact_name: str, evidence: object
    ):
        del evidence
        self.calls.append((user.id, venue.id, contact_name))
        if self.fail:
            raise AppError(422, "ONBOARDING_EVIDENCE_INVALID", "申请材料无效，请重新上传。")
        application = VenueOnboardingApplication(
            id=uuid.UUID("40000000-0000-4000-8000-000000000004"),
            applicant_user_id=user.id,
            kind=VenueOnboardingKind.CLAIM,
            target_venue_id=venue.id,
            contact_phone_ciphertext=b"x" * 16,
            contact_phone_nonce=b"x" * 12,
            contact_phone_key_version=1,
            contact_name=contact_name,
            status=VenueOnboardingStatus.SUBMITTED,
            submitted_at=NOW,
        )
        return application, {
            "application_id": str(application.id),
            "kind": "CLAIM",
            "status": "SUBMITTED",
            "venue": {"venue_id": str(venue.id), "name": venue.name, "address": venue.address},
            "submitted_at": NOW.isoformat(),
            "updated_at": NOW.isoformat(),
        }


def test_platform_create_returns_secret_only_on_first_201_and_hashes_storage(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.app.modules.venue_recruitment_invitations.dto import (
        RecruitmentInvitationCreateRequest,
    )
    from backend.app.modules.venue_recruitment_invitations.service import (
        PlatformRecruitmentInvitationService,
    )

    repository = FakeRepository()
    monkeypatch.setattr(
        "backend.app.modules.venue_recruitment_invitations.service.secrets.token_urlsafe",
        lambda _: TOKEN,
    )
    service = PlatformRecruitmentInvitationService(repository=repository, now=lambda: NOW)
    request = RecruitmentInvitationCreateRequest(
        venue_id=VENUE_ID, contact_label=" 海河东场馆负责人 "
    )

    first = service.create(
        principal_id="platform-yangfan", idempotency_key="create-invitation-0001", request=request
    )
    replay = service.create(
        principal_id="platform-yangfan", idempotency_key="create-invitation-0001", request=request
    )

    assert first.status_code == 201
    assert first.body["token"] == TOKEN
    assert first.body["invitation_path"] == f"pages/venue-invitation/index?token={TOKEN}"
    assert replay.status_code == 200
    assert "token" not in replay.body and "invitation_path" not in replay.body
    assert repository.invitation is not None
    assert repository.invitation.token_sha256 == hashlib.sha256(TOKEN.encode("ascii")).hexdigest()
    assert TOKEN not in repr(repository.invitation.__dict__)


def test_platform_create_rejects_changed_payload_and_ineligible_venue() -> None:
    from backend.app.modules.venue_recruitment_invitations.dto import (
        RecruitmentInvitationCreateRequest,
    )
    from backend.app.modules.venue_recruitment_invitations.service import (
        PlatformRecruitmentInvitationService,
    )

    repository = FakeRepository()
    repository.invitation = _invitation()
    service = PlatformRecruitmentInvitationService(repository=repository, now=lambda: NOW)
    with pytest.raises(AppError) as reused:
        service.create(
            principal_id="platform-yangfan",
            idempotency_key="create-invitation-0001",
            request=RecruitmentInvitationCreateRequest(
                venue_id=VENUE_ID, contact_label="另一个联系人"
            ),
        )
    assert reused.value.code == "IDEMPOTENCY_KEY_REUSED"

    repository.invitation = None
    repository.active_membership = True
    with pytest.raises(AppError) as ineligible:
        service.create(
            principal_id="platform-yangfan",
            idempotency_key="create-invitation-0002",
            request=RecruitmentInvitationCreateRequest(venue_id=VENUE_ID, contact_label="负责人"),
        )
    assert ineligible.value.code == "VENUE_NOT_ELIGIBLE"


def test_platform_revoke_is_idempotent_and_submitted_is_immutable() -> None:
    from backend.app.modules.venue_recruitment_invitations.dto import (
        RecruitmentInvitationRevokeRequest,
    )
    from backend.app.modules.venue_recruitment_invitations.service import (
        PlatformRecruitmentInvitationService,
    )

    repository = FakeRepository()
    repository.invitation = _invitation(
        claimed_by=USER_ID, status=VenueRecruitmentInvitationStatus.CLAIMED
    )
    service = PlatformRecruitmentInvitationService(repository=repository, now=lambda: NOW)
    request = RecruitmentInvitationRevokeRequest(reason=" 联系人已确认暂不合作 ")
    first = service.revoke(
        invitation_id=repository.invitation.id,
        principal_id="platform-yangfan",
        idempotency_key="revoke-invitation-0001",
        request=request,
    )
    replay = service.revoke(
        invitation_id=repository.invitation.id,
        principal_id="platform-yangfan",
        idempotency_key="revoke-invitation-0001",
        request=request,
    )
    assert first.status.value == replay.status.value == "REVOKED"
    assert repository.invitation.revocation_reason == "联系人已确认暂不合作"

    repository.invitation = _invitation(
        claimed_by=USER_ID,
        application_id=uuid.uuid4(),
        status=VenueRecruitmentInvitationStatus.SUBMITTED,
    )
    with pytest.raises(AppError) as submitted:
        service.revoke(
            invitation_id=repository.invitation.id,
            principal_id="platform-yangfan",
            idempotency_key="revoke-invitation-0002",
            request=request,
        )
    assert submitted.value.code == "VENUE_INVITATION_STATE_CHANGED"


def test_client_read_accept_and_cross_user_are_private() -> None:
    from backend.app.modules.venue_recruitment_invitations.service import (
        VenueRecruitmentInvitationService,
    )

    repository = FakeRepository()
    repository.invitation = _invitation()
    service = VenueRecruitmentInvitationService(
        repository=repository, claim_boundary=FakeClaimBoundary(), now=lambda: NOW
    )

    available = service.read(token=TOKEN, user=_user())
    assert available.viewer_state == "AVAILABLE"
    assert repository.invitation.claimed_by_user_id is None
    accepted = service.accept(token=TOKEN, user=_user(), idempotency_key="accept-invitation-0001")
    assert accepted.viewer_state == "CLAIMED_BY_VIEWER"
    assert repository.invitation.claimed_by_user_id == USER_ID

    with pytest.raises(AppError) as unavailable:
        service.read(token=TOKEN, user=_user(OTHER_USER_ID))
    assert unavailable.value.status_code == 410
    assert unavailable.value.code == "VENUE_INVITATION_UNAVAILABLE"
    assert unavailable.value.details == {}


def test_expired_and_unknown_tokens_use_fixed_opaque_errors() -> None:
    from backend.app.modules.venue_recruitment_invitations.service import (
        VenueRecruitmentInvitationService,
    )

    repository = FakeRepository()
    service = VenueRecruitmentInvitationService(
        repository=repository, claim_boundary=FakeClaimBoundary(), now=lambda: NOW
    )
    with pytest.raises(AppError) as missing:
        service.read(token=TOKEN, user=_user())
    assert (
        missing.value.status_code,
        missing.value.code,
        missing.value.message,
        missing.value.details,
    ) == (
        404,
        "VENUE_INVITATION_NOT_FOUND",
        "邀请不存在或链接格式有误。",
        {},
    )

    repository.invitation = _invitation()
    repository.invitation.expires_at = NOW
    with pytest.raises(AppError) as expired:
        service.read(token=TOKEN, user=_user())
    assert (
        expired.value.status_code,
        expired.value.code,
        expired.value.message,
        expired.value.details,
    ) == (
        410,
        "VENUE_INVITATION_UNAVAILABLE",
        "邀请已失效，请联系邀请人获取新链接。",
        {},
    )
    assert repository.invitation.status is VenueRecruitmentInvitationStatus.EXPIRED


def test_invited_claim_reuses_claim_boundary_and_only_consumes_invitation_after_success() -> None:
    from backend.app.modules.venue_recruitment_invitations.dto import (
        InvitedVenueClaimRequest,
        VenueClaimEvidence,
    )
    from backend.app.modules.venue_recruitment_invitations.service import (
        VenueRecruitmentInvitationService,
    )

    repository = FakeRepository()
    repository.invitation = _invitation(
        claimed_by=USER_ID, status=VenueRecruitmentInvitationStatus.CLAIMED
    )
    boundary = FakeClaimBoundary()
    service = VenueRecruitmentInvitationService(
        repository=repository, claim_boundary=boundary, now=lambda: NOW
    )
    request = InvitedVenueClaimRequest(
        contact_name=" 张先生 ",
        evidence=VenueClaimEvidence(
            MANAGEMENT_AUTHORIZATION=uuid.uuid4(),
            VENUE_EXTERIOR=uuid.uuid4(),
        ),
    )

    boundary.fail = True
    with pytest.raises(AppError) as invalid:
        service.submit_claim(
            token=TOKEN, user=_user(), idempotency_key="submit-invited-claim-01", request=request
        )
    assert invalid.value.code == "ONBOARDING_EVIDENCE_INVALID"
    assert repository.invitation.status is VenueRecruitmentInvitationStatus.CLAIMED
    assert repository.invitation.application_id is None

    boundary.fail = False
    result = service.submit_claim(
        token=TOKEN, user=_user(), idempotency_key="submit-invited-claim-01", request=request
    )
    replay = service.submit_claim(
        token=TOKEN, user=_user(), idempotency_key="submit-invited-claim-01", request=request
    )
    assert result.status_code == 201
    assert replay.status_code == 200
    assert repository.invitation.status is VenueRecruitmentInvitationStatus.SUBMITTED
    assert str(repository.invitation.application_id) == result.body["application_id"]
    assert boundary.calls[-1] == (USER_ID, VENUE_ID, "张先生")
