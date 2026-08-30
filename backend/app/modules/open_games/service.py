"""Owner lifecycle and public projection for captain open games."""

import hashlib
import json
import re
import secrets
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from pydantic import ValidationError
from sqlalchemy.exc import SQLAlchemyError

from backend.app.errors import AppError
from backend.app.models import (
    IdempotencyRecord,
    IdempotencyState,
    OpenGame,
    OpenGameStatus,
    Order,
    PaymentState,
    RefundCasePurpose,
    Team,
)
from backend.app.modules.open_game_registrations.repository import (
    OpenGameRegistrationRepository,
)
from backend.app.modules.open_games.dto import (
    CreateOpenGameRequest,
    OpenGameEntry,
    OpenGameFieldError,
    OpenGameOrderSummary,
    OpenGameOwner,
    OpenGamePublic,
    OpenGameShare,
    OpenGameTeam,
    OpenGameValidationError,
    OpenGameVersionRequest,
    UpdateOpenGameRequest,
    mask_to_positions,
    normalize_team_name_key,
    positions_to_mask,
    validate_draft_write,
    validate_published_update,
)
from backend.app.modules.open_games.lifecycle import (
    EffectiveOpenGameState,
    OpenGameFacts,
    OpenGameProjectionInvariantError,
    project_open_game_actions,
    project_open_game_reason,
    project_open_game_state,
)
from backend.app.modules.open_games.privacy import (
    project_open_game_public,
    select_share_cover_url,
)
from backend.app.modules.open_games.repository import (
    ActiveOpenGameConflictError,
    OpenGameOrderRow,
    OpenGameRepository,
    OrderAuthorityRows,
    ShareTokenCollisionError,
)
from backend.app.modules.orders.lifecycle import OrderLifecycleFacts, is_b2_open_game_eligible
from backend.app.modules.orders.repository import OrderRepository

CREATE_OPEN_GAME_OPERATION = "create_open_game"
UPDATE_OPEN_GAME_OPERATION = "update_open_game"
PUBLISH_OPEN_GAME_OPERATION = "publish_open_game"
CANCEL_OPEN_GAME_OPERATION = "cancel_open_game"
_SHARE_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{32}$")
_PAYMENT_MAY_EXIST = frozenset(
    {
        PaymentState.CREATING,
        PaymentState.PREPAY_CREATED,
        PaymentState.CONFIRMING,
        PaymentState.UNKNOWN,
        PaymentState.SUCCESS,
    }
)
_CONTROLLING_REFUND_PURPOSES = frozenset(
    {
        RefundCasePurpose.ORDER_CANCELLATION,
        RefundCasePurpose.PAYMENT_INVENTORY_CONFLICT,
    }
)


@dataclass(frozen=True, slots=True)
class AuthoritativePublicGameProjection:
    public: OpenGamePublic
    facts: OpenGameFacts
    state: EffectiveOpenGameState
    starts_at: datetime
    owner_user_id: uuid.UUID


