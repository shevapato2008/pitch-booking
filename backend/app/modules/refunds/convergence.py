from __future__ import annotations

import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from backend.app.models import (
    OrderStatus,
    RefundAttempt,
    RefundAttemptStatus,
    RefundCasePurpose,
    RefundReason,
    SlotStatus,
)
from backend.app.modules.refunds.provider import (
    ExpectedRefundFacts,
    QueryRefundResult,
    QueryRefundStatus,
    authoritative_refund_facts_mismatch,
)
from backend.app.modules.refunds.repository import LockedRefundGraph, RefundRepository

_RETRY_DELAY = timedelta(minutes=1)


@dataclass(frozen=True, slots=True)
class RefundConvergenceResult:
    order_id: uuid.UUID
    attempt_id: uuid.UUID
    terminal: bool


class RefundConvergenceService:
    """Apply sanitized refund authority under the shared refund lock graph."""

    def __init__(
        self,
        *,
        session_factory: Callable[[], Session],
        expected_merchant_id: str,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self._session_factory = session_factory
        self._expected_merchant_id = expected_merchant_id
        self._now = now or (lambda: datetime.now(UTC))

    def converge(
        self,
        *,
        attempt_id: uuid.UUID,
        provider: str,
        result: QueryRefundResult,
        claim_token: uuid.UUID | None = None,
    ) -> RefundConvergenceResult:
        with self._session_factory() as locating:
            payment_id = RefundRepository(locating).locate_attempt_payment_id(attempt_id)
            if payment_id is None:
                raise LookupError("refund attempt not found")

        with self._session_factory() as session:
            graph = RefundRepository(session).lock_refund_graph(payment_id)
            refund_case = graph.refund_case
            attempt = next(
                (candidate for candidate in graph.attempts if candidate.id == attempt_id),
                None,
            )
            if refund_case is None or attempt is None:
                raise LookupError("refund attempt not found")
            now = self._now()
            if claim_token is not None and (
                attempt.reconcile_claim_token != claim_token
                or attempt.reconcile_lease_until is None
                or attempt.reconcile_lease_until <= now
            ):
                session.commit()
                return RefundConvergenceResult(graph.order.id, attempt.id, False)

            if attempt.status is RefundAttemptStatus.SUCCESS:
                session.commit()
                return RefundConvergenceResult(graph.order.id, attempt.id, True)

            if provider != attempt.provider:
                self._unknown(attempt, "REFUND_PROVIDER_MISMATCH", now)
            elif result.status is QueryRefundStatus.SUCCESS:
                facts = result.facts
                if facts is None:
                    raise RuntimeError("Provider SUCCESS omitted refund facts")
                mismatch = authoritative_refund_facts_mismatch(
                    facts=facts,
                    expected=ExpectedRefundFacts(
                        provider=attempt.provider,
                        merchant_id=self._expected_merchant_id,
                        merchant_refund_no=attempt.merchant_refund_no,
                        merchant_order_no=graph.payment.merchant_order_no,
                        provider_transaction_no=graph.payment.provider_transaction_no or "",
                        amount_cents=refund_case.amount_cents,
                        currency=refund_case.currency,
                    ),
                )
                if mismatch is not None:
                    self._unknown(attempt, mismatch.value, now)
                else:
                    attempt.status = RefundAttemptStatus.SUCCESS
                    attempt.provider_refund_no = facts.provider_refund_no
                    attempt.refunded_at = facts.refunded_at
                    attempt.failure_code = None
                    self._clear_recovery(attempt)
                    self._project_controlling_order(graph, OrderStatus.REFUNDED, now)
                    authority = RefundRepository.inventory_mutation_authority(graph)
                    if authority is not None:
                        if refund_case.reason is RefundReason.USER_CANCELLED:
                            graph.slot.status = SlotStatus.AVAILABLE
                            graph.slot.locked_by_order_id = None
                            graph.slot.locked_until = None
                        elif refund_case.reason is RefundReason.VENUE_CANCELLED:
                            graph.slot.status = SlotStatus.CLOSED
                            graph.slot.locked_by_order_id = None
                            graph.slot.locked_until = None
            elif result.status is QueryRefundStatus.FAILED:
                attempt.status = RefundAttemptStatus.FAILED
                attempt.failure_code = result.safe_error_code
                attempt.refunded_at = None
                self._clear_recovery(attempt)
                self._project_controlling_order(graph, OrderStatus.REFUND_FAILED, now)
            elif result.status is QueryRefundStatus.PROCESSING:
                attempt.status = RefundAttemptStatus.PROCESSING
                attempt.failure_code = None
                attempt.refunded_at = None
                attempt.next_reconcile_at = now + _RETRY_DELAY
                self._clear_lease(attempt)
                self._project_controlling_order(graph, OrderStatus.REFUND_PENDING, now)
            else:
                code = (
                    result.safe_error_code
                    if result.status is QueryRefundStatus.UNKNOWN
                    else "REFUND_AUTHORITY_NOT_FOUND"
                )
                self._unknown(attempt, code or "REFUND_AUTHORITY_UNKNOWN", now)
                self._project_controlling_order(graph, OrderStatus.REFUND_PENDING, now)

            authority = RefundRepository.inventory_mutation_authority(graph)
            if authority is not None and refund_case.reason is RefundReason.VENUE_CANCELLED:
                graph.slot.status = SlotStatus.CLOSED
                graph.slot.locked_by_order_id = None
                graph.slot.locked_until = None

            session.flush()
            terminal = attempt.status in {
                RefundAttemptStatus.SUCCESS,
                RefundAttemptStatus.FAILED,
            }
            session.commit()
            return RefundConvergenceResult(graph.order.id, attempt.id, terminal)

    @staticmethod
    def _project_controlling_order(
        graph: LockedRefundGraph, status: OrderStatus, now: datetime
    ) -> None:
        refund_case = graph.refund_case
        if refund_case.purpose is RefundCasePurpose.DUPLICATE_CHARGE:
            return
        graph.order.cancel_requested_at = graph.order.cancel_requested_at or now
        graph.order.cancelled_at = graph.order.cancelled_at or now
        graph.order.expired_at = None
        graph.order.status = status

    @classmethod
    def _unknown(cls, attempt: RefundAttempt, code: str, now: datetime) -> None:
        attempt.status = RefundAttemptStatus.UNKNOWN
        attempt.failure_code = code
        attempt.refunded_at = None
        attempt.next_reconcile_at = now + _RETRY_DELAY
        cls._clear_lease(attempt)

    @staticmethod
    def _clear_lease(attempt: RefundAttempt) -> None:
        attempt.reconcile_claim_token = None
        attempt.reconcile_lease_until = None

    @classmethod
    def _clear_recovery(cls, attempt: RefundAttempt) -> None:
        attempt.next_reconcile_at = None
        cls._clear_lease(attempt)
