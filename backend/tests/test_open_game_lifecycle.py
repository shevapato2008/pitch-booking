from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from backend.app.models import (
    ImageRole,
    OpenGameIntensity,
    OpenGameStatus,
    OpenGameVisibility,
    OrderStatus,
    RefundCasePurpose,
    VenueImage,
)
from backend.app.modules.open_games.dto import (
    OpenGameDraftInput,
    OpenGamePosition,
    OpenGameValidationError,
    mask_to_positions,
    normalize_team_name_key,
    positions_to_mask,
    validate_draft_write,
    validate_published_update,
)
from backend.app.modules.open_games.lifecycle import (
    EffectiveOpenGameState,
    OpenGameFacts,
    OpenGameStateReason,
    project_open_game_actions,
    project_open_game_reason,
    project_open_game_state,
)
from backend.app.modules.open_games.privacy import (
    PUBLIC_OPEN_GAME_FIELDS,
    project_open_game_public,
    select_share_cover_url,
    validate_public_free_text,
)
from backend.app.modules.orders import lifecycle as order_lifecycle
from backend.app.modules.orders.lifecycle import OrderLifecycleFacts

NOW = datetime(2026, 8, 23, 4, tzinfo=UTC)
STARTS_AT = NOW + timedelta(days=3)


def _order_facts(
    *,
    status: OrderStatus = OrderStatus.CONFIRMED,
    starts_at: datetime = STARTS_AT,
    cancel_requested_at: datetime | None = None,
    controlling_refund_purpose: RefundCasePurpose | None = None,
) -> OrderLifecycleFacts:
    return OrderLifecycleFacts(
        status=status,
        starts_at=starts_at,
        ends_at=starts_at + timedelta(hours=2),
        cancel_requested_at=cancel_requested_at,
        checked_in_at=None,
        payment_may_exist=False,
        controlling_refund_purpose=controlling_refund_purpose,
    )


def _game_facts(
    *,
    stored_status: OpenGameStatus = OpenGameStatus.DRAFT,
    order_facts: OrderLifecycleFacts | None = None,
    registration_deadline: datetime = STARTS_AT - timedelta(hours=3),
) -> OpenGameFacts:
    return OpenGameFacts(
        stored_status=stored_status,
        order_facts=order_facts or _order_facts(),
        registration_deadline=registration_deadline,
    )


@pytest.mark.parametrize(
    ("facts", "expected"),
    [
        (
            _game_facts(
                stored_status=OpenGameStatus.CANCELLED,
                order_facts=_order_facts(status=OrderStatus.COMPLETED),
            ),
            EffectiveOpenGameState.CANCELLED,
        ),
        (
            _game_facts(order_facts=_order_facts(status=OrderStatus.CANCELLED)),
            EffectiveOpenGameState.CANCELLED,
        ),
        (
            _game_facts(order_facts=_order_facts(status=OrderStatus.REFUNDED)),
            EffectiveOpenGameState.CANCELLED,
        ),
        (
            _game_facts(order_facts=_order_facts(status=OrderStatus.COMPLETED)),
            EffectiveOpenGameState.COMPLETED,
        ),
        (
            _game_facts(
                order_facts=_order_facts(cancel_requested_at=NOW - timedelta(minutes=1))
            ),
            EffectiveOpenGameState.SUSPENDED,
        ),
        (
            _game_facts(order_facts=_order_facts(status=OrderStatus.PAYMENT_EXCEPTION)),
            EffectiveOpenGameState.SUSPENDED,
        ),
        (
            _game_facts(order_facts=_order_facts(status=OrderStatus.REFUND_PENDING)),
            EffectiveOpenGameState.SUSPENDED,
        ),
        (
            _game_facts(order_facts=_order_facts(status=OrderStatus.REFUND_FAILED)),
            EffectiveOpenGameState.SUSPENDED,
        ),
        (_game_facts(), EffectiveOpenGameState.DRAFT),
        (
            _game_facts(stored_status=OpenGameStatus.PUBLISHED),
            EffectiveOpenGameState.PUBLISHED,
        ),
    ],
)
def test_effective_state_uses_server_owned_order_facts(
    facts: OpenGameFacts, expected: EffectiveOpenGameState
) -> None:
    assert project_open_game_state(facts) is expected


