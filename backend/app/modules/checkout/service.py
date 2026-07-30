import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from typing import cast
from zoneinfo import ZoneInfo

from backend.app.errors import AppError
from backend.app.models import BookingMode, Slot, SlotStatus, User
from backend.app.modules.checkout.dto import (
    CheckoutContactResponse,
    CheckoutPitchResponse,
    CheckoutResponse,
    CheckoutVenueResponse,
)
from backend.app.modules.checkout.repository import CheckoutRepository
from backend.app.modules.orders.expiry import PendingOrderExpiryService
from backend.app.security.phone_vault import PhoneVault, PhoneVaultError, SealedPhone

CHECKOUT_LOCK_DURATION_SECONDS = 600


class CheckoutService:
    def __init__(
        self,
        *,
        repository: CheckoutRepository,
        phone_vault: PhoneVault | None,
        expiry_service: PendingOrderExpiryService | None = None,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self._repository = repository
        self._phone_vault = phone_vault
        self._expiry_service = expiry_service or PendingOrderExpiryService()
        self._now = now or (lambda: datetime.now(UTC))

    def get_checkout(self, slot_id: uuid.UUID, user: User) -> CheckoutResponse:
        now = self._now()
        slot = self._repository.get_slot(slot_id)
        if slot is None:
            raise _slot_not_available()
        if slot.pitch.venue.booking_mode is not BookingMode.ONLINE:
            raise _venue_not_found()

        candidate_order_ids = self._candidate_order_ids(slot, now)
        if not candidate_order_ids:
            return self.build_available_response(slot, user, now)

        try:
            for order_id in candidate_order_ids:
                self._expiry_service.expire_by_order_id(
                    self._repository.session,
                    order_id,
                    now,
                )
            self._repository.flush()
            slot = self._repository.get_slot(slot_id, populate_existing=True)
            if slot is None:
                raise _slot_not_available()
            response = self.build_available_response(slot, user, now)
            self._repository.commit()
            return response
        except Exception:
            self._repository.rollback()
            raise

    @staticmethod
    def _candidate_order_ids(slot: Slot, now: datetime) -> list[uuid.UUID]:
        if (
            slot.status is SlotStatus.LOCKED
            and slot.locked_until is not None
            and slot.locked_until <= now
            and slot.locked_by_order_id is not None
        ):
            return [slot.locked_by_order_id]
        return []

    def build_available_response(
        self,
        slot: Slot,
        user: User,
        now: datetime,
    ) -> CheckoutResponse:
        if slot.status is not SlotStatus.AVAILABLE or slot.starts_at <= now:
            raise _slot_not_available()

        pitch = slot.pitch
        venue = pitch.venue
        timezone = ZoneInfo(cast(str, venue.timezone))
        starts_at = slot.starts_at.astimezone(timezone)
        ends_at = slot.ends_at.astimezone(timezone)
        return CheckoutResponse(
            slot_id=slot.id,
            venue=CheckoutVenueResponse(id=venue.id, name=venue.name),
            pitch=CheckoutPitchResponse(id=pitch.id, name=pitch.name),
            date=starts_at.date(),
            starts_at=starts_at,
            ends_at=ends_at,
            duration_minutes=int((slot.ends_at - slot.starts_at).total_seconds() // 60),
            price_cents=slot.price_cents,
            currency="CNY",
            available=True,
            cancellation_summary=cast(str, venue.refund_policy_text),
            lock_duration_seconds=CHECKOUT_LOCK_DURATION_SECONDS,
            contact=self._contact(user),
            checkout_version=slot.checkout_version,
        )

    def _contact(self, user: User) -> CheckoutContactResponse:
        ciphertext = user.phone_ciphertext
        nonce = user.phone_nonce
        key_version = user.phone_key_version
        verified_at = user.phone_verified_at
        if ciphertext is None and nonce is None and key_version is None and verified_at is None:
            masked_phone = None
        elif (
            ciphertext is None
            or nonce is None
            or key_version is None
            or verified_at is None
            or self._phone_vault is None
        ):
            raise _internal_error()
        else:
            try:
                phone = self._phone_vault.decrypt(
                    SealedPhone(ciphertext, nonce, key_version),
                    record_type="user",
                    record_id=user.id,
                    field="phone",
                )
                masked_phone = PhoneVault.mask(phone)
            except PhoneVaultError:
                raise _internal_error() from None
        return CheckoutContactResponse(
            masked_phone=masked_phone,
            last_contact_name=user.last_contact_name or None,
        )


def _slot_not_available() -> AppError:
    return AppError(409, "SLOT_NOT_AVAILABLE", "所选时段已不可预订，请重新选择。")


def _venue_not_found() -> AppError:
    return AppError(404, "VENUE_NOT_FOUND", "场馆不存在")


def _internal_error() -> AppError:
    return AppError(500, "INTERNAL_ERROR", "服务内部错误")
