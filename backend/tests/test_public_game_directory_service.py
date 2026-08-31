import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session

from backend.app.models import (
    OpenGameRegistration,
    OpenGameRegistrationPosition,
    OpenGameRegistrationStatus,
    OpenGameStatus,
    OpenGameVisibility,
    Order,
    OrderStatus,
    Pitch,
    RefundCasePurpose,
    Slot,
    User,
    Venue,
)
from backend.app.modules.public_games.dto import PublicGameFormat
from backend.app.modules.public_games.repository import PublicGameDirectoryRepository
from backend.app.modules.public_games.service import PublicGameDirectoryService
from backend.tests.test_open_game_service import (
    add_stored_game,
    seed_confirmed_order,
)

pytestmark = pytest.mark.integration

NOW = datetime(2026, 8, 26, 4, tzinfo=UTC)


@dataclass(frozen=True, slots=True)
class SeededDirectoryGame:
    game_id: uuid.UUID
    owner_id: uuid.UUID
    starts_at: datetime
    share_token: str
    name: str


def seed_directory_game(
    engine: Engine,
    *,
    name: str,
    starts_at: datetime | None = None,
    status: OpenGameStatus = OpenGameStatus.PUBLISHED,
    visibility: OpenGameVisibility = OpenGameVisibility.PUBLIC,
    order_status: OrderStatus = OrderStatus.CONFIRMED,
    cancel_requested: bool = False,
    refund_purpose: RefundCasePurpose | None = None,
    players_per_side: int = 5,
    time_zone: str = "Asia/Shanghai",
    registration_deadline: datetime | None = None,
    share_token: str | None = None,
    malformed_projection: bool = False,
) -> SeededDirectoryGame:
    start = starts_at or NOW + timedelta(days=3)
    seeded = seed_confirmed_order(
        engine,
        starts_at=start,
        cancel_requested=cancel_requested,
        refund_purpose=refund_purpose,
    )
    token = share_token or uuid.uuid4().hex
    with Session(engine) as session:
        slot = session.get_one(Slot, seeded.slot_id)
        pitch = session.get_one(Pitch, slot.pitch_id)
        venue = session.get_one(Venue, pitch.venue_id)
        pitch.players_per_side = players_per_side
        venue.timezone = time_zone

        game = add_stored_game(
            session,
            seeded=seeded,
            status=status,
            share_token=token,
            team_name=f"{name}联队",
        )
        game.name = "X" if malformed_projection else name
        game.visibility = visibility
        game.registration_deadline = registration_deadline or (start - timedelta(hours=3))
        if status is OpenGameStatus.CANCELLED:
            game.published_at = NOW
            game.cancelled_at = NOW

        order = session.get_one(Order, seeded.order_id)
        order.status = order_status
        if order_status is OrderStatus.COMPLETED:
            order.checked_in_at = NOW - timedelta(minutes=2)
            order.checked_in_by_user_id = seeded.owner_id
            order.completed_at = NOW - timedelta(minutes=1)
            order.completed_by_user_id = seeded.owner_id
        elif order_status in {
            OrderStatus.CANCELLED,
            OrderStatus.REFUND_PENDING,
            OrderStatus.REFUND_FAILED,
            OrderStatus.REFUNDED,
        }:
            order.cancel_requested_at = NOW - timedelta(minutes=2)
            order.cancelled_at = NOW - timedelta(minutes=1)
        session.commit()
        return SeededDirectoryGame(
            game_id=game.id,
            owner_id=seeded.owner_id,
            starts_at=start,
            share_token=token,
            name=game.name,
        )


def add_registration(
    session: Session,
    *,
    game: SeededDirectoryGame,
    status: OpenGameRegistrationStatus,
    label: str,
) -> None:
    applicant = User(
        wechat_app_id="wx-directory-registration",
        wechat_openid=f"directory-{label}-{uuid.uuid4()}",
    )
    session.add(applicant)
    session.flush()
    decided = status is not OpenGameRegistrationStatus.APPLIED
    session.add(
        OpenGameRegistration(
            game_id=game.game_id,
            applicant_user_id=applicant.id,
            display_name=f"目录球员{label}",
            position=OpenGameRegistrationPosition.ANY,
            note=None,
            status=status,
            version=2 if decided else 1,
            consent_version="c1a-2026-08-24",
            adult_confirmed_at=NOW,
            risk_confirmed_at=NOW,
            applied_at=NOW,
            decided_at=NOW if decided else None,
            decided_by_user_id=game.owner_id if decided else None,
        )
    )


