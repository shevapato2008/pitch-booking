"""Closed DTOs and validation for the captain open-game API."""

import re
import unicodedata
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum
from typing import Annotated, Literal, Self

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

from backend.app.models import (
    OpenGameIntensity,
    OpenGameStatus,
    OpenGameVisibility,
    OrderStatus,
    RefundCasePurpose,
)
from backend.app.modules.open_games.lifecycle import (
    EffectiveOpenGameState,
    OpenGameAllowedActions,
    OpenGamePublicStateReason,
    OpenGameStateReason,
)
from backend.app.modules.open_games.privacy import validate_public_free_text
from backend.app.modules.orders import lifecycle as order_lifecycle
from backend.app.modules.orders.lifecycle import OrderLifecycleFacts


class ClosedModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class OpenGamePosition(StrEnum):
    GOALKEEPER = "GOALKEEPER"
    DEFENDER = "DEFENDER"
    MIDFIELDER = "MIDFIELDER"
    FORWARD = "FORWARD"
    ANY = "ANY"


_POSITION_BITS = {
    OpenGamePosition.GOALKEEPER: 1,
    OpenGamePosition.DEFENDER: 2,
    OpenGamePosition.MIDFIELDER: 4,
    OpenGamePosition.FORWARD: 8,
}
_CANONICAL_POSITIONS = tuple(_POSITION_BITS)
_IANA_TIME_ZONE_RE = re.compile(
    r"^[A-Za-z]+(?:[._+-][A-Za-z0-9]+)*(?:/[A-Za-z0-9._+-]+)+$"
)


@dataclass(frozen=True, slots=True)
class OpenGameFieldError:
    field: str
    message: str


class OpenGameValidationError(ValueError):
    def __init__(self, message: str, *fields: OpenGameFieldError) -> None:
        super().__init__(message)
        self.fields = fields


def normalize_team_name_key(name: str) -> str:
    """Return the stable per-captain uniqueness key for a visible team name."""
    normalized = unicodedata.normalize("NFKC", name)
    return " ".join(normalized.split()).casefold()


def positions_to_mask(positions: list[OpenGamePosition]) -> int:
    canonical = _canonicalize_positions(positions)
    if canonical == [OpenGamePosition.ANY]:
        return 0
    mask = 0
    for position in canonical:
        mask |= _POSITION_BITS[position]
    return mask


def mask_to_positions(mask: int) -> list[OpenGamePosition]:
    if not 0 <= mask <= 15:
        raise ValueError("position mask must be between 0 and 15")
    if mask == 0:
        return [OpenGamePosition.ANY]
    return [position for position in _CANONICAL_POSITIONS if mask & _POSITION_BITS[position]]


class OpenGameDraftInput(ClosedModel):
    name: Annotated[str, Field(strict=True, min_length=2, max_length=30)]
    team_name: Annotated[str, Field(strict=True, min_length=2, max_length=24)]
    total_players: Annotated[int, Field(strict=True, ge=4, le=30)]
    fixed_players: Annotated[int, Field(strict=True, ge=1, le=30)]
    open_spots: Annotated[int, Field(strict=True, ge=1, le=29)]
    intensity: OpenGameIntensity
    minimum_experience: Annotated[str, Field(strict=True, min_length=1, max_length=60)] | None
    positions: Annotated[list[OpenGamePosition], Field(min_length=1, max_length=4)]
    aa_cents: Annotated[int, Field(strict=True, ge=0)]
    registration_deadline: datetime
    equipment_and_arrival_notes: (
        Annotated[str, Field(strict=True, min_length=1, max_length=200)] | None
    )
    visibility: OpenGameVisibility

    @field_validator(
        "name",
        "team_name",
        "minimum_experience",
        "equipment_and_arrival_notes",
    )
    @classmethod
    def validate_visible_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if value != value.strip():
            raise ValueError("must not have leading or trailing whitespace")
        return validate_public_free_text(value)

    @field_validator("registration_deadline")
    @classmethod
    def validate_aware_deadline(cls, value: datetime) -> datetime:
        _require_aware(value, field="registration_deadline")
        return value

    @field_validator("positions")
    @classmethod
    def validate_positions(
        cls, value: list[OpenGamePosition]
    ) -> list[OpenGamePosition]:
        return _canonicalize_positions(value)

    @model_validator(mode="after")
    def validate_roster_capacity(self) -> Self:
        if self.fixed_players + self.open_spots > self.total_players:
            raise ValueError("fixed_players + open_spots must not exceed total_players")
        return self


class CreateOpenGameRequest(OpenGameDraftInput):
    pass


class UpdateOpenGameRequest(OpenGameDraftInput):
    expected_version: Annotated[int, Field(strict=True, ge=1)]

    @model_validator(mode="after")
    def validate_roster_capacity(self) -> Self:
        return self


class OpenGameVersionRequest(ClosedModel):
    expected_version: Annotated[int, Field(strict=True, ge=1)]


