from concurrent.futures import Future, ThreadPoolExecutor
from datetime import timedelta
from queue import Queue
from threading import Barrier, Event
from typing import Literal

import pytest
from sqlalchemy import URL, Engine, create_engine, event, func, select, text
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool

from backend.app.errors import AppError
from backend.app.models import (
    IdempotencyRecord,
    OpenGame,
    OpenGameAttendanceCorrection,
    OpenGameAttendanceStatus,
    OpenGameCancellationSource,
    OpenGameRegistration,
    OpenGameStatus,
    Order,
    OrderStatus,
)
from backend.app.modules.open_game_registrations.dto import (
    OpenGameAttendanceMarkRequest,
)
from backend.app.modules.open_game_registrations.repository import (
    OpenGameRegistrationRepository,
)
from backend.app.modules.open_game_registrations.service import (
    OpenGameRegistrationService,
)
from backend.app.modules.open_games.repository import OpenGameRepository
from backend.app.modules.orders.repository import OrderRepository
from backend.tests.test_open_game_attendance_service import (
    ATTENDANCE_NOW,
    AttendanceCase,
    _seed_completed_attendance_game,
)
from backend.tests.test_open_game_registration_concurrency import (
    _wait_for_database_lock,
)

pytestmark = pytest.mark.integration

AttendanceMarkStatus = Literal[
    OpenGameAttendanceStatus.PRESENT,
    OpenGameAttendanceStatus.NO_SHOW,
]


def _attendance_worker(
    *,
    database_url: str | URL,
    case: AttendanceCase,
    attendance_status: AttendanceMarkStatus,
    idempotency_key: str,
    pid_queue: Queue[int],
    barrier: Barrier | None = None,
) -> tuple[str, object]:
    engine = create_engine(database_url, poolclass=NullPool)
    session = Session(engine)
    try:
        backend_pid = session.scalar(text("SELECT pg_backend_pid()"))
        assert isinstance(backend_pid, int)
        pid_queue.put(backend_pid)
        if barrier is not None:
            barrier.wait(timeout=5)
        service = OpenGameRegistrationService(
            repository=OpenGameRegistrationRepository(session),
            open_game_repository=OpenGameRepository(session),
            order_repository=OrderRepository(session),
            now=lambda: ATTENDANCE_NOW,
        )
        try:
            result = service.mark_attendance(
                game_id=case.game.game_id,
                registration_id=case.joined_ids[0],
                owner_user_id=case.owner_id,
                idempotency_key=idempotency_key,
                request=OpenGameAttendanceMarkRequest(
                    attendance_status=attendance_status,
                    expected_version=2,
                ),
            )
            return result.attendance_status.value, result.model_dump(mode="json")
        except AppError as error:
            return error.code, error.details
    finally:
        session.rollback()
        session.close()
        engine.dispose()


def _authority_worker(
    *,
    database_url: str | URL,
    case: AttendanceCase,
    authority_kind: str,
    acquired: Event,
    release: Event,
) -> str:
    engine = create_engine(database_url, poolclass=NullPool)
    session = Session(engine)
    try:
        order = session.scalar(
            select(Order)
            .where(Order.id == case.game.booking.order_id)
            .with_for_update()
        )
        assert order is not None
        game = session.scalar(
            select(OpenGame)
            .where(OpenGame.id == case.game.game_id)
            .with_for_update()
        )
        assert game is not None
        acquired.set()
        assert release.wait(timeout=5)
        if authority_kind == "order":
            order.status = OrderStatus.CONFIRMED
            order.checked_in_at = None
            order.checked_in_by_user_id = None
            order.completed_at = None
            order.completed_by_user_id = None
        elif authority_kind == "game":
            game.status = OpenGameStatus.CANCELLED
            game.cancelled_at = ATTENDANCE_NOW
            game.cancellation_source = OpenGameCancellationSource.CAPTAIN
            game.version += 1
        else:
            raise AssertionError(authority_kind)
        session.commit()
        return authority_kind
    finally:
        session.rollback()
        session.close()
        engine.dispose()


def test_concurrent_opposite_attendance_marks_have_one_winner_without_deadlock(
    pg_engine: Engine,
) -> None:
    case = _seed_completed_attendance_game(pg_engine)
    barrier = Barrier(2)
    pids: Queue[int] = Queue()
    attempts: tuple[tuple[AttendanceMarkStatus, str], ...] = (
        (
            OpenGameAttendanceStatus.PRESENT,
            "concurrent-attendance-present-key-001",
        ),
        (
            OpenGameAttendanceStatus.NO_SHOW,
            "concurrent-attendance-no-show-key-001",
        ),
    )
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [
            executor.submit(
                _attendance_worker,
                database_url=pg_engine.url,
                case=case,
                attendance_status=status,
                idempotency_key=key,
                pid_queue=pids,
                barrier=barrier,
            )
            for status, key in attempts
        ]
        assert pids.get(timeout=5) > 0
        assert pids.get(timeout=5) > 0
        results = [future.result(timeout=10)[0] for future in futures]

    assert set(results) in (
        {"PRESENT", "ATTENDANCE_STATE_CHANGED"},
        {"NO_SHOW", "ATTENDANCE_STATE_CHANGED"},
    )
    with Session(pg_engine) as session:
        row = session.get_one(OpenGameRegistration, case.joined_ids[0])
        assert row.attendance_status in {
            OpenGameAttendanceStatus.PRESENT,
            OpenGameAttendanceStatus.NO_SHOW,
        }
        assert row.version == 3
        assert (
            session.scalar(select(func.count()).select_from(IdempotencyRecord))
            == 1
        )


