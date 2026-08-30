"""Applicant context and idempotent apply transaction for shared open games."""

import base64
import binascii
import hashlib
import json
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from zoneinfo import ZoneInfoNotFoundError

from pydantic import ValidationError
from sqlalchemy.exc import SQLAlchemyError

from backend.app.errors import AppError
from backend.app.models import (
    IdempotencyRecord,
    IdempotencyState,
    OpenGame,
    OpenGameNotificationEvent,
    OpenGameNotificationOutbox,
    OpenGameNotificationStatus,
    OpenGameRegistration,
    OpenGameRegistrationStatus,
    OpenGameRegistrationWithdrawalKind,
    OpenGameStatus,
    Order,
    WaitlistPromotedNotificationPayload,
)
from backend.app.modules.open_game_registrations.dto import (
    OPEN_GAME_REGISTRATION_CONSENT_VERSION,
    ApplicationDecision,
    CreateApplicationRequest,
    DecisionRequest,
    DecisionResult,
    DecisionResultStatus,
    MyOpenGameApplication,
    MyOpenGameApplicationsResponse,
    Queue,
    RegistrationContext,
    WithdrawalRequest,
)
from backend.app.modules.open_game_registrations.lifecycle import (
    RegistrationFacts,
    ReviewBlockedReason,
    WaitlistBlockedReason,
    WithdrawalAction,
    project_apply_actions,
    project_available_withdrawal,
    project_review_actions,
    remaining_spots,
)
from backend.app.modules.open_game_registrations.privacy import (
    project_captain_application,
    project_captain_waitlist_application,
    project_my_open_game_application,
    project_viewer_registration,
)
from backend.app.modules.open_game_registrations.repository import (
    OpenGameRegistrationRepository,
    RegistrationApplicantConflictError,
)
from backend.app.modules.open_games.lifecycle import (
    EffectiveOpenGameState,
    OpenGameProjectionInvariantError,
    published_authority_is_healthy,
)
from backend.app.modules.open_games.repository import (
    OpenGameOrderRow,
    OpenGameRepository,
    OrderAuthorityRows,
)
from backend.app.modules.open_games.service import (
    AuthoritativePublicGameProjection,
    project_authoritative_public_game,
)
from backend.app.modules.orders.repository import OrderRepository

CREATE_OPEN_GAME_APPLICATION_OPERATION = "create_open_game_application"
DECIDE_OPEN_GAME_APPLICATION_OPERATION = "decide_open_game_application"
WITHDRAW_OPEN_GAME_APPLICATION_OPERATION = "withdraw_open_game_application"


