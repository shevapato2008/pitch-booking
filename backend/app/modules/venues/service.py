import uuid
from collections.abc import Callable
from datetime import datetime, timedelta
from typing import NoReturn, Protocol, cast
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from backend.app.errors import AppError
from backend.app.models import (
    BookingMode,
    PitchType,
    Venue,
    VenueFacility,
    VenueImage,
)
from backend.app.modules.venues.dto import (
    AvailabilityWindowResponse,
    DirectoryVenueDetailResponse,
    OnlineVenueDetailResponse,
    PitchTypeResponse,
    PrimaryVenueResponse,
    PublicPitchTypeCode,
    VenueDetailResponse,
    VenueFacilityResponse,
    VenueImageResponse,
    VenueMapItemResponse,
    VenueMapResponse,
    VenueTransitResponse,
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
        price_advantage_text = venue.price_advantage_text
        timezone_name = venue.timezone
        business_hours_text = venue.business_hours_text
        parking_text = venue.parking_text
        phone = venue.phone
        refund_policy_text = venue.refund_policy_text
        if (
            price_advantage_text is None
            or timezone_name is None
            or business_hours_text is None
            or parking_text is None
            or phone is None
            or refund_policy_text is None
            or any(
                not value.strip()
                for value in (
                    venue.name,
                    price_advantage_text,
                    timezone_name,
                    business_hours_text,
                    venue.address,
                    parking_text,
                    phone,
                    refund_policy_text,
                )
            )
        ):
            self._misconfigured()
        try:
            timezone = ZoneInfo(timezone_name)
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
            price_advantage_text=price_advantage_text,
            timezone=timezone_name,
            business_hours_text=business_hours_text,
            address=venue.address,
            latitude=venue.latitude,
            longitude=venue.longitude,
            parking_text=parking_text,
            phone=phone,
            refund_policy_summary=refund_policy_text,
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
    def _misconfigured() -> NoReturn:
        raise AppError(
            500,
            "PRIMARY_VENUE_MISCONFIGURED",
            "主场馆配置暂不可用",
        )


class VenueDirectoryService:
    def __init__(
        self,
        repository: "VenueDirectoryRepository",
        now: Callable[[ZoneInfo], datetime] | None = None,
    ) -> None:
        self.repository = repository
        self.now = now or (lambda timezone: datetime.now(timezone))

    def get_map(self) -> VenueMapResponse:
        venues = self.repository.list_public()
        primaries = [venue for venue in venues if venue.is_primary]
        if (
            not venues
            or len(primaries) != 1
            or primaries[0].booking_mode is not BookingMode.ONLINE
        ):
            self._misconfigured()
        return VenueMapResponse(
            venues=[self._map_item(venue) for venue in venues]
        )

    def get_detail(self, venue_id: uuid.UUID) -> VenueDetailResponse:
        venue = self.repository.get_public(venue_id)
        if venue is None:
            raise AppError(404, "VENUE_NOT_FOUND", "场馆不存在")
        if venue.booking_mode is BookingMode.ONLINE:
            return self._online_detail(venue)
        return DirectoryVenueDetailResponse.model_validate(
            {
                **self._common_detail(venue),
                "booking_mode": "DIRECTORY_ONLY",
                "business_hours_text": venue.business_hours_text,
                "parking_text": venue.parking_text,
                "images": [image.url for image in self._images(venue)],
                "facilities": [
                    facility.name for facility in self._facilities(venue)
                ],
            }
        )

    def _map_item(self, venue: Venue) -> VenueMapItemResponse:
        return VenueMapItemResponse(
            id=venue.id,
            name=venue.name,
            address=venue.address,
            latitude=venue.latitude,
            longitude=venue.longitude,
            booking_mode=venue.booking_mode.value,
            pitch_types=self._public_pitch_types(venue.public_pitch_types),
            cover_image=self._cover_image(venue),
            nearest_transit=self._transit(venue),
            content_verified_at=venue.content_verified_at,
        )

    def _common_detail(self, venue: Venue) -> dict[str, object]:
        pitch_types = (
            self._online_pitch_types(venue)
            if venue.booking_mode is BookingMode.ONLINE
            else self._public_pitch_types(venue.public_pitch_types)
        )
        return {
            "id": venue.id,
            "slug": venue.slug,
            "name": venue.name,
            "description": venue.description,
            "address": venue.address,
            "latitude": venue.latitude,
            "longitude": venue.longitude,
            "coordinate_system": "GCJ02",
            "navigation_poi_name": venue.navigation_poi_name,
            "navigation_latitude": venue.navigation_latitude,
            "navigation_longitude": venue.navigation_longitude,
            "pitch_types": pitch_types,
            "cover_image": self._cover_image(venue),
            "nearest_transit": self._transit(venue),
            "content_verified_at": venue.content_verified_at,
        }

    def _online_detail(self, venue: Venue) -> OnlineVenueDetailResponse:
        price = venue.price_advantage_text
        timezone_name = venue.timezone
        hours = venue.business_hours_text
        parking = venue.parking_text
        phone = venue.phone
        refund = venue.refund_policy_text
        images = self._images(venue)
        facilities = self._facilities(venue)
        pitch_types = self._online_pitch_types(venue)
        if (
            price is None
            or timezone_name != "Asia/Shanghai"
            or hours is None
            or parking is None
            or phone is None
            or refund is None
            or not images
            or not facilities
            or not pitch_types
            or sum(image.role.value == "COVER" for image in images) != 1
        ):
            self._misconfigured()
        timezone = ZoneInfo(timezone_name)
        start_date = self.now(timezone).date()
        return OnlineVenueDetailResponse.model_validate(
            {
                **self._common_detail(venue),
                "booking_mode": "ONLINE",
                "price_advantage_text": price,
                "timezone": "Asia/Shanghai",
                "business_hours_text": hours,
                "parking_text": parking,
                "phone": phone,
                "refund_policy_summary": refund,
                "images": [
                    VenueImageResponse(
                        url=image.url,
                        alt=image.alt,
                        role=image.role.value,
                        sort_order=image.sort_order,
                    )
                    for image in images
                ],
                "facilities": [
                    VenueFacilityResponse(
                        code=facility.code.value,
                        name=facility.name,
                        sort_order=facility.sort_order,
                    )
                    for facility in facilities
                ],
                "availability_window": AvailabilityWindowResponse(
                    start_date=start_date,
                    end_date=start_date + timedelta(days=13),
                ),
            }
        )

    @staticmethod
    def _images(venue: Venue) -> list[VenueImage]:
        return sorted(venue.images, key=lambda item: (item.sort_order, item.id))

    @staticmethod
    def _facilities(venue: Venue) -> list[VenueFacility]:
        return sorted(venue.facilities, key=lambda item: (item.sort_order, item.id))

    @staticmethod
    def _online_pitch_types(venue: Venue) -> list[PublicPitchTypeCode]:
        return VenueDirectoryService._public_pitch_types(
            list(
            dict.fromkeys(
                pitch.pitch_type.value
                for pitch in sorted(
                    venue.pitches, key=lambda item: (item.sort_order, item.id)
                )
            )
            )
        )

    @staticmethod
    def _public_pitch_types(values: list[str]) -> list[PublicPitchTypeCode]:
        return cast(list[PublicPitchTypeCode], values)

    @staticmethod
    def _cover_image(venue: Venue) -> str | None:
        return next(
            (
                image.url
                for image in sorted(
                    venue.images, key=lambda item: (item.sort_order, item.id)
                )
                if image.role.value == "COVER"
            ),
            None,
        )

    @staticmethod
    def _transit(venue: Venue) -> list[VenueTransitResponse]:
        return [
            VenueTransitResponse(
                kind=stop.kind.value,
                name=stop.name,
                lines=stop.lines,
                distance_meters=stop.distance_meters,
                distance_basis=stop.distance_basis.value,
            )
            for stop in sorted(
                venue.transit_stops, key=lambda item: (item.sort_order, item.id)
            )
        ]

    @staticmethod
    def _misconfigured() -> NoReturn:
        raise AppError(
            500,
            "VENUE_DIRECTORY_MISCONFIGURED",
            "场馆目录暂不可用",
        )


class VenueDirectoryRepository(Protocol):
    def list_public(self) -> list[Venue]: ...

    def get_public(self, venue_id: uuid.UUID) -> Venue | None: ...
