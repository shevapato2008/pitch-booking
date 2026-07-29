import base64
import hashlib
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from backend.app.config import Settings
from backend.app.database import get_database
from backend.app.errors import AppError
from backend.app.main import create_app
from backend.app.models import (
    Order,
    OrderStatus,
    Payment,
    PaymentState,
    Slot,
    SlotStatus,
    User,
    UserSession,
)
from backend.app.modules.checkout.repository import CheckoutRepository
from backend.app.modules.checkout.service import CheckoutService
from backend.app.security.phone_vault import PhoneVault
from backend.tests.test_schema_constraints import add_pitch, add_slot, venue

pytestmark = pytest.mark.integration

KEY_BASE64 = base64.b64encode(bytes(range(32))).decode("ascii")
KEY_VERSION = 7
FULL_PHONE = "13812345678"
RAW_TOKEN = "checkout-business-token-with-at-least-256-bits-of-entropy"
SHANGHAI = ZoneInfo("Asia/Shanghai")
CANCELLATION_SUMMARY = "开场前 24 小时可免费取消；不足 24 小时取消将收取订单金额的 50%。"


@dataclass(frozen=True, slots=True)
class SeededCheckout:
    user_id: uuid.UUID
    slot_id: uuid.UUID
    starts_at: datetime
    ends_at: datetime
    order_id: uuid.UUID | None


@dataclass(frozen=True, slots=True)
class CheckoutDatabaseSnapshot:
    pitch_id: uuid.UUID
    starts_at: datetime
    ends_at: datetime
    slot_status: SlotStatus
    price_cents: int
    checkout_version: int
    locked_until: datetime | None
    locked_by_order_id: uuid.UUID | None
    order_count: int
    last_contact_name: str | None
    phone_ciphertext: bytes | None
    phone_nonce: bytes | None
    phone_key_version: int | None
    phone_verified_at: datetime | None


@dataclass(slots=True)
class SessionAudit:
    new_count: int = -1
    dirty_count: int = -1
    deleted_count: int = -1


def _seed_checkout(
    engine: Engine,
    *,
    phone: Literal["verified", "missing", "corrupt"] = "verified",
    slot_status: SlotStatus = SlotStatus.AVAILABLE,
    wechat_prepay_id: str | None = None,
) -> SeededCheckout:
    with Session(engine) as session:
        now = datetime.now(UTC)
        user = User(
            wechat_app_id="wx-test-app",
            wechat_openid=f"checkout-user-{uuid.uuid4()}",
            last_contact_name="张三",
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
                token_hash=hashlib.sha256(RAW_TOKEN.encode()).hexdigest(),
                issued_at=now,
                expires_at=now + timedelta(days=1),
            )
        )

        parent = venue(
            timezone="Asia/Shanghai",
            refund_policy_text=CANCELLATION_SUMMARY,
        )
        pitch = add_pitch(session, parent)
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

        order_id = None
        if slot_status is SlotStatus.LOCKED:
            order = Order(
                order_number=f"PB-{uuid.uuid4().hex}",
                user=User(
                    wechat_app_id="wx-test-app",
                    wechat_openid=f"checkout-lock-owner-{uuid.uuid4()}",
                ),
                slot=slot,
                status=OrderStatus.PENDING_PAYMENT,
                price_cents=slot.price_cents,
                contact_name="锁定用户",
                contact_phone_ciphertext=b"encrypted-snapshot-and-tag",
                contact_phone_nonce=b"abcdefghijkl",
                contact_phone_key_version=1,
                created_at=now - timedelta(minutes=10),
                expires_at=now - timedelta(seconds=1),
                wechat_prepay_id=wechat_prepay_id,
            )
            session.add(order)
            session.flush()
            slot.status = SlotStatus.LOCKED
            slot.locked_until = order.expires_at
            slot.locked_by_order_id = order.id
            if wechat_prepay_id is not None:
                session.add(
                    Payment(
                        order=order,
                        provider="mock",
                        merchant_order_no=f"M-{uuid.uuid4().hex}",
                        provider_prepay_id=wechat_prepay_id,
                        amount_cents=order.price_cents,
                        currency="CNY",
                        status=PaymentState.PREPAY_CREATED,
                    )
                )
            order_id = order.id
        elif slot_status is not SlotStatus.AVAILABLE:
            slot.status = slot_status

        session.flush()
        seeded = SeededCheckout(user.id, slot.id, starts_at, ends_at, order_id)
        session.commit()
        return seeded


def _client(
    engine: Engine,
    *,
    with_vault: bool = True,
    audit: SessionAudit | None = None,
) -> TestClient:
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
            try:
                yield session
            finally:
                if audit is not None:
                    audit.new_count = len(session.new)
                    audit.dirty_count = len(session.dirty)
                    audit.deleted_count = len(session.deleted)

    app.dependency_overrides[get_database] = database_override
    return TestClient(app, raise_server_exceptions=False)


