import uuid
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from queue import Queue
from threading import Event
from time import monotonic, sleep

import pytest
from sqlalchemy import Engine, create_engine, func, select, text
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool

from backend.app.errors import AppError
from backend.app.models import (
    OpenGame,
    OpenGameNotificationOutbox,
    OpenGameRegistration,
    OpenGameRegistrationStatus,
    Order,
)
from backend.app.modules.open_game_registrations.dto import (
    ApplicationDecision,
    DecisionRequest,
    WithdrawalRequest,
)
from backend.app.modules.open_game_registrations.lifecycle import WithdrawalAction
from backend.app.modules.open_game_registrations.repository import (
    OpenGameRegistrationRepository,
)
from backend.app.modules.open_game_registrations.service import (
    OpenGameRegistrationService,
)
from backend.app.modules.open_games.dto import UpdateOpenGameRequest
from backend.app.modules.open_games.repository import OpenGameRepository
from backend.app.modules.open_games.service import OpenGameService
from backend.app.modules.orders.repository import OrderRepository
from backend.tests.test_open_game_registration_service import (
    SeededRegistrationCase,
    _add_registration,
    _b1_snapshot,
    _new_user,
    _seed_published_game,
)
from backend.tests.test_open_game_service import NOW, draft_request

pytestmark = pytest.mark.integration


class ObservedRegistrationRepository(OpenGameRegistrationRepository):
    def __init__(self, session: Session, *, acquired: Event, release: Event) -> None:
        super().__init__(session)
        self._acquired = acquired
        self._release = release

    def lock_order(self, *, order_id: uuid.UUID) -> Order | None:
        order = super().lock_order(order_id=order_id)
        self._acquired.set()
        assert self._release.wait(timeout=5), "timed out holding registration order lock"
        return order


