from collections.abc import Callable
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from backend.app.errors import AppError
from backend.app.models import PitchType
from backend.app.modules.venues.dto import (
    AvailabilityWindowResponse,
    PitchTypeResponse,
    PrimaryVenueResponse,
    VenueFacilityResponse,
    VenueImageResponse,
)
from backend.app.modules.venues.repository import VenueRepository

PITCH_TYPE_NAMES = {
    PitchType.FIVE_A_SIDE: "五人制",
    PitchType.SEVEN_A_SIDE: "七人制",
}


class PrimaryVenueService:
    def __init__(
        self,
        repository: VenueRepository,
        now: Callable[[ZoneInfo], datetime] | None = None,
    ) -> None:
        self.repository = repository
        self.now = now or (lambda timezone: datetime.now(timezone))

    def get_primary(self) -> PrimaryVenueResponse:
        venues = self.repository.list_active_primaries()
        if len(venues) != 1:
            self._misconfigured()
        venue = venues[0]

        images = sorted(venue.images, key=lambda item: (item.sort_order, item.id))
        facilities = sorted(venue.facilities, key=lambda item: (item.sort_order, item.id))
        pitches = sorted(venue.pitches, key=lambda item: (item.sort_order, item.id))
        if sum(image.role.value == "COVER" for image in images) != 1:
            self._misconfigured()
        if not facilities or not pitches:
            self._misconfigured()
        required_text = (
            venue.name,
            venue.price_advantage_text,
            venue.timezone,
            venue.business_hours_text,
            venue.address,
            venue.parking_text,
            venue.phone,
            venue.refund_policy_text,
        )
        if any(not value.strip() for value in required_text):
            self._misconfigured()
        try:
            timezone = ZoneInfo(venue.timezone)
        except ZoneInfoNotFoundError:
            self._misconfigured()

        generated_at = self.now(timezone)
        start_date = generated_at.date()
        pitch_types: list[PitchTypeResponse] = []
        seen_types: set[PitchType] = set()
        for pitch in pitches:
            if pitch.pitch_type in seen_types:
                continue
            seen_types.add(pitch.pitch_type)
            pitch_types.append(
                PitchTypeResponse(
                    code=pitch.pitch_type.value,
                    name=PITCH_TYPE_NAMES[pitch.pitch_type],
                    sort_order=pitch.sort_order,
                )
            )

        return PrimaryVenueResponse(
            id=venue.id,
            name=venue.name,
            description=venue.description,
            price_advantage_text=venue.price_advantage_text,
            timezone=venue.timezone,
            business_hours_text=venue.business_hours_text,
            address=venue.address,
            latitude=venue.latitude,
            longitude=venue.longitude,
            parking_text=venue.parking_text,
            phone=venue.phone,
            refund_policy_summary=venue.refund_policy_text,
            images=[
                VenueImageResponse(
                    url=image.url,
                    alt=image.alt,
                    role=image.role.value,
                    sort_order=image.sort_order,
                )
                for image in images
            ],
            facilities=[
                VenueFacilityResponse(
                    code=facility.code.value,
                    name=facility.name,
                    sort_order=facility.sort_order,
                )
                for facility in facilities
            ],
            pitch_types=pitch_types,
            availability_window=AvailabilityWindowResponse(
                start_date=start_date,
                end_date=start_date + timedelta(days=13),
            ),
            generated_at=generated_at,
        )

    @staticmethod
    def _misconfigured() -> None:
        raise AppError(
            500,
            "PRIMARY_VENUE_MISCONFIGURED",
            "主场馆配置暂不可用",
        )
