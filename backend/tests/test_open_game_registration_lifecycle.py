from __future__ import annotations

import json
from dataclasses import fields
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

import pytest
from pydantic import ValidationError

from backend.app.models import (
    OpenGameRegistrationPosition,
    OpenGameRegistrationStatus,
    OpenGameStatus,
)
from backend.app.modules.open_game_registrations.dto import (
    OPEN_GAME_REGISTRATION_CONSENT_VERSION,
    ApplicationDecision,
    CaptainApplication,
    CreateApplicationRequest,
    DecisionRequest,
    DecisionResult,
    DecisionResultStatus,
    MyOpenGameApplication,
    Queue,
    RegistrationPersistedStatus,
    RegistrationWithdrawalKind,
    ViewerRegistration,
    WithdrawalRequest,
)
from backend.app.modules.open_game_registrations.lifecycle import (
    ApplyActions,
    ApplyBlockedReason,
    AvailableWithdrawalAction,
    EffectiveRegistrationStatus,
    RegistrationFacts,
    ReviewActions,
    ReviewBlockedReason,
    WaitlistBlockedReason,
    WithdrawalAction,
    project_apply_actions,
    project_available_withdrawal,
    project_effective_registration_status,
    project_review_actions,
    remaining_spots,
)
from backend.app.modules.open_game_registrations.privacy import (
    CAPTAIN_APPLICATION_FIELDS,
    VIEWER_REGISTRATION_FIELDS,
    project_captain_application,
    project_viewer_registration,
)
from backend.app.modules.open_games.lifecycle import EffectiveOpenGameState

NOW = datetime(2026, 8, 24, 12, tzinfo=UTC)


def _valid_request(**overrides: object) -> dict[str, object]:
    request: dict[str, object] = {
        "display_name": "中场老范",
        "position": "MIDFIELDER",
        "note": "主要踢后腰，左脚，会提前到场热身",
        "adult_confirmed": True,
        "risk_confirmed": True,
    }
    request.update(overrides)
    return request


def _facts(**overrides: object) -> RegistrationFacts:
    values: dict[str, object] = {
        "game_state": EffectiveOpenGameState.PUBLISHED,
        "stored_game_status": OpenGameStatus.PUBLISHED,
        "viewer_authenticated": True,
        "viewer_is_owner": False,
        "viewer_has_registration": False,
        "registration_deadline": NOW + timedelta(hours=1),
        "starts_at": NOW + timedelta(hours=2),
        "open_spots": 4,
        "joined_count": 1,
    }
    values.update(overrides)
    return RegistrationFacts(**values)  # type: ignore[arg-type]


def _review_actions() -> ReviewActions:
    return ReviewActions(
        can_accept=True,
        accept_blocked_reason=None,
        can_waitlist=False,
        waitlist_blocked_reason="GAME_NOT_FULL",
        can_reject=True,
        reject_blocked_reason=None,
    )


def _all_keys(value: object) -> set[str]:
    if isinstance(value, dict):
        return set(value) | {
            nested_key for nested_value in value.values() for nested_key in _all_keys(nested_value)
        }
    if isinstance(value, list):
        return {nested_key for nested_value in value for nested_key in _all_keys(nested_value)}
    return set()


def test_registration_facts_are_the_exact_frozen_authority_boundary() -> None:
    assert [field.name for field in fields(RegistrationFacts)] == [
        "game_state",
        "stored_game_status",
        "viewer_authenticated",
        "viewer_is_owner",
        "viewer_has_registration",
        "registration_deadline",
        "starts_at",
        "open_spots",
        "joined_count",
    ]
    facts = _facts()
    assert not hasattr(facts, "__dict__")
    with pytest.raises(AttributeError):
        facts.joined_count = 2  # type: ignore[misc]


def test_request_has_exact_fields_and_server_owned_consent_version() -> None:
    assert OPEN_GAME_REGISTRATION_CONSENT_VERSION == "c1a-2026-08-24"
    assert set(CreateApplicationRequest.model_fields) == {
        "display_name",
        "position",
        "note",
        "adult_confirmed",
        "risk_confirmed",
    }
    assert all(field.is_required() for field in CreateApplicationRequest.model_fields.values())


def test_withdrawal_request_is_closed_strict_and_explicit() -> None:
    assert set(WithdrawalRequest.model_fields) == {"action", "expected_version"}
    assert (
        WithdrawalRequest.model_validate(
            {"action": "WITHDRAW_APPLICATION", "expected_version": 1}
        ).action
        is WithdrawalAction.WITHDRAW_APPLICATION
    )
    assert (
        WithdrawalRequest.model_validate({"action": "LEAVE_GAME", "expected_version": 2}).action
        is WithdrawalAction.LEAVE_GAME
    )
    assert (
        WithdrawalRequest.model_validate(
            {"action": "WITHDRAW_WAITLIST", "expected_version": 2}
        ).action
        is WithdrawalAction.WITHDRAW_WAITLIST
    )
    for invalid in (
        {"action": "LEAVE_GAME"},
        {"action": "LEAVE_GAME", "expected_version": 0},
        {"action": "AUTO", "expected_version": 1},
        {"action": "LEAVE_GAME", "expected_version": 2, "late": True},
    ):
        with pytest.raises(ValidationError):
            WithdrawalRequest.model_validate(invalid)