class ObservedOpenGameRepository(OpenGameRepository):
    def __init__(self, session: Session, *, acquired: Event, release: Event) -> None:
        super().__init__(session)
        self._acquired = acquired
        self._release = release

    def lock_owned_order(
        self,
        *,
        order_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> Order | None:
        order = super().lock_owned_order(order_id=order_id, user_id=user_id)
        self._acquired.set()
        assert self._release.wait(timeout=5), "timed out holding open-game order lock"
        return order


def _wait_for_database_lock(engine: Engine, backend_pid: int) -> None:
    deadline = monotonic() + 5
    while monotonic() < deadline:
        with engine.connect() as observer:
            wait_event_type = observer.scalar(
                text(
                    "SELECT wait_event_type FROM pg_stat_activity "
                    "WHERE pid = :backend_pid"
                ),
                {"backend_pid": backend_pid},
            )
        if wait_event_type == "Lock":
            return
        sleep(0.01)
    pytest.fail(f"backend {backend_pid} did not block on a database lock")


def _run_serialized_pair(
    *,
    engine: Engine,
    acquired: Event,
    release: Event,
    first: Callable[[Queue[int]], tuple[str, object]],
    second: Callable[[Queue[int]], tuple[str, object]],
) -> tuple[tuple[str, object], tuple[str, object]]:
    first_pid: Queue[int] = Queue(maxsize=1)
    second_pid: Queue[int] = Queue(maxsize=1)
    first_future: Future[tuple[str, object]] | None = None
    second_future: Future[tuple[str, object]] | None = None
    executor = ThreadPoolExecutor(max_workers=2)
    try:
        first_future = executor.submit(first, first_pid)
        assert first_pid.get(timeout=5) > 0
        assert acquired.wait(timeout=5), "first worker did not acquire the order lock"
        second_future = executor.submit(second, second_pid)
        blocked_pid = second_pid.get(timeout=5)
        try:
            _wait_for_database_lock(engine, blocked_pid)
        finally:
            release.set()
        return (
            first_future.result(timeout=10),
            second_future.result(timeout=10),
        )
    finally:
        release.set()
        try:
            for future in (first_future, second_future):
                if future is None or future.done() or future.cancel():
                    continue
                try:
                    future.result(timeout=10)
                except Exception:
                    pass
        finally:
            executor.shutdown(wait=False, cancel_futures=True)


def _decision_worker(
    *,
    database_url: object,
    case: SeededRegistrationCase,
    application_id: uuid.UUID,
    idempotency_key: str,
    decision: ApplicationDecision = ApplicationDecision.ACCEPT,
    observed: tuple[Event, Event] | None,
    pid_queue: Queue[int],
) -> tuple[str, object]:
    worker_engine = create_engine(database_url, poolclass=NullPool)
    session = Session(worker_engine)
    try:
        backend_pid = session.scalar(text("SELECT pg_backend_pid()"))
        assert isinstance(backend_pid, int)
        pid_queue.put(backend_pid)
        if observed is None:
            registration_repository = OpenGameRegistrationRepository(session)
        else:
            acquired, release = observed
            registration_repository = ObservedRegistrationRepository(
                session,
                acquired=acquired,
                release=release,
            )
        registration_service = OpenGameRegistrationService(
            repository=registration_repository,
            open_game_repository=OpenGameRepository(session),
            order_repository=OrderRepository(session),
            now=lambda: NOW,
        )
        try:
            result = registration_service.decide(
                game_id=case.game_id,
                application_id=application_id,
                owner_user_id=case.booking.owner_id,
                idempotency_key=idempotency_key,
                request=DecisionRequest(
                    decision=decision,
                    expected_version=1,
                ),
            )
            return result.status.value, result.model_dump(mode="json")
        except AppError as error:
            return error.code, error.details
    finally:
        session.rollback()
        session.close()
        worker_engine.dispose()


def _withdrawal_worker(
    *,
    database_url: object,
    case: SeededRegistrationCase,
    application_id: uuid.UUID,
    idempotency_key: str,
    action: WithdrawalAction,
    expected_version: int,
    observed: tuple[Event, Event] | None,
    pid_queue: Queue[int],
    applicant_user_id: uuid.UUID | None = None,
) -> tuple[str, object]:
    worker_engine = create_engine(database_url, poolclass=NullPool)
    session = Session(worker_engine)
    try:
        backend_pid = session.scalar(text("SELECT pg_backend_pid()"))
        assert isinstance(backend_pid, int)
        pid_queue.put(backend_pid)
        registration_repository = (
            OpenGameRegistrationRepository(session)
            if observed is None
            else ObservedRegistrationRepository(
                session,
                acquired=observed[0],
                release=observed[1],
            )
        )
        service = OpenGameRegistrationService(
            repository=registration_repository,
            open_game_repository=OpenGameRepository(session),
            order_repository=OrderRepository(session),
            now=lambda: NOW,
        )
        try:
            result = service.withdraw(
                application_id=application_id,
                applicant_user_id=(
                    applicant_user_id or case.booking.stranger_id
                ),
                idempotency_key=idempotency_key,
                request=WithdrawalRequest(
                    action=action,
                    expected_version=expected_version,
                ),
            )
            return "WITHDRAWN", result.model_dump(mode="json")
        except AppError as error:
            return error.code, error.details
    finally:
        session.rollback()
        session.close()
        worker_engine.dispose()


def _edit_worker(
    *,
    database_url: object,
    case: SeededRegistrationCase,
    request: UpdateOpenGameRequest,
    idempotency_key: str,
    observed: tuple[Event, Event] | None,
    pid_queue: Queue[int],
) -> tuple[str, object]:
    worker_engine = create_engine(database_url, poolclass=NullPool)
    session = Session(worker_engine)
    try:
        backend_pid = session.scalar(text("SELECT pg_backend_pid()"))
        assert isinstance(backend_pid, int)
        pid_queue.put(backend_pid)
        repository = (
            OpenGameRepository(session)
            if observed is None
            else ObservedOpenGameRepository(
                session,
                acquired=observed[0],
                release=observed[1],
            )
        )
        open_game_service = OpenGameService(
            repository=repository,
            order_repository=OrderRepository(session),
            now=lambda: NOW,
        )
        try:
            result = open_game_service.update(
                user_id=case.booking.owner_id,
                game_id=case.game_id,
                idempotency_key=idempotency_key,
                request=request,
            )
            return "UPDATED", result.model_dump(mode="json")
        except AppError as error:
            return error.code, error.details
    finally:
        session.rollback()
        session.close()
        worker_engine.dispose()


def _seed_pending(
    engine: Engine,
    *,
    existing_joined: bool,
) -> tuple[SeededRegistrationCase, uuid.UUID, uuid.UUID | None, dict[str, object]]:
    case = _seed_published_game(engine)
    with Session(engine) as session:
        game = session.get_one(OpenGame, case.game_id)
        game.open_spots = 2
        game.total_players = 8
        joined_id: uuid.UUID | None = None
        if existing_joined:
            joined_user = _new_user(session, "concurrency-joined")
            joined = _add_registration(
                session,
                game_id=game.id,
                applicant_user_id=joined_user.id,
                status=OpenGameRegistrationStatus.JOINED,
                decided_by_user_id=case.booking.owner_id,
            )
            joined_id = joined.id
        target = _add_registration(
            session,
            game_id=game.id,
            applicant_user_id=case.booking.stranger_id,
            status=OpenGameRegistrationStatus.APPLIED,
        )
        session.commit()
        return case, target.id, joined_id, _b1_snapshot(session)


def _assert_final_invariants(
    engine: Engine,
    *,
    case: SeededRegistrationCase,
    before_b1: dict[str, object],
) -> tuple[OpenGame, int]:
    with Session(engine) as session:
        game = session.get_one(OpenGame, case.game_id)
        joined_count = int(
            session.scalar(
                select(func.count())
                .select_from(OpenGameRegistration)
                .where(
                    OpenGameRegistration.game_id == game.id,
                    OpenGameRegistration.status
                    == OpenGameRegistrationStatus.JOINED,
                )
            )
            or 0
        )
        assert game.open_spots >= joined_count
        assert game.total_players >= game.fixed_players + joined_count
        assert _b1_snapshot(session) == before_b1
        session.expunge(game)
        return game, joined_count


def test_two_accepts_for_last_place_are_serialized(pg_engine: Engine) -> None:
    case, first_application_id, _, before_b1 = _seed_pending(
        pg_engine,
        existing_joined=True,
    )
    with Session(pg_engine) as session:
        second_user = _new_user(session, "second-pending")
        second = _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=second_user.id,
            status=OpenGameRegistrationStatus.APPLIED,
        )
        session.commit()
        second_application_id = second.id

    acquired = Event()
    release = Event()
    first, second = _run_serialized_pair(
        engine=pg_engine,
        acquired=acquired,
        release=release,
        first=lambda pid: _decision_worker(
            database_url=pg_engine.url,
            case=case,
            application_id=first_application_id,
            idempotency_key="concurrency-first-accept-key-000001",
            observed=(acquired, release),
            pid_queue=pid,
        ),
        second=lambda pid: _decision_worker(
            database_url=pg_engine.url,
            case=case,
            application_id=second_application_id,
            idempotency_key="concurrency-second-accept-key-00001",
            observed=None,
            pid_queue=pid,
        ),
    )

    assert first[0] == "JOINED"
    assert second[0] == "APPLICATION_CAPACITY_CHANGED"
    with Session(pg_engine) as session:
        assert session.get_one(
            OpenGameRegistration, first_application_id
        ).status is OpenGameRegistrationStatus.JOINED
        assert session.get_one(
            OpenGameRegistration, second_application_id
        ).status is OpenGameRegistrationStatus.APPLIED
    game, joined_count = _assert_final_invariants(
        pg_engine,
        case=case,
        before_b1=before_b1,
    )
    assert joined_count == 2
    assert game.aa_cents == 3600


