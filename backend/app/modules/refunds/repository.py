from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from backend.app.models import (
    Order,
    OrderStatus,
    Payment,
    PaymentState,
    RefundAttempt,
    RefundAttemptStatus,
    RefundCase,
    RefundCasePurpose,
    RefundReason,
    Slot,
)

_ACTIVE_ATTEMPT_STATUSES = (
    RefundAttemptStatus.CREATING,
    RefundAttemptStatus.PROCESSING,
    RefundAttemptStatus.UNKNOWN,
)
_BOOKING_OWNER_STATUSES = (
    OrderStatus.CONFIRMED,
    OrderStatus.REFUND_PENDING,
    OrderStatus.REFUND_FAILED,
    OrderStatus.COMPLETED,
)


class RefundPurposeMismatchError(ValueError):
    pass


@dataclass(slots=True)
class LockedRefundGraph:
    slot: Slot
    order: Order
    slot_orders: tuple[Order, ...]
    payments: tuple[Payment, ...]
    payment: Payment
    refund_case: RefundCase | None
    attempts: tuple[RefundAttempt, ...]

    @property
    def latest_attempt(self) -> RefundAttempt | None:
        return self.attempts[-1] if self.attempts else None


@dataclass(frozen=True, slots=True)
class InventoryMutationAuthority:
    slot_id: uuid.UUID
    order_id: uuid.UUID


@dataclass(frozen=True, slots=True)
class RefundRecoveryClaim:
    attempt_id: uuid.UUID
    claim_token: uuid.UUID