def _snapshot(
    engine: Engine,
    *,
    user_id: uuid.UUID,
    slot_id: uuid.UUID,
) -> CheckoutDatabaseSnapshot:
    with Session(engine) as session:
        slot = session.get_one(Slot, slot_id)
        user = session.get_one(User, user_id)
        order_count = session.scalar(select(func.count()).select_from(Order))
        assert order_count is not None
        return CheckoutDatabaseSnapshot(
            pitch_id=slot.pitch_id,
            starts_at=slot.starts_at,
            ends_at=slot.ends_at,
            slot_status=slot.status,
            price_cents=slot.price_cents,
            checkout_version=slot.checkout_version,
            locked_until=slot.locked_until,
            locked_by_order_id=slot.locked_by_order_id,
            order_count=order_count,
            last_contact_name=user.last_contact_name,
            phone_ciphertext=user.phone_ciphertext,
            phone_nonce=user.phone_nonce,
            phone_key_version=user.phone_key_version,
            phone_verified_at=user.phone_verified_at,
        )


def _authorization() -> dict[str, str]:
    return {"Authorization": f"Bearer {RAW_TOKEN}"}


def test_checkout_operation_declares_only_frozen_public_responses() -> None:
    app = create_app(
        settings=Settings(app_env="test", wechat_provider="development")
    )
    operation = app.openapi()["paths"]["/api/v1/slots/{slot_id}/checkout"]["get"]

    assert set(operation["responses"]) == {"200", "401", "409"}
    assert operation["parameters"] == [
        {
            "name": "slot_id",
            "in": "path",
            "required": True,
            "schema": {"type": "string", "format": "uuid"},
        }
    ]


def test_invalid_slot_uuid_with_valid_bearer_uses_frozen_not_available_response(
    pg_engine: Engine,
) -> None:
    _seed_checkout(pg_engine)

    with _client(pg_engine) as client:
        response = client.get(
            "/api/v1/slots/not-a-uuid/checkout",
            headers=_authorization(),
        )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "SLOT_NOT_AVAILABLE"


def test_checkout_requires_valid_bearer_auth(pg_engine: Engine) -> None:
    seeded = _seed_checkout(pg_engine)

    with _client(pg_engine) as client:
        missing = client.get(f"/api/v1/slots/{seeded.slot_id}/checkout")
        invalid = client.get(
            f"/api/v1/slots/{seeded.slot_id}/checkout",
            headers={"Authorization": "Bearer invalid"},
        )

    assert missing.status_code == invalid.status_code == 401
    assert missing.json()["error"]["code"] == "AUTH_REQUIRED"
    assert invalid.json()["error"]["code"] == "AUTH_REQUIRED"