def directory_service(
    session: Session,
    *,
    now: datetime = NOW,
) -> PublicGameDirectoryService:
    return PublicGameDirectoryService(
        repository=PublicGameDirectoryRepository(session),
        now=lambda: now,
    )


def test_includes_public_published_healthy_future_valid_game(
    pg_engine: Engine,
) -> None:
    seeded = seed_directory_game(
        pg_engine,
        name="公开健康球局",
        refund_purpose=RefundCasePurpose.DUPLICATE_CHARGE,
        share_token="V" * 32,
    )

    with Session(pg_engine) as session:
        result = directory_service(session).list_games()

    assert result.authoritative_now == NOW
    assert result.available_dates == [date(2026, 8, 29)]
    assert len(result.items) == 1
    item = result.items[0]
    assert item.detail_path == ("/pages/captain-game-public/index?token=" + seeded.share_token)
    assert item.local_date == date(2026, 8, 29)
    assert item.format is PublicGameFormat.FIVE
    assert item.current_players == 6
    assert item.remaining_spots == 4
    assert item.game.name == "公开健康球局"
    assert item.game.state.value == "PUBLISHED"
    assert item.game.state_reason is None
    assert item.game.visibility is OpenGameVisibility.PUBLIC


@pytest.mark.parametrize(
    "case",
    [
        "link_only",
        "draft",
        "cancelled",
        "completed_order",
        "unhealthy_order",
        "cancel_requested",
        "order_cancellation_refund",
        "inventory_conflict_refund",
        "expired_deadline",
        "started",
        "unsupported_pitch",
        "malformed_token",
        "malformed_zone",
        "malformed_projection",
    ],
)
def test_omits_ineligible_or_malformed_historical_rows(
    pg_engine: Engine,
    case: str,
) -> None:
    kwargs: dict[str, object] = {"name": f"排除{case[:12]}"}
    if case == "link_only":
        kwargs["visibility"] = OpenGameVisibility.LINK_ONLY
    elif case == "draft":
        kwargs["status"] = OpenGameStatus.DRAFT
    elif case == "cancelled":
        kwargs["status"] = OpenGameStatus.CANCELLED
    elif case == "completed_order":
        kwargs["order_status"] = OrderStatus.COMPLETED
    elif case == "unhealthy_order":
        kwargs["order_status"] = OrderStatus.PAYMENT_EXCEPTION
    elif case == "cancel_requested":
        kwargs["cancel_requested"] = True
    elif case == "order_cancellation_refund":
        kwargs["refund_purpose"] = RefundCasePurpose.ORDER_CANCELLATION
    elif case == "inventory_conflict_refund":
        kwargs["refund_purpose"] = RefundCasePurpose.PAYMENT_INVENTORY_CONFLICT
    elif case == "expired_deadline":
        kwargs["registration_deadline"] = NOW
    elif case == "started":
        kwargs["starts_at"] = NOW
        kwargs["registration_deadline"] = NOW + timedelta(hours=1)
    elif case == "unsupported_pitch":
        kwargs["players_per_side"] = 9
    elif case == "malformed_token":
        kwargs["share_token"] = "T" * 31
    elif case == "malformed_zone":
        kwargs["time_zone"] = "Fake/Zone"
    elif case == "malformed_projection":
        kwargs["malformed_projection"] = True

    seed_directory_game(pg_engine, **kwargs)  # type: ignore[arg-type]

    with Session(pg_engine) as session:
        result = directory_service(session).list_games()

    assert result.available_dates == []
    assert result.items == []


def test_stably_orders_by_start_then_id_and_projects_venue_local_date(
    pg_engine: Engine,
) -> None:
    first_start = datetime(2026, 8, 28, 1, tzinfo=UTC)
    first = seed_directory_game(
        pg_engine,
        name="洛杉矶早场",
        starts_at=first_start,
        time_zone="America/Los_Angeles",
    )
    same_start = datetime(2026, 8, 29, 1, tzinfo=UTC)
    same_a = seed_directory_game(
        pg_engine,
        name="同期开场甲",
        starts_at=same_start,
    )
    same_b = seed_directory_game(
        pg_engine,
        name="同期开场乙",
        starts_at=same_start,
    )
    expected_names = [
        row.name
        for row in sorted(
            (first, same_a, same_b),
            key=lambda row: (row.starts_at, row.game_id),
        )
    ]

    with Session(pg_engine) as session:
        result = directory_service(session).list_games()

    assert [item.game.name for item in result.items] == expected_names
    assert result.items[0].local_date == date(2026, 8, 27)
    assert result.items[0].game.time_zone == "America/Los_Angeles"
    assert result.available_dates == [date(2026, 8, 27), date(2026, 8, 29)]


