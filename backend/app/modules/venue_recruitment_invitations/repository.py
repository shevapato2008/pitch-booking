from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import and_, exists, or_, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from backend.app.models import (
    BookingMode,
    IdempotencyRecord,
    IdempotencyState,
    Venue,
    VenueMembership,
    VenueRecruitmentInvitation,
    VenueRecruitmentInvitationStatus,
)


class VenueRecruitmentInvitationRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def lock_venue(self, venue_id: uuid.UUID) -> Venue | None:
        return self.session.scalar(select(Venue).where(Venue.id == venue_id).with_for_update())

    def has_active_membership(self, venue_id: uuid.UUID) -> bool:
        return bool(
            self.session.scalar(
                select(
                    exists().where(
                        VenueMembership.venue_id == venue_id,
                        VenueMembership.is_active.is_(True),
                    )
                )
            )
        )

    def expire_due(self, now: datetime) -> None:
        self.session.execute(
            update(VenueRecruitmentInvitation)
            .where(
                VenueRecruitmentInvitation.status.in_(
                    (
                        VenueRecruitmentInvitationStatus.ACTIVE,
                        VenueRecruitmentInvitationStatus.CLAIMED,
                    )
                ),
                VenueRecruitmentInvitation.expires_at <= now,
            )
            .values(
                status=VenueRecruitmentInvitationStatus.EXPIRED,
                version=VenueRecruitmentInvitation.version + 1,
            )
        )

    def find_create_by_key(self, principal_id: str, key: str) -> VenueRecruitmentInvitation | None:
        return self.session.scalar(
            select(VenueRecruitmentInvitation)
            .where(
                VenueRecruitmentInvitation.created_by_principal_id == principal_id,
                VenueRecruitmentInvitation.create_idempotency_key == key,
            )
            .with_for_update()
        )

    def find_revoke_by_key(self, principal_id: str, key: str) -> VenueRecruitmentInvitation | None:
        return self.session.scalar(
            select(VenueRecruitmentInvitation)
            .where(
                VenueRecruitmentInvitation.revoked_by_principal_id == principal_id,
                VenueRecruitmentInvitation.revoke_idempotency_key == key,
            )
            .with_for_update()
        )

    def find_live_for_venue(self, venue_id: uuid.UUID) -> VenueRecruitmentInvitation | None:
        return self.session.scalar(
            select(VenueRecruitmentInvitation)
            .where(
                VenueRecruitmentInvitation.venue_id == venue_id,
                VenueRecruitmentInvitation.status.in_(
                    (
                        VenueRecruitmentInvitationStatus.ACTIVE,
                        VenueRecruitmentInvitationStatus.CLAIMED,
                    )
                ),
            )
            .with_for_update()
        )

    def find_by_token_sha256(
        self, digest: str, *, for_update: bool = False
    ) -> VenueRecruitmentInvitation | None:
        statement = select(VenueRecruitmentInvitation).where(
            VenueRecruitmentInvitation.token_sha256 == digest
        )
        if for_update:
            statement = statement.with_for_update()
        return self.session.scalar(statement)

    def get_with_venue(
        self,
        invitation_id: uuid.UUID,
        *,
        for_update: bool = False,
    ) -> tuple[VenueRecruitmentInvitation, Venue] | None:
        statement = (
            select(VenueRecruitmentInvitation, Venue)
            .join(Venue, Venue.id == VenueRecruitmentInvitation.venue_id)
            .where(VenueRecruitmentInvitation.id == invitation_id)
        )
        if for_update:
            statement = statement.with_for_update(of=VenueRecruitmentInvitation)
        return self.session.execute(statement).one_or_none()

    def venue_for_invitation(self, invitation: VenueRecruitmentInvitation) -> Venue:
        return self.session.get_one(Venue, invitation.venue_id)

    def list_eligible(
        self,
        *,
        query: str | None,
        after: tuple[str, uuid.UUID] | None,
        limit: int,
        now: datetime,
    ) -> list[Venue]:
        active_membership = exists().where(
            VenueMembership.venue_id == Venue.id,
            VenueMembership.is_active.is_(True),
        )
        live_invitation = exists().where(
            VenueRecruitmentInvitation.venue_id == Venue.id,
            VenueRecruitmentInvitation.status.in_(
                (
                    VenueRecruitmentInvitationStatus.ACTIVE,
                    VenueRecruitmentInvitationStatus.CLAIMED,
                )
            ),
            VenueRecruitmentInvitation.expires_at > now,
        )
        statement = select(Venue).where(
            Venue.is_active.is_(True),
            Venue.is_listed.is_(True),
            Venue.booking_mode == BookingMode.DIRECTORY_ONLY,
            ~active_membership,
            ~live_invitation,
        )
        if query:
            pattern = f"%{query}%"
            statement = statement.where(
                or_(
                    Venue.name.ilike(pattern),
                    Venue.address.ilike(pattern),
                    Venue.district_name.ilike(pattern),
                )
            )
        if after is not None:
            name, venue_id = after
            statement = statement.where(
                or_(Venue.name > name, and_(Venue.name == name, Venue.id > venue_id))
            )
        return list(self.session.scalars(statement.order_by(Venue.name, Venue.id).limit(limit)))

    def list_invitations(
        self,
        *,
        status: VenueRecruitmentInvitationStatus | None,
        after: tuple[datetime, uuid.UUID] | None,
        limit: int,
    ) -> list[tuple[VenueRecruitmentInvitation, Venue]]:
        statement = select(VenueRecruitmentInvitation, Venue).join(
            Venue, Venue.id == VenueRecruitmentInvitation.venue_id
        )
        if status is not None:
            statement = statement.where(VenueRecruitmentInvitation.status == status)
        if after is not None:
            created_at, invitation_id = after
            statement = statement.where(
                or_(
                    VenueRecruitmentInvitation.created_at < created_at,
                    and_(
                        VenueRecruitmentInvitation.created_at == created_at,
                        VenueRecruitmentInvitation.id < invitation_id,
                    ),
                )
            )
        return list(
            self.session.execute(
                statement.order_by(
                    VenueRecruitmentInvitation.created_at.desc(),
                    VenueRecruitmentInvitation.id.desc(),
                ).limit(limit)
            ).tuples()
        )

    def claim_idempotency(
        self,
        *,
        user_id: uuid.UUID,
        operation: str,
        key: str,
        request_sha256: str,
    ) -> tuple[IdempotencyRecord, bool]:
        inserted_id = self.session.scalar(
            insert(IdempotencyRecord)
            .values(
                id=uuid.uuid4(),
                user_id=user_id,
                operation=operation,
                key=key,
                request_sha256=request_sha256,
                state=IdempotencyState.CLAIMED,
                response_status=None,
                response_body=None,
            )
            .on_conflict_do_nothing(constraint="uq_idempotency_records_user_operation_key")
            .returning(IdempotencyRecord.id)
        )
        if inserted_id is not None:
            return self.session.get_one(IdempotencyRecord, inserted_id), True
        record = self.session.scalar(
            select(IdempotencyRecord)
            .where(
                IdempotencyRecord.user_id == user_id,
                IdempotencyRecord.operation == operation,
                IdempotencyRecord.key == key,
            )
            .with_for_update()
        )
        if record is None:
            raise RuntimeError("idempotency conflict did not resolve")
        return record, False

    @staticmethod
    def read_idempotency(
        record: IdempotencyRecord,
    ) -> tuple[str, dict[str, object] | None]:
        return record.request_sha256, record.response_body

    def complete_idempotency(
        self,
        record: IdempotencyRecord,
        *,
        response_status: int,
        response_body: dict[str, object],
    ) -> None:
        record.state = IdempotencyState.COMPLETED
        record.response_status = response_status
        record.response_body = response_body
        self.session.flush()

    def add(self, value: object) -> None:
        self.session.add(value)
        self.session.flush()

    def flush(self) -> None:
        self.session.flush()

    def commit(self) -> None:
        self.session.commit()

    def rollback(self) -> None:
        self.session.rollback()
