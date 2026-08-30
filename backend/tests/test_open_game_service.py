import hashlib
import json
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import pytest
from pydantic import ValidationError
from sqlalchemy import Engine, func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from backend.app.errors import AppError
from backend.app.models import (
    IdempotencyRecord,
    OpenGame,
    OpenGameIntensity,
    OpenGameRegistration,
    OpenGameRegistrationPosition,
    OpenGameRegistrationStatus,
    OpenGameStatus,
    OpenGameVisibility,
    Order,
    OrderStatus,
    Payment,
    PaymentState,
    RefundAttempt,
    RefundAttemptStatus,
    RefundCase,
    RefundCasePurpose,
    RefundReason,
    Slot,
    SlotStatus,
    Team,
    User,
)
from backend.app.modules.open_games.dto import (
    CreateOpenGameRequest,
    OpenGamePosition,
    UpdateOpenGameRequest,
)
from backend.app.modules.open_games.repository import OpenGameRepository
from backend.app.modules.open_games.service import (
    CREATE_OPEN_GAME_OPERATION,
    OpenGameService,
    project_authoritative_public_game,
)
from backend.app.modules.orders.repository import OrderRepository
from backend.tests.test_schema_constraints import add_pitch, add_slot, venue

pytestmark = pytest.mark.integration

NOW = datetime(2026, 8, 23, 8, tzinfo=UTC)
CREATE_KEY = "create-open-game-key-00000001"
UPDATE_KEY = "update-open-game-key-00000001"


@dataclass(frozen=True, slots=True)
class SeededOpenGameCase:
    owner_id: uuid.UUID
    stranger_id: uuid.UUID
    order_id: uuid.UUID
    slot_id: uuid.UUID
    payment_id: uuid.UUID
    starts_at: datetime
    ends_at: datetime


def seed_confirmed_order(
    engine: Engine,
    *,
    owner_id: uuid.UUID | None = None,
    starts_at: datetime | None = None,
    cancel_requested: bool = False,
    refund_purpose: RefundCasePurpose | None = None,
) -> SeededOpenGameCase:
    with Session(engine) as session:
        owner = session.get(User, owner_id) if owner_id is not None else None
        if owner is None:
            owner = User(
                id=owner_id or uuid.uuid4(),
                wechat_app_id="wx-open-game-test",
                wechat_openid=f"open-game-owner-{uuid.uuid4()}",
            )
            session.add(owner)
        stranger = User(
            wechat_app_id="wx-open-game-test",
            wechat_openid=f"open-game-stranger-{uuid.uuid4()}",
        )
        parent = venue(timezone="Asia/Shanghai")
        pitch = add_pitch(session, parent)
        pitch.name = "五人制 A 场"
        pitch.players_per_side = 5
        session.add(stranger)
        session.flush()
        start = starts_at or NOW + timedelta(days=3)
        slot = add_slot(
            session,
            pitch,
            start,
            start + timedelta(hours=2),
            status=SlotStatus.BOOKED,
            price_cents=36000,
            checkout_version=9,
        )
        order = Order(
            id=uuid.uuid4(),
            order_number=f"PB-{uuid.uuid4().hex}",
            user=owner,
            slot=slot,
            status=OrderStatus.CONFIRMED,
            price_cents=36000,
            contact_name="队长",
            contact_phone_ciphertext=b"encrypted-phone-value",
            contact_phone_nonce=b"abcdefghijkl",
            contact_phone_key_version=1,
            created_at=NOW - timedelta(days=1),
            expires_at=NOW - timedelta(days=1) + timedelta(minutes=10),
            cancel_requested_at=NOW if cancel_requested else None,
        )
        payment = Payment(
            id=uuid.uuid4(),
            order=order,
            provider="wechatpay-test",
            merchant_order_no=f"M{uuid.uuid4().hex}",
            provider_transaction_no=f"T{uuid.uuid4().hex}",
            amount_cents=36000,
            currency="CNY",
            status=PaymentState.SUCCESS,
            paid_at=NOW - timedelta(days=1),
            applied_to_order_at=NOW - timedelta(days=1),
        )
        session.add_all((order, payment))
        session.flush()
        if refund_purpose is not None:
            refund_case = RefundCase(
                id=uuid.uuid4(),
                order=order,
                payment=payment,
                purpose=refund_purpose,
                reason=(
                    RefundReason.USER_CANCELLED
                    if refund_purpose is RefundCasePurpose.ORDER_CANCELLATION
                    else RefundReason.AUTOMATIC_RECOVERY
                ),
                reason_note=None,
                requested_by_user_id=(
                    owner.id
                    if refund_purpose is RefundCasePurpose.ORDER_CANCELLATION
                    else None
                ),
                amount_cents=36000,
                currency="CNY",
                created_at=NOW,
            )
            session.add(refund_case)
            session.flush()
            session.add(
                RefundAttempt(
                    refund_case=refund_case,
                    provider="wechatpay-test",
                    merchant_refund_no=uuid.uuid4().hex,
                    status=RefundAttemptStatus.PROCESSING,
                    attempt_no=1,
                )
            )
        session.commit()
        return SeededOpenGameCase(
            owner_id=owner.id,
            stranger_id=stranger.id,
            order_id=order.id,
            slot_id=slot.id,
            payment_id=payment.id,
            starts_at=slot.starts_at,
            ends_at=slot.ends_at,
        )