@pytest.mark.parametrize(
    ("status", "game_state", "now", "expected_action", "expected_late"),
    [
        (
            OpenGameRegistrationStatus.APPLIED,
            EffectiveOpenGameState.PUBLISHED,
            NOW,
            AvailableWithdrawalAction.WITHDRAW_APPLICATION,
            False,
        ),
        (
            OpenGameRegistrationStatus.APPLIED,
            EffectiveOpenGameState.SUSPENDED,
            NOW,
            AvailableWithdrawalAction.WITHDRAW_APPLICATION,
            False,
        ),
        (
            OpenGameRegistrationStatus.JOINED,
            EffectiveOpenGameState.PUBLISHED,
            NOW,
            AvailableWithdrawalAction.LEAVE_GAME,
            False,
        ),
        (
            OpenGameRegistrationStatus.JOINED,
            EffectiveOpenGameState.PUBLISHED,
            NOW + timedelta(microseconds=1),
            AvailableWithdrawalAction.LEAVE_GAME,
            True,
        ),
        (
            OpenGameRegistrationStatus.JOINED,
            EffectiveOpenGameState.SUSPENDED,
            NOW + timedelta(microseconds=1),
            AvailableWithdrawalAction.LEAVE_GAME,
            True,
        ),
        (
            OpenGameRegistrationStatus.WAITLISTED,
            EffectiveOpenGameState.PUBLISHED,
            NOW,
            AvailableWithdrawalAction.WITHDRAW_WAITLIST,
            False,
        ),
        (
            OpenGameRegistrationStatus.WAITLISTED,
            EffectiveOpenGameState.SUSPENDED,
            NOW,
            AvailableWithdrawalAction.WITHDRAW_WAITLIST,
            False,
        ),
        (
            OpenGameRegistrationStatus.REJECTED,
            EffectiveOpenGameState.PUBLISHED,
            NOW,
            None,
            False,
        ),
        (
            OpenGameRegistrationStatus.WITHDRAWN,
            EffectiveOpenGameState.PUBLISHED,
            NOW,
            None,
            False,
        ),
        (
            OpenGameRegistrationStatus.JOINED,
            EffectiveOpenGameState.CANCELLED,
            NOW,
            None,
            False,
        ),
        (
            OpenGameRegistrationStatus.JOINED,
            EffectiveOpenGameState.COMPLETED,
            NOW,
            None,
            False,
        ),
        (
            OpenGameRegistrationStatus.JOINED,
            EffectiveOpenGameState.PUBLISHED,
            NOW + timedelta(hours=6),
            None,
            False,
        ),
    ],
)
def test_available_withdrawal_projection_freezes_status_state_and_exact_six_hour_boundary(
    status: OpenGameRegistrationStatus,
    game_state: EffectiveOpenGameState,
    now: datetime,
    expected_action: AvailableWithdrawalAction | None,
    expected_late: bool,
) -> None:
    projection = project_available_withdrawal(
        persisted_status=status,
        game_state=game_state,
        starts_at=NOW + timedelta(hours=6),
        now=now,
    )
    assert projection.action is expected_action
    assert projection.late_exit_will_be_recorded is expected_late


@pytest.mark.parametrize(
    "extra_field",
    [
        "consent_version",
        "adult_confirmed_at",
        "risk_confirmed_at",
        "applied_at",
        "version",
    ],
)
def test_request_forbids_server_owned_and_unknown_fields(extra_field: str) -> None:
    with pytest.raises(ValidationError) as error:
        CreateApplicationRequest.model_validate(
            _valid_request(**{extra_field: "client-controlled"})
        )
    assert any(item["type"] == "extra_forbidden" for item in error.value.errors())


@pytest.mark.parametrize("missing", ["note", "adult_confirmed", "risk_confirmed"])
def test_required_nullable_and_confirmation_fields_cannot_be_omitted(missing: str) -> None:
    request = _valid_request()
    request.pop(missing)
    with pytest.raises(ValidationError):
        CreateApplicationRequest.model_validate(request)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("display_name", 123),
        ("display_name", True),
        ("position", 1),
        ("note", 123),
        ("adult_confirmed", 1),
        ("adult_confirmed", "true"),
        ("risk_confirmed", 1),
        ("risk_confirmed", "true"),
    ],
)
def test_request_scalar_fields_are_strict(field: str, value: object) -> None:
    with pytest.raises(ValidationError):
        CreateApplicationRequest.model_validate(_valid_request(**{field: value}))


@pytest.mark.parametrize("field", ["adult_confirmed", "risk_confirmed"])
def test_both_confirmations_must_be_literal_true(field: str) -> None:
    with pytest.raises(ValidationError):
        CreateApplicationRequest.model_validate(_valid_request(**{field: False}))


def test_position_is_the_exact_five_value_enum() -> None:
    assert [position.value for position in OpenGameRegistrationPosition] == [
        "GOALKEEPER",
        "DEFENDER",
        "MIDFIELDER",
        "FORWARD",
        "ANY",
    ]
    for position in OpenGameRegistrationPosition:
        parsed = CreateApplicationRequest.model_validate(_valid_request(position=position.value))
        assert parsed.position is position
    with pytest.raises(ValidationError):
        CreateApplicationRequest.model_validate(_valid_request(position="WINGER"))


@pytest.mark.parametrize(
    "display_name",
    ["范", "范" * 25, "  范  ", "  范" * 25 + "  "],
)
def test_display_name_uses_trimmed_two_to_twenty_four_code_point_bounds(
    display_name: str,
) -> None:
    with pytest.raises(ValidationError):
        CreateApplicationRequest.model_validate(_valid_request(display_name=display_name))


def test_request_trims_once_but_returns_the_original_non_whitespace_text() -> None:
    request = CreateApplicationRequest.model_validate(
        _valid_request(display_name="  ⚽️  ", note="  主要踢后腰  ")
    )
    assert request.display_name == "⚽️"
    assert len(request.display_name) == 2
    assert request.note == "主要踢后腰"


@pytest.mark.parametrize("note", [None, "", " ", "\t\n"])
def test_empty_trimmed_note_projects_to_none(note: str | None) -> None:
    request = CreateApplicationRequest.model_validate(_valid_request(note=note))
    assert request.note is None


def test_note_has_a_trimmed_one_hundred_twenty_code_point_limit() -> None:
    accepted = CreateApplicationRequest.model_validate(_valid_request(note=f"  {'到' * 120}  "))
    assert accepted.note == "到" * 120
    with pytest.raises(ValidationError):
        CreateApplicationRequest.model_validate(_valid_request(note="到" * 121))


@pytest.mark.parametrize(
    "private_text",
    [
        "电话 13800138000",
        "电话 138-0013-8000",
        "电话 +86 138 0013 8000",
        "电话 ８６-１３８-００１３-８０００",
        "微信号 pitch_friend",
        "加我微信 pitch_friend",
        "加我 vx: pitch_friend",
        "wx: pitch_friend",
        "wechat pitch_friend",
        "详情 https://example.com/team",
        "详情 HTTP://EXAMPLE.COM/team",
        "主页 www.example.cn",
        "主页 example.com ",
        "主页 example.net/roster",
        "主页 example.org ",
        "身份证 120101199001011234",
        "证件 12010119900101123X",
        "证件 120101900101123",
    ],
)
@pytest.mark.parametrize("field", ["display_name", "note"])
def test_captain_visible_text_rejects_approved_private_patterns(
    field: str, private_text: str
) -> None:
    with pytest.raises(ValidationError):
        CreateApplicationRequest.model_validate(_valid_request(**{field: private_text}))


