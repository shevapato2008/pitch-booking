import logging
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from contextlib import AbstractContextManager
from datetime import UTC, datetime, timedelta
from threading import Barrier

import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from backend.app.models import Order, OrderStatus, Payment, PaymentState, Slot, SlotStatus, User
from backend.app.modules.orders.expiry import ExpiryResult, PendingOrderExpiryService
from backend.app.worker import ExpiryWorker, main
from backend.tests.test_schema_constraints import add_pitch, add_slot, venue

pytestmark = pytest.mark.integration

NOW = datetime(2030, 8, 1, 9, tzinfo=UTC)


def _seed_candidates(
    engine: Engine,
    count: int,
    *,
    prepay_index: int | None = None,
    prepay_indices: set[int] | None = None,
) -> list[uuid.UUID]:
    with Session(engine) as session:
        parent = venue()
        pitch = add_pitch(session, parent)
        order_ids: list[uuid.UUID] = []
        for index in range(count):
            starts = NOW + timedelta(days=index + 1)
            slot = add_slot(
                session,
                pitch,
                starts,
                starts + timedelta(hours=1),
                checkout_version=3,
            )
            order = Order(
                order_number=f"PB-{uuid.uuid4().hex}",
                user=User(
                    wechat_app_id="wx-test-app",
                    wechat_openid=f"worker-user-{uuid.uuid4()}",
                ),
                slot=slot,
                status=OrderStatus.PENDING_PAYMENT,
                price_cents=36000,
                contact_name="张三",
                contact_phone_ciphertext=b"encrypted-snapshot-tag",
                contact_phone_nonce=b"abcdefghijkl",
                contact_phone_key_version=1,
                created_at=NOW - timedelta(minutes=11),
                expires_at=NOW - timedelta(seconds=count - index),
                wechat_prepay_id=(
                    "wx-prepay"
                    if prepay_index is not None and index == prepay_index
                    or prepay_indices is not None and index in prepay_indices
                    else None
                ),
            )
            session.add(order)
            session.flush()
            slot.status = SlotStatus.LOCKED
            slot.locked_until = order.expires_at
            slot.locked_by_order_id = order.id
            order_ids.append(order.id)
        session.commit()
        return order_ids


class _SessionFactory:
    def __init__(self, engine: Engine) -> None:
        self.engine = engine
        self.sessions: list[Session] = []

    def __call__(self) -> Session:
        session = Session(self.engine)
        self.sessions.append(session)
        return session


def test_once_scans_exactly_once_caps_batch_at_100_and_uses_one_transaction_each(
    pg_engine: Engine,
) -> None:
    order_ids = _seed_candidates(pg_engine, 101)
    factory = _SessionFactory(pg_engine)
    scans: list[int] = []

    class RecordingWorker(ExpiryWorker):
        def scan_candidate_ids(self, session: Session, *, limit: int) -> list[uuid.UUID]:
            scans.append(limit)
            return super().scan_candidate_ids(session, limit=limit)

    worker = RecordingWorker(session_factory=factory, clock=lambda: NOW)

    processed = worker.run(once=True)

    assert processed == 100
    assert scans == [100]
    assert len(factory.sessions) == 101  # one scan plus one fresh session per candidate
    assert len({id(session) for session in factory.sessions}) == 101
    with Session(pg_engine) as session:
        statuses = [session.get_one(Order, order_id).status for order_id in order_ids]
        assert statuses.count(OrderStatus.EXPIRED) == 100
        assert statuses.count(OrderStatus.PENDING_PAYMENT) == 1
        persisted = [session.get_one(Order, order_id) for order_id in order_ids]
        assert all(
            order.expired_at == NOW
            for order in persisted
            if order.status is OrderStatus.EXPIRED
        )
        assert all(
            order.expired_at is None
            for order in persisted
            if order.status is OrderStatus.PENDING_PAYMENT
        )


def test_duplicate_and_multi_instance_scans_converge(pg_engine: Engine) -> None:
    (order_id,) = _seed_candidates(pg_engine, 1)
    candidates = [order_id, order_id]
    scan_barrier = Barrier(2)

    class DuplicateWorker(ExpiryWorker):
        def scan_candidate_ids(self, session: Session, *, limit: int) -> list[uuid.UUID]:
            result = candidates[:limit]
            scan_barrier.wait(timeout=5)
            return result

    first = DuplicateWorker(session_factory=_SessionFactory(pg_engine), clock=lambda: NOW)
    later = NOW + timedelta(seconds=1)
    second = DuplicateWorker(session_factory=_SessionFactory(pg_engine), clock=lambda: later)

    with ThreadPoolExecutor(max_workers=2) as pool:
        first_result = pool.submit(first.run, once=True)
        second_result = pool.submit(second.run, once=True)
        assert first_result.result(timeout=10) == 2
        assert second_result.result(timeout=10) == 2
    with Session(pg_engine) as session:
        order = session.get_one(Order, order_id)
        slot = session.get_one(Slot, order.slot_id)
        assert order.status is OrderStatus.EXPIRED
        assert order.expired_at in {NOW, later}
        stable_expired_at = order.expired_at
        assert slot.status is SlotStatus.AVAILABLE
        assert slot.checkout_version == 4

    with Session(pg_engine) as session:
        PendingOrderExpiryService().expire_by_order_id(
            session, order_id, NOW + timedelta(seconds=2)
        )
        session.commit()
    with Session(pg_engine) as session:
        assert session.get_one(Order, order_id).expired_at == stable_expired_at


