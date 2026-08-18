import base64
import hashlib
import json
import uuid
from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from backend.app.config import Settings
from backend.app.database import get_database
from backend.app.main import create_app
from backend.app.models import (
    Order,
    OrderStatus,
    Pitch,
    Slot,
    SlotStatus,
    User,
    UserSession,
    Venue,
    VenueMembership,
)
from backend.app.modules.auth.router import get_phone_vault
from backend.app.modules.venue_fulfillment.repository import VenueFulfillmentRepository
from backend.app.modules.venue_fulfillment.router import (
    get_fulfillment_clock,
    get_refund_actions_enabled,
)
from backend.app.security.phone_vault import PhoneVault
from backend.tests.test_schema_constraints import venue

pytestmark = pytest.mark.integration

NOW = datetime(2026, 8, 18, 10, 0, tzinfo=UTC)
SERVICE_DATE = date(2026, 8, 18)
RAW_TOKEN = "venue-fulfillment-manager-token-with-256-bits"
PHONE_KEY = base64.b64encode(bytes(range(32))).decode("ascii")
PHONE_VAULT = PhoneVault(key_base64=PHONE_KEY, key_version=1)


def _client(
    engine: Engine,
    *,
    now: datetime = NOW,
    refund_actions_enabled: bool | None = True,
) -> TestClient:
    app = create_app(settings=Settings(app_env="test", wechat_provider="development"))

    def database_override() -> Iterator[Session]:
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_database] = database_override
    app.dependency_overrides[get_phone_vault] = lambda: PHONE_VAULT
    app.dependency_overrides[get_fulfillment_clock] = lambda: now
    if refund_actions_enabled is not None:
        app.dependency_overrides[get_refund_actions_enabled] = (
            lambda: refund_actions_enabled
        )
    return TestClient(app, raise_server_exceptions=False)


def _auth(token: str = RAW_TOKEN) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _manager(session: Session, *, token: str = RAW_TOKEN) -> User:
    manager = User(
        wechat_app_id="wx-test-app",
        wechat_openid=f"venue-manager-{uuid.uuid4()}",
    )
    session.add(manager)
    session.flush()
    session.add(
        UserSession(
            user=manager,
            token_hash=hashlib.sha256(token.encode()).hexdigest(),
            issued_at=datetime.now(UTC) - timedelta(minutes=1),
            expires_at=datetime.now(UTC) + timedelta(days=1),
        )
    )
    return manager


def _managed_venue(
    session: Session,
    manager: User,
    *,
    active: bool = True,
    membership_active: bool = True,
    can_manage: bool = True,
) -> Venue:
    parent = venue(
        name="浦东星跃足球公园",
        timezone="Asia/Shanghai",
        is_active=active,
    )
    session.add(parent)
    session.flush()
    session.add(
        VenueMembership(
            venue=parent,
            user=manager,
            is_active=membership_active,
            can_manage_inventory=can_manage,
        )
    )
    return parent


def _pitch(session: Session, parent: Venue, *, name: str) -> Pitch:
    sequence = len(parent.pitches) + 1
    row = Pitch(
        venue=parent,
        code=f"P-{uuid.uuid4()}",
        name=name,
        pitch_type="FIVE_A_SIDE",
        sort_order=sequence - 1,
        players_per_side=5,
        system_name=name,
        sequence=sequence,
        status="ACTIVE",
    )
    session.add(row)
    session.flush()
    return row


def _order(
    session: Session,
    *,
    parent: Venue,
    starts_at: datetime,
    order_id: uuid.UUID | None = None,
    status: OrderStatus = OrderStatus.CONFIRMED,
    phone: str = "13812345678",
    pitch_name: str = "五人制 A 场",
) -> Order:
    pitch = _pitch(session, parent, name=pitch_name)
    slot = Slot(
        pitch=pitch,
        starts_at=starts_at,
        ends_at=starts_at + timedelta(hours=2),
        status=SlotStatus.BOOKED,
        price_cents=36000,
    )
    session.add(slot)
    resolved_id = order_id or uuid.uuid4()
    sealed = PHONE_VAULT.encrypt(
        phone,
        record_type="order",
        record_id=resolved_id,
        field="contact_phone",
    )
    row = Order(
        id=resolved_id,
        order_number=f"PB-{resolved_id.hex}",
        user=_manager(session, token=f"owner-{resolved_id.hex}"),
        slot=slot,
        status=status,
        price_cents=36000,
        contact_name="不应出现在履约列表",
        contact_phone_ciphertext=sealed.ciphertext_with_tag,
        contact_phone_nonce=sealed.nonce,
        contact_phone_key_version=sealed.key_version,
        created_at=starts_at - timedelta(days=1),
        expires_at=starts_at - timedelta(hours=20),
    )
    session.add(row)
    session.flush()
    return row