@pytest.mark.parametrize(
    ("display_name", "note"),
    [
        ("中场老范", "主要踢后腰，左脚，会提前到场热身"),
        ("后卫小王", "周末 AA 过球费，会提前到场"),
        ("Team.CN中场", "可以踢 8 号位和 10 号位"),
    ],
)
def test_captain_visible_text_allows_normal_football_content(display_name: str, note: str) -> None:
    request = CreateApplicationRequest.model_validate(
        _valid_request(display_name=display_name, note=note)
    )
    assert request.display_name == display_name
    assert request.note == note


@pytest.mark.parametrize(
    ("open_spots", "joined_count", "expected"),
    [(4, 1, 3), (4, 4, 0), (4, 7, 0), (0, 0, 0)],
)
def test_remaining_spots_is_clamped_at_zero(
    open_spots: int, joined_count: int, expected: int
) -> None:
    assert remaining_spots(open_spots=open_spots, joined_count=joined_count) == expected


@pytest.mark.parametrize(
    ("expected", "overrides"),
    [
        (
            ApplyBlockedReason.GAME_CANCELLED,
            {
                "game_state": EffectiveOpenGameState.CANCELLED,
                "starts_at": NOW,
                "stored_game_status": OpenGameStatus.DRAFT,
                "viewer_has_registration": True,
                "viewer_is_owner": True,
                "registration_deadline": NOW,
                "open_spots": 0,
                "viewer_authenticated": False,
            },
        ),
        (
            ApplyBlockedReason.GAME_COMPLETED,
            {
                "game_state": EffectiveOpenGameState.COMPLETED,
                "starts_at": NOW,
                "stored_game_status": OpenGameStatus.DRAFT,
            },
        ),
        (
            ApplyBlockedReason.GAME_SUSPENDED,
            {
                "game_state": EffectiveOpenGameState.SUSPENDED,
                "starts_at": NOW,
                "stored_game_status": OpenGameStatus.DRAFT,
            },
        ),
        (
            ApplyBlockedReason.GAME_STARTED,
            {
                "starts_at": NOW,
                "stored_game_status": OpenGameStatus.DRAFT,
                "viewer_has_registration": True,
            },
        ),
        (
            ApplyBlockedReason.GAME_NOT_PUBLISHED,
            {
                "stored_game_status": OpenGameStatus.DRAFT,
                "viewer_has_registration": True,
                "viewer_is_owner": True,
            },
        ),
        (
            ApplyBlockedReason.ALREADY_APPLIED,
            {
                "viewer_has_registration": True,
                "viewer_is_owner": True,
                "registration_deadline": NOW,
                "open_spots": 0,
                "viewer_authenticated": False,
            },
        ),
        (
            ApplyBlockedReason.OWNER_CANNOT_APPLY,
            {
                "viewer_is_owner": True,
                "registration_deadline": NOW,
                "open_spots": 0,
                "viewer_authenticated": False,
            },
        ),
        (
            ApplyBlockedReason.REGISTRATION_DEADLINE_PASSED,
            {
                "registration_deadline": NOW,
                "open_spots": 0,
                "viewer_authenticated": False,
            },
        ),
        (None, {"open_spots": 1, "joined_count": 1}),
        (ApplyBlockedReason.AUTH_REQUIRED, {"viewer_authenticated": False}),
        (None, {}),
    ],
)
def test_apply_blocker_precedence_is_exact(
    expected: ApplyBlockedReason | None, overrides: dict[str, object]
) -> None:
    actions = project_apply_actions(_facts(**overrides), NOW)
    assert actions.apply_blocked_reason is expected
    assert actions.can_apply is (expected is None)


def test_full_game_still_allows_an_authenticated_nonowner_to_apply() -> None:
    actions = project_apply_actions(_facts(open_spots=1, joined_count=1), NOW)
    assert actions == ApplyActions(can_apply=True, apply_blocked_reason=None)


def test_apply_deadline_equality_is_blocked_but_one_microsecond_before_is_open() -> None:
    deadline = NOW + timedelta(minutes=15)
    facts = _facts(registration_deadline=deadline)
    assert project_apply_actions(facts, deadline).apply_blocked_reason is (
        ApplyBlockedReason.REGISTRATION_DEADLINE_PASSED
    )
    assert project_apply_actions(facts, deadline - timedelta(microseconds=1)).can_apply


def test_apply_start_equality_has_precedence_over_every_later_blocker() -> None:
    facts = _facts(
        starts_at=NOW,
        stored_game_status=OpenGameStatus.DRAFT,
        viewer_has_registration=True,
        viewer_is_owner=True,
        registration_deadline=NOW,
        open_spots=0,
        viewer_authenticated=False,
    )
    assert project_apply_actions(facts, NOW).apply_blocked_reason is (
        ApplyBlockedReason.GAME_STARTED
    )


def test_apply_actions_require_exact_action_blocker_pairing_and_are_frozen() -> None:
    for values in (
        {"can_apply": True, "apply_blocked_reason": ApplyBlockedReason.AUTH_REQUIRED},
        {"can_apply": False, "apply_blocked_reason": None},
    ):
        with pytest.raises(ValidationError):
            ApplyActions(**values)  # type: ignore[arg-type]

    actions = ApplyActions(can_apply=True, apply_blocked_reason=None)
    with pytest.raises(ValidationError):
        actions.can_apply = False


