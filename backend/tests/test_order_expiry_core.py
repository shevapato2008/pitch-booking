import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from queue import Queue
from threading import Event
from time import monotonic

import pytest
from sqlalchemy import Engine, event, select, text
from sqlalchemy.orm import Session

from backend.app.models import Order, OrderStatus, Slot, SlotStatus, User
from backend.app.modules.orders.expiry import ExpiryResult, PendingOrderExpiryService
from backend.tests.test_schema_constraints import add_pitch, add_slot, venue

pytestmark = pytest.mark.integration

NOW = datetime(2030, 8, 1, 9, tzinfo=UTC)


def _seed_locked_order(
    session: Session,
    *,
    expires_at: datetime = NOW - timedelta(seconds=1),
    wechat_prepay_id: str | None = None,
    checkout_version: int = 7,
) -> tuple[Slot, Order]:
    pitch = add_pitch(session, venue())
    slot = add_slot(
        session,
        pitch,
        NOW + timedelta(days=1),
        NOW + timedelta(days=1, hours=1),
        checkout_version=checkout_version,
    )
    user = User(wechat_app_id="wx-test-app", wechat_openid=f"openid-{uuid.uuid4()}")
    order = Order(
        order_number=f"PB-{uuid.uuid4().hex}",
        user=user,
        slot=slot,
        status=OrderStatus.PENDING_PAYMENT,
        price_cents=36000,
        contact_name="张三",
        contact_phone_ciphertext=b"encrypted-snapshot-and-tag",
        contact_phone_nonce=b"abcdefghijkl",
        contact_phone_key_version=1,
        expires_at=expires_at,
        wechat_prepay_id=wechat_prepay_id,
    )
    session.add(order)
    session.flush()
    slot.status = SlotStatus.LOCKED
    slot.locked_until = expires_at
    slot.locked_by_order_id = order.id
    session.flush()
    return slot, order


def _assert_unchanged_lock(slot: Slot, order: Order, *, version: int = 7) -> None:
    assert order.status is OrderStatus.PENDING_PAYMENT
    assert slot.status is SlotStatus.LOCKED
    assert slot.locked_until is not None
    assert slot.locked_by_order_id == order.id
    assert slot.checkout_version == version


def test_before_deadline_is_a_no_op(pg_session: Session) -> None:
    slot, order = _seed_locked_order(pg_session, expires_at=NOW + timedelta(seconds=1))

    result = PendingOrderExpiryService().expire_by_order_id(pg_session, order.id, NOW)
    pg_session.flush()

    assert result.changed is False
    assert result.order_status is OrderStatus.PENDING_PAYMENT
    assert result.slot_status is SlotStatus.LOCKED
    _assert_unchanged_lock(slot, order)


def test_prepay_backed_order_is_never_released(pg_session: Session) -> None:
    slot, order = _seed_locked_order(pg_session, wechat_prepay_id="wx-prepay-123")

    result = PendingOrderExpiryService().expire_by_order_id(pg_session, order.id, NOW)
    pg_session.flush()

    assert result.changed is False
    assert result.order_status is OrderStatus.PENDING_PAYMENT
    assert result.slot_status is SlotStatus.LOCKED
    _assert_unchanged_lock(slot, order)


def test_wrong_lock_owner_is_a_no_op(pg_session: Session) -> None:
    slot, order = _seed_locked_order(pg_session)
    other_order = Order(
        order_number=f"PB-{uuid.uuid4().hex}",
        user=User(wechat_app_id="wx-test-app", wechat_openid=f"openid-{uuid.uuid4()}"),
        slot=slot,
        status=OrderStatus.PENDING_PAYMENT,
        price_cents=36000,
        contact_name="李四",
        contact_phone_ciphertext=b"other-encrypted-snapshot",
        contact_phone_nonce=b"mnopqrstuvwx",
        contact_phone_key_version=1,
        expires_at=NOW + timedelta(minutes=5),
        wechat_prepay_id=None,
    )
    pg_session.add(other_order)
    pg_session.flush()
    slot.locked_by_order_id = other_order.id
    slot.locked_until = other_order.expires_at
    pg_session.flush()

    result = PendingOrderExpiryService().expire_with_locked_slot(
        pg_session, slot, order.id, NOW
    )
    pg_session.flush()

    assert result.changed is False
    assert result.order_status is OrderStatus.PENDING_PAYMENT
    assert result.slot_status is SlotStatus.LOCKED
    assert slot.locked_by_order_id == other_order.id
    assert slot.locked_until == other_order.expires_at
    assert slot.checkout_version == 7