@pytest.mark.parametrize(
    ("facts", "expected"),
    [
        (
            _game_facts(stored_status=OpenGameStatus.CANCELLED),
            OpenGameStateReason.CAPTAIN_CANCELLED,
        ),
        (
            _game_facts(order_facts=_order_facts(status=OrderStatus.CANCELLED)),
            OpenGameStateReason.ORDER_CANCELLED,
        ),
        (
            _game_facts(order_facts=_order_facts(status=OrderStatus.REFUNDED)),
            OpenGameStateReason.ORDER_REFUNDED,
        ),
        (
            _game_facts(order_facts=_order_facts(status=OrderStatus.COMPLETED)),
            OpenGameStateReason.ORDER_COMPLETED,
        ),
        (
            _game_facts(order_facts=_order_facts(status=OrderStatus.PAYMENT_EXCEPTION)),
            OpenGameStateReason.ORDER_PAYMENT_EXCEPTION,
        ),
        (
            _game_facts(order_facts=_order_facts(status=OrderStatus.REFUND_PENDING)),
            OpenGameStateReason.ORDER_REFUND_PENDING,
        ),
        (
            _game_facts(order_facts=_order_facts(status=OrderStatus.REFUND_FAILED)),
            OpenGameStateReason.ORDER_REFUND_FAILED,
        ),
        (
            _game_facts(order_facts=_order_facts(cancel_requested_at=NOW)),
            OpenGameStateReason.ORDER_CANCELLATION_PENDING,
        ),
        (
            _game_facts(registration_deadline=NOW),
            OpenGameStateReason.REGISTRATION_DEADLINE_PASSED,
        ),
        (
            _game_facts(
                order_facts=_order_facts(starts_at=NOW + timedelta(hours=2)),
                registration_deadline=NOW + timedelta(hours=1),
            ),
            OpenGameStateReason.REGISTRATION_WINDOW_CLOSED,
        ),
        (_game_facts(), None),
    ],
)
def test_reason_explains_the_effective_state(
    facts: OpenGameFacts, expected: OpenGameStateReason | None
) -> None:
    assert project_open_game_reason(facts, now=NOW) is expected


def test_draft_actions_follow_eligibility_and_selected_deadline() -> None:
    eligible = project_open_game_actions(_game_facts(), now=NOW)
    assert eligible.model_dump() == {
        "can_edit": True,
        "can_publish": True,
        "can_share": False,
        "can_cancel": True,
        "can_preview": True,
    }

    deadline_elapsed = project_open_game_actions(
        _game_facts(registration_deadline=NOW), now=NOW
    )
    assert deadline_elapsed.model_dump() == {
        "can_edit": True,
        "can_publish": False,
        "can_share": False,
        "can_cancel": True,
        "can_preview": True,
    }

    window_closed = project_open_game_actions(
        _game_facts(
            order_facts=_order_facts(starts_at=NOW + timedelta(hours=2)),
            registration_deadline=NOW + timedelta(hours=1),
        ),
        now=NOW,
    )
    assert window_closed.model_dump() == {
        "can_edit": False,
        "can_publish": False,
        "can_share": False,
        "can_cancel": True,
        "can_preview": True,
    }


