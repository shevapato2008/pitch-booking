from __future__ import annotations

import hashlib
import json
import re
import secrets
import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import cast

from pydantic import BaseModel

from backend.app.errors import AppError
from backend.app.models import (
    User,
    Venue,
    VenueMembership,
    VenueMembershipAuditAction,
    VenueMembershipAuditActorKind,
    VenueMembershipAuditEvent,
    VenueMembershipRole,
    VenueStaffInvitationStatus,
)
from backend.app.models import (
    VenueStaffInvitation as VenueStaffInvitationRecord,
)
from backend.app.modules.venue_staff.dto import (
    CreateInvitationResult,
    CreateVenueStaffInvitationRequest,
    CurrentVenueStaffInvitation,
    RemoveVenueStaffMemberRequest,
    TransferVenueOwnerRequest,
    UpdateVenueStaffPermissionsRequest,
    VenueOwnerTransferResult,
    VenueStaffAuditSummary,
    VenueStaffInvitation,
    VenueStaffInvitationCreated,
    VenueStaffMember,
    VenueStaffMembershipAccepted,
    VenueStaffOverview,
    VenueStaffPermission,
)
from backend.app.modules.venue_staff.repository import (
    VenueStaffMemberRow,
    VenueStaffRepository,
)

INVITATION_TTL = timedelta(days=7)
INVITATION_PATH_PREFIX = "/pages/venue-staff-invitation/index?token="
WORKSPACE_PATH = "/pages/venue-workspace/index"
_TOKEN = re.compile(r"[A-Za-z0-9_-]{43}", re.ASCII)
_ALL_PERMISSIONS = tuple(VenueStaffPermission)


