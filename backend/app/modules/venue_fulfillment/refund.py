import hashlib
import json
import uuid
from collections.abc import Callable
from contextlib import suppress
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy.exc import SQLAlchemyError

from backend.app.errors import AppError
from backend.app.models import (
    IdempotencyRecord,
    IdempotencyState,
    OrderStatus,
    RefundAttemptStatus,
    RefundCasePurpose,
    RefundReason,
    SlotStatus,
    User,
)
from backend.app.modules.orders.lifecycle import (
    OrderActorCapability,
    OrderLifecycleFacts,
    project_allowed_actions,
)
from backend.app.modules.refunds.repository import (
    LockedRefundGraph,
    RefundPurposeMismatchError,
    RefundRepository,
)
from backend.app.modules.venue_fulfillment.dto import RefundAcceptedResponse
from backend.app.modules.venue_fulfillment.repository import (
    VenueFulfillmentRepository,
)

REFUND_OPERATION = "VENUE_REFUND"
_ACTIVE_ATTEMPT_STATUSES = {
    RefundAttemptStatus.CREATING,
    RefundAttemptStatus.PROCESSING,
    RefundAttemptStatus.UNKNOWN,
}


@dataclass(frozen=True, slots=True)
class VenueRefundResult:
    status_code: int
    response: RefundAcceptedResponse