def test_list_authorizes_manager_paginates_and_projects_only_safe_fields(
    pg_engine: Engine,
) -> None:
    low_id = uuid.UUID("00000000-0000-4000-8000-000000000010")
    high_id = uuid.UUID("00000000-0000-4000-8000-000000000011")
    with Session(pg_engine) as session:
        manager = _manager(session)
        parent = _managed_venue(session, manager)
        first = _order(
            session,
            parent=parent,
            starts_at=datetime(2026, 8, 18, 11, tzinfo=UTC),
            order_id=low_id,
        )
        second = _order(
            session,
            parent=parent,
            starts_at=datetime(2026, 8, 18, 11, tzinfo=UTC),
            order_id=high_id,
            pitch_name="五人制 B 场",
        )
        other_venue = venue(name="其他场馆", timezone="Asia/Shanghai")
        session.add(other_venue)
        session.flush()
        _order(
            session,
            parent=other_venue,
            starts_at=datetime(2026, 8, 18, 12, tzinfo=UTC),
        )
        parent_id = parent.id
        parent_name = parent.name
        first_id = first.id
        second_id = second.id
        session.commit()

    with _client(pg_engine) as client:
        page_one = client.get(
            f"/api/v1/venues/{parent_id}/fulfillment/orders?limit=1",
            headers=_auth(),
        )
        cursor = page_one.json()["next_cursor"]
        page_two = client.get(
            f"/api/v1/venues/{parent_id}/fulfillment/orders?limit=1&cursor={cursor}",
            headers=_auth(),
        )
        wrong_date = client.get(
            f"/api/v1/venues/{parent_id}/fulfillment/orders"
            f"?service_date=2026-08-19&cursor={cursor}",
            headers=_auth(),
        )

    assert page_one.status_code == 200
    assert page_two.status_code == 200
    assert wrong_date.status_code == 422
    assert wrong_date.json()["error"]["code"] == "INVALID_ARGUMENT"
    assert page_one.json()["service_date"] == "2026-08-18"
    assert page_one.json()["venue"] == {"id": str(parent_id), "name": parent_name}
    assert [page_one.json()["orders"][0]["id"], page_two.json()["orders"][0]["id"]] == [
        str(first_id),
        str(second_id),
    ]
    assert page_two.json()["next_cursor"] is None
    projected = page_one.json()["orders"][0]
    assert set(projected) == {
        "id",
        "order_number",
        "status",
        "pitch",
        "starts_at",
        "ends_at",
        "masked_phone",
        "checked_in_at",
        "allowed_actions",
    }
    assert projected["masked_phone"] == "138****5678"
    assert projected["starts_at"] == "2026-08-18T19:00:00+08:00"
    assert projected["allowed_actions"] == {
        "can_pay": False,
        "can_cancel": False,
        "can_check_in": True,
        "can_complete": False,
        "can_refund": True,
        "blocked_reason": None,
    }
    serialized = str(page_one.json())
    for secret in (
        "contact_phone_ciphertext",
        "contact_phone_nonce",
        "contact_name",
        "user_id",
        "provider",
        "payment",
        "refund_cases",
        "refund_attempt",
        "13812345678",
    ):
        assert secret not in serialized


def test_list_refund_action_is_fail_closed_until_route_is_enabled(
    pg_engine: Engine,
) -> None:
    with Session(pg_engine) as session:
        manager = _manager(session)
        parent = _managed_venue(session, manager)
        order = _order(
            session,
            parent=parent,
            starts_at=datetime(2026, 8, 18, 11, tzinfo=UTC),
        )
        parent_id = parent.id
        order_id = order.id
        session.commit()

    with _client(pg_engine, refund_actions_enabled=None) as client:
        disabled = client.get(
            f"/api/v1/venues/{parent_id}/fulfillment/orders",
            headers=_auth(),
        )
    with _client(pg_engine, refund_actions_enabled=True) as client:
        enabled = client.get(
            f"/api/v1/venues/{parent_id}/fulfillment/orders",
            headers=_auth(),
        )

    disabled_order = next(
        row for row in disabled.json()["orders"] if row["id"] == str(order_id)
    )
    enabled_order = next(
        row for row in enabled.json()["orders"] if row["id"] == str(order_id)
    )
    assert disabled_order["allowed_actions"]["can_refund"] is False
    assert enabled_order["allowed_actions"]["can_refund"] is True


