from __future__ import annotations

import base64
import json
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, cast

import pytest
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session

from backend.app.errors import AppError
from backend.app.models import (
    OpenGameRegistration,
    OpenGameRegistrationPosition,
    OpenGameRegistrationStatus,
    OpenGameStatus,
    OpenGameVisibility,
    Pitch,
    Slot,
    User,
    Venue,
)
from backend.app.modules.open_game_registrations.repository import (
    OpenGameRegistrationRepository,
)
from backend.app.modules.open_game_registrations.service import (
    OpenGameRegistrationService,
)
from backend.app.modules.open_games.repository import OpenGameRepository
from backend.app.modules.orders.repository import OrderRepository
from backend.tests.test_open_game_service import add_stored_game, seed_confirmed_order

pytestmark = pytest.mark.integration

NOW = datetime(2026, 8, 30, 8, tzinfo=UTC)
ITEM_FIELDS = {
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
PRIVATE_FIELDS = {
    "applicant_user_id",
    "display_name",
    "position",
    "note",
    "persisted_status",
    "decided_at",
    "decided_by_user_id",
    "version",
    "consent_version",
    "adult_confirmed_at",
    "risk_confirmed_at",
    "owner_user_id",
    "captain_user_id",
    "order_id",
    "payment_id",
    "refund_case_id",
    "price_cents",
    "aa_cents",
}


def _new_user(engine: Engine, label: str) -> uuid.UUID:
    with Session(engine) as session:
        user = User(
            wechat_app_id="wx-my-applications-test",
            wechat_openid=f"my-applications-{label}-{uuid.uuid4()}",
        )
        session.add(user)
        session.commit()
        return cast(uuid.UUID, user.id)


def _seed_application(
    engine: Engine,
    *,
    applicant_user_id: uuid.UUID,
    label: str,
    applied_at: datetime,
    application_id: uuid.UUID | None = None,
    registration_status: OpenGameRegistrationStatus = OpenGameRegistrationStatus.APPLIED,
    game_status: OpenGameStatus = OpenGameStatus.PUBLISHED,
    visibility: OpenGameVisibility = OpenGameVisibility.PUBLIC,
    starts_at: datetime | None = None,
    time_zone: str = "Asia/Shanghai",
) -> uuid.UUID:
    booking = seed_confirmed_order(
        engine,
        starts_at=starts_at or NOW + timedelta(days=3),
    )
    with Session(engine) as session:
        slot = session.get_one(Slot, booking.slot_id)
        pitch = session.get_one(Pitch, slot.pitch_id)
        venue = session.get_one(Venue, pitch.venue_id)
        venue.timezone = time_zone
        pitch.name = f"{label}球场"
        pitch.players_per_side = 5
        game = add_stored_game(
            session,
            seeded=booking,
            status=game_status,
            share_token=(label.encode().hex() + "0" * 32)[:32],
            team_name=f"{label}联队",
        )
        game.name = f"{label}球局"
        game.visibility = visibility
        if game_status is OpenGameStatus.CANCELLED:
            game.published_at = NOW - timedelta(days=1)
            game.cancelled_at = NOW
        terminal = registration_status is not OpenGameRegistrationStatus.APPLIED
        registration = OpenGameRegistration(
            id=application_id or uuid.uuid4(),
            game_id=game.id,
            applicant_user_id=applicant_user_id,
            display_name="测试球员",
            position=OpenGameRegistrationPosition.ANY,
            note="只在权威记录中保留。",
            status=registration_status,
            version=2 if terminal else 1,
            consent_version="c1a-2026-08-24",
            adult_confirmed_at=applied_at,
            risk_confirmed_at=applied_at,
            applied_at=applied_at,
            decided_at=applied_at + timedelta(minutes=1) if terminal else None,
            decided_by_user_id=booking.owner_id if terminal else None,
        )
        session.add(registration)
        session.commit()
        return cast(uuid.UUID, registration.id)


def _service(session: Session) -> OpenGameRegistrationService:
    return OpenGameRegistrationService(
        repository=OpenGameRegistrationRepository(session),
        open_game_repository=OpenGameRepository(session),
        order_repository=OrderRepository(session),
        now=lambda: NOW,
    )


def _all_keys(value: Any) -> set[str]:
    if isinstance(value, dict):
        return set(value) | {
            key for child in value.values() for key in _all_keys(child)
        }
    if isinstance(value, list):
        return {key for child in value for key in _all_keys(child)}
    return set()


def test_lists_all_authoritative_status_visibility_and_time_categories_privately(
    pg_engine: Engine,
) -> None:
    applicant_id = _new_user(pg_engine, "complete")
    cases = (
        (
            "公开未来申请",
            OpenGameRegistrationStatus.APPLIED,
            OpenGameStatus.PUBLISHED,
            OpenGameVisibility.PUBLIC,
            NOW + timedelta(days=3),
            "APPLIED",
        ),
        (
            "链接历史加入",
            OpenGameRegistrationStatus.JOINED,
            OpenGameStatus.PUBLISHED,
            OpenGameVisibility.LINK_ONLY,
            NOW - timedelta(days=3),
            "JOINED",
        ),
        (
            "公开历史拒绝",
            OpenGameRegistrationStatus.REJECTED,
            OpenGameStatus.PUBLISHED,
            OpenGameVisibility.PUBLIC,
            NOW - timedelta(days=5),
            "REJECTED",
        ),
        (
            "链接取消投影",
            OpenGameRegistrationStatus.JOINED,
            OpenGameStatus.CANCELLED,
            OpenGameVisibility.LINK_ONLY,
            NOW + timedelta(days=5),
            "CANCELLED",
        ),
    )
    for index, (label, stored, game_status, visibility, starts_at, _effective) in enumerate(
        cases
    ):
        _seed_application(
            pg_engine,
            applicant_user_id=applicant_id,
            label=label,
            registration_status=stored,
            game_status=game_status,
            visibility=visibility,
            starts_at=starts_at,
            applied_at=NOW - timedelta(minutes=index),
        )

    with Session(pg_engine) as session:
        page = _service(session).list_my_applications(
            applicant_user_id=applicant_id,
            limit=20,
            cursor=None,
        )

    assert [item.effective_status.value for item in page.items] == [
        case[-1] for case in cases
    ]
    assert {item.game_name for item in page.items} == {
        f"{case[0]}球局" for case in cases
    }
    assert all(
        item.detail_path.startswith("/pages/captain-game-public/index?token=")
        for item in page.items
    )
    dumped = page.model_dump(mode="json")
    assert set(dumped) == {"items", "next_cursor"}
    assert all(set(item) == ITEM_FIELDS for item in dumped["items"])
    assert not PRIVATE_FIELDS & _all_keys(dumped)


def test_self_only_keyset_is_stable_and_cross_user_cursor_cannot_change_identity(
    pg_engine: Engine,
) -> None:
    user_a = _new_user(pg_engine, "a")
    user_b = _new_user(pg_engine, "b")
    applied_at = NOW - timedelta(hours=1)
    a_ids = [
        uuid.UUID("40000000-0000-4000-8000-000000000003"),
        uuid.UUID("40000000-0000-4000-8000-000000000002"),
        uuid.UUID("40000000-0000-4000-8000-000000000001"),
    ]
    b_ids = [
        uuid.UUID("30000000-0000-4000-8000-000000000003"),
        uuid.UUID("30000000-0000-4000-8000-000000000002"),
        uuid.UUID("30000000-0000-4000-8000-000000000001"),
    ]
    for index, application_id in enumerate(a_ids):
        _seed_application(
            pg_engine,
            applicant_user_id=user_a,
            label=f"甲{index}",
            application_id=application_id,
            applied_at=applied_at,
        )
    for index, application_id in enumerate(b_ids):
        _seed_application(
            pg_engine,
            applicant_user_id=user_b,
            label=f"乙{index}",
            application_id=application_id,
            applied_at=applied_at,
        )

    with Session(pg_engine) as session:
        service = _service(session)
        a_first = service.list_my_applications(
            applicant_user_id=user_a, limit=2, cursor=None
        )
        assert a_first.next_cursor is not None
        a_second = service.list_my_applications(
            applicant_user_id=user_a,
            limit=2,
            cursor=a_first.next_cursor,
        )
        b_with_a_cursor = service.list_my_applications(
            applicant_user_id=user_b,
            limit=20,
            cursor=a_first.next_cursor,
        )
        empty = service.list_my_applications(
            applicant_user_id=uuid.uuid4(), limit=20, cursor=None
        )

    combined = [item.id for item in (*a_first.items, *a_second.items)]
    assert combined == a_ids
    assert len(combined) == len(set(combined))
    assert [item.id for item in b_with_a_cursor.items] == b_ids
    assert empty.items == ()
    assert empty.next_cursor is None

    cursor = a_first.next_cursor
    assert cursor is not None and "=" not in cursor
    decoded = json.loads(base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)))
    assert decoded == {
        "v": 1,
        "applied_at": applied_at.isoformat(),
        "id": str(a_ids[1]),
    }


