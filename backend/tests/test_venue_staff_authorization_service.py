import hashlib
import uuid
from datetime import UTC, datetime, timedelta

import pytest

from backend.app.errors import AppError
from backend.app.models import (
    User,
    Venue,
    VenueMembership,
    VenueMembershipAuditEvent,
    VenueMembershipRole,
    VenueStaffInvitation,
    VenueStaffInvitationStatus,
)
from backend.app.modules.venue_staff.dto import (
    CreateVenueStaffInvitationRequest,
    RemoveVenueStaffMemberRequest,
    TransferVenueOwnerRequest,
    UpdateVenueStaffPermissionsRequest,
    VenueStaffInvitationCreated,
    VenueStaffPermission,
)
from backend.app.modules.venue_staff.repository import VenueStaffMemberRow
from backend.app.modules.venue_staff.service import VenueStaffAuthorizationService

NOW = datetime(2026, 9, 1, 8, 0, tzinfo=UTC)
VENUE_ID = uuid.UUID("10000000-0000-0000-0000-000000000001")
OWNER_USER_ID = uuid.UUID("20000000-0000-0000-0000-000000000001")
STAFF_USER_ID = uuid.UUID("20000000-0000-0000-0000-000000000002")
OTHER_USER_ID = uuid.UUID("20000000-0000-0000-0000-000000000003")
RAW_TOKEN = "A" * 43


def venue() -> Venue:
    return Venue(
        id=VENUE_ID,
        slug="venue-d1b",
        name="渤海元丰足球场",
        description="测试场馆",
        price_advantage_text="价格透明",
        timezone="Asia/Shanghai",
        business_hours_text="09:00-23:00",
        address="天津市南开区测试路 1 号",
        district_code="120104",
        district_name="南开区",
        parking_text="可停车",
        phone="13800000000",
        refund_policy_text="按规则退款",
        latitude=39.1,
        longitude=117.2,
        navigation_poi_name="渤海元丰足球场",
        navigation_latitude=39.1,
        navigation_longitude=117.2,
        public_pitch_types=["FIVE_A_SIDE"],
        is_active=True,
    )


def user(user_id: uuid.UUID) -> User:
    return User(id=user_id, wechat_app_id="wx-test", wechat_openid=f"openid-{user_id}")


def membership(
    *,
    user_id: uuid.UUID,
    role: VenueMembershipRole,
    permissions: tuple[VenueStaffPermission, ...],
    active: bool = True,
    version: int = 1,
) -> VenueMembership:
    selected = set(permissions)
    return VenueMembership(
        id=uuid.uuid4(),
        venue_id=VENUE_ID,
        user_id=user_id,
        role=role,
        is_active=active,
        can_manage_profile=VenueStaffPermission.MANAGE_PROFILE in selected,
        can_manage_pitches=VenueStaffPermission.MANAGE_PITCHES in selected,
        can_manage_inventory=VenueStaffPermission.MANAGE_INVENTORY in selected,
        can_fulfill_orders=VenueStaffPermission.FULFILL_ORDERS in selected,
        version=version,
        revoked_at=None if active else NOW - timedelta(days=1),
    )


ALL_PERMISSIONS = tuple(VenueStaffPermission)


