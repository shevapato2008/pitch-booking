import hashlib
import json
import uuid
from collections.abc import Callable
from datetime import UTC, date, datetime, time, timedelta
from typing import Literal, cast
from zoneinfo import ZoneInfo

from sqlalchemy.exc import IntegrityError

from backend.app.errors import AppError
from backend.app.models import IdempotencyState, Pitch, PitchType, Slot, SlotStatus, User, Venue
from backend.app.modules.inventory.dto import (
    CreateInventorySlotRequest,
    InventoryPitchResponse,
    InventoryResponse,
    InventorySlotResponse,
    InventoryVenueResponse,
    InventoryWindowResponse,
    UpdateInventorySlotRequest,
)
from backend.app.modules.inventory.repository import InventoryRepository


class InventoryService:
    def __init__(
        self,
        repository: InventoryRepository,
        now: Callable[[ZoneInfo], datetime] | None = None,
    ) -> None:
        self.repository = repository
        self.now = now or (lambda timezone: datetime.now(timezone))

    def get_inventory(
        self,
        *,
        venue_id: uuid.UUID,
        user: User,
        local_date: date,
        pitch_id: uuid.UUID | None,
    ) -> InventoryResponse:
        venue = self._authorized_venue(venue_id, user.id)
        timezone = ZoneInfo(cast(str, venue.timezone))
        generated_at = self.now(timezone)
        window = self._validate_window(local_date, generated_at.date())
        pitches = self.repository.list_pitches(venue.id)
        if not pitches:
            raise AppError(404, "PITCH_NOT_FOUND", "场地不存在")
        selected = pitches[0] if pitch_id is None else self.repository.get_pitch(venue.id, pitch_id)
        if selected is None:
            raise AppError(404, "PITCH_NOT_FOUND", "场地不存在")
        local_start = datetime.combine(local_date, time.min, timezone)
        local_end = local_start + timedelta(days=1)
        slots = self.repository.list_slots(
            selected.id,
            local_start.astimezone(UTC),
            local_end.astimezone(UTC),
        )
        return InventoryResponse(
            venue=InventoryVenueResponse(
                id=venue.id, name=venue.name, timezone=cast(str, venue.timezone)
            ),
            local_date=local_date,
            availability_window=window,
            pitches=[self._pitch_response(pitch) for pitch in pitches],
            selected_pitch_id=selected.id,
            slots=[self._slot_response(slot, generated_at, timezone) for slot in slots],
            generated_at=generated_at,
        )

    def create_slot(
        self,
        *,
        venue_id: uuid.UUID,
        user: User,
        request: CreateInventorySlotRequest,
        idempotency_key: str,
    ) -> InventorySlotResponse:
        venue = self._authorized_venue(venue_id, user.id)
        timezone = ZoneInfo(cast(str, venue.timezone))
        now = self.now(timezone)
        self._validate_window(request.local_date, now.date())
        pitch = self.repository.get_pitch(venue.id, request.pitch_id)
        if pitch is None:
            raise AppError(404, "PITCH_NOT_FOUND", "场地不存在")
        start_time = self._parse_half_hour(request.start_time)
        end_time = self._parse_half_hour(request.end_time)
        starts_at = datetime.combine(request.local_date, start_time, timezone)
        ends_at = datetime.combine(request.local_date, end_time, timezone)
        if ends_at <= starts_at or starts_at <= now:
            raise AppError(422, "INVALID_ARGUMENT", "时段必须是未来的有效时间")
        request_sha256 = self._create_request_hash(venue.id, request)
        try:
            record, claimed = self.repository.claim_idempotency(
                user=user, key=idempotency_key, request_sha256=request_sha256
            )
            if not claimed:
                if record.request_sha256 != request_sha256:
                    raise AppError(
                        409,
                        "IDEMPOTENCY_KEY_REUSED",
                        "幂等键已用于其他请求",
                    )
                if (
                    record.state is not IdempotencyState.COMPLETED
                    or record.response_body is None
                ):
                    raise AppError(409, "REQUEST_IN_PROGRESS", "请求正在处理中")
                return InventorySlotResponse.model_validate(record.response_body)

            slot = Slot(
                pitch_id=pitch.id,
                starts_at=starts_at.astimezone(UTC),
                ends_at=ends_at.astimezone(UTC),
                status=SlotStatus.AVAILABLE,
                price_cents=request.price_cents,
                checkout_version=1,
            )
            self.repository.add_slot(slot)
            response = self._slot_response(slot, now, timezone)
            self.repository.complete_idempotency(
                record, cast(dict[str, object], response.model_dump(mode="json"))
            )
            self.repository.commit()
            return response
        except IntegrityError:
            self.repository.rollback()
            raise AppError(409, "SLOT_TIME_CONFLICT", "该时间与已有时段冲突") from None
        except Exception:
            self.repository.rollback()
            raise

    def update_slot(
        self,
        *,
        venue_id: uuid.UUID,
        slot_id: uuid.UUID,
        user: User,
        request: UpdateInventorySlotRequest,
    ) -> InventorySlotResponse:
        venue = self._authorized_venue(venue_id, user.id)
        timezone = ZoneInfo(cast(str, venue.timezone))
        now = self.now(timezone)
        try:
            slot = self.repository.get_slot_for_update(venue.id, slot_id)
            if slot is None:
                raise AppError(404, "SLOT_NOT_FOUND", "时段不存在")
            if slot.checkout_version != request.expected_checkout_version:
                raise AppError(409, "INVENTORY_VERSION_CONFLICT", "时段已更新，请刷新后重试")
            if slot.status in (SlotStatus.LOCKED, SlotStatus.BOOKED) or slot.starts_at <= now:
                raise AppError(409, "INVENTORY_SLOT_READ_ONLY", "该时段当前不可修改")
            slot.price_cents = request.price_cents
            slot.status = SlotStatus(request.status)
            slot.checkout_version += 1
            self.repository.commit()
            return self._slot_response(slot, now, timezone)
        except Exception:
            self.repository.rollback()
            raise

    def _authorized_venue(self, venue_id: uuid.UUID, user_id: uuid.UUID) -> Venue:
        venue = self.repository.get_venue(venue_id)
        if venue is None:
            raise AppError(404, "VENUE_NOT_FOUND", "场馆不存在")
        if not self.repository.can_manage_inventory(venue_id, user_id):
            raise AppError(403, "INVENTORY_FORBIDDEN", "无权管理该场馆库存")
        if venue.timezone is None:
            raise AppError(500, "INTERNAL_ERROR", "服务内部错误")
        return venue

    @staticmethod
    def _validate_window(local_date: date, today: date) -> InventoryWindowResponse:
        end_date = today + timedelta(days=13)
        if local_date < today or local_date > end_date:
            raise AppError(
                422,
                "DATE_OUT_OF_RANGE",
                "所选日期不在可管理范围内",
                {"start_date": str(today), "end_date": str(end_date)},
            )
        return InventoryWindowResponse(start_date=today, end_date=end_date)

    @staticmethod
    def _parse_half_hour(value: str) -> time:
        try:
            parsed = time.fromisoformat(value)
        except ValueError:
            raise AppError(422, "INVALID_ARGUMENT", "时间格式无效") from None
        if parsed.second != 0 or parsed.microsecond != 0 or parsed.minute not in (0, 30):
            raise AppError(422, "INVALID_ARGUMENT", "时间必须按 30 分钟递增")
        return parsed

    @staticmethod
    def _pitch_response(pitch: Pitch) -> InventoryPitchResponse:
        players: Literal[5, 7] = (
            5 if pitch.pitch_type is PitchType.FIVE_A_SIDE else 7
        )
        return InventoryPitchResponse(
            id=pitch.id,
            name=pitch.name,
            display_name=pitch.name,
            pitch_type=pitch.pitch_type.value,
            players_per_side=players,
        )

    @staticmethod
    def _slot_response(
        slot: Slot, now: datetime, timezone: ZoneInfo
    ) -> InventorySlotResponse:
        local_start = slot.starts_at.astimezone(timezone)
        local_end = slot.ends_at.astimezone(timezone)
        if slot.starts_at <= now:
            reason: Literal[
                "HELD_FOR_PAYMENT", "ALREADY_BOOKED", "TIME_PASSED"
            ] | None = "TIME_PASSED"
        elif slot.status is SlotStatus.LOCKED:
            reason = "HELD_FOR_PAYMENT"
        elif slot.status is SlotStatus.BOOKED:
            reason = "ALREADY_BOOKED"
        else:
            reason = None
        return InventorySlotResponse(
            id=slot.id,
            pitch_id=slot.pitch_id,
            starts_at=local_start,
            ends_at=local_end,
            start_time=local_start.strftime("%H:%M"),
            end_time=local_end.strftime("%H:%M"),
            price_cents=slot.price_cents,
            status=slot.status.value,
            checkout_version=slot.checkout_version,
            editable=reason is None,
            read_only_reason=reason,
        )

    @staticmethod
    def _create_request_hash(
        venue_id: uuid.UUID, request: CreateInventorySlotRequest
    ) -> str:
        body = {"venue_id": str(venue_id), **request.model_dump(mode="json")}
        canonical = json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
