"""Closed response DTOs for anonymous public game discovery."""

from datetime import date, datetime
from enum import StrEnum
from typing import Annotated, Self
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import Field, field_validator, model_validator

from backend.app.models import OpenGameVisibility
from backend.app.modules.open_games.dto import ClosedModel, OpenGamePublic
from backend.app.modules.open_games.lifecycle import EffectiveOpenGameState


class PublicGameFormat(StrEnum):
    FIVE = "FIVE"
    SEVEN = "SEVEN"


class PublicGameDirectoryItem(ClosedModel):
    detail_path: Annotated[
        str,
        Field(
            pattern=(
                r"^/pages/captain-game-public/index\?token="
                r"[A-Za-z0-9_-]{32}$"
            )
        ),
    ]
    local_date: date
    format: PublicGameFormat
    current_players: Annotated[int, Field(strict=True, ge=1)]
    remaining_spots: Annotated[int, Field(strict=True, ge=0)]
    game: OpenGamePublic

    @model_validator(mode="after")
    def validate_public_directory_projection(self) -> Self:
        try:
            game_time_zone = ZoneInfo(self.game.time_zone)
        except ZoneInfoNotFoundError as exc:
            raise ValueError(
                "game.time_zone must identify an available IANA time zone"
            ) from exc
        if self.local_date != self.game.starts_at.astimezone(game_time_zone).date():
            raise ValueError(
                "local_date must match game.starts_at in game.time_zone"
            )

        expected_pitch_specification = {
            PublicGameFormat.FIVE: "5人制",
            PublicGameFormat.SEVEN: "7人制",
        }[self.format]
        if self.game.pitch_specification != expected_pitch_specification:
            raise ValueError("format must match game.pitch_specification")
        if self.game.state is not EffectiveOpenGameState.PUBLISHED:
            raise ValueError("directory game must be published")
        if self.game.state_reason is not None:
            raise ValueError("directory published game cannot have a state reason")
        if self.game.visibility is not OpenGameVisibility.PUBLIC:
            raise ValueError("directory game must be public")

        joined_count = self.current_players - self.game.fixed_players
        if joined_count < 0 or self.current_players > self.game.total_players:
            raise ValueError("current_players is inconsistent with game capacity")
        if self.remaining_spots != max(self.game.open_spots - joined_count, 0):
            raise ValueError("remaining_spots is inconsistent with game capacity")
        return self


class PublicGameDirectoryResponse(ClosedModel):
    authoritative_now: datetime
    available_dates: list[date]
    items: list[PublicGameDirectoryItem]

    @field_validator("authoritative_now")
    @classmethod
    def validate_aware_authoritative_now(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("authoritative_now must include a timezone")
        return value

    @field_validator("available_dates")
    @classmethod
    def validate_available_dates(cls, value: list[date]) -> list[date]:
        if value != sorted(set(value)):
            raise ValueError("available_dates must be unique and sorted")
        return value

    @model_validator(mode="after")
    def validate_authoritative_snapshot(self) -> Self:
        available_dates = set(self.available_dates)
        for index, item in enumerate(self.items):
            if item.local_date not in available_dates:
                raise ValueError("item local_date must belong to available_dates")
            if item.game.starts_at <= self.authoritative_now:
                raise ValueError("directory game start must be in the future")
            if item.game.registration_deadline <= self.authoritative_now:
                raise ValueError("directory registration deadline must be in the future")
            if (
                index > 0
                and self.items[index - 1].game.starts_at > item.game.starts_at
            ):
                raise ValueError("directory items must preserve stable start order")
        return self
