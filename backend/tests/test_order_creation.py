import base64
import hashlib
import json
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, event, func, select
from sqlalchemy.orm import Session

from backend.app.config import Settings
from backend.app.database import get_database
from backend.app.errors import AppError
from backend.app.main import create_app
from backend.app.models import (
    IdempotencyRecord,
    IdempotencyState,
    Order,
    OrderStatus,
    Payment,
    PaymentState,
    Slot,
    SlotStatus,
    User,
    UserSession,
)
from backend.app.modules.orders.repository import OrderRepository
from backend.app.modules.orders.service import OrderService
from backend.app.security.phone_vault import PhoneVault, SealedPhone
from backend.tests.test_schema_constraints import add_pitch, add_slot, venue

pytestmark = pytest.mark.integration

KEY_BASE64 = base64.b64encode(bytes(range(32))).decode("ascii")
KEY_VERSION = 7
FULL_PHONE = "13812345678"
RAW_TOKEN = "order-business-token-with-at-least-256-bits-of-entropy"
IDEMPOTENCY_KEY = "create-order-key-000000000001"
SHANGHAI = ZoneInfo("Asia/Shanghai")
CANCELLATION_SUMMARY = "开场前 24 小时可免费取消；不足 24 小时取消将收取订单金额的 50%。"


@dataclass(frozen=True, slots=True)
class SeededOrder:
    user_id: uuid.UUID
    slot_id: uuid.UUID
    pitch_id: uuid.UUID
    venue_id: uuid.UUID
    starts_at: datetime
    ends_at: datetime
    checkout_version: int
    raw_token: str
    stale_order_id: uuid.UUID | None = None


def _verified_user(
    session: Session,
    *,
    raw_token: str = RAW_TOKEN,
    phone: Literal["verified", "missing", "corrupt"] = "verified",
    session_expired: bool = False,
) -> User:
    now = datetime.now(UTC)
    user = User(
        wechat_app_id="wx-test-app",
        wechat_openid=f"order-user-{uuid.uuid4()}",
        last_contact_name="旧联系人",
    )
    session.add(user)
    session.flush()
    if phone != "missing":
        sealed = PhoneVault(key_base64=KEY_BASE64, key_version=KEY_VERSION).encrypt(
            FULL_PHONE,
            record_type="user",
            record_id=user.id,
            field="phone",
        )
        user.phone_ciphertext = sealed.ciphertext_with_tag
        user.phone_nonce = sealed.nonce
        user.phone_key_version = sealed.key_version
        user.phone_verified_at = now
        if phone == "corrupt":
            user.phone_ciphertext = bytes(len(sealed.ciphertext_with_tag))
    session.add(
        UserSession(
            user=user,
            token_hash=hashlib.sha256(raw_token.encode()).hexdigest(),
            issued_at=now - timedelta(days=2) if session_expired else now,
            expires_at=now - timedelta(days=1) if session_expired else now + timedelta(days=1),
        )
    )
    return user


def _snapshot_phone(session: Session, order: Order, phone: str = FULL_PHONE) -> None:
    sealed = PhoneVault(key_base64=KEY_BASE64, key_version=KEY_VERSION).encrypt(
        phone,
        record_type="order",
        record_id=order.id,
        field="contact_phone",
    )
    order.contact_phone_ciphertext = sealed.ciphertext_with_tag
    order.contact_phone_nonce = sealed.nonce
    order.contact_phone_key_version = sealed.key_version


