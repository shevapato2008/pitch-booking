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
    OpenGameAttendanceCorrection,
    OpenGameAttendanceStatus,
    OpenGameRegistration,
    OpenGameRegistrationPosition,
    OpenGameRegistrationStatus,
    OpenGameRegistrationWithdrawalKind,
    OpenGameStatus,
    OpenGameVisibility,
    OrderStatus,
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
    "attendance_recorded_by_user_id",
    "reason",
    "corrected_by_principal_id",
    "corrections",
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
    waitlist_seq: int | None = None,
    waitlisted_at: datetime | None = None,
    promoted_at: datetime | None = None,
    withdrawal_kind: OpenGameRegistrationWithdrawalKind | None = None,
    withdrawn_at: datetime | None = None,
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
        terminal = registration_status in {
            OpenGameRegistrationStatus.WAITLISTED,
            OpenGameRegistrationStatus.JOINED,
            OpenGameRegistrationStatus.REJECTED,
        } or (
            registration_status is OpenGameRegistrationStatus.WITHDRAWN
            and withdrawal_kind
            in {
                OpenGameRegistrationWithdrawalKind.WAITLIST_WITHDRAWAL,
                OpenGameRegistrationWithdrawalKind.GAME_EXIT,
            }
        )
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
            withdrawn_at=withdrawn_at,
            withdrawal_kind=withdrawal_kind,
            late_exit_recorded=False,
            waitlist_seq=waitlist_seq,
            waitlisted_at=waitlisted_at,
            promoted_at=promoted_at,
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