class RefundRepository:
    """Refund storage and proofs under Slot -> Order -> Payment -> Case -> Attempt locks."""

    def __init__(self, session: Session) -> None:
        self.session = session

    def locate_successful_payment(self, payment_id: uuid.UUID) -> Payment | None:
        return self.session.scalar(
            select(Payment).where(
                Payment.id == payment_id,
                Payment.status == PaymentState.SUCCESS,
            )
        )

    def lock_refund_graph(self, payment_id: uuid.UUID) -> LockedRefundGraph:
        identity = self.session.execute(
            select(Payment.order_id, Order.slot_id)
            .join(Order, Order.id == Payment.order_id)
            .where(
                Payment.id == payment_id,
                Payment.status == PaymentState.SUCCESS,
            )
        ).one_or_none()
        if identity is None:
            raise LookupError("successful payment not found")
        order_id, slot_id = identity

        slot = self.session.scalar(
            select(Slot)
            .where(Slot.id == slot_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        slot_orders = tuple(
            self.session.scalars(
                select(Order)
                .where(Order.slot_id == slot_id)
                .order_by(Order.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        )
        order = next((candidate for candidate in slot_orders if candidate.id == order_id), None)
        payments = tuple(
            self.session.scalars(
                select(Payment)
                .where(Payment.order_id == order_id)
                .order_by(Payment.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        )
        payment = next((candidate for candidate in payments if candidate.id == payment_id), None)
        if (
            slot is None
            or order is None
            or payment is None
            or order.slot_id != slot.id
            or payment.status is not PaymentState.SUCCESS
        ):
            raise RuntimeError("refund lock graph changed")

        refund_case = self.session.scalar(
            select(RefundCase)
            .where(RefundCase.payment_id == payment.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        attempts: tuple[RefundAttempt, ...] = ()
        if refund_case is not None:
            attempts = tuple(
                self.session.scalars(
                    select(RefundAttempt)
                    .where(RefundAttempt.refund_case_id == refund_case.id)
                    .order_by(RefundAttempt.attempt_no, RefundAttempt.id)
                    .with_for_update()
                    .execution_options(populate_existing=True)
                )
            )
        return LockedRefundGraph(
            slot=slot,
            order=order,
            slot_orders=slot_orders,
            payments=payments,
            payment=payment,
            refund_case=refund_case,
            attempts=attempts,
        )

    @staticmethod
    def purpose_is_valid(
        *, graph: LockedRefundGraph, purpose: RefundCasePurpose
    ) -> bool:
        target_is_applied = graph.payment.applied_to_order_at is not None
        has_other_applied = any(
            payment.id != graph.payment.id and payment.applied_to_order_at is not None
            for payment in graph.payments
        )
        if purpose is RefundCasePurpose.ORDER_CANCELLATION:
            return target_is_applied
        if purpose is RefundCasePurpose.DUPLICATE_CHARGE:
            return not target_is_applied and has_other_applied
        if purpose is RefundCasePurpose.PAYMENT_INVENTORY_CONFLICT:
            return not target_is_applied and not has_other_applied
        return False

    def get_or_create_case(
        self,
        *,
        graph: LockedRefundGraph,
        purpose: RefundCasePurpose,
        reason: RefundReason,
        reason_note: str | None,
        requested_by_user_id: uuid.UUID | None,
    ) -> tuple[RefundCase, bool]:
        if graph.refund_case is not None:
            if graph.refund_case.purpose is not purpose:
                raise RefundPurposeMismatchError("refund case purpose does not match")
            return graph.refund_case, False
        if not self.purpose_is_valid(graph=graph, purpose=purpose):
            raise RefundPurposeMismatchError("payment does not satisfy refund purpose")

        refund_case = RefundCase(
            id=uuid.uuid4(),
            order_id=graph.order.id,
            payment_id=graph.payment.id,
            purpose=purpose,
            reason=reason,
            reason_note=reason_note,
            requested_by_user_id=requested_by_user_id,
            amount_cents=graph.payment.amount_cents,
            currency=graph.payment.currency,
        )
        self.session.add(refund_case)
        self.session.flush()
        graph.refund_case = refund_case
        return refund_case, True

    @staticmethod
    def latest_attempt(graph: LockedRefundGraph) -> RefundAttempt | None:
        return graph.latest_attempt

    def get_or_create_attempt(
        self,
        *,
        graph: LockedRefundGraph,
        provider: str,
        merchant_refund_no: str,
        next_reconcile_at: datetime,
    ) -> tuple[RefundAttempt, bool]:
        if graph.refund_case is None:
            raise RuntimeError("refund case must be created before an attempt")
        latest = graph.latest_attempt
        if latest is not None and latest.status is not RefundAttemptStatus.FAILED:
            return latest, False

        attempt = RefundAttempt(
            id=uuid.uuid4(),
            refund_case_id=graph.refund_case.id,
            provider=provider,
            merchant_refund_no=merchant_refund_no,
            status=RefundAttemptStatus.CREATING,
            attempt_no=1 if latest is None else latest.attempt_no + 1,
            next_reconcile_at=next_reconcile_at,
        )
        self.session.add(attempt)
        self.session.flush()
        graph.attempts = (*graph.attempts, attempt)
        return attempt, True

    @staticmethod
    def inventory_mutation_authority(
        graph: LockedRefundGraph,
    ) -> InventoryMutationAuthority | None:
        refund_case = graph.refund_case
        if (
            refund_case is None
            or refund_case.order_id != graph.order.id
            or refund_case.payment_id != graph.payment.id
            or graph.order.slot_id != graph.slot.id
        ):
            return None
        another_owner = any(
            order.id != graph.order.id and order.status in _BOOKING_OWNER_STATUSES
            for order in graph.slot_orders
        )
        if another_owner:
            return None
        return InventoryMutationAuthority(slot_id=graph.slot.id, order_id=graph.order.id)

    def claim_next_due_attempt(
        self,
        *,
        now: datetime,
        provider: str,
        lease_until: datetime,
    ) -> RefundRecoveryClaim | None:
        candidates = self.session.execute(
            select(RefundCase.payment_id, RefundAttempt.id)
            .join(RefundCase, RefundCase.id == RefundAttempt.refund_case_id)
            .where(
                RefundAttempt.provider == provider,
                RefundAttempt.status.in_(_ACTIVE_ATTEMPT_STATUSES),
                RefundAttempt.next_reconcile_at.is_not(None),
                RefundAttempt.next_reconcile_at <= now,
                or_(
                    RefundAttempt.reconcile_lease_until.is_(None),
                    RefundAttempt.reconcile_lease_until <= now,
                ),
            )
            .order_by(RefundAttempt.next_reconcile_at, RefundAttempt.id)
        ).all()
        for payment_id, attempt_id in candidates:
            graph = self.lock_refund_graph(payment_id)
            attempt = next(
                (candidate for candidate in graph.attempts if candidate.id == attempt_id),
                None,
            )
            if (
                attempt is None
                or attempt.provider != provider
                or attempt.status not in _ACTIVE_ATTEMPT_STATUSES
                or attempt.next_reconcile_at is None
                or attempt.next_reconcile_at > now
                or (
                    attempt.reconcile_lease_until is not None
                    and attempt.reconcile_lease_until > now
                )
            ):
                continue
            token = uuid.uuid4()
            attempt.reconcile_claim_token = token
            attempt.reconcile_lease_until = lease_until
            self.session.flush()
            return RefundRecoveryClaim(attempt_id=attempt.id, claim_token=token)
        return None