def test_order_must_belong_to_the_locked_slot(pg_session: Session) -> None:
    pitch = add_pitch(pg_session, venue())
    locked_slot = add_slot(
        pg_session,
        pitch,
        NOW + timedelta(days=1),
        NOW + timedelta(days=1, hours=1),
        checkout_version=3,
    )
    order_slot = add_slot(
        pg_session,
        pitch,
        NOW + timedelta(days=1, hours=1),
        NOW + timedelta(days=1, hours=2),
        checkout_version=9,
    )
    order = Order(
        order_number=f"PB-{uuid.uuid4().hex}",
        user=User(wechat_app_id="wx-test-app", wechat_openid=f"openid-{uuid.uuid4()}"),
        slot=order_slot,
        status=OrderStatus.PENDING_PAYMENT,
        price_cents=36000,
        contact_name="王五",
        contact_phone_ciphertext=b"cross-slot-snapshot-tag",
        contact_phone_nonce=b"zyxwvutsrqpo",
        contact_phone_key_version=1,
        expires_at=NOW - timedelta(seconds=1),
        wechat_prepay_id=None,
    )
    pg_session.add(order)
    pg_session.flush()
    locked_slot.status = SlotStatus.LOCKED
    locked_slot.locked_until = order.expires_at
    locked_slot.locked_by_order_id = order.id
    pg_session.flush()

    result = PendingOrderExpiryService().expire_with_locked_slot(
        pg_session, locked_slot, order.id, NOW
    )
    pg_session.flush()

    assert result.changed is False
    assert order.status is OrderStatus.PENDING_PAYMENT
    assert locked_slot.status is SlotStatus.LOCKED
    assert locked_slot.locked_by_order_id == order.id
    assert locked_slot.checkout_version == 3
    assert order_slot.status == SlotStatus.AVAILABLE
    assert order_slot.checkout_version == 9


def test_safe_expiry_releases_slot_and_increments_version(pg_session: Session) -> None:
    slot, order = _seed_locked_order(pg_session)

    result = PendingOrderExpiryService().expire_with_locked_slot(
        pg_session, slot, order.id, NOW
    )
    pg_session.flush()

    assert result.changed is True
    assert result.order_status is OrderStatus.EXPIRED
    assert result.slot_status is SlotStatus.AVAILABLE
    assert order.status is OrderStatus.EXPIRED
    assert order.expired_at == NOW
    assert slot.status is SlotStatus.AVAILABLE
    assert slot.locked_until is None
    assert slot.locked_by_order_id is None
    assert slot.checkout_version == 8


def test_repeated_expiry_is_idempotent(pg_session: Session) -> None:
    slot, order = _seed_locked_order(pg_session)
    service = PendingOrderExpiryService()

    first = service.expire_by_order_id(pg_session, order.id, NOW)
    pg_session.flush()
    second = service.expire_by_order_id(
        pg_session, order.id, NOW + timedelta(seconds=1)
    )
    pg_session.flush()

    assert first.changed is True
    assert second.changed is False
    assert second.order_status is OrderStatus.EXPIRED
    assert second.slot_status is SlotStatus.AVAILABLE
    assert order.status is OrderStatus.EXPIRED
    assert order.expired_at == NOW
    assert slot.status is SlotStatus.AVAILABLE
    assert slot.checkout_version == 8


