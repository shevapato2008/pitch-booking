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
)
from backend.app.modules.venue_fulfillment.router import (
    router as venue_fulfillment_router,
)
from backend.app.security.phone_vault import PhoneVault
from backend.tests.test_schema_constraints import venue

pytestmark = pytest.mark.integration

NOW = datetime(2026, 8, 18, 10, 0, tzinfo=UTC)
SERVICE_DATE = date(2026, 8, 18)
RAW_TOKEN = "venue-fulfillment-manager-token-with-256-bits"
PHONE_KEY = base64.b64encode(bytes(range(32))).decode("ascii")
PHONE_VAULT = PhoneVault(key_base64=PHONE_KEY, key_version=1)


def _client(engine: Engine, *, now: datetime = NOW) -> TestClient:
    app = create_app(settings=Settings(app_env="test", wechat_provider="development"))
    app.include_router(venue_fulfillment_router)

    def database_override() -> Iterator[Session]:
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_database] = database_override
    app.dependency_overrides[get_phone_vault] = lambda: PHONE_VAULT
    app.dependency_overrides[get_fulfillment_clock] = lambda: now
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