class VenueStaffAuthorizationService:
    def __init__(
        self,
        *,
        repository: VenueStaffRepository,
        now: Callable[[], datetime] | None = None,
        token_factory: Callable[[], str] | None = None,
    ) -> None:
        self.repository = repository
        self.now = now or (lambda: datetime.now(UTC))
        self.token_factory = token_factory or (lambda: secrets.token_urlsafe(32))

    def get_overview(self, *, venue_id: uuid.UUID, user: User) -> VenueStaffOverview:
        venue = self.repository.get_venue(venue_id)
        viewer = self.repository.get_membership(venue_id, user.id)
        if venue is None or viewer is None or not viewer.is_active:
            raise _not_found()
        owner = viewer.role is VenueMembershipRole.OWNER
        rows = self.repository.list_member_rows(venue_id)
        if not owner:
            rows = [row for row in rows if row.membership.id == viewer.id]
        return VenueStaffOverview(
            venue_id=venue.id,
            venue_name=venue.name,
            viewer_role=viewer.role,
            viewer_permissions=_permissions(viewer),
            can_manage=owner,
            members=[_member(row, viewer_user_id=user.id) for row in rows],
            active_invitations=(
                [
                    _invitation(item)
                    for item in self.repository.list_active_invitations(venue_id, now=self.now())
                ]
                if owner
                else []
            ),
            recent_audits=(
                [
                    _audit_summary(item)
                    for item in self.repository.list_recent_audits(venue_id, limit=20)
                ]
                if owner
                else []
            ),
        )

    def create_invitation(
        self,
        *,
        venue_id: uuid.UUID,
        user: User,
        request: CreateVenueStaffInvitationRequest,
        idempotency_key: str,
    ) -> CreateInvitationResult:
        operation = "create_venue_staff_invitation"
        request_hash = _request_hash(
            {
                "venue_id": str(venue_id),
                "contact_label": request.contact_label,
                "permissions": _permission_values(request.permissions),
            }
        )
        try:
            venue, owner = self._lock_owner(venue_id, user.id)
            replay = self._user_replay(
                user_id=user.id,
                operation=operation,
                idempotency_key=idempotency_key,
                request_hash=request_hash,
                response_model=VenueStaffInvitation,
            )
            if replay is not None:
                return CreateInvitationResult(response=replay, created=False)

            raw_token = self.token_factory()
            if _TOKEN.fullmatch(raw_token) is None:
                raise RuntimeError("invitation token factory returned an invalid token")
            now = self.now()
            invitation = VenueStaffInvitationRecord(
                id=uuid.uuid4(),
                venue_id=venue.id,
                token_hash=hashlib.sha256(raw_token.encode("ascii")).hexdigest(),
                contact_label=request.contact_label,
                status=VenueStaffInvitationStatus.ACTIVE,
                created_by_membership_id=owner.id,
                accepted_by_membership_id=None,
                revoked_by_membership_id=None,
                version=1,
                created_at=now,
                expires_at=now + INVITATION_TTL,
                accepted_at=None,
                revoked_at=None,
            )
            _set_permissions(invitation, request.permissions)
            self.repository.add(invitation)
            self.repository.flush()
            safe = _invitation(invitation)
            created = VenueStaffInvitationCreated(
                **safe.model_dump(),
                invitation_path=f"{INVITATION_PATH_PREFIX}{raw_token}",
            )
            self._add_audit(
                venue_id=venue.id,
                actor_user_id=user.id,
                action=VenueMembershipAuditAction.INVITATION_CREATED,
                operation=operation,
                idempotency_key=idempotency_key,
                request_hash=request_hash,
                target_membership_id=None,
                invitation_id=invitation.id,
                permissions_before=[],
                permissions_after=request.permissions,
                target_display_name=invitation.contact_label,
                reason=None,
                response_status=201,
                response_body=cast(dict[str, object], safe.model_dump(mode="json")),
            )
            self.repository.commit()
            return CreateInvitationResult(response=created, created=True)
        except Exception:
            self.repository.rollback()
            raise

    def get_current_invitation(self, *, user: User, raw_token: str) -> CurrentVenueStaffInvitation:
        del user
        invitation = self._invitation_for_token(raw_token)
        if not _invitation_available(invitation, self.now()):
            raise _invitation_unavailable()
        venue = self.repository.get_venue(invitation.venue_id)
        if venue is None:
            raise _invitation_unavailable()
        return _current_invitation(invitation, venue)

    def accept_invitation(
        self,
        *,
        user: User,
        raw_token: str,
        idempotency_key: str,
    ) -> VenueStaffMembershipAccepted:
        token_hash = _token_hash(raw_token)
        located = self.repository.find_invitation_by_token_hash(token_hash)
        if located is None:
            raise _invitation_unavailable()
        operation = "accept_venue_staff_invitation"
        request_hash = _request_hash({"invitation_id": str(located.id), "token_hash": token_hash})
        try:
            venue = self.repository.get_venue(located.venue_id, for_update=True)
            invitation = self.repository.find_invitation_by_token_hash(token_hash, for_update=True)
            if venue is None or invitation is None:
                raise _invitation_unavailable()
            replay = self._user_replay(
                user_id=user.id,
                operation=operation,
                idempotency_key=idempotency_key,
                request_hash=request_hash,
                response_model=VenueStaffMembershipAccepted,
            )
            if replay is not None:
                return replay
            if not _invitation_available(invitation, self.now()):
                raise _invitation_unavailable()
            existing = self.repository.get_membership(venue.id, user.id, for_update=True)
            if (
                existing is not None
                and existing.is_active
                and existing.role is VenueMembershipRole.OWNER
            ):
                raise AppError(
                    409,
                    "OWNER_TRANSFER_REQUIRED",
                    "负责人不能通过员工邀请变更身份。",
                )
            before = _permissions(existing) if existing is not None else []
            if existing is None:
                existing = VenueMembership(
                    id=uuid.uuid4(),
                    venue_id=venue.id,
                    user_id=user.id,
                    role=VenueMembershipRole.STAFF,
                    is_active=True,
                    version=1,
                    revoked_at=None,
                )
                self.repository.add(existing)
            else:
                existing.role = VenueMembershipRole.STAFF
                existing.is_active = True
                existing.revoked_at = None
                existing.version += 1
            invitation_permissions = _permissions(invitation)
            _set_permissions(existing, invitation_permissions)
            self.repository.flush()
            invitation.status = VenueStaffInvitationStatus.ACCEPTED
            invitation.accepted_at = self.now()
            invitation.accepted_by_membership_id = existing.id
            invitation.version += 1
            response = VenueStaffMembershipAccepted(
                venue_id=venue.id,
                venue_name=venue.name,
                membership=_member(
                    VenueStaffMemberRow(existing, "场馆员工", None),
                    viewer_user_id=user.id,
                ),
                workspace_path=WORKSPACE_PATH,
            )
            self._add_audit(
                venue_id=venue.id,
                actor_user_id=user.id,
                action=VenueMembershipAuditAction.INVITATION_ACCEPTED,
                operation=operation,
                idempotency_key=idempotency_key,
                request_hash=request_hash,
                target_membership_id=existing.id,
                invitation_id=invitation.id,
                permissions_before=before,
                permissions_after=invitation_permissions,
                target_display_name=invitation.contact_label,
                reason=None,
                response_status=200,
                response_body=cast(dict[str, object], response.model_dump(mode="json")),
            )
            self.repository.commit()
            return response
        except Exception:
            self.repository.rollback()
            raise

    def revoke_invitation(
        self,
        *,
        venue_id: uuid.UUID,
        invitation_id: uuid.UUID,
        user: User,
        idempotency_key: str,
    ) -> VenueStaffInvitation:
        operation = "revoke_venue_staff_invitation"
        request_hash = _request_hash(
            {"venue_id": str(venue_id), "invitation_id": str(invitation_id)}
        )
        try:
            venue, owner = self._lock_owner(venue_id, user.id)
            invitation = self.repository.get_invitation_by_id(
                venue.id, invitation_id, for_update=True
            )
            replay = self._user_replay(
                user_id=user.id,
                operation=operation,
                idempotency_key=idempotency_key,
                request_hash=request_hash,
                response_model=VenueStaffInvitation,
            )
            if replay is not None:
                return replay
            if invitation is None:
                raise _not_found()
            if not _invitation_available(invitation, self.now()):
                raise _state_changed()
            before = _permissions(invitation)
            invitation.status = VenueStaffInvitationStatus.REVOKED
            invitation.revoked_at = self.now()
            invitation.revoked_by_membership_id = owner.id
            invitation.version += 1
            response = _invitation(invitation)
            self._add_audit(
                venue_id=venue.id,
                actor_user_id=user.id,
                action=VenueMembershipAuditAction.INVITATION_REVOKED,
                operation=operation,
                idempotency_key=idempotency_key,
                request_hash=request_hash,
                target_membership_id=None,
                invitation_id=invitation.id,
                permissions_before=before,
                permissions_after=[],
                target_display_name=invitation.contact_label,
                reason=None,
                response_status=200,
                response_body=cast(dict[str, object], response.model_dump(mode="json")),
            )
            self.repository.commit()
            return response
        except Exception:
            self.repository.rollback()
            raise

    def update_permissions(
        self,
        *,
        venue_id: uuid.UUID,
        membership_id: uuid.UUID,
        user: User,
        request: UpdateVenueStaffPermissionsRequest,
        idempotency_key: str,
    ) -> VenueStaffMember:
        operation = "update_venue_staff_permissions"
        request_hash = _request_hash(
            {
                "venue_id": str(venue_id),
                "membership_id": str(membership_id),
                "expected_version": request.expected_version,
                "permissions": _permission_values(request.permissions),
            }
        )
        try:
            venue, _owner = self._lock_owner(venue_id, user.id)
            replay = self._user_replay(
                user_id=user.id,
                operation=operation,
                idempotency_key=idempotency_key,
                request_hash=request_hash,
                response_model=VenueStaffMember,
            )
            if replay is not None:
                return replay
            target = self.repository.get_membership_by_id(venue.id, membership_id, for_update=True)
            if target is None or not target.is_active:
                raise _not_found()
            if target.role is VenueMembershipRole.OWNER:
                raise _owner_transfer_required()
            if target.version != request.expected_version:
                raise _state_changed()
            before = _permissions(target)
            _set_permissions(target, request.permissions)
            target.version += 1
            response = _member(
                VenueStaffMemberRow(target, "场馆员工", None),
                viewer_user_id=user.id,
            )
            self._add_audit(
                venue_id=venue.id,
                actor_user_id=user.id,
                action=VenueMembershipAuditAction.PERMISSIONS_UPDATED,
                operation=operation,
                idempotency_key=idempotency_key,
                request_hash=request_hash,
                target_membership_id=target.id,
                invitation_id=None,
                permissions_before=before,
                permissions_after=request.permissions,
                target_display_name=response.display_name,
                reason=None,
                response_status=200,
                response_body=cast(dict[str, object], response.model_dump(mode="json")),
            )
            self.repository.commit()
            return response
        except Exception:
            self.repository.rollback()
            raise

    def remove_member(
        self,
        *,
        venue_id: uuid.UUID,
        membership_id: uuid.UUID,
        user: User,
        request: RemoveVenueStaffMemberRequest,
        idempotency_key: str,
    ) -> VenueStaffMember:
        operation = "remove_venue_staff_member"
        request_hash = _request_hash(
            {
                "venue_id": str(venue_id),
                "membership_id": str(membership_id),
                "expected_version": request.expected_version,
                "reason": request.reason,
            }
        )
        try:
            venue, _owner = self._lock_owner(venue_id, user.id)
            replay = self._user_replay(
                user_id=user.id,
                operation=operation,
                idempotency_key=idempotency_key,
                request_hash=request_hash,
                response_model=VenueStaffMember,
            )
            if replay is not None:
                return replay
            target = self.repository.get_membership_by_id(venue.id, membership_id, for_update=True)
            if target is None or not target.is_active:
                raise _not_found()
            if target.role is VenueMembershipRole.OWNER:
                raise _owner_transfer_required()
            if target.version != request.expected_version:
                raise _state_changed()
            before = _permissions(target)
            target.is_active = False
            target.revoked_at = self.now()
            target.version += 1
            response = _member(
                VenueStaffMemberRow(target, "场馆员工", None),
                viewer_user_id=user.id,
            )
            self._add_audit(
                venue_id=venue.id,
                actor_user_id=user.id,
                action=VenueMembershipAuditAction.MEMBER_REMOVED,
                operation=operation,
                idempotency_key=idempotency_key,
                request_hash=request_hash,
                target_membership_id=target.id,
                invitation_id=None,
                permissions_before=before,
                permissions_after=before,
                target_display_name=response.display_name,
                reason=request.reason,
                response_status=200,
                response_body=cast(dict[str, object], response.model_dump(mode="json")),
            )
            self.repository.commit()
            return response
        except Exception:
            self.repository.rollback()
            raise

    def transfer_owner(
        self,
        *,
        venue_id: uuid.UUID,
        principal_id: str,
        request: TransferVenueOwnerRequest,
        idempotency_key: str,
    ) -> VenueOwnerTransferResult:
        operation = "transfer_venue_owner"
        request_hash = _request_hash(
            {
                "venue_id": str(venue_id),
                "target_membership_id": str(request.target_membership_id),
                "expected_source_version": request.expected_source_version,
                "expected_target_version": request.expected_target_version,
                "reason": request.reason,
            }
        )
        try:
            venue = self.repository.get_venue(venue_id, for_update=True)
            if venue is None:
                raise _not_found()
            replay = self._platform_replay(
                principal_id=principal_id,
                operation=operation,
                idempotency_key=idempotency_key,
                request_hash=request_hash,
                response_model=VenueOwnerTransferResult,
            )
            if replay is not None:
                return replay
            source = self.repository.get_active_owner(venue.id, for_update=True)
            target = self.repository.get_membership_by_id(
                venue.id, request.target_membership_id, for_update=True
            )
            if source is None or target is None or not target.is_active:
                raise _not_found()
            if target.role is not VenueMembershipRole.STAFF or target.id == source.id:
                raise _state_changed()
            if (
                source.version != request.expected_source_version
                or target.version != request.expected_target_version
            ):
                raise _state_changed()
            target_before = _permissions(target)
            source.role = VenueMembershipRole.STAFF
            _set_permissions(source, _ALL_PERMISSIONS)
            source.version += 1
            self.repository.flush()
            target.role = VenueMembershipRole.OWNER
            _set_permissions(target, _ALL_PERMISSIONS)
            target.version += 1
            self.repository.flush()
            result = VenueOwnerTransferResult(
                venue_id=venue.id,
                previous_owner=_member(
                    VenueStaffMemberRow(source, "场馆员工", None),
                    viewer_user_id=None,
                ),
                current_owner=_member(
                    VenueStaffMemberRow(target, "场馆员工", None),
                    viewer_user_id=None,
                ),
                transferred_at=self.now(),
            )
            self._add_audit(
                venue_id=venue.id,
                actor_principal_id=principal_id,
                action=VenueMembershipAuditAction.OWNER_TRANSFERRED,
                operation=operation,
                idempotency_key=idempotency_key,
                request_hash=request_hash,
                target_membership_id=target.id,
                invitation_id=None,
                permissions_before=target_before,
                permissions_after=_ALL_PERMISSIONS,
                target_display_name=result.current_owner.display_name,
                reason=request.reason,
                response_status=200,
                response_body=cast(dict[str, object], result.model_dump(mode="json")),
            )
            self.repository.commit()
            return result
        except Exception:
            self.repository.rollback()
            raise

    def _lock_owner(self, venue_id: uuid.UUID, user_id: uuid.UUID) -> tuple[Venue, VenueMembership]:
        venue = self.repository.get_venue(venue_id, for_update=True)
        if venue is None:
            raise _not_found()
        membership = self.repository.get_membership(venue.id, user_id, for_update=True)
        if (
            membership is None
            or not membership.is_active
            or membership.role is not VenueMembershipRole.OWNER
        ):
            raise _not_found()
        return venue, membership

    def _invitation_for_token(self, raw_token: str) -> VenueStaffInvitationRecord:
        token_hash = _token_hash(raw_token)
        invitation = self.repository.find_invitation_by_token_hash(token_hash)
        if invitation is None:
            raise _invitation_unavailable()
        return invitation

    def _user_replay[T: BaseModel](
        self,
        *,
        user_id: uuid.UUID,
        operation: str,
        idempotency_key: str,
        request_hash: str,
        response_model: type[T],
    ) -> T | None:
        audit = self.repository.find_idempotency(
            actor_user_id=user_id,
            actor_principal_id=None,
            operation=operation,
            idempotency_key=idempotency_key,
        )
        return _replay(audit, request_hash=request_hash, response_model=response_model)

    def _platform_replay[T: BaseModel](
        self,
        *,
        principal_id: str,
        operation: str,
        idempotency_key: str,
        request_hash: str,
        response_model: type[T],
    ) -> T | None:
        audit = self.repository.find_idempotency(
            actor_user_id=None,
            actor_principal_id=principal_id,
            operation=operation,
            idempotency_key=idempotency_key,
        )
        return _replay(audit, request_hash=request_hash, response_model=response_model)

    def _add_audit(
        self,
        *,
        venue_id: uuid.UUID,
        action: VenueMembershipAuditAction,
        operation: str,
        idempotency_key: str,
        request_hash: str,
        target_membership_id: uuid.UUID | None,
        invitation_id: uuid.UUID | None,
        permissions_before: list[VenueStaffPermission] | tuple[VenueStaffPermission, ...],
        permissions_after: list[VenueStaffPermission] | tuple[VenueStaffPermission, ...],
        target_display_name: str,
        reason: str | None,
        response_status: int,
        response_body: dict[str, object],
        actor_user_id: uuid.UUID | None = None,
        actor_principal_id: str | None = None,
    ) -> None:
        actor_kind = (
            VenueMembershipAuditActorKind.USER
            if actor_user_id is not None
            else VenueMembershipAuditActorKind.PLATFORM
        )
        self.repository.add(
            VenueMembershipAuditEvent(
                id=uuid.uuid4(),
                venue_id=venue_id,
                actor_kind=actor_kind,
                actor_user_id=actor_user_id,
                actor_principal_id=actor_principal_id,
                target_membership_id=target_membership_id,
                invitation_id=invitation_id,
                action=action,
                operation=operation,
                idempotency_key=idempotency_key,
                request_sha256=request_hash,
                permissions_before=_permission_values(permissions_before),
                permissions_after=_permission_values(permissions_after),
                target_display_name=target_display_name,
                reason=reason,
                response_status=response_status,
                response_body=response_body,
                created_at=self.now(),
            )
        )
        self.repository.flush()


