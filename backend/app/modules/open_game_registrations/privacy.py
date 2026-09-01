"""Explicit privacy projections for open-game registration responses."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from backend.app.models import (
    OpenGameAttendanceStatus,
    OpenGameRegistrationPosition,
    OpenGameRegistrationStatus,
    OpenGameRegistrationWithdrawalKind,
    OpenGameStatus,
)
from backend.app.modules.open_game_registrations.dto import (
    CaptainApplication,
    CaptainWaitlistApplication,
    MyOpenGameApplication,
    OpenGameAttendanceRosterItem,
    OpenGameMemberRosterItem,
    PublicRosterMember,
    PublicWaitlistedMember,
    RegistrationPersistedStatus,
    RegistrationWithdrawalKind,
    RosterMemberManagement,
    ViewerRegistration,
)
from backend.app.modules.open_game_registrations.lifecycle import (
    MemberRemovalFacts,
    ReviewActions,
    project_available_withdrawal,
    project_effective_registration_status,
    project_member_removal_actions,
)
from backend.app.modules.open_games.lifecycle import EffectiveOpenGameState

if TYPE_CHECKING:
    from backend.app.modules.open_games.service import (
        AuthoritativePublicGameProjection,
    )

VIEWER_REGISTRATION_FIELDS = frozenset(
    {
        "display_name",
        "id",
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
        "waitlist_position",
        "waitlisted_at",
        "promoted_at",
        "attendance_status",
        "attendance_recorded_at",
        "attendance_corrected_at",
        "removed_at",
    }
)

CAPTAIN_APPLICATION_FIELDS = frozenset(
    {
        "id",
        "display_name",
        "position",
        "note",
        "applied_at",
        "version",
        "allowed_actions",
    }
)

MY_OPEN_GAME_APPLICATION_FIELDS = frozenset(
    {
        "id",
        "effective_status",
        "applied_at",
        "waitlist_position",
        "waitlisted_at",
        "promoted_at",
        "attendance_status",
        "attendance_recorded_at",
        "attendance_corrected_at",
        "detail_path",
        "game_name",
        "starts_at",
        "ends_at",
        "time_zone",
        "venue_name",
        "pitch_name",
        "pitch_specification",
    }
)

ATTENDANCE_ROSTER_ITEM_FIELDS = frozenset(
    {
        "registration_id",
        "display_name",
        "position",
        "attendance_status",
        "attendance_recorded_at",
        "attendance_corrected_at",
        "version",
    }
)

MEMBER_ROSTER_ITEM_FIELDS = frozenset(
    {
        "registration_id",
        "display_name",
        "position",
        "joined_at",
        "promoted_from_waitlist",
        "version",
        "allowed_actions",
    }
)

PUBLIC_ROSTER_MEMBER_FIELDS = frozenset({"nickname", "avatar_url"})
PUBLIC_WAITLISTED_MEMBER_FIELDS = frozenset({"nickname", "avatar_url", "waitlist_position"})
OWNER_PUBLIC_ROSTER_MEMBER_FIELDS = PUBLIC_ROSTER_MEMBER_FIELDS | {"management"}
OWNER_PUBLIC_WAITLISTED_MEMBER_FIELDS = PUBLIC_WAITLISTED_MEMBER_FIELDS | {"management"}


def project_viewer_registration(
    *,
    application_id: uuid.UUID,
    display_name: str,
    position: OpenGameRegistrationPosition,
    note: str | None,
    persisted_status: OpenGameRegistrationStatus,
    game_state: EffectiveOpenGameState,
    version: int,
    applied_at: datetime,
    decided_at: datetime | None,
    withdrawn_at: datetime | None,
    withdrawal_kind: OpenGameRegistrationWithdrawalKind | None,
    late_exit_recorded: bool,
    starts_at: datetime,
    now: datetime,
    waitlist_position: int | None = None,
    waitlisted_at: datetime | None = None,
    promoted_at: datetime | None = None,
    attendance_status: OpenGameAttendanceStatus = OpenGameAttendanceStatus.UNMARKED,
    attendance_recorded_at: datetime | None = None,
    attendance_corrected_at: datetime | None = None,
    removed_at: datetime | None = None,
) -> ViewerRegistration:
    """Rebuild the applicant response from its reviewed field whitelist."""
    withdrawal = project_available_withdrawal(
        persisted_status=persisted_status,
        game_state=game_state,
        starts_at=starts_at,
        now=now,
    )
    (
        projected_attendance_status,
        projected_attendance_recorded_at,
        projected_attendance_corrected_at,
    ) = _project_self_attendance(
        persisted_status=persisted_status,
        game_state=game_state,
        attendance_status=attendance_status,
        attendance_recorded_at=attendance_recorded_at,
        attendance_corrected_at=attendance_corrected_at,
    )
    return ViewerRegistration(
        id=application_id,
        display_name=display_name,
        position=position,
        note=note,
        persisted_status=RegistrationPersistedStatus(persisted_status.value),
        effective_status=project_effective_registration_status(persisted_status, game_state),
        version=version,
        applied_at=applied_at,
        decided_at=decided_at,
        withdrawn_at=withdrawn_at,
        withdrawal_kind=(
            RegistrationWithdrawalKind(withdrawal_kind.value)
            if withdrawal_kind is not None
            else None
        ),
        late_exit_recorded=late_exit_recorded,
        available_withdrawal_action=withdrawal.action,
        late_exit_will_be_recorded=withdrawal.late_exit_will_be_recorded,
        waitlist_position=waitlist_position,
        waitlisted_at=waitlisted_at,
        promoted_at=promoted_at,
        attendance_status=projected_attendance_status,
        attendance_recorded_at=projected_attendance_recorded_at,
        attendance_corrected_at=projected_attendance_corrected_at,
        removed_at=removed_at,
    )


def project_public_roster_member(
    *,
    nickname: str,
    avatar_url: str | None,
    registration_id: uuid.UUID,
    version: int,
    owner_can_remove: bool | None,
) -> PublicRosterMember:
    return PublicRosterMember(
        nickname=nickname,
        avatar_url=avatar_url,
        management=(
            RosterMemberManagement(
                registration_id=registration_id,
                version=version,
                can_remove=owner_can_remove,
                can_allow_reapply=False,
            )
            if owner_can_remove is not None
            else None
        ),
    )


def project_public_waitlisted_member(
    *,
    nickname: str,
    avatar_url: str | None,
    registration_id: uuid.UUID,
    version: int,
    waitlist_position: int,
    owner_can_remove: bool | None,
) -> PublicWaitlistedMember:
    return PublicWaitlistedMember(
        nickname=nickname,
        avatar_url=avatar_url,
        waitlist_position=waitlist_position,
        management=(
            RosterMemberManagement(
                registration_id=registration_id,
                version=version,
                can_remove=owner_can_remove,
                can_allow_reapply=False,
            )
            if owner_can_remove is not None
            else None
        ),
    )


def project_blocked_roster_member(
    *,
    nickname: str,
    avatar_url: str | None,
    registration_id: uuid.UUID,
    version: int,
) -> PublicRosterMember:
    return PublicRosterMember(
        nickname=nickname,
        avatar_url=avatar_url,
        management=RosterMemberManagement(
            registration_id=registration_id,
            version=version,
            can_remove=False,
            can_allow_reapply=True,
        ),
    )


def project_member_roster_item(
    *,
    registration_id: uuid.UUID,
    display_name: str,
    position: OpenGameRegistrationPosition,
    decided_at: datetime,
    waitlisted_at: datetime | None,
    promoted_at: datetime | None,
    attendance_status: OpenGameAttendanceStatus,
    version: int,
    game_state: EffectiveOpenGameState,
    stored_game_status: OpenGameStatus,
    order_authority_healthy: bool,
    starts_at: datetime,
    now: datetime,
) -> OpenGameMemberRosterItem:
    """Project only the identity and eligibility fields an owner needs."""
    return OpenGameMemberRosterItem(
        registration_id=registration_id,
        display_name=display_name,
        position=position,
        joined_at=promoted_at or decided_at,
        promoted_from_waitlist=promoted_at is not None,
        version=version,
        allowed_actions=project_member_removal_actions(
            MemberRemovalFacts(
                game_state=game_state,
                stored_game_status=stored_game_status,
                order_authority_healthy=order_authority_healthy,
                starts_at=starts_at,
                attendance_status=attendance_status,
            ),
            now=now,
        ),
    )


def project_captain_application(
    *,
    application_id: uuid.UUID,
    display_name: str,
    position: OpenGameRegistrationPosition,
    note: str | None,
    applied_at: datetime,
    version: int,
    allowed_actions: ReviewActions,
) -> CaptainApplication:
    """Rebuild the owner response from its reviewed field whitelist."""
    return CaptainApplication(
        id=application_id,
        display_name=display_name,
        position=position,
        note=note,
        applied_at=applied_at,
        version=version,
        allowed_actions=allowed_actions,
    )


def project_attendance_roster_item(
    *,
    registration_id: uuid.UUID,
    display_name: str,
    position: OpenGameRegistrationPosition,
    attendance_status: OpenGameAttendanceStatus,
    attendance_recorded_at: datetime | None,
    attendance_corrected_at: datetime | None,
    version: int,
) -> OpenGameAttendanceRosterItem:
    """Project only the per-game identity and attendance fields the captain needs."""
    return OpenGameAttendanceRosterItem(
        registration_id=registration_id,
        display_name=display_name,
        position=position,
        attendance_status=attendance_status,
        attendance_recorded_at=attendance_recorded_at,
        attendance_corrected_at=attendance_corrected_at,
        version=version,
    )


def project_captain_waitlist_application(
    *,
    application_id: uuid.UUID,
    display_name: str,
    position: OpenGameRegistrationPosition,
    note: str | None,
    applied_at: datetime,
    waitlisted_at: datetime,
    waitlist_position: int,
) -> CaptainWaitlistApplication:
    """Rebuild an active waitlist item from its reviewed field whitelist."""
    return CaptainWaitlistApplication(
        id=application_id,
        display_name=display_name,
        position=position,
        note=note,
        applied_at=applied_at,
        waitlisted_at=waitlisted_at,
        waitlist_position=waitlist_position,
    )


def project_my_open_game_application(
    *,
    application_id: uuid.UUID,
    game_id: uuid.UUID,
    persisted_status: OpenGameRegistrationStatus,
    applied_at: datetime,
    share_token: str,
    projection: AuthoritativePublicGameProjection,
    waitlist_position: int | None = None,
    waitlisted_at: datetime | None = None,
    promoted_at: datetime | None = None,
    attendance_status: OpenGameAttendanceStatus = OpenGameAttendanceStatus.UNMARKED,
    attendance_recorded_at: datetime | None = None,
    attendance_corrected_at: datetime | None = None,
) -> MyOpenGameApplication:
    """Rebuild the self-only list item from its closed public whitelist."""
    public = projection.public
    (
        projected_attendance_status,
        projected_attendance_recorded_at,
        projected_attendance_corrected_at,
    ) = _project_self_attendance(
        persisted_status=persisted_status,
        game_state=projection.state,
        attendance_status=attendance_status,
        attendance_recorded_at=attendance_recorded_at,
        attendance_corrected_at=attendance_corrected_at,
    )
    return MyOpenGameApplication(
        id=application_id,
        effective_status=project_effective_registration_status(
            persisted_status,
            projection.state,
        ),
        applied_at=applied_at,
        waitlist_position=waitlist_position,
        waitlisted_at=waitlisted_at,
        promoted_at=promoted_at,
        attendance_status=projected_attendance_status,
        attendance_recorded_at=projected_attendance_recorded_at,
        attendance_corrected_at=projected_attendance_corrected_at,
        detail_path=(f"/pages/captain-game-public/index?token={share_token}&game_id={game_id}"),
        game_name=public.name,
        starts_at=public.starts_at,
        ends_at=public.ends_at,
        time_zone=public.time_zone,
        venue_name=public.venue_name,
        pitch_name=public.pitch_name,
        pitch_specification=public.pitch_specification,
    )


def _project_self_attendance(
    *,
    persisted_status: OpenGameRegistrationStatus,
    game_state: EffectiveOpenGameState,
    attendance_status: OpenGameAttendanceStatus,
    attendance_recorded_at: datetime | None,
    attendance_corrected_at: datetime | None,
) -> tuple[OpenGameAttendanceStatus | None, datetime | None, datetime | None]:
    if (
        persisted_status is not OpenGameRegistrationStatus.JOINED
        or game_state is not EffectiveOpenGameState.COMPLETED
    ):
        return None, None, None
    return attendance_status, attendance_recorded_at, attendance_corrected_at