class VenueRefundService:
    def __init__(
        self,
        *,
        repository: VenueFulfillmentRepository,
        refund_repository: RefundRepository,
        provider_name_resolver: Callable[[], str | None],
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self._repository = repository
        self._refund_repository = refund_repository
        self._provider_name_resolver = provider_name_resolver
        self._now = now or (lambda: datetime.now(UTC))

    def request_refund(
        self,
        *,
        user: User,
        venue_id: uuid.UUID,
        order_id: uuid.UUID,
        idempotency_key: str,
        reason_note: str,
    ) -> VenueRefundResult:
        try:
            provider_name = self._provider_name_resolver()
        except Exception:
            raise _service_unavailable() from None
        if not isinstance(provider_name, str) or not provider_name.strip():
            raise _service_unavailable()
        normalized_reason = reason_note.strip()
        if not normalized_reason or len(normalized_reason) > 500:
            raise AppError(422, "INVALID_ARGUMENT", "请填写有效的场馆退款原因。")

        try:
            scoped = self._repository.get_authorized_order(
                venue_id=venue_id,
                order_id=order_id,
                user_id=user.id,
            )
            if scoped is None:
                raise _not_found()
            request_sha256 = _request_sha256(
                venue_id=venue_id,
                order_id=order_id,
                reason_note=normalized_reason,
            )
            existing_idempotency = self._repository.get_idempotency(
                user_id=user.id,
                operation=REFUND_OPERATION,
                key=idempotency_key,
            )
            if existing_idempotency is not None:
                result = _replay_idempotency(
                    existing_idempotency,
                    request_sha256,
                )
                self._repository.rollback()
                return result
            graph = self._lock_applied_refund_graph(order_id=order_id)
            if graph is None:
                raise _order_state_changed()
            authorized = self._repository.get_authorized_order(
                venue_id=venue_id,
                order_id=order_id,
                user_id=user.id,
            )
            if (
                authorized is None
                or authorized.id != graph.order.id
                or authorized.slot_id != graph.slot.id
            ):
                raise _not_found()

            latest = graph.latest_attempt
            if latest is not None and latest.status is RefundAttemptStatus.SUCCESS:
                self._repository.rollback()
                return VenueRefundResult(
                    status_code=200,
                    response=RefundAcceptedResponse(
                        order_id=order_id,
                        status="REFUNDED",
                    ),
                )

            if not self._may_enqueue(graph=graph, now=self._now()):
                raise _order_state_changed()

            record, claimed = self._repository.claim_idempotency(
                user_id=user.id,
                operation=REFUND_OPERATION,
                key=idempotency_key,
                request_sha256=request_sha256,
            )
            if not claimed:
                result = _replay_idempotency(record, request_sha256)
                self._repository.commit()
                return result

            now = self._now()
            refund_case, _ = self._refund_repository.get_or_create_case(
                graph=graph,
                purpose=RefundCasePurpose.ORDER_CANCELLATION,
                reason=RefundReason.VENUE_CANCELLED,
                reason_note=normalized_reason,
                requested_by_user_id=user.id,
            )
            next_attempt_no = (
                1 if graph.latest_attempt is None else graph.latest_attempt.attempt_no + 1
            )
            self._refund_repository.get_or_create_attempt(
                graph=graph,
                provider=provider_name,
                merchant_refund_no=_merchant_refund_no(
                    refund_case_id=refund_case.id,
                    attempt_no=next_attempt_no,
                ),
                next_reconcile_at=now,
            )

            order = graph.order
            order.status = OrderStatus.REFUND_PENDING
            order.cancel_requested_at = order.cancel_requested_at or now
            order.cancelled_at = order.cancelled_at or now
            authority = self._refund_repository.inventory_mutation_authority(graph)
            if authority is not None:
                graph.slot.status = SlotStatus.CLOSED
                graph.slot.locked_until = None
                graph.slot.locked_by_order_id = None

            self._repository.flush()
            response = RefundAcceptedResponse(
                order_id=order.id,
                status="REFUND_PENDING",
            )
            self._repository.complete_idempotency(
                record,
                response_status=202,
                response_body=response.model_dump(mode="json"),
            )
            self._repository.commit()
            return VenueRefundResult(status_code=202, response=response)
        except AppError:
            with suppress(Exception):
                self._repository.rollback()
            raise
        except RefundPurposeMismatchError:
            with suppress(Exception):
                self._repository.rollback()
            raise _order_state_changed() from None
        except (RuntimeError, SQLAlchemyError):
            with suppress(Exception):
                self._repository.rollback()
            raise _service_unavailable() from None
        except Exception:
            with suppress(Exception):
                self._repository.rollback()
            raise

    def _lock_applied_refund_graph(
        self,
        *,
        order_id: uuid.UUID,
    ) -> LockedRefundGraph | None:
        for payment_id in self._repository.list_successful_payment_ids(
            order_id=order_id
        ):
            try:
                graph = self._refund_repository.lock_refund_graph(payment_id)
            except LookupError:
                continue
            purpose_is_valid = self._refund_repository.purpose_is_valid(
                graph=graph,
                purpose=RefundCasePurpose.ORDER_CANCELLATION,
            )
            case_matches = (
                graph.refund_case is None
                or graph.refund_case.purpose
                is RefundCasePurpose.ORDER_CANCELLATION
            )
            if purpose_is_valid and case_matches and graph.payment.currency == "CNY":
                return graph
        return None

    @staticmethod
    def _may_enqueue(*, graph: LockedRefundGraph, now: datetime) -> bool:
        latest = graph.latest_attempt
        if latest is not None and latest.status in _ACTIVE_ATTEMPT_STATUSES:
            return graph.order.status is OrderStatus.REFUND_PENDING
        if latest is not None and latest.status is RefundAttemptStatus.FAILED:
            return (
                graph.order.status is OrderStatus.REFUND_FAILED
                and graph.order.checked_in_at is None
            )
        if latest is not None:
            return False
        actions = project_allowed_actions(
            OrderLifecycleFacts(
                status=graph.order.status,
                starts_at=graph.slot.starts_at,
                ends_at=graph.slot.ends_at,
                cancel_requested_at=graph.order.cancel_requested_at,
                checked_in_at=graph.order.checked_in_at,
                payment_may_exist=True,
                controlling_refund_purpose=(
                    graph.refund_case.purpose
                    if graph.refund_case is not None
                    else None
                ),
            ),
            actor=OrderActorCapability.VENUE_MANAGER,
            now=now,
        )
        return actions.can_refund


def _merchant_refund_no(*, refund_case_id: uuid.UUID, attempt_no: int) -> str:
    digest = hashlib.sha256(f"{refund_case_id}:{attempt_no}".encode()).hexdigest()
    return f"VR{digest[:30]}"


def _request_sha256(
    *,
    venue_id: uuid.UUID,
    order_id: uuid.UUID,
    reason_note: str,
) -> str:
    canonical = json.dumps(
        {
            "body": {"reason_note": reason_note},
            "order_id": str(order_id),
            "venue_id": str(venue_id),
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode()).hexdigest()


def _replay_idempotency(
    record: IdempotencyRecord,
    request_sha256: str,
) -> VenueRefundResult:
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
    return VenueRefundResult(
        status_code=record.response_status,
        response=RefundAcceptedResponse.model_validate(record.response_body),
    )


def _not_found() -> AppError:
    return AppError(404, "ORDER_NOT_FOUND", "履约订单不存在。")


def _service_unavailable() -> AppError:
    return AppError(503, "SERVICE_UNAVAILABLE", "退款服务暂不可用，请稍后重试。")


def _order_state_changed() -> AppError:
    return AppError(409, "ORDER_STATE_CHANGED", "订单状态已变化，请刷新后重试。")