def _permissions(
    value: VenueMembership | VenueStaffInvitationRecord | None,
) -> list[VenueStaffPermission]:
    if value is None:
        return []
    if isinstance(value, VenueMembership) and value.role is VenueMembershipRole.OWNER:
        return list(_ALL_PERMISSIONS)
    return [
        permission
        for permission, field in (
            (VenueStaffPermission.MANAGE_PROFILE, "can_manage_profile"),
            (VenueStaffPermission.MANAGE_PITCHES, "can_manage_pitches"),
            (VenueStaffPermission.MANAGE_INVENTORY, "can_manage_inventory"),
            (VenueStaffPermission.FULFILL_ORDERS, "can_fulfill_orders"),
        )
        if getattr(value, field)
    ]


def _set_permissions(
    value: VenueMembership | VenueStaffInvitationRecord,
    permissions: list[VenueStaffPermission] | tuple[VenueStaffPermission, ...],
) -> None:
    selected = set(permissions)
    value.can_manage_profile = VenueStaffPermission.MANAGE_PROFILE in selected
    value.can_manage_pitches = VenueStaffPermission.MANAGE_PITCHES in selected
    value.can_manage_inventory = VenueStaffPermission.MANAGE_INVENTORY in selected
    value.can_fulfill_orders = VenueStaffPermission.FULFILL_ORDERS in selected