def draft_request(
    seeded: SeededOpenGameCase,
    *,
    name: str = "周末五人制约球",
    team_name: str = "海风联队",
    registration_deadline: datetime | None = None,
) -> CreateOpenGameRequest:
    return CreateOpenGameRequest(
        name=name,
        team_name=team_name,
        total_players=10,
        fixed_players=6,
        open_spots=4,
        intensity=OpenGameIntensity.CASUAL,
        minimum_experience="会基础传接球",
        positions=[OpenGamePosition.GOALKEEPER, OpenGamePosition.FORWARD],
        aa_cents=3600,
        registration_deadline=(
            registration_deadline
            if registration_deadline is not None
            else seeded.starts_at - timedelta(hours=3)
        ),
        equipment_and_arrival_notes="请提前二十分钟到场",
        visibility=OpenGameVisibility.LINK_ONLY,
    )


def service(
    session: Session,
    *,
    now: datetime = NOW,
    tokens: list[str] | None = None,
) -> OpenGameService:
    values = iter(tokens or [])
    token_factory = (lambda: next(values)) if tokens is not None else None
    return OpenGameService(
        repository=OpenGameRepository(session),
        order_repository=OrderRepository(session),
        now=lambda: now,
        token_factory=token_factory,
    )


def add_stored_game(
    session: Session,
    *,
    seeded: SeededOpenGameCase,
    status: OpenGameStatus,
    share_token: str | None = None,
    team_name: str = "历史联队",
) -> OpenGame:
    team = Team(
        captain_user_id=seeded.owner_id,
        name=team_name,
        name_key=team_name.casefold(),
    )
    game = OpenGame(
        order_id=seeded.order_id,
        team=team,
        name="历史球局",
        total_players=10,
        fixed_players=6,
        open_spots=4,
        intensity=OpenGameIntensity.CASUAL,
        minimum_experience=None,
        position_mask=0,
        aa_cents=3600,
        registration_deadline=seeded.starts_at - timedelta(hours=3),
        equipment_and_arrival_notes=None,
        visibility=OpenGameVisibility.LINK_ONLY,
        status=status,
        version=1,
        share_token=share_token or uuid.uuid4().hex,
        published_at=NOW if status is OpenGameStatus.PUBLISHED else None,
        cancelled_at=NOW if status is OpenGameStatus.CANCELLED else None,
    )
    session.add(game)
    session.flush()
    return game


def add_joined_registration(
    session: Session,
    *,
    game_id: uuid.UUID,
    owner_id: uuid.UUID,
    label: str,
) -> OpenGameRegistration:
    applicant = User(
        wechat_app_id="wx-open-game-joined-test",
        wechat_openid=f"open-game-joined-{label}-{uuid.uuid4()}",
    )
    session.add(applicant)
    session.flush()
    registration = OpenGameRegistration(
        game_id=game_id,
        applicant_user_id=applicant.id,
        display_name=f"加入球员{label}",
        position=OpenGameRegistrationPosition.ANY,
        note=None,
        status=OpenGameRegistrationStatus.JOINED,
        version=2,
        consent_version="c1a-2026-08-24",
        adult_confirmed_at=NOW,
        risk_confirmed_at=NOW,
        applied_at=NOW,
        decided_at=NOW,
        decided_by_user_id=owner_id,
    )
    session.add(registration)
    session.flush()
    return registration


def add_waitlisted_registration(
    session: Session,
    *,
    game_id: uuid.UUID,
    owner_id: uuid.UUID,
) -> OpenGameRegistration:
    applicant = User(
        wechat_app_id="wx-open-game-waitlist-test",
        wechat_openid=f"open-game-waitlist-{uuid.uuid4()}",
    )
    session.add(applicant)
    session.flush()
    registration = OpenGameRegistration(
        game_id=game_id,
        applicant_user_id=applicant.id,
        display_name="候补球员",
        position=OpenGameRegistrationPosition.ANY,
        note=None,
        status=OpenGameRegistrationStatus.WAITLISTED,
        version=2,
        consent_version="c1a-2026-08-24",
        adult_confirmed_at=NOW,
        risk_confirmed_at=NOW,
        applied_at=NOW,
        decided_at=NOW,
        decided_by_user_id=owner_id,
        waitlist_seq=1,
        waitlisted_at=NOW,
    )
    session.add(registration)
    session.flush()
    return registration