@pytest.mark.parametrize(
    ("facts", "expected"),
    [
        (
            _game_facts(
                stored_status=OpenGameStatus.PUBLISHED,
                registration_deadline=NOW - timedelta(days=1),
            ),
            (True, False, True, True, True),
        ),
        (
            _game_facts(order_facts=_order_facts(status=OrderStatus.REFUND_PENDING)),
            (False, False, False, True, True),
        ),
        (
            _game_facts(stored_status=OpenGameStatus.CANCELLED),
            (False, False, False, False, False),
        ),
        (
            _game_facts(order_facts=_order_facts(status=OrderStatus.COMPLETED)),
            (False, False, False, False, True),
        ),
    ],
)
def test_non_draft_action_matrix(
    facts: OpenGameFacts, expected: tuple[bool, bool, bool, bool, bool]
) -> None:
    actions = project_open_game_actions(facts, now=NOW)
    assert (
        actions.can_edit,
        actions.can_publish,
        actions.can_share,
        actions.can_cancel,
        actions.can_preview,
    ) == expected


@pytest.mark.parametrize(
    "order_facts",
    [
        _order_facts(status=OrderStatus.PENDING_PAYMENT),
        _order_facts(
            controlling_refund_purpose=RefundCasePurpose.PAYMENT_INVENTORY_CONFLICT
        ),
    ],
)
def test_theoretically_inconsistent_published_authority_fails_closed(
    order_facts: OrderLifecycleFacts,
) -> None:
    actions = project_open_game_actions(
        _game_facts(
            stored_status=OpenGameStatus.PUBLISHED,
            order_facts=order_facts,
        ),
        now=NOW,
    )
    assert actions.model_dump() == {
        "can_edit": False,
        "can_publish": False,
        "can_share": False,
        "can_cancel": True,
        "can_preview": True,
    }


def test_draft_write_delegates_order_eligibility_to_b1_policy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    called: list[tuple[OrderLifecycleFacts, datetime]] = []

    def fake_eligibility(facts: OrderLifecycleFacts, *, now: datetime) -> bool:
        called.append((facts, now))
        return True

    monkeypatch.setattr(order_lifecycle, "is_b2_open_game_eligible", fake_eligibility)
    facts = _order_facts()
    validate_draft_write(
        facts,
        registration_deadline=STARTS_AT - timedelta(hours=2),
        now=NOW,
    )
    assert called == [(facts, NOW)]


def test_draft_write_enforces_strict_deadline_window() -> None:
    facts = _order_facts()
    validate_draft_write(
        facts,
        registration_deadline=STARTS_AT - timedelta(hours=2),
        now=NOW,
    )
    for deadline in (NOW, STARTS_AT - timedelta(hours=2) + timedelta(microseconds=1)):
        with pytest.raises(OpenGameValidationError) as exc_info:
            validate_draft_write(facts, registration_deadline=deadline, now=NOW)
        assert [field.field for field in exc_info.value.fields] == [
            "registration_deadline"
        ]


def test_published_update_retains_unchanged_elapsed_deadline_only() -> None:
    current = NOW - timedelta(hours=1)
    validate_published_update(
        _order_facts(starts_at=NOW + timedelta(hours=1)),
        previous_registration_deadline=current,
        registration_deadline=current.astimezone(UTC),
        now=NOW,
    )
    with pytest.raises(OpenGameValidationError):
        validate_published_update(
            _order_facts(starts_at=NOW + timedelta(hours=1)),
            previous_registration_deadline=current,
            registration_deadline=current + timedelta(minutes=1),
            now=NOW,
        )


@pytest.mark.parametrize(
    ("purpose", "accepted"),
    [
        (None, True),
        (RefundCasePurpose.DUPLICATE_CHARGE, True),
        (RefundCasePurpose.ORDER_CANCELLATION, False),
        (RefundCasePurpose.PAYMENT_INVENTORY_CONFLICT, False),
    ],
)
def test_published_update_requires_a_healthy_confirmed_order(
    purpose: RefundCasePurpose | None, accepted: bool
) -> None:
    facts = _order_facts(controlling_refund_purpose=purpose)
    if accepted:
        validate_published_update(
            facts,
            previous_registration_deadline=STARTS_AT - timedelta(hours=3),
            registration_deadline=STARTS_AT - timedelta(hours=3),
            now=NOW,
        )
    else:
        with pytest.raises(OpenGameValidationError):
            validate_published_update(
                facts,
                previous_registration_deadline=STARTS_AT - timedelta(hours=3),
                registration_deadline=STARTS_AT - timedelta(hours=3),
                now=NOW,
            )