def _member(row: VenueStaffMemberRow, *, viewer_user_id: uuid.UUID | None) -> VenueStaffMember:
    membership = row.membership
    return VenueStaffMember.model_validate(
        {
            "id": membership.id,
            "display_name": row.display_name,
            "avatar_url": row.avatar_url,
            "role": membership.role,
            "permissions": _permissions(membership),
            "is_self": viewer_user_id is not None and membership.user_id == viewer_user_id,
            "is_active": membership.is_active,
            "version": membership.version,
        }
    )


def _invitation(value: VenueStaffInvitationRecord) -> VenueStaffInvitation:
    return VenueStaffInvitation(
        id=value.id,
        contact_label=value.contact_label,
        status=value.status,
        permissions=_permissions(value),
        expires_at=value.expires_at,
        created_at=value.created_at,
    )


def _current_invitation(
    invitation: VenueStaffInvitationRecord, venue: Venue
) -> CurrentVenueStaffInvitation:
    return CurrentVenueStaffInvitation(
        id=invitation.id,
        venue_id=venue.id,
        venue_name=venue.name,
        status=invitation.status,
        permissions=_permissions(invitation),
        expires_at=invitation.expires_at,
    )


def _audit_summary(value: VenueMembershipAuditEvent) -> VenueStaffAuditSummary:
    return VenueStaffAuditSummary(
        id=value.id,
        action=value.action,
        target_display_name=value.target_display_name,
        created_at=value.created_at,
    )