def _seed_order_case(
    engine: Engine,
    *,
    phone: Literal["verified", "missing", "corrupt"] = "verified",
    session_expired: bool = False,
    slot_status: SlotStatus = SlotStatus.AVAILABLE,
    slot_in_past: bool = False,
    stale_lock: Literal["none", "releasable", "prepay", "owner-mismatch"] = "none",
    existing_for_user: bool = False,
) -> SeededOrder:
    with Session(engine) as session:
        now = datetime.now(UTC)
        user = _verified_user(
            session,
            phone=phone,
            session_expired=session_expired,
        )
        parent = venue(
            timezone="Asia/Shanghai",
            refund_policy_text=CANCELLATION_SUMMARY,
        )
        pitch = add_pitch(session, parent)
        if slot_in_past:
            starts_at = now - timedelta(hours=2)
        else:
            local_start = datetime.combine(
                now.astimezone(SHANGHAI).date() + timedelta(days=1),
                datetime.min.time().replace(hour=19),
                SHANGHAI,
            )
            starts_at = local_start.astimezone(UTC)
        ends_at = starts_at + timedelta(hours=2)
        slot = add_slot(
            session,
            pitch,
            starts_at,
            ends_at,
            price_cents=32000,
            checkout_version=12,
        )
        session.flush()

        stale_order_id: uuid.UUID | None = None
        if existing_for_user:
            order = Order(
                id=uuid.uuid4(),
                order_number=f"PB-{uuid.uuid4().hex}",
                user=user,
                slot=slot,
                status=OrderStatus.PENDING_PAYMENT,
                price_cents=31000,
                contact_name="原始联系人",
                contact_phone_ciphertext=b"temporary-encrypted-value",
                contact_phone_nonce=b"abcdefghijkl",
                contact_phone_key_version=1,
                created_at=now - timedelta(minutes=2),
                expires_at=now + timedelta(minutes=8),
                wechat_prepay_id=None,
            )
            _snapshot_phone(session, order)
            session.add(order)
            session.flush()
            slot.status = SlotStatus.LOCKED
            slot.locked_until = order.expires_at
            slot.locked_by_order_id = order.id
            stale_order_id = order.id
        elif stale_lock != "none" or slot_status is SlotStatus.LOCKED:
            order_slot = slot
            if stale_lock == "owner-mismatch":
                order_slot = add_slot(
                    session,
                    pitch,
                    ends_at,
                    ends_at + timedelta(hours=1),
                    checkout_version=4,
                )
                session.flush()
            lock_owner = User(
                wechat_app_id="wx-test-app",
                wechat_openid=f"lock-owner-{uuid.uuid4()}",
            )
            stale_order = Order(
                id=uuid.uuid4(),
                order_number=f"PB-{uuid.uuid4().hex}",
                user=lock_owner,
                slot=order_slot,
                status=OrderStatus.PENDING_PAYMENT,
                price_cents=32000,
                contact_name="锁定用户",
                contact_phone_ciphertext=b"old-encrypted-phone-tag",
                contact_phone_nonce=b"abcdefghijkl",
                contact_phone_key_version=1,
                created_at=now - timedelta(minutes=11),
                expires_at=(
                    now + timedelta(minutes=5)
                    if stale_lock == "none"
                    else now - timedelta(seconds=1)
                ),
                wechat_prepay_id="wx-prepay-present" if stale_lock == "prepay" else None,
            )
            session.add(stale_order)
            session.flush()
            slot.status = SlotStatus.LOCKED
            slot.locked_until = stale_order.expires_at
            slot.locked_by_order_id = stale_order.id
            if stale_lock == "prepay":
                session.add(
                    Payment(
                        order=stale_order,
                        provider="mock",
                        merchant_order_no=f"M-{uuid.uuid4().hex}",
                        provider_prepay_id="wx-prepay-present",
                        amount_cents=stale_order.price_cents,
                        currency="CNY",
                        status=PaymentState.PREPAY_CREATED,
                    )
                )
            stale_order_id = stale_order.id
        elif slot_status is not SlotStatus.AVAILABLE:
            slot.status = slot_status

        session.flush()
        result = SeededOrder(
            user_id=user.id,
            slot_id=slot.id,
            pitch_id=pitch.id,
            venue_id=parent.id,
            starts_at=starts_at,
            ends_at=ends_at,
            checkout_version=slot.checkout_version,
            raw_token=RAW_TOKEN,
            stale_order_id=stale_order_id,
        )
        session.commit()
        return result


def _client(engine: Engine, *, with_vault: bool = True) -> TestClient:
    settings_values: dict[str, object] = {
        "app_env": "test",
        "wechat_provider": "development",
    }
    if with_vault:
        settings_values.update(
            phone_encryption_key_base64=KEY_BASE64,
            phone_encryption_key_version=KEY_VERSION,
        )
    app = create_app(settings=Settings(**settings_values))

    def database_override() -> Iterator[Session]:
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_database] = database_override
    return TestClient(app, raise_server_exceptions=False)


