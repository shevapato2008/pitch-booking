from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import inspect, select
from sqlalchemy.orm import Session, object_session

from backend.app.models import Order, OrderStatus, Slot, SlotStatus


@dataclass(frozen=True, slots=True)
class ExpiryResult:
    """Reports a staged mutation; commit or rollback remains the caller's responsibility."""

    changed: bool
    order_status: OrderStatus | None
    slot_status: SlotStatus | None


class PendingOrderExpiryService:
    def expire_with_locked_slot(
        self,
        session: Session,
        slot: Slot,
        order_id: UUID,
        now: datetime,
    ) -> ExpiryResult:
        self._validate_now(now)
        if object_session(slot) is not session or not inspect(slot).persistent:
            raise ValueError("slot must belong to the same session and remain persistent")

        with session.no_autoflush:
            locked_slot = session.scalar(
                select(Slot)
                .where(Slot.id == slot.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            if locked_slot is None:
                raise ValueError("slot must exist in the database")
            return self._expire_locked_slot(session, locked_slot, order_id, now)

    def expire_by_order_id(
        self,
        session: Session,
        order_id: UUID,
        now: datetime,
    ) -> ExpiryResult:
        self._validate_now(now)
        with session.no_autoflush:
            slot_id = session.scalar(select(Order.slot_id).where(Order.id == order_id))
            if slot_id is None:
                return ExpiryResult(
                    changed=False,
                    order_status=None,
                    slot_status=None,
                )

            slot = session.scalar(
                select(Slot)
                .where(Slot.id == slot_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            if slot is None:
                return ExpiryResult(
                    changed=False,
                    order_status=None,
                    slot_status=None,
                )
            return self._expire_locked_slot(session, slot, order_id, now)

    @staticmethod
    def _validate_now(now: datetime) -> None:
        if now.tzinfo is None or now.utcoffset() is None:
            raise ValueError("now must be timezone-aware")

    @staticmethod
    def _expire_locked_slot(
        session: Session,
        slot: Slot,
        order_id: UUID,
        now: datetime,
    ) -> ExpiryResult:
        order = session.scalar(
            select(Order)
            .where(Order.id == order_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if order is None:
            return ExpiryResult(
                changed=False,
                order_status=None,
                slot_status=slot.status,
            )

        can_expire = (
            order.status is OrderStatus.PENDING_PAYMENT
            and order.expires_at <= now
            and order.wechat_prepay_id is None
            and slot.status is SlotStatus.LOCKED
            and slot.locked_by_order_id == order.id
            and order.slot_id == slot.id
        )
        if not can_expire:
            return ExpiryResult(
                changed=False,
                order_status=order.status,
                slot_status=slot.status,
            )

        order.status = OrderStatus.EXPIRED
        order.expired_at = now
        slot.status = SlotStatus.AVAILABLE
        slot.locked_until = None
        slot.locked_by_order_id = None
        slot.checkout_version += 1
        return ExpiryResult(
            changed=True,
            order_status=order.status,
            slot_status=slot.status,
        )