class OpenGameService:
    def __init__(
        self,
        *,
        repository: OpenGameRepository,
        order_repository: OrderRepository,
        registration_repository: OpenGameRegistrationRepository | None = None,
        now: Callable[[], datetime] | None = None,
        token_factory: Callable[[], str] | None = None,
    ) -> None:
        registration_repository = registration_repository or (
            OpenGameRegistrationRepository(repository.session)
        )
        if (
            repository.session is not order_repository.session
            or registration_repository.session is not repository.session
        ):
            raise ValueError(
                "open-game, registration and order repositories must share one Session"
            )
        self._repository = repository
        self._order_repository = order_repository
        self._registration_repository = registration_repository
        self._now = now or (lambda: datetime.now(UTC))
        self._token_factory = token_factory or (lambda: secrets.token_urlsafe(24))

    def get_entry(
        self,
        *,
        user_id: uuid.UUID,
        order_id: uuid.UUID,
    ) -> OpenGameEntry:
        try:
            order = self._repository.get_owned_order(
                order_id=order_id,
                user_id=user_id,
            )
            if order is None:
                raise _order_not_found()
            active = self._repository.get_active_game(order_id=order.id)
            if active is not None:
                return OpenGameEntry(
                    entry="MANAGE",
                    order=None,
                    game_id=active.id,
                    blocked_reason=None,
                )
            authority = self._repository.get_order_authority(order_id=order.id)
            order_row = self._require_order_row(order.id)
            facts = _order_facts(order, order_row, authority)
            if is_b2_open_game_eligible(facts, now=self._now()):
                return OpenGameEntry(
                    entry="CREATE",
                    order=_order_summary(order_row),
                    game_id=None,
                    blocked_reason=None,
                )
            return OpenGameEntry(
                entry="NONE",
                order=None,
                game_id=None,
                blocked_reason="ORDER_NOT_ELIGIBLE",
            )
        except AppError:
            self._repository.rollback()
            raise
        except (SQLAlchemyError, ValidationError, ValueError, RuntimeError):
            self._repository.rollback()
            raise _service_unavailable() from None

    def get_owner(
        self,
        *,
        user_id: uuid.UUID,
        game_id: uuid.UUID,
    ) -> OpenGameOwner:
        try:
            game = self._repository.get_owned_game(
                game_id=game_id,
                user_id=user_id,
            )
            if game is None:
                raise _game_not_found()
            order = self._repository.get_owned_order(
                order_id=game.order_id,
                user_id=user_id,
            )
            if order is None:
                raise _game_not_found()
            authority = self._repository.get_order_authority(order_id=order.id)
            return self._project_owner(game, order, authority, now=self._now())
        except AppError:
            self._repository.rollback()
            raise
        except (
            SQLAlchemyError,
            OpenGameProjectionInvariantError,
            ValidationError,
            ValueError,
            RuntimeError,
        ):
            self._repository.rollback()
            raise _service_unavailable() from None

    def create_draft(
        self,
        *,
        user_id: uuid.UUID,
        order_id: uuid.UUID,
        idempotency_key: str,
        request: CreateOpenGameRequest,
    ) -> OpenGameOwner:
        try:
            order = self._repository.lock_owned_order(
                order_id=order_id,
                user_id=user_id,
            )
            if order is None:
                raise _order_not_found()
            active = self._repository.lock_active_game(order_id=order.id)
            authority = self._repository.lock_order_authority(order_id=order.id)
            digest = _request_digest(
                operation=CREATE_OPEN_GAME_OPERATION,
                resource_id=order.id,
                request=request,
            )
            record, claimed = self._order_repository.claim_idempotency(
                user_id=user_id,
                operation=CREATE_OPEN_GAME_OPERATION,
                key=idempotency_key,
                request_sha256=digest,
            )
            if not claimed:
                replay = _replay_owner(record, digest=digest, status_code=201)
                self._order_repository.commit()
                return replay
            if active is not None:
                raise _active_game_exists()

            now = self._now()
            order_row = self._require_order_row(order.id)
            facts = _order_facts(order, order_row, authority)
            validate_draft_write(
                facts,
                registration_deadline=request.registration_deadline,
                now=now,
            )
            team = self._repository.upsert_team(
                captain_user_id=user_id,
                name=request.team_name,
                name_key=normalize_team_name_key(request.team_name),
            )
            game = self._insert_draft(order=order, team_id=team.id, request=request)
            response = self._project_owner(game, order, authority, now=now)
            self._order_repository.complete_idempotency(
                record,
                response_status=201,
                response_body=response.model_dump(mode="json"),
            )
            self._order_repository.commit()
            return response
        except OpenGameValidationError as error:
            self._repository.rollback()
            raise _validation_error(error) from None
        except ActiveOpenGameConflictError:
            self._repository.rollback()
            raise _active_game_exists() from None
        except AppError:
            self._repository.rollback()
            raise
        except (
            SQLAlchemyError,
            OpenGameProjectionInvariantError,
            ShareTokenCollisionError,
            ValidationError,
            ValueError,
            RuntimeError,
            StopIteration,
        ):
            self._repository.rollback()
            raise _service_unavailable() from None

    def update(
        self,
        *,
        user_id: uuid.UUID,
        game_id: uuid.UUID,
        idempotency_key: str,
        request: UpdateOpenGameRequest,
    ) -> OpenGameOwner:
        try:
            order_id = self._repository.locate_order_id(game_id=game_id)
            if order_id is None:
                raise _game_not_found()
            order = self._repository.lock_owned_order(
                order_id=order_id,
                user_id=user_id,
            )
            if order is None:
                raise _game_not_found()
            game = self._repository.lock_target_game(
                game_id=game_id,
                order_id=order.id,
            )
            if game is None:
                raise _game_not_found()
            authority = self._repository.lock_order_authority(order_id=order.id)
            digest = _request_digest(
                operation=UPDATE_OPEN_GAME_OPERATION,
                resource_id=game.id,
                request=request,
            )
            record, claimed = self._order_repository.claim_idempotency(
                user_id=user_id,
                operation=UPDATE_OPEN_GAME_OPERATION,
                key=idempotency_key,
                request_sha256=digest,
            )
            if not claimed:
                replay = _replay_owner(record, digest=digest, status_code=200)
                self._order_repository.commit()
                return replay
            if (
                game.status is OpenGameStatus.CANCELLED
                or game.version != request.expected_version
            ):
                raise _state_changed()

            now = self._now()
            order_row = self._require_order_row(order.id)
            facts = _order_facts(order, order_row, authority)
            if game.status is OpenGameStatus.DRAFT:
                validate_draft_write(
                    facts,
                    registration_deadline=request.registration_deadline,
                    now=now,
                )
            elif game.status is OpenGameStatus.PUBLISHED:
                validate_published_update(
                    facts,
                    previous_registration_deadline=game.registration_deadline,
                    registration_deadline=request.registration_deadline,
                    now=now,
                )
            else:
                raise _state_changed()

            joined_count = self._registration_repository.count_joined(
                game_id=game.id
            )
            has_active_waitlist = (
                request.open_spots != game.open_spots
                and self._registration_repository.has_active_waitlist(
                    game_id=game.id
                )
            )
            _validate_update_roster(
                game=game,
                request=request,
                joined_count=joined_count,
                has_active_waitlist=has_active_waitlist,
            )

            team = self._repository.upsert_team(
                captain_user_id=user_id,
                name=request.team_name,
                name_key=normalize_team_name_key(request.team_name),
            )
            _apply_update(game, team_id=team.id, request=request)
            self._repository.flush()
            response = self._project_owner(game, order, authority, now=now)
            self._order_repository.complete_idempotency(
                record,
                response_status=200,
                response_body=response.model_dump(mode="json"),
            )
            self._order_repository.commit()
            return response
        except OpenGameValidationError as error:
            self._repository.rollback()
            raise _validation_error(error) from None
        except AppError:
            self._repository.rollback()
            raise
        except (
            SQLAlchemyError,
            OpenGameProjectionInvariantError,
            ValidationError,
            ValueError,
            RuntimeError,
        ):
            self._repository.rollback()
            raise _service_unavailable() from None

    def publish(
        self,
        *,
        user_id: uuid.UUID,
        game_id: uuid.UUID,
        idempotency_key: str,
        request: OpenGameVersionRequest,
    ) -> OpenGameOwner:
        try:
            order_id = self._repository.locate_order_id(game_id=game_id)
            if order_id is None:
                raise _game_not_found()
            order = self._repository.lock_owned_order(
                order_id=order_id,
                user_id=user_id,
            )
            if order is None:
                raise _game_not_found()
            game = self._repository.lock_target_game(
                game_id=game_id,
                order_id=order.id,
            )
            if game is None:
                raise _game_not_found()
            authority = self._repository.lock_order_authority(order_id=order.id)
            digest = _request_digest(
                operation=PUBLISH_OPEN_GAME_OPERATION,
                resource_id=game.id,
                request=request,
            )
            record, claimed = self._order_repository.claim_idempotency(
                user_id=user_id,
                operation=PUBLISH_OPEN_GAME_OPERATION,
                key=idempotency_key,
                request_sha256=digest,
            )
            if not claimed:
                replay = _replay_owner(record, digest=digest, status_code=200)
                self._order_repository.commit()
                return replay
            if (
                game.status is not OpenGameStatus.DRAFT
                or game.version != request.expected_version
            ):
                raise _state_changed()

            now = self._now()
            order_row = self._require_order_row(order.id)
            facts = _order_facts(order, order_row, authority)
            validate_draft_write(
                facts,
                registration_deadline=game.registration_deadline,
                now=now,
            )
            game.status = OpenGameStatus.PUBLISHED
            game.published_at = now
            game.version += 1
            self._repository.flush()
            response = self._project_owner(game, order, authority, now=now)
            self._order_repository.complete_idempotency(
                record,
                response_status=200,
                response_body=response.model_dump(mode="json"),
            )
            self._order_repository.commit()
            return response
        except OpenGameValidationError as error:
            self._repository.rollback()
            raise _validation_error(error) from None
        except AppError:
            self._repository.rollback()
            raise
        except (
            SQLAlchemyError,
            OpenGameProjectionInvariantError,
            ValidationError,
            ValueError,
            RuntimeError,
        ):
            self._repository.rollback()
            raise _service_unavailable() from None

    def cancel(
        self,
        *,
        user_id: uuid.UUID,
        game_id: uuid.UUID,
        idempotency_key: str,
        request: OpenGameVersionRequest,
    ) -> OpenGameOwner:
        try:
            order_id = self._repository.locate_order_id(game_id=game_id)
            if order_id is None:
                raise _game_not_found()
            order = self._repository.lock_owned_order(
                order_id=order_id,
                user_id=user_id,
            )
            if order is None:
                raise _game_not_found()
            game = self._repository.lock_target_game(
                game_id=game_id,
                order_id=order.id,
            )
            if game is None:
                raise _game_not_found()
            authority = self._repository.lock_order_authority(order_id=order.id)
            digest = _request_digest(
                operation=CANCEL_OPEN_GAME_OPERATION,
                resource_id=game.id,
                request=request,
            )
            record, claimed = self._order_repository.claim_idempotency(
                user_id=user_id,
                operation=CANCEL_OPEN_GAME_OPERATION,
                key=idempotency_key,
                request_sha256=digest,
            )
            if not claimed:
                replay = _replay_owner(record, digest=digest, status_code=200)
                self._order_repository.commit()
                return replay
            if game.version != request.expected_version:
                raise _state_changed()

            now = self._now()
            order_row = self._require_order_row(order.id)
            order_facts = _order_facts(order, order_row, authority)
            game_facts = OpenGameFacts(
                stored_status=game.status,
                order_facts=order_facts,
                registration_deadline=game.registration_deadline,
            )
            if not project_open_game_actions(game_facts, now=now).can_cancel:
                raise _state_changed()
            game.status = OpenGameStatus.CANCELLED
            game.cancelled_at = now
            game.version += 1
            self._repository.flush()
            response = self._project_owner(game, order, authority, now=now)
            self._order_repository.complete_idempotency(
                record,
                response_status=200,
                response_body=response.model_dump(mode="json"),
            )
            self._order_repository.commit()
            return response
        except AppError:
            self._repository.rollback()
            raise
        except (
            SQLAlchemyError,
            OpenGameProjectionInvariantError,
            ValidationError,
            ValueError,
            RuntimeError,
        ):
            self._repository.rollback()
            raise _service_unavailable() from None

    def get_public(self, *, share_token: str) -> OpenGamePublic:
        if _SHARE_TOKEN_RE.fullmatch(share_token) is None:
            raise _game_not_found()
        try:
            game = self._repository.get_by_share_token(share_token=share_token)
            if game is None:
                raise _game_not_found()
            order = game.order
            authority = self._repository.get_order_authority(order_id=order.id)
            order_row = self._require_order_row(order.id)
            team = self._repository.get_team(team_id=game.team_id)
            if team is None:
                raise RuntimeError("open game team is missing")
            return project_authoritative_public_game(
                game=game,
                order=order,
                authority=authority,
                order_row=order_row,
                team=team,
                now=self._now(),
            ).public
        except AppError:
            self._repository.rollback()
            raise
        except (
            SQLAlchemyError,
            OpenGameProjectionInvariantError,
            ValidationError,
            ValueError,
            RuntimeError,
        ):
            self._repository.rollback()
            raise _service_unavailable() from None

    def _insert_draft(
        self,
        *,
        order: Order,
        team_id: uuid.UUID,
        request: CreateOpenGameRequest,
    ) -> OpenGame:
        for attempt in range(2):
            game = OpenGame(
                id=uuid.uuid4(),
                order_id=order.id,
                team_id=team_id,
                name=request.name,
                total_players=request.total_players,
                fixed_players=request.fixed_players,
                open_spots=request.open_spots,
                intensity=request.intensity,
                minimum_experience=request.minimum_experience,
                position_mask=positions_to_mask(request.positions),
                aa_cents=request.aa_cents,
                registration_deadline=request.registration_deadline,
                equipment_and_arrival_notes=request.equipment_and_arrival_notes,
                visibility=request.visibility,
                status=OpenGameStatus.DRAFT,
                version=1,
                share_token=self._token_factory(),
                published_at=None,
                cancelled_at=None,
            )
            try:
                self._repository.insert_game_candidate(game)
                return game
            except ShareTokenCollisionError:
                if attempt == 1:
                    raise
        raise AssertionError("share-token retry loop did not return")

    def _project_owner(
        self,
        game: OpenGame,
        order: Order,
        authority: OrderAuthorityRows,
        *,
        now: datetime,
    ) -> OpenGameOwner:
        order_row = self._require_order_row(order.id)
        team = self._repository.get_team(team_id=game.team_id)
        if team is None:
            raise RuntimeError("open game team is missing")
        projection = project_authoritative_public_game(
            game=game,
            order=order,
            authority=authority,
            order_row=order_row,
            team=team,
            now=now,
        )
        reason = project_open_game_reason(projection.facts, now=now)
        actions = project_open_game_actions(projection.facts, now=now)
        positions = mask_to_positions(game.position_mask)
        return OpenGameOwner(
            id=game.id,
            order_id=order.id,
            order=_order_summary(order_row),
            name=game.name,
            team=OpenGameTeam(id=team.id, name=team.name),
            total_players=game.total_players,
            fixed_players=game.fixed_players,
            open_spots=game.open_spots,
            intensity=game.intensity,
            minimum_experience=game.minimum_experience,
            positions=positions,
            aa_cents=game.aa_cents,
            registration_deadline=game.registration_deadline,
            equipment_and_arrival_notes=game.equipment_and_arrival_notes,
            visibility=game.visibility,
            persisted_status=game.status,
            state=projection.state,
            state_reason=reason,
            version=game.version,
            allowed_actions=actions,
            share=self._share(game, order_row, state=projection.state),
            public_view=projection.public,
        )

    def _share(
        self,
        game: OpenGame,
        order_row: OpenGameOrderRow,
        *,
        state: EffectiveOpenGameState,
    ) -> OpenGameShare | None:
        if game.published_at is None or state is not EffectiveOpenGameState.PUBLISHED:
            return None
        time_zone = _require_time_zone(order_row)
        local_start = order_row.starts_at.astimezone(ZoneInfo(time_zone))
        return OpenGameShare(
            title=(
                f"{game.name} · {local_start.month}月{local_start.day}日 "
                f"{local_start:%H:%M}"
            ),
            path=f"/pages/captain-game-public/index?token={game.share_token}",
            image_url=select_share_cover_url(
                self._repository.get_cover_images(order_id=game.order_id)
            ),
        )

    def _require_order_row(self, order_id: uuid.UUID) -> OpenGameOrderRow:
        row = self._repository.get_order_row(order_id=order_id)
        if row is None:
            raise RuntimeError("open-game order graph is missing")
        return row


