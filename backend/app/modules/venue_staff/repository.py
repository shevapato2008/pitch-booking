from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.models import (
    Venue,
    VenueMembership,
    VenueMembershipAuditEvent,
    VenueMembershipRole,
    VenueStaffInvitation,
    VenueStaffInvitationStatus,
)


@dataclass(frozen=True, slots=True)
class VenueStaffMemberRow:
    membership: VenueMembership
    display_name: str
    avatar_url: str | None


class VenueStaffRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def get_venue(self, venue_id: uuid.UUID, *, for_update: bool = False) -> Venue | None:
        statement = select(Venue).where(Venue.id == venue_id, Venue.is_active.is_(True))
        if for_update:
            statement = statement.with_for_update()
        return self.session.scalar(statement)

    def get_membership(
        self, venue_id: uuid.UUID, user_id: uuid.UUID, *, for_update: bool = False
    ) -> VenueMembership | None:
        statement = select(VenueMembership).where(
            VenueMembership.venue_id == venue_id,
            VenueMembership.user_id == user_id,
        )
        if for_update:
            statement = statement.with_for_update()
        return self.session.scalar(statement.execution_options(populate_existing=True))

    def get_membership_by_id(
        self, venue_id: uuid.UUID, membership_id: uuid.UUID, *, for_update: bool = False
    ) -> VenueMembership | None:
        statement = select(VenueMembership).where(
            VenueMembership.venue_id == venue_id,
            VenueMembership.id == membership_id,
        )
        if for_update:
            statement = statement.with_for_update()
        return self.session.scalar(statement.execution_options(populate_existing=True))

    def get_active_owner(
        self, venue_id: uuid.UUID, *, for_update: bool = False
    ) -> VenueMembership | None:
        statement = select(VenueMembership).where(
            VenueMembership.venue_id == venue_id,
            VenueMembership.role == VenueMembershipRole.OWNER,
            VenueMembership.is_active.is_(True),
        )
        if for_update:
            statement = statement.with_for_update()
        return self.session.scalar(statement.execution_options(populate_existing=True))

    def list_member_rows(self, venue_id: uuid.UUID) -> list[VenueStaffMemberRow]:
        memberships = self.session.scalars(
            select(VenueMembership)
            .where(
                VenueMembership.venue_id == venue_id,
                VenueMembership.is_active.is_(True),
            )
            .order_by(VenueMembership.role, VenueMembership.id)
        )
        return [
            VenueStaffMemberRow(
                membership=membership,
                display_name="场馆员工",
                avatar_url=None,
            )
            for membership in memberships
        ]

    def list_active_invitations(
        self, venue_id: uuid.UUID, *, now: datetime
    ) -> list[VenueStaffInvitation]:
        return list(
            self.session.scalars(
                select(VenueStaffInvitation)
                .where(
                    VenueStaffInvitation.venue_id == venue_id,
                    VenueStaffInvitation.status == VenueStaffInvitationStatus.ACTIVE,
                    VenueStaffInvitation.expires_at > now,
                )
                .order_by(VenueStaffInvitation.created_at.desc(), VenueStaffInvitation.id)
            )
        )

    def list_recent_audits(
        self, venue_id: uuid.UUID, *, limit: int
    ) -> list[VenueMembershipAuditEvent]:
        return list(
            self.session.scalars(
                select(VenueMembershipAuditEvent)
                .where(VenueMembershipAuditEvent.venue_id == venue_id)
                .order_by(
                    VenueMembershipAuditEvent.created_at.desc(),
                    VenueMembershipAuditEvent.id.desc(),
                )
                .limit(limit)
            )
        )

    def find_invitation_by_token_hash(
        self, token_hash: str, *, for_update: bool = False
    ) -> VenueStaffInvitation | None:
        statement = select(VenueStaffInvitation).where(
            VenueStaffInvitation.token_hash == token_hash
        )
        if for_update:
            statement = statement.with_for_update()
        return self.session.scalar(statement.execution_options(populate_existing=True))

    def get_invitation_by_id(
        self, venue_id: uuid.UUID, invitation_id: uuid.UUID, *, for_update: bool = False
    ) -> VenueStaffInvitation | None:
        statement = select(VenueStaffInvitation).where(
            VenueStaffInvitation.venue_id == venue_id,
            VenueStaffInvitation.id == invitation_id,
        )
        if for_update:
            statement = statement.with_for_update()
        return self.session.scalar(statement.execution_options(populate_existing=True))

    def find_idempotency(
        self,
        *,
        actor_user_id: uuid.UUID | None,
        actor_principal_id: str | None,
        operation: str,
        idempotency_key: str,
    ) -> VenueMembershipAuditEvent | None:
        actor_conditions = [
            (
                VenueMembershipAuditEvent.actor_user_id == actor_user_id
                if actor_user_id is not None
                else VenueMembershipAuditEvent.actor_user_id.is_(None)
            ),
            (
                VenueMembershipAuditEvent.actor_principal_id == actor_principal_id
                if actor_principal_id is not None
                else VenueMembershipAuditEvent.actor_principal_id.is_(None)
            ),
        ]
        return self.session.scalar(
            select(VenueMembershipAuditEvent).where(
                VenueMembershipAuditEvent.operation == operation,
                VenueMembershipAuditEvent.idempotency_key == idempotency_key,
                *actor_conditions,
            )
        )

    def add(self, value: object) -> None:
        self.session.add(value)

    def flush(self) -> None:
        self.session.flush()

    def commit(self) -> None:
        self.session.commit()

    def rollback(self) -> None:
        self.session.rollback()