class MemoryRepository:
    def __init__(self) -> None:
        self.venue = venue()
        self.memberships = [
            membership(
                user_id=OWNER_USER_ID,
                role=VenueMembershipRole.OWNER,
                permissions=ALL_PERMISSIONS,
            )
        ]
        self.invitations: list[VenueStaffInvitation] = []
        self.audits: list[VenueMembershipAuditEvent] = []
        self.commits = 0
        self.rollbacks = 0

    def get_venue(self, venue_id: uuid.UUID, *, for_update: bool = False) -> Venue | None:
        del for_update
        return self.venue if venue_id == self.venue.id and self.venue.is_active else None

    def get_membership(
        self, venue_id: uuid.UUID, user_id: uuid.UUID, *, for_update: bool = False
    ) -> VenueMembership | None:
        del for_update
        return next(
            (
                item
                for item in self.memberships
                if item.venue_id == venue_id and item.user_id == user_id
            ),
            None,
        )

    def get_membership_by_id(
        self, venue_id: uuid.UUID, membership_id: uuid.UUID, *, for_update: bool = False
    ) -> VenueMembership | None:
        del for_update
        return next(
            (
                item
                for item in self.memberships
                if item.venue_id == venue_id and item.id == membership_id
            ),
            None,
        )

    def get_active_owner(
        self, venue_id: uuid.UUID, *, for_update: bool = False
    ) -> VenueMembership | None:
        del for_update
        return next(
            (
                item
                for item in self.memberships
                if item.venue_id == venue_id
                and item.is_active
                and item.role is VenueMembershipRole.OWNER
            ),
            None,
        )

    def list_member_rows(self, venue_id: uuid.UUID) -> list[VenueStaffMemberRow]:
        return [
            VenueStaffMemberRow(membership=item, display_name="场馆员工", avatar_url=None)
            for item in self.memberships
            if item.venue_id == venue_id and item.is_active
        ]

    def list_active_invitations(
        self, venue_id: uuid.UUID, *, now: datetime
    ) -> list[VenueStaffInvitation]:
        return [
            item
            for item in self.invitations
            if item.venue_id == venue_id
            and item.status is VenueStaffInvitationStatus.ACTIVE
            and item.expires_at > now
        ]

    def list_recent_audits(
        self, venue_id: uuid.UUID, *, limit: int
    ) -> list[VenueMembershipAuditEvent]:
        return [item for item in reversed(self.audits) if item.venue_id == venue_id][:limit]

    def find_invitation_by_token_hash(
        self, token_hash: str, *, for_update: bool = False
    ) -> VenueStaffInvitation | None:
        del for_update
        return next((item for item in self.invitations if item.token_hash == token_hash), None)

    def get_invitation_by_id(
        self, venue_id: uuid.UUID, invitation_id: uuid.UUID, *, for_update: bool = False
    ) -> VenueStaffInvitation | None:
        del for_update
        return next(
            (
                item
                for item in self.invitations
                if item.venue_id == venue_id and item.id == invitation_id
            ),
            None,
        )

    def find_idempotency(
        self,
        *,
        actor_user_id: uuid.UUID | None,
        actor_principal_id: str | None,
        operation: str,
        idempotency_key: str,
    ) -> VenueMembershipAuditEvent | None:
        return next(
            (
                item
                for item in self.audits
                if item.actor_user_id == actor_user_id
                and item.actor_principal_id == actor_principal_id
                and item.operation == operation
                and item.idempotency_key == idempotency_key
            ),
            None,
        )

    def add(self, value: object) -> None:
        if isinstance(value, VenueMembership):
            self.memberships.append(value)
        elif isinstance(value, VenueStaffInvitation):
            self.invitations.append(value)
        elif isinstance(value, VenueMembershipAuditEvent):
            self.audits.append(value)
        else:  # pragma: no cover - catches accidental repository drift
            raise TypeError(type(value).__name__)

    def flush(self) -> None:
        return None

    def commit(self) -> None:
        self.commits += 1

    def rollback(self) -> None:
        self.rollbacks += 1


def service(repository: MemoryRepository) -> VenueStaffAuthorizationService:
    return VenueStaffAuthorizationService(
        repository=repository,  # type: ignore[arg-type]
        now=lambda: NOW,
        token_factory=lambda: RAW_TOKEN,
    )


def create_request(
    *permissions: VenueStaffPermission,
) -> CreateVenueStaffInvitationRequest:
    return CreateVenueStaffInvitationRequest(
        contact_label="晚班员工",
        permissions=list(permissions or (VenueStaffPermission.MANAGE_INVENTORY,)),
    )