@pytest.mark.parametrize(
    ("active", "membership_active", "can_manage"),
    [(False, True, True), (True, False, True), (True, True, False)],
)
def test_list_hides_inactive_or_unauthorized_venue(
    pg_engine: Engine,
    *,
    active: bool,
    membership_active: bool,
    can_manage: bool,
) -> None:
    with Session(pg_engine) as session:
        manager = _manager(session)
        parent = _managed_venue(
            session,
            manager,
            active=active,
            membership_active=membership_active,
            can_manage=can_manage,
        )
        parent_id = parent.id
        session.commit()

    with _client(pg_engine) as client:
        response = client.get(
            f"/api/v1/venues/{parent_id}/fulfillment/orders",
            headers=_auth(),
        )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "ORDER_NOT_FOUND"


def test_list_hides_missing_venue_and_rejects_platform_session(pg_engine: Engine) -> None:
    with Session(pg_engine) as session:
        _manager(session)
        unowned = venue(name="无权场馆", timezone="Asia/Shanghai")
        session.add(unowned)
        session.flush()
        unowned_id = unowned.id
        session.commit()

    with _client(pg_engine) as client:
        missing = client.get(
            f"/api/v1/venues/{uuid.uuid4()}/fulfillment/orders",
            headers=_auth(),
        )
        platform_only = client.get(
            f"/api/v1/venues/{uuid.uuid4()}/fulfillment/orders",
            cookies={"pitch_platform_session": "reviewer-session"},
        )
        absent_membership = client.get(
            f"/api/v1/venues/{unowned_id}/fulfillment/orders",
            headers=_auth(),
        )

    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "ORDER_NOT_FOUND"
    assert platform_only.status_code == 401
    assert platform_only.json()["error"]["code"] == "AUTH_REQUIRED"
    assert absent_membership.status_code == 404
    assert absent_membership.json()["error"]["code"] == "ORDER_NOT_FOUND"


def test_explicit_shanghai_date_uses_exact_utc_half_open_interval(
    pg_engine: Engine,
) -> None:
    with Session(pg_engine) as session:
        manager = _manager(session)
        parent = _managed_venue(session, manager)
        included = _order(
            session,
            parent=parent,
            starts_at=datetime(2026, 8, 17, 16, tzinfo=UTC),
            pitch_name="零点场",
        )
        _order(
            session,
            parent=parent,
            starts_at=datetime(2026, 8, 18, 16, tzinfo=UTC),
            pitch_name="次日零点场",
        )
        parent_id = parent.id
        included_id = included.id
        session.commit()

    with _client(pg_engine) as client:
        response = client.get(
            f"/api/v1/venues/{parent_id}/fulfillment/orders?service_date=2026-08-18",
            headers=_auth(),
        )

    assert response.status_code == 200
    assert [row["id"] for row in response.json()["orders"]] == [str(included_id)]


@pytest.mark.parametrize(
    "field",
    ["venue_id", "service_date", "starts_at", "id"],
)
def test_list_rejects_non_string_cursor_fields(
    pg_engine: Engine,
    field: str,
) -> None:
    with Session(pg_engine) as session:
        manager = _manager(session)
        parent = _managed_venue(session, manager)
        parent_id = parent.id
        session.commit()

    payload: dict[str, object] = {
        "v": 1,
        "venue_id": str(parent_id),
        "service_date": "2026-08-18",
        "starts_at": "2026-08-18T11:00:00+00:00",
        "id": str(uuid.uuid4()),
    }
    payload[field] = 42
    cursor = base64.urlsafe_b64encode(
        json.dumps(payload, separators=(",", ":")).encode()
    ).decode().rstrip("=")

    with _client(pg_engine) as client:
        response = client.get(
            f"/api/v1/venues/{parent_id}/fulfillment/orders?cursor={cursor}",
            headers=_auth(),
        )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_ARGUMENT"


