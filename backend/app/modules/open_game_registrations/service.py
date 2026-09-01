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
    OpenGameAttendanceStatus,
    OpenGameMemberRemoval,
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
    CreateRegistrationRequest,
    DecisionRequest,
    DecisionResult,
    DecisionResultStatus,
    LegacyRegistrationContext,
    LegacyViewerRegistration,
    MyOpenGameApplication,
    MyOpenGameApplicationsResponse,
    OpenGameAttendanceGameSummary,
    OpenGameAttendanceMarkRequest,
    OpenGameAttendanceMarkResult,
    OpenGameAttendanceRoster,
    OpenGameMemberGameSummary,
    OpenGameMemberRemovalRequest,
    OpenGameMemberRemovalResult,
    OpenGameMemberRoster,
    OpenGameMemberUnblockRequest,
    OpenGameMemberUnblockResult,
    OpenGamePromotedMember,
    PublicRosterMember,
    PublicWaitlistedMember,
    Queue,
    RegistrationContext,
    WithdrawalRequest,
)
from backend.app.modules.open_game_registrations.lifecycle import (
    ApplyActions,
    ApplyBlockedReason,
    MemberRemovalFacts,
    RegistrationFacts,
    ReviewBlockedReason,
    WaitlistBlockedReason,
    WithdrawalAction,
    project_apply_actions,
    project_available_withdrawal,
    project_member_removal_actions,
    project_review_actions,
    remaining_spots,
)
from backend.app.modules.open_game_registrations.privacy import (
    project_attendance_roster_item,
    project_blocked_roster_member,
    project_captain_application,
    project_captain_waitlist_application,
    project_member_roster_item,
    project_my_open_game_application,
    project_public_roster_member,
    project_public_waitlisted_member,
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
CREATE_OPEN_GAME_REGISTRATION_OPERATION = "create_open_game_registration"

DECIDE_OPEN_GAME_APPLICATION_OPERATION = "decide_open_game_application"
WITHDRAW_OPEN_GAME_APPLICATION_OPERATION = "withdraw_open_game_application"
WITHDRAW_OPEN_GAME_REGISTRATION_OPERATION = "withdraw_open_game_registration"

MARK_OPEN_GAME_ATTENDANCE_OPERATION = "MARK_OPEN_GAME_ATTENDANCE"
REMOVE_OPEN_GAME_MEMBER_OPERATION = "REMOVE_OPEN_GAME_MEMBER"


UNBLOCK_OPEN_GAME_MEMBER_OPERATION = "UNBLOCK_OPEN_GAME_MEMBER"

class OpenGameRegistrationService:
    def __init__(
        self,
        *,
        repository: OpenGameRegistrationRepository,
        open_game_repository: OpenGameRepository,
        order_repository: OrderRepository,
        avatar_url_for_key: Callable[[uuid.UUID, str], str] | None = None,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        session = repository.session
        if open_game_repository.session is not session or order_repository.session is not session:
            raise ValueError(
                "registration, open-game and order repositories must share one Session"
            )
        self._repository = repository
        self._open_game_repository = open_game_repository
        self._order_repository = order_repository
        self._avatar_url_for_key = avatar_url_for_key
        self._now = now or (lambda: datetime.now(UTC))

    def get_signup_context(
        self,
        *,
        share_token: str,
        viewer_user_id: uuid.UUID | None,
        public_viewer_profile: bool = True,
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
            joined_count = self._repository.count_joined(game_id=game.id)
            registration = (
                self._repository.get_registration(
                    game_id=game.id,
                    applicant_user_id=viewer_user_id,
                )
                if viewer_user_id is not None
                else None
            )
            correction_times = self._repository.latest_attendance_correction_times(
                registration_versions=(
                    {registration.id: registration.version} if registration is not None else {}
                )
            )
            return self._build_context(
                game=game,
                projection=projection,
                viewer_user_id=viewer_user_id,
                registration=registration,
                joined_count=joined_count,
                now=now,
                attendance_corrected_at=(
                    correction_times.get(registration.id) if registration is not None else None
                ),
                public_viewer_profile=public_viewer_profile,
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

    def get_context(
        self,
        *,
        share_token: str,
        viewer_user_id: uuid.UUID | None,
    ) -> LegacyRegistrationContext:
        return _project_legacy_context(
            self.get_signup_context(
                share_token=share_token,
                viewer_user_id=viewer_user_id,
                public_viewer_profile=False,
            )
        )

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
            correction_times = self._repository.latest_attendance_correction_times(
                registration_versions={
                    row.registration.id: row.registration.version for row in rows
                }
            )
            now = self._now()
            items = tuple(
                self._project_my_application(
                    row.registration,
                    now=now,
                    waitlist_position=row.waitlist_position,
                    attendance_corrected_at=correction_times.get(row.registration.id),
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
    ) -> LegacyRegistrationContext:
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
                replay = _replay_legacy_context(
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
            before = self._build_context(
                game=game,
                projection=projection,
                viewer_user_id=applicant_user_id,
                registration=None,
                joined_count=joined_count,
                now=now,
                public_viewer_profile=True,
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
                waitlist_seq=None,
                waitlisted_at=None,
                promoted_at=None,
                removed_at=None,
                removed_by_user_id=None,
                reapply_blocked=False,
            )
            self._repository.add_registration(registration)
            response = _project_legacy_context(
                self._build_context(
                    game=game,
                    projection=projection,
                    viewer_user_id=applicant_user_id,
                    registration=registration,
                    joined_count=joined_count,
                    now=now,
                )
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

    def signup(
        self,
        *,
        share_token: str,
        applicant_user_id: uuid.UUID,
        idempotency_key: str,
        request: CreateRegistrationRequest,
    ) -> RegistrationContext:
        try:
            proof = self._open_game_repository.get_by_share_token(share_token=share_token)
            if proof is None:
                raise _game_not_found()
            order = self._repository.lock_order(order_id=proof.order_id)
            if order is None:
                raise _game_not_found()
            game = self._open_game_repository.lock_target_game(
                game_id=proof.id,
                order_id=order.id,
            )
            if game is None or game.share_token != share_token or game.published_at is None:
                raise _game_not_found()

            digest = _application_request_digest(
                operation=CREATE_OPEN_GAME_REGISTRATION_OPERATION,
                share_token=share_token,
                resolved_game_id=game.id,
                request=request,
            )
            record, claimed = self._order_repository.claim_idempotency(
                user_id=applicant_user_id,
                operation=CREATE_OPEN_GAME_REGISTRATION_OPERATION,
                key=idempotency_key,
                request_sha256=digest,
            )
            if not claimed:
                replay = _replay_signup_context(
                    record,
                    digest=digest,
                )
                self._order_repository.commit()
                return replay

            applicant = self._repository.lock_applicant(user_id=applicant_user_id)
            if (
                applicant is None
                or applicant.public_nickname is None
                or applicant.public_avatar_object_key is None
                or applicant.public_profile_updated_at is None
                or applicant.public_profile_version < 1
            ):
                raise _public_profile_required()
            if request.display_name != applicant.public_nickname:
                raise _public_profile_changed()

            authority = self._open_game_repository.lock_order_authority(order_id=order.id)
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
            joined_count = self._repository.count_joined(game_id=game.id)
            before = self._build_context(
                game=game,
                projection=projection,
                viewer_user_id=applicant_user_id,
                registration=existing,
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

            next_waitlist_seq = self._repository.next_waitlist_seq(game_id=game.id)
            for legacy_application in self._repository.lock_fifo_applied(
                game_id=game.id
            ):
                joins_now = joined_count < game.open_spots
                legacy_application.status = (
                    OpenGameRegistrationStatus.JOINED
                    if joins_now
                    else OpenGameRegistrationStatus.WAITLISTED
                )
                legacy_application.version += 1
                legacy_application.decided_at = now
                legacy_application.decided_by_user_id = (
                    legacy_application.applicant_user_id
                )
                legacy_application.waitlist_seq = None if joins_now else next_waitlist_seq
                legacy_application.waitlisted_at = None if joins_now else now
                legacy_application.promoted_at = None
                if joins_now:
                    joined_count += 1
                else:
                    next_waitlist_seq += 1
            self._repository.flush()

            direct_join = joined_count < game.open_spots
            internal_display_name = (
                request.display_name if len(request.display_name) >= 2 else "球友"
            )
            waitlist_seq = (
                None if direct_join else next_waitlist_seq
            )
            if existing is None:
                registration = OpenGameRegistration(
                    id=uuid.uuid4(),
                    game_id=game.id,
                    applicant_user_id=applicant_user_id,
                    display_name=internal_display_name,
                    position=request.position,
                    note=request.note,
                    status=(
                        OpenGameRegistrationStatus.JOINED
                        if direct_join
                        else OpenGameRegistrationStatus.WAITLISTED
                    ),
                    version=1,
                    consent_version=OPEN_GAME_REGISTRATION_CONSENT_VERSION,
                    adult_confirmed_at=now,
                    risk_confirmed_at=now,
                    applied_at=now,
                    decided_at=now,
                    decided_by_user_id=applicant_user_id,
                    withdrawn_at=None,
                    withdrawal_kind=None,
                    late_exit_recorded=False,
                    waitlist_seq=waitlist_seq,
                    waitlisted_at=None if direct_join else now,
                    promoted_at=None,
                    removed_at=None,
                    removed_by_user_id=None,
                    reapply_blocked=False,
                )
                self._repository.add_registration(registration)
            else:
                registration = existing
                registration.display_name = internal_display_name
                registration.position = request.position
                registration.note = request.note
                registration.status = (
                    OpenGameRegistrationStatus.JOINED
                    if direct_join
                    else OpenGameRegistrationStatus.WAITLISTED
                )
                registration.version += 1
                registration.consent_version = OPEN_GAME_REGISTRATION_CONSENT_VERSION
                registration.adult_confirmed_at = now
                registration.risk_confirmed_at = now
                registration.applied_at = now
                registration.decided_at = now
                registration.decided_by_user_id = applicant_user_id
                registration.withdrawn_at = None
                registration.withdrawal_kind = None
                registration.late_exit_recorded = False
                registration.waitlist_seq = waitlist_seq
                registration.waitlisted_at = None if direct_join else now
                registration.promoted_at = None
                registration.attendance_status = OpenGameAttendanceStatus.UNMARKED
                registration.attendance_recorded_at = None
                registration.attendance_recorded_by_user_id = None
                registration.removed_at = None
                registration.removed_by_user_id = None
                registration.reapply_blocked = False
                self._repository.flush()
            result_joined_count = joined_count + (1 if direct_join else 0)
            response = self._build_context(
                game=game,
                projection=projection,
                viewer_user_id=applicant_user_id,
                registration=registration,
                joined_count=result_joined_count,
                now=now,
                public_viewer_profile=True,
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

    def get_member_roster(
        self,
        *,
        game_id: uuid.UUID,
        owner_user_id: uuid.UUID,
    ) -> OpenGameMemberRoster:
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
            registrations = self._repository.list_joined_members(game_id=game.id)
            waitlist_count = self._repository.count_waitlisted(game_id=game.id)
            healthy = published_authority_is_healthy(projection.facts.order_facts)
            members = tuple(
                project_member_roster_item(
                    registration_id=registration.id,
                    display_name=registration.display_name,
                    position=registration.position,
                    decided_at=_require_decided_at(registration),
                    waitlisted_at=registration.waitlisted_at,
                    promoted_at=registration.promoted_at,
                    attendance_status=registration.attendance_status,
                    version=registration.version,
                    game_state=projection.state,
                    stored_game_status=game.status,
                    order_authority_healthy=healthy,
                    starts_at=projection.starts_at,
                    now=now,
                )
                for registration in registrations
            )
            public = projection.public
            return OpenGameMemberRoster(
                game=OpenGameMemberGameSummary(
                    id=game.id,
                    name=public.name,
                    venue_name=public.venue_name,
                    pitch_name=public.pitch_name,
                    starts_at=public.starts_at,
                    ends_at=public.ends_at,
                    time_zone=public.time_zone,
                    state=projection.state,
                ),
                joined_count=len(members),
                remaining_spots=remaining_spots(
                    open_spots=game.open_spots,
                    joined_count=len(members),
                ),
                waitlist_count=waitlist_count,
                members=members,
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

    def remove_member(
        self,
        *,
        game_id: uuid.UUID,
        registration_id: uuid.UUID,
        owner_user_id: uuid.UUID,
        idempotency_key: str,
        request: OpenGameMemberRemovalRequest,
    ) -> OpenGameMemberRemovalResult:
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
                application_id=registration_id,
            )
            if registration is None:
                raise _application_not_found()

            digest = _member_removal_request_digest(
                operation=REMOVE_OPEN_GAME_MEMBER_OPERATION,
                game_id=game.id,
                registration_id=registration.id,
                request=request,
            )
            record, claimed = self._order_repository.claim_idempotency(
                user_id=owner_user_id,
                operation=REMOVE_OPEN_GAME_MEMBER_OPERATION,
                key=idempotency_key,
                request_sha256=digest,
            )
            if not claimed:
                replay = _replay_member_removal(record, digest=digest)
                self._order_repository.commit()
                return replay

            authority = self._open_game_repository.lock_order_authority(order_id=order.id)
            order_row = self._require_order_row(order.id)
            now = self._now()
            projection = self._project_game(
                game=game,
                order=order,
                authority=authority,
                order_row=order_row,
                now=now,
            )
            actions = project_member_removal_actions(
                MemberRemovalFacts(
                    game_state=projection.state,
                    stored_game_status=game.status,
                    order_authority_healthy=published_authority_is_healthy(
                        projection.facts.order_facts
                    ),
                    starts_at=projection.starts_at,
                    attendance_status=registration.attendance_status,
                ),
                now=now,
            )
            if (
                registration.status
                not in {
                    OpenGameRegistrationStatus.JOINED,
                    OpenGameRegistrationStatus.WAITLISTED,
                }
                or registration.version != request.expected_version
                or not actions.can_remove
            ):
                raise _application_state_changed()

            joined_before = self._repository.count_joined(game_id=game.id)
            should_promote = (
                registration.status is OpenGameRegistrationStatus.JOINED
                and joined_before <= game.open_spots
            )
            registration_version_before = registration.version
            registration.status = OpenGameRegistrationStatus.REMOVED
            registration.version += 1
            registration.removed_at = now
            registration.removed_by_user_id = owner_user_id
            registration.reapply_blocked = True

            promoted: OpenGameRegistration | None = None
            promoted_version_before: int | None = None
            if should_promote:
                promoted = self._repository.lock_fifo_waitlisted(game_id=game.id)
                if promoted is not None:
                    promoted_version_before = promoted.version
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
                            dedupe_key=(f"waitlist-promoted:{promoted.id}:{promoted.version}"),
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

            self._repository.add_member_removal(
                OpenGameMemberRemoval(
                    registration_id=registration.id,
                    applicant_user_id=registration.applicant_user_id,
                    game_id=game.id,
                    order_id=order.id,
                    removed_by_user_id=owner_user_id,
                    reason=request.reason,
                    removed_at=now,
                    registration_version_before=registration_version_before,
                    registration_version_after=registration.version,
                    promoted_registration_id=(promoted.id if promoted is not None else None),
                    promoted_applicant_user_id=(
                        promoted.applicant_user_id if promoted is not None else None
                    ),
                    promoted_registration_version_before=promoted_version_before,
                    promoted_registration_version_after=(
                        promoted.version if promoted is not None else None
                    ),
                    idempotency_key=idempotency_key,
                    request_sha256=digest,
                )
            )
            self._repository.flush()

            joined_count = self._repository.count_joined(game_id=game.id)
            waitlist_count = self._repository.count_waitlisted(game_id=game.id)
            result = OpenGameMemberRemovalResult(
                removed_registration_id=registration.id,
                removed_display_name=registration.display_name,
                status="REMOVED",
                version=registration.version,
                removed_at=now,
                joined_count=joined_count,
                remaining_spots=remaining_spots(
                    open_spots=game.open_spots,
                    joined_count=joined_count,
                ),
                waitlist_count=waitlist_count,
                promoted_member=(
                    OpenGamePromotedMember(
                        registration_id=promoted.id,
                        display_name=promoted.display_name,
                        position=promoted.position,
                        version=promoted.version,
                    )
                    if promoted is not None
                    else None
                ),
            )
            self._order_repository.complete_idempotency(
                record,
                response_status=200,
                response_body=result.model_dump(mode="json"),
            )
            self._order_repository.commit()
            return result
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

    def unblock_member(
        self,
        *,
        game_id: uuid.UUID,
        registration_id: uuid.UUID,
        owner_user_id: uuid.UUID,
        idempotency_key: str,
        request: OpenGameMemberUnblockRequest,
    ) -> OpenGameMemberUnblockResult:
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
                application_id=registration_id,
            )
            if registration is None:
                raise _application_not_found()

            digest = _member_unblock_request_digest(
                operation=UNBLOCK_OPEN_GAME_MEMBER_OPERATION,
                game_id=game.id,
                registration_id=registration.id,
                request=request,
            )
            record, claimed = self._order_repository.claim_idempotency(
                user_id=owner_user_id,
                operation=UNBLOCK_OPEN_GAME_MEMBER_OPERATION,
                key=idempotency_key,
                request_sha256=digest,
            )
            if not claimed:
                replay = _replay_member_unblock(record, digest=digest)
                self._order_repository.commit()
                return replay

            if (
                registration.status is not OpenGameRegistrationStatus.REMOVED
                or not registration.reapply_blocked
                or registration.version != request.expected_version
            ):
                raise _application_state_changed()

            registration.reapply_blocked = False
            registration.version += 1
            self._repository.flush()
            result = OpenGameMemberUnblockResult(
                registration_id=registration.id,
                status="REMOVED",
                version=registration.version,
                reapply_blocked=False,
            )
            self._order_repository.complete_idempotency(
                record,
                response_status=200,
                response_body=result.model_dump(mode="json"),
            )
            self._order_repository.commit()
            return result
        except AppError:
            self._repository.rollback()
            raise
        except (
            SQLAlchemyError,
            ValidationError,
            ValueError,
            RuntimeError,
        ):
            self._repository.rollback()
            raise _service_unavailable() from None

    def get_attendance_roster(
        self,
        *,
        game_id: uuid.UUID,
        owner_user_id: uuid.UUID,
    ) -> OpenGameAttendanceRoster:
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
            projection = self._project_game(
                game=game,
                order=order,
                authority=authority,
                order_row=order_row,
                now=self._now(),
            )
            if projection.state is not EffectiveOpenGameState.COMPLETED:
                raise _attendance_state_changed()
            registrations = self._repository.list_attendance_roster(game_id=game.id)
            correction_times = self._repository.latest_attendance_correction_times(
                registration_versions={
                    registration.id: registration.version
                    for registration in registrations
                }
            )
            return _project_attendance_roster(
                game=game,
                projection=projection,
                registrations=registrations,
                correction_times=correction_times,
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

    def mark_attendance(
        self,
        *,
        game_id: uuid.UUID,
        registration_id: uuid.UUID,
        owner_user_id: uuid.UUID,
        idempotency_key: str,
        request: OpenGameAttendanceMarkRequest,
    ) -> OpenGameAttendanceMarkResult:
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
                application_id=registration_id,
            )
            if registration is None:
                raise _application_not_found()

            digest = _attendance_request_digest(
                operation=MARK_OPEN_GAME_ATTENDANCE_OPERATION,
                game_id=game.id,
                registration_id=registration.id,
                request=request,
            )
            record, claimed = self._order_repository.claim_idempotency(
                user_id=owner_user_id,
                operation=MARK_OPEN_GAME_ATTENDANCE_OPERATION,
                key=idempotency_key,
                request_sha256=digest,
            )
            if not claimed and record.request_sha256 != digest:
                raise _idempotency_key_reused()

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
            if projection.state is not EffectiveOpenGameState.COMPLETED:
                raise _attendance_state_changed()

            if not claimed:
                response = _replay_attendance(
                    record,
                    digest=digest,
                    registration=registration,
                    owner_user_id=owner_user_id,
                )
                self._order_repository.commit()
                return response

            if (
                registration.status is not OpenGameRegistrationStatus.JOINED
                or registration.attendance_status
                is not OpenGameAttendanceStatus.UNMARKED
                or registration.attendance_recorded_at is not None
                or registration.attendance_recorded_by_user_id is not None
                or registration.version != request.expected_version
            ):
                raise _attendance_state_changed()

            registration.attendance_status = request.attendance_status
            registration.attendance_recorded_at = now
            registration.attendance_recorded_by_user_id = owner_user_id
            registration.version += 1
            self._repository.flush()
            registrations = self._repository.list_attendance_roster(game_id=game.id)
            response = _project_attendance_mark_result(
                registration=registration,
                registrations=registrations,
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

    def withdraw_legacy(
        self,
        *,
        application_id: uuid.UUID,
        applicant_user_id: uuid.UUID,
        idempotency_key: str,
        request: WithdrawalRequest,
    ) -> LegacyRegistrationContext:
        return self.withdraw(
            application_id=application_id,
            applicant_user_id=applicant_user_id,
            idempotency_key=idempotency_key,
            request=request,
        )

    def withdraw(
        self,
        *,
        application_id: uuid.UUID,
        applicant_user_id: uuid.UUID,
        idempotency_key: str,
        request: WithdrawalRequest,
    ) -> LegacyRegistrationContext:
        result = self._withdraw(
            application_id=application_id,
            applicant_user_id=applicant_user_id,
            idempotency_key=idempotency_key,
            request=request,
            operation=WITHDRAW_OPEN_GAME_APPLICATION_OPERATION,
            legacy=True,
        )
        if not isinstance(result, LegacyRegistrationContext):
            raise RuntimeError("legacy withdrawal returned a signup context")
        return result

    def _withdraw(
        self,
        *,
        application_id: uuid.UUID,
        applicant_user_id: uuid.UUID,
        idempotency_key: str,
        request: WithdrawalRequest,
        operation: str,
        legacy: bool,
    ) -> RegistrationContext | LegacyRegistrationContext:
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
                operation=operation,
                application_id=registration.id,
                resolved_game_id=game.id,
                request=request,
            )
            record, claimed = self._order_repository.claim_idempotency(
                user_id=applicant_user_id,
                operation=operation,
                key=idempotency_key,
                request_sha256=digest,
            )
            if not claimed:
                replay = (
                    _replay_legacy_withdrawal(record, digest=digest)
                    if legacy
                    else _replay_withdrawal(record, digest=digest)
                )
                self._order_repository.commit()
                return replay

            authority = self._open_game_repository.lock_order_authority(order_id=order.id)
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
                and published_authority_is_healthy(projection.facts.order_facts)
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
                registration.withdrawal_kind = OpenGameRegistrationWithdrawalKind.GAME_EXIT
            else:
                raise RuntimeError("withdrawal request contains an unsupported action")
            registration.late_exit_recorded = available.late_exit_will_be_recorded
            self._repository.flush()
            if should_promote:
                promoted = self._repository.lock_fifo_waitlisted(game_id=game.id)
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
                            dedupe_key=(f"waitlist-promoted:{promoted.id}:{promoted.version}"),
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
            signup_context = self._build_context(
                game=game,
                projection=projection,
                viewer_user_id=applicant_user_id,
                registration=registration,
                joined_count=joined_count,
                now=now,
                public_viewer_profile=not legacy,
            )
            response = (
                _project_legacy_context(signup_context)
                if legacy
                else signup_context
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

    def withdraw_registration(
        self,
        *,
        application_id: uuid.UUID,
        applicant_user_id: uuid.UUID,
        idempotency_key: str,
        request: WithdrawalRequest,
    ) -> RegistrationContext:
        result = self._withdraw(
            application_id=application_id,
            applicant_user_id=applicant_user_id,
            idempotency_key=idempotency_key,
            request=request,
            operation=WITHDRAW_OPEN_GAME_REGISTRATION_OPERATION,
            legacy=False,
        )
        if not isinstance(result, RegistrationContext):
            raise RuntimeError("signup withdrawal returned a legacy context")
        return result

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
                or not published_authority_is_healthy(projection.facts.order_facts)
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
            if (
                request.decision is ApplicationDecision.ACCEPT
                and not actions.can_accept
            ):
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
                next_waitlist_seq = self._repository.next_waitlist_seq(game_id=game.id)
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

    def _avatar_url(self, registration: OpenGameRegistration) -> str | None:
        object_key = registration.applicant.public_avatar_object_key
        if object_key is None or self._avatar_url_for_key is None:
            return None
        return self._avatar_url_for_key(registration.applicant_user_id, object_key)

    def _build_context(
        self,
        *,
        game: OpenGame,
        projection: AuthoritativePublicGameProjection,
        viewer_user_id: uuid.UUID | None,
        registration: OpenGameRegistration | None,
        joined_count: int,
        now: datetime,
        attendance_corrected_at: datetime | None = None,
        public_viewer_profile: bool = False,
    ) -> RegistrationContext:
        waitlist_count = self._repository.count_waitlisted(game_id=game.id)
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
        joined_members = None
        waitlisted_members = None
        blocked_members = None
        management_game_id = None
        if viewer_user_id is not None:
            owner_projection = viewer_user_id == projection.owner_user_id
            if owner_projection:
                management_game_id = game.id
            healthy = published_authority_is_healthy(projection.facts.order_facts)

            def owner_can_remove(row: OpenGameRegistration) -> bool | None:
                if not owner_projection:
                    return None
                return project_member_removal_actions(
                    MemberRemovalFacts(
                        game_state=projection.state,
                        stored_game_status=game.status,
                        order_authority_healthy=healthy,
                        starts_at=projection.starts_at,
                        attendance_status=row.attendance_status,
                    ),
                    now=now,
                ).can_remove

            joined_rows = self._repository.list_joined_members(game_id=game.id)
            joined_members = tuple(
                project_public_roster_member(
                    nickname=(row.applicant.public_nickname or "资料待补充"),
                    avatar_url=self._avatar_url(row),
                    registration_id=row.id,
                    version=row.version,
                    owner_can_remove=owner_can_remove(row),
                )
                for row in joined_rows
            )
            waitlisted_rows = self._repository.list_waitlisted(game_id=game.id)
            waitlisted_members = tuple(
                project_public_waitlisted_member(
                    nickname=(row.applicant.public_nickname or "资料待补充"),
                    avatar_url=self._avatar_url(row),
                    registration_id=row.id,
                    version=row.version,
                    waitlist_position=position,
                    owner_can_remove=owner_can_remove(row),
                )
                for position, row in enumerate(waitlisted_rows, start=1)
            )
            if owner_projection:
                blocked_rows = self._repository.list_reapply_blocked(game_id=game.id)
                blocked_members = tuple(
                    project_blocked_roster_member(
                        nickname=(row.applicant.public_nickname or "资料待补充"),
                        avatar_url=self._avatar_url(row),
                        registration_id=row.id,
                        version=row.version,
                    )
                    for row in blocked_rows
                )
        return _project_context(
            game=game,
            projection=projection,
            viewer_user_id=viewer_user_id,
            registration=registration,
            joined_count=joined_count,
            waitlist_count=waitlist_count,
            now=now,
            waitlist_position=waitlist_position,
            attendance_corrected_at=attendance_corrected_at,
            joined_members=joined_members,
            waitlisted_members=waitlisted_members,
            blocked_members=blocked_members,
            management_game_id=management_game_id,
            public_viewer_profile=public_viewer_profile,
        )

    def _project_my_application(
        self,
        registration: OpenGameRegistration,
        *,
        now: datetime,
        waitlist_position: int | None,
        attendance_corrected_at: datetime | None = None,
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
            game_id=game.id,
            persisted_status=registration.status,
            applied_at=registration.applied_at,
            share_token=game.share_token,
            projection=projection,
            waitlist_position=waitlist_position,
            waitlisted_at=registration.waitlisted_at,
            promoted_at=registration.promoted_at,
            attendance_status=registration.attendance_status,
            attendance_recorded_at=registration.attendance_recorded_at,
            attendance_corrected_at=attendance_corrected_at,
        )


def _project_attendance_roster(
    *,
    game: OpenGame,
    projection: AuthoritativePublicGameProjection,
    registrations: list[OpenGameRegistration],
    correction_times: dict[uuid.UUID, datetime],
) -> OpenGameAttendanceRoster:
    items = tuple(
        project_attendance_roster_item(
            registration_id=registration.id,
            display_name=registration.display_name,
            position=registration.position,
            attendance_status=registration.attendance_status,
            attendance_recorded_at=registration.attendance_recorded_at,
            attendance_corrected_at=correction_times.get(registration.id),
            version=registration.version,
        )
        for registration in registrations
    )
    recorded_count = sum(
        item.attendance_status is not OpenGameAttendanceStatus.UNMARKED
        for item in items
    )
    public = projection.public
    return OpenGameAttendanceRoster(
        game=OpenGameAttendanceGameSummary(
            id=game.id,
            name=public.name,
            venue_name=public.venue_name,
            pitch_name=public.pitch_name,
            starts_at=public.starts_at,
            ends_at=public.ends_at,
            time_zone=public.time_zone,
            state="COMPLETED",
        ),
        recorded_count=recorded_count,
        total_count=len(items),
        attendance_complete=recorded_count == len(items),
        registrations=items,
    )


def _require_decided_at(registration: OpenGameRegistration) -> datetime:
    if registration.decided_at is None:
        raise RuntimeError("JOINED registration is missing decided_at")
    return registration.decided_at


def _project_attendance_mark_result(
    *,
    registration: OpenGameRegistration,
    registrations: list[OpenGameRegistration],
) -> OpenGameAttendanceMarkResult:
    if (
        registration.attendance_status
        not in {
            OpenGameAttendanceStatus.PRESENT,
            OpenGameAttendanceStatus.NO_SHOW,
        }
        or registration.attendance_recorded_at is None
    ):
        raise RuntimeError("attendance result is not terminal")
    recorded_count = sum(
        row.attendance_status is not OpenGameAttendanceStatus.UNMARKED
        for row in registrations
    )
    return OpenGameAttendanceMarkResult(
        registration_id=registration.id,
        attendance_status=registration.attendance_status,
        attendance_recorded_at=registration.attendance_recorded_at,
        version=registration.version,
        recorded_count=recorded_count,
        total_count=len(registrations),
        attendance_complete=recorded_count == len(registrations),
    )


def _project_legacy_context(
    context: RegistrationContext,
) -> LegacyRegistrationContext:
    viewer_registration = context.viewer_registration
    legacy_viewer = (
        viewer_registration.model_dump()
        if viewer_registration is not None
        else None
    )
    if legacy_viewer is not None and len(legacy_viewer["display_name"]) < 2:
        legacy_viewer["display_name"] = "球友"
    allowed_actions = context.allowed_actions
    if viewer_registration is not None and (
        allowed_actions.can_apply
        or allowed_actions.apply_blocked_reason
        is ApplyBlockedReason.REMOVED_BY_CAPTAIN
    ):
        allowed_actions = ApplyActions(
            can_apply=False,
            apply_blocked_reason=ApplyBlockedReason.ALREADY_APPLIED,
        )
    return LegacyRegistrationContext(
        game=context.game,
        remaining_spots=context.remaining_spots,
        viewer_authenticated=context.viewer_authenticated,
        viewer_registration=(
            LegacyViewerRegistration.model_validate(legacy_viewer)
            if legacy_viewer is not None
            else None
        ),
        allowed_actions=allowed_actions,
    )

def _project_context(
    *,
    game: OpenGame,
    projection: AuthoritativePublicGameProjection,
    viewer_user_id: uuid.UUID | None,
    registration: OpenGameRegistration | None,
    joined_count: int,
    waitlist_count: int,
    now: datetime,
    waitlist_position: int | None = None,
    attendance_corrected_at: datetime | None = None,
    joined_members: tuple[PublicRosterMember, ...] | None = None,
    waitlisted_members: tuple[PublicWaitlistedMember, ...] | None = None,
    blocked_members: tuple[PublicRosterMember, ...] | None = None,
    management_game_id: uuid.UUID | None = None,
    public_viewer_profile: bool = False,
) -> RegistrationContext:
    facts = _registration_facts(
        game=game,
        projection=projection,
        viewer_user_id=viewer_user_id,
        viewer_has_registration=_registration_prevents_apply(registration),
        viewer_reapply_blocked=(
            registration is not None
            and registration.status is OpenGameRegistrationStatus.REMOVED
            and registration.reapply_blocked
        ),
        joined_count=joined_count,
    )
    viewer_registration = (
        project_viewer_registration(
            application_id=registration.id,
            display_name=(
                registration.applicant.public_nickname
                if public_viewer_profile
                and registration.applicant.public_nickname is not None
                else registration.display_name
            ),
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
            attendance_corrected_at=attendance_corrected_at,
            removed_at=registration.removed_at,
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
        joined_count=joined_count,
        waitlist_count=waitlist_count,
        viewer_authenticated=viewer_user_id is not None,
        viewer_registration=viewer_registration,
        joined_members=joined_members,
        waitlisted_members=waitlisted_members,
        blocked_members=blocked_members,
        management_game_id=management_game_id,
        allowed_actions=project_apply_actions(facts, now),
    )


def _registration_facts(
    *,
    game: OpenGame,
    projection: AuthoritativePublicGameProjection,
    viewer_user_id: uuid.UUID | None,
    viewer_has_registration: bool,
    joined_count: int,
    viewer_reapply_blocked: bool = False,
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
        viewer_reapply_blocked=viewer_reapply_blocked,
    )


def _registration_prevents_apply(
    registration: OpenGameRegistration | None,
) -> bool:
    if registration is None:
        return False
    if registration.status is OpenGameRegistrationStatus.WITHDRAWN:
        return False
    if (
        registration.status is OpenGameRegistrationStatus.REMOVED
        and not registration.reapply_blocked
    ):
        return False
    return True

def _application_request_digest(
    *,
    operation: str,
    share_token: str,
    resolved_game_id: uuid.UUID,
    request: CreateApplicationRequest | CreateRegistrationRequest,
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


def _attendance_request_digest(
    *,
    operation: str,
    game_id: uuid.UUID,
    registration_id: uuid.UUID,
    request: OpenGameAttendanceMarkRequest,
) -> str:
    payload = {
        "operation": operation,
        "game_id": str(game_id),
        "registration_id": str(registration_id),
        "attendance_status": request.attendance_status.value,
        "expected_version": request.expected_version,
        "version": 1,
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


def _member_removal_request_digest(
    *,
    operation: str,
    game_id: uuid.UUID,
    registration_id: uuid.UUID,
    request: OpenGameMemberRemovalRequest,
) -> str:
    payload = {
        "operation": operation,
        "game_id": str(game_id),
        "registration_id": str(registration_id),
        "expected_version": request.expected_version,
        "reason": request.reason,
        "version": 1,
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


def _member_unblock_request_digest(
    *,
    operation: str,
    game_id: uuid.UUID,
    registration_id: uuid.UUID,
    request: OpenGameMemberUnblockRequest,
) -> str:
    payload = {
        "operation": operation,
        "game_id": str(game_id),
        "registration_id": str(registration_id),
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
        character
        not in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
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





def _replay_legacy_context(
    record: IdempotencyRecord,
    *,
    digest: str,
    legacy_application_id: uuid.UUID | None = None,
) -> LegacyRegistrationContext:
    if record.request_sha256 != digest:
        raise _idempotency_key_reused()
    if (
        record.state is not IdempotencyState.COMPLETED
        or record.response_status != 201
        or record.response_body is None
    ):
        raise _service_unavailable()
    try:
        return LegacyRegistrationContext.model_validate(record.response_body)
    except ValidationError:
        return LegacyRegistrationContext.model_validate(
            _upgrade_legacy_application_context(
                record.response_body,
                application_id=legacy_application_id,
            )
        )

def _replay_signup_context(
    record: IdempotencyRecord,
    *,
    digest: str,
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
    return RegistrationContext.model_validate(record.response_body)

def _replay_attendance(
    record: IdempotencyRecord,
    *,
    digest: str,
    registration: OpenGameRegistration,
    owner_user_id: uuid.UUID,
) -> OpenGameAttendanceMarkResult:
    if record.request_sha256 != digest:
        raise _idempotency_key_reused()
    if (
        record.state is not IdempotencyState.COMPLETED
        or record.response_status != 200
        or record.response_body is None
    ):
        raise _service_unavailable()
    stored = OpenGameAttendanceMarkResult.model_validate(record.response_body)
    if (
        registration.status is not OpenGameRegistrationStatus.JOINED
        or registration.attendance_recorded_by_user_id != owner_user_id
        or stored.registration_id != registration.id
        or stored.attendance_status is not registration.attendance_status
        or stored.attendance_recorded_at != registration.attendance_recorded_at
        or stored.version != registration.version
    ):
        raise _attendance_state_changed()
    return stored


def _upgrade_legacy_application_context(
    response_body: dict[str, object],
    *,
    application_id: uuid.UUID | None,
) -> dict[str, object]:
    """Upgrade only trusted historic registration-context response shapes."""
    legacy_context_fields = {
        "game",
        "remaining_spots",
        "viewer_authenticated",
        "viewer_registration",
        "allowed_actions",
    }
    if set(response_body) != legacy_context_fields:
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
    c2d_fields = c2b_fields | {
        "attendance_status",
        "attendance_recorded_at",
        "attendance_corrected_at",
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
        upgraded_viewer.update(
            {
                "id": str(application_id),
                "version": 1,
                "withdrawn_at": None,
                "withdrawal_kind": None,
                "late_exit_recorded": False,
                "available_withdrawal_action": None,
                "late_exit_will_be_recorded": False,
            }
        )
    elif frozenset(viewer) not in {
        frozenset(c2a_fields),
        frozenset(c2b_fields),
        frozenset(c2d_fields),
    }:
        raise ValueError("legacy application viewer is not exact")
    if not c2b_fields.issubset(viewer):
        upgraded_viewer.update(
            {
                "waitlist_position": None,
                "waitlisted_at": None,
                "promoted_at": None,
            }
        )
    if not c2d_fields.issubset(viewer):
        upgraded_viewer.update(
            {
                "attendance_status": None,
                "attendance_recorded_at": None,
                "attendance_corrected_at": None,
            }
        )
    upgraded_viewer["removed_at"] = None
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
    return RegistrationContext.model_validate(record.response_body)


def _replay_legacy_withdrawal(
    record: IdempotencyRecord,
    *,
    digest: str,
) -> LegacyRegistrationContext:
    if record.request_sha256 != digest:
        raise _idempotency_key_reused()
    if (
        record.state is not IdempotencyState.COMPLETED
        or record.response_status != 200
        or record.response_body is None
    ):
        raise _service_unavailable()
    try:
        return LegacyRegistrationContext.model_validate(record.response_body)
    except ValidationError:
        return LegacyRegistrationContext.model_validate(
            _upgrade_legacy_application_context(
                record.response_body,
                application_id=None,
            )
        )

def _replay_member_removal(
    record: IdempotencyRecord,
    *,
    digest: str,
) -> OpenGameMemberRemovalResult:
    if record.request_sha256 != digest:
        raise _idempotency_key_reused()
    if (
        record.state is not IdempotencyState.COMPLETED
        or record.response_status != 200
        or record.response_body is None
    ):
        raise _service_unavailable()
    return OpenGameMemberRemovalResult.model_validate(record.response_body)


def _replay_member_unblock(
    record: IdempotencyRecord,
    *,
    digest: str,
) -> OpenGameMemberUnblockResult:
    if record.request_sha256 != digest:
        raise _idempotency_key_reused()
    if (
        record.state is not IdempotencyState.COMPLETED
        or record.response_status != 200
        or record.response_body is None
    ):
        raise _service_unavailable()
    return OpenGameMemberUnblockResult.model_validate(record.response_body)

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
        and actions.get("accept_blocked_reason") == actions.get("reject_blocked_reason")
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


def _public_profile_changed() -> AppError:
    return AppError(
        409,
        "PUBLIC_PROFILE_CHANGED",
        "公开昵称已变化，请刷新资料后重新确认报名。",
    )

def _public_profile_required() -> AppError:
    return AppError(
        409,
        "PUBLIC_PROFILE_REQUIRED",
        "请先确认公开昵称和头像，再报名。",
    )

def _application_state_changed() -> AppError:
    return AppError(
        409,
        "APPLICATION_STATE_CHANGED",
        "报名状态或版本已变化，请刷新后重试。",
    )


def _attendance_state_changed() -> AppError:
    return AppError(
        409,
        "ATTENDANCE_STATE_CHANGED",
        "考勤状态或版本已变化，请刷新后重试。",
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
