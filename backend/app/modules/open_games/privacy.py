"""Small, explicit privacy boundary for public open-game data."""

import re
from collections.abc import Iterable
from datetime import datetime
from typing import TYPE_CHECKING

from backend.app.models import (
    ImageRole,
    OpenGameIntensity,
    OpenGameVisibility,
    VenueImage,
)
from backend.app.modules.open_games.lifecycle import (
    EffectiveOpenGameState,
    OpenGamePublicStateReason,
    OpenGameStateReason,
)

if TYPE_CHECKING:
    from backend.app.modules.open_games.dto import OpenGamePosition, OpenGamePublic


PUBLIC_OPEN_GAME_FIELDS = frozenset(
    {
        "name",
        "team_name",
        "state",
        "state_reason",
        "venue_name",
        "pitch_name",
        "pitch_specification",
        "starts_at",
        "ends_at",
        "time_zone",
        "total_players",
        "fixed_players",
        "open_spots",
        "intensity",
        "minimum_experience",
        "positions",
        "aa_cents",
        "registration_deadline",
        "equipment_and_arrival_notes",
        "visibility",
    }
)

_MAINLAND_MOBILE_RE = re.compile(r"(?<!\d)1[3-9](?:[\s-]?\d){9}(?!\d)")
_HTTP_URL_RE = re.compile(r"https?://", re.IGNORECASE)
_CONTACT_MARKER_RE = re.compile(
    r"(?:加|联系)\s*(?:我)?\s*(?:微信|wechat|wx|vx)"
    r"|(?:微信|wechat|wx|vx)\s*(?:id\b|号|[:：])"
    r"|(?:微信|wechat|wx|vx)\s+[A-Za-z0-9][A-Za-z0-9._-]*\b",
    re.IGNORECASE,
)


def validate_public_free_text(value: str) -> str:
    """Reject only obvious off-platform contact details from public free text."""
    if _MAINLAND_MOBILE_RE.search(value):
        raise ValueError("must not include a mainland mobile number")
    if _HTTP_URL_RE.search(value):
        raise ValueError("must not include an http or https URL")
    if _CONTACT_MARKER_RE.search(value):
        raise ValueError("must not include an explicit WeChat contact marker")
    return value


def project_public_reason(
    reason: OpenGameStateReason | None,
) -> OpenGamePublicStateReason | None:
    """Coarsen owner-only order reasons before entering the public DTO."""
    if reason is None:
        return None
    if reason is OpenGameStateReason.REGISTRATION_WINDOW_CLOSED:
        return OpenGamePublicStateReason.REGISTRATION_WINDOW_CLOSED
    if reason is OpenGameStateReason.REGISTRATION_DEADLINE_PASSED:
        return OpenGamePublicStateReason.REGISTRATION_DEADLINE_PASSED
    if reason is OpenGameStateReason.CAPTAIN_CANCELLED:
        return OpenGamePublicStateReason.CAPTAIN_CANCELLED
    if reason is OpenGameStateReason.ORDER_COMPLETED:
        return OpenGamePublicStateReason.BOOKING_COMPLETED
    return OpenGamePublicStateReason.BOOKING_UNAVAILABLE


def project_open_game_public(
    *,
    name: str,
    team_name: str,
    state: EffectiveOpenGameState,
    state_reason: OpenGameStateReason | None,
    venue_name: str,
    pitch_name: str,
    players_per_side: int,
    starts_at: datetime,
    ends_at: datetime,
    time_zone: str,
    total_players: int,
    fixed_players: int,
    open_spots: int,
    intensity: OpenGameIntensity,
    minimum_experience: str | None,
    positions: list["OpenGamePosition"],
    aa_cents: int,
    registration_deadline: datetime,
    equipment_and_arrival_notes: str | None,
    visibility: OpenGameVisibility,
) -> "OpenGamePublic":
    """Build the public response from one explicit, private-data-free whitelist."""
    from backend.app.modules.open_games.dto import OpenGamePublic

    return OpenGamePublic(
        name=name,
        team_name=team_name,
        state=state,
        state_reason=project_public_reason(state_reason),
        venue_name=venue_name,
        pitch_name=pitch_name,
        pitch_specification=f"{players_per_side}人制",
        starts_at=starts_at,
        ends_at=ends_at,
        time_zone=time_zone,
        total_players=total_players,
        fixed_players=fixed_players,
        open_spots=open_spots,
        intensity=intensity,
        minimum_experience=minimum_experience,
        positions=positions,
        aa_cents=aa_cents,
        registration_deadline=registration_deadline,
        equipment_and_arrival_notes=equipment_and_arrival_notes,
        visibility=visibility,
    )


def select_share_cover_url(images: Iterable[VenueImage]) -> str | None:
    """Select only an HTTPS cover from the published VenueImage authority."""
    for image in images:
        if (
            isinstance(image, VenueImage)
            and image.role is ImageRole.COVER
            and image.url.startswith("https://")
        ):
            return image.url
    return None
