import base64
import binascii
import hashlib
import json
import uuid
from collections.abc import Callable
from contextlib import suppress
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy.exc import SQLAlchemyError

from backend.app.errors import AppError
from backend.app.models import (
    IdempotencyRecord,
    IdempotencyState,
    Order,
    OrderStatus,
    User,
)
from backend.app.modules.checkout.dto import (
    CheckoutPitchResponse,
    CheckoutVenueResponse,
)
from backend.app.modules.orders.dto import OrderAllowedActionsResponse
from backend.app.modules.orders.lifecycle import (
    OrderActorCapability,
    OrderAllowedActions,
    OrderLifecycleFacts,
    project_allowed_actions,
)
from backend.app.modules.venue_fulfillment.dto import (
    VenueFulfillmentOrderResponse,
    VenueFulfillmentOrdersResponse,
)
from backend.app.modules.venue_fulfillment.repository import (
    VenueFulfillmentRepository,
)
from backend.app.security.phone_vault import PhoneVault, PhoneVaultError, SealedPhone

SHANGHAI = ZoneInfo("Asia/Shanghai")
CURSOR_VERSION = 1
CHECK_IN_OPERATION = "VENUE_CHECK_IN"
COMPLETE_OPERATION = "VENUE_COMPLETE"


class VenueFulfillmentService:
    def __init__(
        self,
        *,
        repository: VenueFulfillmentRepository,
        phone_vault: PhoneVault | None,
        refund_actions_enabled: bool = False,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self._repository = repository
        self._phone_vault = phone_vault
        self._refund_actions_enabled = refund_actions_enabled
        self._now = now or (lambda: datetime.now(UTC))

    def list_orders(
        self,
        *,
        user: User,
        venue_id: uuid.UUID,
        service_date: date | None,
        limit: int,
        cursor: str | None,
    ) -> VenueFulfillmentOrdersResponse:
        try:
            now = self._now()
            resolved_date = service_date or now.astimezone(SHANGHAI).date()
            parent = self._repository.get_authorized_venue(
                venue_id=venue_id,
                user_id=user.id,
            )
            if parent is None:
                raise _not_found()
            after_starts_at, after_id = _decode_cursor(
                cursor,
                venue_id=venue_id,
                service_date=resolved_date,
            )

            local_start = datetime.combine(resolved_date, time.min, SHANGHAI)
            utc_start = local_start.astimezone(UTC)
            utc_end = (local_start + timedelta(days=1)).astimezone(UTC)
            rows = self._repository.list_orders(
                venue_id=venue_id,
                utc_start=utc_start,
                utc_end=utc_end,
                limit=limit + 1,
                after_starts_at=after_starts_at,
                after_id=after_id,
            )
            page = rows[:limit]
            projected = [self._project_order(order, now=now) for order in page]
            next_cursor = (
                _encode_cursor(
                    venue_id=venue_id,
                    service_date=resolved_date,
                    starts_at=page[-1].slot.starts_at,
                    order_id=page[-1].id,
                )
                if len(rows) > limit
                else None
            )
            return VenueFulfillmentOrdersResponse(
                venue=CheckoutVenueResponse(id=parent.id, name=parent.name),
                service_date=resolved_date,
                generated_at=now.astimezone(SHANGHAI),
                orders=projected,
                next_cursor=next_cursor,
            )
        except AppError:
            raise
        except (SQLAlchemyError, PhoneVaultError):
            with suppress(Exception):
                self._repository.rollback()
            raise _service_unavailable() from None

    def check_in_order(
        self,
        *,
        user: User,
        venue_id: uuid.UUID,
        order_id: uuid.UUID,
        idempotency_key: str,
    ) -> VenueFulfillmentOrderResponse:
        return self._mutate_order(
            user=user,
            venue_id=venue_id,
            order_id=order_id,
            idempotency_key=idempotency_key,
            operation=CHECK_IN_OPERATION,
        )

    def complete_order(
        self,
        *,
        user: User,
        venue_id: uuid.UUID,
        order_id: uuid.UUID,
        idempotency_key: str,
    ) -> VenueFulfillmentOrderResponse:
        return self._mutate_order(
            user=user,
            venue_id=venue_id,
            order_id=order_id,
            idempotency_key=idempotency_key,
            operation=COMPLETE_OPERATION,
        )

    def _mutate_order(
        self,
        *,
        user: User,
        venue_id: uuid.UUID,
        order_id: uuid.UUID,
        idempotency_key: str,
        operation: str,
    ) -> VenueFulfillmentOrderResponse:
        try:
            scoped = self._repository.get_authorized_order(
                venue_id=venue_id,
                order_id=order_id,
                user_id=user.id,
            )
            if scoped is None:
                raise _not_found()
            request_sha256 = _mutation_request_sha256(
                venue_id=venue_id,
                order_id=order_id,
            )
            record, claimed = self._repository.claim_idempotency(
                user_id=user.id,
                operation=operation,
                key=idempotency_key,
                request_sha256=request_sha256,
            )
            if not claimed:
                response = _replay_idempotency(record, request_sha256)
                self._repository.commit()
                return response

            slot, locked_order = self._repository.lock_business_graph(
                slot_id=scoped.slot_id,
                order_id=order_id,
            )
            if slot is None or locked_order is None:
                raise _not_found()
            order = self._repository.get_authorized_order(
                venue_id=venue_id,
                order_id=order_id,
                user_id=user.id,
            )
            if order is None or order.slot_id != slot.id:
                raise _not_found()

            now = self._now()
            if operation == CHECK_IN_OPERATION:
                if order.checked_in_at is None:
                    if not self._venue_actions(order, now=now).can_check_in:
                        raise _order_state_changed()
                    order.checked_in_at = now
                    order.checked_in_by_user_id = user.id
                elif order.checked_in_by_user_id is None:
                    raise _order_state_changed()
            else:
                if order.status is not OrderStatus.COMPLETED:
                    if not self._venue_actions(order, now=now).can_complete:
                        raise _order_state_changed()
                    order.status = OrderStatus.COMPLETED
                    order.completed_at = now
                    order.completed_by_user_id = user.id
                elif order.completed_at is None or order.completed_by_user_id is None:
                    raise _order_state_changed()

            self._repository.flush()
            response = self._project_order(order, now=now)
            body = response.model_dump(mode="json")
            self._repository.complete_idempotency(record, response_body=body)
            self._repository.commit()
            return response
        except AppError:
            with suppress(Exception):
                self._repository.rollback()
            raise
        except (SQLAlchemyError, PhoneVaultError):
            with suppress(Exception):
                self._repository.rollback()
            raise _service_unavailable() from None
        except Exception:
            with suppress(Exception):
                self._repository.rollback()
            raise

    @staticmethod
    def _venue_actions(order: Order, *, now: datetime) -> OrderAllowedActions:
        return project_allowed_actions(
            OrderLifecycleFacts(
                status=order.status,
                starts_at=order.slot.starts_at,
                ends_at=order.slot.ends_at,
                cancel_requested_at=order.cancel_requested_at,
                checked_in_at=order.checked_in_at,
                payment_may_exist=False,
                controlling_refund_purpose=None,
            ),
            actor=OrderActorCapability.VENUE_MANAGER,
            now=now,
        )

    def _project_order(
        self,
        order: Order,
        *,
        now: datetime,
    ) -> VenueFulfillmentOrderResponse:
        if self._phone_vault is None:
            raise PhoneVaultError("phone vault is unavailable")
        phone = self._phone_vault.decrypt(
            SealedPhone(
                order.contact_phone_ciphertext,
                order.contact_phone_nonce,
                order.contact_phone_key_version,
            ),
            record_type="order",
            record_id=order.id,
            field="contact_phone",
        )
        actions = self._venue_actions(order, now=now)
        return VenueFulfillmentOrderResponse(
            id=order.id,
            order_number=order.order_number,
            status=order.status,
            pitch=CheckoutPitchResponse(
                id=order.slot.pitch.id,
                name=order.slot.pitch.name,
            ),
            starts_at=order.slot.starts_at.astimezone(SHANGHAI),
            ends_at=order.slot.ends_at.astimezone(SHANGHAI),
            masked_phone=PhoneVault.mask(phone),
            checked_in_at=(
                order.checked_in_at.astimezone(SHANGHAI)
                if order.checked_in_at is not None
                else None
            ),
            allowed_actions=OrderAllowedActionsResponse(
                can_pay=actions.can_pay,
                can_cancel=actions.can_cancel,
                can_check_in=actions.can_check_in,
                can_complete=actions.can_complete,
                can_refund=(
                    actions.can_refund and self._refund_actions_enabled
                ),
                blocked_reason=actions.blocked_reason,
            ),
        )


def _encode_cursor(
    *,
    venue_id: uuid.UUID,
    service_date: date,
    starts_at: datetime,
    order_id: uuid.UUID,
) -> str:
    payload = json.dumps(
        {
            "v": CURSOR_VERSION,
            "venue_id": str(venue_id),
            "service_date": service_date.isoformat(),
            "starts_at": starts_at.astimezone(UTC).isoformat(),
            "id": str(order_id),
        },
        separators=(",", ":"),
        sort_keys=True,
    ).encode()
    return base64.urlsafe_b64encode(payload).decode().rstrip("=")


def _decode_cursor(
    cursor: str | None,
    *,
    venue_id: uuid.UUID,
    service_date: date,
) -> tuple[datetime | None, uuid.UUID | None]:
    if cursor is None:
        return None, None
    try:
        raw = base64.b64decode(
            cursor + "=" * (-len(cursor) % 4),
            altchars=b"-_",
            validate=True,
        )
        payload = json.loads(raw)
        if not isinstance(payload, dict) or set(payload) != {
            "v",
            "venue_id",
            "service_date",
            "starts_at",
            "id",
        }:
            raise ValueError
        if (
            type(payload["v"]) is not int
            or payload["v"] != CURSOR_VERSION
            or any(
                type(payload[field]) is not str
                for field in ("venue_id", "service_date", "starts_at", "id")
            )
            or uuid.UUID(payload["venue_id"]) != venue_id
            or date.fromisoformat(payload["service_date"]) != service_date
        ):
            raise ValueError
        starts_at = datetime.fromisoformat(payload["starts_at"])
        if starts_at.tzinfo is None or starts_at.utcoffset() is None:
            raise ValueError
        order_id = uuid.UUID(payload["id"])
    except (binascii.Error, json.JSONDecodeError, TypeError, ValueError):
        raise AppError(422, "INVALID_ARGUMENT", "履约列表游标无效，请重新加载。") from None
    return starts_at, order_id


def _mutation_request_sha256(
    *,
    venue_id: uuid.UUID,
    order_id: uuid.UUID,
) -> str:
    canonical = json.dumps(
        {
            "body": {},
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
) -> VenueFulfillmentOrderResponse:
    if record.request_sha256 != request_sha256:
        raise AppError(
            409,
            "IDEMPOTENCY_KEY_REUSED",
            "该幂等键已用于其他请求，请生成新键后重试。",
        )
    if (
        record.state is not IdempotencyState.COMPLETED
        or record.response_status != 200
        or record.response_body is None
    ):
        raise _service_unavailable()
    return VenueFulfillmentOrderResponse.model_validate(record.response_body)


def _not_found() -> AppError:
    return AppError(404, "ORDER_NOT_FOUND", "履约订单不存在。")


def _service_unavailable() -> AppError:
    return AppError(503, "SERVICE_UNAVAILABLE", "履约服务暂不可用，请稍后重试。")


def _order_state_changed() -> AppError:
    return AppError(409, "ORDER_STATE_CHANGED", "订单状态已变化，请刷新后重试。")