def test_direct_helper_refreshes_a_stale_slot_before_applying_invariants(
    pg_engine: Engine,
) -> None:
    with Session(pg_engine) as seed_session:
        slot, order = _seed_locked_order(seed_session)
        slot_id = slot.id
        order_id = order.id
        seed_session.commit()

    with Session(pg_engine) as session_a:
        stale_slot = session_a.get(Slot, slot_id)
        stale_order = session_a.get(Order, order_id)
        assert stale_slot is not None
        assert stale_order is not None
        assert stale_slot.checkout_version == 7
        assert stale_order.wechat_prepay_id is None

        with Session(pg_engine) as session_b:
            current_slot = session_b.get(Slot, slot_id)
            current_order = session_b.get(Order, order_id)
            assert current_slot is not None
            assert current_order is not None
            current_slot.checkout_version = 12
            current_slot.locked_until = NOW + timedelta(minutes=1)
            current_order.wechat_prepay_id = "wx-prepay-after-session-a-read"
            session_b.commit()

        result = PendingOrderExpiryService().expire_with_locked_slot(
            session_a, stale_slot, order_id, NOW
        )
        session_a.flush()

        assert result.changed is False
        assert stale_slot.status is SlotStatus.LOCKED
        assert stale_slot.checkout_version == 12
        assert stale_slot.locked_until == NOW + timedelta(minutes=1)
        assert stale_order.wechat_prepay_id == "wx-prepay-after-session-a-read"


def test_direct_helper_rejects_a_detached_slot(pg_engine: Engine) -> None:
    with Session(pg_engine) as seed_session:
        slot, order = _seed_locked_order(seed_session)
        order_id = order.id
        seed_session.commit()
        seed_session.expunge(slot)

        with pytest.raises(ValueError, match="same session.*persistent"):
            PendingOrderExpiryService().expire_with_locked_slot(
                seed_session, slot, order_id, NOW
            )


def test_direct_helper_rejects_a_slot_owned_by_another_session(
    pg_engine: Engine,
) -> None:
    with Session(pg_engine) as seed_session:
        slot, order = _seed_locked_order(seed_session)
        slot_id = slot.id
        order_id = order.id
        seed_session.commit()

    with Session(pg_engine) as owner_session, Session(pg_engine) as caller_session:
        foreign_slot = owner_session.get(Slot, slot_id)
        assert foreign_slot is not None

        with pytest.raises(ValueError, match="same session.*persistent"):
            PendingOrderExpiryService().expire_with_locked_slot(
                caller_session, foreign_slot, order_id, NOW
            )


@pytest.mark.parametrize("entry_point", ["direct", "by_order_id"])
def test_expiry_entry_points_reject_naive_now(
    pg_session: Session, entry_point: str
) -> None:
    slot, order = _seed_locked_order(pg_session)
    naive_now = NOW.replace(tzinfo=None)
    service = PendingOrderExpiryService()

    with pytest.raises(ValueError, match="now must be timezone-aware"):
        if entry_point == "direct":
            service.expire_with_locked_slot(pg_session, slot, order.id, naive_now)
        else:
            service.expire_by_order_id(pg_session, order.id, naive_now)


def test_expiry_result_documents_transaction_ownership() -> None:
    documentation = ExpiryResult.__doc__ or ""

    assert "staged" in documentation
    assert "commit" in documentation
    assert "caller" in documentation


