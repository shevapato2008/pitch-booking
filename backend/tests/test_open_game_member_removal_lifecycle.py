from __future__ import annotations

import uuid
from dataclasses import fields
from datetime import UTC, datetime, timedelta

import pytest
from pydantic import ValidationError

from backend.app.models import (
    OpenGameAttendanceStatus,
    OpenGameRegistrationPosition,
    OpenGameRegistrationStatus,
    OpenGameStatus,
)
from backend.app.modules.open_game_registrations.dto import (
    OpenGameMemberGameSummary,
    OpenGameMemberRemovalRequest,
    OpenGameMemberRemovalResult,
    OpenGameMemberRoster,
    OpenGameMemberRosterItem,
    OpenGamePromotedMember,
    RegistrationPersistedStatus,
    ViewerRegistration,
)
from backend.app.modules.open_game_registrations.lifecycle import (
    EffectiveRegistrationStatus,
    MemberRemovalBlockedReason,
    MemberRemovalFacts,
    project_effective_registration_status,
    project_member_removal_actions,
)
from backend.app.modules.open_game_registrations.privacy import (
    MEMBER_ROSTER_ITEM_FIELDS,
    VIEWER_REGISTRATION_FIELDS,
    project_member_roster_item,
    project_viewer_registration,
)
from backend.app.modules.open_games.lifecycle import EffectiveOpenGameState

NOW = datetime(2026, 9, 1, 8, tzinfo=UTC)
GAME_ID = uuid.UUID("51000000-0000-4000-8000-000000000001")
REGISTRATION_ID = uuid.UUID("52000000-0000-4000-8000-000000000001")


def _facts(**overrides: object) -> MemberRemovalFacts:
    values: dict[str, object] = {
        "game_state": EffectiveOpenGameState.PUBLISHED,
        "stored_game_status": OpenGameStatus.PUBLISHED,
        "order_authority_healthy": True,
        "starts_at": NOW + timedelta(hours=2),
        "attendance_status": OpenGameAttendanceStatus.UNMARKED,
    }
    values.update(overrides)
    return MemberRemovalFacts(**values)  # type: ignore[arg-type]


def _summary(**overrides: object) -> OpenGameMemberGameSummary:
    values: dict[str, object] = {
        "id": GAME_ID,
        "name": "海河周六轻松局",
        "venue_name": "天津河东体育中心",
        "pitch_name": "笼式五人制 2 号场",
        "starts_at": NOW + timedelta(hours=2),
        "ends_at": NOW + timedelta(hours=3),
        "time_zone": "Asia/Shanghai",
        "state": EffectiveOpenGameState.PUBLISHED,
    }
    values.update(overrides)
    return OpenGameMemberGameSummary(**values)  # type: ignore[arg-type]


def _roster_item(**overrides: object) -> OpenGameMemberRosterItem:
    values: dict[str, object] = {
        "registration_id": REGISTRATION_ID,
        "display_name": "小陈",
        "position": OpenGameRegistrationPosition.DEFENDER,
        "joined_at": NOW - timedelta(hours=1),
        "promoted_from_waitlist": False,
        "version": 2,
        "allowed_actions": project_member_removal_actions(_facts(), now=NOW),
    }
    values.update(overrides)
    return OpenGameMemberRosterItem(**values)  # type: ignore[arg-type]


def test_member_removal_facts_are_the_minimum_frozen_authority_boundary() -> None:
    assert [field.name for field in fields(MemberRemovalFacts)] == [
        "game_state",
        "stored_game_status",
        "order_authority_healthy",
        "starts_at",
        "attendance_status",
    ]
    facts = _facts()
    assert not hasattr(facts, "__dict__")
    with pytest.raises(AttributeError):
        facts.order_authority_healthy = False  # type: ignore[misc]


@pytest.mark.parametrize(
    ("overrides", "blocker"),
    [
        ({}, None),
        (
            {"game_state": EffectiveOpenGameState.DRAFT},
            MemberRemovalBlockedReason.GAME_NOT_PUBLISHED,
        ),
        (
            {"stored_game_status": OpenGameStatus.DRAFT},
            MemberRemovalBlockedReason.GAME_NOT_PUBLISHED,
        ),
        (
            {"game_state": EffectiveOpenGameState.SUSPENDED},
            MemberRemovalBlockedReason.GAME_SUSPENDED,
        ),
        (
            {"game_state": EffectiveOpenGameState.CANCELLED},
            MemberRemovalBlockedReason.GAME_CANCELLED,
        ),
        (
            {"game_state": EffectiveOpenGameState.COMPLETED},
            MemberRemovalBlockedReason.GAME_COMPLETED,
        ),
        ({"starts_at": NOW}, MemberRemovalBlockedReason.GAME_STARTED),
        ({"order_authority_healthy": False}, MemberRemovalBlockedReason.ORDER_AUTHORITY_UNHEALTHY),
        (
            {"attendance_status": OpenGameAttendanceStatus.PRESENT},
            MemberRemovalBlockedReason.ATTENDANCE_RECORDED,
        ),
        (
            {"attendance_status": OpenGameAttendanceStatus.NO_SHOW},
            MemberRemovalBlockedReason.ATTENDANCE_RECORDED,
        ),
    ],
)
def test_member_removal_actions_freeze_every_server_authority_blocker(
    overrides: dict[str, object], blocker: MemberRemovalBlockedReason | None
) -> None:
    actions = project_member_removal_actions(_facts(**overrides), now=NOW)
    assert actions.can_remove is (blocker is None)
    assert actions.remove_blocked_reason is blocker
    with pytest.raises(ValidationError):
        actions.can_remove = False  # type: ignore[misc]


