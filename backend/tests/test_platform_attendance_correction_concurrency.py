from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from queue import Queue
from threading import Barrier

import pytest
from sqlalchemy import URL, Engine, create_engine, func, select, text
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool

from backend.app.errors import AppError
from backend.app.models import (
    OpenGameAttendanceCorrection,
    OpenGameAttendanceStatus,
    OpenGameRegistration,
)
from backend.app.modules.platform_attendance_corrections.dto import (
    PlatformAttendanceCorrectionRequest,
)
from backend.app.modules.platform_attendance_corrections.repository import (
    PlatformAttendanceCorrectionRepository,
)
from backend.app.modules.platform_attendance_corrections.service import (
    PlatformAttendanceCorrectionService,
)
from backend.tests.test_open_game_attendance_service import AttendanceCase
from backend.tests.test_platform_attendance_correction_service import (
    CORRECTION_NOW,
    _seed_correctable_registration,
)

pytestmark = pytest.mark.integration


class _BarrierAfterMissingIdempotencyRepository(PlatformAttendanceCorrectionRepository):
    def __init__(self, session: Session, barrier: Barrier) -> None:
        super().__init__(session)
        self.barrier = barrier
        self.waited = False

    def get_idempotency_correction(
        self, *, principal_id: str, idempotency_key: str
    ) -> OpenGameAttendanceCorrection | None:
        correction = super().get_idempotency_correction(
            principal_id=principal_id,
            idempotency_key=idempotency_key,
        )
        if correction is None and not self.waited:
            self.waited = True
            self.barrier.wait(timeout=5)
        return correction


def _worker(
    *,
    database_url: str | URL,
    case: AttendanceCase,
    key: str,
    barrier: Barrier,
    pids: Queue[int],
    idempotency_barrier: Barrier | None = None,
) -> tuple[str, object]:
    engine = create_engine(database_url, poolclass=NullPool)
    session = Session(engine)
    try:
        backend_pid = session.scalar(text("SELECT pg_backend_pid()"))
        assert isinstance(backend_pid, int)
        pids.put(backend_pid)
        barrier.wait(timeout=5)
        repository = (
            _BarrierAfterMissingIdempotencyRepository(session, idempotency_barrier)
            if idempotency_barrier is not None
            else PlatformAttendanceCorrectionRepository(session)
        )
        service = PlatformAttendanceCorrectionService(
            repository=repository,
            now=lambda: CORRECTION_NOW,
        )
        try:
            event = service.correct(
                registration_id=case.joined_ids[0],
                principal_id="platform-admin-yangfan",
                idempotency_key=key,
                request=PlatformAttendanceCorrectionRequest(
                    attendance_status=OpenGameAttendanceStatus.PRESENT,
                    expected_version=3,
                    reason="并发核对现场签到记录。",
                ),
            )
            return "PRESENT", event.id
        except AppError as error:
            return error.code, error.details
    finally:
        session.rollback()
        session.close()
        engine.dispose()


def test_different_keys_competing_for_same_version_have_one_append_only_winner(
    pg_engine: Engine,
) -> None:
    case = _seed_correctable_registration(pg_engine)
    barrier = Barrier(2)
    pids: Queue[int] = Queue()
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [
            executor.submit(
                _worker,
                database_url=pg_engine.url,
                case=case,
                key=f"concurrent-platform-correction-key-000{index}",
                barrier=barrier,
                pids=pids,
            )
            for index in (1, 2)
        ]
        assert pids.get(timeout=5) > 0
        assert pids.get(timeout=5) > 0
        results = [future.result(timeout=10)[0] for future in futures]

    assert sorted(results) == ["ATTENDANCE_STATE_CHANGED", "PRESENT"]
    with Session(pg_engine) as session:
        registration = session.get_one(OpenGameRegistration, case.joined_ids[0])
        assert registration.attendance_status is OpenGameAttendanceStatus.PRESENT
        assert registration.version == 4
        assert session.scalar(select(func.count()).select_from(OpenGameAttendanceCorrection)) == 1


def test_same_key_concurrency_returns_the_single_first_event(
    pg_engine: Engine,
) -> None:
    case = _seed_correctable_registration(pg_engine)
    barrier = Barrier(2)
    pids: Queue[int] = Queue()
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [
            executor.submit(
                _worker,
                database_url=pg_engine.url,
                case=case,
                key="concurrent-same-platform-correction-key-001",
                barrier=barrier,
                pids=pids,
            )
            for _index in range(2)
        ]
        assert pids.get(timeout=5) > 0
        assert pids.get(timeout=5) > 0
        results = [future.result(timeout=10) for future in futures]

    assert [result[0] for result in results] == ["PRESENT", "PRESENT"]
    assert results[0][1] == results[1][1]
    with Session(pg_engine) as session:
        assert session.scalar(select(func.count()).select_from(OpenGameAttendanceCorrection)) == 1


def test_same_principal_and_key_on_different_registrations_maps_unique_race_to_409(
    pg_engine: Engine,
) -> None:
    cases = [_seed_correctable_registration(pg_engine) for _index in range(2)]
    start_barrier = Barrier(2)
    idempotency_barrier = Barrier(2)
    pids: Queue[int] = Queue()
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [
            executor.submit(
                _worker,
                database_url=pg_engine.url,
                case=case,
                key="concurrent-cross-registration-same-key-001",
                barrier=start_barrier,
                pids=pids,
                idempotency_barrier=idempotency_barrier,
            )
            for case in cases
        ]
        assert pids.get(timeout=5) > 0
        assert pids.get(timeout=5) > 0
        results = [future.result(timeout=10)[0] for future in futures]

    assert sorted(results) == ["IDEMPOTENCY_KEY_REUSED", "PRESENT"]
    with Session(pg_engine) as session:
        registrations = [
            session.get_one(OpenGameRegistration, case.joined_ids[0]) for case in cases
        ]
        assert sorted(registration.version for registration in registrations) == [3, 4]
        assert session.scalar(select(func.count()).select_from(OpenGameAttendanceCorrection)) == 1