def _invitation_available(invitation: VenueStaffInvitationRecord, now: datetime) -> bool:
    return invitation.status is VenueStaffInvitationStatus.ACTIVE and invitation.expires_at > now


def _token_hash(raw_token: str) -> str:
    if _TOKEN.fullmatch(raw_token) is None:
        raise _invitation_unavailable()
    return hashlib.sha256(raw_token.encode("ascii")).hexdigest()


def _permission_values(
    permissions: list[VenueStaffPermission] | tuple[VenueStaffPermission, ...],
) -> list[str]:
    selected = set(permissions)
    return [permission.value for permission in _ALL_PERMISSIONS if permission in selected]


def _request_hash(value: dict[str, object]) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _replay[T: BaseModel](
    audit: VenueMembershipAuditEvent | None,
    *,
    request_hash: str,
    response_model: type[T],
) -> T | None:
    if audit is None:
        return None
    if audit.request_sha256 != request_hash:
        raise AppError(409, "IDEMPOTENCY_KEY_REUSED", "幂等键已用于其他请求。")
    return response_model.model_validate(audit.response_body)


def _not_found() -> AppError:
    return AppError(404, "VENUE_STAFF_NOT_FOUND", "场馆或成员不存在。")


def _state_changed() -> AppError:
    return AppError(409, "VENUE_STAFF_STATE_CHANGED", "成员或邀请状态已变化。")


def _owner_transfer_required() -> AppError:
    return AppError(409, "OWNER_TRANSFER_REQUIRED", "负责人变更请联系平台处理。")


def _invitation_unavailable() -> AppError:
    return AppError(
        410,
        "VENUE_STAFF_INVITATION_UNAVAILABLE",
        "邀请已失效，请联系场馆负责人重新获取。",
    )
