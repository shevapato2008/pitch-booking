from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.database import get_database
from backend.app.main import create_app
from backend.app.models import User, VenueMembershipRole, VenueStaffInvitationStatus
from backend.app.modules.auth.router import get_current_user
from backend.app.modules.venue_staff.dto import (
    CreateInvitationResult,
    CurrentVenueStaffInvitation,
    VenueOwnerTransferResult,
    VenueStaffInvitation,
    VenueStaffInvitationCreated,
    VenueStaffMember,
    VenueStaffMembershipAccepted,
    VenueStaffOverview,
    VenueStaffPermission,
)
from backend.app.modules.venue_staff.router import (
    get_venue_staff_service,
    require_mutating_venue_staff_platform_admin,
    require_venue_staff_authorization_enabled,
)

NOW = datetime(2026, 9, 1, 8, 0, tzinfo=UTC)
VENUE_ID = uuid.UUID("10000000-0000-0000-0000-000000000001")
MEMBERSHIP_ID = uuid.UUID("20000000-0000-0000-0000-000000000001")
INVITATION_ID = uuid.UUID("30000000-0000-0000-0000-000000000001")
USER_ID = uuid.UUID("40000000-0000-0000-0000-000000000001")
RAW_TOKEN = "S" * 43
KEY = "d1b-http-journey-0001"


def _member(role: VenueMembershipRole = VenueMembershipRole.STAFF) -> VenueStaffMember:
    return VenueStaffMember(
        id=MEMBERSHIP_ID,
        display_name="场馆员工",
        avatar_url=None,
        role=role,
        permissions=list(VenueStaffPermission),
        is_self=True,
        is_active=True,
        version=1,
    )


def _invitation() -> VenueStaffInvitation:
    return VenueStaffInvitation(
        id=INVITATION_ID,
        contact_label="晚班员工",
        status=VenueStaffInvitationStatus.ACTIVE,
        permissions=[VenueStaffPermission.MANAGE_INVENTORY],
        created_at=NOW,
        expires_at=NOW + timedelta(days=7),
    )


class FakeService:
    def __init__(self) -> None:
        self.received_token: str | None = None

    def get_overview(self, **_kwargs: object) -> VenueStaffOverview:
        return VenueStaffOverview(
            venue_id=VENUE_ID,
            venue_name="渤海元丰足球场",
            viewer_role=VenueMembershipRole.OWNER,
            viewer_permissions=list(VenueStaffPermission),
            can_manage=True,
            members=[_member(VenueMembershipRole.OWNER)],
            active_invitations=[_invitation()],
            recent_audits=[],
        )

    def create_invitation(self, **_kwargs: object) -> CreateInvitationResult:
        return CreateInvitationResult(
            response=VenueStaffInvitationCreated(
                **_invitation().model_dump(),
                invitation_path=(
                    "/pages/venue-staff-invitation/index?token=" + RAW_TOKEN
                ),
            ),
            created=True,
        )

    def revoke_invitation(self, **_kwargs: object) -> VenueStaffInvitation:
        return _invitation().model_copy(
            update={"status": VenueStaffInvitationStatus.REVOKED}
        )

    def update_permissions(self, **_kwargs: object) -> VenueStaffMember:
        return _member()

    def remove_member(self, **_kwargs: object) -> VenueStaffMember:
        return _member().model_copy(update={"is_active": False, "version": 2})

    def get_current_invitation(self, **kwargs: object) -> CurrentVenueStaffInvitation:
        self.received_token = str(kwargs["raw_token"])
        return CurrentVenueStaffInvitation(
            id=INVITATION_ID,
            venue_id=VENUE_ID,
            venue_name="渤海元丰足球场",
            status=VenueStaffInvitationStatus.ACTIVE,
            permissions=[VenueStaffPermission.MANAGE_INVENTORY],
            expires_at=NOW + timedelta(days=7),
        )

    def accept_invitation(self, **kwargs: object) -> VenueStaffMembershipAccepted:
        self.received_token = str(kwargs["raw_token"])
        return VenueStaffMembershipAccepted(
            venue_id=VENUE_ID,
            venue_name="渤海元丰足球场",
            membership=_member(),
            workspace_path="/pages/venue-workspace/index",
        )

    def transfer_owner(self, **_kwargs: object) -> VenueOwnerTransferResult:
        return VenueOwnerTransferResult(
            venue_id=VENUE_ID,
            previous_owner=_member(),
            current_owner=_member(VenueMembershipRole.OWNER),
            transferred_at=NOW,
        )


def _client(*, enabled: bool = True) -> tuple[TestClient, FakeService]:
    app = create_app(
        settings=Settings(venue_staff_authorization_enabled=enabled)
    )
    service = FakeService()
    app.dependency_overrides[get_database] = lambda: object()
    app.dependency_overrides[get_current_user] = lambda: User(
        id=USER_ID,
        wechat_app_id="wx-test",
        wechat_openid="d1b-user",
    )
    app.dependency_overrides[get_venue_staff_service] = lambda: service
    app.dependency_overrides[require_mutating_venue_staff_platform_admin] = lambda: (
        SimpleNamespace(principal=SimpleNamespace(principal_id="platform-admin"))
    )
    if enabled:
        app.dependency_overrides[require_venue_staff_authorization_enabled] = lambda: None
    return TestClient(app, raise_server_exceptions=False), service