def test_two_waitlist_decisions_allocate_distinct_historical_sequence(
    pg_engine: Engine,
) -> None:
    case, first_application_id, _, before_b1 = _seed_pending(
        pg_engine,
        existing_joined=True,
    )
    with Session(pg_engine) as session:
        game = session.get_one(OpenGame, case.game_id)
        game.open_spots = 1
        second_user = _new_user(session, "second-waitlist-pending")
        second = _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=second_user.id,
            status=OpenGameRegistrationStatus.APPLIED,
        )
        session.commit()
        second_application_id = second.id
        before_b1 = _b1_snapshot(session)

    acquired = Event()
    release = Event()
    first, second = _run_serialized_pair(
        engine=pg_engine,
        acquired=acquired,
        release=release,
        first=lambda pid: _decision_worker(
            database_url=pg_engine.url,
            case=case,
            application_id=first_application_id,
            idempotency_key="concurrent-first-waitlist-key-0001",
            decision=ApplicationDecision.WAITLIST,
            observed=(acquired, release),
            pid_queue=pid,
        ),
        second=lambda pid: _decision_worker(
            database_url=pg_engine.url,
            case=case,
            application_id=second_application_id,
            idempotency_key="concurrent-second-waitlist-key-001",
            decision=ApplicationDecision.WAITLIST,
            observed=None,
            pid_queue=pid,
        ),
    )

    assert first[0] == second[0] == "WAITLISTED"
    with Session(pg_engine) as session:
        rows = [
            session.get_one(OpenGameRegistration, application_id)
            for application_id in (first_application_id, second_application_id)
        ]
        assert [row.waitlist_seq for row in rows] == [1, 2]
        assert all(row.status is OpenGameRegistrationStatus.WAITLISTED for row in rows)
    _, joined_count = _assert_final_invariants(
        pg_engine,
        case=case,
        before_b1=before_b1,
    )
    assert joined_count == 1