class OpenGameOrderSummary(ClosedModel):
    venue_name: Annotated[str, Field(strict=True, min_length=1)]
    pitch_name: Annotated[str, Field(strict=True, min_length=1)]
    pitch_specification: Annotated[str, Field(pattern=r"^[1-9][0-9]*人制$")]
    players_per_side: Annotated[int, Field(strict=True, ge=1)]
    booking_price_cents: Annotated[int, Field(strict=True, ge=0)]
    starts_at: datetime
    ends_at: datetime
    time_zone: Annotated[str, Field(pattern=_IANA_TIME_ZONE_RE.pattern)]

    @model_validator(mode="after")
    def validate_authority(self) -> Self:
        _require_aware(self.starts_at, field="starts_at")
        _require_aware(self.ends_at, field="ends_at")
        if self.ends_at <= self.starts_at:
            raise ValueError("ends_at must be after starts_at")
        if self.pitch_specification != f"{self.players_per_side}人制":
            raise ValueError("pitch_specification must be derived from players_per_side")
        return self


class OpenGameEntry(ClosedModel):
    entry: Literal["CREATE", "MANAGE", "NONE"]
    order: OpenGameOrderSummary | None
    game_id: uuid.UUID | None
    blocked_reason: Literal["ORDER_NOT_ELIGIBLE"] | None

    @model_validator(mode="after")
    def validate_variant(self) -> Self:
        expected = {
            "CREATE": (self.order is not None, self.game_id is None, self.blocked_reason is None),
            "MANAGE": (self.order is None, self.game_id is not None, self.blocked_reason is None),
            "NONE": (
                self.order is None,
                self.game_id is None,
                self.blocked_reason == "ORDER_NOT_ELIGIBLE",
            ),
        }[self.entry]
        if not all(expected):
            raise ValueError("entry payload does not match its discriminator")
        return self


class OpenGameTeam(ClosedModel):
    id: uuid.UUID
    name: Annotated[str, Field(strict=True, min_length=2, max_length=24)]


class OpenGameShare(ClosedModel):
    title: Annotated[str, Field(strict=True, min_length=1)]
    path: Annotated[
        str,
        Field(pattern=r"^/pages/captain-game-public/index\?token=[A-Za-z0-9_-]{32}$"),
    ]
    image_url: Annotated[str, Field(pattern=r"^https://")] | None


class OpenGamePublic(ClosedModel):
    name: Annotated[str, Field(strict=True, min_length=2, max_length=30)]
    team_name: Annotated[str, Field(strict=True, min_length=2, max_length=24)]
    state: EffectiveOpenGameState
    state_reason: OpenGamePublicStateReason | None
    venue_name: Annotated[str, Field(strict=True, min_length=1)]
    pitch_name: Annotated[str, Field(strict=True, min_length=1)]
    pitch_specification: Annotated[str, Field(pattern=r"^[1-9][0-9]*人制$")]
    starts_at: datetime
    ends_at: datetime
    time_zone: Annotated[str, Field(pattern=_IANA_TIME_ZONE_RE.pattern)]
    total_players: Annotated[int, Field(strict=True, ge=4, le=30)]
    fixed_players: Annotated[int, Field(strict=True, ge=1, le=30)]
    open_spots: Annotated[int, Field(strict=True, ge=1, le=29)]
    intensity: OpenGameIntensity
    minimum_experience: Annotated[str, Field(strict=True, min_length=1, max_length=60)] | None
    positions: Annotated[list[OpenGamePosition], Field(min_length=1, max_length=4)]
    aa_cents: Annotated[int, Field(strict=True, ge=0)]
    registration_deadline: datetime
    equipment_and_arrival_notes: (
        Annotated[str, Field(strict=True, min_length=1, max_length=200)] | None
    )
    visibility: OpenGameVisibility

    @field_validator(
        "name",
        "team_name",
        "minimum_experience",
        "equipment_and_arrival_notes",
    )
    @classmethod
    def validate_public_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if value != value.strip():
            raise ValueError("must not have leading or trailing whitespace")
        return validate_public_free_text(value)

    @field_validator("positions")
    @classmethod
    def canonicalize_positions(
        cls, value: list[OpenGamePosition]
    ) -> list[OpenGamePosition]:
        return _canonicalize_positions(value)

    @model_validator(mode="after")
    def validate_public_state(self) -> Self:
        allowed_reasons: dict[
            EffectiveOpenGameState, set[OpenGamePublicStateReason | None]
        ] = {
            EffectiveOpenGameState.DRAFT: {
                None,
                OpenGamePublicStateReason.REGISTRATION_WINDOW_CLOSED,
                OpenGamePublicStateReason.REGISTRATION_DEADLINE_PASSED,
            },
            EffectiveOpenGameState.PUBLISHED: {
                None,
                OpenGamePublicStateReason.REGISTRATION_DEADLINE_PASSED,
            },
            EffectiveOpenGameState.SUSPENDED: {
                OpenGamePublicStateReason.BOOKING_UNAVAILABLE
            },
            EffectiveOpenGameState.CANCELLED: {
                OpenGamePublicStateReason.CAPTAIN_CANCELLED,
                OpenGamePublicStateReason.BOOKING_UNAVAILABLE,
            },
            EffectiveOpenGameState.COMPLETED: {
                OpenGamePublicStateReason.BOOKING_COMPLETED
            },
        }
        if self.state_reason not in allowed_reasons[self.state]:
            raise ValueError("state_reason does not match state")
        _require_aware(self.starts_at, field="starts_at")
        _require_aware(self.ends_at, field="ends_at")
        _require_aware(self.registration_deadline, field="registration_deadline")
        if self.ends_at <= self.starts_at:
            raise ValueError("ends_at must be after starts_at")
        if self.fixed_players + self.open_spots > self.total_players:
            raise ValueError("fixed_players + open_spots must not exceed total_players")
        return self


