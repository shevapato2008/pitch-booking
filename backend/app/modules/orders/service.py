import base64
import binascii
import hashlib
import json
import uuid
from bisect import bisect_right
from collections.abc import Callable
from contextlib import suppress
from datetime import UTC, datetime, timedelta
from typing import Literal, cast
from zoneinfo import ZoneInfo

from sqlalchemy.exc import SQLAlchemyError

from backend.app.errors import AppError
from backend.app.models import (
    BookingMode,
    IdempotencyRecord,
    IdempotencyState,
    Order,
    OrderStatus,
    Payment,
    PaymentState,
    Slot,
    SlotStatus,
    User,
)
from backend.app.modules.checkout.dto import (
    CheckoutPitchResponse,
    CheckoutVenueResponse,
)
from backend.app.modules.checkout.repository import CheckoutRepository
from backend.app.modules.checkout.service import (
    CHECKOUT_LOCK_DURATION_SECONDS,
    CheckoutService,
)
from backend.app.modules.orders.dto import (
    CreateOrderRequest,
    CreateOrderResult,
    OrderContactResponse,
    OrderDetailResponse,
    OrderListResponse,
    OrderPitchResponse,
    OrderSummaryResponse,
    OrderVenueResponse,
)
from backend.app.modules.orders.expiry import PendingOrderExpiryService
from backend.app.modules.orders.repository import OrderRepository
from backend.app.security.phone_vault import PhoneVault, PhoneVaultError, SealedPhone

CREATE_ORDER_OPERATION = "create_order"
ORDER_LIST_CURSOR_VERSION = 1
# Frozen from Node 22.22.3 `/^\p{Script=Han}$/u` (Unicode 17.0). The exhaustive
# cross-runtime parity test guards this table against frontend or backend drift.
_NODE22_UNICODE17_HAN_INTERVALS: tuple[tuple[int, int], ...] = (
    (0x2E80, 0x2E99),
    (0x2E9B, 0x2EF3),
    (0x2F00, 0x2FD5),
    (0x3005, 0x3005),
    (0x3007, 0x3007),
    (0x3021, 0x3029),
    (0x3038, 0x303B),
    (0x3400, 0x4DBF),
    (0x4E00, 0x9FFF),
    (0xF900, 0xFA6D),
    (0xFA70, 0xFAD9),
    (0x16FE2, 0x16FE3),
    (0x16FF0, 0x16FF6),
    (0x20000, 0x2A6DF),
    (0x2A700, 0x2B81D),
    (0x2B820, 0x2CEAD),
    (0x2CEB0, 0x2EBE0),
    (0x2EBF0, 0x2EE5D),
    (0x2F800, 0x2FA1D),
    (0x30000, 0x3134A),
    (0x31350, 0x33479),
)
_NODE22_UNICODE17_HAN_STARTS = tuple(
    start for start, _end in _NODE22_UNICODE17_HAN_INTERVALS
)


