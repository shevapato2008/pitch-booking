from __future__ import annotations

import hashlib
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier

import pytest
from sqlalchemy import Engine, create_engine, func, select
from sqlalchemy.engine import URL
from sqlalchemy.orm import Session

from backend.app.errors import AppError
from backend.app.models import (
    BookingMode,
    Venue,
    VenueRecruitmentInvitation,
    VenueRecruitmentInvitationStatus,
)
from backend.app.modules.venue_recruitment_invitations.dto import (
    RecruitmentInvitationCreateRequest,
    RecruitmentInvitationRevokeRequest,
)
from backend.app.modules.venue_recruitment_invitations.repository import (
    VenueRecruitmentInvitationRepository,
)
from backend.app.modules.venue_recruitment_invitations.service import (
    PlatformRecruitmentInvitationService,
)

pytestmark = pytest.mark.integration

NOW = datetime(2026, 9, 1, 12, 0, tzinfo=UTC)
PRINCIPAL = "platform-concurrency-reviewer"
CREATE_KEY = "concurrent-create-invitation-key-001"
REVOKE_KEY = "concurrent-revoke-invitation-key-001"


class BarrierRepository(VenueRecruitmentInvitationRepository):
    def __init__(
        self,
        session: Session,
        *,
        create_barrier: Barrier | None = None,
        revoke_barrier: Barrier | None = None,
    ) -> None:
        super().__init__(session)
        self.create_barrier = create_barrier
        self.revoke_barrier = revoke_barrier
        self.create_checked = False
        self.revoke_checked = False

    def find_create_by_key(
        self, principal_id: str, key: str
    ) -> VenueRecruitmentInvitation | None:
        result = super().find_create_by_key(principal_id, key)
        if result is None and self.create_barrier is not None and not self.create_checked:
            self.create_checked = True
            self.create_barrier.wait(timeout=5)
        return result

    def find_revoke_by_key(
        self, principal_id: str, key: str
    ) -> VenueRecruitmentInvitation | None:
        result = super().find_revoke_by_key(principal_id, key)
        if result is None and self.revoke_barrier is not None and not self.revoke_checked:
            self.revoke_checked = True
            self.revoke_barrier.wait(timeout=5)
        return result


def venue(index: int) -> Venue:
    return Venue(
        id=uuid.UUID(f"20000000-0000-4000-8000-{index:012d}"),
        slug=f"d1a-concurrency-{index}",
        name=f"并发验收场馆 {index}",
        description="",
        address=f"天津市河东区并发路 {index} 号",
        district_code="120102",
        district_name="河东区",
        latitude=39.12,
        longitude=117.25,
        booking_mode=BookingMode.DIRECTORY_ONLY,
        navigation_poi_name=f"并发验收场馆 {index}",
        navigation_latitude=39.12,
        navigation_longitude=117.25,
        sort_order=index,
        content_verified_at=NOW,
        is_listed=True,
        is_primary=False,
        is_active=True,
    )


def invitation(target: Venue, index: int) -> VenueRecruitmentInvitation:
    token = f"invitation-token-{index}"
    return VenueRecruitmentInvitation(
        id=uuid.UUID(f"30000000-0000-4000-8000-{index:012d}"),
        venue_id=target.id,
        token_sha256=hashlib.sha256(token.encode()).hexdigest(),
        status=VenueRecruitmentInvitationStatus.ACTIVE,
        contact_label=f"场馆联系人 {index}",
        expires_at=NOW + timedelta(days=7),
        created_at=NOW,
        created_by_principal_id="seed-reviewer",
        create_idempotency_key=f"seed-create-invitation-key-{index:03d}",
        create_request_sha256=hashlib.sha256(f"seed-{index}".encode()).hexdigest(),
        version=1,
    )


def create_worker(
    database_url: URL,
    *,
    target_id: uuid.UUID,
    barrier: Barrier,
) -> tuple[int | str, str]:
    engine = create_engine(database_url)
    try:
        with Session(engine) as session:
            service = PlatformRecruitmentInvitationService(
                repository=BarrierRepository(session, create_barrier=barrier),
                now=lambda: NOW,
            )
            try:
                result = service.create(
                    principal_id=PRINCIPAL,
                    idempotency_key=CREATE_KEY,
                    request=RecruitmentInvitationCreateRequest(
                        venue_id=target_id,
                        contact_label="并发验收联系人",
                    ),
                )
            except AppError as error:
                return error.code, ""
            body = result.body
            invitation_body = body["invitation"] if result.status_code == 201 else body
            assert isinstance(invitation_body, dict)
            return result.status_code, str(invitation_body["id"])
    finally:
        engine.dispose()