class OpenGameOwner(ClosedModel):
    id: uuid.UUID
    order_id: uuid.UUID
    order: OpenGameOrderSummary
    name: Annotated[str, Field(strict=True, min_length=2, max_length=30)]
    team: OpenGameTeam
    total_players: Annotated[int, Field(strict=True, ge=4, le=30)]
    fixed_players: Annotated[int, Field(strict=True, ge=1, le=30)]
    open_spots: Annotated[int, Field(strict=True, ge=1, le=29)]
    intensity: OpenGameIntensity
    minimum_experience: Annotated[str, Field(strict=True, min_length=1, max_length=60)] | None
    positions: Annotated[list[OpenGamePosition], Field(min_length=1, max_length=4)]
    aa_cents: Annotated[int, Field(strict=True, ge=0)]
    registration_deadline: datetime
    equipment_and_arrival_notes: (
        Annotated[str, Field(strict=True, min_length=1, max_length=200)] | None
    )
    visibility: OpenGameVisibility
    persisted_status: OpenGameStatus
    state: EffectiveOpenGameState
    state_reason: OpenGameStateReason | None
    version: Annotated[int, Field(strict=True, ge=1)]
    allowed_actions: OpenGameAllowedActions
    share: OpenGameShare | None
    public_view: OpenGamePublic


def validate_draft_write(
    order_facts: OrderLifecycleFacts,
    *,
    registration_deadline: datetime,
    now: datetime,
) -> None:
    """Validate create, DRAFT-save, or publish against the one B1 decision."""
    _require_aware(now, field="registration_deadline")
    _require_aware(order_facts.starts_at, field="registration_deadline")
    _require_aware(registration_deadline, field="registration_deadline")
    if not order_lifecycle.is_b2_open_game_eligible(order_facts, now=now):
        raise OpenGameValidationError("order is not eligible for an open game")
    _validate_registration_deadline(
        registration_deadline, starts_at=order_facts.starts_at, now=now
    )


def validate_published_update(
    order_facts: OrderLifecycleFacts,
    *,
    previous_registration_deadline: datetime,
    registration_deadline: datetime,
    now: datetime,
) -> None:
    """Validate an update without retroactively closing a published game."""
    for value in (
        now,
        order_facts.starts_at,
        previous_registration_deadline,
        registration_deadline,
    ):
        _require_aware(value, field="registration_deadline")
    if not _published_order_is_healthy(order_facts):
        raise OpenGameValidationError("order is not healthy enough to edit")
    if registration_deadline == previous_registration_deadline:
        return
    _validate_registration_deadline(
        registration_deadline, starts_at=order_facts.starts_at, now=now
    )


def _published_order_is_healthy(facts: OrderLifecycleFacts) -> bool:
    return (
        facts.status is OrderStatus.CONFIRMED
        and facts.cancel_requested_at is None
        and facts.controlling_refund_purpose
        not in {
            RefundCasePurpose.ORDER_CANCELLATION,
            RefundCasePurpose.PAYMENT_INVENTORY_CONFLICT,
        }
    )


def _validate_registration_deadline(
    deadline: datetime, *, starts_at: datetime, now: datetime
) -> None:
    if deadline <= now:
        raise OpenGameValidationError(
            "registration deadline must be in the future",
            OpenGameFieldError("registration_deadline", "must be in the future"),
        )
    if deadline > starts_at - timedelta(hours=2):
        raise OpenGameValidationError(
            "registration deadline must be at least two hours before start",
            OpenGameFieldError(
                "registration_deadline", "must be at least two hours before start"
            ),
        )


def _canonicalize_positions(
    positions: list[OpenGamePosition],
) -> list[OpenGamePosition]:
    if not positions:
        raise ValueError("select at least one position")
    if len(set(positions)) != len(positions):
        raise ValueError("positions must be unique")
    if OpenGamePosition.ANY in positions:
        if positions != [OpenGamePosition.ANY]:
            raise ValueError("ANY cannot be combined with a specific position")
        return [OpenGamePosition.ANY]
    return [position for position in _CANONICAL_POSITIONS if position in positions]


def _require_aware(value: datetime, *, field: str) -> None:
    if value.tzinfo is None or value.utcoffset() is None:
        raise OpenGameValidationError(
            f"{field} must include a timezone",
            OpenGameFieldError(field, "must include a timezone"),
        )
