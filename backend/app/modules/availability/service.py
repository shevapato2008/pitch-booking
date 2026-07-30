import uuid
from collections import defaultdict
from collections.abc import Callable
from datetime import UTC, date, datetime, time, timedelta
from typing import cast
from zoneinfo import ZoneInfo

from backend.app.errors import AppError
from backend.app.models import PitchType, Slot, SlotStatus
from backend.app.modules.availability.dto import (
    AvailabilityResponse,
    PitchAvailabilityResponse,
    SlotResponse,
)
from backend.app.modules.availability.projection import project_status
from backend.app.modules.availability.repository import AvailabilityRepository
from backend.app.modules.orders.expiry import PendingOrderExpiryService
from backend.app.modules.venues.dto import AvailabilityWindowResponse


class AvailabilityService:
    def __init__(
        self,
        repository: AvailabilityRepository,
        now: Callable[[ZoneInfo], datetime] | None = None,
        expiry_service: PendingOrderExpiryService | None = None,
    ) -> None:
        self.repository = repository
        self.now = now or (lambda timezone: datetime.now(timezone))
        self.expiry_service = expiry_service or PendingOrderExpiryService()

    def get_availability(
        self, venue_id: uuid.UUID, date_text: str, pitch_type_text: str
    ) -> AvailabilityResponse:
        try:
            requested_date = date.fromisoformat(date_text)
        except ValueError:
            raise AppError(422, "INVALID_ARGUMENT", "日期格式无效") from None
        try:
            pitch_type = PitchType(pitch_type_text)
        except ValueError:
            raise AppError(422, "INVALID_ARGUMENT", "场地类型无效") from None

        venue = self.repository.get_active_venue(venue_id)
        if venue is None:
            raise AppError(404, "VENUE_NOT_FOUND", "场馆不存在")
        timezone_name = cast(str, venue.timezone)
        timezone = ZoneInfo(timezone_name)
        generated_at = self.now(timezone)
        window_start = generated_at.date()
        window_end = window_start + timedelta(days=13)
        if requested_date < window_start or requested_date > window_end:
            raise AppError(
                422,
                "DATE_OUT_OF_RANGE",
                "所选日期不在可查询范围内",
                {"start_date": str(window_start), "end_date": str(window_end)},
            )

        pitches = self.repository.list_pitches(venue_id, pitch_type)
        if not pitches:
            raise AppError(422, "PITCH_TYPE_NOT_SUPPORTED", "场馆不支持该场地类型")

        local_start = datetime.combine(requested_date, time.min, timezone)
        local_end = local_start + timedelta(days=1)
        slots = self.repository.list_slots(
            [pitch.id for pitch in pitches],
            local_start.astimezone(UTC),
            local_end.astimezone(UTC),
        )
        candidate_order_ids = [
            slot.locked_by_order_id
            for slot in slots
            if slot.status is SlotStatus.LOCKED
            and slot.locked_until is not None
            and slot.locked_until <= generated_at
            and slot.locked_by_order_id is not None
        ]
        try:
            if candidate_order_ids:
                for order_id in candidate_order_ids:
                    self.expiry_service.expire_by_order_id(
                        self.repository.session,
                        order_id,
                        generated_at,
                    )
                self.repository.session.flush()
                self.repository.session.expire_all()
                slots = self.repository.list_slots(
                    [pitch.id for pitch in pitches],
                    local_start.astimezone(UTC),
                    local_end.astimezone(UTC),
                )

            slots_by_pitch: dict[uuid.UUID, list[Slot]] = defaultdict(list)
            for slot in slots:
                slots_by_pitch[slot.pitch_id].append(slot)

            pitch_responses: list[PitchAvailabilityResponse] = []
            for pitch in pitches:
                pitch_slots = slots_by_pitch[pitch.id]
                if not pitch_slots:
                    continue
                pitch_responses.append(
                    PitchAvailabilityResponse(
                        id=pitch.id,
                        name=pitch.name,
                        pitch_type=pitch.pitch_type.value,
                        sort_order=pitch.sort_order,
                        slots=[
                            self._slot_response(slot, generated_at, timezone)
                            for slot in pitch_slots
                        ],
                    )
                )

            response = AvailabilityResponse(
                venue_id=venue.id,
                timezone=timezone_name,
                date=requested_date,
                pitch_type=pitch_type.value,
                availability_window=AvailabilityWindowResponse(
                    start_date=window_start, end_date=window_end
                ),
                pitches=pitch_responses,
                generated_at=generated_at,
            )
            if candidate_order_ids:
                self.repository.session.commit()
            return response
        except Exception:
            if candidate_order_ids:
                self.repository.session.rollback()
            raise

    @staticmethod
    def _slot_response(slot: Slot, now: datetime, timezone: ZoneInfo) -> SlotResponse:
        status, reason = project_status(slot.status, slot.starts_at, now)
        return SlotResponse(
            id=slot.id,
            starts_at=slot.starts_at.astimezone(timezone),
            ends_at=slot.ends_at.astimezone(timezone),
            price_cents=slot.price_cents,
            status=status,
            unavailable_reason=reason,
        )