def test_projects_current_and_historical_waitlist_fields_with_compressed_position(
    pg_engine: Engine,
) -> None:
    applicant_id = _new_user(pg_engine, "waitlist-history")
    current_applied = NOW - timedelta(minutes=30)
    current_waitlisted = current_applied + timedelta(minutes=1)
    current_id = _seed_application(
        pg_engine,
        applicant_user_id=applicant_id,
        label="当前候补",
        applied_at=current_applied,
        registration_status=OpenGameRegistrationStatus.WAITLISTED,
        waitlist_seq=9,
        waitlisted_at=current_waitlisted,
    )
    promoted_applied = NOW - timedelta(minutes=40)
    promoted_waitlisted = promoted_applied + timedelta(minutes=1)
    promoted_at = promoted_waitlisted + timedelta(minutes=3)
    promoted_id = _seed_application(
        pg_engine,
        applicant_user_id=applicant_id,
        label="已递补",
        applied_at=promoted_applied,
        registration_status=OpenGameRegistrationStatus.JOINED,
        waitlist_seq=7,
        waitlisted_at=promoted_waitlisted,
        promoted_at=promoted_at,
    )
    withdrawn_applied = NOW - timedelta(minutes=50)
    withdrawn_waitlisted = withdrawn_applied + timedelta(minutes=1)
    withdrawn_id = _seed_application(
        pg_engine,
        applicant_user_id=applicant_id,
        label="退出候补",
        applied_at=withdrawn_applied,
        registration_status=OpenGameRegistrationStatus.WITHDRAWN,
        waitlist_seq=8,
        waitlisted_at=withdrawn_waitlisted,
        withdrawal_kind=OpenGameRegistrationWithdrawalKind.WAITLIST_WITHDRAWAL,
        withdrawn_at=withdrawn_waitlisted + timedelta(minutes=2),
    )

    with Session(pg_engine) as session:
        current = session.get_one(OpenGameRegistration, current_id)
        earlier = User(
            wechat_app_id="wx-my-applications-test",
            wechat_openid=f"waitlist-earlier-{uuid.uuid4()}",
        )
        departed = User(
            wechat_app_id="wx-my-applications-test",
            wechat_openid=f"waitlist-departed-{uuid.uuid4()}",
        )
        session.add_all((earlier, departed))
        session.flush()
        session.add_all(
            (
                OpenGameRegistration(
                    id=uuid.uuid4(),
                    game_id=current.game_id,
                    applicant_user_id=earlier.id,
                    display_name="前序候补",
                    position=OpenGameRegistrationPosition.ANY,
                    note=None,
                    status=OpenGameRegistrationStatus.WAITLISTED,
                    version=2,
                    consent_version="c1a-2026-08-24",
                    adult_confirmed_at=current_applied,
                    risk_confirmed_at=current_applied,
                    applied_at=current_applied,
                    decided_at=current_waitlisted,
                    decided_by_user_id=current.game.order.user_id,
                    waitlist_seq=3,
                    waitlisted_at=current_waitlisted,
                ),
                OpenGameRegistration(
                    id=uuid.uuid4(),
                    game_id=current.game_id,
                    applicant_user_id=departed.id,
                    display_name="退出候补",
                    position=OpenGameRegistrationPosition.ANY,
                    note=None,
                    status=OpenGameRegistrationStatus.WITHDRAWN,
                    version=3,
                    consent_version="c1a-2026-08-24",
                    adult_confirmed_at=current_applied,
                    risk_confirmed_at=current_applied,
                    applied_at=current_applied,
                    decided_at=current_waitlisted,
                    decided_by_user_id=current.game.order.user_id,
                    withdrawn_at=current_waitlisted + timedelta(minutes=2),
                    withdrawal_kind=(
                        OpenGameRegistrationWithdrawalKind.WAITLIST_WITHDRAWAL
                    ),
                    late_exit_recorded=False,
                    waitlist_seq=5,
                    waitlisted_at=current_waitlisted,
                ),
            )
        )
        session.commit()

        page = _service(session).list_my_applications(
            applicant_user_id=applicant_id,
            limit=20,
            cursor=None,
        )

    items = {item.id: item for item in page.items}
    assert items[current_id].waitlist_position == 2
    assert items[current_id].waitlisted_at == current_waitlisted
    assert items[current_id].promoted_at is None
    assert items[promoted_id].waitlist_position is None
    assert items[promoted_id].waitlisted_at == promoted_waitlisted
    assert items[promoted_id].promoted_at == promoted_at
    assert items[withdrawn_id].waitlist_position is None
    assert items[withdrawn_id].waitlisted_at == withdrawn_waitlisted
    assert items[withdrawn_id].promoted_at is None
    assert "waitlist_seq" not in json.dumps(page.model_dump(mode="json"))


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
    last_item = a_first.items[-1].model_dump(mode="json")
    assert decoded == {
        "v": 1,
        "applied_at": last_item["applied_at"],
        "id": last_item["id"],
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
            registration_status=(
                OpenGameRegistrationStatus.WAITLISTED
                if index == 0
                else OpenGameRegistrationStatus.APPLIED
            ),
            waitlist_seq=1 if index == 0 else None,
            waitlisted_at=(NOW + timedelta(minutes=1) if index == 0 else None),
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
    assert page.items[0].waitlist_position == 1
    assert len(statements) <= 4


def test_corrected_attendance_readback_is_one_grouped_query_and_stays_private(
    pg_engine: Engine,
) -> None:
    applicant_id = _new_user(pg_engine, "corrected-readback")
    registration_ids = [
        _seed_application(
            pg_engine,
            applicant_user_id=applicant_id,
            label=f"纠正回读{index}",
            applied_at=NOW - timedelta(minutes=index),
            registration_status=OpenGameRegistrationStatus.JOINED,
            starts_at=NOW - timedelta(days=2),
        )
        for index in range(3)
    ]
    corrected_times = [NOW - timedelta(hours=3), NOW - timedelta(hours=2)]
    with Session(pg_engine) as session:
        for index, registration_id in enumerate(registration_ids):
            registration = session.get_one(OpenGameRegistration, registration_id)
            order = registration.game.order
            starts_at = order.slot.starts_at
            ends_at = order.slot.ends_at
            owner_id = order.user_id
            order.checked_in_at = starts_at
            order.checked_in_by_user_id = order.user_id
            order.completed_at = ends_at
            order.completed_by_user_id = owner_id
            order.status = OrderStatus.COMPLETED
            registration.attendance_status = (
                OpenGameAttendanceStatus.NO_SHOW
                if index < 2
                else OpenGameAttendanceStatus.PRESENT
            )
            registration.attendance_recorded_at = ends_at
            registration.attendance_recorded_by_user_id = owner_id
            registration.version = 4 if index < 2 else 3
            if index < 2:
                session.add(
                    OpenGameAttendanceCorrection(
                        registration_id=registration.id,
                        from_status=OpenGameAttendanceStatus.PRESENT,
                        to_status=OpenGameAttendanceStatus.NO_SHOW,
                        reason="线下核实后纠正",
                        corrected_by_principal_id="platform-admin:readback-test",
                        corrected_at=corrected_times[index],
                        registration_version_before=3,
                        registration_version_after=4,
                        idempotency_key=f"readback-correction-key-{index:02d}",
                        request_sha256=f"{index + 1:064x}",
                    )
                )
        session.commit()

    correction_selects: list[str] = []

    def record_statement(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: object,
    ) -> None:
        if (
            statement.lstrip().upper().startswith("SELECT")
            and "open_game_attendance_corrections" in statement
        ):
            correction_selects.append(statement)

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

    by_id = {item.id: item for item in page.items}
    assert by_id[registration_ids[0]].attendance_corrected_at == corrected_times[0]
    assert by_id[registration_ids[1]].attendance_corrected_at == corrected_times[1]
    assert by_id[registration_ids[2]].attendance_corrected_at is None
    assert len(correction_selects) == 1
    dumped = page.model_dump(mode="json")
    assert all(set(item) == ITEM_FIELDS for item in dumped["items"])
    serialized = json.dumps(dumped, ensure_ascii=False)
    for forbidden in ("线下核实后纠正", "platform-admin", "corrections"):
        assert forbidden not in serialized