@pytest.mark.parametrize("same_key", [False, True])
def test_same_target_waitlist_decisions_serialize_and_replay_only_same_key(
    pg_engine: Engine,
    same_key: bool,
) -> None:
    case, application_id, _, before_b1 = _seed_pending(
        pg_engine,
        existing_joined=True,
    )
    with Session(pg_engine) as session:
        session.get_one(OpenGame, case.game_id).open_spots = 1
        session.commit()
        before_b1 = _b1_snapshot(session)

    first_key = "concurrent-same-target-waitlist-0001"
    second_key = first_key if same_key else "concurrent-other-target-waitlist-001"
    acquired = Event()
    release = Event()
    first, second = _run_serialized_pair(
        engine=pg_engine,
        acquired=acquired,
        release=release,
        first=lambda pid: _decision_worker(
            database_url=pg_engine.url,
            case=case,
            application_id=application_id,
            idempotency_key=first_key,
            decision=ApplicationDecision.WAITLIST,
            observed=(acquired, release),
            pid_queue=pid,
        ),
        second=lambda pid: _decision_worker(
            database_url=pg_engine.url,
            case=case,
            application_id=application_id,
            idempotency_key=second_key,
            decision=ApplicationDecision.WAITLIST,
            observed=None,
            pid_queue=pid,
        ),
    )

    assert first[0] == "WAITLISTED"
    assert second[0] == ("WAITLISTED" if same_key else "APPLICATION_STATE_CHANGED")
    if same_key:
        assert second[1] == first[1]
    with Session(pg_engine) as session:
        row = session.get_one(OpenGameRegistration, application_id)
        assert row.status is OpenGameRegistrationStatus.WAITLISTED
        assert row.waitlist_seq == 1
    _assert_final_invariants(pg_engine, case=case, before_b1=before_b1)


def test_withdraw_and_accept_from_application_v1_serialize_to_one_success(
    pg_engine: Engine,
) -> None:
    case, application_id, _, before_b1 = _seed_pending(
        pg_engine,
        existing_joined=False,
    )
    acquired = Event()
    release = Event()
    withdrawn, accepted = _run_serialized_pair(
        engine=pg_engine,
        acquired=acquired,
        release=release,
        first=lambda pid: _withdrawal_worker(
            database_url=pg_engine.url,
            case=case,
            application_id=application_id,
            idempotency_key="withdraw-before-accept-key-0000001",
            action=WithdrawalAction.WITHDRAW_APPLICATION,
            expected_version=1,
            observed=(acquired, release),
            pid_queue=pid,
        ),
        second=lambda pid: _decision_worker(
            database_url=pg_engine.url,
            case=case,
            application_id=application_id,
            idempotency_key="accept-after-withdraw-key-00000001",
            observed=None,
            pid_queue=pid,
        ),
    )

    assert withdrawn[0] == "WITHDRAWN"
    assert accepted[0] == "APPLICATION_STATE_CHANGED"
    with Session(pg_engine) as session:
        row = session.get_one(OpenGameRegistration, application_id)
        assert row.status is OpenGameRegistrationStatus.WITHDRAWN
        assert row.version == 2
    _assert_final_invariants(pg_engine, case=case, before_b1=before_b1)


def test_accept_and_old_withdraw_from_application_v1_serialize_to_one_success(
    pg_engine: Engine,
) -> None:
    case, application_id, _, before_b1 = _seed_pending(
        pg_engine,
        existing_joined=False,
    )
    acquired = Event()
    release = Event()
    accepted, withdrawn = _run_serialized_pair(
        engine=pg_engine,
        acquired=acquired,
        release=release,
        first=lambda pid: _decision_worker(
            database_url=pg_engine.url,
            case=case,
            application_id=application_id,
            idempotency_key="accept-before-withdraw-key-0000001",
            observed=(acquired, release),
            pid_queue=pid,
        ),
        second=lambda pid: _withdrawal_worker(
            database_url=pg_engine.url,
            case=case,
            application_id=application_id,
            idempotency_key="withdraw-after-accept-key-00000001",
            action=WithdrawalAction.WITHDRAW_APPLICATION,
            expected_version=1,
            observed=None,
            pid_queue=pid,
        ),
    )

    assert accepted[0] == "JOINED"
    assert withdrawn[0] == "APPLICATION_STATE_CHANGED"
    with Session(pg_engine) as session:
        row = session.get_one(OpenGameRegistration, application_id)
        assert row.status is OpenGameRegistrationStatus.JOINED
        assert row.version == 2
    _, joined_count = _assert_final_invariants(
        pg_engine,
        case=case,
        before_b1=before_b1,
    )
    assert joined_count == 1