@pytest.mark.parametrize(
    "cursor",
    [
        "",
        "not-base64!",
        base64.urlsafe_b64encode(b"{}").decode().rstrip("="),
        base64.urlsafe_b64encode(
            json.dumps({"v": 2, "applied_at": NOW.isoformat(), "id": str(uuid.uuid4())}).encode()
        ).decode().rstrip("="),
        base64.urlsafe_b64encode(
            json.dumps({"v": 1, "applied_at": "not-a-time", "id": str(uuid.uuid4())}).encode()
        ).decode().rstrip("="),
        base64.urlsafe_b64encode(
            json.dumps({"v": 1, "applied_at": NOW.isoformat(), "id": "not-a-uuid"}).encode()
        ).decode().rstrip("="),
        base64.urlsafe_b64encode(
            json.dumps(
                {
                    "v": 1,
                    "applied_at": NOW.isoformat(),
                    "id": str(uuid.uuid4()),
                    "user_id": str(uuid.uuid4()),
                }
            ).encode()
        ).decode().rstrip("="),
    ],
)
def test_rejects_malformed_cursor(cursor: str, pg_engine: Engine) -> None:
    with Session(pg_engine) as session, pytest.raises(AppError) as caught:
        _service(session).list_my_applications(
            applicant_user_id=uuid.uuid4(),
            limit=20,
            cursor=cursor,
        )
    assert (caught.value.status_code, caught.value.code) == (422, "INVALID_ARGUMENT")


