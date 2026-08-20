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
    RefundAttemptStatus,
    RefundCasePurpose,
    RefundReason,
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
from backend.app.modules.refunds.repository import (
    LockedRefundGraph,
    RefundPurposeMismatchError,
    RefundRepository,
)

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
            applied_payment_id = self._locate_applied_payment_id(order_id=order_id)
            if applied_payment_id is not None:
                return self._cancel_with_refund_graph(
                    user_id=user_id,
                    order_id=order_id,
                    slot_id=slot_id,
                    payment_id=applied_payment_id,
                    idempotency_key=idempotency_key,
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

            applied_payments = tuple(
                payment
                for payment in payments
                if payment.status is PaymentState.SUCCESS
                and payment.applied_to_order_at is not None
            )
            if applied_payments:
                self._order_repository.rollback()
                return self._cancel_with_refund_graph(
                    user_id=user_id,
                    order_id=order_id,
                    slot_id=slot_id,
                    payment_id=applied_payments[0].id,
                    idempotency_key=idempotency_key,
                )

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
            return self._complete_claimed_cancellation(
                record=record,
                status_code=status_code,
                user_id=user_id,
                order_id=order_id,
            )
        except AppError as error:
            with suppress(Exception):
                self._order_repository.rollback()
            if error.status_code >= 500:
                raise _service_unavailable() from None
            raise
        except (LookupError, RefundPurposeMismatchError):
            with suppress(Exception):
                self._order_repository.rollback()
            raise _order_state_changed() from None
        except (RuntimeError, SQLAlchemyError):
            with suppress(Exception):
                self._order_repository.rollback()
            raise _service_unavailable() from None

    def _locate_applied_payment_id(
        self,
        *,
        order_id: uuid.UUID,
    ) -> uuid.UUID | None:
        return self._order_repository.session.scalar(
            select(Payment.id)
            .where(
                Payment.order_id == order_id,
                Payment.status == PaymentState.SUCCESS,
                Payment.applied_to_order_at.is_not(None),
            )
            .order_by(Payment.id)
            .limit(1)
        )

    def _cancel_with_refund_graph(
        self,
        *,
        user_id: uuid.UUID,
        order_id: uuid.UUID,
        slot_id: uuid.UUID,
        payment_id: uuid.UUID,
        idempotency_key: str,
    ) -> CancellationResult:
        graph = self._refund_repository.lock_refund_graph(payment_id)
        if (
            graph.order.id != order_id
            or graph.order.user_id != user_id
            or graph.order.slot_id != slot_id
            or graph.slot.id != slot_id
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

        applied_payments = tuple(
            payment
            for payment in graph.payments
            if payment.status is PaymentState.SUCCESS
            and payment.applied_to_order_at is not None
        )
        if (
            len(applied_payments) != 1
            or applied_payments[0].id != graph.payment.id
            or graph.payment.currency != "CNY"
            or graph.slot.status is not SlotStatus.BOOKED
            or not self._refund_repository.purpose_is_valid(
                graph=graph,
                purpose=RefundCasePurpose.ORDER_CANCELLATION,
            )
        ):
            raise _order_state_changed()
        if graph.refund_case is not None and not _is_owner_cancellation_case(
            graph=graph,
            user_id=user_id,
        ):
            raise _order_state_changed()

        now = self._now()
        decision = decide_owner_cancellation(
            _lifecycle_facts(
                order=graph.order,
                slot=graph.slot,
                payments=graph.payments,
                controlling_refund_purpose=(
                    graph.refund_case.purpose
                    if graph.refund_case is not None
                    else None
                ),
            ),
            now=now,
        )
        latest_attempt = graph.latest_attempt
        if decision is OwnerCancellationDecision.REFUND_IN_PROGRESS:
            raise AppError(409, "REFUND_IN_PROGRESS", "退款正在处理中，请稍后刷新。")
        if decision is OwnerCancellationDecision.ENQUEUE_REFUND:
            if graph.refund_case is not None or latest_attempt is not None:
                raise _order_state_changed()
        elif decision is OwnerCancellationDecision.RETRY_REFUND:
            if (
                graph.refund_case is None
                or latest_attempt is None
                or latest_attempt.status is not RefundAttemptStatus.FAILED
            ):
                raise _order_state_changed()
        else:
            raise _order_state_changed()

        refund_case, _ = self._refund_repository.get_or_create_case(
            graph=graph,
            purpose=RefundCasePurpose.ORDER_CANCELLATION,
            reason=RefundReason.USER_CANCELLED,
            reason_note=None,
            requested_by_user_id=user_id,
        )
        if not _is_owner_cancellation_case(graph=graph, user_id=user_id):
            raise _order_state_changed()
        next_attempt_no = (
            1 if graph.latest_attempt is None else graph.latest_attempt.attempt_no + 1
        )
        _attempt, created = self._refund_repository.get_or_create_attempt(
            graph=graph,
            provider=graph.payment.provider,
            merchant_refund_no=_merchant_refund_no(
                refund_case_id=refund_case.id,
                attempt_no=next_attempt_no,
            ),
            next_reconcile_at=now,
        )
        if not created:
            raise _order_state_changed()

        graph.order.status = OrderStatus.REFUND_PENDING
        graph.order.cancel_requested_at = graph.order.cancel_requested_at or now
        graph.order.cancelled_at = graph.order.cancelled_at or max(
            now,
            graph.order.cancel_requested_at,
        )
        graph.order.expired_at = None
        return self._complete_claimed_cancellation(
            record=record,
            status_code=202,
            user_id=user_id,
            order_id=order_id,
        )

    def _complete_claimed_cancellation(
        self,
        *,
        record: IdempotencyRecord,
        status_code: Literal[200, 202],
        user_id: uuid.UUID,
        order_id: uuid.UUID,
    ) -> CancellationResult:
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
        self._order_repository.complete_idempotency(
            record,
            response_status=status_code,
            response_body=response.model_dump(mode="json"),
        )
        self._order_repository.commit()
        return CancellationResult(status_code=status_code, response=response)

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
    controlling_refund_purpose: RefundCasePurpose | None = None,
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
        controlling_refund_purpose=controlling_refund_purpose,
    )


def _is_owner_cancellation_case(
    *,
    graph: LockedRefundGraph,
    user_id: uuid.UUID,
) -> bool:
    refund_case = graph.refund_case
    return (
        refund_case is not None
        and refund_case.order_id == graph.order.id
        and refund_case.payment_id == graph.payment.id
        and refund_case.purpose is RefundCasePurpose.ORDER_CANCELLATION
        and refund_case.reason is RefundReason.USER_CANCELLED
        and refund_case.reason_note is None
        and refund_case.requested_by_user_id == user_id
        and refund_case.amount_cents == graph.payment.amount_cents
        and refund_case.currency == graph.payment.currency
    )


def _merchant_refund_no(*, refund_case_id: uuid.UUID, attempt_no: int) -> str:
    digest = hashlib.sha256(f"{refund_case_id}:{attempt_no}".encode()).hexdigest()
    return f"OR{digest[:30]}"


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
