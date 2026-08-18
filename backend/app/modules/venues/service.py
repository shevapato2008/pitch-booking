import uuid
from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Any, NoReturn, Protocol, cast
from zoneinfo import ZoneInfo

from backend.app.errors import AppError
from backend.app.models import (
    BookingMode,
    Pitch,
    PitchStatus,
    PitchType,
    Venue,
)
from backend.app.modules.venue_profiles.dto import (
    AvailabilityTargetResponse,
    LivePriceResponse,
    PublishedFacilityResponse,
    PublishedImageResponse,
    PublishedProfileResponse,
)
from backend.app.modules.venues.dto import (
    AvailabilityWindowResponse,
    DirectoryVenueDetailResponse,
    OnlineVenueDetailResponse,
    PitchTypeResponse,
    PrimaryVenueResponse,
    PublicPitchTypeCode,
    VenueDetailResponse,
    VenueMapItemResponse,
    VenueMapResponse,
    VenueTransitResponse,
)
from backend.app.modules.venues.repository import VenueRepository

PITCH_TYPE_NAMES = {
    PitchType.FIVE_A_SIDE: "五人制",
    PitchType.SEVEN_A_SIDE: "七人制",
}


def _published_profile(
    venue: Venue,
    pitch_sizes: list[PublicPitchTypeCode],
    minimum_price: int | None,
    *,
    availability_enabled: bool,
) -> PublishedProfileResponse:
    images = sorted(venue.images, key=lambda item: (item.sort_order, item.id))
    facilities = sorted(
        venue.facilities, key=lambda item: (item.sort_order, item.id)
    )
    return PublishedProfileResponse(
        publication_state="PUBLISHED",
        published_version=venue.profile_version,
        description=venue.description,
        cover_image=next(
            (image.url for image in images if image.role.value == "COVER"), None
        ),
        images=[
            PublishedImageResponse(
                url=image.url,
                alt=image.alt,
                role=image.role.value,
                sort_order=image.sort_order,
            )
            for image in images
        ],
        facilities=[
            PublishedFacilityResponse(
                code=facility.code.value,
                name=facility.name,
                sort_order=facility.sort_order,
            )
            for facility in facilities
        ],
        pitch_sizes=pitch_sizes,
        live_price=LivePriceResponse(
            available=minimum_price is not None,
            from_price_cents=minimum_price,
            currency="CNY",
            unit="HOUR",
        ),
        availability_target=AvailabilityTargetResponse(
            enabled=availability_enabled,
            label="查看可订时段",
            path=(
                f"/api/v1/venues/{venue.id}/availability"
                if availability_enabled
                else None
            ),
        ),
    )


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

        pitches = self._active_pitches(venue)
        if not pitches:
            self._misconfigured()
        price_advantage_text = venue.price_advantage_text
        timezone_name = venue.timezone
        business_hours_text = venue.business_hours_text
        parking_text = venue.parking_text
        refund_policy_text = venue.refund_policy_text
        if (
            price_advantage_text is None
            or timezone_name != "Asia/Shanghai"
            or business_hours_text is None
            or parking_text is None
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
                    refund_policy_text,
                )
            )
        ):
            self._misconfigured()
        timezone = ZoneInfo(timezone_name)

        generated_at = self.now(timezone)
        start_date = generated_at.date()
        pitch_types: list[PitchTypeResponse] = []
        seen_types: set[PitchType] = set()
        for pitch in pitches:
            pitch_type = cast(PitchType, pitch.pitch_type)
            if pitch_type in seen_types:
                continue
            seen_types.add(pitch_type)
            pitch_types.append(
                PitchTypeResponse(
                    code=cast(Any, pitch_type.value),
                    name=PITCH_TYPE_NAMES[pitch_type],
                    sort_order=pitch.sort_order,
                )
            )

        return PrimaryVenueResponse(
            id=venue.id,
            name=venue.name,
            profile=_published_profile(
                venue,
                [item.code for item in pitch_types],
                self.repository.minimum_available_price(venue.id, generated_at),
                availability_enabled=True,
            ),
            price_advantage_text=price_advantage_text,
            timezone="Asia/Shanghai",
            business_hours_text=business_hours_text,
            address=venue.address,
            latitude=venue.latitude,
            longitude=venue.longitude,
            parking_text=parking_text,
            refund_policy_summary=refund_policy_text,
            pitch_types=pitch_types,
            availability_window=AvailabilityWindowResponse(
                start_date=start_date,
                end_date=start_date + timedelta(days=13),
            ),
            generated_at=generated_at,
        )

    @staticmethod
    def _active_pitches(venue: Venue) -> list[Pitch]:
        return sorted(
            (
                pitch
                for pitch in venue.pitches
                if pitch.status is PitchStatus.ACTIVE
                and pitch.pitch_type in PITCH_TYPE_NAMES
            ),
            key=lambda item: (item.sort_order, item.id),
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
            coordinate_system="GCJ02",
            venues=[self._map_item(venue) for venue in venues]
        )

    def get_detail(self, venue_id: uuid.UUID) -> VenueDetailResponse:
        venue = self.repository.get_public(venue_id)
        if venue is None:
            raise AppError(404, "VENUE_NOT_FOUND", "场馆不存在")
        if venue.booking_mode is BookingMode.ONLINE:
            return self._online_detail(venue)
        pitch_types = self._public_pitch_types(venue.public_pitch_types)
        return DirectoryVenueDetailResponse.model_validate(
            {
                **self._common_detail(
                    venue,
                    pitch_types,
                    _published_profile(
                        venue,
                        pitch_types,
                        None,
                        availability_enabled=False,
                    ),
                ),
                "booking_mode": "DIRECTORY_ONLY",
                "business_hours_text": venue.business_hours_text,
                "parking_text": venue.parking_text,
            }
        )

    def _map_item(self, venue: Venue) -> VenueMapItemResponse:
        return VenueMapItemResponse(
            id=venue.id,
            name=venue.name,
            address=venue.address,
            district_code=venue.district_code,
            district_name=venue.district_name,
            latitude=venue.latitude,
            longitude=venue.longitude,
            booking_mode=venue.booking_mode.value,
            pitch_types=self._public_pitch_types(venue.public_pitch_types),
            cover_image=self._cover_image(venue),
            nearest_transit=self._transit(venue),
            content_verified_at=venue.content_verified_at,
        )

    def _common_detail(
        self,
        venue: Venue,
        pitch_types: list[PublicPitchTypeCode],
        profile: PublishedProfileResponse,
    ) -> dict[str, object]:
        return {
            "id": venue.id,
            "slug": venue.slug,
            "name": venue.name,
            "profile": profile,
            "address": venue.address,
            "latitude": venue.latitude,
            "longitude": venue.longitude,
            "coordinate_system": "GCJ02",
            "navigation_poi_name": venue.navigation_poi_name,
            "navigation_latitude": venue.navigation_latitude,
            "navigation_longitude": venue.navigation_longitude,
            "pitch_types": pitch_types,
            "nearest_transit": self._transit(venue),
            "content_verified_at": venue.content_verified_at,
        }

    def _online_detail(self, venue: Venue) -> OnlineVenueDetailResponse:
        price = venue.price_advantage_text
        timezone_name = venue.timezone
        hours = venue.business_hours_text
        parking = venue.parking_text
        refund = venue.refund_policy_text
        pitch_types = self._online_pitch_types(venue)
        if (
            price is None
            or timezone_name != "Asia/Shanghai"
            or hours is None
            or parking is None
            or refund is None
            or not pitch_types
        ):
            self._misconfigured()
        timezone = ZoneInfo(timezone_name)
        generated_at = self.now(timezone)
        start_date = generated_at.date()
        profile = _published_profile(
            venue,
            pitch_types,
            self.repository.minimum_available_price(venue.id, generated_at),
            availability_enabled=True,
        )
        return OnlineVenueDetailResponse.model_validate(
            {
                **self._common_detail(venue, pitch_types, profile),
                "booking_mode": "ONLINE",
                "price_advantage_text": price,
                "timezone": "Asia/Shanghai",
                "business_hours_text": hours,
                "parking_text": parking,
                "refund_policy_summary": refund,
                "availability_window": AvailabilityWindowResponse(
                    start_date=start_date,
                    end_date=start_date + timedelta(days=13),
                ),
            }
        )

    @staticmethod
    def _online_pitch_types(venue: Venue) -> list[PublicPitchTypeCode]:
        return VenueDirectoryService._public_pitch_types(
            list(
                dict.fromkeys(
                    pitch.pitch_type.value
                    for pitch in sorted(
                        venue.pitches, key=lambda item: (item.sort_order, item.id)
                    )
                    if pitch.status is PitchStatus.ACTIVE
                    and pitch.pitch_type in PITCH_TYPE_NAMES
                )
            )
        )

    @staticmethod
    def _public_pitch_types(values: list[str]) -> list[PublicPitchTypeCode]:
        supported = {"FIVE_A_SIDE", "SEVEN_A_SIDE", "ELEVEN_A_SIDE"}
        return cast(
            list[PublicPitchTypeCode],
            list(dict.fromkeys(value for value in values if value in supported)),
        )

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

    def minimum_available_price(
        self, venue_id: uuid.UUID, now: datetime
    ) -> int | None: ...
