from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import and_, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from backend.app.models import (
    IdempotencyRecord,
    IdempotencyState,
    Venue,
    VenueOnboardingApplication,
    VenueOnboardingEvidence,
    VenueOnboardingKind,
    VenueOnboardingStatus,
)


class VenueOnboardingRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

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
            .on_conflict_do_nothing(
                constraint="uq_idempotency_records_user_operation_key"
            )
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

    def list_candidates(self) -> list[Venue]:
        return list(
            self.session.scalars(
                select(Venue).where(
                    Venue.is_active.is_(True),
                    Venue.is_listed.is_(True),
                )
            )
        )

    def get_public_candidate(
        self,
        venue_id: uuid.UUID,
        *,
        for_update: bool = False,
    ) -> Venue | None:
        statement = select(Venue).where(
            Venue.id == venue_id,
            Venue.is_active.is_(True),
            Venue.is_listed.is_(True),
        )
        if for_update:
            statement = statement.with_for_update()
        return self.session.scalar(statement)

    def active_venues(self) -> list[Venue]:
        return list(self.session.scalars(select(Venue).where(Venue.is_active.is_(True))))

    def add_evidence(self, evidence: VenueOnboardingEvidence) -> None:
        self.session.add(evidence)
        self.session.flush()

    def get_owned_evidence_for_update(
        self,
        *,
        evidence_id: uuid.UUID,
        owner_user_id: uuid.UUID,
    ) -> VenueOnboardingEvidence | None:
        return self.session.scalar(
            select(VenueOnboardingEvidence)
            .where(
                VenueOnboardingEvidence.id == evidence_id,
                VenueOnboardingEvidence.owner_user_id == owner_user_id,
            )
            .with_for_update()
        )

    def lock_evidence(
        self,
        evidence_ids: list[uuid.UUID],
    ) -> list[VenueOnboardingEvidence]:
        return list(
            self.session.scalars(
                select(VenueOnboardingEvidence)
                .where(VenueOnboardingEvidence.id.in_(evidence_ids))
                .order_by(VenueOnboardingEvidence.id)
                .with_for_update()
            )
        )

    def find_submitted_claim(
        self,
        *,
        applicant_user_id: uuid.UUID,
        venue_id: uuid.UUID,
    ) -> VenueOnboardingApplication | None:
        return self.session.scalar(
            select(VenueOnboardingApplication).where(
                VenueOnboardingApplication.applicant_user_id == applicant_user_id,
                VenueOnboardingApplication.kind == VenueOnboardingKind.CLAIM,
                VenueOnboardingApplication.target_venue_id == venue_id,
                VenueOnboardingApplication.status == VenueOnboardingStatus.SUBMITTED,
            )
        )

    def find_submitted_create(
        self,
        *,
        applicant_user_id: uuid.UUID,
        normalized_name: str,
        normalized_address: str,
    ) -> VenueOnboardingApplication | None:
        return self.session.scalar(
            select(VenueOnboardingApplication).where(
                VenueOnboardingApplication.applicant_user_id == applicant_user_id,
                VenueOnboardingApplication.kind == VenueOnboardingKind.CREATE,
                VenueOnboardingApplication.normalized_proposed_name == normalized_name,
                VenueOnboardingApplication.normalized_proposed_address
                == normalized_address,
                VenueOnboardingApplication.status == VenueOnboardingStatus.SUBMITTED,
            )
        )

    def add_application(self, application: VenueOnboardingApplication) -> None:
        self.session.add(application)
        self.session.flush()

    def list_applications(
        self,
        *,
        applicant_user_id: uuid.UUID,
        after: tuple[datetime, uuid.UUID] | None,
        limit: int,
    ) -> list[tuple[VenueOnboardingApplication, Venue | None]]:
        statement = (
            select(VenueOnboardingApplication, Venue)
            .outerjoin(Venue, Venue.id == VenueOnboardingApplication.target_venue_id)
            .where(
                VenueOnboardingApplication.applicant_user_id == applicant_user_id
            )
        )
        if after is not None:
            submitted_at, application_id = after
            statement = statement.where(
                or_(
                    VenueOnboardingApplication.submitted_at < submitted_at,
                    and_(
                        VenueOnboardingApplication.submitted_at == submitted_at,
                        VenueOnboardingApplication.id < application_id,
                    ),
                )
            )
        statement = statement.order_by(
            VenueOnboardingApplication.submitted_at.desc(),
            VenueOnboardingApplication.id.desc(),
        ).limit(limit)
        return list(self.session.execute(statement).tuples())

    def commit(self) -> None:
        self.session.commit()

    def rollback(self) -> None:
        self.session.rollback()