def _headers(
    *,
    token: str = RAW_TOKEN,
    key: str | None = IDEMPOTENCY_KEY,
) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {token}"}
    if key is not None:
        headers["Idempotency-Key"] = key
    return headers


def _body(
    seeded: SeededOrder,
    *,
    contact_name: str = " 张三 ",
    checkout_version: int | None = None,
) -> dict[str, object]:
    return {
        "slot_id": str(seeded.slot_id),
        "checkout_version": (
            seeded.checkout_version if checkout_version is None else checkout_version
        ),
        "contact_name": contact_name,
    }


def test_create_order_operation_declares_only_frozen_public_responses() -> None:
    app = create_app(settings=Settings(app_env="test", wechat_provider="development"))
    document = app.openapi()
    operation = document["paths"]["/api/v1/orders"]["post"]

    assert set(operation["responses"]) == {"200", "201", "401", "409", "422"}
    idempotency_parameter = next(
        parameter
        for parameter in operation["parameters"]
        if parameter["name"] == "Idempotency-Key"
    )
    assert idempotency_parameter["required"] is True
    assert idempotency_parameter["schema"]["minLength"] == 16
    assert idempotency_parameter["schema"]["maxLength"] == 128
    request_schema = document["components"]["schemas"]["CreateOrderRequest"]
    assert request_schema["additionalProperties"] is False
    assert set(request_schema["required"]) == {
        "slot_id",
        "checkout_version",
        "contact_name",
    }
    assert set(request_schema["properties"]) == {
        "slot_id",
        "checkout_version",
        "contact_name",
    }
    assert request_schema["properties"]["contact_name"]["minLength"] == 1
    assert request_schema["properties"]["contact_name"]["maxLength"] == 40


def test_create_order_requires_valid_bearer(pg_engine: Engine) -> None:
    seeded = _seed_order_case(pg_engine)
    body = _body(seeded)

    with _client(pg_engine) as client:
        missing = client.post(
            "/api/v1/orders",
            headers={"Idempotency-Key": IDEMPOTENCY_KEY},
            json=body,
        )
        invalid = client.post(
            "/api/v1/orders",
            headers=_headers(token="invalid-token"),
            json=body,
        )

    assert missing.status_code == invalid.status_code == 401
    assert missing.json()["error"]["code"] == "AUTH_REQUIRED"
    assert invalid.json()["error"]["code"] == "AUTH_REQUIRED"


def test_create_order_rejects_expired_bearer(pg_engine: Engine) -> None:
    seeded = _seed_order_case(pg_engine, session_expired=True)

    with _client(pg_engine) as client:
        response = client.post(
            "/api/v1/orders",
            headers=_headers(),
            json=_body(seeded),
        )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_REQUIRED"


@pytest.mark.parametrize(
    "key",
    [None, "short", "x" * 129],
    ids=["missing", "too-short", "too-long"],
)
def test_create_order_rejects_missing_or_invalid_idempotency_key(
    pg_engine: Engine,
    key: str | None,
) -> None:
    seeded = _seed_order_case(pg_engine)

    with _client(pg_engine) as client:
        response = client.post(
            "/api/v1/orders",
            headers=_headers(key=key),
            json=_body(seeded),
        )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_ARGUMENT"


@pytest.mark.parametrize("extra", [{"amount": 1}, {"phone": "13900000000"}])
def test_create_order_body_is_closed_and_rejects_client_authority_fields(
    pg_engine: Engine,
    extra: dict[str, object],
) -> None:
    seeded = _seed_order_case(pg_engine)

    with _client(pg_engine) as client:
        response = client.post(
            "/api/v1/orders",
            headers=_headers(),
            json=_body(seeded) | extra,
        )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_ARGUMENT"
    with Session(pg_engine) as session:
        assert session.scalar(select(func.count()).select_from(Order)) == 0
        assert session.scalar(select(func.count()).select_from(IdempotencyRecord)) == 0