def _apply_update(
    game: OpenGame,
    *,
    team_id: uuid.UUID,
    request: UpdateOpenGameRequest,
) -> None:
    game.team_id = team_id
    game.name = request.name
    game.total_players = request.total_players
    game.fixed_players = request.fixed_players
    game.open_spots = request.open_spots
    game.intensity = request.intensity
    game.minimum_experience = request.minimum_experience
    game.position_mask = positions_to_mask(request.positions)
    game.aa_cents = request.aa_cents
    game.registration_deadline = request.registration_deadline
    game.equipment_and_arrival_notes = request.equipment_and_arrival_notes
    game.visibility = request.visibility
    game.version += 1


def _validate_update_roster(
    *,
    game: OpenGame,
    request: UpdateOpenGameRequest,
    joined_count: int,
    has_active_waitlist: bool = False,
) -> None:
    errors: list[OpenGameFieldError] = []
    if has_active_waitlist:
        errors.append(
            OpenGameFieldError(
                "open_spots",
                "存在候补成员时不能修改开放名额。",
            )
        )
    elif request.open_spots < joined_count:
        errors.append(
            OpenGameFieldError("open_spots", "不能小于已加入人数。")
        )
    if (
        request.fixed_players + request.open_spots > request.total_players
        or request.total_players < request.fixed_players + joined_count
    ):
        errors.append(
            OpenGameFieldError(
                "total_players",
                "不能小于固定人数与已加入人数之和。",
            )
        )
    if joined_count > 0 and request.aa_cents > game.aa_cents:
        errors.append(
            OpenGameFieldError(
                "aa_cents",
                "已有加入成员后预计 AA 只能保持或降低。",
            )
        )
    if errors:
        raise OpenGameValidationError(
            "joined open-game invariants would be violated",
            *errors,
        )