def test_feature_is_disabled_by_default_and_gate_returns_stable_error() -> None:
    assert Settings().venue_staff_authorization_enabled is False
    client, _service = _client(enabled=False)
    with client:
        response = client.get(f"/api/v1/admin/venues/{VENUE_ID}/staff")
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "VENUE_STAFF_AUTHORIZATION_DISABLED"


def test_owner_routes_cover_create_revoke_update_and_remove() -> None:
    client, _service = _client()
    with client:
        assert client.get(f"/api/v1/admin/venues/{VENUE_ID}/staff").status_code == 200
        created = client.post(
            f"/api/v1/admin/venues/{VENUE_ID}/staff-invitations",
            headers={"Idempotency-Key": KEY},
            json={"contact_label": "晚班员工", "permissions": ["MANAGE_INVENTORY"]},
        )
        assert created.status_code == 201
        assert created.json()["invitation_path"].endswith(RAW_TOKEN)
        assert (
            client.post(
                f"/api/v1/admin/venues/{VENUE_ID}/staff-invitations/"
                f"{INVITATION_ID}/revoke",
                headers={"Idempotency-Key": KEY},
            ).status_code
            == 200
        )
        assert (
            client.put(
                f"/api/v1/admin/venues/{VENUE_ID}/staff/{MEMBERSHIP_ID}",
                headers={"Idempotency-Key": KEY},
                json={"expected_version": 1, "permissions": ["MANAGE_PROFILE"]},
            ).status_code
            == 200
        )
        assert (
            client.post(
                f"/api/v1/admin/venues/{VENUE_ID}/staff/{MEMBERSHIP_ID}/remove",
                headers={"Idempotency-Key": KEY},
                json={"expected_version": 1, "reason": "员工离职"},
            ).status_code
            == 200
        )


def test_invitation_secret_is_only_read_from_the_redacted_header() -> None:
    client, service = _client()
    headers = {"X-Venue-Staff-Invitation-Token": RAW_TOKEN}
    with client:
        current = client.get(
            "/api/v1/venue-staff-invitations/current",
            headers=headers,
        )
        accepted = client.post(
            "/api/v1/venue-staff-invitations/current/accept",
            headers={**headers, "Idempotency-Key": KEY},
        )
    assert current.status_code == 200
    assert accepted.status_code == 200
    assert service.received_token == RAW_TOKEN
    assert RAW_TOKEN not in str(current.request.url)
    assert RAW_TOKEN not in str(accepted.request.url)


def test_platform_admin_owner_transfer_is_a_real_mutating_route() -> None:
    client, _service = _client()
    with client:
        response = client.post(
            f"/platform-admin/api/v1/venues/{VENUE_ID}/owner-transfers",
            headers={"Idempotency-Key": KEY},
            json={
                "target_membership_id": str(MEMBERSHIP_ID),
                "expected_source_version": 1,
                "expected_target_version": 1,
                "reason": "负责人账号变更",
            },
        )
    assert response.status_code == 200
    assert response.json()["current_owner"]["role"] == "OWNER"


def test_runtime_openapi_keeps_the_eight_frozen_operations_and_secret_header() -> None:
    schema = create_app().openapi()
    expected = (
        ("/api/v1/admin/venues/{venue_id}/staff", "get", {"200", "401", "404", "503"}),
        (
            "/api/v1/admin/venues/{venue_id}/staff-invitations",
            "post",
            {"200", "201", "401", "404", "409", "422", "503"},
        ),
        (
            "/api/v1/admin/venues/{venue_id}/staff-invitations/{invitation_id}/revoke",
            "post",
            {"200", "401", "404", "409", "422", "503"},
        ),
        (
            "/api/v1/admin/venues/{venue_id}/staff/{membership_id}",
            "put",
            {"200", "401", "404", "409", "422", "503"},
        ),
        (
            "/api/v1/admin/venues/{venue_id}/staff/{membership_id}/remove",
            "post",
            {"200", "401", "404", "409", "422", "503"},
        ),
        (
            "/api/v1/venue-staff-invitations/current",
            "get",
            {"200", "401", "404", "410", "503"},
        ),
        (
            "/api/v1/venue-staff-invitations/current/accept",
            "post",
            {"200", "401", "409", "410", "422", "503"},
        ),
        (
            "/platform-admin/api/v1/venues/{venue_id}/owner-transfers",
            "post",
            {"200", "401", "403", "404", "409", "422", "503"},
        ),
    )
    for path, method, statuses in expected:
        operation = schema["paths"][path][method]
        assert set(operation["responses"]) == statuses
        assert operation["security"] == [
            {"platformSession": []}
            if path.startswith("/platform-admin/")
            else {"bearerAuth": []}
        ]

    for path, method in (
        ("/api/v1/venue-staff-invitations/current", "get"),
        ("/api/v1/venue-staff-invitations/current/accept", "post"),
    ):
        parameters = schema["paths"][path][method]["parameters"]
        token_parameter = next(
            item
            for item in parameters
            if item.get("name") == "X-Venue-Staff-Invitation-Token"
        )
        assert token_parameter["in"] == "header"
        assert token_parameter["required"] is True
        assert all(item.get("name") != "token" for item in parameters)

    transfer_parameters = schema["paths"][expected[-1][0]]["post"]["parameters"]
    assert {
        item["name"]: item["required"]
        for item in transfer_parameters
        if item["name"] in {"Origin", "X-CSRF-Token"}
    } == {"Origin": True, "X-CSRF-Token": True}