@pytest.mark.parametrize("withdraw_first", [False, True])
def test_waitlist_and_application_withdrawal_serialize_to_one_success(
    pg_engine: Engine,
    withdraw_first: bool,
) -> None:
    case, application_id, _, before_b1 = _seed_pending(
        pg_engine,
        existing_joined=True,
    )
    with Session(pg_engine) as session:
        session.get_one(OpenGame, case.game_id).open_spots = 1
        session.commit()
        before_b1 = _b1_snapshot(session)

    acquired = Event()
    release = Event()

    def waitlist(pid: Queue[int], observed: tuple[Event, Event] | None) -> tuple[str, object]:
        return _decision_worker(
            database_url=pg_engine.url,
            case=case,
            application_id=application_id,
            idempotency_key=f"waitlist-race-{withdraw_first}-key-0001",
            decision=ApplicationDecision.WAITLIST,
            observed=observed,
            pid_queue=pid,
        )

    def withdraw(pid: Queue[int], observed: tuple[Event, Event] | None) -> tuple[str, object]:
        return _withdrawal_worker(
            database_url=pg_engine.url,
            case=case,
            application_id=application_id,
            idempotency_key=f"application-withdraw-race-{withdraw_first}-001",
            action=WithdrawalAction.WITHDRAW_APPLICATION,
            expected_version=1,
            observed=observed,
            pid_queue=pid,
        )

    first, second = _run_serialized_pair(
        engine=pg_engine,
        acquired=acquired,
        release=release,
        first=(
            (lambda pid: withdraw(pid, (acquired, release)))
            if withdraw_first
            else (lambda pid: waitlist(pid, (acquired, release)))
        ),
        second=(
            (lambda pid: waitlist(pid, None))
            if withdraw_first
            else (lambda pid: withdraw(pid, None))
        ),
    )

    assert first[0] == ("WITHDRAWN" if withdraw_first else "WAITLISTED")
    assert second[0] == "APPLICATION_STATE_CHANGED"
    with Session(pg_engine) as session:
        row = session.get_one(OpenGameRegistration, application_id)
        assert row.status is (
            OpenGameRegistrationStatus.WITHDRAWN
            if withdraw_first
            else OpenGameRegistrationStatus.WAITLISTED
        )
        assert row.waitlist_seq == (None if withdraw_first else 1)
    _assert_final_invariants(pg_engine, case=case, before_b1=before_b1)


@pytest.mark.parametrize("same_key", [False, True])
def test_two_waitlist_withdrawals_serialize_and_replay_only_same_key(
    pg_engine: Engine,
    same_key: bool,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        target = _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=case.booking.stranger_id,
            status=OpenGameRegistrationStatus.WAITLISTED,
            decided_by_user_id=case.booking.owner_id,
            waitlist_seq=4,
            waitlisted_at=NOW,
        )
        session.commit()
        application_id = target.id
        before_b1 = _b1_snapshot(session)

    first_key = "concurrent-waitlist-withdraw-key-0001"
    second_key = first_key if same_key else "concurrent-other-waitlist-withdraw-01"
    acquired = Event()
    release = Event()
    first, second = _run_serialized_pair(
        engine=pg_engine,
        acquired=acquired,
        release=release,
        first=lambda pid: _withdrawal_worker(
            database_url=pg_engine.url,
            case=case,
            application_id=application_id,
            idempotency_key=first_key,
            action=WithdrawalAction.WITHDRAW_WAITLIST,
            expected_version=2,
            observed=(acquired, release),
            pid_queue=pid,
        ),
        second=lambda pid: _withdrawal_worker(
            database_url=pg_engine.url,
            case=case,
            application_id=application_id,
            idempotency_key=second_key,
            action=WithdrawalAction.WITHDRAW_WAITLIST,
            expected_version=2,
            observed=None,
            pid_queue=pid,
        ),
    )

    assert first[0] == "WITHDRAWN"
    assert second[0] == ("WITHDRAWN" if same_key else "APPLICATION_STATE_CHANGED")
    if same_key:
        assert second[1] == first[1]
    with Session(pg_engine) as session:
        row = session.get_one(OpenGameRegistration, application_id)
        assert row.status is OpenGameRegistrationStatus.WITHDRAWN
        assert row.version == 3
        assert row.waitlist_seq == 4
    _assert_final_invariants(pg_engine, case=case, before_b1=before_b1)