@pytest.mark.parametrize(
    "contact_name",
    ["", f"{' ' * 100}张三"],
    ids=["raw-empty", "raw-over-40-before-trim"],
)
def test_create_order_enforces_raw_contact_schema_length_before_business_normalization(
    pg_engine: Engine,
    contact_name: str,
) -> None:
    seeded = _seed_order_case(pg_engine)

    with _client(pg_engine) as client:
        response = client.post(
            "/api/v1/orders",
            headers=_headers(),
            json=_body(seeded, contact_name=contact_name),
        )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_ARGUMENT"
    with Session(pg_engine) as session:
        user = session.get_one(User, seeded.user_id)
        slot = session.get_one(Slot, seeded.slot_id)
        assert user.last_contact_name == "旧联系人"
        assert slot.status is SlotStatus.AVAILABLE
        assert slot.locked_until is None
        assert slot.locked_by_order_id is None
        assert slot.checkout_version == seeded.checkout_version
        assert session.scalar(select(func.count()).select_from(Order)) == 0
        assert session.scalar(select(func.count()).select_from(IdempotencyRecord)) == 0


@pytest.mark.parametrize(
    "contact_name",
    [
        "张三",
        "A1",
        "张三 Li",
        "阿·布",
        "Jean-Luc",
        "一" * 30,
        "\U0002f800张",
        "\U0002ebf0张",
    ],
    ids=[
        "common-han",
        "latin-digit",
        "han-latin-space",
        "middle-dot",
        "hyphen",
        "30-codepoints",
        "cjk-compatibility-supplement-u2f800",
        "cjk-extension-i-u2ebf0",
    ],
)
def test_create_order_accepts_contact_character_and_codepoint_boundaries(
    pg_engine: Engine,
    contact_name: str,
) -> None:
    seeded = _seed_order_case(pg_engine)

    with _client(pg_engine) as client:
        response = client.post(
            "/api/v1/orders",
            headers=_headers(),
            json=_body(seeded, contact_name=f" {contact_name} "),
        )

    assert response.status_code == 201
    assert response.json()["contact"]["name"] == contact_name


@pytest.mark.parametrize(
    "contact_name",
    ["   ", "张", "一" * 31, "张_三", "张😀", "张/三", "张\t三", "かな"],
    ids=[
        "blank",
        "one-codepoint",
        "31-codepoints",
        "underscore",
        "emoji",
        "slash",
        "tab",
        "japanese-kana",
    ],
)
def test_invalid_contact_returns_frozen_business_error(
    pg_engine: Engine,
    contact_name: str,
) -> None:
    seeded = _seed_order_case(pg_engine)

    with _client(pg_engine) as client:
        response = client.post(
            "/api/v1/orders",
            headers=_headers(),
            json=_body(seeded, contact_name=contact_name),
        )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_CONTACT"
    assert response.json()["error"]["details"] == {"field": "contact_name"}


def test_create_order_requires_complete_verified_phone(pg_engine: Engine) -> None:
    seeded = _seed_order_case(pg_engine, phone="missing")

    with _client(pg_engine) as client:
        response = client.post(
            "/api/v1/orders",
            headers=_headers(),
            json=_body(seeded),
        )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "PHONE_AUTH_REQUIRED"
    with Session(pg_engine) as session:
        assert session.scalar(select(func.count()).select_from(Order)) == 0
        assert session.scalar(select(func.count()).select_from(IdempotencyRecord)) == 0


@pytest.mark.parametrize(
    ("phone", "with_vault"),
    [("corrupt", True), ("verified", False)],
    ids=["corrupt-ciphertext", "vault-unavailable"],
)
def test_phone_state_and_vault_failures_fail_closed_without_secret_leakage(
    pg_engine: Engine,
    phone: Literal["verified", "corrupt"],
    with_vault: bool,
) -> None:
    seeded = _seed_order_case(pg_engine, phone=phone)

    with _client(pg_engine, with_vault=with_vault) as client:
        response = client.post(
            "/api/v1/orders",
            headers=_headers(),
            json=_body(seeded),
        )

    assert response.status_code == 500
    assert response.json()["error"]["code"] == "INTERNAL_ERROR"
    assert FULL_PHONE not in response.text
    with Session(pg_engine) as session:
        user = session.get_one(User, seeded.user_id)
        assert repr(user.phone_ciphertext) not in response.text
        assert session.scalar(select(func.count()).select_from(Order)) == 0
        assert session.scalar(select(func.count()).select_from(IdempotencyRecord)) == 0


