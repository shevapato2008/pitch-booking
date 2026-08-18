from __future__ import annotations

import hashlib
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.app.models import (
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
from backend.app.modules.payments.provider import (
    AuthoritativePaymentFacts,
    QueryPaymentResult,
    QueryPaymentStatus,
)
from backend.app.modules.payments.repository import PaymentRepository
from backend.app.modules.refunds.repository import (
    RefundPurposeMismatchError,
    RefundRepository,
)

_RETRY_DELAY = timedelta(minutes=1)


@dataclass(frozen=True, slots=True)
class ConvergenceResult:
    order_id: uuid.UUID
    payment_id: uuid.UUID
    terminal: bool


class PaymentConvergenceService:
    """Converge sanitized Provider authority under the one slot/order/payment lock order."""

    def __init__(
        self,
        *,
        session_factory: Callable[[], Session],
        expected_app_id: str,
        expected_merchant_id: str,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self._session_factory = session_factory
        self._expected_app_id = expected_app_id
        self._expected_merchant_id = expected_merchant_id
        self._now = now or (lambda: datetime.now(UTC))

    def converge(
        self,
        *,
        payment_id: uuid.UUID,
        provider: str,
        result: QueryPaymentResult,
    ) -> ConvergenceResult:
        with self._session_factory() as locating:
            located = PaymentRepository(locating).locate_payment(payment_id)
            if located is None:
                raise LookupError("payment not found")
            order_id = located.order_id
            slot_id = located.order.slot_id

        try:
            return self._converge_locked(
                order_id=order_id,
                slot_id=slot_id,
                payment_id=payment_id,
                provider=provider,
                result=result,
            )
        except IntegrityError as error:
            if not _is_transaction_conflict(error):
                raise
            return self._record_transaction_conflict(
                order_id=order_id,
                slot_id=slot_id,
                payment_id=payment_id,
            )

    def _converge_locked(
        self,
        *,
        order_id: uuid.UUID,
        slot_id: uuid.UUID,
        payment_id: uuid.UUID,
        provider: str,
        result: QueryPaymentResult,
    ) -> ConvergenceResult:
        with self._session_factory() as session:
            repository = PaymentRepository(session)
            slot, order, payment = repository.lock_payment_graph(
                order_id=order_id,
                slot_id=slot_id,
                payment_id=payment_id,
            )
            now = self._now()
            payment_was_closed = payment.status is PaymentState.CLOSED

            if payment.status is PaymentState.SUCCESS:
                self._audit_conflicting_success(payment, provider, result, now)
                self._ensure_extra_success_refunds(
                    session=session,
                    repository=repository,
                    order=order,
                    now=now,
                )
                self._ensure_cancel_requested_refund(
                    session=session,
                    repository=repository,
                    order=order,
                    slot_starts_at=slot.starts_at,
                    now=now,
                )
                session.commit()
                return ConvergenceResult(order.id, payment.id, True)

            if (
                payment.status is PaymentState.CLOSED
                and provider == payment.provider
                and result.status is not QueryPaymentStatus.SUCCESS
            ):
                self._cancel_after_all_payments_close(
                    repository=repository,
                    slot=slot,
                    order=order,
                    now=now,
                )
                session.commit()
                return ConvergenceResult(order.id, payment.id, True)

            if provider != payment.provider:
                self._mismatch(payment, order, "PAYMENT_PROVIDER_MISMATCH", now)
            elif result.status is QueryPaymentStatus.SUCCESS:
                facts = result.facts
                if facts is None:
                    raise RuntimeError("Provider SUCCESS omitted facts")
                mismatch = self._validate_facts(payment, facts)
                if mismatch is not None:
                    self._mismatch(payment, order, mismatch, now)
                elif (
                    repository.find_transaction_owner(
                        provider=provider,
                        provider_transaction_no=facts.provider_transaction_no,
                        payment_id=payment.id,
                    )
                    is not None
                ):
                    self._mismatch(payment, order, "PAYMENT_TRANSACTION_CONFLICT", now)
                else:
                    payment.status = PaymentState.SUCCESS
                    payment.provider_transaction_no = facts.provider_transaction_no
                    payment.paid_at = facts.paid_at
                    payment.next_reconcile_at = None
                    payment.last_error_code = None
                    payment.last_error_at = None
                    payment.notification_result = "SUCCESS"
                    payment.notification_code = None
                    slot_can_fulfil = (
                        slot.status is SlotStatus.LOCKED and slot.locked_by_order_id == order.id
                    ) or (
                        slot.status is SlotStatus.AVAILABLE
                        and not repository.has_other_valid_order(
                            slot_id=slot.id,
                            order_id=order.id,
                        )
                    )
                    can_fulfil = not payment_was_closed and slot_can_fulfil
                    if can_fulfil:
                        order.status = OrderStatus.CONFIRMED
                        order.expired_at = None
                        slot.status = SlotStatus.BOOKED
                        slot.locked_by_order_id = None
                        slot.locked_until = None
                        payment.applied_to_order_at = now
                    else:
                        has_applied_owner = any(
                            candidate.id != payment.id and candidate.applied_to_order_at is not None
                            for candidate in repository.locked_order_payments(order_id=order.id)
                        )
                        if not has_applied_owner:
                            order.status = OrderStatus.PAYMENT_EXCEPTION
                        payment.last_error_code = (
                            "DUPLICATE_CHARGE"
                            if has_applied_owner
                            else "PAYMENT_INVENTORY_CONFLICT"
                        )
                        payment.last_error_at = now
                    self._ensure_extra_success_refunds(
                        session=session,
                        repository=repository,
                        order=order,
                        now=now,
                    )
            elif result.status is QueryPaymentStatus.CLOSED:
                payment.status = PaymentState.CLOSED
                payment.paid_at = None
                payment.next_reconcile_at = None
                payment.last_error_code = result.safe_error_code
                payment.last_error_at = now if result.safe_error_code else None
                self._ensure_extra_success_refunds(
                    session=session,
                    repository=repository,
                    order=order,
                    now=now,
                )
            elif result.status in {QueryPaymentStatus.UNKNOWN, QueryPaymentStatus.NOT_FOUND}:
                payment.status = PaymentState.UNKNOWN
                if payment.authority_unknown_since is None:
                    payment.authority_unknown_since = now
                if payment.last_error_code is None:
                    payment.last_error_code = (
                        result.safe_error_code
                        if result.status is QueryPaymentStatus.UNKNOWN
                        else "PAYMENT_AUTHORITY_NOT_FOUND"
                    )
                payment.last_error_at = now
                payment.next_reconcile_at = now + _RETRY_DELAY
            else:
                # NOT_PAID is not authority to release inventory or expire an order.
                payment.status = PaymentState.CONFIRMING
                payment.next_reconcile_at = now + _RETRY_DELAY
                payment.last_error_code = None
                payment.last_error_at = None

            if payment.status is PaymentState.SUCCESS:
                self._ensure_cancel_requested_refund(
                    session=session,
                    repository=repository,
                    order=order,
                    slot_starts_at=slot.starts_at,
                    now=now,
                )
            elif payment.status is PaymentState.CLOSED:
                self._cancel_after_all_payments_close(
                    repository=repository,
                    slot=slot,
                    order=order,
                    now=now,
                )

            session.flush()
            terminal = payment.status in {PaymentState.SUCCESS, PaymentState.CLOSED}
            session.commit()
            return ConvergenceResult(order.id, payment.id, terminal)

    def _ensure_extra_success_refunds(
        self,
        *,
        session: Session,
        repository: PaymentRepository,
        order: Order,
        now: datetime,
    ) -> None:
        payments = repository.locked_order_payments(order_id=order.id)
        applied = next(
            (candidate for candidate in payments if candidate.applied_to_order_at is not None),
            None,
        )
        for candidate in payments:
            if (
                candidate.status is not PaymentState.SUCCESS
                or candidate.applied_to_order_at is not None
            ):
                continue
            purpose = (
                RefundCasePurpose.DUPLICATE_CHARGE
                if applied is not None
                else RefundCasePurpose.PAYMENT_INVENTORY_CONFLICT
            )
            try:
                graph = RefundRepository(session).lock_refund_graph(candidate.id)
                refund_case, _ = RefundRepository(session).get_or_create_case(
                    graph=graph,
                    purpose=purpose,
                    reason=RefundReason.AUTOMATIC_RECOVERY,
                    reason_note=None,
                    requested_by_user_id=None,
                )
                latest_attempt = graph.latest_attempt
                if (
                    latest_attempt is not None
                    and latest_attempt.status is not RefundAttemptStatus.FAILED
                ):
                    merchant_refund_no = latest_attempt.merchant_refund_no
                else:
                    attempt_no = 1 if latest_attempt is None else latest_attempt.attempt_no + 1
                    merchant_refund_no = _automatic_refund_number(candidate.id, attempt_no)
                RefundRepository(session).get_or_create_attempt(
                    graph=graph,
                    provider=candidate.provider,
                    merchant_refund_no=merchant_refund_no,
                    next_reconcile_at=now,
                )
            except RefundPurposeMismatchError:
                # Another unresolved payment can still become the booking owner.
                # Leave this success durable and retry classification when that
                # payment converges rather than selecting unsafe inventory authority.
                continue
            candidate.last_error_code = purpose.value
            candidate.last_error_at = now
            if purpose is RefundCasePurpose.PAYMENT_INVENTORY_CONFLICT:
                order.cancel_requested_at = order.cancel_requested_at or now
                order.cancelled_at = order.cancelled_at or now
                order.expired_at = None
                order.status = OrderStatus.REFUND_PENDING
            assert refund_case.payment_id == candidate.id

    def _cancel_after_all_payments_close(
        self,
        *,
        repository: PaymentRepository,
        slot: Slot,
        order: Order,
        now: datetime,
    ) -> None:
        if (
            order.cancel_requested_at is None
            or order.status not in {OrderStatus.PENDING_PAYMENT, OrderStatus.PAYMENT_EXCEPTION}
        ):
            return
        payments = repository.locked_order_payments(order_id=order.id)
        if any(payment.applied_to_order_at is not None for payment in payments):
            return
        if any(payment.status is not PaymentState.CLOSED for payment in payments):
            return
        order.status = OrderStatus.CANCELLED
        order.expired_at = None
        order.cancelled_at = order.cancelled_at or now
        if (
            slot.status is SlotStatus.LOCKED
            and slot.locked_by_order_id == order.id
        ):
            slot.status = SlotStatus.AVAILABLE
            slot.locked_by_order_id = None
            slot.locked_until = None

    def _ensure_cancel_requested_refund(
        self,
        *,
        session: Session,
        repository: PaymentRepository,
        order: Order,
        slot_starts_at: datetime,
        now: datetime,
    ) -> None:
        if (
            order.cancel_requested_at is None
            or order.status
            not in {OrderStatus.CONFIRMED, OrderStatus.REFUND_PENDING, OrderStatus.REFUND_FAILED}
            or slot_starts_at - now < timedelta(hours=24)
        ):
            return
        applied = next(
            (
                payment
                for payment in repository.locked_order_payments(order_id=order.id)
                if payment.status is PaymentState.SUCCESS
                and payment.applied_to_order_at is not None
            ),
            None,
        )
        if applied is None:
            return
        refund_repository = RefundRepository(session)
        graph = refund_repository.lock_refund_graph(applied.id)
        latest_attempt = graph.latest_attempt
        if (
            latest_attempt is not None
            and latest_attempt.status is RefundAttemptStatus.FAILED
        ):
            return
        refund_repository.get_or_create_case(
            graph=graph,
            purpose=RefundCasePurpose.ORDER_CANCELLATION,
            reason=RefundReason.USER_CANCELLED,
            reason_note=None,
            requested_by_user_id=order.user_id,
        )
        merchant_refund_no = (
            latest_attempt.merchant_refund_no
            if latest_attempt is not None
            else _automatic_refund_number(applied.id, 1)
        )
        attempt, _ = refund_repository.get_or_create_attempt(
            graph=graph,
            provider=applied.provider,
            merchant_refund_no=merchant_refund_no,
            next_reconcile_at=now,
        )
        if attempt.status is RefundAttemptStatus.SUCCESS:
            return
        order.status = OrderStatus.REFUND_PENDING
        order.expired_at = None
        order.cancelled_at = order.cancelled_at or now

    def _record_transaction_conflict(
        self, *, order_id: uuid.UUID, slot_id: uuid.UUID, payment_id: uuid.UUID
    ) -> ConvergenceResult:
        with self._session_factory() as session:
            _slot, order, payment = PaymentRepository(session).lock_payment_graph(
                order_id=order_id,
                slot_id=slot_id,
                payment_id=payment_id,
            )
            self._mismatch(payment, order, "PAYMENT_TRANSACTION_CONFLICT", self._now())
            session.commit()
            return ConvergenceResult(order.id, payment.id, False)

    def _validate_facts(self, payment: Payment, facts: AuthoritativePaymentFacts) -> str | None:
        checks = (
            (facts.merchant_order_no != payment.merchant_order_no, "PAYMENT_ORDER_NO_MISMATCH"),
            (facts.amount_cents != payment.amount_cents, "PAYMENT_AMOUNT_MISMATCH"),
            (facts.currency != payment.currency, "PAYMENT_CURRENCY_MISMATCH"),
            (facts.app_id != self._expected_app_id, "PAYMENT_APP_ID_MISMATCH"),
            (facts.merchant_id != self._expected_merchant_id, "PAYMENT_MERCHANT_ID_MISMATCH"),
        )
        return next((code for differs, code in checks if differs), None)

    def _audit_conflicting_success(
        self,
        payment: Payment,
        provider: str,
        result: QueryPaymentResult,
        now: datetime,
    ) -> None:
        if result.status is not QueryPaymentStatus.SUCCESS or result.facts is None:
            return
        facts = result.facts
        code: str | None
        if provider != payment.provider:
            code = "PAYMENT_PROVIDER_MISMATCH"
        else:
            code = self._validate_facts(payment, facts)
            if code is None and facts.provider_transaction_no != payment.provider_transaction_no:
                code = "PAYMENT_TRANSACTION_MISMATCH"
        if code is not None:
            if payment.last_error_code is None:
                payment.last_error_code = code
                payment.last_error_at = now
            payment.notification_code = code

    @staticmethod
    def _mismatch(payment: Payment, order: Order, code: str, now: datetime) -> None:
        payment.status = PaymentState.UNKNOWN
        payment.paid_at = None
        payment.provider_transaction_no = None
        payment.next_reconcile_at = now + _RETRY_DELAY
        payment.authority_unknown_since = payment.authority_unknown_since or now
        if payment.notification_result != "MISMATCH":
            payment.last_error_code = code
        payment.last_error_at = now
        payment.notification_result = "MISMATCH"
        payment.notification_code = code
        order.status = OrderStatus.PAYMENT_EXCEPTION


def _is_transaction_conflict(error: IntegrityError) -> bool:
    diagnostic = getattr(error.orig, "diag", None)
    return getattr(diagnostic, "constraint_name", None) == "uq_payments_provider_transaction_no"


def _automatic_refund_number(payment_id: uuid.UUID, attempt_no: int) -> str:
    digest = hashlib.sha256(f"{payment_id.hex}:{attempt_no}".encode()).hexdigest()
    return f"PBR{digest[:29]}"