def create_invitation(
    repository: MemoryRepository,
    *,
    permissions: tuple[VenueStaffPermission, ...] = (VenueStaffPermission.MANAGE_PROFILE,),
    token: str = RAW_TOKEN,
) -> VenueStaffInvitation:
    selected = set(permissions)
    invitation = VenueStaffInvitation(
        id=uuid.uuid4(),
        venue_id=VENUE_ID,
        token_hash=hashlib.sha256(token.encode("ascii")).hexdigest(),
        contact_label="晚班员工",
        status=VenueStaffInvitationStatus.ACTIVE,
        can_manage_profile=VenueStaffPermission.MANAGE_PROFILE in selected,
        can_manage_pitches=VenueStaffPermission.MANAGE_PITCHES in selected,
        can_manage_inventory=VenueStaffPermission.MANAGE_INVENTORY in selected,
        can_fulfill_orders=VenueStaffPermission.FULFILL_ORDERS in selected,
        created_by_membership_id=repository.memberships[0].id,
        accepted_by_membership_id=None,
        revoked_by_membership_id=None,
        version=1,
        created_at=NOW,
        expires_at=NOW + timedelta(days=7),
        accepted_at=None,
        revoked_at=None,
    )
    repository.invitations.append(invitation)
    return invitation


def assert_error(error: pytest.ExceptionInfo[AppError], status: int, code: str) -> None:
    assert error.value.status_code == status
    assert error.value.code == code


def test_create_returns_secret_once_and_replay_returns_only_safe_metadata() -> None:
    repository = MemoryRepository()
    subject = service(repository)
    request = create_request(VenueStaffPermission.MANAGE_INVENTORY)

    first = subject.create_invitation(
        venue_id=VENUE_ID,
        user=user(OWNER_USER_ID),
        request=request,
        idempotency_key="create-staff-invitation-0001",
    )
    replay = subject.create_invitation(
        venue_id=VENUE_ID,
        user=user(OWNER_USER_ID),
        request=request,
        idempotency_key="create-staff-invitation-0001",
    )

    assert first.created is True
    assert isinstance(first.response, VenueStaffInvitationCreated)
    assert first.response.invitation_path.endswith(RAW_TOKEN)
    assert replay.created is False
    assert not hasattr(replay.response, "invitation_path")
    assert repository.invitations[0].token_hash == hashlib.sha256(RAW_TOKEN.encode()).hexdigest()
    assert RAW_TOKEN not in str(repository.audits[0].response_body)
    assert repository.commits == 1


@pytest.mark.parametrize("active", [True, False])
def test_accept_consumes_invitation_and_exactly_overwrites_staff_permissions(active: bool) -> None:
    repository = MemoryRepository()
    existing = membership(
        user_id=STAFF_USER_ID,
        role=VenueMembershipRole.STAFF,
        permissions=(VenueStaffPermission.MANAGE_INVENTORY, VenueStaffPermission.FULFILL_ORDERS),
        active=active,
        version=3,
    )
    repository.memberships.append(existing)
    invitation = create_invitation(
        repository,
        permissions=(VenueStaffPermission.MANAGE_PROFILE,),
    )

    response = service(repository).accept_invitation(
        user=user(STAFF_USER_ID),
        raw_token=RAW_TOKEN,
        idempotency_key="accept-staff-invitation-0001",
    )

    assert response.membership.permissions == [VenueStaffPermission.MANAGE_PROFILE]
    assert existing.is_active is True
    assert existing.revoked_at is None
    assert existing.version == 4
    assert existing.can_manage_profile is True
    assert existing.can_manage_inventory is False
    assert existing.can_fulfill_orders is False
    assert invitation.status is VenueStaffInvitationStatus.ACCEPTED
    assert invitation.accepted_by_membership_id == existing.id


def test_active_owner_cannot_accept_staff_invitation_and_invitation_stays_active() -> None:
    repository = MemoryRepository()
    invitation = create_invitation(repository)

    with pytest.raises(AppError) as captured:
        service(repository).accept_invitation(
            user=user(OWNER_USER_ID),
            raw_token=RAW_TOKEN,
            idempotency_key="accept-staff-invitation-owner",
        )

    assert_error(captured, 409, "OWNER_TRANSFER_REQUIRED")
    assert invitation.status is VenueStaffInvitationStatus.ACTIVE
    assert invitation.accepted_at is None
    assert repository.audits == []