@pytest.mark.parametrize(
    "missing_field",
    ["phone_ciphertext", "phone_nonce", "phone_key_version", "phone_verified_at"],
)
def test_partial_phone_state_fails_closed_without_secret_leakage(
    missing_field: str,
) -> None:
    user = User(
        id=uuid.uuid4(),
        wechat_app_id="wx-test-app",
        wechat_openid=f"partial-order-phone-{uuid.uuid4()}",
    )
    vault = PhoneVault(key_base64=KEY_BASE64, key_version=KEY_VERSION)
    sealed = vault.encrypt(
        FULL_PHONE,
        record_type="user",
        record_id=user.id,
        field="phone",
    )
    user.phone_ciphertext = sealed.ciphertext_with_tag
    user.phone_nonce = sealed.nonce
    user.phone_key_version = sealed.key_version
    user.phone_verified_at = datetime.now(UTC)
    setattr(user, missing_field, None)

    with pytest.raises(AppError) as captured:
        service = OrderService(
            repository=OrderRepository(Session()),
            phone_vault=vault,
        )
        service._verified_phone(user)

    assert captured.value.status_code == 500
    assert captured.value.code == "INTERNAL_ERROR"
    assert FULL_PHONE not in str(captured.value)
    assert repr(user.phone_ciphertext) not in str(captured.value)


def test_stale_available_checkout_version_returns_full_current_checkout(
    pg_engine: Engine,
) -> None:
    seeded = _seed_order_case(pg_engine)

    with _client(pg_engine) as client:
        response = client.post(
            "/api/v1/orders",
            headers=_headers(),
            json=_body(seeded, checkout_version=seeded.checkout_version - 1),
        )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "PRICE_CHANGED"
    current = response.json()["error"]["details"]["current_checkout"]
    assert set(current) == {
        "slot_id",
        "venue",
        "pitch",
        "date",
        "starts_at",
        "ends_at",
        "duration_minutes",
        "price_cents",
        "currency",
        "available",
        "cancellation_summary",
        "lock_duration_seconds",
        "contact",
        "checkout_version",
    }
    assert current["slot_id"] == str(seeded.slot_id)
    assert current["venue"]["id"] == str(seeded.venue_id)
    assert current["pitch"]["id"] == str(seeded.pitch_id)
    assert current["starts_at"] == seeded.starts_at.astimezone(SHANGHAI).isoformat()
    assert current["ends_at"] == seeded.ends_at.astimezone(SHANGHAI).isoformat()
    assert current["duration_minutes"] == 120
    assert current["price_cents"] == 32000
    assert current["currency"] == "CNY"
    assert current["available"] is True
    assert current["cancellation_summary"] == CANCELLATION_SUMMARY
    assert current["lock_duration_seconds"] == 600
    assert current["contact"] == {
        "masked_phone": "138****5678",
        "last_contact_name": "旧联系人",
    }
    assert current["checkout_version"] == seeded.checkout_version
    assert FULL_PHONE not in response.text
    with Session(pg_engine) as session:
        assert session.scalar(select(func.count()).select_from(IdempotencyRecord)) == 0


@pytest.mark.parametrize(
    "slot_status",
    [SlotStatus.LOCKED, SlotStatus.BOOKED, SlotStatus.CLOSED],
)
def test_unavailable_slot_takes_priority_over_stale_checkout_version(
    pg_engine: Engine,
    slot_status: SlotStatus,
) -> None:
    seeded = _seed_order_case(pg_engine, slot_status=slot_status)

    with _client(pg_engine) as client:
        response = client.post(
            "/api/v1/orders",
            headers=_headers(),
            json=_body(seeded, checkout_version=1),
        )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "SLOT_NOT_AVAILABLE"
    assert "current_checkout" not in response.json()["error"]["details"]