@pytest.mark.parametrize(
    ("expected", "decision_status", "overrides"),
    [
        (
            ReviewBlockedReason.APPLICATION_NOT_PENDING,
            OpenGameRegistrationStatus.JOINED,
            {"game_state": EffectiveOpenGameState.CANCELLED, "starts_at": NOW},
        ),
        (
            ReviewBlockedReason.GAME_CANCELLED,
            OpenGameRegistrationStatus.APPLIED,
            {"game_state": EffectiveOpenGameState.CANCELLED, "starts_at": NOW},
        ),
        (
            ReviewBlockedReason.GAME_COMPLETED,
            OpenGameRegistrationStatus.APPLIED,
            {"game_state": EffectiveOpenGameState.COMPLETED, "starts_at": NOW},
        ),
        (
            ReviewBlockedReason.GAME_SUSPENDED,
            OpenGameRegistrationStatus.APPLIED,
            {"game_state": EffectiveOpenGameState.SUSPENDED, "starts_at": NOW},
        ),
        (
            ReviewBlockedReason.GAME_STARTED,
            OpenGameRegistrationStatus.APPLIED,
            {"starts_at": NOW, "open_spots": 0},
        ),
    ],
)
def test_review_common_blocker_precedence_is_exact(
    expected: ReviewBlockedReason,
    decision_status: OpenGameRegistrationStatus,
    overrides: dict[str, object],
) -> None:
    actions = project_review_actions(_facts(**overrides), decision_status, NOW)
    assert actions == ReviewActions(
        can_accept=False,
        accept_blocked_reason=expected,
        can_waitlist=False,
        waitlist_blocked_reason=WaitlistBlockedReason(expected.value),
        can_reject=False,
        reject_blocked_reason=expected,
    )


def test_game_full_blocks_accept_but_never_reject() -> None:
    actions = project_review_actions(
        _facts(open_spots=1, joined_count=1), OpenGameRegistrationStatus.APPLIED, NOW
    )
    assert actions.model_dump(mode="json") == {
        "can_accept": False,
        "accept_blocked_reason": "GAME_FULL",
        "can_waitlist": True,
        "waitlist_blocked_reason": None,
        "can_reject": True,
        "reject_blocked_reason": None,
    }


def test_pending_review_has_both_actions_when_common_guards_and_capacity_allow() -> None:
    actions = project_review_actions(_facts(), OpenGameRegistrationStatus.APPLIED, NOW)
    assert actions.model_dump(mode="json") == {
        "can_accept": True,
        "accept_blocked_reason": None,
        "can_waitlist": False,
        "waitlist_blocked_reason": "GAME_NOT_FULL",
        "can_reject": True,
        "reject_blocked_reason": None,
    }


def test_waitlist_read_shapes_accept_future_records_without_opening_write_commands() -> None:
    waitlisted = ViewerRegistration.model_validate(
        {
            "id": "30000000-0000-0000-0000-000000000041",
            "display_name": "中场老范",
            "position": "MIDFIELDER",
            "note": None,
            "persisted_status": "WAITLISTED",
            "effective_status": "WAITLISTED",
            "version": 2,
            "applied_at": NOW,
            "decided_at": NOW + timedelta(minutes=1),
            "withdrawn_at": None,
            "withdrawal_kind": None,
            "late_exit_recorded": False,
            "available_withdrawal_action": "WITHDRAW_WAITLIST",
            "late_exit_will_be_recorded": False,
            "waitlist_position": 1,
            "waitlisted_at": NOW + timedelta(minutes=1),
            "promoted_at": None,
            "attendance_status": None,
            "attendance_recorded_at": None,
            "attendance_corrected_at": None,
            "removed_at": None,
        }
    )
    assert waitlisted.persisted_status.value == "WAITLISTED"
    assert waitlisted.effective_status.value == "WAITLISTED"
    assert waitlisted.waitlist_position == 1

    decision = DecisionResult.model_validate(
        {
            "application_id": "30000000-0000-0000-0000-000000000041",
            "status": "WAITLISTED",
            "version": 2,
            "decided_at": NOW + timedelta(minutes=1),
            "remaining_spots": 0,
            "allowed_actions": {
                "can_accept": False,
                "accept_blocked_reason": "APPLICATION_NOT_PENDING",
                "can_waitlist": False,
                "waitlist_blocked_reason": "APPLICATION_NOT_PENDING",
                "can_reject": False,
                "reject_blocked_reason": "APPLICATION_NOT_PENDING",
            },
        }
    )
    assert decision.status.value == "WAITLISTED"


def test_queue_and_my_application_accept_future_waitlist_read_shapes() -> None:
    queue = Queue.model_validate(
        {
            "remaining_spots": 0,
            "pending_count": 0,
            "applications": [],
            "waitlist_count": 2,
            "waitlist": [
                {
                    "id": "30000000-0000-0000-0000-000000000041",
                    "display_name": "中场老范",
                    "position": "MIDFIELDER",
                    "note": None,
                    "applied_at": NOW,
                    "waitlisted_at": NOW + timedelta(minutes=1),
                    "waitlist_position": 1,
                },
                {
                    "id": "30000000-0000-0000-0000-000000000042",
                    "display_name": "门前老陈",
                    "position": "GOALKEEPER",
                    "note": "可以候补",
                    "applied_at": NOW + timedelta(seconds=1),
                    "waitlisted_at": NOW + timedelta(minutes=2),
                    "waitlist_position": 2,
                },
            ],
        }
    )
    assert queue.waitlist_count == len(queue.waitlist) == 2
    assert [row.waitlist_position for row in queue.waitlist] == [1, 2]
    assert "allowed_actions" not in queue.model_dump(mode="json")["waitlist"][0]
    assert "waitlist_seq" not in queue.model_dump(mode="json")["waitlist"][0]

    mine = MyOpenGameApplication.model_validate(
        {
            "id": "30000000-0000-0000-0000-000000000041",
            "effective_status": "WAITLISTED",
            "applied_at": NOW,
            "waitlist_position": 1,
            "waitlisted_at": NOW + timedelta(minutes=1),
            "promoted_at": None,
            "attendance_status": None,
            "attendance_recorded_at": None,
            "attendance_corrected_at": None,
            "detail_path": (
                "/pages/captain-game-public/index?token=AbCdEfGhIjKlMnOpQrStUvWxYz012345"
                "&game_id=30000000-0000-0000-0000-000000000043"
            ),
            "game_name": "周五浦东七人制",
            "starts_at": NOW + timedelta(hours=2),
            "ends_at": NOW + timedelta(hours=4),
            "time_zone": "Asia/Shanghai",
            "venue_name": "浦东星火足球公园",
            "pitch_name": "A1 场",
            "pitch_specification": "7人制",
        }
    )
    assert mine.effective_status.value == "WAITLISTED"
    assert mine.waitlist_position == 1