def project_authoritative_public_game(
    *,
    game: OpenGame,
    order: Order,
    authority: OrderAuthorityRows,
    order_row: OpenGameOrderRow,
    team: Team,
    now: datetime,
) -> AuthoritativePublicGameProjection:
    """Project B2 public data from already-loaded B1 authority without I/O."""
    order_facts = _order_facts(order, order_row, authority)
    facts = OpenGameFacts(
        stored_status=game.status,
        order_facts=order_facts,
        registration_deadline=game.registration_deadline,
    )
    state = project_open_game_state(facts)
    reason = project_open_game_reason(facts, now=now)
    public = project_open_game_public(
        name=game.name,
        team_name=team.name,
        state=state,
        state_reason=reason,
        venue_name=order_row.venue_name,
        pitch_name=order_row.pitch_name,
        players_per_side=order_row.players_per_side,
        starts_at=order_row.starts_at,
        ends_at=order_row.ends_at,
        time_zone=_require_time_zone(order_row),
        total_players=game.total_players,
        fixed_players=game.fixed_players,
        open_spots=game.open_spots,
        intensity=game.intensity,
        minimum_experience=game.minimum_experience,
        positions=mask_to_positions(game.position_mask),
        aa_cents=game.aa_cents,
        registration_deadline=game.registration_deadline,
        equipment_and_arrival_notes=game.equipment_and_arrival_notes,
        visibility=game.visibility,
    )
    return AuthoritativePublicGameProjection(
        public=public,
        facts=facts,
        state=state,
        starts_at=order_row.starts_at,
        owner_user_id=order.user_id,
    )