def test_missing_and_past_slots_are_not_available(pg_engine: Engine) -> None:
    seeded = _seed_order_case(pg_engine, slot_in_past=True)
    missing_slot_body = _body(seeded) | {"slot_id": str(uuid.uuid4())}

    with _client(pg_engine) as client:
        past = client.post(
            "/api/v1/orders",
            headers=_headers(key="past-slot-create-key-0001"),
            json=_body(seeded),
        )
        missing = client.post(
            "/api/v1/orders",
            headers=_headers(key="missing-slot-create-key-01"),
            json=missing_slot_body,
        )

    assert past.status_code == missing.status_code == 409
    assert past.json()["error"]["code"] == "SLOT_NOT_AVAILABLE"
    assert missing.json()["error"]["code"] == "SLOT_NOT_AVAILABLE"


def test_success_creates_server_authoritative_snapshots_and_lock(pg_engine: Engine) -> None:
    seeded = _seed_order_case(pg_engine)
    request_started = datetime.now(UTC)

    with _client(pg_engine) as client:
        response = client.post(
            "/api/v1/orders",
            headers=_headers(),
            json=_body(seeded, contact_name="  张三  ") | {"ignored-query": "not-body"},
        )
    request_finished = datetime.now(UTC)

    assert response.status_code == 422
    # A closed request rejects the extra field; send the authoritative request next.
    with _client(pg_engine) as client:
        response = client.post(
            "/api/v1/orders?amount=1&phone=13900000000",
            headers=_headers(key="server-authority-key-000001"),
            json=_body(seeded, contact_name="  张三  "),
        )
    request_finished = datetime.now(UTC)

    assert response.status_code == 201
    payload = response.json()
    assert set(payload) == {
        "id",
        "order_number",
        "status",
        "slot_id",
        "venue",
        "pitch",
        "starts_at",
        "ends_at",
        "duration_minutes",
        "price_cents",
        "currency",
        "contact",
        "created_at",
        "expires_at",
        "expired_at",
        "cancellation_summary",
        "payment_state",
        "payment_confirming",
        "closing_payment",
        "paid_at",
        "detail_path",
    }
    assert payload["payment_state"] is None
    assert payload["payment_confirming"] is False
    assert payload["paid_at"] is None
    order_id = uuid.UUID(payload["id"])
    assert payload["status"] == "PENDING_PAYMENT"
    assert payload["slot_id"] == str(seeded.slot_id)
    assert payload["venue"] == {
        "id": str(seeded.venue_id),
        "name": "浦东星跃足球公园",
        "address": "上海市浦东新区锦绣东路 2777 弄 18 号",
        "latitude": 31.2304,
        "longitude": 121.4737,
        "customer_service_phone": "+86-21-5899-2608",
    }
    assert payload["pitch"] == {"id": str(seeded.pitch_id), "name": "五人制 A 场"}
    assert payload["starts_at"] == seeded.starts_at.astimezone(SHANGHAI).isoformat()
    assert payload["ends_at"] == seeded.ends_at.astimezone(SHANGHAI).isoformat()
    assert payload["duration_minutes"] == 120
    assert payload["price_cents"] == 32000
    assert payload["currency"] == "CNY"
    assert payload["contact"] == {"name": "张三", "masked_phone": "138****5678"}
    assert payload["expired_at"] is None
    assert payload["cancellation_summary"] == CANCELLATION_SUMMARY
    assert payload["closing_payment"] is False
    assert payload["detail_path"] == f"/api/v1/orders/{order_id}"
    assert FULL_PHONE not in response.text

    created_at = datetime.fromisoformat(payload["created_at"])
    expires_at = datetime.fromisoformat(payload["expires_at"])
    assert request_started <= created_at.astimezone(UTC) <= request_finished
    assert expires_at - created_at == timedelta(seconds=600)

    vault = PhoneVault(key_base64=KEY_BASE64, key_version=KEY_VERSION)
    with Session(pg_engine) as session:
        order = session.get_one(Order, order_id)
        slot = session.get_one(Slot, seeded.slot_id)
        user = session.get_one(User, seeded.user_id)
        assert order.status is OrderStatus.PENDING_PAYMENT
        assert order.price_cents == 32000
        assert order.contact_name == "张三"
        assert order.wechat_prepay_id is None
        assert order.created_at == created_at.astimezone(UTC)
        assert order.expires_at == expires_at.astimezone(UTC)
        assert vault.decrypt(
            SealedPhone(
                order.contact_phone_ciphertext,
                order.contact_phone_nonce,
                order.contact_phone_key_version,
            ),
            record_type="order",
            record_id=order.id,
            field="contact_phone",
        ) == FULL_PHONE
        assert order.contact_phone_ciphertext != user.phone_ciphertext
        assert user.last_contact_name == "张三"
        assert slot.status is SlotStatus.LOCKED
        assert slot.locked_by_order_id == order.id
        assert slot.locked_until == order.expires_at
        assert slot.checkout_version == seeded.checkout_version + 1
        records = session.scalars(select(IdempotencyRecord)).all()
        assert len(records) == 1
        assert records[0].state is IdempotencyState.COMPLETED
        assert records[0].response_status == 201
        assert records[0].response_body == payload
        canonical_request = json.dumps(
            {
                "checkout_version": seeded.checkout_version,
                "contact_name": "张三",
                "slot_id": str(seeded.slot_id),
            },
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        assert records[0].request_sha256 == hashlib.sha256(
            canonical_request.encode("utf-8")
        ).hexdigest()
        assert len(records[0].request_sha256) == 64
        assert RAW_TOKEN not in records[0].request_sha256
        assert FULL_PHONE not in records[0].request_sha256


def test_same_user_slot_returns_existing_effective_order_without_overwriting_snapshot(
    pg_engine: Engine,
) -> None:
    seeded = _seed_order_case(pg_engine, existing_for_user=True)
    assert seeded.stale_order_id is not None
    with Session(pg_engine) as session:
        before = session.get_one(Order, seeded.stale_order_id)
        before_snapshot = (
            before.contact_name,
            before.price_cents,
            before.created_at,
            before.expires_at,
            before.contact_phone_ciphertext,
            before.contact_phone_nonce,
            before.contact_phone_key_version,
        )

    with _client(pg_engine) as client:
        response = client.post(
            "/api/v1/orders",
            headers=_headers(),
            json=_body(seeded, contact_name="新联系人"),
        )
        replay = client.post(
            "/api/v1/orders",
            headers=_headers(),
            json=_body(seeded, contact_name=" 新联系人 "),
        )

    assert response.status_code == replay.status_code == 200
    assert response.content == replay.content
    assert response.json()["id"] == str(seeded.stale_order_id)
    assert response.json()["contact"]["name"] == "原始联系人"
    assert response.json()["price_cents"] == 31000
    with Session(pg_engine) as session:
        after = session.get_one(Order, seeded.stale_order_id)
        after_snapshot = (
            after.contact_name,
            after.price_cents,
            after.created_at,
            after.expires_at,
            after.contact_phone_ciphertext,
            after.contact_phone_nonce,
            after.contact_phone_key_version,
        )
        assert after_snapshot == before_snapshot
        assert session.scalar(select(func.count()).select_from(Order)) == 1
        record = session.scalar(select(IdempotencyRecord))
        assert record is not None
        assert record.state is IdempotencyState.COMPLETED
        assert record.response_status == 200


def test_same_key_and_normalized_body_replays_exact_first_201(pg_engine: Engine) -> None:
    seeded = _seed_order_case(pg_engine)

    with _client(pg_engine) as client:
        first = client.post(
            "/api/v1/orders",
            headers=_headers(),
            json=_body(seeded, contact_name=" 张三 "),
        )
        with Session(pg_engine) as session:
            user = session.get_one(User, seeded.user_id)
            user.phone_ciphertext = None
            user.phone_nonce = None
            user.phone_key_version = None
            user.phone_verified_at = None
            session.commit()
        replay = client.post(
            "/api/v1/orders",
            headers=_headers(),
            json=_body(seeded, contact_name="张三"),
        )

    assert first.status_code == replay.status_code == 201
    assert first.content == replay.content
    with Session(pg_engine) as session:
        assert session.scalar(select(func.count()).select_from(Order)) == 1
        assert session.scalar(select(func.count()).select_from(IdempotencyRecord)) == 1
        record = session.scalar(select(IdempotencyRecord))
        assert record is not None
        assert record.state is IdempotencyState.COMPLETED


def test_same_key_with_different_normalized_body_is_rejected(pg_engine: Engine) -> None:
    seeded = _seed_order_case(pg_engine)

    with _client(pg_engine) as client:
        first = client.post(
            "/api/v1/orders",
            headers=_headers(),
            json=_body(seeded, contact_name="张三"),
        )
        reused = client.post(
            "/api/v1/orders",
            headers=_headers(),
            json=_body(seeded, contact_name="李四"),
        )

    assert first.status_code == 201
    assert reused.status_code == 409
    assert reused.json()["error"]["code"] == "IDEMPOTENCY_KEY_REUSED"
    with Session(pg_engine) as session:
        assert session.scalar(select(func.count()).select_from(Order)) == 1
        assert session.scalar(select(func.count()).select_from(IdempotencyRecord)) == 1


def test_failure_after_business_flush_rolls_back_claim_order_slot_and_user(
    pg_engine: Engine,
) -> None:
    seeded = _seed_order_case(pg_engine)

    def fail_completion(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        if statement.lstrip().upper().startswith("UPDATE IDEMPOTENCY_RECORDS"):
            raise RuntimeError("injected completion failure")

    event.listen(pg_engine, "before_cursor_execute", fail_completion)
    try:
        with _client(pg_engine) as client:
            response = client.post(
                "/api/v1/orders",
                headers=_headers(),
                json=_body(seeded),
            )
    finally:
        event.remove(pg_engine, "before_cursor_execute", fail_completion)

    assert response.status_code == 500
    assert response.json()["error"]["code"] == "INTERNAL_ERROR"
    with Session(pg_engine) as session:
        user = session.get_one(User, seeded.user_id)
        slot = session.get_one(Slot, seeded.slot_id)
        assert user.last_contact_name == "旧联系人"
        assert slot.status is SlotStatus.AVAILABLE
        assert slot.locked_by_order_id is None
        assert slot.locked_until is None
        assert slot.checkout_version == seeded.checkout_version
        assert session.scalar(select(func.count()).select_from(Order)) == 0
        assert session.scalar(select(func.count()).select_from(IdempotencyRecord)) == 0


def test_create_entry_expires_safe_stale_lock_then_creates_new_order(
    pg_engine: Engine,
) -> None:
    seeded = _seed_order_case(pg_engine, stale_lock="releasable")
    assert seeded.stale_order_id is not None

    with _client(pg_engine) as client:
        response = client.post(
            "/api/v1/orders",
            headers=_headers(),
            json=_body(seeded, checkout_version=seeded.checkout_version + 1),
        )

    assert response.status_code == 201
    with Session(pg_engine) as session:
        stale = session.get_one(Order, seeded.stale_order_id)
        slot = session.get_one(Slot, seeded.slot_id)
        assert stale.status is OrderStatus.EXPIRED
        assert slot.status is SlotStatus.LOCKED
        assert slot.locked_by_order_id == uuid.UUID(response.json()["id"])
        assert slot.checkout_version == seeded.checkout_version + 2
        assert session.scalar(select(func.count()).select_from(Order)) == 2


@pytest.mark.parametrize("stale_lock", ["prepay", "owner-mismatch"])
def test_create_entry_never_releases_unsafe_stale_lock(
    pg_engine: Engine,
    stale_lock: Literal["prepay", "owner-mismatch"],
) -> None:
    seeded = _seed_order_case(pg_engine, stale_lock=stale_lock)
    assert seeded.stale_order_id is not None

    with _client(pg_engine) as client:
        response = client.post(
            "/api/v1/orders",
            headers=_headers(),
            json=_body(seeded, checkout_version=1),
        )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "SLOT_NOT_AVAILABLE"
    with Session(pg_engine) as session:
        stale = session.get_one(Order, seeded.stale_order_id)
        slot = session.get_one(Slot, seeded.slot_id)
        assert stale.status is OrderStatus.PENDING_PAYMENT
        assert slot.status is SlotStatus.LOCKED
        assert slot.locked_by_order_id == stale.id
        assert slot.checkout_version == seeded.checkout_version
        assert session.scalar(select(func.count()).select_from(IdempotencyRecord)) == 0