@pytest.mark.parametrize("entry_point", ["direct", "by_order_id"])
def test_lock_phase_never_autoflushes_a_dirty_order_before_row_locks(
    pg_session: Session, entry_point: str
) -> None:
    slot, order = _seed_locked_order(pg_session)
    connection = pg_session.connection()
    statements: list[str] = []

    def record_statement(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        statements.append(statement)

    event.listen(connection, "before_cursor_execute", record_statement)
    try:
        order.contact_name = "本地未锁定脏值"
        service = PendingOrderExpiryService()
        if entry_point == "direct":
            result = service.expire_with_locked_slot(pg_session, slot, order.id, NOW)
        else:
            result = service.expire_by_order_id(pg_session, order.id, NOW)

        normalized = [statement.upper() for statement in statements]
        slot_lock_index = next(
            index
            for index, statement in enumerate(normalized)
            if "FROM SLOTS" in statement and "FOR UPDATE" in statement
        )
        order_lock_index = next(
            index
            for index, statement in enumerate(normalized)
            if "FROM ORDERS" in statement and "FOR UPDATE" in statement
        )
        assert slot_lock_index < order_lock_index
        assert not any(
            statement.lstrip().startswith("UPDATE ORDERS") for statement in normalized
        )
        assert result.changed is True
        assert order.contact_name == "张三"

        pg_session.flush()

        assert any(
            statement.upper().lstrip().startswith("UPDATE ORDERS")
            for statement in statements
        )
    finally:
        event.remove(connection, "before_cursor_execute", record_statement)


def test_entry_points_leave_commit_and_rollback_to_caller(pg_engine: Engine) -> None:
    with Session(pg_engine) as seed_session:
        _, order = _seed_locked_order(seed_session)
        order_id = order.id
        seed_session.commit()

    with Session(pg_engine) as expiry_session:
        result = PendingOrderExpiryService().expire_by_order_id(
            expiry_session, order_id, NOW
        )
        assert result.changed is True
        assert expiry_session.in_transaction()
        expiry_session.rollback()

    with Session(pg_engine) as verify_session:
        persisted_order = verify_session.get(Order, order_id)
        assert persisted_order is not None
        assert persisted_order.status is OrderStatus.PENDING_PAYMENT
        persisted_slot = verify_session.get(Slot, persisted_order.slot_id)
        assert persisted_slot is not None
        assert persisted_slot.status is SlotStatus.LOCKED
        assert persisted_slot.checkout_version == 7


def test_duplicate_call_waits_for_slot_lock_then_observes_committed_expiry(
    pg_engine: Engine,
) -> None:
    with Session(pg_engine) as seed_session:
        slot, order = _seed_locked_order(seed_session)
        slot_id = slot.id
        order_id = order.id
        seed_session.commit()

    worker_pid: Queue[int] = Queue(maxsize=1)
    worker_started = Event()

    def expire_after_lock() -> bool:
        with Session(pg_engine) as session:
            pid = session.scalar(text("SELECT pg_backend_pid()"))
            assert isinstance(pid, int)
            worker_pid.put(pid)
            worker_started.set()
            result = PendingOrderExpiryService().expire_by_order_id(
                session, order_id, NOW
            )
            session.commit()
            return result.changed

    session_a = Session(pg_engine)
    transaction_a = session_a.begin()
    locked_slot = session_a.scalar(
        select(Slot)
        .where(Slot.id == slot_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    assert locked_slot is not None

    pool = ThreadPoolExecutor(max_workers=1)
    future = pool.submit(expire_after_lock)
    try:
        assert worker_started.wait(timeout=2)
        pid = worker_pid.get(timeout=2)

        deadline = monotonic() + 5
        observed_lock_wait = False
        with pg_engine.connect() as observer:
            while monotonic() < deadline:
                observed_lock_wait = bool(
                    observer.scalar(
                        text(
                            "SELECT EXISTS ("
                            "SELECT 1 FROM pg_stat_activity activity "
                            "JOIN pg_locks lock ON lock.pid = activity.pid "
                            "WHERE activity.pid = :pid "
                            "AND activity.wait_event_type = 'Lock' "
                            "AND lock.granted IS FALSE)"
                        ),
                        {"pid": pid},
                    )
                )
                if observed_lock_wait:
                    break
        assert observed_lock_wait, "duplicate expiry call never waited on the slot lock"
        assert future.done() is False

        direct_result = PendingOrderExpiryService().expire_with_locked_slot(
            session_a, locked_slot, order_id, NOW
        )
        assert direct_result.changed is True
        transaction_a.commit()

        assert future.result(timeout=5) is False
    finally:
        if transaction_a.is_active:
            transaction_a.rollback()
        session_a.close()
        pool.shutdown(wait=True)

    with Session(pg_engine) as session:
        persisted_order = session.scalar(select(Order).where(Order.id == order_id))
        persisted_slot = session.scalar(select(Slot).where(Slot.id == slot_id))
        assert persisted_order is not None
        assert persisted_slot is not None
        assert persisted_order.status is OrderStatus.EXPIRED
        assert persisted_order.expired_at == NOW
        assert persisted_slot.status is SlotStatus.AVAILABLE
        assert persisted_slot.locked_until is None
        assert persisted_slot.locked_by_order_id is None
        assert persisted_slot.checkout_version == 8
