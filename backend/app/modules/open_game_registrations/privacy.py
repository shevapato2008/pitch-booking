"""Explicit privacy projections for open-game registration responses."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from backend.app.models import (
    OpenGameRegistrationPosition,
    OpenGameRegistrationStatus,
    OpenGameRegistrationWithdrawalKind,
)
from backend.app.modules.open_game_registrations.dto import (
    CaptainApplication,
    MyOpenGameApplication,
    ViewerRegistration,
)
from backend.app.modules.open_game_registrations.lifecycle import (
    ReviewActions,
    project_effective_registration_status,
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
) -> ViewerRegistration:
    """Rebuild the applicant response from its reviewed field whitelist."""
    return ViewerRegistration(
        id=application_id,
        display_name=display_name,
        position=position,
        note=note,
        persisted_status=persisted_status,
        effective_status=project_effective_registration_status(
            persisted_status, game_state
        ),
        version=version,
        applied_at=applied_at,
        decided_at=decided_at,
        withdrawn_at=withdrawn_at,
        withdrawal_kind=withdrawal_kind,
        late_exit_recorded=late_exit_recorded,
        available_withdrawal_action=None,
        late_exit_will_be_recorded=False,
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


def project_my_open_game_application(
    *,
    application_id: uuid.UUID,
    persisted_status: OpenGameRegistrationStatus,
    applied_at: datetime,
    share_token: str,
    projection: AuthoritativePublicGameProjection,
) -> MyOpenGameApplication:
    """Rebuild the self-only list item from its closed public whitelist."""
    public = projection.public
    return MyOpenGameApplication(
        id=application_id,
        effective_status=project_effective_registration_status(
            persisted_status,
            projection.state,
        ),
        applied_at=applied_at,
        detail_path=f"/pages/captain-game-public/index?token={share_token}",
        game_name=public.name,
        starts_at=public.starts_at,
        ends_at=public.ends_at,
        time_zone=public.time_zone,
        venue_name=public.venue_name,
        pitch_name=public.pitch_name,
        pitch_specification=public.pitch_specification,
    )