def revoke_worker(
    database_url: URL,
    *,
    invitation_id: uuid.UUID,
    barrier: Barrier,
) -> tuple[str, int | None]:
    engine = create_engine(database_url)
    try:
        with Session(engine) as session:
            service = PlatformRecruitmentInvitationService(
                repository=BarrierRepository(session, revoke_barrier=barrier),
                now=lambda: NOW,
            )
            try:
                result = service.revoke(
                    invitation_id=invitation_id,
                    principal_id=PRINCIPAL,
                    idempotency_key=REVOKE_KEY,
                    request=RecruitmentInvitationRevokeRequest(reason="并发撤销验收"),
                )
            except AppError as error:
                return error.code, None
            return str(result.id), result.version
    finally:
        engine.dispose()


def test_same_create_key_on_one_venue_replays_after_the_venue_lock(
    pg_engine: Engine,
) -> None:
    target = venue(1)
    target_id = target.id
    with Session(pg_engine) as session:
        session.add(target)
        session.commit()

    barrier = Barrier(2)
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = [
            future.result(timeout=10)
            for future in [
                executor.submit(
                    create_worker,
                    pg_engine.url,
                    target_id=target_id,
                    barrier=barrier,
                )
                for _index in range(2)
            ]
        ]

    assert sorted(status for status, _id in results) == [200, 201]
    assert len({invitation_id for _status, invitation_id in results}) == 1
    with Session(pg_engine) as session:
        assert session.scalar(select(func.count()).select_from(VenueRecruitmentInvitation)) == 1


def test_same_create_key_on_two_venues_maps_the_unique_race_to_reuse(
    pg_engine: Engine,
) -> None:
    targets = [venue(1), venue(2)]
    target_ids = [target.id for target in targets]
    with Session(pg_engine) as session:
        session.add_all(targets)
        session.commit()

    barrier = Barrier(2)
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = [
            future.result(timeout=10)
            for future in [
                executor.submit(
                    create_worker,
                    pg_engine.url,
                    target_id=target_id,
                    barrier=barrier,
                )
                for target_id in target_ids
            ]
        ]

    assert sorted(str(status) for status, _id in results) == ["201", "IDEMPOTENCY_KEY_REUSED"]
    with Session(pg_engine) as session:
        assert session.scalar(select(func.count()).select_from(VenueRecruitmentInvitation)) == 1


def test_same_revoke_key_on_one_invitation_replays_after_the_invitation_lock(
    pg_engine: Engine,
) -> None:
    target = venue(1)
    record = invitation(target, 1)
    record_id = record.id
    with Session(pg_engine) as session:
        session.add_all([target, record])
        session.commit()

    barrier = Barrier(2)
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = [
            future.result(timeout=10)
            for future in [
                executor.submit(
                    revoke_worker,
                    pg_engine.url,
                    invitation_id=record_id,
                    barrier=barrier,
                )
                for _index in range(2)
            ]
        ]

    assert results == [(str(record_id), 2), (str(record_id), 2)]


def test_same_revoke_key_on_two_invitations_maps_the_unique_race_to_reuse(
    pg_engine: Engine,
) -> None:
    targets = [venue(1), venue(2)]
    records = [invitation(target, index) for index, target in enumerate(targets, 1)]
    record_ids = [record.id for record in records]
    with Session(pg_engine) as session:
        session.add_all([*targets, *records])
        session.commit()

    barrier = Barrier(2)
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = [
            future.result(timeout=10)
            for future in [
                executor.submit(
                    revoke_worker,
                    pg_engine.url,
                    invitation_id=invitation_id,
                    barrier=barrier,
                )
                for invitation_id in record_ids
            ]
        ]

    assert [result[0] for result in results].count("IDEMPOTENCY_KEY_REUSED") == 1
    succeeded = [result for result in results if result[0] != "IDEMPOTENCY_KEY_REUSED"]
    assert len(succeeded) == 1
    assert succeeded[0][0] in {str(record_id) for record_id in record_ids}
    assert succeeded[0][1] == 2
    with Session(pg_engine) as session:
        assert session.scalar(
            select(func.count()).select_from(VenueRecruitmentInvitation).where(
                VenueRecruitmentInvitation.status == VenueRecruitmentInvitationStatus.REVOKED
            )
        ) == 1