def test_viewer_waitlist_lifecycle_rejects_inconsistent_or_inverted_history() -> None:
    valid = {
        "id": "30000000-0000-0000-0000-000000000041",
        "display_name": "中场老范",
        "position": "MIDFIELDER",
        "note": None,
        "persisted_status": "WAITLISTED",
        "effective_status": "WAITLISTED",
        "version": 2,
        "applied_at": NOW,
        "decided_at": NOW + timedelta(minutes=1),
        "withdrawn_at": None,
        "withdrawal_kind": None,
        "late_exit_recorded": False,
        "available_withdrawal_action": "WITHDRAW_WAITLIST",
        "late_exit_will_be_recorded": False,
        "waitlist_position": 1,
        "waitlisted_at": NOW + timedelta(minutes=1),
        "promoted_at": None,
        "attendance_status": None,
        "attendance_recorded_at": None,
        "attendance_corrected_at": None,
        "removed_at": None,
    }
    invalid_patches = (
        {"decided_at": None},
        {"waitlist_position": None},
        {"waitlisted_at": None},
        {"promoted_at": NOW + timedelta(minutes=2)},
        {"decided_at": NOW - timedelta(seconds=1)},
        {"waitlisted_at": NOW - timedelta(seconds=1)},
        {"available_withdrawal_action": "LEAVE_GAME"},
        {"effective_status": "JOINED"},
        {
            "persisted_status": "JOINED",
            "effective_status": "JOINED",
            "waitlist_position": 1,
            "promoted_at": NOW + timedelta(minutes=2),
            "available_withdrawal_action": "LEAVE_GAME",
        },
        {
            "persisted_status": "WITHDRAWN",
            "effective_status": "WITHDRAWN",
            "withdrawal_kind": "WAITLIST_WITHDRAWAL",
            "withdrawn_at": NOW + timedelta(minutes=2),
            "waitlist_position": 1,
            "available_withdrawal_action": None,
        },
    )
    for patch in invalid_patches:
        with pytest.raises(ValidationError):
            ViewerRegistration.model_validate(valid | patch)


def test_viewer_waitlist_lifecycle_accepts_promoted_direct_and_waitlist_withdrawal() -> None:
    base = {
        "id": "30000000-0000-0000-0000-000000000041",
        "display_name": "中场老范",
        "position": "MIDFIELDER",
        "note": None,
        "version": 3,
        "applied_at": NOW,
        "decided_at": NOW + timedelta(minutes=1),
        "withdrawn_at": None,
        "withdrawal_kind": None,
        "late_exit_recorded": False,
        "available_withdrawal_action": "LEAVE_GAME",
        "late_exit_will_be_recorded": False,
        "attendance_status": None,
        "attendance_recorded_at": None,
        "attendance_corrected_at": None,
        "removed_at": None,
    }
    promoted = ViewerRegistration.model_validate(
        base
        | {
            "persisted_status": "JOINED",
            "effective_status": "JOINED",
            "waitlist_position": None,
            "waitlisted_at": NOW + timedelta(minutes=1),
            "promoted_at": NOW + timedelta(minutes=2),
        }
    )
    direct = ViewerRegistration.model_validate(
        base
        | {
            "persisted_status": "JOINED",
            "effective_status": "JOINED",
            "waitlist_position": None,
            "waitlisted_at": None,
            "promoted_at": None,
        }
    )
    withdrawn = ViewerRegistration.model_validate(
        base
        | {
            "persisted_status": "WITHDRAWN",
            "effective_status": "WITHDRAWN",
            "withdrawn_at": NOW + timedelta(minutes=2),
            "withdrawal_kind": "WAITLIST_WITHDRAWAL",
            "available_withdrawal_action": None,
            "waitlist_position": None,
            "waitlisted_at": NOW + timedelta(minutes=1),
            "promoted_at": None,
        }
    )
    assert promoted.waitlisted_at is not None and promoted.promoted_at is not None
    assert direct.waitlisted_at is direct.promoted_at is None
    assert withdrawn.withdrawal_kind.value == "WAITLIST_WITHDRAWAL"


def test_application_withdrawal_cannot_carry_a_late_game_exit_marker() -> None:
    with pytest.raises(ValidationError):
        ViewerRegistration.model_validate(
            {
                "id": "30000000-0000-0000-0000-000000000041",
                "display_name": "中场老范",
                "position": "MIDFIELDER",
                "note": None,
                "persisted_status": "WITHDRAWN",
                "effective_status": "WITHDRAWN",
                "version": 2,
                "applied_at": NOW,
                "decided_at": None,
                "withdrawn_at": NOW + timedelta(minutes=1),
                "withdrawal_kind": "APPLICATION_WITHDRAWAL",
                "late_exit_recorded": True,
                "available_withdrawal_action": None,
                "late_exit_will_be_recorded": False,
                "waitlist_position": None,
                "waitlisted_at": None,
                "promoted_at": None,
                "attendance_status": None,
                "attendance_recorded_at": None,
                "attendance_corrected_at": None,
            }
        )


def test_queue_requires_count_and_contiguous_server_ordered_waitlist_positions() -> None:
    row = {
        "id": "30000000-0000-0000-0000-000000000041",
        "display_name": "中场老范",
        "position": "MIDFIELDER",
        "note": None,
        "applied_at": NOW,
        "waitlisted_at": NOW + timedelta(minutes=1),
        "waitlist_position": 1,
    }
    base = {
        "remaining_spots": 0,
        "pending_count": 0,
        "applications": [],
        "waitlist_count": 1,
        "waitlist": [row],
    }
    for payload in (
        base | {"waitlist_count": 0},
        base | {"waitlist": [row | {"waitlist_position": 2}]},
        base | {"waitlist": [row | {"waitlisted_at": NOW - timedelta(seconds=1)}]},
    ):
        with pytest.raises(ValidationError):
            Queue.model_validate(payload)