@pytest.mark.parametrize("same_key", [False, True])
def test_two_requests_for_same_joined_exit_promote_only_once(
    pg_engine: Engine,
    same_key: bool,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        game = session.get_one(OpenGame, case.game_id)
        game.open_spots = 1
        target = _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=case.booking.stranger_id,
            status=OpenGameRegistrationStatus.JOINED,
            decided_by_user_id=case.booking.owner_id,
        )
        candidate_user = _new_user(session, "same-exit-promotion")
        candidate = _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=candidate_user.id,
            status=OpenGameRegistrationStatus.WAITLISTED,
            decided_by_user_id=case.booking.owner_id,
            waitlist_seq=1,
            waitlisted_at=NOW,
        )
        session.commit()
        application_id = target.id
        candidate_id = candidate.id
        before_b1 = _b1_snapshot(session)

    first_key = "concurrent-joined-exit-key-0000001"
    second_key = (
        first_key if same_key else "concurrent-other-exit-key-000000001"
    )
    acquired = Event()
    release = Event()
    first, second = _run_serialized_pair(
        engine=pg_engine,
        acquired=acquired,
        release=release,
        first=lambda pid: _withdrawal_worker(
            database_url=pg_engine.url,
            case=case,
            application_id=application_id,
            idempotency_key=first_key,
            action=WithdrawalAction.LEAVE_GAME,
            expected_version=2,
            observed=(acquired, release),
            pid_queue=pid,
        ),
        second=lambda pid: _withdrawal_worker(
            database_url=pg_engine.url,
            case=case,
            application_id=application_id,
            idempotency_key=second_key,
            action=WithdrawalAction.LEAVE_GAME,
            expected_version=2,
            observed=None,
            pid_queue=pid,
        ),
    )

    assert first[0] == "WITHDRAWN"
    assert second[0] == ("WITHDRAWN" if same_key else "APPLICATION_STATE_CHANGED")
    if same_key:
        assert second[1] == first[1]
    with Session(pg_engine) as session:
        row = session.get_one(OpenGameRegistration, application_id)
        assert row.status is OpenGameRegistrationStatus.WITHDRAWN
        assert row.version == 3
        promoted = session.get_one(OpenGameRegistration, candidate_id)
        assert promoted.status is OpenGameRegistrationStatus.JOINED
        assert promoted.version == 3
        assert session.scalar(
            select(func.count()).select_from(OpenGameNotificationOutbox)
        ) == 1
        assert session.get_one(OpenGame, case.game_id).open_spots == 1
    game, joined_count = _assert_final_invariants(
        pg_engine,
        case=case,
        before_b1=before_b1,
    )
    assert joined_count == 1
    assert game.open_spots == 1