def test_list_rolls_back_and_returns_503_on_database_failure(
    pg_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with Session(pg_engine) as session:
        manager = _manager(session)
        parent = _managed_venue(session, manager)
        parent_id = parent.id
        session.commit()

    rolled_back = False
    original_rollback = VenueFulfillmentRepository.rollback

    def fail_list(*_args: object, **_kwargs: object) -> list[Order]:
        raise SQLAlchemyError("database unavailable")

    def record_rollback(repository: VenueFulfillmentRepository) -> None:
        nonlocal rolled_back
        rolled_back = True
        original_rollback(repository)

    monkeypatch.setattr(VenueFulfillmentRepository, "list_orders", fail_list)
    monkeypatch.setattr(VenueFulfillmentRepository, "rollback", record_rollback)

    with _client(pg_engine) as client:
        response = client.get(
            f"/api/v1/venues/{parent_id}/fulfillment/orders",
            headers=_auth(),
        )

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "SERVICE_UNAVAILABLE"
    assert rolled_back is True


def test_check_in_enforces_boundary_and_is_idempotent(pg_engine: Engine) -> None:
    starts_at = NOW + timedelta(hours=2)
    with Session(pg_engine) as session:
        manager = _manager(session)
        parent = _managed_venue(session, manager)
        order = _order(session, parent=parent, starts_at=starts_at)
        manager_id = manager.id
        parent_id = parent.id
        order_id = order.id
        slot_id = order.slot.id
        session.commit()

    path = f"/api/v1/venues/{parent_id}/fulfillment/orders/{order_id}/check-in"
    early = starts_at - timedelta(hours=2, microseconds=1)
    with _client(pg_engine, now=early) as client:
        response = client.post(
            path,
            headers={**_auth(), "Idempotency-Key": "check-in-early-0001"},
        )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "ORDER_STATE_CHANGED"

    exact = starts_at - timedelta(hours=2)
    with _client(pg_engine, now=exact) as client:
        first = client.post(
            path,
            headers={**_auth(), "Idempotency-Key": "check-in-success-0001"},
        )
        same_key = client.post(
            path,
            headers={**_auth(), "Idempotency-Key": "check-in-success-0001"},
        )
        other_key = client.post(
            path,
            headers={**_auth(), "Idempotency-Key": "check-in-success-0002"},
        )

    assert first.status_code == 200
    assert same_key.json() == first.json()
    assert other_key.json() == first.json()
    assert first.json()["status"] == "CONFIRMED"
    assert first.json()["checked_in_at"] == "2026-08-18T18:00:00+08:00"
    assert first.json()["allowed_actions"]["blocked_reason"] == "SESSION_NOT_ENDED"

    with Session(pg_engine) as session:
        persisted = session.get_one(Order, order_id)
        slot = session.get_one(Slot, slot_id)
        assert persisted.checked_in_at == exact
        assert persisted.checked_in_by_user_id == manager_id
        assert slot.status is SlotStatus.BOOKED


def test_check_in_uses_safe_scope_and_closed_business_conflict(pg_engine: Engine) -> None:
    with Session(pg_engine) as session:
        manager = _manager(session)
        parent = _managed_venue(session, manager)
        order = _order(
            session,
            parent=parent,
            starts_at=NOW + timedelta(hours=1),
            status=OrderStatus.PENDING_PAYMENT,
        )
        parent_id = parent.id
        order_id = order.id
        membership_id = parent.memberships[0].id
        session.commit()

    with _client(pg_engine) as client:
        terminal = client.post(
            f"/api/v1/venues/{parent_id}/fulfillment/orders/{order_id}/check-in",
            headers={**_auth(), "Idempotency-Key": "check-in-terminal-01"},
        )
        wrong_venue = client.post(
            f"/api/v1/venues/{uuid.uuid4()}/fulfillment/orders/{order_id}/check-in",
            headers={**_auth(), "Idempotency-Key": "check-in-wrong-venue"},
        )
        unknown = client.post(
            f"/api/v1/venues/{parent_id}/fulfillment/orders/{uuid.uuid4()}/check-in",
            headers={**_auth(), "Idempotency-Key": "check-in-unknown-0001"},
        )

    assert terminal.status_code == 409
    assert terminal.json()["error"]["code"] == "ORDER_STATE_CHANGED"
    assert wrong_venue.status_code == 404
    assert wrong_venue.json()["error"]["code"] == "ORDER_NOT_FOUND"
    assert unknown.status_code == 404
    assert unknown.json()["error"]["code"] == "ORDER_NOT_FOUND"

    with Session(pg_engine) as session:
        session.get_one(VenueMembership, membership_id).is_active = False
        session.commit()
    with _client(pg_engine) as client:
        revoked = client.post(
            f"/api/v1/venues/{parent_id}/fulfillment/orders/{order_id}/check-in",
            headers={**_auth(), "Idempotency-Key": "check-in-revoked-0001"},
        )
    assert revoked.status_code == 404
    assert revoked.json()["error"]["code"] == "ORDER_NOT_FOUND"


def test_complete_projects_specific_read_blocks_but_posts_closed_conflict(
    pg_engine: Engine,
) -> None:
    starts_at = NOW - timedelta(hours=2)
    with Session(pg_engine) as session:
        manager = _manager(session)
        parent = _managed_venue(session, manager)
        missing_check_in = _order(session, parent=parent, starts_at=starts_at)
        checked_in = _order(
            session,
            parent=parent,
            starts_at=starts_at,
            pitch_name="五人制 B 场",
        )
        checked_in.checked_in_at = starts_at
        checked_in.checked_in_by_user_id = manager.id
        parent_id = parent.id
        missing_id = missing_check_in.id
        checked_id = checked_in.id
        session.commit()

    missing_path = (
        f"/api/v1/venues/{parent_id}/fulfillment/orders/{missing_id}/complete"
    )
    checked_path = (
        f"/api/v1/venues/{parent_id}/fulfillment/orders/{checked_id}/complete"
    )
    with _client(pg_engine, now=NOW) as client:
        missing = client.post(
            missing_path,
            headers={**_auth(), "Idempotency-Key": "complete-missing-checkin"},
        )
        read_missing = client.get(
            f"/api/v1/venues/{parent_id}/fulfillment/orders",
            headers=_auth(),
        )

    assert missing.status_code == 409
    assert missing.json()["error"]["code"] == "ORDER_STATE_CHANGED"
    missing_projection = next(
        row for row in read_missing.json()["orders"] if row["id"] == str(missing_id)
    )
    assert missing_projection["allowed_actions"]["blocked_reason"] == "CHECK_IN_REQUIRED"

    early = NOW - timedelta(microseconds=1)
    with _client(pg_engine, now=early) as client:
        too_early = client.post(
            checked_path,
            headers={**_auth(), "Idempotency-Key": "complete-too-early-01"},
        )
        read_early = client.get(
            f"/api/v1/venues/{parent_id}/fulfillment/orders",
            headers=_auth(),
        )

    assert too_early.status_code == 409
    assert too_early.json()["error"]["code"] == "ORDER_STATE_CHANGED"
    early_projection = next(
        row for row in read_early.json()["orders"] if row["id"] == str(checked_id)
    )
    assert early_projection["allowed_actions"]["blocked_reason"] == "SESSION_NOT_ENDED"


def test_complete_at_exact_end_is_business_idempotent_and_binds_key(
    pg_engine: Engine,
) -> None:
    starts_at = NOW - timedelta(hours=2)
    with Session(pg_engine) as session:
        manager = _manager(session)
        parent = _managed_venue(session, manager)
        first_order = _order(session, parent=parent, starts_at=starts_at)
        second_order = _order(
            session,
            parent=parent,
            starts_at=starts_at,
            pitch_name="五人制 B 场",
        )
        for order in (first_order, second_order):
            order.checked_in_at = starts_at
            order.checked_in_by_user_id = manager.id
        manager_id = manager.id
        parent_id = parent.id
        first_id = first_order.id
        second_id = second_order.id
        slot_id = first_order.slot.id
        session.commit()

    first_path = f"/api/v1/venues/{parent_id}/fulfillment/orders/{first_id}/complete"
    second_path = f"/api/v1/venues/{parent_id}/fulfillment/orders/{second_id}/complete"
    with _client(pg_engine, now=NOW) as client:
        first = client.post(
            first_path,
            headers={**_auth(), "Idempotency-Key": "complete-success-0001"},
        )
        replay = client.post(
            first_path,
            headers={**_auth(), "Idempotency-Key": "complete-success-0001"},
        )
        business_replay = client.post(
            first_path,
            headers={**_auth(), "Idempotency-Key": "complete-success-0002"},
        )
        reused = client.post(
            second_path,
            headers={**_auth(), "Idempotency-Key": "complete-success-0001"},
        )

    assert first.status_code == 200
    assert replay.json() == first.json()
    assert business_replay.json() == first.json()
    assert first.json()["status"] == "COMPLETED"
    assert first.json()["allowed_actions"]["blocked_reason"] == "ORDER_TERMINAL"
    assert reused.status_code == 409
    assert reused.json()["error"]["code"] == "IDEMPOTENCY_KEY_REUSED"

    with Session(pg_engine) as session:
        persisted = session.get_one(Order, first_id)
        slot = session.get_one(Slot, slot_id)
        assert persisted.status is OrderStatus.COMPLETED
        assert persisted.checked_in_at == starts_at
        assert persisted.checked_in_by_user_id == manager_id
        assert persisted.completed_at == NOW
        assert persisted.completed_by_user_id == manager_id
        assert slot.status is SlotStatus.BOOKED