def test_shared_authority_projection_preserves_public_response(pg_engine: Engine) -> None:
    seeded = seed_confirmed_order(pg_engine)
    with Session(pg_engine) as session:
        game = add_stored_game(
            session,
            seeded=seeded,
            status=OpenGameStatus.PUBLISHED,
            share_token="P" * 32,
        )
        session.commit()
        repository = OpenGameRepository(session)
        authority = repository.get_order_authority(order_id=seeded.order_id)
        order_row = repository.get_order_row(order_id=seeded.order_id)
        team = repository.get_team(team_id=game.team_id)
        assert order_row is not None
        assert team is not None
        projection = project_authoritative_public_game(
            game=game,
            order=game.order,
            authority=authority,
            order_row=order_row,
            team=team,
            now=NOW,
        )
        public = service(session).get_public(share_token=game.share_token)

    assert projection.public == public
    assert projection.starts_at == seeded.starts_at
    assert projection.owner_user_id == seeded.owner_id
    assert projection.public.model_dump() == {
        "name": "历史球局",
        "team_name": "历史联队",
        "state": OpenGameStatus.PUBLISHED,
        "state_reason": None,
        "venue_name": "浦东星跃足球公园",
        "pitch_name": "五人制 A 场",
        "pitch_specification": "5人制",
        "starts_at": seeded.starts_at,
        "ends_at": seeded.ends_at,
        "time_zone": "Asia/Shanghai",
        "total_players": 10,
        "fixed_players": 6,
        "open_spots": 4,
        "intensity": OpenGameIntensity.CASUAL,
        "minimum_experience": None,
        "positions": [OpenGamePosition.ANY],
        "aa_cents": 3600,
        "registration_deadline": seeded.starts_at - timedelta(hours=3),
        "equipment_and_arrival_notes": None,
        "visibility": OpenGameVisibility.LINK_ONLY,
    }


def test_entry_precedence_is_active_then_eligible_then_none(pg_engine: Engine) -> None:
    seeded = seed_confirmed_order(pg_engine)
    with Session(pg_engine) as session:
        created = service(session).get_entry(
            user_id=seeded.owner_id,
            order_id=seeded.order_id,
        )
        assert created.entry == "CREATE"
        assert created.order is not None
        assert created.order.pitch_specification == "5人制"
        assert created.order.booking_price_cents == 36000

        add_stored_game(session, seeded=seeded, status=OpenGameStatus.CANCELLED)
        session.commit()
        historical_cancelled = service(session).get_entry(
            user_id=seeded.owner_id,
            order_id=seeded.order_id,
        )
        assert historical_cancelled.entry == "CREATE"

        active = add_stored_game(
            session,
            seeded=seeded,
            status=OpenGameStatus.DRAFT,
            team_name="当前联队",
        )
        order = session.get_one(Order, seeded.order_id)
        order.status = OrderStatus.REFUNDED
        order.cancel_requested_at = NOW
        order.cancelled_at = NOW
        session.commit()
        projected_terminal = service(session).get_entry(
            user_id=seeded.owner_id,
            order_id=seeded.order_id,
        )
        assert projected_terminal.entry == "MANAGE"
        assert projected_terminal.game_id == active.id

    boundary = seed_confirmed_order(pg_engine, starts_at=NOW + timedelta(hours=2))
    with Session(pg_engine) as session:
        blocked = service(session).get_entry(
            user_id=boundary.owner_id,
            order_id=boundary.order_id,
        )
    assert blocked.entry == "NONE"
    assert blocked.blocked_reason == "ORDER_NOT_ELIGIBLE"


