import uuid
from datetime import UTC, datetime, timedelta
from typing import cast

from sqlalchemy import Boolean, DateTime, Table
from sqlalchemy import Enum as SqlEnum
from sqlalchemy.schema import DefaultClause

from backend.app import models
from backend.app.models import OpenGameRegistrationStatus
from backend.app.modules.open_game_registrations import lifecycle
from backend.app.modules.open_game_registrations.dto import ViewerRegistration
from backend.app.modules.open_game_registrations.privacy import (
    VIEWER_REGISTRATION_FIELDS,
    project_viewer_registration,
)
from backend.app.modules.open_games.lifecycle import EffectiveOpenGameState

NOW = datetime(2026, 8, 30, 12, tzinfo=UTC)


def test_persisted_registration_status_includes_terminal_withdrawn() -> None:
    assert [status.value for status in OpenGameRegistrationStatus] == [
        "APPLIED",
        "JOINED",
        "REJECTED",
        "WITHDRAWN",
    ]


def test_withdrawal_kind_and_effective_status_are_closed_enums() -> None:
    assert [kind.value for kind in models.OpenGameRegistrationWithdrawalKind] == [
        "APPLICATION_WITHDRAWAL",
        "GAME_EXIT",
    ]
    assert [status.value for status in lifecycle.EffectiveRegistrationStatus] == [
        "APPLIED",
        "WAITLISTED",
        "JOINED",
        "REJECTED",
        "WITHDRAWN",
        "CANCELLED",
    ]


def test_cancelled_game_overrides_withdrawn_effective_status() -> None:
    assert lifecycle.project_effective_registration_status(
        OpenGameRegistrationStatus.WITHDRAWN,
        EffectiveOpenGameState.PUBLISHED,
    ) is lifecycle.EffectiveRegistrationStatus.WITHDRAWN
    assert lifecycle.project_effective_registration_status(
        OpenGameRegistrationStatus.WITHDRAWN,
        EffectiveOpenGameState.CANCELLED,
    ) is lifecycle.EffectiveRegistrationStatus.CANCELLED


def test_compatibility_viewer_projection_exposes_closed_withdrawal_authority() -> None:
    expected_fields = {
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
        "waitlist_position",
        "waitlisted_at",
        "promoted_at",
    }
    assert set(ViewerRegistration.model_fields) == expected_fields
    assert VIEWER_REGISTRATION_FIELDS == expected_fields

    application_id = uuid.UUID("40000000-0000-4000-8000-000000000099")
    projected = project_viewer_registration(
        application_id=application_id,
        display_name="周末小翼",
        position=models.OpenGameRegistrationPosition.FORWARD,
        note=None,
        persisted_status=OpenGameRegistrationStatus.WITHDRAWN,
        game_state=EffectiveOpenGameState.PUBLISHED,
        version=2,
        applied_at=NOW,
        decided_at=None,
        withdrawn_at=NOW,
        withdrawal_kind=models.OpenGameRegistrationWithdrawalKind.APPLICATION_WITHDRAWAL,
        late_exit_recorded=False,
        starts_at=NOW + timedelta(hours=2),
        now=NOW,
    )
    assert projected.model_dump(mode="json") == {
        "id": str(application_id),
        "display_name": "周末小翼",
        "position": "FORWARD",
        "note": None,
        "persisted_status": "WITHDRAWN",
        "effective_status": "WITHDRAWN",
        "version": 2,
        "applied_at": NOW.isoformat().replace("+00:00", "Z"),
        "decided_at": None,
        "withdrawn_at": NOW.isoformat().replace("+00:00", "Z"),
        "withdrawal_kind": "APPLICATION_WITHDRAWAL",
        "late_exit_recorded": False,
        "available_withdrawal_action": None,
        "late_exit_will_be_recorded": False,
        "waitlist_position": None,
        "waitlisted_at": None,
        "promoted_at": None,
    }


def test_model_declares_withdrawal_audit_columns_and_constraints() -> None:
    table = cast(Table, models.OpenGameRegistration.__table__)
    assert isinstance(table.c.withdrawn_at.type, DateTime)
    assert table.c.withdrawn_at.type.timezone is True
    assert table.c.withdrawn_at.nullable is True
    assert isinstance(table.c.withdrawal_kind.type, SqlEnum)
    assert table.c.withdrawal_kind.type.name == "open_game_registration_withdrawal_kind"
    assert table.c.withdrawal_kind.nullable is True
    assert isinstance(table.c.late_exit_recorded.type, Boolean)
    assert table.c.late_exit_recorded.nullable is False
    assert isinstance(table.c.late_exit_recorded.server_default, DefaultClause)
    assert str(table.c.late_exit_recorded.server_default.arg).lower() == "false"
    assert {constraint.name for constraint in table.constraints} >= {
        "ck_open_game_registrations_decision_pair",
        "ck_open_game_registrations_withdrawal_pair",
        "ck_open_game_registrations_decision_time",
        "ck_open_game_registrations_withdrawal_time",
    }
