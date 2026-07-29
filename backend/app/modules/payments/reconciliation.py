from __future__ import annotations

import uuid
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal, Protocol, cast

from sqlalchemy.orm import Session

from backend.app.errors import AppError
from backend.app.models import IdempotencyState, OrderStatus, PaymentState, User
from backend.app.modules.orders.expiry import PendingOrderExpiryService
from backend.app.modules.payments.convergence import (
    ConvergenceResult,
    PaymentConvergenceService,
)
from backend.app.modules.payments.provider import (
    PAYMENT_PROVIDER_MAX_REQUEST_DURATION,
    AuthoritativePaymentFacts,
    ClosePaymentRequest,
    ClosePaymentStatus,
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

RECOVERY_LEASE_DURATION = timedelta(minutes=10)
# Provider adapters must time out before this contract. Keeping the durable lease
# far longer prevents a timed-out caller and its replacement from overlapping.
assert RECOVERY_LEASE_DURATION >= PAYMENT_PROVIDER_MAX_REQUEST_DURATION * 2


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

    @property
    def provider_name(self) -> str:
        return self._provider.name

    def recover(
        self,
        payment_id: uuid.UUID,
        *,
        claim_token: uuid.UUID | None = None,
    ) -> ConvergenceResult:
        now = self._now()
        with self._session_factory() as locating:
            repository = PaymentRepository(locating)
            located = repository.locate_payment(payment_id)
            if located is None:
                raise LookupError("payment not found")
            order_id = located.order_id
            slot_id = located.order.slot_id

        with self._session_factory() as session:
            repository = PaymentRepository(session)
            _slot, order, payment = repository.lock_payment_graph(
                order_id=order_id,
                slot_id=slot_id,
                payment_id=payment_id,
            )
            if payment.provider != self._provider.name:
                raise LookupError("payment not found")
            if payment.status in {PaymentState.SUCCESS, PaymentState.CLOSED}:
                payment.reconcile_claim_token = None
                payment.reconcile_lease_until = None
                payment.creation_recovery_pending = False
                session.commit()
                return ConvergenceResult(order.id, payment.id, True)
            if claim_token is None:
                lease_active = (
                    payment.reconcile_lease_until is not None
                    and payment.reconcile_lease_until > now
                )
                schedule_due = (
                    payment.next_reconcile_at is None
                    or payment.next_reconcile_at <= now
                ) or (
                    order.expires_at <= now
                    and payment.expiry_reconciled_at is None
                )
                if lease_active or not schedule_due:
                    session.commit()
                    return ConvergenceResult(order.id, payment.id, False)
                claim_token = uuid.uuid4()
                payment.reconcile_claim_token = claim_token
                payment.reconcile_lease_until = now + RECOVERY_LEASE_DURATION
                payment.reconcile_attempts += 1
            elif (
                payment.reconcile_claim_token != claim_token
                or payment.reconcile_lease_until is None
                or payment.reconcile_lease_until <= now
            ):
                session.commit()
                return ConvergenceResult(order.id, payment.id, False)
            original_status = payment.status
            if original_status is PaymentState.CREATING:
                payment.creation_recovery_pending = True
            recover_creation = payment.creation_recovery_pending
            merchant_order_no = payment.merchant_order_no
            amount_cents = payment.amount_cents
            if payment.currency != "CNY":
                raise RuntimeError("unsupported persisted payment currency")
            currency = cast(Literal["CNY"], payment.currency)
            order_expired = order.expires_at <= now
            payer = session.get_one(User, order.user_id).wechat_openid
            session.commit()

        try:
            query = self._provider.query_payment(
                QueryPaymentRequest(merchant_order_no)
            )
        except Exception:
            query = QueryPaymentResult(
                QueryPaymentStatus.UNKNOWN,
                safe_error_code="PAYMENT_PROVIDER_QUERY_FAILED",
            )

        if recover_creation:
            if query.status is QueryPaymentStatus.NOT_FOUND and not order_expired:
                try:
                    created = self._provider.create_prepay(
                        CreatePrepayRequest(
                            merchant_order_no=merchant_order_no,
                            description=f"场地预订 {order_id}",
                            amount_cents=amount_cents,
                            currency=currency,
                            payer_openid=payer,
                        )
                    )
                except Exception:
                    created = Unknown("PAYMENT_PROVIDER_CREATE_FAILED")
                if isinstance(created, Rejected):
                    # Re-query after rejection so an accepted concurrent call wins.
                    try:
                        query = self._provider.query_payment(
                            QueryPaymentRequest(merchant_order_no)
                        )
                    except Exception:
                        query = QueryPaymentResult(
                            QueryPaymentStatus.UNKNOWN,
                            safe_error_code="PAYMENT_PROVIDER_REQUERY_FAILED",
                        )
                    if query.status is QueryPaymentStatus.NOT_FOUND:
                        query = QueryPaymentResult(
                            QueryPaymentStatus.CLOSED,
                            safe_error_code=created.safe_error_code,
                        )
                elif isinstance(created, Unknown):
                    query = QueryPaymentResult(
                        QueryPaymentStatus.UNKNOWN,
                        safe_error_code=created.safe_error_code,
                    )
                else:
                    return self._record_created(
                        order_id=order_id,
                        slot_id=slot_id,
                        payment_id=payment_id,
                        created=created,
                        now=now,
                        order_expired=order_expired,
                    )
            elif query.status is QueryPaymentStatus.NOT_FOUND:
                query = QueryPaymentResult(
                    QueryPaymentStatus.CLOSED,
                    safe_error_code="PAYMENT_AUTHORITY_NOT_FOUND",
                )
            elif (
                query.status is QueryPaymentStatus.NOT_PAID
                and not order_expired
            ):
                if (
                    query.provider_prepay_id is None
                    or query.launch_params is None
                ):
                    query = QueryPaymentResult(
                        QueryPaymentStatus.UNKNOWN,
                        safe_error_code="PAYMENT_PREPAY_RECOVERY_INCOMPLETE",
                    )
                else:
                    return self._record_created(
                        order_id=order_id,
                        slot_id=slot_id,
                        payment_id=payment_id,
                        created=Created(
                            provider_prepay_id=query.provider_prepay_id,
                            launch_params=query.launch_params,
                        ),
                        now=now,
                        order_expired=order_expired,
                    )

        if query.status is QueryPaymentStatus.NOT_PAID and order_expired:
            try:
                closed = self._provider.close_payment(
                    ClosePaymentRequest(merchant_order_no)
                )
                if closed.status is ClosePaymentStatus.SUCCESS:
                    query = QueryPaymentResult(
                        QueryPaymentStatus.SUCCESS,
                        facts=closed.facts,
                    )
                elif closed.status is ClosePaymentStatus.CLOSED:
                    query = QueryPaymentResult(
                        QueryPaymentStatus.CLOSED,
                        safe_error_code=closed.safe_error_code,
                    )
                else:
                    query = QueryPaymentResult(
                        QueryPaymentStatus.UNKNOWN,
                        safe_error_code=closed.safe_error_code
                        or "PAYMENT_PROVIDER_CLOSE_FAILED",
                    )
            except Exception:
                query = QueryPaymentResult(
                    QueryPaymentStatus.UNKNOWN,
                    safe_error_code="PAYMENT_PROVIDER_CLOSE_FAILED",
                )

        converged = self._convergence.converge(
            payment_id=payment_id,
            provider=self._provider.name,
            result=query,
        )
        return self._finalize_recovery(converged, now=now)

    def _record_created(
        self,
        *,
        order_id: uuid.UUID,
        slot_id: uuid.UUID,
        payment_id: uuid.UUID,
        created: Created,
        now: datetime,
        order_expired: bool,
    ) -> ConvergenceResult:
        with self._session_factory() as session:
            repository = PaymentRepository(session)
            _slot, order, payment = repository.lock_payment_graph(
                order_id=order_id,
                slot_id=slot_id,
                payment_id=payment_id,
            )
            if payment.status in {PaymentState.SUCCESS, PaymentState.CLOSED}:
                payment.reconcile_claim_token = None
                payment.reconcile_lease_until = None
                payment.creation_recovery_pending = False
                session.commit()
                return ConvergenceResult(order.id, payment.id, True)
            payment.status = PaymentState.PREPAY_CREATED
            payment.provider_prepay_id = created.provider_prepay_id
            payment.next_reconcile_at = now + _backoff(payment.reconcile_attempts)
            payment.reconcile_claim_token = None
            payment.reconcile_lease_until = None
            payment.creation_recovery_pending = False
            if order_expired:
                payment.expiry_reconciled_at = now
            payment.last_error_code = None
            payment.last_error_at = None
            if created.launch_params is not None:
                body: dict[str, object] = {
                    "order_id": str(order.id),
                    "payment_id": str(payment.id),
                    "status": "PREPAY_CREATED",
                    "launch_params": created.launch_params.as_dict(),
                }
                for record in repository.lock_payment_idempotencies(payment.id):
                    if record.state is IdempotencyState.PROCESSING:
                        record.state = IdempotencyState.COMPLETED
                        record.response_status = 200
                        record.response_body = body
            session.commit()
            return ConvergenceResult(order.id, payment.id, False)

    def _finalize_recovery(
        self, converged: ConvergenceResult, *, now: datetime
    ) -> ConvergenceResult:
        with self._session_factory() as session:
            repository = PaymentRepository(session)
            located = repository.locate_payment(converged.payment_id)
            if located is None:
                raise LookupError("payment not found")
            slot_id = located.order.slot_id
            _slot, order, payment = repository.lock_payment_graph(
                order_id=converged.order_id,
                slot_id=slot_id,
                payment_id=converged.payment_id,
            )
            if payment.status is PaymentState.UNKNOWN:
                anchor = payment.authority_unknown_since
                if anchor is not None and now - anchor >= timedelta(hours=24):
                    order.status = OrderStatus.PAYMENT_EXCEPTION
                    payment.next_reconcile_at = now + timedelta(hours=6)
                else:
                    payment.next_reconcile_at = now + _backoff(
                        payment.reconcile_attempts
                    )
            elif payment.status in {
                PaymentState.CREATING,
                PaymentState.PREPAY_CREATED,
                PaymentState.CONFIRMING,
            }:
                payment.next_reconcile_at = now + _backoff(
                    payment.reconcile_attempts
                )
            payment.reconcile_claim_token = None
            payment.reconcile_lease_until = None
            if order.expires_at <= now:
                payment.expiry_reconciled_at = now
            if payment.status in {PaymentState.SUCCESS, PaymentState.CLOSED}:
                payment.creation_recovery_pending = False
            session.commit()

        if converged.terminal:
            with self._session_factory() as expiry_session:
                expiry = PendingOrderExpiryService().expire_by_order_id(
                    expiry_session,
                    converged.order_id,
                    now,
                )
                if expiry.changed:
                    expiry_session.commit()
                else:
                    expiry_session.rollback()
        return converged

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
            if payment.provider != self._provider.name:
                raise _not_found()
            now = self._now()
            if payment.status not in {PaymentState.SUCCESS, PaymentState.CLOSED}:
                payment.status = PaymentState.CONFIRMING
                payment.next_reconcile_at = now
            merchant_order_no = payment.merchant_order_no
            session.commit()

        # Provider IO is intentionally outside every row-lock transaction.
        try:
            query = self._provider.query_payment(QueryPaymentRequest(merchant_order_no))
        except Exception:
            query = QueryPaymentResult(
                QueryPaymentStatus.UNKNOWN,
                safe_error_code="PAYMENT_PROVIDER_QUERY_FAILED",
            )
        converged = self._convergence.converge(
            payment_id=payment_id,
            provider=self._provider.name,
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


def _backoff(attempts: int) -> timedelta:
    minutes = (1, 2, 5, 10, 30)[min(max(attempts, 1) - 1, 4)]
    return timedelta(minutes=minutes)