def _order_facts(
    order: Order,
    order_row: OpenGameOrderRow,
    authority: OrderAuthorityRows,
) -> OrderLifecycleFacts:
    controlling_cases = [
        refund_case
        for refund_case in authority.refund_cases
        if refund_case.purpose in _CONTROLLING_REFUND_PURPOSES
    ]
    controlling_refund_purpose = (
        max(
            controlling_cases,
            key=lambda refund_case: (refund_case.created_at, refund_case.id),
        ).purpose
        if controlling_cases
        else None
    )
    return OrderLifecycleFacts(
        status=order.status,
        starts_at=order_row.starts_at,
        ends_at=order_row.ends_at,
        cancel_requested_at=order.cancel_requested_at,
        checked_in_at=order.checked_in_at,
        payment_may_exist=any(
            payment.status in _PAYMENT_MAY_EXIST for payment in authority.payments
        ),
        controlling_refund_purpose=controlling_refund_purpose,
    )


def _order_summary(row: OpenGameOrderRow) -> OpenGameOrderSummary:
    return OpenGameOrderSummary(
        venue_name=row.venue_name,
        pitch_name=row.pitch_name,
        pitch_specification=f"{row.players_per_side}人制",
        players_per_side=row.players_per_side,
        booking_price_cents=row.booking_price_cents,
        starts_at=row.starts_at,
        ends_at=row.ends_at,
        time_zone=_require_time_zone(row),
    )