def test_review_actions_forbid_accept_and_waitlist_being_available_together() -> None:
    with pytest.raises(ValidationError):
        ReviewActions(
            can_accept=True,
            accept_blocked_reason=None,
            can_waitlist=True,
            waitlist_blocked_reason=None,
            can_reject=True,
            reject_blocked_reason=None,
        )


def test_review_actions_enforce_closed_capacity_and_common_blocker_matrix() -> None:
    future_waitlist = ReviewActions(
        can_accept=False,
        accept_blocked_reason=ReviewBlockedReason.GAME_FULL,
        can_waitlist=True,
        waitlist_blocked_reason=None,
        can_reject=True,
        reject_blocked_reason=None,
    )
    assert future_waitlist.can_waitlist

    for values in (
        {
            "can_accept": False,
            "accept_blocked_reason": ReviewBlockedReason.GAME_FULL,
            "can_waitlist": False,
            "waitlist_blocked_reason": WaitlistBlockedReason.GAME_NOT_FULL,
            "can_reject": True,
            "reject_blocked_reason": None,
        },
        {
            "can_accept": False,
            "accept_blocked_reason": ReviewBlockedReason.GAME_STARTED,
            "can_waitlist": False,
            "waitlist_blocked_reason": WaitlistBlockedReason.GAME_CANCELLED,
            "can_reject": False,
            "reject_blocked_reason": ReviewBlockedReason.GAME_STARTED,
        },
    ):
        with pytest.raises(ValidationError):
            ReviewActions(**values)  # type: ignore[arg-type]


def test_my_waitlisted_item_requires_position_and_waitlisted_time() -> None:
    payload = {
        "id": "30000000-0000-0000-0000-000000000041",
        "effective_status": "WAITLISTED",
        "applied_at": NOW,
        "waitlist_position": None,
        "waitlisted_at": None,
        "promoted_at": None,
        "attendance_status": None,
        "attendance_recorded_at": None,
        "attendance_corrected_at": None,
        "detail_path": (
            "/pages/captain-game-public/index?token="
            "AbCdEfGhIjKlMnOpQrStUvWxYz012345"
        ),
        "game_name": "周五浦东七人制",
        "starts_at": NOW + timedelta(hours=2),
        "ends_at": NOW + timedelta(hours=4),
        "time_zone": "Asia/Shanghai",
        "venue_name": "浦东星火足球公园",
        "pitch_name": "A1 场",
        "pitch_specification": "7人制",
    }
    with pytest.raises(ValidationError):
        MyOpenGameApplication.model_validate(payload)


def test_review_start_equality_is_blocked_but_one_microsecond_before_is_open() -> None:
    starts_at = NOW + timedelta(minutes=15)
    facts = _facts(starts_at=starts_at)
    assert (
        project_review_actions(
            facts, OpenGameRegistrationStatus.APPLIED, starts_at
        ).accept_blocked_reason
        is ReviewBlockedReason.GAME_STARTED
    )
    assert project_review_actions(
        facts,
        OpenGameRegistrationStatus.APPLIED,
        starts_at - timedelta(microseconds=1),
    ).can_accept