def _draft_payload() -> dict[str, object]:
    return {
        "name": "周末友谊赛",
        "team_name": "海风联队",
        "total_players": 14,
        "fixed_players": 8,
        "open_spots": 5,
        "intensity": OpenGameIntensity.CASUAL,
        "minimum_experience": "有基础传接球经验",
        "positions": ["FORWARD", "GOALKEEPER", "DEFENDER"],
        "aa_cents": 12000,
        "registration_deadline": STARTS_AT - timedelta(hours=3),
        "equipment_and_arrival_notes": "请提前二十分钟到场",
        "visibility": OpenGameVisibility.LINK_ONLY,
    }


def test_draft_input_is_closed_and_canonicalizes_positions() -> None:
    draft = OpenGameDraftInput.model_validate(_draft_payload())
    assert draft.positions == [
        OpenGamePosition.GOALKEEPER,
        OpenGamePosition.DEFENDER,
        OpenGamePosition.FORWARD,
    ]
    with pytest.raises(ValidationError):
        OpenGameDraftInput.model_validate({**_draft_payload(), "private_note": "no"})


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("name", "a"),
        ("name", " 比赛"),
        ("team_name", "队 "),
        ("total_players", 31),
        ("fixed_players", 0),
        ("open_spots", 30),
        ("minimum_experience", ""),
        ("minimum_experience", "x" * 61),
        ("equipment_and_arrival_notes", " notes"),
        ("equipment_and_arrival_notes", "x" * 201),
        ("aa_cents", -1),
        ("registration_deadline", datetime(2026, 8, 24, 8)),
    ],
)
def test_draft_input_rejects_bounds_untrimmed_text_and_naive_time(
    field: str, value: object
) -> None:
    with pytest.raises(ValidationError):
        OpenGameDraftInput.model_validate({**_draft_payload(), field: value})


def test_draft_input_rejects_roster_over_capacity() -> None:
    with pytest.raises(ValidationError):
        OpenGameDraftInput.model_validate(
            {**_draft_payload(), "total_players": 12, "fixed_players": 8, "open_spots": 5}
        )


@pytest.mark.parametrize(
    "positions",
    [[], ["ANY", "FORWARD"], ["FORWARD", "FORWARD"], ["STRIKER"]],
)
def test_position_selection_is_nonempty_unique_and_any_is_exclusive(
    positions: list[str],
) -> None:
    with pytest.raises(ValidationError):
        OpenGameDraftInput.model_validate({**_draft_payload(), "positions": positions})


def test_position_masks_round_trip_in_canonical_order() -> None:
    assert positions_to_mask([OpenGamePosition.ANY]) == 0
    assert positions_to_mask(
        [OpenGamePosition.FORWARD, OpenGamePosition.GOALKEEPER]
    ) == 9
    assert mask_to_positions(0) == [OpenGamePosition.ANY]
    assert mask_to_positions(15) == [
        OpenGamePosition.GOALKEEPER,
        OpenGamePosition.DEFENDER,
        OpenGamePosition.MIDFIELDER,
        OpenGamePosition.FORWARD,
    ]
    for invalid_mask in (-1, 16):
        with pytest.raises(ValueError):
            mask_to_positions(invalid_mask)


def test_team_key_uses_nfkc_collapsed_whitespace_and_casefold() -> None:
    assert normalize_team_name_key("  ＡＣＭＥ\u3000 United  ") == "acme united"