def test_removal_request_trims_reason_and_rejects_empty_private_or_extra_input() -> None:
    assert (
        OpenGameMemberRemovalRequest.model_validate(
            {"expected_version": 2, "reason": "  临时有人员调整  "}
        ).reason
        == "临时有人员调整"
    )
    for invalid in (
        {"expected_version": 2, "reason": "   "},
        {"expected_version": 0, "reason": "人员调整"},
        {"expected_version": 2, "reason": "请联系微信 wx abc"},
        {"expected_version": 2, "reason": "人员调整", "notify": True},
    ):
        with pytest.raises(ValidationError):
            OpenGameMemberRemovalRequest.model_validate(invalid)


def test_roster_dtos_are_closed_frozen_counted_and_privacy_minimal() -> None:
    assert (
        set(OpenGameMemberRosterItem.model_fields)
        == MEMBER_ROSTER_ITEM_FIELDS
        == {
            "registration_id",
            "display_name",
            "position",
            "joined_at",
            "promoted_from_waitlist",
            "version",
            "allowed_actions",
        }
    )
    projected = project_member_roster_item(
        registration_id=REGISTRATION_ID,
        display_name="小陈",
        position=OpenGameRegistrationPosition.DEFENDER,
        decided_at=NOW - timedelta(hours=2),
        waitlisted_at=None,
        promoted_at=None,
        attendance_status=OpenGameAttendanceStatus.UNMARKED,
        version=2,
        game_state=EffectiveOpenGameState.PUBLISHED,
        stored_game_status=OpenGameStatus.PUBLISHED,
        order_authority_healthy=True,
        starts_at=NOW + timedelta(hours=2),
        now=NOW,
    )
    assert projected == _roster_item(joined_at=NOW - timedelta(hours=2))
    assert set(projected.model_dump()) == MEMBER_ROSTER_ITEM_FIELDS
    for forbidden in ("user_id", "applicant_user_id", "note", "reason", "order_id"):
        assert forbidden not in projected.model_dump()
    with pytest.raises(ValidationError):
        OpenGameMemberRoster(
            game=_summary(),
            joined_count=2,
            remaining_spots=0,
            waitlist_count=0,
            members=(projected,),
        )


def test_promoted_history_uses_promoted_at_as_joined_time() -> None:
    item = project_member_roster_item(
        registration_id=REGISTRATION_ID,
        display_name="小陈",
        position=OpenGameRegistrationPosition.DEFENDER,
        decided_at=NOW - timedelta(hours=3),
        waitlisted_at=NOW - timedelta(hours=3),
        promoted_at=NOW - timedelta(hours=1),
        attendance_status=OpenGameAttendanceStatus.UNMARKED,
        version=3,
        game_state=EffectiveOpenGameState.PUBLISHED,
        stored_game_status=OpenGameStatus.PUBLISHED,
        order_authority_healthy=True,
        starts_at=NOW + timedelta(hours=2),
        now=NOW,
    )
    assert item.joined_at == NOW - timedelta(hours=1)
    assert item.promoted_from_waitlist is True


def test_removal_result_is_exact_and_promotion_is_capacity_neutral() -> None:
    promoted = OpenGamePromotedMember(
        registration_id=uuid.UUID("52000000-0000-4000-8000-000000000002"),
        display_name="小林",
        position=OpenGameRegistrationPosition.GOALKEEPER,
        version=3,
    )
    result = OpenGameMemberRemovalResult(
        removed_registration_id=REGISTRATION_ID,
        removed_display_name="小陈",
        status="REMOVED",
        version=3,
        removed_at=NOW,
        joined_count=2,
        remaining_spots=0,
        waitlist_count=0,
        promoted_member=promoted,
    )
    assert set(result.model_dump()) == {
        "removed_registration_id",
        "removed_display_name",
        "status",
        "version",
        "removed_at",
        "joined_count",
        "remaining_spots",
        "waitlist_count",
        "promoted_member",
    }
    with pytest.raises(ValidationError):
        OpenGameMemberRemovalResult(**{**result.model_dump(), "remaining_spots": 1})


def test_removed_registration_is_terminal_self_readback_without_reason() -> None:
    assert RegistrationPersistedStatus.REMOVED.value == "REMOVED"
    assert EffectiveRegistrationStatus.REMOVED.value == "REMOVED"
    assert (
        project_effective_registration_status(
            OpenGameRegistrationStatus.REMOVED,
            EffectiveOpenGameState.PUBLISHED,
        )
        is EffectiveRegistrationStatus.REMOVED
    )
    removed_at = NOW + timedelta(minutes=1)
    projected = project_viewer_registration(
        application_id=REGISTRATION_ID,
        display_name="小陈",
        position=OpenGameRegistrationPosition.DEFENDER,
        note=None,
        persisted_status=OpenGameRegistrationStatus.REMOVED,
        game_state=EffectiveOpenGameState.PUBLISHED,
        version=3,
        applied_at=NOW - timedelta(days=1),
        decided_at=NOW - timedelta(hours=2),
        withdrawn_at=None,
        withdrawal_kind=None,
        late_exit_recorded=False,
        starts_at=NOW + timedelta(hours=2),
        now=NOW,
        removed_at=removed_at,
    )
    assert projected.removed_at == removed_at
    assert projected.available_withdrawal_action is None
    assert set(projected.model_dump()) == VIEWER_REGISTRATION_FIELDS
    assert "reason" not in projected.model_dump()
    with pytest.raises(ValidationError):
        ViewerRegistration.model_validate({**projected.model_dump(), "removed_at": None})
