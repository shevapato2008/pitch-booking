from __future__ import annotations

import uuid
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol

from sqlalchemy.orm import Session

from backend.app.errors import AppError
from backend.app.models import PaymentState
from backend.app.modules.payments.convergence import PaymentConvergenceService
from backend.app.modules.payments.provider import (
    AuthoritativePaymentFacts,
    PaymentProvider,
    QueryPaymentRequest,
    QueryPaymentResult,
    QueryPaymentStatus,
)
from backend.app.modules.payments.repository import PaymentRepository


@dataclass(frozen=True, slots=True)
class ReconciliationResult:
    status_code: int
    order_id: uuid.UUID
    payment_id: uuid.UUID


class PaymentReconciliationService:
    def __init__(
        self,
        *,
        session_factory: Callable[[], Session],
        provider: PaymentProvider,
        convergence: PaymentConvergenceService,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self._session_factory = session_factory
        self._provider = provider
        self._convergence = convergence
        self._now = now or (lambda: datetime.now(UTC))

    def reconcile(
        self, *, user_id: uuid.UUID, order_id: uuid.UUID, payment_id: uuid.UUID
    ) -> ReconciliationResult:
        # Locate identifiers without locks, preserving ownership-hiding 404 semantics.
        with self._session_factory() as locating:
            repository = PaymentRepository(locating)
            order = repository.locate_owned_order(order_id=order_id, user_id=user_id)
            payment = repository.locate_payment(payment_id)
            if order is None or payment is None or payment.order_id != order.id:
                raise _not_found()
            slot_id = order.slot_id

        # A short transaction makes the request visible to restart-safe recovery.
        with self._session_factory() as session:
            repository = PaymentRepository(session)
            _slot, order, payment = repository.lock_payment_graph(
                order_id=order_id,
                slot_id=slot_id,
                payment_id=payment_id,
            )
            if order.user_id != user_id:
                raise _not_found()
            now = self._now()
            if payment.status not in {PaymentState.SUCCESS, PaymentState.CLOSED}:
                payment.status = PaymentState.CONFIRMING
                payment.next_reconcile_at = now
            merchant_order_no = payment.merchant_order_no
            provider_name = payment.provider
            session.commit()

        # Provider IO is intentionally outside every row-lock transaction.
        query = self._provider.query_payment(QueryPaymentRequest(merchant_order_no))
        converged = self._convergence.converge(
            payment_id=payment_id,
            provider=provider_name,
            result=query,
        )
        return ReconciliationResult(
            200 if converged.terminal else 202,
            converged.order_id,
            converged.payment_id,
        )


class WeChatNotificationAdapter(Protocol):
    """Verifier/decryptor boundary; implementations return only sanitized facts."""

    def verify_and_decrypt(
        self,
        *,
        raw_body: bytes,
        headers: Mapping[str, str],
        now: datetime,
    ) -> AuthoritativePaymentFacts: ...


class _NotificationConvergence(Protocol):
    def converge(
        self,
        *,
        payment_id: uuid.UUID,
        provider: str,
        result: QueryPaymentResult,
    ) -> object: ...


class PaymentNotificationService:
    def __init__(
        self,
        *,
        adapter: WeChatNotificationAdapter,
        convergence: _NotificationConvergence,
        locate_payment: Callable[[str, str], uuid.UUID | None],
        provider: str,
    ) -> None:
        self._adapter = adapter
        self._convergence = convergence
        self._locate_payment = locate_payment
        self._provider = provider

    def handle(self, *, raw_body: bytes, headers: Mapping[str, str], now: datetime) -> object:
        # Verification, certificate selection, timestamp-window validation, and
        # decryption must all finish before facts can cross this boundary.
        facts = self._adapter.verify_and_decrypt(
            raw_body=raw_body,
            headers=headers,
            now=now,
        )
        payment_id = self._locate_payment(self._provider, facts.merchant_order_no)
        if payment_id is None:
            raise LookupError("payment not found")
        return self._convergence.converge(
            payment_id=payment_id,
            provider=self._provider,
            result=QueryPaymentResult(QueryPaymentStatus.SUCCESS, facts=facts),
        )


def _not_found() -> AppError:
    return AppError(404, "ORDER_NOT_FOUND", "订单或支付不存在，或不可访问。")
