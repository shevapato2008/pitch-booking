import base64
import hashlib
import uuid
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier, Lock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, create_engine, func, select, text
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool

from backend.app.config import Settings
from backend.app.database import get_database
from backend.app.main import create_app
from backend.app.models import (
    IdempotencyRecord,
    IdempotencyState,
    Order,
    OrderStatus,
    Slot,
    SlotStatus,
    User,
    UserSession,
)
from backend.app.security.phone_vault import PhoneVault
from backend.tests.test_schema_constraints import add_pitch, add_slot, venue

pytestmark = pytest.mark.integration

WORKERS = 20
KEY_BASE64 = base64.b64encode(bytes(range(32))).decode("ascii")
KEY_VERSION = 7
FULL_PHONE = "13812345678"


def _seed_concurrency_case(engine: Engine) -> tuple[uuid.UUID, int, list[str]]:
    with Session(engine) as session:
        now = datetime.now(UTC)
        pitch = add_pitch(session, venue(timezone="Asia/Shanghai"))
        slot = add_slot(
            session,
            pitch,
            now + timedelta(days=1),
            now + timedelta(days=1, hours=2),
            price_cents=32000,
            checkout_version=12,
        )
        session.flush()
        tokens: list[str] = []
        vault = PhoneVault(key_base64=KEY_BASE64, key_version=KEY_VERSION)
        for index in range(WORKERS):
            raw_token = f"concurrent-order-token-{index:02d}-with-enough-entropy"
            user = User(
                wechat_app_id="wx-test-app",
                wechat_openid=f"concurrent-user-{uuid.uuid4()}",
            )
            session.add(user)
            session.flush()
            sealed = vault.encrypt(
                FULL_PHONE,
                record_type="user",
                record_id=user.id,
                field="phone",
            )
            user.phone_ciphertext = sealed.ciphertext_with_tag
            user.phone_nonce = sealed.nonce
            user.phone_key_version = sealed.key_version
            user.phone_verified_at = now
            session.add(
                UserSession(
                    user=user,
                    token_hash=hashlib.sha256(raw_token.encode()).hexdigest(),
                    issued_at=now,
                    expires_at=now + timedelta(days=1),
                )
            )
            tokens.append(raw_token)
        slot_id = slot.id
        version = slot.checkout_version
        session.commit()
        return slot_id, version, tokens


def _concurrent_client(
    engine: Engine,
    barrier: Barrier,
    backend_pids: set[int],
    pid_lock: Lock,
) -> TestClient:
    app = create_app(
        settings=Settings(
            app_env="test",
            wechat_provider="development",
            phone_encryption_key_base64=KEY_BASE64,
            phone_encryption_key_version=KEY_VERSION,
        )
    )

    def database_override() -> Iterator[Session]:
        request_engine = create_engine(engine.url, poolclass=NullPool)
        try:
            with Session(request_engine) as session:
                barrier.wait(timeout=20)
                backend_pid = session.scalar(text("SELECT pg_backend_pid()"))
                assert backend_pid is not None
                with pid_lock:
                    backend_pids.add(backend_pid)
                barrier.wait(timeout=20)
                yield session
        finally:
            request_engine.dispose()

    app.dependency_overrides[get_database] = database_override
    return TestClient(app, raise_server_exceptions=False)


def test_twenty_users_compete_for_one_slot_with_exactly_one_winner(
    pg_engine: Engine,
) -> None:
    slot_id, version, tokens = _seed_concurrency_case(pg_engine)
    barrier = Barrier(WORKERS)
    backend_pids: set[int] = set()
    pid_lock = Lock()
    body = {
        "slot_id": str(slot_id),
        "checkout_version": version,
        "contact_name": "张三",
    }

    with _concurrent_client(pg_engine, barrier, backend_pids, pid_lock) as client:
        with ThreadPoolExecutor(max_workers=WORKERS) as executor:
            futures = [
                executor.submit(
                    client.post,
                    "/api/v1/orders",
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Idempotency-Key": f"inventory-race-key-{index:04d}",
                    },
                    json=body,
                )
                for index, token in enumerate(tokens)
            ]
            responses = [future.result(timeout=30) for future in futures]

    assert len(backend_pids) == WORKERS
    assert sum(response.status_code == 201 for response in responses) == 1
    losers = [response for response in responses if response.status_code != 201]
    assert len(losers) == WORKERS - 1
    assert all(response.status_code == 409 for response in losers)
    assert all(response.json()["error"]["code"] == "SLOT_NOT_AVAILABLE" for response in losers)

    with Session(pg_engine) as session:
        slot = session.get_one(Slot, slot_id)
        pending = session.scalars(
            select(Order).where(Order.status == OrderStatus.PENDING_PAYMENT)
        ).all()
        assert len(pending) == 1
        assert slot.status is SlotStatus.LOCKED
        assert slot.locked_by_order_id == pending[0].id
        assert slot.locked_until == pending[0].expires_at
        assert slot.checkout_version == version + 1
        assert session.scalar(select(func.count()).select_from(IdempotencyRecord)) == 1
        record = session.scalar(select(IdempotencyRecord))
        assert record is not None
        assert record.state is IdempotencyState.COMPLETED


def test_twenty_same_key_requests_all_replay_first_201_exactly(
    pg_engine: Engine,
) -> None:
    slot_id, version, tokens = _seed_concurrency_case(pg_engine)
    barrier = Barrier(WORKERS)
    backend_pids: set[int] = set()
    pid_lock = Lock()
    body = {
        "slot_id": str(slot_id),
        "checkout_version": version,
        "contact_name": " 张三 ",
    }
    shared_token = tokens[0]
    shared_key = "same-key-race-000000000001"

    with _concurrent_client(pg_engine, barrier, backend_pids, pid_lock) as client:
        with ThreadPoolExecutor(max_workers=WORKERS) as executor:
            futures = [
                executor.submit(
                    client.post,
                    "/api/v1/orders",
                    headers={
                        "Authorization": f"Bearer {shared_token}",
                        "Idempotency-Key": shared_key,
                    },
                    json=body,
                )
                for _index in range(WORKERS)
            ]
            responses = [future.result(timeout=30) for future in futures]

    assert len(backend_pids) == WORKERS
    assert all(response.status_code == 201 for response in responses)
    assert len({response.content for response in responses}) == 1

    with Session(pg_engine) as session:
        slot = session.get_one(Slot, slot_id)
        orders = session.scalars(select(Order)).all()
        records = session.scalars(select(IdempotencyRecord)).all()
        assert len(orders) == 1
        assert len(records) == 1
        assert records[0].state is IdempotencyState.COMPLETED
        assert records[0].response_status == 201
        assert records[0].response_body == responses[0].json()
        assert slot.status is SlotStatus.LOCKED
        assert slot.locked_by_order_id == orders[0].id
        assert slot.checkout_version == version + 1