class OpenGameRegistrationService:
    def __init__(
        self,
        *,
        repository: OpenGameRegistrationRepository,
        open_game_repository: OpenGameRepository,
        order_repository: OrderRepository,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        session = repository.session
        if (
            open_game_repository.session is not session
            or order_repository.session is not session
        ):
            raise ValueError(
                "registration, open-game and order repositories must share one Session"
            )
        self._repository = repository
        self._open_game_repository = open_game_repository
        self._order_repository = order_repository
        self._now = now or (lambda: datetime.now(UTC))

    def get_context(
        self,
        *,
        share_token: str,
        viewer_user_id: uuid.UUID | None,
    ) -> RegistrationContext:
        try:
            game = self._open_game_repository.get_by_share_token(
                share_token=share_token
            )
            if game is None:
                raise _game_not_found()
            order = game.order
            authority = self._open_game_repository.get_order_authority(
                order_id=order.id
            )
            order_row = self._require_order_row(order.id)
            now = self._now()
            projection = self._project_game(
                game=game,
                order=order,
                authority=authority,
                order_row=order_row,
                now=now,
            )
            joined_count = self._repository.count_joined(game_id=game.id)
            registration = (
                self._repository.get_registration(
                    game_id=game.id,
                    applicant_user_id=viewer_user_id,
                )
                if viewer_user_id is not None
                else None
            )
            waitlist_position = (
                self._repository.get_waitlist_position(
                    game_id=game.id,
                    application_id=registration.id,
                    waitlist_seq=registration.waitlist_seq,
                )
                if registration is not None
                and registration.status is OpenGameRegistrationStatus.WAITLISTED
                and registration.waitlist_seq is not None
                else None
            )
            return _project_context(
                game=game,
                projection=projection,
                viewer_user_id=viewer_user_id,
                registration=registration,
                joined_count=joined_count,
                now=now,
                waitlist_position=waitlist_position,
            )
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

    def list_my_applications(
        self,
        *,
        applicant_user_id: uuid.UUID,
        limit: int,
        cursor: str | None,
    ) -> MyOpenGameApplicationsResponse:
        try:
            if not 1 <= limit <= 50:
                raise _invalid_argument()
            cursor_applied_at, cursor_id = _decode_my_applications_cursor(cursor)
            rows = self._repository.list_mine(
                applicant_user_id=applicant_user_id,
                limit=limit + 1,
                cursor_applied_at=cursor_applied_at,
                cursor_id=cursor_id,
            )
            now = self._now()
            items = tuple(
                self._project_my_application(
                    row.registration,
                    now=now,
                    waitlist_position=row.waitlist_position,
                )
                for row in rows
            )
            next_cursor = (
                _encode_my_applications_cursor(items[limit - 1])
                if len(rows) > limit
                else None
            )
            return MyOpenGameApplicationsResponse(
                items=items[:limit],
                next_cursor=next_cursor,
            )
        except AppError:
            self._repository.rollback()
            raise
        except (
            AttributeError,
            SQLAlchemyError,
            OpenGameProjectionInvariantError,
            ValidationError,
            ValueError,
            RuntimeError,
            ZoneInfoNotFoundError,
        ):
            self._repository.rollback()
            raise _service_unavailable() from None

    def apply(
        self,
        *,
        share_token: str,
        applicant_user_id: uuid.UUID,
        idempotency_key: str,
        request: CreateApplicationRequest,
    ) -> RegistrationContext:
        try:
            proof = self._open_game_repository.get_by_share_token(
                share_token=share_token
            )
            if proof is None:
                raise _game_not_found()
            order = self._repository.lock_order(order_id=proof.order_id)
            if order is None:
                raise _game_not_found()
            game = self._open_game_repository.lock_target_game(
                game_id=proof.id,
                order_id=order.id,
            )
            if (
                game is None
                or game.share_token != share_token
                or game.published_at is None
            ):
                raise _game_not_found()

            digest = _application_request_digest(
                operation=CREATE_OPEN_GAME_APPLICATION_OPERATION,
                share_token=share_token,
                resolved_game_id=game.id,
                request=request,
            )
            record, claimed = self._order_repository.claim_idempotency(
                user_id=applicant_user_id,
                operation=CREATE_OPEN_GAME_APPLICATION_OPERATION,
                key=idempotency_key,
                request_sha256=digest,
            )
            if not claimed:
                existing = self._repository.get_registration(
                    game_id=game.id,
                    applicant_user_id=applicant_user_id,
                )
                replay = _replay_context(
                    record,
                    digest=digest,
                    legacy_application_id=(
                        existing.id if existing is not None else None
                    ),
                )
                self._order_repository.commit()
                return replay

            authority = self._open_game_repository.lock_order_authority(
                order_id=order.id
            )
            order_row = self._require_order_row(order.id)
            now = self._now()
            projection = self._project_game(
                game=game,
                order=order,
                authority=authority,
                order_row=order_row,
                now=now,
            )
            existing = self._repository.get_registration(
                game_id=game.id,
                applicant_user_id=applicant_user_id,
            )
            if existing is not None:
                raise _application_already_exists()
            joined_count = self._repository.count_joined(game_id=game.id)
            before = _project_context(
                game=game,
                projection=projection,
                viewer_user_id=applicant_user_id,
                registration=None,
                joined_count=joined_count,
                now=now,
            )
            if not before.allowed_actions.can_apply:
                blocker = before.allowed_actions.apply_blocked_reason
                if blocker is None:
                    raise RuntimeError("blocked apply projection has no blocker")
                raise AppError(
                    409,
                    "APPLICATION_NOT_ALLOWED",
                    "当前球局暂不允许提交申请。",
                    details={
                        "apply_blocked_reason": blocker.value,
                        "remaining_spots": before.remaining_spots,
                    },
                )

            registration = OpenGameRegistration(
                id=uuid.uuid4(),
                game_id=game.id,
                applicant_user_id=applicant_user_id,
                display_name=request.display_name,
                position=request.position,
                note=request.note,
                status=OpenGameRegistrationStatus.APPLIED,
                version=1,
                consent_version=OPEN_GAME_REGISTRATION_CONSENT_VERSION,
                adult_confirmed_at=now,
                risk_confirmed_at=now,
                applied_at=now,
                decided_at=None,
                decided_by_user_id=None,
                withdrawn_at=None,
                withdrawal_kind=None,
                late_exit_recorded=False,
            )
            self._repository.add_registration(registration)
            response = _project_context(
                game=game,
                projection=projection,
                viewer_user_id=applicant_user_id,
                registration=registration,
                joined_count=joined_count,
                now=now,
            )
            self._order_repository.complete_idempotency(
                record,
                response_status=201,
                response_body=response.model_dump(mode="json"),
            )
            self._order_repository.commit()
            return response
        except RegistrationApplicantConflictError:
            self._repository.rollback()
            raise _application_already_exists() from None
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

    def get_queue(
        self,
        *,
        game_id: uuid.UUID,
        owner_user_id: uuid.UUID,
    ) -> Queue:
        try:
            order_id = self._open_game_repository.locate_order_id(game_id=game_id)
            if order_id is None:
                raise _game_not_found()
            order = self._open_game_repository.get_owned_order(
                order_id=order_id,
                user_id=owner_user_id,
            )
            if order is None:
                raise _game_not_found()
            game = self._open_game_repository.get_owned_game(
                game_id=game_id,
                user_id=owner_user_id,
            )
            if game is None:
                raise _game_not_found()

            authority = self._open_game_repository.get_order_authority(
                order_id=order.id
            )
            order_row = self._require_order_row(order.id)
            now = self._now()
            projection = self._project_game(
                game=game,
                order=order,
                authority=authority,
                order_row=order_row,
                now=now,
            )
            joined_count = self._repository.count_joined(game_id=game.id)
            rows = self._repository.list_pending(game_id=game.id)
            waitlisted_rows = self._repository.list_waitlisted(game_id=game.id)
            facts = _registration_facts(
                game=game,
                projection=projection,
                viewer_user_id=owner_user_id,
                viewer_has_registration=False,
                joined_count=joined_count,
            )
            applications = tuple(
                project_captain_application(
                    application_id=row.id,
                    display_name=row.display_name,
                    position=row.position,
                    note=row.note,
                    applied_at=row.applied_at,
                    version=row.version,
                    allowed_actions=project_review_actions(
                        facts,
                        row.status,
                        now,
                    ),
                )
                for row in rows
            )
            waitlist = tuple(
                project_captain_waitlist_application(
                    application_id=row.id,
                    display_name=row.display_name,
                    position=row.position,
                    note=row.note,
                    applied_at=row.applied_at,
                    waitlisted_at=row.waitlisted_at,
                    waitlist_position=index,
                )
                for index, row in enumerate(waitlisted_rows, start=1)
                if row.waitlisted_at is not None
            )
            if len(waitlist) != len(waitlisted_rows):
                raise RuntimeError("WAITLISTED row is missing waitlisted_at")
            return Queue(
                remaining_spots=remaining_spots(
                    open_spots=game.open_spots,
                    joined_count=joined_count,
                ),
                pending_count=len(applications),
                applications=applications,
                waitlist_count=len(waitlist),
                waitlist=waitlist,
            )
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

    def withdraw(
        self,
        *,
        application_id: uuid.UUID,
        applicant_user_id: uuid.UUID,
        idempotency_key: str,
        request: WithdrawalRequest,
    ) -> RegistrationContext:
        if not isinstance(request.action, WithdrawalAction):
            raise _invalid_argument()
        try:
            target = self._repository.locate_withdrawal_target(
                application_id=application_id,
                applicant_user_id=applicant_user_id,
            )
            if target is None:
                raise _application_not_found()
            order = self._repository.lock_order(order_id=target.order_id)
            if order is None:
                raise _application_not_found()
            game = self._open_game_repository.lock_target_game(
                game_id=target.game_id,
                order_id=order.id,
            )
            if game is None:
                raise _application_not_found()
            registration = self._repository.lock_self_registration(
                game_id=game.id,
                application_id=application_id,
                applicant_user_id=applicant_user_id,
            )
            if registration is None:
                raise _application_not_found()

            digest = _withdrawal_request_digest(
                operation=WITHDRAW_OPEN_GAME_APPLICATION_OPERATION,
                application_id=registration.id,
                resolved_game_id=game.id,
                request=request,
            )
            record, claimed = self._order_repository.claim_idempotency(
                user_id=applicant_user_id,
                operation=WITHDRAW_OPEN_GAME_APPLICATION_OPERATION,
                key=idempotency_key,
                request_sha256=digest,
            )
            if not claimed:
                replay = _replay_withdrawal(record, digest=digest)
                self._order_repository.commit()
                return replay

            authority = self._open_game_repository.lock_order_authority(
                order_id=order.id
            )
            order_row = self._require_order_row(order.id)
            now = self._now()
            projection = self._project_game(
                game=game,
                order=order,
                authority=authority,
                order_row=order_row,
                now=now,
            )
            joined_before = self._repository.count_joined(game_id=game.id)
            available = project_available_withdrawal(
                persisted_status=registration.status,
                game_state=projection.state,
                starts_at=projection.starts_at,
                now=now,
            )
            if (
                registration.version != request.expected_version
                or available.action is None
                or available.action.value != request.action.value
            ):
                raise _application_state_changed()

            should_promote = (
                request.action is WithdrawalAction.LEAVE_GAME
                and registration.status is OpenGameRegistrationStatus.JOINED
                and joined_before == game.open_spots
                and game.status is OpenGameStatus.PUBLISHED
                and projection.state is EffectiveOpenGameState.PUBLISHED
                and published_authority_is_healthy(
                    projection.facts.order_facts
                )
                and now < projection.starts_at
            )

            registration.status = OpenGameRegistrationStatus.WITHDRAWN
            registration.version += 1
            registration.withdrawn_at = now
            if request.action is WithdrawalAction.WITHDRAW_APPLICATION:
                registration.withdrawal_kind = (
                    OpenGameRegistrationWithdrawalKind.APPLICATION_WITHDRAWAL
                )
            elif request.action is WithdrawalAction.WITHDRAW_WAITLIST:
                registration.withdrawal_kind = (
                    OpenGameRegistrationWithdrawalKind.WAITLIST_WITHDRAWAL
                )
            elif request.action is WithdrawalAction.LEAVE_GAME:
                registration.withdrawal_kind = (
                    OpenGameRegistrationWithdrawalKind.GAME_EXIT
                )
            else:
                raise RuntimeError("withdrawal request contains an unsupported action")
            registration.late_exit_recorded = (
                available.late_exit_will_be_recorded
            )
            self._repository.flush()
            if should_promote:
                promoted = self._repository.lock_fifo_waitlisted(
                    game_id=game.id
                )
                if promoted is not None:
                    promoted.status = OpenGameRegistrationStatus.JOINED
                    promoted.version += 1
                    promoted.promoted_at = now
                    promoted.withdrawn_at = None
                    promoted.withdrawal_kind = None
                    promoted.late_exit_recorded = False
                    payload: WaitlistPromotedNotificationPayload = {
                        "game_name": game.name,
                        "starts_at": projection.starts_at.isoformat(),
                        "venue_name": order_row.venue_name,
                    }
                    self._repository.add_notification(
                        OpenGameNotificationOutbox(
                            dedupe_key=(
                                f"waitlist-promoted:{promoted.id}:"
                                f"{promoted.version}"
                            ),
                            game_id=game.id,
                            registration_id=promoted.id,
                            recipient_user_id=promoted.applicant_user_id,
                            event=OpenGameNotificationEvent.WAITLIST_PROMOTED,
                            template_key="waitlist-promoted",
                            status=OpenGameNotificationStatus.PENDING,
                            payload=payload,
                            attempt_count=0,
                            available_at=now,
                            claim_token=None,
                            lease_until=None,
                            completed_at=None,
                            last_failure_code=None,
                        )
                    )
                    self._repository.flush()
            joined_count = self._repository.count_joined(game_id=game.id)
            response = _project_context(
                game=game,
                projection=projection,
                viewer_user_id=applicant_user_id,
                registration=registration,
                joined_count=joined_count,
                now=now,
            )
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

    def decide(
        self,
        *,
        game_id: uuid.UUID,
        application_id: uuid.UUID,
        owner_user_id: uuid.UUID,
        idempotency_key: str,
        request: DecisionRequest,
    ) -> DecisionResult:
        if not isinstance(request.decision, ApplicationDecision):
            raise _invalid_argument()
        try:
            order_id = self._open_game_repository.locate_order_id(game_id=game_id)
            if order_id is None:
                raise _game_not_found()
            order = self._repository.lock_order(order_id=order_id)
            if order is None or order.user_id != owner_user_id:
                raise _game_not_found()
            game = self._open_game_repository.lock_target_game(
                game_id=game_id,
                order_id=order.id,
            )
            if game is None:
                raise _game_not_found()
            registration = self._repository.lock_registration(
                game_id=game.id,
                application_id=application_id,
            )
            if registration is None:
                raise _application_not_found()

            digest = _decision_request_digest(
                operation=DECIDE_OPEN_GAME_APPLICATION_OPERATION,
                game_id=game.id,
                application_id=registration.id,
                request=request,
            )
            record, claimed = self._order_repository.claim_idempotency(
                user_id=owner_user_id,
                operation=DECIDE_OPEN_GAME_APPLICATION_OPERATION,
                key=idempotency_key,
                request_sha256=digest,
            )
            if not claimed:
                replay = _replay_decision(record, digest=digest)
                self._order_repository.commit()
                return replay

            authority = self._open_game_repository.lock_order_authority(
                order_id=order.id
            )
            order_row = self._require_order_row(order.id)
            now = self._now()
            projection = self._project_game(
                game=game,
                order=order,
                authority=authority,
                order_row=order_row,
                now=now,
            )
            if request.decision is ApplicationDecision.WAITLIST and (
                game.status is not OpenGameStatus.PUBLISHED
                or projection.state is not EffectiveOpenGameState.PUBLISHED
                or not published_authority_is_healthy(
                    projection.facts.order_facts
                )
            ):
                raise _application_state_changed()
            joined_count = self._repository.count_joined(game_id=game.id)
            facts = _registration_facts(
                game=game,
                projection=projection,
                viewer_user_id=owner_user_id,
                viewer_has_registration=True,
                joined_count=joined_count,
            )
            actions = project_review_actions(
                facts,
                registration.status,
                now,
            )
            if (
                registration.status is not OpenGameRegistrationStatus.APPLIED
                or registration.version != request.expected_version
                or not actions.can_reject
            ):
                raise _application_state_changed()
            if request.decision is ApplicationDecision.ACCEPT and not actions.can_accept:
                if actions.accept_blocked_reason is not ReviewBlockedReason.GAME_FULL:
                    raise RuntimeError("accept projection has an unexpected blocker")
                raise AppError(
                    409,
                    "APPLICATION_CAPACITY_CHANGED",
                    "剩余名额已变化，请刷新报名队列。",
                    details={
                        "remaining_spots": remaining_spots(
                            open_spots=game.open_spots,
                            joined_count=joined_count,
                        ),
                        "allowed_actions": actions.model_dump(mode="json"),
                    },
                )
            if (
                request.decision is ApplicationDecision.WAITLIST
                and not actions.can_waitlist
            ):
                if (
                    actions.waitlist_blocked_reason
                    is not WaitlistBlockedReason.GAME_NOT_FULL
                ):
                    raise RuntimeError("waitlist projection has an unexpected blocker")
                raise AppError(
                    409,
                    "APPLICATION_CAPACITY_CHANGED",
                    "剩余名额已变化，请刷新报名队列。",
                    details={
                        "remaining_spots": remaining_spots(
                            open_spots=game.open_spots,
                            joined_count=joined_count,
                        ),
                        "allowed_actions": actions.model_dump(mode="json"),
                    },
                )

            if request.decision is ApplicationDecision.ACCEPT:
                accepted = True
                registration.status = OpenGameRegistrationStatus.JOINED
            elif request.decision is ApplicationDecision.REJECT:
                accepted = False
                registration.status = OpenGameRegistrationStatus.REJECTED
            elif request.decision is ApplicationDecision.WAITLIST:
                accepted = False
                next_waitlist_seq = self._repository.next_waitlist_seq(
                    game_id=game.id
                )
                registration.status = OpenGameRegistrationStatus.WAITLISTED
                registration.waitlist_seq = next_waitlist_seq
                registration.waitlisted_at = now
                registration.promoted_at = None
            else:
                raise RuntimeError("decision request contains an unsupported action")
            registration.version += 1
            registration.decided_at = now
            registration.decided_by_user_id = owner_user_id
            self._repository.flush()

            result_joined_count = joined_count + 1 if accepted else joined_count
            terminal_facts = _registration_facts(
                game=game,
                projection=projection,
                viewer_user_id=owner_user_id,
                viewer_has_registration=True,
                joined_count=result_joined_count,
            )
            response = DecisionResult(
                application_id=registration.id,
                status=DecisionResultStatus(registration.status.value),
                version=registration.version,
                decided_at=registration.decided_at,
                remaining_spots=remaining_spots(
                    open_spots=game.open_spots,
                    joined_count=result_joined_count,
                ),
                allowed_actions=project_review_actions(
                    terminal_facts,
                    registration.status,
                    now,
                ),
            )
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

    def _require_order_row(self, order_id: uuid.UUID) -> OpenGameOrderRow:
        row = self._open_game_repository.get_order_row(order_id=order_id)
        if row is None:
            raise RuntimeError("open-game order graph is missing")
        return row

    def _project_game(
        self,
        *,
        game: OpenGame,
        order: Order,
        authority: OrderAuthorityRows,
        order_row: OpenGameOrderRow,
        now: datetime,
    ) -> AuthoritativePublicGameProjection:
        team = self._open_game_repository.get_team(team_id=game.team_id)
        if team is None:
            raise RuntimeError("open game team is missing")
        return project_authoritative_public_game(
            game=game,
            order=order,
            authority=authority,
            order_row=order_row,
            team=team,
            now=now,
        )

    def _project_my_application(
        self,
        registration: OpenGameRegistration,
        *,
        now: datetime,
        waitlist_position: int | None,
    ) -> MyOpenGameApplication:
        game = registration.game
        if game.published_at is None:
            raise RuntimeError("registration game was never published")
        order = game.order
        slot = order.slot
        pitch = slot.pitch
        venue = pitch.venue
        authority = OrderAuthorityRows(
            payments=tuple(sorted(order.payments, key=lambda row: row.id)),
            refund_cases=tuple(
                sorted(order.refund_cases, key=lambda row: (row.created_at, row.id))
            ),
            refund_attempts=tuple(
                sorted(
                    (
                        attempt
                        for refund_case in order.refund_cases
                        for attempt in refund_case.attempts
                    ),
                    key=lambda row: (row.refund_case_id, row.attempt_no, row.id),
                )
            ),
        )
        order_row = OpenGameOrderRow(
            venue_name=venue.name,
            pitch_name=pitch.name,
            players_per_side=pitch.players_per_side,
            booking_price_cents=order.price_cents,
            starts_at=slot.starts_at,
            ends_at=slot.ends_at,
            time_zone=venue.timezone,
        )
        projection = project_authoritative_public_game(
            game=game,
            order=order,
            authority=authority,
            order_row=order_row,
            team=game.team,
            now=now,
        )
        return project_my_open_game_application(
            application_id=registration.id,
            persisted_status=registration.status,
            applied_at=registration.applied_at,
            share_token=game.share_token,
            projection=projection,
            waitlist_position=waitlist_position,
            waitlisted_at=registration.waitlisted_at,
            promoted_at=registration.promoted_at,
            attendance_status=registration.attendance_status,
            attendance_recorded_at=registration.attendance_recorded_at,
        )


def _project_context(
    *,
    game: OpenGame,
    projection: AuthoritativePublicGameProjection,
    viewer_user_id: uuid.UUID | None,
    registration: OpenGameRegistration | None,
    joined_count: int,
    now: datetime,
    waitlist_position: int | None = None,
) -> RegistrationContext:
    facts = _registration_facts(
        game=game,
        projection=projection,
        viewer_user_id=viewer_user_id,
        viewer_has_registration=registration is not None,
        joined_count=joined_count,
    )
    viewer_registration = (
        project_viewer_registration(
            application_id=registration.id,
            display_name=registration.display_name,
            position=registration.position,
            note=registration.note,
            persisted_status=registration.status,
            game_state=projection.state,
            version=registration.version,
            applied_at=registration.applied_at,
            decided_at=registration.decided_at,
            withdrawn_at=registration.withdrawn_at,
            withdrawal_kind=registration.withdrawal_kind,
            late_exit_recorded=registration.late_exit_recorded,
            starts_at=projection.starts_at,
            now=now,
            waitlist_position=waitlist_position,
            waitlisted_at=registration.waitlisted_at,
            promoted_at=registration.promoted_at,
            attendance_status=registration.attendance_status,
            attendance_recorded_at=registration.attendance_recorded_at,
        )
        if registration is not None
        else None
    )
    return RegistrationContext(
        game=projection.public,
        remaining_spots=remaining_spots(
            open_spots=game.open_spots,
            joined_count=joined_count,
        ),
        viewer_authenticated=viewer_user_id is not None,
        viewer_registration=viewer_registration,
        allowed_actions=project_apply_actions(facts, now),
    )


def _registration_facts(
    *,
    game: OpenGame,
    projection: AuthoritativePublicGameProjection,
    viewer_user_id: uuid.UUID | None,
    viewer_has_registration: bool,
    joined_count: int,
) -> RegistrationFacts:
    return RegistrationFacts(
        game_state=projection.state,
        stored_game_status=game.status,
        viewer_authenticated=viewer_user_id is not None,
        viewer_is_owner=viewer_user_id == projection.owner_user_id,
        viewer_has_registration=viewer_has_registration,
        registration_deadline=game.registration_deadline,
        starts_at=projection.starts_at,
        open_spots=game.open_spots,
        joined_count=joined_count,
    )


def _application_request_digest(
    *,
    operation: str,
    share_token: str,
    resolved_game_id: uuid.UUID,
    request: CreateApplicationRequest,
) -> str:
    payload = {
        "operation": operation,
        "share_token": share_token,
        "resolved_game_id": str(resolved_game_id),
        "body": request.model_dump(mode="json"),
        "version": 1,
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


def _decision_request_digest(
    *,
    operation: str,
    game_id: uuid.UUID,
    application_id: uuid.UUID,
    request: DecisionRequest,
) -> str:
    payload = {
        "operation": operation,
        "game_id": str(game_id),
        "application_id": str(application_id),
        "decision": request.decision.value,
        "expected_version": request.expected_version,
        "version": 1,
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


def _withdrawal_request_digest(
    *,
    operation: str,
    application_id: uuid.UUID,
    resolved_game_id: uuid.UUID,
    request: WithdrawalRequest,
) -> str:
    payload = {
        "operation": operation,
        "application_id": str(application_id),
        "resolved_game_id": str(resolved_game_id),
        "action": request.action.value,
        "expected_version": request.expected_version,
        "version": 1,
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


def _encode_my_applications_cursor(application: MyOpenGameApplication) -> str:
    serialized = application.model_dump(mode="json")
    payload = json.dumps(
        {
            "v": 1,
            "applied_at": serialized["applied_at"],
            "id": serialized["id"],
        },
        separators=(",", ":"),
    ).encode()
    return base64.urlsafe_b64encode(payload).decode().rstrip("=")


def _decode_my_applications_cursor(
    cursor: str | None,
) -> tuple[datetime | None, uuid.UUID | None]:
    if cursor is None:
        return None, None
    if not cursor or any(
        character not in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
        for character in cursor
    ):
        raise _invalid_argument()
    try:
        decoded = base64.b64decode(
            cursor + "=" * (-len(cursor) % 4),
            altchars=b"-_",
            validate=True,
        )
        if base64.urlsafe_b64encode(decoded).decode().rstrip("=") != cursor:
            raise ValueError("cursor is not canonical base64url")
        payload = json.loads(decoded)
        if not isinstance(payload, dict) or set(payload) != {"v", "applied_at", "id"}:
            raise ValueError("cursor object is not exact")
        if type(payload["v"]) is not int or payload["v"] != 1:
            raise ValueError("cursor version is unsupported")
        if not isinstance(payload["applied_at"], str) or not isinstance(
            payload["id"], str
        ):
            raise ValueError("cursor key types are invalid")
        applied_at = datetime.fromisoformat(payload["applied_at"])
        if applied_at.tzinfo is None or applied_at.utcoffset() is None:
            raise ValueError("cursor timestamp must be aware")
        application_id = uuid.UUID(payload["id"])
    except (
        binascii.Error,
        json.JSONDecodeError,
        UnicodeDecodeError,
        ValueError,
    ):
        raise _invalid_argument() from None
    return applied_at, application_id


def _replay_context(
    record: IdempotencyRecord,
    *,
    digest: str,
    legacy_application_id: uuid.UUID | None = None,
) -> RegistrationContext:
    if record.request_sha256 != digest:
        raise AppError(
            409,
            "IDEMPOTENCY_KEY_REUSED",
            "该幂等键已用于其他请求，请生成新键后重试。",
        )
    if (
        record.state is not IdempotencyState.COMPLETED
        or record.response_status != 201
        or record.response_body is None
    ):
        raise _service_unavailable()
    try:
        return RegistrationContext.model_validate(record.response_body)
    except ValidationError:
        return RegistrationContext.model_validate(
            _upgrade_legacy_application_context(
                record.response_body,
                application_id=legacy_application_id,
            )
        )


def _upgrade_legacy_application_context(
    response_body: dict[str, object],
    *,
    application_id: uuid.UUID | None,
) -> dict[str, object]:
    """Upgrade only trusted historic registration-context response shapes."""
    if set(response_body) != {
        "game",
        "remaining_spots",
        "viewer_authenticated",
        "viewer_registration",
        "allowed_actions",
    }:
        raise ValueError("legacy application response is not recoverable")
    viewer = response_body.get("viewer_registration")
    if not isinstance(viewer, dict):
        raise ValueError("legacy application viewer is not an object")
    c1a_fields = {
        "display_name",
        "position",
        "note",
        "persisted_status",
        "effective_status",
        "applied_at",
        "decided_at",
    }
    c2a_fields = {
        "id",
        "display_name",
        "position",
        "note",
        "persisted_status",
        "effective_status",
        "version",
        "applied_at",
        "decided_at",
        "withdrawn_at",
        "withdrawal_kind",
        "late_exit_recorded",
        "available_withdrawal_action",
        "late_exit_will_be_recorded",
    }
    c2b_fields = c2a_fields | {
        "waitlist_position",
        "waitlisted_at",
        "promoted_at",
    }

    upgraded_viewer = dict(viewer)
    if set(viewer) == c1a_fields:
        if (
            application_id is None
            or response_body.get("viewer_authenticated") is not True
            or viewer.get("persisted_status") != "APPLIED"
            or viewer.get("effective_status") != "APPLIED"
            or viewer.get("decided_at") is not None
        ):
            raise ValueError("legacy application viewer is not an apply result")
        upgraded_viewer.update({
            "id": str(application_id),
            "version": 1,
            "withdrawn_at": None,
            "withdrawal_kind": None,
            "late_exit_recorded": False,
            "available_withdrawal_action": None,
            "late_exit_will_be_recorded": False,
        })
    elif frozenset(viewer) not in {
        frozenset(c2a_fields),
        frozenset(c2b_fields),
    }:
        raise ValueError("legacy application viewer is not exact")
    if set(viewer) != c2b_fields:
        upgraded_viewer.update(
            {
                "waitlist_position": None,
                "waitlisted_at": None,
                "promoted_at": None,
            }
        )
    upgraded_viewer.update(
        {
            "attendance_status": None,
            "attendance_recorded_at": None,
        }
    )
    upgraded = dict(response_body)
    upgraded["viewer_registration"] = upgraded_viewer
    return upgraded


def _replay_decision(
    record: IdempotencyRecord,
    *,
    digest: str,
) -> DecisionResult:
    if record.request_sha256 != digest:
        raise _idempotency_key_reused()
    if (
        record.state is not IdempotencyState.COMPLETED
        or record.response_status != 200
        or record.response_body is None
    ):
        raise _service_unavailable()
    try:
        return DecisionResult.model_validate(record.response_body)
    except ValidationError:
        body = dict(record.response_body)
        actions = body.get("allowed_actions")
        if not isinstance(actions, dict):
            raise ValueError("legacy decision actions are not an object") from None
        body["allowed_actions"] = _upgrade_legacy_review_actions(actions)
        return DecisionResult.model_validate(body)


def _replay_withdrawal(
    record: IdempotencyRecord,
    *,
    digest: str,
) -> RegistrationContext:
    if record.request_sha256 != digest:
        raise _idempotency_key_reused()
    if (
        record.state is not IdempotencyState.COMPLETED
        or record.response_status != 200
        or record.response_body is None
    ):
        raise _service_unavailable()
    try:
        return RegistrationContext.model_validate(record.response_body)
    except ValidationError:
        return RegistrationContext.model_validate(
            _upgrade_legacy_application_context(
                record.response_body,
                application_id=None,
            )
        )


def _upgrade_legacy_review_actions(
    actions: dict[str, object],
) -> dict[str, object]:
    if set(actions) != {
        "can_accept",
        "accept_blocked_reason",
        "can_reject",
        "reject_blocked_reason",
    }:
        raise ValueError("legacy review actions are not exact")
    waitlist_blocker: object
    if actions.get("can_accept") is True:
        waitlist_blocker = "GAME_NOT_FULL"
    elif (
        actions.get("accept_blocked_reason") == "GAME_FULL"
        and actions.get("can_reject") is True
    ):
        waitlist_blocker = "WAITLIST_NOT_ENABLED"
    elif (
        actions.get("can_accept") is False
        and actions.get("can_reject") is False
        and actions.get("accept_blocked_reason")
        == actions.get("reject_blocked_reason")
    ):
        waitlist_blocker = actions.get("accept_blocked_reason")
    else:
        raise ValueError("legacy review actions are not recoverable")
    return {
        **actions,
        "can_waitlist": False,
        "waitlist_blocked_reason": waitlist_blocker,
    }


def _game_not_found() -> AppError:
    return AppError(404, "OPEN_GAME_NOT_FOUND", "球局不存在。")


def _application_not_found() -> AppError:
    return AppError(404, "APPLICATION_NOT_FOUND", "报名不存在。")


def _application_already_exists() -> AppError:
    return AppError(
        409,
        "APPLICATION_ALREADY_EXISTS",
        "你已申请过本场球局，请刷新查看当前结果。",
    )


def _application_state_changed() -> AppError:
    return AppError(
        409,
        "APPLICATION_STATE_CHANGED",
        "报名状态或版本已变化，请刷新后重试。",
    )


def _idempotency_key_reused() -> AppError:
    return AppError(
        409,
        "IDEMPOTENCY_KEY_REUSED",
        "该幂等键已用于其他请求，请生成新键后重试。",
    )


def _invalid_argument() -> AppError:
    return AppError(
        422,
        "INVALID_ARGUMENT",
        "请求参数格式不正确，请检查后重试。",
    )


def _service_unavailable() -> AppError:
    return AppError(
        503,
        "SERVICE_UNAVAILABLE",
        "服务暂时不可用，请稍后重试。",
    )