def _require_time_zone(row: OpenGameOrderRow) -> str:
    if row.time_zone is None:
        raise RuntimeError("venue time zone is missing")
    ZoneInfo(row.time_zone)
    return row.time_zone


def _request_digest(
    *,
    operation: str,
    resource_id: uuid.UUID,
    request: CreateOpenGameRequest | UpdateOpenGameRequest | OpenGameVersionRequest,
) -> str:
    payload = {
        "operation": operation,
        "resource_id": str(resource_id),
        "body": request.model_dump(mode="json"),
        "version": 1,
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


def _replay_owner(
    record: IdempotencyRecord,
    *,
    digest: str,
    status_code: int,
) -> OpenGameOwner:
    if record.request_sha256 != digest:
        raise AppError(
            409,
            "IDEMPOTENCY_KEY_REUSED",
            "该幂等键已用于其他请求，请生成新键后重试。",
        )
    if (
        record.state is not IdempotencyState.COMPLETED
        or record.response_status != status_code
        or record.response_body is None
    ):
        raise _service_unavailable()
    return OpenGameOwner.model_validate(record.response_body)


def _validation_error(error: OpenGameValidationError) -> AppError:
    if error.fields:
        deadline_only = all(
            item.field == "registration_deadline" for item in error.fields
        )
        return AppError(
            422,
            "INVALID_ARGUMENT",
            (
                "报名截止时间不符合要求，请修改后重试。"
                if deadline_only
                else "球局已有加入成员，开放容量或预计 AA 不符合要求。"
            ),
            details={
                "fields": [
                    {
                        "field": item.field,
                        "message": item.message,
                    }
                    for item in error.fields
                ]
            },
        )
    return AppError(409, "ORDER_NOT_ELIGIBLE", "该订单当前不可创建或编辑球局。")


def _order_not_found() -> AppError:
    return AppError(404, "ORDER_NOT_FOUND", "订单不存在。")


def _game_not_found() -> AppError:
    return AppError(404, "OPEN_GAME_NOT_FOUND", "球局不存在。")


def _active_game_exists() -> AppError:
    return AppError(409, "OPEN_GAME_ALREADY_EXISTS", "该订单已有未取消球局。")


def _state_changed() -> AppError:
    return AppError(409, "OPEN_GAME_STATE_CHANGED", "球局状态已变化，请刷新后重试。")


def _service_unavailable() -> AppError:
    return AppError(503, "SERVICE_UNAVAILABLE", "球局服务暂不可用，请稍后重试。")