def test_two_distinct_joined_exits_promote_two_fifo_candidates_once_each(
    pg_engine: Engine,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        game = session.get_one(OpenGame, case.game_id)
        game.open_spots = 2
        first_departing = _add_registration(
            session,
            game_id=game.id,
            applicant_user_id=case.booking.stranger_id,
            status=OpenGameRegistrationStatus.JOINED,
            decided_by_user_id=case.booking.owner_id,
        )
        second_departing_user = _new_user(session, "second-departing")
        second_departing = _add_registration(
            session,
            game_id=game.id,
            applicant_user_id=second_departing_user.id,
            status=OpenGameRegistrationStatus.JOINED,
            decided_by_user_id=case.booking.owner_id,
        )
        candidate_ids: list[uuid.UUID] = []
        for sequence in (1, 2):
            candidate_user = _new_user(session, f"two-exits-{sequence}")
            candidate = _add_registration(
                session,
                game_id=game.id,
                applicant_user_id=candidate_user.id,
                status=OpenGameRegistrationStatus.WAITLISTED,
                decided_by_user_id=case.booking.owner_id,
                waitlist_seq=sequence,
                waitlisted_at=NOW,
            )
            candidate_ids.append(candidate.id)
        session.commit()
        first_departing_id = first_departing.id
        second_departing_id = second_departing.id
        second_departing_user_id = second_departing_user.id
        before_b1 = _b1_snapshot(session)

    acquired = Event()
    release = Event()
    first, second = _run_serialized_pair(
        engine=pg_engine,
        acquired=acquired,
        release=release,
        first=lambda pid: _withdrawal_worker(
            database_url=pg_engine.url,
            case=case,
            application_id=first_departing_id,
            idempotency_key="first-distinct-exit-promotion-key-001",
            action=WithdrawalAction.LEAVE_GAME,
            expected_version=2,
            observed=(acquired, release),
            pid_queue=pid,
        ),
        second=lambda pid: _withdrawal_worker(
            database_url=pg_engine.url,
            case=case,
            application_id=second_departing_id,
            applicant_user_id=second_departing_user_id,
            idempotency_key="second-distinct-exit-promotion-key-01",
            action=WithdrawalAction.LEAVE_GAME,
            expected_version=2,
            observed=None,
            pid_queue=pid,
        ),
    )

    assert first[0] == second[0] == "WITHDRAWN"
    with Session(pg_engine) as session:
        departing_rows = [
            session.get_one(OpenGameRegistration, application_id)
            for application_id in (first_departing_id, second_departing_id)
        ]
        candidate_rows = [
            session.get_one(OpenGameRegistration, application_id)
            for application_id in candidate_ids
        ]
        assert all(
            row.status is OpenGameRegistrationStatus.WITHDRAWN
            for row in departing_rows
        )
        assert all(
            row.status is OpenGameRegistrationStatus.JOINED
            for row in candidate_rows
        )
        assert [row.version for row in candidate_rows] == [3, 3]
        events = tuple(
            session.scalars(
                select(OpenGameNotificationOutbox).order_by(
                    OpenGameNotificationOutbox.created_at,
                    OpenGameNotificationOutbox.id,
                )
            )
        )
        assert {row.registration_id for row in events} == set(candidate_ids)
        assert len(events) == 2
    game, joined_count = _assert_final_invariants(
        pg_engine,
        case=case,
        before_b1=before_b1,
    )
    assert joined_count == 2
    assert game.open_spots == 2


@pytest.mark.parametrize("waitlist_withdraws_first", [False, True])
def test_waitlist_withdrawal_and_joined_exit_serialize_without_stale_promotion(
    pg_engine: Engine,
    waitlist_withdraws_first: bool,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        game = session.get_one(OpenGame, case.game_id)
        game.open_spots = 1
        departing = _add_registration(
            session,
            game_id=game.id,
            applicant_user_id=case.booking.stranger_id,
            status=OpenGameRegistrationStatus.JOINED,
            decided_by_user_id=case.booking.owner_id,
        )
        candidate_user = _new_user(session, "withdraw-race-candidate")
        candidate = _add_registration(
            session,
            game_id=game.id,
            applicant_user_id=candidate_user.id,
            status=OpenGameRegistrationStatus.WAITLISTED,
            decided_by_user_id=case.booking.owner_id,
            waitlist_seq=1,
            waitlisted_at=NOW,
        )
        session.commit()
        departing_id = departing.id
        candidate_id = candidate.id
        candidate_user_id = candidate_user.id
        before_b1 = _b1_snapshot(session)

    acquired = Event()
    release = Event()

    def exit_game(
        pid: Queue[int],
        observed: tuple[Event, Event] | None,
    ) -> tuple[str, object]:
        return _withdrawal_worker(
            database_url=pg_engine.url,
            case=case,
            application_id=departing_id,
            idempotency_key=f"exit-waitlist-race-{waitlist_withdraws_first}-key-01",
            action=WithdrawalAction.LEAVE_GAME,
            expected_version=2,
            observed=observed,
            pid_queue=pid,
        )

    def withdraw_waitlist(
        pid: Queue[int],
        observed: tuple[Event, Event] | None,
    ) -> tuple[str, object]:
        return _withdrawal_worker(
            database_url=pg_engine.url,
            case=case,
            application_id=candidate_id,
            applicant_user_id=candidate_user_id,
            idempotency_key=(
                f"waitlist-exit-race-{waitlist_withdraws_first}-key-0001"
            ),
            action=WithdrawalAction.WITHDRAW_WAITLIST,
            expected_version=2,
            observed=observed,
            pid_queue=pid,
        )

    first, second = _run_serialized_pair(
        engine=pg_engine,
        acquired=acquired,
        release=release,
        first=(
            (lambda pid: withdraw_waitlist(pid, (acquired, release)))
            if waitlist_withdraws_first
            else (lambda pid: exit_game(pid, (acquired, release)))
        ),
        second=(
            (lambda pid: exit_game(pid, None))
            if waitlist_withdraws_first
            else (lambda pid: withdraw_waitlist(pid, None))
        ),
    )

    assert first[0] == "WITHDRAWN"
    assert second[0] == (
        "WITHDRAWN" if waitlist_withdraws_first else "APPLICATION_STATE_CHANGED"
    )
    with Session(pg_engine) as session:
        persisted_departing = session.get_one(
            OpenGameRegistration,
            departing_id,
        )
        persisted_candidate = session.get_one(
            OpenGameRegistration,
            candidate_id,
        )
        assert persisted_departing.status is OpenGameRegistrationStatus.WITHDRAWN
        assert persisted_candidate.status is (
            OpenGameRegistrationStatus.WITHDRAWN
            if waitlist_withdraws_first
            else OpenGameRegistrationStatus.JOINED
        )
        assert session.scalar(
            select(func.count()).select_from(OpenGameNotificationOutbox)
        ) == (0 if waitlist_withdraws_first else 1)
    _, joined_count = _assert_final_invariants(
        pg_engine,
        case=case,
        before_b1=before_b1,
    )
    assert joined_count == (0 if waitlist_withdraws_first else 1)


def test_accept_first_forces_joined_aware_edit_to_fail(pg_engine: Engine) -> None:
    case, application_id, _, before_b1 = _seed_pending(
        pg_engine,
        existing_joined=True,
    )
    request = UpdateOpenGameRequest(
        **(
            draft_request(case.booking).model_dump()
            | {"total_players": 7, "open_spots": 1, "aa_cents": 3601}
        ),
        expected_version=1,
    )
    acquired = Event()
    release = Event()
    accepted, edited = _run_serialized_pair(
        engine=pg_engine,
        acquired=acquired,
        release=release,
        first=lambda pid: _decision_worker(
            database_url=pg_engine.url,
            case=case,
            application_id=application_id,
            idempotency_key="accept-first-decision-key-000001",
            observed=(acquired, release),
            pid_queue=pid,
        ),
        second=lambda pid: _edit_worker(
            database_url=pg_engine.url,
            case=case,
            request=request,
            idempotency_key="accept-first-edit-key-000000001",
            observed=None,
            pid_queue=pid,
        ),
    )

    assert accepted[0] == "JOINED"
    assert edited == (
        "INVALID_ARGUMENT",
        {
            "fields": [
                {"field": "open_spots", "message": "不能小于已加入人数。"},
                {
                    "field": "total_players",
                    "message": "不能小于固定人数与已加入人数之和。",
                },
                {
                    "field": "aa_cents",
                    "message": "已有加入成员后预计 AA 只能保持或降低。",
                },
            ]
        },
    )
    game, joined_count = _assert_final_invariants(
        pg_engine,
        case=case,
        before_b1=before_b1,
    )
    assert joined_count == 2
    assert (game.open_spots, game.total_players, game.aa_cents) == (2, 8, 3600)


def test_edit_first_is_observed_by_later_accept(pg_engine: Engine) -> None:
    case, application_id, _, before_b1 = _seed_pending(
        pg_engine,
        existing_joined=False,
    )
    request = UpdateOpenGameRequest(
        **(
            draft_request(case.booking).model_dump()
            | {"total_players": 7, "open_spots": 1, "aa_cents": 4000}
        ),
        expected_version=1,
    )
    acquired = Event()
    release = Event()
    edited, accepted = _run_serialized_pair(
        engine=pg_engine,
        acquired=acquired,
        release=release,
        first=lambda pid: _edit_worker(
            database_url=pg_engine.url,
            case=case,
            request=request,
            idempotency_key="edit-first-update-key-000000001",
            observed=(acquired, release),
            pid_queue=pid,
        ),
        second=lambda pid: _decision_worker(
            database_url=pg_engine.url,
            case=case,
            application_id=application_id,
            idempotency_key="edit-first-decision-key-000001",
            observed=None,
            pid_queue=pid,
        ),
    )

    assert edited[0] == "UPDATED"
    assert accepted[0] == "JOINED"
    game, joined_count = _assert_final_invariants(
        pg_engine,
        case=case,
        before_b1=before_b1,
    )
    assert joined_count == 1
    assert (game.open_spots, game.total_players, game.aa_cents) == (1, 7, 4000)