@pytest.mark.parametrize("authority_kind", ["order", "game"])
def test_authority_change_serializes_before_attendance_without_deadlock(
    pg_engine: Engine,
    authority_kind: str,
) -> None:
    case = _seed_completed_attendance_game(pg_engine)
    acquired = Event()
    release = Event()
    pid_queue: Queue[int] = Queue(maxsize=1)
    mutator: Future[str] | None = None
    marker: Future[tuple[str, object]] | None = None
    executor = ThreadPoolExecutor(max_workers=2)
    try:
        mutator = executor.submit(
            _authority_worker,
            database_url=pg_engine.url,
            case=case,
            authority_kind=authority_kind,
            acquired=acquired,
            release=release,
        )
        assert acquired.wait(timeout=5)
        marker = executor.submit(
            _attendance_worker,
            database_url=pg_engine.url,
            case=case,
            attendance_status=OpenGameAttendanceStatus.PRESENT,
            idempotency_key=f"authority-{authority_kind}-attendance-key-001",
            pid_queue=pid_queue,
        )
        blocked_pid = pid_queue.get(timeout=5)
        _wait_for_database_lock(pg_engine, blocked_pid)
        release.set()
        assert mutator.result(timeout=10) == authority_kind
        assert marker.result(timeout=10)[0] == "ATTENDANCE_STATE_CHANGED"
    finally:
        release.set()
        for future in (mutator, marker):
            if future is not None and not future.done():
                future.cancel()
        executor.shutdown(wait=False, cancel_futures=True)

    with Session(pg_engine) as session:
        row = session.get_one(OpenGameRegistration, case.joined_ids[0])
        assert row.attendance_status is OpenGameAttendanceStatus.UNMARKED
        assert row.version == 2


@pytest.mark.parametrize(
    "read_surface",
    ("context", "my-applications", "roster"),
)
def test_correction_commit_between_registration_and_audit_reads_never_mixes_versions(
    pg_engine: Engine,
    read_surface: str,
) -> None:
    case = _seed_completed_attendance_game(pg_engine)
    registration_id = case.joined_ids[0]
    recorded_at = ATTENDANCE_NOW - timedelta(minutes=5)
    corrected_at = ATTENDANCE_NOW
    with Session(pg_engine) as session:
        registration = session.get_one(OpenGameRegistration, registration_id)
        applicant_user_id = registration.applicant_user_id
        registration.attendance_status = OpenGameAttendanceStatus.PRESENT
        registration.attendance_recorded_at = recorded_at
        registration.attendance_recorded_by_user_id = case.owner_id
        registration.version = 3
        session.commit()

    interleaved = False

    def commit_correction_before_audit_select(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: object,
    ) -> None:
        nonlocal interleaved
        if (
            interleaved
            or not statement.lstrip().upper().startswith("SELECT")
            or "open_game_attendance_corrections" not in statement
        ):
            return
        interleaved = True
        with Session(pg_engine) as writer:
            registration = writer.get_one(OpenGameRegistration, registration_id)
            registration.attendance_status = OpenGameAttendanceStatus.NO_SHOW
            registration.version = 4
            writer.add(
                OpenGameAttendanceCorrection(
                    registration_id=registration_id,
                    from_status=OpenGameAttendanceStatus.PRESENT,
                    to_status=OpenGameAttendanceStatus.NO_SHOW,
                    reason="并发提交的线下核实",
                    corrected_by_principal_id="platform-admin:readback-race",
                    corrected_at=corrected_at,
                    registration_version_before=3,
                    registration_version_after=4,
                    idempotency_key=f"readback-race-{read_surface}-0001",
                    request_sha256="c" * 64,
                )
            )
            writer.commit()

    event.listen(
        pg_engine,
        "before_cursor_execute",
        commit_correction_before_audit_select,
    )
    try:
        with Session(pg_engine) as reader:
            service = OpenGameRegistrationService(
                repository=OpenGameRegistrationRepository(reader),
                open_game_repository=OpenGameRepository(reader),
                order_repository=OrderRepository(reader),
                now=lambda: ATTENDANCE_NOW,
            )
            if read_surface == "context":
                context = service.get_context(
                    share_token=case.game.share_token,
                    viewer_user_id=applicant_user_id,
                )
                assert context.viewer_registration is not None
                item = context.viewer_registration
            elif read_surface == "my-applications":
                page = service.list_my_applications(
                    applicant_user_id=applicant_user_id,
                    limit=20,
                    cursor=None,
                )
                item = page.items[0]
            else:
                roster = service.get_attendance_roster(
                    game_id=case.game.game_id,
                    owner_user_id=case.owner_id,
                )
                item = roster.registrations[0]
    finally:
        event.remove(
            pg_engine,
            "before_cursor_execute",
            commit_correction_before_audit_select,
        )

    assert interleaved is True
    assert item.attendance_status is OpenGameAttendanceStatus.PRESENT
    assert item.attendance_corrected_at is None