def test_available_checkout_returns_authoritative_snapshot_without_writes(
    pg_engine: Engine,
) -> None:
    seeded = _seed_checkout(pg_engine)
    before = _snapshot(
        pg_engine,
        user_id=seeded.user_id,
        slot_id=seeded.slot_id,
    )
    audit = SessionAudit()

    with _client(pg_engine, audit=audit) as client:
        response = client.get(
            f"/api/v1/slots/{seeded.slot_id}/checkout",
            params={"price_cents": 1, "checkout_version": 1},
            headers=_authorization(),
        )

    assert response.status_code == 200
    payload = response.json()
    assert set(payload) == {
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
    assert payload["slot_id"] == str(seeded.slot_id)
    assert payload["date"] == str(seeded.starts_at.astimezone(SHANGHAI).date())
    assert payload["starts_at"] == seeded.starts_at.astimezone(SHANGHAI).isoformat()
    assert payload["ends_at"] == seeded.ends_at.astimezone(SHANGHAI).isoformat()
    assert payload["duration_minutes"] == 120
    assert payload["price_cents"] == 32000
    assert payload["currency"] == "CNY"
    assert payload["available"] is True
    assert payload["cancellation_summary"] == CANCELLATION_SUMMARY
    assert payload["lock_duration_seconds"] == 600
    assert payload["contact"] == {
        "masked_phone": "138****5678",
        "last_contact_name": "张三",
    }
    assert payload["checkout_version"] == 12
    assert FULL_PHONE not in response.text

    after = _snapshot(
        pg_engine,
        user_id=seeded.user_id,
        slot_id=seeded.slot_id,
    )
    assert after == before
    assert before.order_count == 0
    assert before.slot_status is SlotStatus.AVAILABLE
    assert audit == SessionAudit(new_count=0, dirty_count=0, deleted_count=0)


def test_checkout_safely_releases_stale_lock_before_final_read(
    pg_engine: Engine,
) -> None:
    seeded = _seed_checkout(
        pg_engine,
        slot_status=SlotStatus.LOCKED,
        wechat_prepay_id=None,
    )
    assert seeded.order_id is not None

    with _client(pg_engine) as client:
        response = client.get(
            f"/api/v1/slots/{seeded.slot_id}/checkout", headers=_authorization()
        )

    assert response.status_code == 200
    assert response.json()["available"] is True
    assert response.json()["checkout_version"] == 13
    with Session(pg_engine) as verification_session:
        slot = verification_session.get_one(Slot, seeded.slot_id)
        order = verification_session.get_one(Order, seeded.order_id)
        assert slot.status is SlotStatus.AVAILABLE
        assert slot.locked_until is None
        assert slot.locked_by_order_id is None
        assert slot.checkout_version == 13
        assert order.status is OrderStatus.EXPIRED


def test_checkout_returns_slot_not_available_when_lock_cannot_be_safely_released(
    pg_engine: Engine,
) -> None:
    seeded = _seed_checkout(
        pg_engine,
        slot_status=SlotStatus.LOCKED,
        wechat_prepay_id="wx-prepay-present",
    )
    before = _snapshot(
        pg_engine,
        user_id=seeded.user_id,
        slot_id=seeded.slot_id,
    )

    with _client(pg_engine) as client:
        response = client.get(
            f"/api/v1/slots/{seeded.slot_id}/checkout", headers=_authorization()
        )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "SLOT_NOT_AVAILABLE"
    after = _snapshot(
        pg_engine,
        user_id=seeded.user_id,
        slot_id=seeded.slot_id,
    )
    assert after == before
    assert after.slot_status is SlotStatus.LOCKED
    assert after.checkout_version == 12


def test_checkout_allows_missing_verified_phone_without_inventing_contact(
    pg_engine: Engine,
) -> None:
    seeded = _seed_checkout(pg_engine, phone="missing")

    with _client(pg_engine) as client:
        response = client.get(
            f"/api/v1/slots/{seeded.slot_id}/checkout", headers=_authorization()
        )

    assert response.status_code == 200
    assert response.json()["contact"] == {
        "masked_phone": None,
        "last_contact_name": "张三",
    }


@pytest.mark.parametrize(
    ("phone", "with_vault"),
    [("verified", False), ("corrupt", True)],
)
def test_checkout_phone_failures_return_safe_internal_error(
    pg_engine: Engine,
    phone: Literal["verified", "corrupt"],
    with_vault: bool,
) -> None:
    seeded = _seed_checkout(pg_engine, phone=phone)

    with _client(pg_engine, with_vault=with_vault) as client:
        response = client.get(
            f"/api/v1/slots/{seeded.slot_id}/checkout", headers=_authorization()
        )

    assert response.status_code == 500
    assert response.json()["error"]["code"] == "INTERNAL_ERROR"
    assert FULL_PHONE not in response.text


def _transient_user_with_verified_phone() -> User:
    user = User(
        id=uuid.uuid4(),
        wechat_app_id="wx-test-app",
        wechat_openid=f"partial-phone-{uuid.uuid4()}",
        last_contact_name="张三",
    )
    sealed = PhoneVault(key_base64=KEY_BASE64, key_version=KEY_VERSION).encrypt(
        FULL_PHONE,
        record_type="user",
        record_id=user.id,
        field="phone",
    )
    user.phone_ciphertext = sealed.ciphertext_with_tag
    user.phone_nonce = sealed.nonce
    user.phone_key_version = sealed.key_version
    user.phone_verified_at = datetime.now(UTC)
    return user


def _contact_service() -> CheckoutService:
    return CheckoutService(
        repository=CheckoutRepository(Session()),
        phone_vault=PhoneVault(key_base64=KEY_BASE64, key_version=KEY_VERSION),
    )


def test_checkout_treats_all_empty_phone_fields_as_missing() -> None:
    user = User(
        id=uuid.uuid4(),
        wechat_app_id="wx-test-app",
        wechat_openid=f"missing-phone-{uuid.uuid4()}",
        last_contact_name="张三",
    )

    contact = _contact_service()._contact(user)

    assert contact.masked_phone is None
    assert contact.last_contact_name == "张三"


@pytest.mark.parametrize(
    "missing_fields",
    [
        frozenset({"phone_ciphertext"}),
        frozenset({"phone_nonce"}),
        frozenset({"phone_key_version"}),
        frozenset({"phone_verified_at"}),
        frozenset({"phone_nonce", "phone_key_version", "phone_verified_at"}),
        frozenset({"phone_ciphertext", "phone_verified_at"}),
    ],
    ids=[
        "ciphertext-only-missing",
        "nonce-only-missing",
        "key-version-only-missing",
        "verified-at-only-missing",
        "ciphertext-only-present",
        "ciphertext-and-verified-at-missing",
    ],
)
def test_checkout_partial_phone_state_fails_closed(
    missing_fields: frozenset[str],
) -> None:
    user = _transient_user_with_verified_phone()
    for field in missing_fields:
        setattr(user, field, None)

    with pytest.raises(AppError) as captured:
        _contact_service()._contact(user)

    assert captured.value.status_code == 500
    assert captured.value.code == "INTERNAL_ERROR"
    assert FULL_PHONE not in str(captured.value)
    assert repr(user.phone_ciphertext) not in str(captured.value)