@pytest.mark.parametrize(
    "text",
    [
        "联系 13800138000",
        "电话 138-0013-8000",
        "详情 https://example.com/game",
        "加微信：captain123",
        "WeChat ID: captain123",
        "联系 wx: captain123",
        "加我 vx captain123",
    ],
)
def test_public_free_text_rejects_obvious_contact_channels(text: str) -> None:
    with pytest.raises(ValueError):
        validate_public_free_text(text)


def test_public_free_text_does_not_turn_into_generic_moderation() -> None:
    assert validate_public_free_text("本场支持微信支付，欢迎新手") == "本场支持微信支付，欢迎新手"


def test_public_projector_is_an_exact_whitelist_with_coarse_reason() -> None:
    public = project_open_game_public(
        name="周末友谊赛",
        team_name="海风联队",
        state=EffectiveOpenGameState.SUSPENDED,
        state_reason=OpenGameStateReason.ORDER_REFUND_PENDING,
        venue_name="浦东星火足球公园",
        pitch_name="A1 场",
        players_per_side=7,
        starts_at=STARTS_AT,
        ends_at=STARTS_AT + timedelta(hours=2),
        time_zone="Asia/Shanghai",
        total_players=14,
        fixed_players=8,
        open_spots=5,
        intensity=OpenGameIntensity.CASUAL,
        minimum_experience="有基础传接球经验",
        positions=[OpenGamePosition.FORWARD, OpenGamePosition.GOALKEEPER],
        aa_cents=12000,
        registration_deadline=STARTS_AT - timedelta(hours=3),
        equipment_and_arrival_notes="请提前二十分钟到场",
        visibility=OpenGameVisibility.LINK_ONLY,
    )
    body = public.model_dump(mode="json")
    assert set(body) == PUBLIC_OPEN_GAME_FIELDS
    assert body["state_reason"] == "BOOKING_UNAVAILABLE"
    assert body["pitch_specification"] == "7人制"
    assert body["positions"] == ["GOALKEEPER", "FORWARD"]
    assert body["aa_cents"] == 12000
    for private in (
        "id",
        "order_id",
        "share_token",
        "booking_price_cents",
        "captain_user_id",
        "expected_version",
    ):
        assert private not in body


def test_public_projector_revalidates_free_text_at_the_privacy_boundary() -> None:
    with pytest.raises(ValidationError):
        project_open_game_public(
            name="加微信：captain123",
            team_name="海风联队",
            state=EffectiveOpenGameState.PUBLISHED,
            state_reason=None,
            venue_name="浦东星火足球公园",
            pitch_name="A1 场",
            players_per_side=7,
            starts_at=STARTS_AT,
            ends_at=STARTS_AT + timedelta(hours=2),
            time_zone="Asia/Shanghai",
            total_players=14,
            fixed_players=8,
            open_spots=5,
            intensity=OpenGameIntensity.CASUAL,
            minimum_experience=None,
            positions=[OpenGamePosition.ANY],
            aa_cents=0,
            registration_deadline=STARTS_AT - timedelta(hours=3),
            equipment_and_arrival_notes=None,
            visibility=OpenGameVisibility.PUBLIC,
        )


def test_share_cover_uses_only_published_https_cover_authority() -> None:
    gallery = VenueImage(
        url="https://img.example/gallery.jpg",
        alt="场地",
        role=ImageRole.GALLERY,
        sort_order=0,
    )
    insecure_cover = VenueImage(
        url="http://img.example/cover.jpg",
        alt="封面",
        role=ImageRole.COVER,
        sort_order=0,
    )
    cover = VenueImage(
        url="https://img.example/cover.jpg",
        alt="封面",
        role=ImageRole.COVER,
        sort_order=0,
    )
    draft_like = SimpleNamespace(
        url="https://img.example/draft.jpg", role=ImageRole.COVER
    )
    assert select_share_cover_url([gallery, insecure_cover]) is None
    assert select_share_cover_url([draft_like, gallery, cover]) == cover.url  # type: ignore[list-item]
