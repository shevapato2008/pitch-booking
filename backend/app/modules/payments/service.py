from __future__ import annotations

import hashlib
import json
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal

from sqlalchemy.orm import Session

from backend.app.errors import AppError
from backend.app.models import (
    BookingMode,
    IdempotencyRecord,
    IdempotencyState,
    OrderStatus,
    Payment,
    PaymentState,
)
from backend.app.modules.payments.dto import CreatePaymentResult
from backend.app.modules.payments.provider import (
    Created,
    CreatePrepayRequest,
    PaymentProvider,
    QueryPaymentRequest,
    QueryPaymentResult,
    QueryPaymentStatus,
    Rejected,
    Unknown,
)
from backend.app.modules.payments.repository import PaymentRepository

CREATE_PAYMENT_OPERATION = "create_payment"
_RECONCILE_DELAY = timedelta(minutes=1)


@dataclass(frozen=True, slots=True)
class _PhaseOne:
    order_id: uuid.UUID
    slot_id: uuid.UUID
    payment_id: uuid.UUID
    idempotency_id: uuid.UUID
    merchant_order_no: str
    amount_cents: int
    time_expire: datetime
    payment_status: PaymentState
    new_payment: bool


class PaymentCreationService:
    def __init__(
        self,
        *,
        session_factory: Callable[[], Session],
        provider: PaymentProvider,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self._session_factory = session_factory
        self._provider = provider
        self._now = now or (lambda: datetime.now(UTC))

    def create_payment(
        self,
        *,
        user_id: uuid.UUID,
        order_id: uuid.UUID,
        idempotency_key: str,
        payer_openid: str,
    ) -> CreatePaymentResult:
        phase = self._phase_one(user_id=user_id, order_id=order_id, idempotency_key=idempotency_key)
        if isinstance(phase, CreatePaymentResult):
            return phase

        provider_result: Created | Rejected | Unknown | QueryPaymentResult
        query = self._provider.query_payment(QueryPaymentRequest(phase.merchant_order_no))
        if query.status is QueryPaymentStatus.NOT_FOUND:
            provider_result = self._provider.create_prepay(
                CreatePrepayRequest(
                    merchant_order_no=phase.merchant_order_no,
                    description=f"场地预订 {phase.order_id}",
                    amount_cents=phase.amount_cents,
                    currency="CNY",
                    payer_openid=payer_openid,
                    time_expire=phase.time_expire,
                )
            )
            if isinstance(provider_result, Rejected):
                # A concurrent caller may have been accepted after our first query.
                # Recheck authority without any database row locks before treating
                # rejection as proof that no provider order exists.
                rejection_check = self._provider.query_payment(
                    QueryPaymentRequest(phase.merchant_order_no)
                )
                if rejection_check.status is not QueryPaymentStatus.NOT_FOUND:
                    provider_result = rejection_check
        else:
            provider_result = query
        return self._phase_three(phase, provider_result)

    def _phase_one(
        self, *, user_id: uuid.UUID, order_id: uuid.UUID, idempotency_key: str
    ) -> _PhaseOne | CreatePaymentResult:
        with self._session_factory() as session:
            repository = PaymentRepository(session)
            located = repository.locate_owned_order(order_id=order_id, user_id=user_id)
            if located is None:
                raise _order_not_found()
            if located.slot.pitch.venue.booking_mode is not BookingMode.ONLINE:
                raise _venue_not_found()
            slot_id = located.slot_id
            try:
                order, current = repository.lock_order_graph(order_id=order_id, slot_id=slot_id)
                if order.user_id != user_id:
                    raise _order_not_found()
                digest = _request_digest(order_id)
                record, _claimed = repository.claim_idempotency(
                    user_id=user_id, key=idempotency_key, request_sha256=digest
                )
                if record.request_sha256 != digest:
                    raise AppError(409, "IDEMPOTENCY_KEY_REUSED", "该幂等键已用于其他支付请求。")
                if record.state is IdempotencyState.COMPLETED:
                    result = _replay_completed(record)
                    session.commit()
                    return result
                if order.status is OrderStatus.CONFIRMED:
                    confirmed_body: dict[str, object] = {
                        "order_id": str(order.id),
                        "status": "ALREADY_CONFIRMED",
                    }
                    _complete(record, 200, confirmed_body)
                    session.commit()
                    return CreatePaymentResult(200, confirmed_body)
                now = self._now()
                if order.status is OrderStatus.EXPIRED or (
                    order.status is OrderStatus.PENDING_PAYMENT and order.expires_at <= now
                ):
                    error = AppError(409, "ORDER_EXPIRED", "订单已过期，请重新选择场次。")
                    _complete(record, 409, {"code": error.code, "message": error.message})
                    session.commit()
                    raise error
                if order.status is OrderStatus.PAYMENT_EXCEPTION:
                    error = AppError(409, "PAYMENT_EXCEPTION", "支付状态异常，请联系场馆处理。")
                    _complete(record, 409, {"code": error.code, "message": error.message})
                    session.commit()
                    raise error
                if order.status is not OrderStatus.PENDING_PAYMENT:
                    error = AppError(409, "PAYMENT_EXCEPTION", "订单当前不可支付。")
                    _complete(record, 409, {"code": error.code, "message": error.message})
                    session.commit()
                    raise error

                new_payment = current is None
                if current is None:
                    payment_id = uuid.uuid4()
                    current = Payment(
                        id=payment_id,
                        order_id=order.id,
                        provider=self._provider.name,
                        merchant_order_no=f"PB{payment_id.hex[:30]}",
                        amount_cents=order.price_cents,
                        currency="CNY",
                        status=PaymentState.CREATING,
                        reconcile_attempts=0,
                        next_reconcile_at=now,
                    )
                    session.add(current)
                    session.flush()
                record.state = IdempotencyState.PROCESSING
                record.payment_id = current.id
                record.response_status = None
                record.response_body = None
                session.flush()
                phase = _PhaseOne(
                    order.id,
                    order.slot_id,
                    current.id,
                    record.id,
                    current.merchant_order_no,
                    current.amount_cents,
                    order.expires_at,
                    current.status,
                    new_payment,
                )
                session.commit()
                return phase
            except Exception:
                session.rollback()
                raise

    def _phase_three(
        self,
        phase: _PhaseOne,
        result: Created | Rejected | Unknown | QueryPaymentResult,
    ) -> CreatePaymentResult:
        with self._session_factory() as session:
            repository = PaymentRepository(session)
            try:
                _slot, _order, payment = repository.lock_payment_graph(
                    order_id=phase.order_id, slot_id=phase.slot_id, payment_id=phase.payment_id
                )
                record = repository.get_idempotency_for_update(phase.idempotency_id)
                now = self._now()

                if (
                    record.payment_id != payment.id
                    or payment.merchant_order_no != phase.merchant_order_no
                ):
                    raise RuntimeError("payment phase identity changed")

                if (
                    isinstance(result, QueryPaymentResult)
                    and result.status is QueryPaymentStatus.SUCCESS
                    and payment.status is not PaymentState.SUCCESS
                ):
                    # Task 8 validates the facts and settles payment/order/slot. Until
                    # then, keep this authority visible to the worker and block expiry.
                    other = repository.lock_other_nonterminal_payment(
                        order_id=phase.order_id,
                        payment_id=payment.id,
                    )
                    if other is None:
                        payment.status = PaymentState.CONFIRMING
                        payment.next_reconcile_at = now
                        payment.last_error_code = None
                        payment.last_error_at = None
                    else:
                        # A newer possibly accepted attempt cannot be closed safely.
                        # Preserve both attempts and make the order explicitly unsafe
                        # for expiry until Task 8 resolves the authoritative success.
                        _order.status = OrderStatus.PAYMENT_EXCEPTION
                        payment.last_error_code = "LATE_SUCCESS_ATTEMPT_COLLISION"
                        payment.last_error_at = now

                    for linked_record in repository.lock_payment_idempotencies(payment.id):
                        linked_record.state = IdempotencyState.PROCESSING
                        linked_record.response_status = None
                        linked_record.response_body = None
                    session.commit()
                    return _confirming(phase)

                if record.state is IdempotencyState.COMPLETED:
                    replay = _replay_completed(record)
                    session.commit()
                    return replay

                if _order.status is OrderStatus.CONFIRMED:
                    confirmed_body: dict[str, object] = {
                        "order_id": str(_order.id),
                        "status": "ALREADY_CONFIRMED",
                    }
                    _complete(record, 200, confirmed_body)
                    session.commit()
                    return CreatePaymentResult(200, confirmed_body)
                if _order.status in {OrderStatus.EXPIRED, OrderStatus.PAYMENT_EXCEPTION}:
                    code = (
                        "ORDER_EXPIRED"
                        if _order.status is OrderStatus.EXPIRED
                        else "PAYMENT_EXCEPTION"
                    )
                    message = (
                        "订单已过期，请重新选择场次。"
                        if code == "ORDER_EXPIRED"
                        else "支付状态异常，请联系场馆处理。"
                    )
                    _complete(record, 409, {"code": code, "message": message})
                    session.commit()
                    raise AppError(409, code, message)

                created = result if isinstance(result, Created) else None
                if (
                    isinstance(result, QueryPaymentResult)
                    and result.status is QueryPaymentStatus.NOT_PAID
                ):
                    if result.launch_params is not None and result.provider_prepay_id is not None:
                        created = Created(result.provider_prepay_id, result.launch_params)
                    elif payment.status in {
                        PaymentState.CREATING,
                        PaymentState.UNKNOWN,
                    }:
                        payment.status = PaymentState.PREPAY_CREATED
                        payment.provider_prepay_id = result.provider_prepay_id
                        payment.next_reconcile_at = now + _RECONCILE_DELAY
                        session.commit()
                        return _confirming(phase)

                if payment.status in {PaymentState.SUCCESS, PaymentState.CONFIRMING}:
                    # Task 8 owns authoritative success and settlement convergence.
                    session.commit()
                    return _confirming(phase)

                if payment.status is PaymentState.CLOSED:
                    terminal_error_body: dict[str, object] = {
                        "code": "PAYMENT_CREATE_FAILED",
                        "message": "支付创建失败，请稍后重试。",
                    }
                    _complete(record, 503, terminal_error_body)
                    session.commit()
                    raise AppError(
                        503,
                        "PAYMENT_CREATE_FAILED",
                        "支付创建失败，请稍后重试。",
                    )

                if payment.status is PaymentState.PREPAY_CREATED and created is None:
                    # A slower uncertain or negative result cannot regress a prepay
                    # already converged by another caller. This key has no launch
                    # parameters yet, so it stays PROCESSING and honestly returns 202.
                    session.commit()
                    return _confirming(phase)

                if created is not None:
                    if payment.status in {PaymentState.CREATING, PaymentState.UNKNOWN}:
                        payment.status = PaymentState.PREPAY_CREATED
                        payment.provider_prepay_id = created.provider_prepay_id
                        payment.next_reconcile_at = now + _RECONCILE_DELAY
                        payment.last_error_code = None
                    body: dict[str, object] = {
                        "order_id": str(phase.order_id),
                        "payment_id": str(phase.payment_id),
                        "status": "PREPAY_CREATED",
                        "launch_params": created.launch_params.as_dict(),
                    }
                    status: Literal[200, 201] = 201 if phase.new_payment else 200
                    _complete(record, status, body)
                    session.commit()
                    return CreatePaymentResult(status, body)

                if payment.status not in {PaymentState.CREATING, PaymentState.UNKNOWN}:
                    session.commit()
                    return _confirming(phase)

                if isinstance(result, Rejected) or (
                    isinstance(result, QueryPaymentResult)
                    and result.status is QueryPaymentStatus.CLOSED
                ):
                    safe_code = (
                        result.safe_error_code
                        if isinstance(result, Rejected)
                        else result.safe_error_code or "PROVIDER_ORDER_CLOSED"
                    )
                    payment.status = PaymentState.CLOSED
                    payment.next_reconcile_at = None
                    payment.last_error_code = safe_code
                    payment.last_error_at = now
                    error_body: dict[str, object] = {
                        "code": "PAYMENT_CREATE_FAILED",
                        "message": "支付创建失败，请稍后重试。",
                    }
                    _complete(record, 503, error_body)
                    session.commit()
                    raise AppError(503, "PAYMENT_CREATE_FAILED", "支付创建失败，请稍后重试。")

                if (
                    isinstance(result, QueryPaymentResult)
                    and result.status is QueryPaymentStatus.SUCCESS
                ):
                    # Task 8 validates the authoritative facts and atomically converges
                    # payment, order, and slot. Changing only Payment here would lie.
                    session.commit()
                    return _confirming(phase)

                if isinstance(result, Unknown):
                    safe_error = result.safe_error_code
                elif isinstance(result, QueryPaymentResult):
                    safe_error = result.safe_error_code or "PAYMENT_AUTHORITY_UNRESOLVED"
                else:
                    raise RuntimeError("created prepay result was not converged")
                if payment.authority_unknown_since is None:
                    payment.authority_unknown_since = now
                payment.status = PaymentState.UNKNOWN
                payment.last_error_code = safe_error
                payment.last_error_at = now
                payment.next_reconcile_at = now + _RECONCILE_DELAY
                session.commit()
                return _confirming(phase)
            except AppError:
                raise
            except Exception:
                session.rollback()
                raise


def _request_digest(order_id: uuid.UUID) -> str:
    canonical = json.dumps(
        {"order_id": str(order_id), "version": 1}, sort_keys=True, separators=(",", ":")
    )
    return hashlib.sha256(canonical.encode()).hexdigest()


def _complete(record: IdempotencyRecord, status: int, body: dict[str, object]) -> None:
    record.state = IdempotencyState.COMPLETED
    record.response_status = status
    record.response_body = body


def _replay_completed(record: IdempotencyRecord) -> CreatePaymentResult:
    if record.response_status is None or record.response_body is None:
        raise RuntimeError("completed idempotency record is incomplete")
    if record.response_status == 503:
        raise AppError(503, "PAYMENT_CREATE_FAILED", "支付创建失败，请稍后重试。")
    if record.response_status == 409:
        code = record.response_body.get("code")
        message = record.response_body.get("message")
        if not isinstance(code, str) or not isinstance(message, str):
            raise RuntimeError("invalid frozen payment error")
        raise AppError(409, code, message)
    if record.response_status in {200, 201}:
        status: Literal[200, 202] = 200
    elif record.response_status == 202:
        status = 202
    else:
        raise RuntimeError("unsupported payment replay")
    return CreatePaymentResult(status, record.response_body)


def _confirming(phase: _PhaseOne) -> CreatePaymentResult:
    return CreatePaymentResult(
        202,
        {
            "order_id": str(phase.order_id),
            "payment_id": str(phase.payment_id),
            "status": "PAYMENT_CONFIRMING",
        },
    )


def _order_not_found() -> AppError:
    return AppError(404, "ORDER_NOT_FOUND", "订单不存在或不可访问。")


def _venue_not_found() -> AppError:
    return AppError(404, "VENUE_NOT_FOUND", "场馆不存在")
