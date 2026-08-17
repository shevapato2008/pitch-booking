from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import and_, or_, select, text
from sqlalchemy.orm import Session

from backend.app.models import (
    User,
    Venue,
    VenueMembership,
    VenueOnboardingApplication,
    VenueOnboardingEvidence,
    VenueOnboardingEvidenceState,
    VenueOnboardingKind,
    VenueOnboardingStatus,
)

CREATE_APPROVAL_ADVISORY_LOCK = 8_641_700_009


class PlatformOnboardingRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def list_applications(
        self,
        *,
        kind: VenueOnboardingKind | None,
        status: VenueOnboardingStatus | None,
        after: tuple[datetime, uuid.UUID] | None,
        limit: int,
    ) -> list[tuple[VenueOnboardingApplication, Venue | None]]:
        statement = select(VenueOnboardingApplication, Venue).outerjoin(
            Venue,
            Venue.id == VenueOnboardingApplication.target_venue_id,
        )
        if kind is not None:
            statement = statement.where(VenueOnboardingApplication.kind == kind)
        if status is not None:
            statement = statement.where(VenueOnboardingApplication.status == status)
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

    def get_application_detail(
        self,
        application_id: uuid.UUID,
    ) -> tuple[VenueOnboardingApplication, Venue | None, User] | None:
        return self.session.execute(
            select(VenueOnboardingApplication, Venue, User)
            .join(User, User.id == VenueOnboardingApplication.applicant_user_id)
            .outerjoin(Venue, Venue.id == VenueOnboardingApplication.target_venue_id)
            .where(VenueOnboardingApplication.id == application_id)
        ).one_or_none()

    def list_application_evidence(
        self,
        application_id: uuid.UUID,
    ) -> list[VenueOnboardingEvidence]:
        return list(
            self.session.scalars(
                select(VenueOnboardingEvidence)
                .where(
                    VenueOnboardingEvidence.application_id == application_id,
                    VenueOnboardingEvidence.state
                    == VenueOnboardingEvidenceState.COMPLETED,
                )
                .order_by(VenueOnboardingEvidence.kind, VenueOnboardingEvidence.id)
            )
        )

    def get_attached_evidence(
        self,
        evidence_id: uuid.UUID,
    ) -> VenueOnboardingEvidence | None:
        return self.session.scalar(
            select(VenueOnboardingEvidence)
            .join(
                VenueOnboardingApplication,
                VenueOnboardingApplication.id
                == VenueOnboardingEvidence.application_id,
            )
            .where(
                VenueOnboardingEvidence.id == evidence_id,
                VenueOnboardingEvidence.application_id.is_not(None),
                VenueOnboardingEvidence.state
                == VenueOnboardingEvidenceState.COMPLETED,
            )
        )

    def lock_application(
        self,
        application_id: uuid.UUID,
    ) -> VenueOnboardingApplication | None:
        return self.session.scalar(
            select(VenueOnboardingApplication)
            .where(VenueOnboardingApplication.id == application_id)
            .with_for_update()
        )

    def lock_venue(self, venue_id: uuid.UUID) -> Venue | None:
        return self.session.scalar(
            select(Venue).where(Venue.id == venue_id).with_for_update()
        )

    def acquire_create_approval_lock(self) -> None:
        self.session.execute(
            text("SELECT pg_advisory_xact_lock(:lock_key)"),
            {"lock_key": CREATE_APPROVAL_ADVISORY_LOCK},
        )

    def active_venues(self) -> list[Venue]:
        return list(self.session.scalars(select(Venue).where(Venue.is_active.is_(True))))

    def get_membership_for_update(
        self,
        *,
        venue_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> VenueMembership | None:
        return self.session.scalar(
            select(VenueMembership)
            .where(
                VenueMembership.venue_id == venue_id,
                VenueMembership.user_id == user_id,
            )
            .with_for_update()
        )

    def add(self, value: object) -> None:
        self.session.add(value)
        self.session.flush()

    def flush(self) -> None:
        self.session.flush()

    def commit(self) -> None:
        self.session.commit()

    def rollback(self) -> None:
        self.session.rollback()