class OrderService:
    def __init__(
        self,
        *,
        repository: OrderRepository,
        phone_vault: PhoneVault | None,
        expiry_service: PendingOrderExpiryService | None = None,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self._repository = repository
        self._phone_vault = phone_vault
        self._expiry_service = expiry_service or PendingOrderExpiryService()
        self._now = now or (lambda: datetime.now(UTC))

    def create_order(
        self,
        *,
        user: User,
        idempotency_key: str,
        request: CreateOrderRequest,
    ) -> CreateOrderResult:
        try:
            normalized_contact = _normalize_contact_name(request.contact_name)
            request_sha256 = _request_sha256(
                slot_id=request.slot_id,
                checkout_version=request.checkout_version,
                contact_name=normalized_contact,
            )
            if (
                self._repository.get_slot_booking_mode(request.slot_id)
                is BookingMode.DIRECTORY_ONLY
            ):
                raise _venue_not_found()
            record, claimed = self._repository.claim_idempotency(
                user_id=user.id,
                operation=CREATE_ORDER_OPERATION,
                key=idempotency_key,
                request_sha256=request_sha256,
            )
            if not claimed:
                result = self._resolve_existing_claim(record, request_sha256)
                self._repository.commit()
                return result

            phone = self._verified_phone(user)
            slot = self._repository.get_slot_for_update(request.slot_id)
            if slot is None:
                raise _slot_not_available()
            now = self._now()

            existing_order = self._repository.get_effective_pending_order(
                user_id=user.id,
                slot_id=slot.id,
                now=now,
            )
            if existing_order is not None:
                if (
                    slot.status is not SlotStatus.LOCKED
                    or slot.locked_by_order_id != existing_order.id
                    or slot.locked_until is None
                    or slot.locked_until <= now
                ):
                    raise _slot_not_available()
                body = self._order_body(existing_order, slot)
                return self._complete(record, status_code=200, body=body)

            self._reconcile_stale_lock(slot, now)
            if slot.status is not SlotStatus.AVAILABLE or slot.starts_at <= now:
                raise _slot_not_available()
            if slot.checkout_version != request.checkout_version:
                current_checkout = CheckoutService(
                    repository=CheckoutRepository(self._repository.session),
                    phone_vault=self._phone_vault,
                ).build_available_response(slot, user, now)
                raise AppError(
                    409,
                    "PRICE_CHANGED",
                    "价格已变化，请重新确认",
                    details={
                        "current_checkout": current_checkout.model_dump(mode="json")
                    },
                )

            order_id = uuid.uuid4()
            sealed_phone = self._seal_order_phone(phone, order_id)
            expires_at = now + timedelta(seconds=CHECKOUT_LOCK_DURATION_SECONDS)
            order = Order(
                id=order_id,
                order_number=f"PB-{order_id.hex}",
                user_id=user.id,
                slot_id=slot.id,
                status=OrderStatus.PENDING_PAYMENT,
                price_cents=slot.price_cents,
                contact_name=normalized_contact,
                contact_phone_ciphertext=sealed_phone.ciphertext_with_tag,
                contact_phone_nonce=sealed_phone.nonce,
                contact_phone_key_version=sealed_phone.key_version,
                created_at=now,
                expires_at=expires_at,
                wechat_prepay_id=None,
            )
            self._repository.add_order(order)
            slot.status = SlotStatus.LOCKED
            slot.locked_until = expires_at
            slot.locked_by_order_id = order.id
            slot.checkout_version += 1
            user.last_contact_name = normalized_contact
            body = self._order_body(order, slot, known_phone=phone)
            return self._complete(record, status_code=201, body=body)
        except Exception:
            self._repository.rollback()
            raise

    def get_order_detail(
        self,
        *,
        user_id: uuid.UUID,
        order_id: uuid.UUID,
    ) -> OrderDetailResponse:
        order = self._repository.get_owned_order(order_id=order_id, user_id=user_id)
        if order is None:
            raise _order_not_found()

        now = self._now()
        closing_payment = False
        if order.status is OrderStatus.PENDING_PAYMENT and order.expires_at <= now:
            projected_payment = _project_payment(order.payments)
            if projected_payment is not None and projected_payment.status in {
                PaymentState.CREATING,
                PaymentState.PREPAY_CREATED,
                PaymentState.CONFIRMING,
                PaymentState.UNKNOWN,
            }:
                return self._order_response(order, order.slot, closing_payment=True)
            try:
                result = self._expiry_service.expire_by_order_id(
                    self._repository.session,
                    order.id,
                    now,
                )
                self._repository.flush()
                self._repository.commit()
                closing_payment = result.order_status is OrderStatus.PENDING_PAYMENT
            except Exception:
                self._repository.rollback()
                closing_payment = True

            order = self._repository.get_owned_order(
                order_id=order_id,
                user_id=user_id,
            )
            if order is None:
                raise _order_not_found()

        return self._order_response(
            order,
            order.slot,
            closing_payment=closing_payment,
        )

    def list_orders(
        self,
        *,
        user_id: uuid.UUID,
        limit: int,
        cursor: str | None,
    ) -> OrderListResponse:
        before_created_at, before_id = _decode_order_cursor(cursor)
        try:
            rows = self._repository.list_owned_orders(
                user_id=user_id,
                limit=limit + 1,
                before_created_at=before_created_at,
                before_id=before_id,
            )
            page = rows[:limit]
            now = self._now()
            summaries: list[OrderSummaryResponse] = []
            for order in page:
                closing_payment = False
                if (
                    order.status is OrderStatus.PENDING_PAYMENT
                    and order.expires_at <= now
                ):
                    result = self._expiry_service.expire_by_order_id(
                        self._repository.session,
                        order.id,
                        now,
                    )
                    closing_payment = (
                        result.order_status is OrderStatus.PENDING_PAYMENT
                    )
                summaries.append(
                    self._order_summary(
                        order,
                        order.slot,
                        now=now,
                        closing_payment=closing_payment,
                    )
                )

            next_cursor = (
                _encode_order_cursor(page[-1].created_at, page[-1].id)
                if len(rows) > limit
                else None
            )
            self._repository.flush()
            self._repository.commit()
            return OrderListResponse(orders=summaries, next_cursor=next_cursor)
        except SQLAlchemyError:
            with suppress(Exception):
                self._repository.rollback()
            raise _service_unavailable() from None

    def _resolve_existing_claim(
        self,
        record: IdempotencyRecord,
        request_sha256: str,
    ) -> CreateOrderResult:
        if record.request_sha256 != request_sha256:
            raise AppError(
                409,
                "IDEMPOTENCY_KEY_REUSED",
                "该幂等键已用于其他请求，请生成新键后重试。",
            )
        if record.state is not IdempotencyState.COMPLETED or record.response_body is None:
            raise RuntimeError("idempotency record is not replayable")
        if record.response_status == 200:
            status_code: Literal[200, 201] = 200
        elif record.response_status == 201:
            status_code = 201
        else:
            raise RuntimeError("idempotency record is not replayable")
        return CreateOrderResult(
            status_code=status_code,
            body=record.response_body,
        )

    def _complete(
        self,
        record: IdempotencyRecord,
        *,
        status_code: Literal[200, 201],
        body: dict[str, object],
    ) -> CreateOrderResult:
        result = CreateOrderResult(status_code=status_code, body=body)
        self._repository.complete_idempotency(
            record,
            response_status=status_code,
            response_body=body,
        )
        self._repository.commit()
        return result

    def _verified_phone(self, user: User) -> str:
        ciphertext = user.phone_ciphertext
        nonce = user.phone_nonce
        key_version = user.phone_key_version
        verified_at = user.phone_verified_at
        if ciphertext is None and nonce is None and key_version is None and verified_at is None:
            raise AppError(422, "PHONE_AUTH_REQUIRED", "请先授权微信手机号。")
        if (
            ciphertext is None
            or nonce is None
            or key_version is None
            or verified_at is None
            or self._phone_vault is None
        ):
            raise _internal_error()
        try:
            return self._phone_vault.decrypt(
                SealedPhone(ciphertext, nonce, key_version),
                record_type="user",
                record_id=user.id,
                field="phone",
            )
        except PhoneVaultError:
            raise _internal_error() from None

    def _seal_order_phone(self, phone: str, order_id: uuid.UUID) -> SealedPhone:
        if self._phone_vault is None:
            raise _internal_error()
        try:
            return self._phone_vault.encrypt(
                phone,
                record_type="order",
                record_id=order_id,
                field="contact_phone",
            )
        except PhoneVaultError:
            raise _internal_error() from None

    def _reconcile_stale_lock(self, slot: Slot, now: datetime) -> None:
        if slot.status is SlotStatus.LOCKED and slot.locked_by_order_id is not None:
            self._expiry_service.expire_with_locked_slot(
                self._repository.session,
                slot,
                slot.locked_by_order_id,
                now,
            )
            self._repository.flush()

    def _order_body(
        self,
        order: Order,
        slot: Slot,
        *,
        known_phone: str | None = None,
    ) -> dict[str, object]:
        return self._order_response(
            order,
            slot,
            known_phone=known_phone,
        ).model_dump(mode="json")

    def _order_response(
        self,
        order: Order,
        slot: Slot,
        *,
        known_phone: str | None = None,
        closing_payment: bool = False,
    ) -> OrderDetailResponse:
        phone = known_phone or self._order_phone(order)
        payment, payment_confirming, closing_payment = _project_payment_flags(
            order,
            now=self._now(),
            closing_payment=closing_payment,
        )
        payment_state = payment.status if payment is not None else None
        pitch = slot.pitch
        venue = pitch.venue
        timezone = ZoneInfo(cast(str, venue.timezone))
        return OrderDetailResponse(
            id=order.id,
            order_number=order.order_number,
            status=order.status,
            slot_id=slot.id,
            venue=OrderVenueResponse(
                id=venue.id,
                name=venue.name,
                address=venue.address,
                latitude=venue.latitude,
                longitude=venue.longitude,
            ),
            pitch=OrderPitchResponse(id=pitch.id, name=pitch.name),
            starts_at=slot.starts_at.astimezone(timezone),
            ends_at=slot.ends_at.astimezone(timezone),
            duration_minutes=int((slot.ends_at - slot.starts_at).total_seconds() // 60),
            price_cents=order.price_cents,
            currency="CNY",
            contact=OrderContactResponse(
                name=order.contact_name,
                masked_phone=PhoneVault.mask(phone),
            ),
            created_at=order.created_at.astimezone(timezone),
            expires_at=order.expires_at.astimezone(timezone),
            expired_at=(
                order.expired_at.astimezone(timezone)
                if order.expired_at is not None
                else None
            ),
            cancellation_summary=cast(str, venue.refund_policy_text),
            payment_state=payment_state,
            payment_confirming=payment_confirming,
            closing_payment=closing_payment,
            paid_at=(
                payment.paid_at
                if payment is not None and payment.status is PaymentState.SUCCESS
                else None
            ),
            detail_path=f"/api/v1/orders/{order.id}",
        )

    @staticmethod
    def _order_summary(
        order: Order,
        slot: Slot,
        *,
        now: datetime,
        closing_payment: bool,
    ) -> OrderSummaryResponse:
        _payment, payment_confirming, closing_payment = _project_payment_flags(
            order,
            now=now,
            closing_payment=closing_payment,
        )
        pitch = slot.pitch
        venue = pitch.venue
        timezone = ZoneInfo(cast(str, venue.timezone))
        return OrderSummaryResponse(
            id=order.id,
            order_number=order.order_number,
            status=order.status,
            venue=CheckoutVenueResponse(id=venue.id, name=venue.name),
            pitch=CheckoutPitchResponse(id=pitch.id, name=pitch.name),
            starts_at=slot.starts_at.astimezone(timezone),
            ends_at=slot.ends_at.astimezone(timezone),
            price_cents=order.price_cents,
            currency="CNY",
            created_at=order.created_at.astimezone(timezone),
            expires_at=order.expires_at.astimezone(timezone),
            payment_confirming=payment_confirming,
            closing_payment=closing_payment,
        )

    def _order_phone(self, order: Order) -> str:
        if self._phone_vault is None:
            raise _internal_error()
        try:
            return self._phone_vault.decrypt(
                SealedPhone(
                    order.contact_phone_ciphertext,
                    order.contact_phone_nonce,
                    order.contact_phone_key_version,
                ),
                record_type="order",
                record_id=order.id,
                field="contact_phone",
            )
        except PhoneVaultError:
            raise _internal_error() from None


def _project_payment(payments: list[Payment]) -> Payment | None:
    successes = [payment for payment in payments if payment.status is PaymentState.SUCCESS]
    if successes:
        return max(
            successes,
            key=lambda payment: (
                payment.paid_at or payment.created_at,
                payment.created_at,
                payment.id,
            ),
        )
    nonterminal = [
        payment
        for payment in payments
        if payment.status
        in {
            PaymentState.CREATING,
            PaymentState.PREPAY_CREATED,
            PaymentState.CONFIRMING,
            PaymentState.UNKNOWN,
        }
    ]
    candidates = nonterminal or payments
    return (
        max(candidates, key=lambda payment: (payment.created_at, payment.id))
        if candidates
        else None
    )


def _project_payment_flags(
    order: Order,
    *,
    now: datetime,
    closing_payment: bool,
) -> tuple[Payment | None, bool, bool]:
    payment = _project_payment(order.payments)
    payment_state = payment.status if payment is not None else None
    payment_confirming = bool(
        order.status is OrderStatus.PENDING_PAYMENT
        and payment_state in {PaymentState.CONFIRMING, PaymentState.UNKNOWN}
    )
    if (
        order.status is OrderStatus.PENDING_PAYMENT
        and order.expires_at <= now
        and payment_state
        in {
            PaymentState.CREATING,
            PaymentState.PREPAY_CREATED,
            PaymentState.CONFIRMING,
            PaymentState.UNKNOWN,
        }
    ):
        payment_confirming = True
        closing_payment = True
    return payment, payment_confirming, closing_payment


def _encode_order_cursor(created_at: datetime, order_id: uuid.UUID) -> str:
    payload = json.dumps(
        {
            "v": ORDER_LIST_CURSOR_VERSION,
            "created_at": created_at.astimezone(UTC).isoformat(),
            "id": str(order_id),
        },
        separators=(",", ":"),
    ).encode("utf-8")
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def _decode_order_cursor(
    cursor: str | None,
) -> tuple[datetime | None, uuid.UUID | None]:
    if cursor is None:
        return None, None
    try:
        padding = "=" * (-len(cursor) % 4)
        raw = base64.b64decode(
            cursor + padding,
            altchars=b"-_",
            validate=True,
        )
        payload = json.loads(raw)
        if not isinstance(payload, dict) or set(payload) != {"v", "created_at", "id"}:
            raise ValueError
        if (
            type(payload["v"]) is not int
            or payload["v"] != ORDER_LIST_CURSOR_VERSION
        ):
            raise ValueError
        created_at = datetime.fromisoformat(payload["created_at"])
        if created_at.tzinfo is None or created_at.utcoffset() is None:
            raise ValueError
        order_id = uuid.UUID(payload["id"])
    except (binascii.Error, json.JSONDecodeError, TypeError, ValueError):
        raise _invalid_cursor() from None
    return created_at, order_id


def _normalize_contact_name(value: str) -> str:
    normalized = value.strip()
    if not 2 <= len(normalized) <= 30 or not all(
        _is_allowed_contact_character(character) for character in normalized
    ):
        raise _invalid_contact()
    return normalized


def _is_allowed_contact_character(character: str) -> bool:
    if character in {" ", "·", "-"}:
        return True
    if character.isascii() and (character.isalpha() or character.isdigit()):
        return True
    return _is_han_character(character)


def _is_han_character(character: str) -> bool:
    """Match Node 22's frozen Unicode 17 Script=Han set without runtime Unicode drift."""

    if len(character) != 1:
        return False
    codepoint = ord(character)
    interval_index = bisect_right(_NODE22_UNICODE17_HAN_STARTS, codepoint) - 1
    return (
        interval_index >= 0
        and codepoint <= _NODE22_UNICODE17_HAN_INTERVALS[interval_index][1]
    )


def _invalid_contact() -> AppError:
    return AppError(
        422,
        "INVALID_CONTACT",
        "联系人姓名无效，请检查后重试。",
        details={"field": "contact_name"},
    )


def _request_sha256(
    *,
    slot_id: uuid.UUID,
    checkout_version: int,
    contact_name: str,
) -> str:
    canonical = json.dumps(
        {
            "checkout_version": checkout_version,
            "contact_name": contact_name,
            "slot_id": str(slot_id),
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _slot_not_available() -> AppError:
    return AppError(409, "SLOT_NOT_AVAILABLE", "该时段已不可预订，请返回刷新。")


def _venue_not_found() -> AppError:
    return AppError(404, "VENUE_NOT_FOUND", "场馆不存在")


def _order_not_found() -> AppError:
    return AppError(404, "ORDER_NOT_FOUND", "订单不存在。")


def _invalid_cursor() -> AppError:
    return AppError(422, "INVALID_ARGUMENT", "订单列表游标无效，请重新加载。")


def _service_unavailable() -> AppError:
    return AppError(503, "SERVICE_UNAVAILABLE", "订单服务暂不可用，请稍后重试。")


def _internal_error() -> AppError:
    return AppError(500, "INTERNAL_ERROR", "服务内部错误")