def test_worker_never_releases_unsafe_payment_lock(pg_engine: Engine) -> None:
    (order_id,) = _seed_candidates(pg_engine, 1)
    with Session(pg_engine) as session:
        order = session.get_one(Order, order_id)
        session.add(
            Payment(
                order=order,
                provider="mock",
                merchant_order_no=f"M-{uuid.uuid4().hex}",
                amount_cents=order.price_cents,
                currency="CNY",
                status=PaymentState.PREPAY_CREATED,
            )
        )
        session.commit()

    assert ExpiryWorker(
        session_factory=_SessionFactory(pg_engine), clock=lambda: NOW
    ).run(once=True) == 0

    with Session(pg_engine) as session:
        order = session.get_one(Order, order_id)
        slot = session.get_one(Slot, order.slot_id)
        assert order.status is OrderStatus.PENDING_PAYMENT
        assert order.expired_at is None
        assert slot.status is SlotStatus.LOCKED
        assert slot.locked_by_order_id == order.id


def test_payment_candidates_cannot_starve_safe_orders_beyond_batch_limit(
    pg_engine: Engine,
) -> None:
    order_ids = _seed_candidates(pg_engine, 102)
    with Session(pg_engine) as session:
        for order_id in order_ids[:-1]:
            order = session.get_one(Order, order_id)
            session.add(
                Payment(
                    order=order,
                    provider="mock",
                    merchant_order_no=f"M-{uuid.uuid4().hex}",
                    amount_cents=order.price_cents,
                    currency="CNY",
                    status=PaymentState.PREPAY_CREATED,
                )
            )
        session.commit()
    safe_order_id = order_ids[-1]

    processed = ExpiryWorker(
        session_factory=_SessionFactory(pg_engine), clock=lambda: NOW
    ).run(once=True)

    assert processed == 1
    with Session(pg_engine) as session:
        assert session.get_one(Order, safe_order_id).status is OrderStatus.EXPIRED
        assert all(
            session.get_one(Order, order_id).status is OrderStatus.PENDING_PAYMENT
            for order_id in order_ids[:-1]
        )


def test_each_candidate_failure_is_rolled_back_without_stopping_batch(
    pg_engine: Engine,
    caplog: pytest.LogCaptureFixture,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    first_id, second_id = _seed_candidates(pg_engine, 2)

    class FailsFirst(PendingOrderExpiryService):
        def expire_by_order_id(
            self, session: Session, order_id: uuid.UUID, now: datetime
        ) -> ExpiryResult:
            if order_id == first_id:
                raise RuntimeError("injected")
            return super().expire_by_order_id(session, order_id, now)

    worker = ExpiryWorker(
        session_factory=_SessionFactory(pg_engine),
        expiry_service=FailsFirst(),
        clock=lambda: NOW,
    )

    worker_logger = logging.getLogger("backend.app.worker")
    monkeypatch.setattr(worker_logger, "disabled", False)
    with caplog.at_level(logging.ERROR, logger="backend.app.worker"):
        assert worker.run(once=True) == 2
    matching = [
        record
        for record in caplog.records
        if str(first_id) in record.getMessage()
    ]
    assert len(matching) == 1
    assert matching[0].exc_info is not None
    with Session(pg_engine) as session:
        first = session.get_one(Order, first_id)
        second = session.get_one(Order, second_id)
        assert first.status is OrderStatus.PENDING_PAYMENT
        assert first.expired_at is None
        assert second.status is OrderStatus.EXPIRED
        assert second.expired_at == NOW


def test_continuous_mode_sleeps_exactly_60_seconds_between_scans(
    pg_engine: Engine,
) -> None:
    sleeps: list[float] = []
    scans = 0

    class StopsAfterSecondScan(ExpiryWorker):
        def scan_candidate_ids(self, session: Session, *, limit: int) -> list[uuid.UUID]:
            nonlocal scans
            scans += 1
            if scans == 2:
                raise KeyboardInterrupt
            return []

    worker = StopsAfterSecondScan(
        session_factory=_SessionFactory(pg_engine),
        clock=lambda: NOW,
        sleeper=sleeps.append,
    )

    with pytest.raises(KeyboardInterrupt):
        worker.run()

    assert sleeps == [60.0]


def test_cli_once_injects_dependencies_and_does_not_sleep(pg_engine: Engine) -> None:
    sleeps: list[float] = []
    factory: Callable[[], AbstractContextManager[Session]] = _SessionFactory(pg_engine)

    exit_code = main(
        ["--once"],
        session_factory=factory,
        clock=lambda: NOW,
        sleeper=sleeps.append,
    )

    assert exit_code == 0
    assert sleeps == []
