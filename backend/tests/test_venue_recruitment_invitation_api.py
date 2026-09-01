from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace

from fastapi.testclient import TestClient

from backend.app.database import get_database
from backend.app.main import create_app
from backend.app.models import User, VenueRecruitmentInvitationStatus
from backend.app.modules.venue_recruitment_invitations.dto import (
    MutationResult,
    RecruitmentInvitation,
    RecruitmentInvitationCreateResult,
    RecruitmentInvitationEligibleVenues,
    RecruitmentInvitations,
    RecruitmentInvitationVenue,
    VenueRecruitmentInvitation,
)
from backend.app.modules.venue_recruitment_invitations.router import (
    get_platform_recruitment_service,
    get_viewer_recruitment_service,
    require_mutating_recruitment_reviewer,
    require_recruitment_reviewer,
)

TOKEN = "Wm8Lk3R6uQ2pV9sH7xTa4bNcE5fG1jK0dZyR3qP6uQx"
INVITATION_ID = uuid.UUID("10000000-0000-4000-8000-000000000001")
VENUE_ID = uuid.UUID("20000000-0000-4000-8000-000000000002")
APPLICATION_ID = uuid.UUID("30000000-0000-4000-8000-000000000003")
NOW = datetime(2026, 9, 1, 5, 18, tzinfo=UTC)


def _venue() -> RecruitmentInvitationVenue:
    return RecruitmentInvitationVenue(
        venue_id=VENUE_ID,
        name="天津海河东体育中心足球场",
        district_name="河东区",
        address="天津市河东区津塘路156号院内东侧",
    )


def _invitation() -> RecruitmentInvitation:
    return RecruitmentInvitation(
        id=INVITATION_ID,
        venue=_venue(),
        status=VenueRecruitmentInvitationStatus.ACTIVE,
        contact_label="海河东场馆负责人",
        expires_at=NOW,
        created_at=NOW,
        claimed_at=None,
        application_id=None,
        revoked_at=None,
        revocation_reason=None,
        version=1,
    )


class _PlatformService:
    def eligible_venues(self, **_kwargs: object) -> RecruitmentInvitationEligibleVenues:
        return RecruitmentInvitationEligibleVenues(items=[_venue()], next_cursor=None)

    def list(self, **_kwargs: object) -> RecruitmentInvitations:
        return RecruitmentInvitations(items=[_invitation()], next_cursor=None)

    def create(self, **_kwargs: object) -> MutationResult:
        result = RecruitmentInvitationCreateResult(
            invitation=_invitation(),
            token=TOKEN,
            invitation_path=f"pages/venue-invitation/index?token={TOKEN}",
        )
        return MutationResult(status_code=201, body=result.model_dump(mode="json"))

    def revoke(self, **_kwargs: object) -> RecruitmentInvitation:
        return _invitation()


class _ViewerService:
    def read(self, **_kwargs: object) -> VenueRecruitmentInvitation:
        return VenueRecruitmentInvitation(
            viewer_state="AVAILABLE",
            venue=_venue(),
            expires_at=NOW,
            application_id=None,
            version=1,
        )

    def accept(self, **_kwargs: object) -> VenueRecruitmentInvitation:
        return VenueRecruitmentInvitation(
            viewer_state="CLAIMED_BY_VIEWER",
            venue=_venue(),
            expires_at=NOW,
            application_id=None,
            version=2,
        )

    def submit_claim(self, **_kwargs: object) -> MutationResult:
        return MutationResult(
            status_code=201,
            body={
                "application_id": str(APPLICATION_ID),
                "kind": "CLAIM",
                "status": "SUBMITTED",
                "venue": {
                    "venue_id": str(VENUE_ID),
                    "name": "天津海河东体育中心足球场",
                    "address": "天津市河东区津塘路156号院内东侧",
                },
                "submitted_at": NOW.isoformat(),
                "updated_at": NOW.isoformat(),
            },
        )


def _client() -> TestClient:
    app = create_app()
    user = User(id=uuid.uuid4(), wechat_app_id="wx-test", wechat_openid="viewer")
    principal = SimpleNamespace(principal=SimpleNamespace(principal_id="reviewer-1"))
    app.dependency_overrides[get_database] = lambda: object()
    app.dependency_overrides[require_recruitment_reviewer] = lambda: principal
    app.dependency_overrides[require_mutating_recruitment_reviewer] = lambda: principal
    app.dependency_overrides[get_platform_recruitment_service] = lambda: _PlatformService()
    app.dependency_overrides[get_viewer_recruitment_service] = lambda: _ViewerService()
    from backend.app.modules.auth.router import get_current_user

    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app, raise_server_exceptions=False)


def test_platform_invitation_routes_preserve_one_time_create_shape() -> None:
    with _client() as client:
        assert (
            client.get(
                "/platform-admin/api/v1/recruitment-invitations/eligible-venues?q=海河"
            ).status_code
            == 200
        )
        assert client.get("/platform-admin/api/v1/recruitment-invitations").status_code == 200
        created = client.post(
            "/platform-admin/api/v1/recruitment-invitations",
            headers={"Idempotency-Key": "d1a-create-key-0001"},
            json={"venue_id": str(VENUE_ID), "contact_label": "负责人"},
        )
        assert created.status_code == 201
        assert created.json()["token"] == TOKEN
        revoked = client.post(
            f"/platform-admin/api/v1/recruitment-invitations/{INVITATION_ID}/revoke",
            headers={"Idempotency-Key": "d1a-revoke-key-0001"},
            json={"reason": "暂不合作"},
        )
        assert revoked.status_code == 200


def test_viewer_routes_bind_and_submit_through_invited_claim_command() -> None:
    with _client() as client:
        assert (
            client.get(f"/api/v1/venue-invitations/{TOKEN}").json()["viewer_state"] == "AVAILABLE"
        )
        accepted = client.post(
            f"/api/v1/venue-invitations/{TOKEN}/accept",
            headers={"Idempotency-Key": "d1a-accept-key-0001"},
        )
        assert accepted.json()["viewer_state"] == "CLAIMED_BY_VIEWER"
        submitted = client.post(
            f"/api/v1/venue-invitations/{TOKEN}/claims",
            headers={"Idempotency-Key": "d1a-claim-key-000001"},
            json={
                "contact_name": "张三",
                "evidence": {
                    "MANAGEMENT_AUTHORIZATION": str(uuid.uuid4()),
                    "VENUE_EXTERIOR": str(uuid.uuid4()),
                },
            },
        )
        assert submitted.status_code == 201
        assert submitted.json()["application_id"] == str(APPLICATION_ID)
        assert "venue_id" not in json.dumps(submitted.request.content.decode())


def test_runtime_openapi_exposes_the_frozen_operation_ids_and_statuses() -> None:
    schema = create_app().openapi()
    expected = {
        ("/platform-admin/api/v1/recruitment-invitations/eligible-venues", "get"): (
            "searchRecruitmentInvitationEligibleVenues",
            {"200", "401", "403", "422", "503"},
        ),
        ("/platform-admin/api/v1/recruitment-invitations", "post"): (
            "createRecruitmentInvitation",
            {"200", "201", "401", "403", "409", "422", "503"},
        ),
        ("/api/v1/venue-invitations/{token}/claims", "post"): (
            "submitInvitedVenueClaim",
            {"200", "201", "401", "404", "409", "410", "422", "503"},
        ),
    }
    for (path, method), (operation_id, responses) in expected.items():
        operation = schema["paths"][path][method]
        assert operation["operationId"] == operation_id
        assert set(operation["responses"]) == responses