def test_available_dates_use_base_eligible_set_before_all_filters(
    pg_engine: Engine,
) -> None:
    five = seed_directory_game(
        pg_engine,
        name="五人制可报名",
        starts_at=datetime(2026, 8, 28, 1, tzinfo=UTC),
    )
    seven = seed_directory_game(
        pg_engine,
        name="七人制可报名",
        starts_at=datetime(2026, 8, 29, 1, tzinfo=UTC),
        players_per_side=7,
    )
    full = seed_directory_game(
        pg_engine,
        name="七人制已满",
        starts_at=datetime(2026, 8, 29, 4, tzinfo=UTC),
        players_per_side=7,
    )
    with Session(pg_engine) as session:
        for index in range(4):
            add_registration(
                session,
                game=full,
                status=OpenGameRegistrationStatus.JOINED,
                label=f"full-{index}",
            )
        session.commit()

        local_date_only = directory_service(session).list_games(local_date=date(2026, 8, 29))
        format_only = directory_service(session).list_games(game_format=PublicGameFormat.FIVE)
        available_only = directory_service(session).list_games(available_only=True)
        combined = directory_service(session).list_games(
            local_date=date(2026, 8, 29),
            game_format=PublicGameFormat.SEVEN,
            available_only=True,
        )

    expected_dates = [date(2026, 8, 28), date(2026, 8, 29)]
    assert local_date_only.available_dates == expected_dates
    assert {item.game.name for item in local_date_only.items} == {
        seven.name,
        full.name,
    }
    assert format_only.available_dates == expected_dates
    assert [item.game.name for item in format_only.items] == [five.name]
    assert available_only.available_dates == expected_dates
    assert {item.game.name for item in available_only.items} == {
        five.name,
        seven.name,
    }
    assert combined.available_dates == expected_dates
    assert [item.game.name for item in combined.items] == [seven.name]


def test_only_joined_consumes_capacity_and_full_game_is_included_by_default(
    pg_engine: Engine,
) -> None:
    counted = seed_directory_game(
        pg_engine,
        name="仅已加入计数",
        starts_at=NOW + timedelta(days=2),
    )
    full = seed_directory_game(
        pg_engine,
        name="零余位仍展示",
        starts_at=NOW + timedelta(days=3),
    )
    with Session(pg_engine) as session:
        for index, status in enumerate(
            (
                OpenGameRegistrationStatus.JOINED,
                OpenGameRegistrationStatus.JOINED,
                OpenGameRegistrationStatus.APPLIED,
                OpenGameRegistrationStatus.REJECTED,
            )
        ):
            add_registration(
                session,
                game=counted,
                status=status,
                label=f"counted-{index}",
            )
        for index in range(4):
            add_registration(
                session,
                game=full,
                status=OpenGameRegistrationStatus.JOINED,
                label=f"full-{index}",
            )
        session.commit()

        unfiltered = directory_service(session).list_games()
        available = directory_service(session).list_games(available_only=True)

    by_name = {item.game.name: item for item in unfiltered.items}
    assert by_name[counted.name].current_players == 8
    assert by_name[counted.name].remaining_spots == 2
    assert by_name[full.name].current_players == 10
    assert by_name[full.name].remaining_spots == 0
    assert [item.game.name for item in available.items] == [counted.name]


def test_multiple_cards_use_exactly_one_sql_statement(pg_engine: Engine) -> None:
    for index in range(4):
        seed_directory_game(
            pg_engine,
            name=f"固定查询球局{index}",
            starts_at=NOW + timedelta(days=index + 2),
        )

    with Session(pg_engine) as session:
        connection = session.connection()
        statements: list[str] = []

        def record_statement(
            _connection: object,
            _cursor: object,
            statement: str,
            _parameters: object,
            _context: object,
            _executemany: bool,
        ) -> None:
            statements.append(statement)

        event.listen(connection, "before_cursor_execute", record_statement)
        try:
            result = directory_service(session).list_games()
        finally:
            event.remove(connection, "before_cursor_execute", record_statement)

    assert len(result.items) == 4
    assert len(statements) == 1