def test_broken_authority_fails_the_whole_page_and_rolls_back(pg_engine: Engine) -> None:
    applicant_id = _new_user(pg_engine, "broken")
    _seed_application(
        pg_engine,
        applicant_user_id=applicant_id,
        label="正常",
        applied_at=NOW,
    )
    _seed_application(
        pg_engine,
        applicant_user_id=applicant_id,
        label="损坏",
        applied_at=NOW - timedelta(minutes=1),
        time_zone="Broken/Authority",
    )

    with Session(pg_engine) as session, pytest.raises(AppError) as caught:
        _service(session).list_my_applications(
            applicant_user_id=applicant_id,
            limit=20,
            cursor=None,
        )
    assert (caught.value.status_code, caught.value.code) == (503, "SERVICE_UNAVAILABLE")


def test_authority_preload_query_count_is_bounded_by_page_not_item_count(
    pg_engine: Engine,
) -> None:
    applicant_id = _new_user(pg_engine, "bounded")
    for index in range(4):
        _seed_application(
            pg_engine,
            applicant_user_id=applicant_id,
            label=f"有界{index}",
            applied_at=NOW - timedelta(minutes=index),
        )

    statements: list[str] = []

    def record_statement(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: object,
    ) -> None:
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    event.listen(pg_engine, "before_cursor_execute", record_statement)
    try:
        with Session(pg_engine) as session:
            page = _service(session).list_my_applications(
                applicant_user_id=applicant_id,
                limit=20,
                cursor=None,
            )
    finally:
        event.remove(pg_engine, "before_cursor_execute", record_statement)

    assert len(page.items) == 4
    assert len(statements) <= 4
