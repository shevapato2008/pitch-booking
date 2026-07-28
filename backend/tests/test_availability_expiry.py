import uuid
from datetime import UTC, datetime, timedelta
from typing import NoReturn, cast
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

import backend.app.modules.availability.service as availability_service_module
from backend.app.models import Order, OrderStatus, Slot, SlotStatus, User
from backend.app.modules.availability.repository import AvailabilityRepository
from backend.app.modules.availability.service import AvailabilityService
from backend.tests.test_schema_constraints import add_pitch, add_slot, venue

pytestmark = pytest.mark.integration

NOW = datetime(2030, 8, 1, 9, tzinfo=UTC)
SHANGHAI = ZoneInfo("Asia/Shanghai")


class FailOnFinalReadRepository(AvailabilityRepository):
    def __init__(self, session: Session) -> None:
        super().__init__(session)
        self._list_slots_calls = 0

    def list_slots(
        self,
        pitch_ids: list[uuid.UUID],
        starts_at: datetime,
        ends_at: datetime,
    ) -> list[Slot]:
        self._list_slots_calls += 1
        if self._list_slots_calls == 2:
            raise RuntimeError("injected-final_read-failure")
        return super().list_slots(pitch_ids, starts_at, ends_at)


def _seed_expired_lock(
    engine: Engine, *, wechat_prepay_id: str | None
) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    with Session(engine) as session:
        parent = venue(timezone="Asia/Shanghai")
        pitch = add_pitch(session, parent)
        slot = add_slot(
            session,
            pitch,
            NOW + timedelta(days=1),
            NOW + timedelta(days=1, hours=1),
            checkout_version=4,
        )
        user = User(wechat_openid=f"availability-expiry-{uuid.uuid4()}")
        order = Order(
            order_number=f"PB-{uuid.uuid4().hex}",
            user=user,
            slot=slot,
            status=OrderStatus.PENDING_PAYMENT,
            price_cents=slot.price_cents,
            contact_name="张三",
            contact_phone_ciphertext=b"encrypted-snapshot-and-tag",
            contact_phone_nonce=b"abcdefghijkl",
            contact_phone_key_version=1,
            expires_at=NOW - timedelta(seconds=1),
            wechat_prepay_id=wechat_prepay_id,
        )
        session.add(order)
        session.flush()
        slot.status = SlotStatus.LOCKED
        slot.locked_until = order.expires_at
        slot.locked_by_order_id = order.id
        session.flush()
        identifiers = (parent.id, slot.id, order.id)
        session.commit()
        return identifiers


def _get_slot_projection(engine: Engine, venue_id: uuid.UUID) -> dict[str, object]:
    with Session(engine) as request_session:
        response = AvailabilityService(
            AvailabilityRepository(request_session),
            now=lambda _timezone: NOW.astimezone(SHANGHAI),
        ).get_availability(
            venue_id,
            str(NOW.astimezone(SHANGHAI).date() + timedelta(days=1)),
            "FIVE_A_SIDE",
        )
        return cast(
            dict[str, object],
            response.model_dump(mode="json")["pitches"][0]["slots"][0],
        )


def test_expired_lock_without_prepay_is_safely_released_before_projection(
    pg_engine: Engine,
) -> None:
    venue_id, slot_id, order_id = _seed_expired_lock(
        pg_engine, wechat_prepay_id=None
    )

    projected = _get_slot_projection(pg_engine, venue_id)

    with Session(pg_engine) as verification_session:
        slot = verification_session.get_one(Slot, slot_id)
        order = verification_session.get_one(Order, order_id)
        assert projected["status"] == "AVAILABLE"
        assert projected["unavailable_reason"] is None
        assert order.status is OrderStatus.EXPIRED
        assert slot.status is SlotStatus.AVAILABLE
        assert slot.locked_until is None
        assert slot.locked_by_order_id is None
        assert slot.checkout_version == 5


def test_expired_lock_with_prepay_remains_temporarily_locked(
    pg_engine: Engine,
) -> None:
    venue_id, slot_id, order_id = _seed_expired_lock(
        pg_engine, wechat_prepay_id="wx-prepay-present"
    )

    projected = _get_slot_projection(pg_engine, venue_id)

    with Session(pg_engine) as verification_session:
        slot = verification_session.get_one(Slot, slot_id)
        order = verification_session.get_one(Order, order_id)
        assert projected["status"] == "TEMPORARILY_LOCKED"
        assert projected["unavailable_reason"] == "HELD_FOR_PAYMENT"
        assert order.status is OrderStatus.PENDING_PAYMENT
        assert slot.status is SlotStatus.LOCKED
        assert slot.locked_by_order_id == order.id
        assert slot.checkout_version == 4


@pytest.mark.parametrize("failure_phase", ["final_read", "projection", "dto"])
def test_availability_rolls_back_staged_expiry_on_response_path_failure(
    pg_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
    failure_phase: str,
) -> None:
    venue_id, slot_id, order_id = _seed_expired_lock(
        pg_engine,
        wechat_prepay_id=None,
    )

    def fail(*_args: object, **_kwargs: object) -> NoReturn:
        raise RuntimeError(f"injected-{failure_phase}-failure")

    with Session(pg_engine) as request_session:
        repository: AvailabilityRepository
        if failure_phase == "final_read":
            repository = FailOnFinalReadRepository(request_session)
        else:
            repository = AvailabilityRepository(request_session)
        if failure_phase == "projection":
            monkeypatch.setattr(
                AvailabilityService,
                "_slot_response",
                staticmethod(fail),
            )
        elif failure_phase == "dto":
            monkeypatch.setattr(
                availability_service_module,
                "AvailabilityResponse",
                fail,
            )

        with pytest.raises(RuntimeError, match=f"injected-{failure_phase}-failure"):
            AvailabilityService(
                repository,
                now=lambda _timezone: NOW.astimezone(SHANGHAI),
            ).get_availability(
                venue_id,
                str(NOW.astimezone(SHANGHAI).date() + timedelta(days=1)),
                "FIVE_A_SIDE",
            )

        assert request_session.in_transaction() is False
        assert not request_session.new
        assert not request_session.dirty
        assert not request_session.deleted

        with Session(pg_engine) as verification_session:
            slot = verification_session.scalar(
                select(Slot)
                .where(Slot.id == slot_id)
                .with_for_update(nowait=True)
            )
            assert slot is not None
            order = verification_session.get_one(Order, order_id)
            assert order.status is OrderStatus.PENDING_PAYMENT
            assert slot.status is SlotStatus.LOCKED
            assert slot.locked_by_order_id == order.id
            assert slot.checkout_version == 4