@pytest.mark.parametrize(
    "values",
    [
        {
            "can_accept": True,
            "accept_blocked_reason": ReviewBlockedReason.GAME_FULL,
            "can_waitlist": False,
            "waitlist_blocked_reason": WaitlistBlockedReason.GAME_NOT_FULL,
            "can_reject": True,
            "reject_blocked_reason": None,
        },
        {
            "can_accept": False,
            "accept_blocked_reason": None,
            "can_waitlist": False,
            "waitlist_blocked_reason": WaitlistBlockedReason.GAME_NOT_FULL,
            "can_reject": True,
            "reject_blocked_reason": None,
        },
        {
            "can_accept": True,
            "accept_blocked_reason": None,
            "can_waitlist": False,
            "waitlist_blocked_reason": WaitlistBlockedReason.GAME_NOT_FULL,
            "can_reject": False,
            "reject_blocked_reason": None,
        },
        {
            "can_accept": False,
            "accept_blocked_reason": ReviewBlockedReason.GAME_FULL,
            "can_waitlist": False,
            "waitlist_blocked_reason": WaitlistBlockedReason.WAITLIST_NOT_ENABLED,
            "can_reject": False,
            "reject_blocked_reason": ReviewBlockedReason.GAME_FULL,
        },
    ],
)
def test_review_actions_require_exact_action_blocker_pairing(values: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        ReviewActions(**values)  # type: ignore[arg-type]


def test_review_actions_are_frozen() -> None:
    actions = _review_actions()
    with pytest.raises(ValidationError):
        actions.can_accept = False


@pytest.mark.parametrize("persisted_status", list(OpenGameRegistrationStatus))
def test_cancelled_game_projects_cancelled_without_mutating_persisted_status(
    persisted_status: OpenGameRegistrationStatus,
) -> None:
    assert (
        project_effective_registration_status(persisted_status, EffectiveOpenGameState.CANCELLED)
        is EffectiveRegistrationStatus.CANCELLED
    )
    assert persisted_status.value in {
        "APPLIED",
        "WAITLISTED",
        "JOINED",
        "REJECTED",
        "WITHDRAWN",
        "REMOVED",
    }


@pytest.mark.parametrize("persisted_status", list(OpenGameRegistrationStatus))
def test_non_cancelled_game_preserves_persisted_registration_status(
    persisted_status: OpenGameRegistrationStatus,
) -> None:
    for game_state in (
        EffectiveOpenGameState.DRAFT,
        EffectiveOpenGameState.PUBLISHED,
        EffectiveOpenGameState.SUSPENDED,
        EffectiveOpenGameState.COMPLETED,
    ):
        assert (
            project_effective_registration_status(persisted_status, game_state).value
            == persisted_status.value
        )


def test_all_dto_shapes_are_closed_exact_and_required_nullable_fields_stay_required() -> None:
    assert set(ApplyActions.model_fields) == {"can_apply", "apply_blocked_reason"}
    assert set(ReviewActions.model_fields) == {
        "can_accept",
        "accept_blocked_reason",
        "can_waitlist",
        "waitlist_blocked_reason",
        "can_reject",
        "reject_blocked_reason",
    }
    assert set(ViewerRegistration.model_fields) == VIEWER_REGISTRATION_FIELDS
    assert set(CaptainApplication.model_fields) == CAPTAIN_APPLICATION_FIELDS
    assert set(Queue.model_fields) == {
        "remaining_spots",
        "pending_count",
        "applications",
        "waitlist_count",
        "waitlist",
    }
    assert set(DecisionRequest.model_fields) == {"decision", "expected_version"}
    assert set(DecisionResult.model_fields) == {
        "application_id",
        "status",
        "version",
        "decided_at",
        "remaining_spots",
        "allowed_actions",
    }
    for model, nullable_fields in (
        (
            ViewerRegistration,
            {
                "note",
                "decided_at",
                "withdrawn_at",
                "withdrawal_kind",
                "available_withdrawal_action",
                "waitlist_position",
                "waitlisted_at",
                "promoted_at",
            },
        ),
        (CaptainApplication, {"note"}),
        (DecisionResult, {"decided_at"}),
    ):
        assert all(model.model_fields[field].is_required() for field in nullable_fields)


def test_decision_request_and_response_scalar_boundaries_are_strict() -> None:
    request = DecisionRequest(decision="ACCEPT", expected_version=1)
    assert request.decision is ApplicationDecision.ACCEPT
    assert (
        DecisionRequest(decision="WAITLIST", expected_version=1).decision
        is ApplicationDecision.WAITLIST
    )
    for value in (True, 1.0, "1"):
        with pytest.raises(ValidationError):
            DecisionRequest(decision="REJECT", expected_version=value)  # type: ignore[arg-type]
    with pytest.raises(ValidationError):
        DecisionRequest(decision="REJECT", expected_version=0)
    with pytest.raises(ValidationError):
        DecisionRequest(decision="WAIT", expected_version=1)  # type: ignore[arg-type]
    with pytest.raises(ValidationError):
        DecisionRequest(decision="REJECT", expected_version=1, internal=True)  # type: ignore[call-arg]

    result = DecisionResult(
        application_id=UUID("30000000-0000-0000-0000-000000000041"),
        status=DecisionResultStatus.JOINED,
        version=2,
        decided_at=NOW,
        remaining_spots=1,
        allowed_actions=_review_actions(),
    )
    assert result.status is DecisionResultStatus.JOINED
    for field, value in (("version", True), ("remaining_spots", 1.0)):
        with pytest.raises(ValidationError):
            DecisionResult.model_validate({**result.model_dump(), field: value})


def test_applicant_projection_has_an_exact_whitelist_and_effective_cancelled_status() -> None:
    assert isinstance(VIEWER_REGISTRATION_FIELDS, frozenset)
    assert VIEWER_REGISTRATION_FIELDS == frozenset(
        {
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
            "attendance_status",
            "attendance_recorded_at",
            "attendance_corrected_at",
            "removed_at",
        }
    )
    projected = project_viewer_registration(
        application_id=UUID("30000000-0000-0000-0000-000000000041"),
        display_name="中场老范",
        position=OpenGameRegistrationPosition.MIDFIELDER,
        note="主要踢后腰",
        persisted_status=OpenGameRegistrationStatus.JOINED,
        game_state=EffectiveOpenGameState.CANCELLED,
        version=2,
        applied_at=NOW,
        decided_at=NOW + timedelta(minutes=5),
        withdrawn_at=None,
        withdrawal_kind=None,
        late_exit_recorded=False,
        starts_at=NOW + timedelta(hours=2),
        now=NOW,
    )
    assert set(projected.model_dump()) == VIEWER_REGISTRATION_FIELDS
    assert projected.persisted_status is RegistrationPersistedStatus.JOINED
    assert projected.effective_status is EffectiveRegistrationStatus.CANCELLED
    assert projected.attendance_status is None
    assert projected.attendance_recorded_at is None


def test_owner_projection_has_an_exact_whitelist() -> None:
    assert isinstance(CAPTAIN_APPLICATION_FIELDS, frozenset)
    assert CAPTAIN_APPLICATION_FIELDS == frozenset(
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
    projected = project_captain_application(
        application_id=UUID("30000000-0000-0000-0000-000000000041"),
        display_name="中场老范",
        position=OpenGameRegistrationPosition.MIDFIELDER,
        note=None,
        applied_at=NOW,
        version=1,
        allowed_actions=_review_actions(),
    )
    assert set(projected.model_dump()) == CAPTAIN_APPLICATION_FIELDS


def test_privacy_projections_recursively_exclude_sensitive_keys() -> None:
    viewer = project_viewer_registration(
        application_id=UUID("30000000-0000-0000-0000-000000000041"),
        display_name="中场老范",
        position=OpenGameRegistrationPosition.MIDFIELDER,
        note=None,
        persisted_status=OpenGameRegistrationStatus.APPLIED,
        game_state=EffectiveOpenGameState.PUBLISHED,
        version=1,
        applied_at=NOW,
        decided_at=None,
        withdrawn_at=None,
        withdrawal_kind=None,
        late_exit_recorded=False,
        starts_at=NOW + timedelta(hours=2),
        now=NOW,
    )
    captain = project_captain_application(
        application_id=UUID("30000000-0000-0000-0000-000000000041"),
        display_name="中场老范",
        position=OpenGameRegistrationPosition.MIDFIELDER,
        note=None,
        applied_at=NOW,
        version=1,
        allowed_actions=_review_actions(),
    )
    sensitive = {
        "game_id",
        "applicant_user_id",
        "user_id",
        "phone",
        "openid",
        "avatar",
        "order_id",
        "payment",
        "fulfillment",
        "rating",
        "consent_version",
        "adult_confirmed_at",
        "risk_confirmed_at",
        "decided_by_user_id",
        "created_at",
        "updated_at",
    }
    for projection in (viewer, captain):
        assert _all_keys(projection.model_dump(mode="json")).isdisjoint(sensitive)


def test_response_models_are_closed_and_frozen() -> None:
    viewer = ViewerRegistration(
        id=UUID("30000000-0000-0000-0000-000000000041"),
        display_name="中场老范",
        position=OpenGameRegistrationPosition.MIDFIELDER,
        note=None,
        persisted_status=RegistrationPersistedStatus.APPLIED,
        effective_status=EffectiveRegistrationStatus.APPLIED,
        attendance_status=None,
        attendance_recorded_at=None,
        attendance_corrected_at=None,
        removed_at=None,
        version=1,
        applied_at=NOW,
        decided_at=None,
        withdrawn_at=None,
        withdrawal_kind=None,
        late_exit_recorded=False,
        available_withdrawal_action=None,
        late_exit_will_be_recorded=False,
        waitlist_position=None,
        waitlisted_at=None,
        promoted_at=None,
    )
    with pytest.raises(ValidationError):
        ViewerRegistration.model_validate({**viewer.model_dump(), "internal": True})
    with pytest.raises(ValidationError):
        viewer.note = "偷偷修改"


def test_queue_is_closed_frozen_and_keeps_the_wire_shape() -> None:
    application = project_captain_application(
        application_id=UUID("30000000-0000-0000-0000-000000000041"),
        display_name="中场老范",
        position=OpenGameRegistrationPosition.MIDFIELDER,
        note=None,
        applied_at=NOW,
        version=1,
        allowed_actions=_review_actions(),
    )
    queue = Queue(
        remaining_spots=3,
        pending_count=1,
        applications=[application],
        waitlist_count=0,
        waitlist=[],
    )
    assert queue.pending_count == 1
    with pytest.raises(ValidationError):
        Queue(remaining_spots=True, pending_count=1, applications=[])  # type: ignore[arg-type]
    with pytest.raises(ValidationError):
        Queue(remaining_spots=3, pending_count=-1, applications=[])
    with pytest.raises(ValidationError):
        Queue.model_validate({**queue.model_dump(), "private": "leak"})
    with pytest.raises(ValidationError):
        queue.pending_count = 2


def test_queue_applications_are_deeply_frozen_but_serialize_as_a_json_array() -> None:
    application = project_captain_application(
        application_id=UUID("30000000-0000-0000-0000-000000000041"),
        display_name="中场老范",
        position=OpenGameRegistrationPosition.MIDFIELDER,
        note=None,
        applied_at=NOW,
        version=1,
        allowed_actions=_review_actions(),
    )
    input_applications = [application]
    queue = Queue(
        remaining_spots=3,
        pending_count=1,
        applications=input_applications,
        waitlist_count=0,
        waitlist=[],
    )

    with pytest.raises(AttributeError):
        queue.applications.clear()

    assert isinstance(queue.applications, tuple)
    assert isinstance(queue.model_dump(mode="json")["applications"], list)
    assert isinstance(json.loads(queue.model_dump_json())["applications"], list)


def test_closed_enum_values_match_the_wire_contract() -> None:
    assert [status.value for status in OpenGameRegistrationStatus] == [
        "APPLIED",
        "WAITLISTED",
        "JOINED",
        "REJECTED",
        "WITHDRAWN",
        "REMOVED",
    ]
    assert [status.value for status in EffectiveRegistrationStatus] == [
        "APPLIED",
        "WAITLISTED",
        "JOINED",
        "REJECTED",
        "WITHDRAWN",
        "REMOVED",
        "CANCELLED",
    ]
    assert [reason.value for reason in ApplyBlockedReason] == [
        "AUTH_REQUIRED",
        "OWNER_CANNOT_APPLY",
        "ALREADY_APPLIED",
        "GAME_NOT_PUBLISHED",
        "REGISTRATION_DEADLINE_PASSED",
        "GAME_SUSPENDED",
        "GAME_CANCELLED",
        "GAME_COMPLETED",
        "GAME_STARTED",
    ]
    assert [reason.value for reason in ReviewBlockedReason] == [
        "APPLICATION_NOT_PENDING",
        "GAME_SUSPENDED",
        "GAME_CANCELLED",
        "GAME_COMPLETED",
        "GAME_STARTED",
        "GAME_FULL",
    ]
    assert [reason.value for reason in WaitlistBlockedReason] == [
        "APPLICATION_NOT_PENDING",
        "GAME_SUSPENDED",
        "GAME_CANCELLED",
        "GAME_COMPLETED",
        "GAME_STARTED",
        "GAME_NOT_FULL",
        "WAITLIST_NOT_ENABLED",
    ]
    assert [status.value for status in RegistrationPersistedStatus] == [
        "APPLIED",
        "WAITLISTED",
        "JOINED",
        "REJECTED",
        "WITHDRAWN",
        "REMOVED",
    ]
    assert [kind.value for kind in RegistrationWithdrawalKind] == [
        "APPLICATION_WITHDRAWAL",
        "WAITLIST_WITHDRAWAL",
        "GAME_EXIT",
    ]
    assert [decision.value for decision in ApplicationDecision] == [
        "ACCEPT",
        "REJECT",
        "WAITLIST",
    ]
    assert [status.value for status in DecisionResultStatus] == [
        "WAITLISTED",
        "JOINED",
        "REJECTED",
    ]


def test_models_do_not_accidentally_serialize_any_unexpected_nested_key() -> None:
    result = DecisionResult(
        application_id=UUID("30000000-0000-0000-0000-000000000041"),
        status=DecisionResultStatus.REJECTED,
        version=2,
        decided_at=None,
        remaining_spots=3,
        allowed_actions=ReviewActions(
            can_accept=False,
            accept_blocked_reason=ReviewBlockedReason.APPLICATION_NOT_PENDING,
            can_waitlist=False,
            waitlist_blocked_reason=WaitlistBlockedReason.APPLICATION_NOT_PENDING,
            can_reject=False,
            reject_blocked_reason=ReviewBlockedReason.APPLICATION_NOT_PENDING,
        ),
    )
    expected: dict[str, Any] = {
        "application_id": UUID("30000000-0000-0000-0000-000000000041"),
        "status": DecisionResultStatus.REJECTED,
        "version": 2,
        "decided_at": None,
        "remaining_spots": 3,
        "allowed_actions": {
            "can_accept": False,
            "accept_blocked_reason": ReviewBlockedReason.APPLICATION_NOT_PENDING,
            "can_waitlist": False,
            "waitlist_blocked_reason": (WaitlistBlockedReason.APPLICATION_NOT_PENDING),
            "can_reject": False,
            "reject_blocked_reason": ReviewBlockedReason.APPLICATION_NOT_PENDING,
        },
    }
    assert result.model_dump() == expected
