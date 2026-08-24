"""Explicit privacy projections for open-game registration responses."""

import uuid
from datetime import datetime

from backend.app.models import (
    OpenGameRegistrationPosition,
    OpenGameRegistrationStatus,
)
from backend.app.modules.open_game_registrations.dto import (
    CaptainApplication,
    ViewerRegistration,
)
from backend.app.modules.open_game_registrations.lifecycle import (
    ReviewActions,
    project_effective_registration_status,
)
from backend.app.modules.open_games.lifecycle import EffectiveOpenGameState

VIEWER_REGISTRATION_FIELDS = frozenset(
    {
        "display_name",
        "position",
        "note",
        "persisted_status",
        "effective_status",
        "applied_at",
        "decided_at",
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


def project_viewer_registration(
    *,
    display_name: str,
    position: OpenGameRegistrationPosition,
    note: str | None,
    persisted_status: OpenGameRegistrationStatus,
    game_state: EffectiveOpenGameState,
    applied_at: datetime,
    decided_at: datetime | None,
) -> ViewerRegistration:
    """Rebuild the applicant response from its reviewed field whitelist."""
    return ViewerRegistration(
        display_name=display_name,
        position=position,
        note=note,
        persisted_status=persisted_status,
        effective_status=project_effective_registration_status(
            persisted_status, game_state
        ),
        applied_at=applied_at,
        decided_at=decided_at,
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
