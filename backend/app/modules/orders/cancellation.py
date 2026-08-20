import hashlib
import json
import uuid
from collections.abc import Callable
from contextlib import suppress
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal, cast

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from backend.app.errors import AppError
from backend.app.models import (
    IdempotencyRecord,
    IdempotencyState,
    Order,
    OrderStatus,
    Payment,
    PaymentState,
    Slot,
    SlotStatus,
)
from backend.app.modules.orders.dto import OrderDetailResponse
from backend.app.modules.orders.lifecycle import (
    OrderLifecycleFacts,
    OwnerCancellationDecision,
    decide_owner_cancellation,
)
from backend.app.modules.orders.locking import (
    NONTERMINAL_PAYMENT_STATES,
    lock_order,
    lock_slot,
)
from backend.app.modules.orders.repository import OrderRepository
from backend.app.modules.refunds.repository import RefundRepository

CANCEL_ORDER_OPERATION = "cancel_order"


@dataclass(frozen=True, slots=True)
class CancellationResult:
    status_code: Literal[200, 202]
    response: OrderDetailResponse


class OrderCancellationService:
    def __init__(
        self,
        *,
        order_repository: OrderRepository,
        refund_repository: RefundRepository,
        project_order_detail: Callable[[Order, Slot], OrderDetailResponse],
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self._order_repository = order_repository
        self._refund_repository = refund_repository
        self._project_order_detail = project_order_detail
        self._now = now or (lambda: datetime.now(UTC))

    def cancel_owned_order(
        self,
        *,
        user_id: uuid.UUID,
        order_id: uuid.UUID,
        idempotency_key: str,
    ) -> CancellationResult:
        try:
            slot_id = self._locate_owned_slot_id(
                user_id=user_id,
                order_id=order_id,
            )
            slot = lock_slot(self._order_repository.session, slot_id)
            order = lock_order(self._order_repository.session, order_id)
            payments = tuple(
                self._order_repository.session.scalars(
                    select(Payment)
                    .where(Payment.order_id == order_id)
                    .order_by(Payment.id)
                    .with_for_update()
                    .execution_options(populate_existing=True)
                )
            )
            if (
                slot is None
                or order is None
                or order.user_id != user_id
                or order.slot_id != slot.id
            ):
                raise _order_not_found()

            request_sha256 = _request_sha256(order_id)
            record, claimed = self._order_repository.claim_idempotency(
                user_id=user_id,
                operation=CANCEL_ORDER_OPERATION,
                key=idempotency_key,
                request_sha256=request_sha256,
            )
            if not claimed:
                result = _replay_idempotency(record, request_sha256)
                self._order_repository.commit()
                return result

            now = self._now()
            decision = decide_owner_cancellation(
                _lifecycle_facts(order=order, slot=slot, payments=payments),
                now=now,
            )
            status_code = self._apply_unpaid_decision(
                decision=decision,
                order=order,
                slot=slot,
                now=now,
            )
            self._order_repository.flush()
            projected_order = self._order_repository.get_owned_order(
                order_id=order_id,
                user_id=user_id,
            )
            if projected_order is None:
                raise RuntimeError("cancelled order disappeared before projection")
            response = self._project_order_detail(
                projected_order,
                projected_order.slot,
            )
            body = response.model_dump(mode="json")
            self._order_repository.complete_idempotency(
                record,
                response_status=status_code,
                response_body=body,
            )
            self._order_repository.commit()
            return CancellationResult(status_code=status_code, response=response)
        except AppError as error:
            with suppress(Exception):
                self._order_repository.rollback()
            if error.status_code >= 500:
                raise _service_unavailable() from None
            raise
        except (RuntimeError, SQLAlchemyError):
            with suppress(Exception):
                self._order_repository.rollback()
            raise _service_unavailable() from None

    def _locate_owned_slot_id(
        self,
        *,
        user_id: uuid.UUID,
        order_id: uuid.UUID,
    ) -> uuid.UUID:
        identity = self._order_repository.session.execute(
            select(Order.user_id, Order.slot_id).where(Order.id == order_id)
        ).one_or_none()
        if identity is None or identity.user_id != user_id:
            raise _order_not_found()
        return cast(uuid.UUID, identity.slot_id)

    def _apply_unpaid_decision(
        self,
        *,
        decision: OwnerCancellationDecision,
        order: Order,
        slot: Slot,
        now: datetime,
    ) -> Literal[200, 202]:
        if decision is OwnerCancellationDecision.RETURN_CANCELLED:
            return 200
        if decision is OwnerCancellationDecision.REFUND_IN_PROGRESS:
            raise AppError(409, "REFUND_IN_PROGRESS", "退款正在处理中，请稍后刷新。")
        if decision not in {
            OwnerCancellationDecision.CANCEL_LOCALLY,
            OwnerCancellationDecision.WAIT_FOR_PAYMENT_RESULT,
        }:
            raise _order_state_changed()

        order.cancel_requested_at = order.cancel_requested_at or now
        if decision is OwnerCancellationDecision.WAIT_FOR_PAYMENT_RESULT:
            return 202

        order.status = OrderStatus.CANCELLED
        order.cancelled_at = order.cancelled_at or max(now, order.cancel_requested_at)
        order.expired_at = None
        if (
            slot.status is SlotStatus.LOCKED
            and slot.locked_by_order_id == order.id
        ):
            slot.status = SlotStatus.AVAILABLE
            slot.locked_until = None
            slot.locked_by_order_id = None
            slot.checkout_version += 1
        return 200


def _lifecycle_facts(
    *,
    order: Order,
    slot: Slot,
    payments: tuple[Payment, ...],
) -> OrderLifecycleFacts:
    return OrderLifecycleFacts(
        status=order.status,
        starts_at=slot.starts_at,
        ends_at=slot.ends_at,
        cancel_requested_at=order.cancel_requested_at,
        checked_in_at=order.checked_in_at,
        payment_may_exist=any(
            payment.status in NONTERMINAL_PAYMENT_STATES
            or payment.status is PaymentState.SUCCESS
            for payment in payments
        ),
        controlling_refund_purpose=None,
    )


def _request_sha256(order_id: uuid.UUID) -> str:
    canonical = json.dumps(
        {
            "operation": CANCEL_ORDER_OPERATION,
            "order_id": str(order_id),
            "version": 1,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode()).hexdigest()


def _replay_idempotency(
    record: IdempotencyRecord,
    request_sha256: str,
) -> CancellationResult:
    if record.request_sha256 != request_sha256:
        raise AppError(
            409,
            "IDEMPOTENCY_KEY_REUSED",
            "该幂等键已用于其他请求，请生成新键后重试。",
        )
    if (
        record.state is not IdempotencyState.COMPLETED
        or record.response_status not in {200, 202}
        or record.response_body is None
    ):
        raise _service_unavailable()
    status_code: Literal[200, 202] = (
        200 if record.response_status == 200 else 202
    )
    return CancellationResult(
        status_code=status_code,
        response=OrderDetailResponse.model_validate(record.response_body),
    )


def _order_not_found() -> AppError:
    return AppError(404, "ORDER_NOT_FOUND", "订单不存在。")


def _order_state_changed() -> AppError:
    return AppError(409, "ORDER_STATE_CHANGED", "订单状态已变化，请刷新后重试。")


def _service_unavailable() -> AppError:
    return AppError(503, "SERVICE_UNAVAILABLE", "订单取消服务暂不可用，请稍后重试。")