def test_owner_and_nonowner_not_found_are_symmetric(pg_engine: Engine) -> None:
    seeded = seed_confirmed_order(pg_engine)
    with Session(pg_engine) as session:
        with pytest.raises(AppError) as foreign_entry:
            service(session).get_entry(
                user_id=seeded.stranger_id,
                order_id=seeded.order_id,
            )
        assert (foreign_entry.value.status_code, foreign_entry.value.code) == (
            404,
            "ORDER_NOT_FOUND",
        )

        with pytest.raises(AppError) as foreign_create:
            service(session).create_draft(
                user_id=seeded.stranger_id,
                order_id=seeded.order_id,
                idempotency_key="foreign-create-key-00000001",
                request=draft_request(seeded),
            )
        with pytest.raises(AppError) as missing_create:
            service(session).create_draft(
                user_id=seeded.owner_id,
                order_id=uuid.uuid4(),
                idempotency_key="missing-create-key-00000001",
                request=draft_request(seeded),
            )
        assert (foreign_create.value.status_code, foreign_create.value.code) == (
            missing_create.value.status_code,
            missing_create.value.code,
        ) == (404, "ORDER_NOT_FOUND")

        owner = service(session).create_draft(
            user_id=seeded.owner_id,
            order_id=seeded.order_id,
            idempotency_key=CREATE_KEY,
            request=draft_request(seeded),
        )
        with pytest.raises(AppError) as foreign_read:
            service(session).get_owner(
                user_id=seeded.stranger_id,
                game_id=owner.id,
            )
        with pytest.raises(AppError) as missing_read:
            service(session).get_owner(
                user_id=seeded.owner_id,
                game_id=uuid.uuid4(),
            )
        with pytest.raises(AppError) as foreign_update:
            service(session).update(
                user_id=seeded.stranger_id,
                game_id=owner.id,
                idempotency_key="foreign-update-key-00000001",
                request=UpdateOpenGameRequest(
                    **draft_request(seeded, team_name="非队长改名").model_dump(),
                    expected_version=owner.version,
                ),
            )
        with pytest.raises(AppError) as missing_update:
            service(session).update(
                user_id=seeded.owner_id,
                game_id=uuid.uuid4(),
                idempotency_key="missing-update-key-00000001",
                request=UpdateOpenGameRequest(
                    **draft_request(seeded, team_name="不存在的球局").model_dump(),
                    expected_version=owner.version,
                ),
            )
    assert (foreign_read.value.status_code, foreign_read.value.code) == (
        missing_read.value.status_code,
        missing_read.value.code,
    ) == (404, "OPEN_GAME_NOT_FOUND")
    assert (foreign_update.value.status_code, foreign_update.value.code) == (
        missing_update.value.status_code,
        missing_update.value.code,
    ) == (404, "OPEN_GAME_NOT_FOUND")


