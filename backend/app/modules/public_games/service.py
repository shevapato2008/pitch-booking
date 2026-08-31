"""Fail-closed projection for the anonymous public-game directory."""

import re
from collections.abc import Callable
from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import ValidationError
from sqlalchemy.exc import SQLAlchemyError

from backend.app.errors import AppError
from backend.app.models import OpenGameStatus, OpenGameVisibility
from backend.app.modules.open_games.dto import mask_to_positions
from backend.app.modules.open_games.lifecycle import (
    EffectiveOpenGameState,
    OpenGameFacts,
    project_open_game_reason,
    project_open_game_state,
    published_authority_is_healthy,
)
from backend.app.modules.open_games.privacy import project_open_game_public
from backend.app.modules.orders.lifecycle import OrderLifecycleFacts
from backend.app.modules.public_games.dto import (
    PublicGameDirectoryItem,
    PublicGameDirectoryResponse,
    PublicGameFormat,
)
from backend.app.modules.public_games.repository import (
    PublicGameDirectoryCandidate,
    PublicGameDirectoryRepository,
)

_SHARE_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{32}$")


class PublicGameDirectoryService:
    def __init__(
        self,
        *,
        repository: PublicGameDirectoryRepository,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self._repository = repository
        self._now = now or (lambda: datetime.now(UTC))

    def list_games(
        self,
        *,
        local_date: date | None = None,
        game_format: PublicGameFormat | None = None,
        available_only: bool = False,
    ) -> PublicGameDirectoryResponse:
        try:
            authoritative_now = self._now()
            _require_aware(authoritative_now)
            candidates = self._repository.list_candidates(now=authoritative_now)
            base_items = [
                item
                for candidate in candidates
                if (item := _project_candidate(candidate, now=authoritative_now)) is not None
            ]
            available_dates = sorted({item.local_date for item in base_items})
            filtered_items = [
                item
                for item in base_items
                if (local_date is None or item.local_date == local_date)
                and (game_format is None or item.format is game_format)
                and (not available_only or item.remaining_spots > 0)
            ]
            return PublicGameDirectoryResponse(
                authoritative_now=authoritative_now,
                available_dates=available_dates,
                items=filtered_items,
            )
        except AppError:
            self._repository.rollback()
            raise
        except (SQLAlchemyError, ValidationError, TypeError, ValueError, RuntimeError):
            self._repository.rollback()
            raise _service_unavailable() from None


def _project_candidate(
    candidate: PublicGameDirectoryCandidate,
    *,
    now: datetime,
) -> PublicGameDirectoryItem | None:
    try:
        if (
            candidate.stored_status is not OpenGameStatus.PUBLISHED
            or candidate.visibility is not OpenGameVisibility.PUBLIC
            or candidate.published_at is None
            or not _is_aware(candidate.published_at)
            or not _is_aware(candidate.starts_at)
            or not _is_aware(candidate.ends_at)
            or not _is_aware(candidate.registration_deadline)
            or candidate.starts_at <= now
            or candidate.registration_deadline <= now
            or candidate.players_per_side not in {5, 7}
            or _SHARE_TOKEN_RE.fullmatch(candidate.share_token) is None
            or not isinstance(candidate.joined_count, int)
            or candidate.joined_count < 0
        ):
            return None
        order_facts = OrderLifecycleFacts(
            status=candidate.order_status,
            starts_at=candidate.starts_at,
            ends_at=candidate.ends_at,
            cancel_requested_at=candidate.cancel_requested_at,
            checked_in_at=candidate.checked_in_at,
            payment_may_exist=False,
            controlling_refund_purpose=candidate.controlling_refund_purpose,
        )
        if not published_authority_is_healthy(order_facts):
            return None
        game_facts = OpenGameFacts(
            stored_status=candidate.stored_status,
            order_facts=order_facts,
            registration_deadline=candidate.registration_deadline,
        )
        state = project_open_game_state(game_facts)
        state_reason = project_open_game_reason(game_facts, now=now)
        if state is not EffectiveOpenGameState.PUBLISHED or state_reason is not None:
            return None

        time_zone = _require_time_zone(candidate.time_zone)
        game = project_open_game_public(
            name=candidate.name,
            team_name=candidate.team_name,
            state=state,
            state_reason=state_reason,
            venue_name=candidate.venue_name,
            pitch_name=candidate.pitch_name,
            players_per_side=candidate.players_per_side,
            starts_at=candidate.starts_at,
            ends_at=candidate.ends_at,
            time_zone=time_zone.key,
            total_players=candidate.total_players,
            fixed_players=candidate.fixed_players,
            open_spots=candidate.open_spots,
            intensity=candidate.intensity,
            minimum_experience=candidate.minimum_experience,
            positions=mask_to_positions(candidate.position_mask),
            aa_cents=candidate.aa_cents,
            registration_deadline=candidate.registration_deadline,
            equipment_and_arrival_notes=candidate.equipment_and_arrival_notes,
            visibility=candidate.visibility,
        )
        current_players = candidate.fixed_players + candidate.joined_count
        return PublicGameDirectoryItem(
            detail_path=f"/pages/captain-game-public/index?token={candidate.share_token}",
            local_date=candidate.starts_at.astimezone(time_zone).date(),
            format=(
                PublicGameFormat.FIVE if candidate.players_per_side == 5 else PublicGameFormat.SEVEN
            ),
            current_players=current_players,
            remaining_spots=max(
                candidate.open_spots - candidate.joined_count,
                0,
            ),
            game=game,
        )
    except (ValidationError, ZoneInfoNotFoundError, TypeError, ValueError):
        return None


def _require_time_zone(value: str | None) -> ZoneInfo:
    if value is None:
        raise ValueError("venue time zone is missing")
    return ZoneInfo(value)


def _is_aware(value: datetime) -> bool:
    return value.tzinfo is not None and value.utcoffset() is not None


def _require_aware(value: datetime) -> None:
    if not _is_aware(value):
        raise ValueError("authoritative now must include a timezone")


def _service_unavailable() -> AppError:
    return AppError(
        503,
        "SERVICE_UNAVAILABLE",
        "公开球局服务暂不可用，请稍后重试。",
    )