def test_owner_can_update_remove_and_revoke_but_never_mutate_owner_as_staff() -> None:
    repository = MemoryRepository()
    staff = membership(
        user_id=STAFF_USER_ID,
        role=VenueMembershipRole.STAFF,
        permissions=(VenueStaffPermission.MANAGE_INVENTORY,),
        version=2,
    )
    repository.memberships.append(staff)
    invitation = create_invitation(repository)
    subject = service(repository)

    updated = subject.update_permissions(
        venue_id=VENUE_ID,
        membership_id=staff.id,
        user=user(OWNER_USER_ID),
        request=UpdateVenueStaffPermissionsRequest(
            expected_version=2,
            permissions=[VenueStaffPermission.FULFILL_ORDERS],
        ),
        idempotency_key="update-staff-permission-0001",
    )
    assert updated.permissions == [VenueStaffPermission.FULFILL_ORDERS]
    assert staff.version == 3

    revoked = subject.revoke_invitation(
        venue_id=VENUE_ID,
        invitation_id=invitation.id,
        user=user(OWNER_USER_ID),
        idempotency_key="revoke-staff-invitation-0001",
    )
    assert revoked.status is VenueStaffInvitationStatus.REVOKED

    removed = subject.remove_member(
        venue_id=VENUE_ID,
        membership_id=staff.id,
        user=user(OWNER_USER_ID),
        request=RemoveVenueStaffMemberRequest(expected_version=3, reason="员工离职"),
        idempotency_key="remove-staff-member-0001",
    )
    assert removed.is_active is False
    assert staff.revoked_at == NOW
    assert staff.version == 4

    owner = repository.memberships[0]
    with pytest.raises(AppError) as captured:
        subject.update_permissions(
            venue_id=VENUE_ID,
            membership_id=owner.id,
            user=user(OWNER_USER_ID),
            request=UpdateVenueStaffPermissionsRequest(
                expected_version=owner.version,
                permissions=[VenueStaffPermission.MANAGE_PROFILE],
            ),
            idempotency_key="update-owner-forbidden-0001",
        )
    assert_error(captured, 409, "OWNER_TRANSFER_REQUIRED")


def test_platform_transfer_keeps_exactly_one_owner_and_demotes_source_with_all_permissions() -> (
    None
):
    repository = MemoryRepository()
    target = membership(
        user_id=STAFF_USER_ID,
        role=VenueMembershipRole.STAFF,
        permissions=(VenueStaffPermission.MANAGE_INVENTORY,),
        version=7,
    )
    repository.memberships.append(target)
    source = repository.memberships[0]

    result = service(repository).transfer_owner(
        venue_id=VENUE_ID,
        principal_id="platform-admin",
        request=TransferVenueOwnerRequest(
            target_membership_id=target.id,
            expected_source_version=source.version,
            expected_target_version=target.version,
            reason="负责人账号变更",
        ),
        idempotency_key="transfer-venue-owner-0001",
    )

    assert result.previous_owner.role is VenueMembershipRole.STAFF
    assert result.previous_owner.permissions == list(ALL_PERMISSIONS)
    assert result.current_owner.role is VenueMembershipRole.OWNER
    assert result.current_owner.permissions == list(ALL_PERMISSIONS)
    assert sum(item.role is VenueMembershipRole.OWNER for item in repository.memberships) == 1


def test_staff_overview_is_self_only_and_unavailable_invitation_states_are_opaque() -> None:
    repository = MemoryRepository()
    staff = membership(
        user_id=STAFF_USER_ID,
        role=VenueMembershipRole.STAFF,
        permissions=(VenueStaffPermission.MANAGE_PITCHES,),
    )
    repository.memberships.append(staff)
    expired = create_invitation(repository, token="B" * 43)
    expired.expires_at = NOW
    subject = service(repository)

    overview = subject.get_overview(venue_id=VENUE_ID, user=user(STAFF_USER_ID))
    assert overview.can_manage is False
    assert [item.id for item in overview.members] == [staff.id]
    assert overview.active_invitations == []
    assert overview.recent_audits == []

    for raw_token in ("B" * 43, "C" * 43):
        with pytest.raises(AppError) as captured:
            subject.get_current_invitation(user=user(OTHER_USER_ID), raw_token=raw_token)
        assert_error(captured, 410, "VENUE_STAFF_INVITATION_UNAVAILABLE")