def test_create_is_canonical_idempotent_and_does_not_mutate_b1_rows(
    pg_engine: Engine,
) -> None:
    seeded = seed_confirmed_order(
        pg_engine,
        refund_purpose=RefundCasePurpose.DUPLICATE_CHARGE,
    )
    request = draft_request(seeded)
    with Session(pg_engine) as session:
        order_before = session.get_one(Order, seeded.order_id)
        slot_before = session.get_one(Slot, seeded.slot_id)
        payment_before = session.get_one(Payment, seeded.payment_id)
        refund_case_before = session.scalar(
            select(RefundCase).where(RefundCase.order_id == seeded.order_id)
        )
        assert refund_case_before is not None
        refund_attempt_before = session.scalar(
            select(RefundAttempt).where(
                RefundAttempt.refund_case_id == refund_case_before.id
            )
        )
        assert refund_attempt_before is not None
        b1_snapshot = (
            order_before.status,
            order_before.cancel_requested_at,
            slot_before.status,
            slot_before.checkout_version,
            payment_before.status,
            payment_before.applied_to_order_at,
            refund_case_before.purpose,
            refund_case_before.reason,
            refund_case_before.amount_cents,
            refund_attempt_before.status,
            refund_attempt_before.attempt_no,
            refund_attempt_before.provider_refund_no,
        )
        first = service(session).create_draft(
            user_id=seeded.owner_id,
            order_id=seeded.order_id,
            idempotency_key=CREATE_KEY,
            request=request,
        )
        replay = service(session).create_draft(
            user_id=seeded.owner_id,
            order_id=seeded.order_id,
            idempotency_key=CREATE_KEY,
            request=request,
        )
        assert replay == first

        record = session.scalar(select(IdempotencyRecord))
        assert record is not None
        canonical = json.dumps(
            {
                "operation": CREATE_OPEN_GAME_OPERATION,
                "resource_id": str(seeded.order_id),
                "body": request.model_dump(mode="json"),
                "version": 1,
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        assert record.request_sha256 == hashlib.sha256(canonical.encode()).hexdigest()
        assert record.response_status == 201
        assert record.response_body == first.model_dump(mode="json")

        session.expire_all()
        order_after = session.get_one(Order, seeded.order_id)
        slot_after = session.get_one(Slot, seeded.slot_id)
        payment_after = session.get_one(Payment, seeded.payment_id)
        refund_case_after = session.get_one(RefundCase, refund_case_before.id)
        refund_attempt_after = session.get_one(
            RefundAttempt,
            refund_attempt_before.id,
        )
        assert (
            order_after.status,
            order_after.cancel_requested_at,
            slot_after.status,
            slot_after.checkout_version,
            payment_after.status,
            payment_after.applied_to_order_at,
            refund_case_after.purpose,
            refund_case_after.reason,
            refund_case_after.amount_cents,
            refund_attempt_after.status,
            refund_attempt_after.attempt_no,
            refund_attempt_after.provider_refund_no,
        ) == b1_snapshot


def test_create_replay_wins_before_current_authority_and_body_reuse_conflicts(
    pg_engine: Engine,
) -> None:
    seeded = seed_confirmed_order(pg_engine)
    request = draft_request(seeded)
    with Session(pg_engine) as session:
        first = service(session).create_draft(
            user_id=seeded.owner_id,
            order_id=seeded.order_id,
            idempotency_key=CREATE_KEY,
            request=request,
        )
        order = session.get_one(Order, seeded.order_id)
        order.status = OrderStatus.REFUNDED
        order.cancel_requested_at = NOW
        order.cancelled_at = NOW
        session.commit()

        replay = service(session).create_draft(
            user_id=seeded.owner_id,
            order_id=seeded.order_id,
            idempotency_key=CREATE_KEY,
            request=request,
        )
        assert replay == first
        with pytest.raises(AppError) as reused:
            service(session).create_draft(
                user_id=seeded.owner_id,
                order_id=seeded.order_id,
                idempotency_key=CREATE_KEY,
                request=draft_request(seeded, name="另一个请求体"),
            )
    assert (reused.value.status_code, reused.value.code) == (
        409,
        "IDEMPOTENCY_KEY_REUSED",
    )


@pytest.mark.parametrize(
    ("starts_at", "cancel_requested", "refund_purpose"),
    [
        (NOW + timedelta(hours=2), False, None),
        (NOW + timedelta(days=3), True, None),
        (NOW + timedelta(days=3), False, RefundCasePurpose.ORDER_CANCELLATION),
        (
            NOW + timedelta(days=3),
            False,
            RefundCasePurpose.PAYMENT_INVENTORY_CONFLICT,
        ),
    ],
)
def test_create_rejects_strict_boundary_and_cancellation_refund_facts(
    pg_engine: Engine,
    starts_at: datetime,
    cancel_requested: bool,
    refund_purpose: RefundCasePurpose | None,
) -> None:
    seeded = seed_confirmed_order(
        pg_engine,
        starts_at=starts_at,
        cancel_requested=cancel_requested,
        refund_purpose=refund_purpose,
    )
    with Session(pg_engine) as session, pytest.raises(AppError) as blocked:
        service(session).create_draft(
            user_id=seeded.owner_id,
            order_id=seeded.order_id,
            idempotency_key=CREATE_KEY,
            request=draft_request(seeded),
        )
    assert (blocked.value.status_code, blocked.value.code) == (
        409,
        "ORDER_NOT_ELIGIBLE",
    )


def test_create_accepts_more_than_two_hours_but_validates_deadline(
    pg_engine: Engine,
) -> None:
    seeded = seed_confirmed_order(
        pg_engine,
        starts_at=NOW + timedelta(hours=2, microseconds=2),
    )
    with Session(pg_engine) as session:
        accepted = service(session).create_draft(
            user_id=seeded.owner_id,
            order_id=seeded.order_id,
            idempotency_key=CREATE_KEY,
            request=draft_request(
                seeded,
                registration_deadline=NOW + timedelta(microseconds=1),
            ),
        )
        assert accepted.persisted_status is OpenGameStatus.DRAFT

    later = seed_confirmed_order(pg_engine)
    with Session(pg_engine) as session, pytest.raises(AppError) as invalid:
        service(session).create_draft(
            user_id=later.owner_id,
            order_id=later.order_id,
            idempotency_key="deadline-invalid-key-0000001",
            request=draft_request(
                later,
                registration_deadline=later.starts_at - timedelta(hours=1),
            ),
        )
    assert (invalid.value.status_code, invalid.value.code) == (
        422,
        "INVALID_ARGUMENT",
    )
    assert invalid.value.details == {
        "fields": [
            {
                "field": "registration_deadline",
                "message": "must be at least two hours before start",
            }
        ]
    }


def test_second_active_game_maps_to_closed_conflict(pg_engine: Engine) -> None:
    seeded = seed_confirmed_order(pg_engine)
    with Session(pg_engine) as session:
        service(session).create_draft(
            user_id=seeded.owner_id,
            order_id=seeded.order_id,
            idempotency_key=CREATE_KEY,
            request=draft_request(seeded),
        )
        with pytest.raises(AppError) as conflict:
            service(session).create_draft(
                user_id=seeded.owner_id,
                order_id=seeded.order_id,
                idempotency_key="second-active-key-00000001",
                request=draft_request(seeded, name="第二个球局"),
            )
    assert (conflict.value.status_code, conflict.value.code) == (
        409,
        "OPEN_GAME_ALREADY_EXISTS",
    )
    assert "constraint" not in conflict.value.message.casefold()


def test_update_all_fields_reassociates_team_and_replays_before_version(
    pg_engine: Engine,
) -> None:
    seeded = seed_confirmed_order(pg_engine)
    with Session(pg_engine) as session:
        created = service(session).create_draft(
            user_id=seeded.owner_id,
            order_id=seeded.order_id,
            idempotency_key=CREATE_KEY,
            request=draft_request(seeded),
        )
        old_team_id = created.team.id
        request = UpdateOpenGameRequest(
            name="更新后的公开球局",
            team_name="北辰联队",
            total_players=12,
            fixed_players=7,
            open_spots=5,
            intensity=OpenGameIntensity.COMPETITIVE,
            minimum_experience="稳定参加业余比赛",
            positions=[
                OpenGamePosition.DEFENDER,
                OpenGamePosition.MIDFIELDER,
                OpenGamePosition.FORWARD,
            ],
            aa_cents=4200,
            registration_deadline=seeded.starts_at - timedelta(hours=4),
            equipment_and_arrival_notes="请自备深浅球衣并提前到场",
            visibility=OpenGameVisibility.PUBLIC,
            expected_version=1,
        )
        updated = service(session).update(
            user_id=seeded.owner_id,
            game_id=created.id,
            idempotency_key=UPDATE_KEY,
            request=request,
        )
        assert updated.version == 2
        assert updated.team.id != old_team_id
        assert updated.model_dump()["name"] == request.name
        assert updated.total_players == request.total_players
        assert updated.fixed_players == request.fixed_players
        assert updated.open_spots == request.open_spots
        assert updated.intensity is request.intensity
        assert updated.minimum_experience == request.minimum_experience
        assert updated.positions == request.positions
        assert updated.aa_cents == request.aa_cents
        assert updated.registration_deadline == request.registration_deadline
        assert updated.equipment_and_arrival_notes == request.equipment_and_arrival_notes
        assert updated.visibility is request.visibility

        replay = service(session).update(
            user_id=seeded.owner_id,
            game_id=created.id,
            idempotency_key=UPDATE_KEY,
            request=request,
        )
        assert replay == updated


def test_update_reuses_normalized_team_and_rejects_wrong_version(
    pg_engine: Engine,
) -> None:
    seeded = seed_confirmed_order(pg_engine)
    with Session(pg_engine) as session:
        created = service(session).create_draft(
            user_id=seeded.owner_id,
            order_id=seeded.order_id,
            idempotency_key=CREATE_KEY,
            request=draft_request(seeded, team_name="Ａ队"),
        )
        same_team = UpdateOpenGameRequest(
            **draft_request(seeded, team_name="A队").model_dump(),
            expected_version=1,
        )
        updated = service(session).update(
            user_id=seeded.owner_id,
            game_id=created.id,
            idempotency_key=UPDATE_KEY,
            request=same_team,
        )
        assert updated.team.id == created.team.id
        assert session.scalar(select(func.count()).select_from(Team)) == 1

        wrong_version = UpdateOpenGameRequest(
            **draft_request(seeded, team_name="A队").model_dump(),
            expected_version=1,
        )
        with pytest.raises(AppError) as conflict:
            service(session).update(
                user_id=seeded.owner_id,
                game_id=created.id,
                idempotency_key="wrong-version-key-000000001",
                request=wrong_version,
            )
    assert (conflict.value.status_code, conflict.value.code) == (
        409,
        "OPEN_GAME_STATE_CHANGED",
    )


def test_healthy_published_update_may_keep_elapsed_deadline(pg_engine: Engine) -> None:
    seeded = seed_confirmed_order(pg_engine)
    deadline = NOW + timedelta(hours=4)
    with Session(pg_engine) as session:
        created = service(session).create_draft(
            user_id=seeded.owner_id,
            order_id=seeded.order_id,
            idempotency_key=CREATE_KEY,
            request=draft_request(seeded, registration_deadline=deadline),
        )
        game = session.get_one(OpenGame, created.id)
        game.status = OpenGameStatus.PUBLISHED
        game.published_at = NOW
        session.commit()
        request = UpdateOpenGameRequest(
            **draft_request(
                seeded,
                name="报名截止后仍可维护",
                registration_deadline=deadline,
            ).model_dump(),
            expected_version=1,
        )
        updated = service(session, now=deadline + timedelta(minutes=1)).update(
            user_id=seeded.owner_id,
            game_id=created.id,
            idempotency_key=UPDATE_KEY,
            request=request,
        )
    assert updated.persisted_status is OpenGameStatus.PUBLISHED
    assert updated.registration_deadline == deadline
    assert updated.version == 2


def test_update_with_joined_members_reports_all_joined_invariant_fields_once(
    pg_engine: Engine,
) -> None:
    seeded = seed_confirmed_order(pg_engine)
    with Session(pg_engine) as session:
        created = service(session).create_draft(
            user_id=seeded.owner_id,
            order_id=seeded.order_id,
            idempotency_key=CREATE_KEY,
            request=draft_request(seeded),
        )
        for index in range(3):
            add_joined_registration(
                session,
                game_id=created.id,
                owner_id=seeded.owner_id,
                label=str(index),
            )
        session.commit()
        request = UpdateOpenGameRequest(
            **(
                draft_request(seeded).model_dump()
                | {"total_players": 8, "open_spots": 2, "aa_cents": 3601}
            ),
            expected_version=1,
        )

        with pytest.raises(AppError) as invalid:
            service(session).update(
                user_id=seeded.owner_id,
                game_id=created.id,
                idempotency_key="joined-invariants-key-000001",
                request=request,
            )

        assert (invalid.value.status_code, invalid.value.code) == (
            422,
            "INVALID_ARGUMENT",
        )
        assert invalid.value.message == "球局已有加入成员，开放容量或预计 AA 不符合要求。"
        assert invalid.value.details == {
            "fields": [
                {"field": "open_spots", "message": "不能小于已加入人数。"},
                {
                    "field": "total_players",
                    "message": "不能小于固定人数与已加入人数之和。",
                },
                {
                    "field": "aa_cents",
                    "message": "已有加入成员后预计 AA 只能保持或降低。",
                },
            ]
        }


def test_update_rejects_open_spots_change_while_active_waitlist_exists(
    pg_engine: Engine,
) -> None:
    seeded = seed_confirmed_order(pg_engine)
    with Session(pg_engine) as session:
        game = add_stored_game(
            session,
            seeded=seeded,
            status=OpenGameStatus.PUBLISHED,
        )
        add_waitlisted_registration(
            session,
            game_id=game.id,
            owner_id=seeded.owner_id,
        )
        session.commit()
        request = UpdateOpenGameRequest(
            **(
                draft_request(seeded).model_dump()
                | {"total_players": 11, "open_spots": 5}
            ),
            expected_version=1,
        )

        with pytest.raises(AppError) as invalid:
            service(session).update(
                user_id=seeded.owner_id,
                game_id=game.id,
                idempotency_key="waitlist-capacity-edit-key-000001",
                request=request,
            )

        assert (invalid.value.status_code, invalid.value.code) == (
            422,
            "INVALID_ARGUMENT",
        )
        assert invalid.value.details == {
            "fields": [
                {
                    "field": "open_spots",
                    "message": "存在候补成员时不能修改开放名额。",
                }
            ]
        }
        session.refresh(game)
        assert game.open_spots == 4
        assert game.version == 1
        assert session.scalar(select(func.count()).select_from(IdempotencyRecord)) == 0


def test_update_allows_other_fields_when_open_spots_matches_active_waitlist_game(
    pg_engine: Engine,
) -> None:
    seeded = seed_confirmed_order(pg_engine)
    with Session(pg_engine) as session:
        game = add_stored_game(
            session,
            seeded=seeded,
            status=OpenGameStatus.PUBLISHED,
        )
        add_waitlisted_registration(
            session,
            game_id=game.id,
            owner_id=seeded.owner_id,
        )
        session.commit()
        request = UpdateOpenGameRequest(
            **(
                draft_request(
                    seeded,
                    name="候补存在时只改名称",
                ).model_dump()
                | {"open_spots": 4}
            ),
            expected_version=1,
        )

        updated = service(session).update(
            user_id=seeded.owner_id,
            game_id=game.id,
            idempotency_key="waitlist-same-capacity-edit-key-001",
            request=request,
        )

        assert updated.name == "候补存在时只改名称"
        assert updated.open_spots == 4
        assert updated.version == 2


def test_update_total_floor_is_reachable_when_open_spots_equals_joined(
    pg_engine: Engine,
) -> None:
    seeded = seed_confirmed_order(pg_engine)
    with Session(pg_engine) as session:
        created = service(session).create_draft(
            user_id=seeded.owner_id,
            order_id=seeded.order_id,
            idempotency_key=CREATE_KEY,
            request=draft_request(seeded),
        )
        for index in range(3):
            add_joined_registration(
                session,
                game_id=created.id,
                owner_id=seeded.owner_id,
                label=f"total-{index}",
            )
        session.commit()
        request = UpdateOpenGameRequest(
            **(
                draft_request(seeded).model_dump()
                | {"total_players": 8, "open_spots": 3}
            ),
            expected_version=1,
        )

        with pytest.raises(AppError) as invalid:
            service(session).update(
                user_id=seeded.owner_id,
                game_id=created.id,
                idempotency_key="joined-total-floor-key-000001",
                request=request,
            )

    assert invalid.value.details == {
        "fields": [
            {
                "field": "total_players",
                "message": "不能小于固定人数与已加入人数之和。",
            }
        ]
    }


def test_update_without_joined_members_still_checks_roster_in_locked_service(
    pg_engine: Engine,
) -> None:
    seeded = seed_confirmed_order(pg_engine)
    with Session(pg_engine) as session:
        created = service(session).create_draft(
            user_id=seeded.owner_id,
            order_id=seeded.order_id,
            idempotency_key=CREATE_KEY,
            request=draft_request(seeded),
        )
        request = UpdateOpenGameRequest(
            **(draft_request(seeded).model_dump() | {"open_spots": 5}),
            expected_version=1,
        )

        with pytest.raises(AppError) as invalid:
            service(session).update(
                user_id=seeded.owner_id,
                game_id=created.id,
                idempotency_key="empty-roster-floor-key-000001",
                request=request,
            )

    assert (invalid.value.status_code, invalid.value.code) == (
        422,
        "INVALID_ARGUMENT",
    )
    assert invalid.value.details == {
        "fields": [
            {
                "field": "total_players",
                "message": "不能小于固定人数与已加入人数之和。",
            }
        ]
    }


def test_create_request_keeps_roster_capacity_validation() -> None:
    seeded = SeededOpenGameCase(
        owner_id=uuid.uuid4(),
        stranger_id=uuid.uuid4(),
        order_id=uuid.uuid4(),
        slot_id=uuid.uuid4(),
        payment_id=uuid.uuid4(),
        starts_at=NOW + timedelta(days=3),
        ends_at=NOW + timedelta(days=3, hours=2),
    )
    with pytest.raises(ValidationError):
        CreateOpenGameRequest(
            **(draft_request(seeded).model_dump() | {"open_spots": 5})
        )


class FailingCompletionOrderRepository(OrderRepository):
    def complete_idempotency(self, *args: object, **kwargs: object) -> None:
        raise SQLAlchemyError("injected completion failure")


def test_db_failure_rolls_back_team_game_and_idempotency(pg_engine: Engine) -> None:
    seeded = seed_confirmed_order(pg_engine)
    with Session(pg_engine) as session, pytest.raises(AppError) as unavailable:
        OpenGameService(
            repository=OpenGameRepository(session),
            order_repository=FailingCompletionOrderRepository(session),
            now=lambda: NOW,
        ).create_draft(
            user_id=seeded.owner_id,
            order_id=seeded.order_id,
            idempotency_key=CREATE_KEY,
            request=draft_request(seeded),
        )
    assert (unavailable.value.status_code, unavailable.value.code) == (
        503,
        "SERVICE_UNAVAILABLE",
    )
    with Session(pg_engine) as session:
        assert session.scalar(select(func.count()).select_from(Team)) == 0
        assert session.scalar(select(func.count()).select_from(OpenGame)) == 0
        assert session.scalar(select(func.count()).select_from(IdempotencyRecord)) == 0


def test_share_token_collision_retries_once_then_returns_503(pg_engine: Engine) -> None:
    collision = "A" * 32
    unique = "B" * 32
    seeded = seed_confirmed_order(pg_engine)
    other = seed_confirmed_order(pg_engine)
    with Session(pg_engine) as session:
        add_stored_game(
            session,
            seeded=other,
            status=OpenGameStatus.CANCELLED,
            share_token=collision,
        )
        session.commit()
        created = service(session, tokens=[collision, unique]).create_draft(
            user_id=seeded.owner_id,
            order_id=seeded.order_id,
            idempotency_key=CREATE_KEY,
            request=draft_request(seeded),
        )
        assert session.get_one(OpenGame, created.id).share_token == unique

    failed = seed_confirmed_order(pg_engine)
    with Session(pg_engine) as session, pytest.raises(AppError) as unavailable:
        service(session, tokens=[collision, collision]).create_draft(
            user_id=failed.owner_id,
            order_id=failed.order_id,
            idempotency_key="double-token-collision-key-01",
            request=draft_request(failed),
        )
    assert (unavailable.value.status_code, unavailable.value.code) == (
        503,
        "SERVICE_UNAVAILABLE",
    )
    with Session(pg_engine) as session:
        assert session.scalar(
            select(func.count()).select_from(OpenGame).where(
                OpenGame.order_id == failed.order_id
            )
        ) == 0
        assert session.scalar(
            select(func.count()).select_from(IdempotencyRecord).where(
                IdempotencyRecord.user_id == failed.owner_id
            )
        ) == 0
