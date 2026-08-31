import hashlib
import json
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from functools import partial
from typing import Literal

import pytest
from sqlalchemy import Engine, event, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from backend.app.errors import AppError
from backend.app.models import (
    IdempotencyRecord,
    OpenGame,
    OpenGameAttendanceCorrection,
    OpenGameAttendanceStatus,
    OpenGameRegistration,
    OpenGameRegistrationPosition,
    OpenGameRegistrationStatus,
    Order,
    OrderStatus,
    VenueMembership,
)
from backend.app.modules.open_game_registrations import service as service_module
from backend.app.modules.open_game_registrations.dto import (
    OpenGameAttendanceMarkRequest,
)
from backend.app.modules.open_game_registrations.privacy import (
    ATTENDANCE_ROSTER_ITEM_FIELDS,
)
from backend.app.modules.orders.repository import OrderRepository
from backend.tests.test_open_game_registration_service import (
    SeededRegistrationCase,
    _add_registration,
    _new_user,
    _seed_published_game,
    _service,
)
from backend.tests.test_open_game_service import NOW

pytestmark = pytest.mark.integration

ATTENDANCE_KEY = "mark-open-game-attendance-key-000001"
SECOND_ATTENDANCE_KEY = "mark-open-game-attendance-key-000002"
ATTENDANCE_NOW = datetime(2026, 8, 27, 12, tzinfo=UTC)


@dataclass(frozen=True, slots=True)
class AttendanceCase:
    game: SeededRegistrationCase
    owner_id: uuid.UUID
    joined_ids: tuple[uuid.UUID, ...]
    excluded_id: uuid.UUID | None = None


def _seed_completed_attendance_game(
    engine: Engine,
    *,
    joined_count: int = 1,
    include_excluded: bool = False,
    owner_user_id: uuid.UUID | None = None,
) -> AttendanceCase:
    case = _seed_published_game(engine, share_token=uuid.uuid4().hex)
    joined_ids: list[uuid.UUID] = []
    excluded_id: uuid.UUID | None = None
    with Session(engine) as session:
        users = [
            _new_user(session, f"attendance-{index}")
            for index in range(joined_count)
        ]
        for index in range(joined_count):
            row = _add_registration(
                session,
                game_id=case.game_id,
                applicant_user_id=users[index].id,
                status=OpenGameRegistrationStatus.JOINED,
                decided_by_user_id=case.booking.owner_id,
                display_name=f"到场球员{index + 1}",
                position=(
                    OpenGameRegistrationPosition.FORWARD
                    if index % 2 == 0
                    else OpenGameRegistrationPosition.DEFENDER
                ),
                note="不得出现在名单响应中的备注",
                applied_at=NOW - timedelta(minutes=20 - index),
            )
            joined_ids.append(row.id)
        if include_excluded:
            excluded_user = _new_user(session, "attendance-excluded")
            excluded = _add_registration(
                session,
                game_id=case.game_id,
                applicant_user_id=excluded_user.id,
                status=OpenGameRegistrationStatus.APPLIED,
                display_name="待审核球员",
                note="私密备注",
            )
            excluded_id = excluded.id
        owner_id = owner_user_id or case.booking.owner_id
        order = session.get_one(Order, case.booking.order_id)
        fulfillment_actor = _new_user(session, "attendance-fulfillment")
        session.add(
            VenueMembership(
                venue_id=order.slot.pitch.venue_id,
                user_id=fulfillment_actor.id,
                is_active=True,
                can_manage_inventory=True,
            )
        )
        order.user_id = owner_id
        order.status = OrderStatus.COMPLETED
        order.checked_in_at = case.booking.starts_at
        order.checked_in_by_user_id = fulfillment_actor.id
        order.completed_at = case.booking.ends_at
        order.completed_by_user_id = fulfillment_actor.id
        session.commit()
    return AttendanceCase(case, owner_id, tuple(joined_ids), excluded_id)


def _mark_request(
    status: Literal[
        OpenGameAttendanceStatus.PRESENT,
        OpenGameAttendanceStatus.NO_SHOW,
    ] = OpenGameAttendanceStatus.PRESENT,
    *,
    expected_version: int = 2,
) -> OpenGameAttendanceMarkRequest:
    return OpenGameAttendanceMarkRequest(
        attendance_status=status,
        expected_version=expected_version,
    )


def _assert_error(
    operation: Callable[[], object],
    *,
    status: int,
    code: str,
) -> None:
    with pytest.raises(AppError) as captured:
        operation()
    assert (captured.value.status_code, captured.value.code) == (status, code)


def test_owner_roster_is_joined_only_stably_sorted_minimal_and_empty_complete(
    pg_engine: Engine,
) -> None:
    populated = _seed_completed_attendance_game(
        pg_engine,
        joined_count=2,
        include_excluded=True,
    )
    empty = _seed_completed_attendance_game(pg_engine, joined_count=0)

    with Session(pg_engine) as session:
        same_applied_at = NOW - timedelta(minutes=20)
        for registration_id in populated.joined_ids:
            session.get_one(OpenGameRegistration, registration_id).applied_at = (
                same_applied_at
            )
        session.commit()
        roster = _service(session, now=ATTENDANCE_NOW).get_attendance_roster(
            game_id=populated.game.game_id,
            owner_user_id=populated.owner_id,
        )
        dumped = roster.model_dump(mode="json")
        assert dumped["game"] == {
            "id": str(populated.game.game_id),
            "name": "历史球局",
            "venue_name": "浦东星跃足球公园",
            "pitch_name": "五人制 A 场",
            "starts_at": populated.game.booking.starts_at.isoformat().replace(
                "+00:00", "Z"
            ),
            "ends_at": populated.game.booking.ends_at.isoformat().replace(
                "+00:00", "Z"
            ),
            "time_zone": "Asia/Shanghai",
            "state": "COMPLETED",
        }
        assert [item["registration_id"] for item in dumped["registrations"]] == [
            str(item) for item in sorted(populated.joined_ids)
        ]
        assert dumped["total_count"] == 2
        assert dumped["recorded_count"] == 0
        assert dumped["attendance_complete"] is False
        assert all(
            set(item) == ATTENDANCE_ROSTER_ITEM_FIELDS
            for item in dumped["registrations"]
        )
        serialized = json.dumps(dumped, ensure_ascii=False)
        assert str(populated.excluded_id) not in serialized
        for private_field in (
            "note",
            "applicant_user_id",
            "attendance_recorded_by_user_id",
            "adult_confirmed_at",
            "risk_confirmed_at",
        ):
            assert private_field not in serialized

        empty_roster = _service(session, now=ATTENDANCE_NOW).get_attendance_roster(
            game_id=empty.game.game_id,
            owner_user_id=empty.owner_id,
        )
        assert empty_roster.registrations == ()
        assert empty_roster.total_count == empty_roster.recorded_count == 0
        assert empty_roster.attendance_complete is True


def test_owner_roster_batches_latest_correction_without_leaking_platform_audit(
    pg_engine: Engine,
) -> None:
    seeded = _seed_completed_attendance_game(pg_engine, joined_count=3)
    corrected_at = ATTENDANCE_NOW + timedelta(hours=1)
    recorded_at = ATTENDANCE_NOW - timedelta(minutes=2)
    first_id = seeded.joined_ids[0]
    second_id = seeded.joined_ids[1]
    with Session(pg_engine) as session:
        first = session.get_one(OpenGameRegistration, first_id)
        first.attendance_status = OpenGameAttendanceStatus.NO_SHOW
        first.attendance_recorded_at = recorded_at
        first.attendance_recorded_by_user_id = seeded.owner_id
        first.version = 4
        second = session.get_one(OpenGameRegistration, second_id)
        second.attendance_status = OpenGameAttendanceStatus.PRESENT
        second.attendance_recorded_at = recorded_at
        second.attendance_recorded_by_user_id = seeded.owner_id
        second.version = 3
        session.add(
            OpenGameAttendanceCorrection(
                registration_id=first.id,
                from_status=OpenGameAttendanceStatus.PRESENT,
                to_status=OpenGameAttendanceStatus.NO_SHOW,
                reason="平台线下核实",
                corrected_by_principal_id="platform-admin:captain-readback",
                corrected_at=corrected_at,
                registration_version_before=3,
                registration_version_after=4,
                idempotency_key="captain-readback-correction-0001",
                request_sha256="a" * 64,
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
            roster = _service(session, now=corrected_at).get_attendance_roster(
                game_id=seeded.game.game_id,
                owner_user_id=seeded.owner_id,
            )
    finally:
        event.remove(pg_engine, "before_cursor_execute", record_statement)

    by_id = {item.registration_id: item for item in roster.registrations}
    assert by_id[first_id].attendance_status == OpenGameAttendanceStatus.NO_SHOW
    assert by_id[first_id].attendance_recorded_at == recorded_at
    assert by_id[first_id].attendance_corrected_at == corrected_at
    assert by_id[second_id].attendance_corrected_at is None
    assert len(correction_selects) == 1
    serialized = json.dumps(roster.model_dump(mode="json"), ensure_ascii=False)
    for forbidden in ("平台线下核实", "platform-admin", "reason", "principal"):
        assert forbidden not in serialized


def test_roster_hides_missing_and_non_owned_games_and_requires_completed_state(
    pg_engine: Engine,
) -> None:
    completed = _seed_completed_attendance_game(pg_engine)
    published = _seed_published_game(pg_engine, share_token="S" * 32)

    with Session(pg_engine) as session:
        service = _service(session, now=ATTENDANCE_NOW)
        for game_id, user_id in (
            (uuid.uuid4(), completed.owner_id),
            (completed.game.game_id, completed.game.booking.stranger_id),
        ):
            _assert_error(
                partial(
                    service.get_attendance_roster,
                    game_id=game_id,
                    owner_user_id=user_id,
                ),
                status=404,
                code="OPEN_GAME_NOT_FOUND",
            )
        _assert_error(
            lambda: service.get_attendance_roster(
            game_id=published.game_id,
                owner_user_id=published.booking.owner_id,
            ),
            status=409,
            code="ATTENDANCE_STATE_CHANGED",
        )


def test_mark_attendance_is_atomic_minimal_and_strictly_idempotent(
    pg_engine: Engine,
) -> None:
    seeded = _seed_completed_attendance_game(pg_engine, joined_count=2)
    other_game = _seed_completed_attendance_game(
        pg_engine,
        owner_user_id=seeded.owner_id,
    )
    target_id = seeded.joined_ids[0]
    with Session(pg_engine) as session:
        game_before = session.get_one(OpenGame, seeded.game.game_id)
        order_before = session.get_one(Order, seeded.game.booking.order_id)
        registration_before = session.get_one(OpenGameRegistration, target_id)
        invariant = (
            game_before.status,
            game_before.open_spots,
            order_before.status,
            registration_before.status,
            registration_before.waitlist_seq,
        )
        service = _service(session, now=ATTENDANCE_NOW)
        request = _mark_request()
        result = service.mark_attendance(
            game_id=seeded.game.game_id,
            registration_id=target_id,
            owner_user_id=seeded.owner_id,
            idempotency_key=ATTENDANCE_KEY,
            request=request,
        )
        assert result.model_dump(mode="json") == {
            "registration_id": str(target_id),
            "attendance_status": "PRESENT",
            "attendance_recorded_at": ATTENDANCE_NOW.isoformat().replace(
                "+00:00", "Z"
            ),
            "version": 3,
            "recorded_count": 1,
            "total_count": 2,
            "attendance_complete": False,
        }

        row = session.get_one(OpenGameRegistration, target_id)
        persisted_order = session.get_one(Order, seeded.game.booking.order_id)
        assert row.attendance_status is OpenGameAttendanceStatus.PRESENT
        assert row.attendance_recorded_at == ATTENDANCE_NOW
        assert row.attendance_recorded_by_user_id == persisted_order.user_id
        assert row.attendance_recorded_by_user_id == seeded.owner_id
        assert (
            row.attendance_recorded_by_user_id
            != persisted_order.completed_by_user_id
        )
        assert persisted_order.completed_at is not None
        assert persisted_order.completed_at >= seeded.game.booking.ends_at
        assert row.version == 3
        assert (
            session.get_one(OpenGame, seeded.game.game_id).status,
            session.get_one(OpenGame, seeded.game.game_id).open_spots,
            session.get_one(Order, seeded.game.booking.order_id).status,
            row.status,
            row.waitlist_seq,
        ) == invariant

        replay = service.mark_attendance(
            game_id=seeded.game.game_id,
            registration_id=target_id,
            owner_user_id=seeded.owner_id,
            idempotency_key=ATTENDANCE_KEY,
            request=request,
        )
        assert replay == result
        record = session.scalar(
            select(IdempotencyRecord).where(
                IdempotencyRecord.user_id == seeded.owner_id,
                IdempotencyRecord.operation == "MARK_OPEN_GAME_ATTENDANCE",
                IdempotencyRecord.key == ATTENDANCE_KEY,
            )
        )
        assert record is not None
        expected_payload = {
            "operation": "MARK_OPEN_GAME_ATTENDANCE",
            "game_id": str(seeded.game.game_id),
            "registration_id": str(target_id),
            "attendance_status": "PRESENT",
            "expected_version": 2,
            "version": 1,
        }
        expected_digest = hashlib.sha256(
            json.dumps(
                expected_payload,
                sort_keys=True,
                separators=(",", ":"),
            ).encode()
        ).hexdigest()
        assert record.request_sha256 == expected_digest

        for changed_request in (
            _mark_request(OpenGameAttendanceStatus.NO_SHOW),
            _mark_request(expected_version=3),
        ):
            _assert_error(
                partial(
                    service.mark_attendance,
                    game_id=seeded.game.game_id,
                    registration_id=target_id,
                    owner_user_id=seeded.owner_id,
                    idempotency_key=ATTENDANCE_KEY,
                    request=changed_request,
                ),
                status=409,
                code="IDEMPOTENCY_KEY_REUSED",
            )
        for changed_game_id, changed_registration_id in (
            (seeded.game.game_id, seeded.joined_ids[1]),
            (other_game.game.game_id, other_game.joined_ids[0]),
        ):
            _assert_error(
                partial(
                    service.mark_attendance,
                    game_id=changed_game_id,
                    registration_id=changed_registration_id,
                    owner_user_id=seeded.owner_id,
                    idempotency_key=ATTENDANCE_KEY,
                    request=request,
                ),
                status=409,
                code="IDEMPOTENCY_KEY_REUSED",
            )


def test_attendance_replay_preserves_saved_result_after_other_rows_are_marked(
    pg_engine: Engine,
) -> None:
    seeded = _seed_completed_attendance_game(pg_engine, joined_count=2)
    first_id, second_id = seeded.joined_ids
    request = _mark_request()

    with Session(pg_engine) as session:
        service = _service(session, now=ATTENDANCE_NOW)
        first = service.mark_attendance(
            game_id=seeded.game.game_id,
            registration_id=first_id,
            owner_user_id=seeded.owner_id,
            idempotency_key=ATTENDANCE_KEY,
            request=request,
        )
        second = service.mark_attendance(
            game_id=seeded.game.game_id,
            registration_id=second_id,
            owner_user_id=seeded.owner_id,
            idempotency_key=SECOND_ATTENDANCE_KEY,
            request=request,
        )

        assert first.recorded_count == 1
        assert first.attendance_complete is False
        assert second.recorded_count == 2
        assert second.attendance_complete is True

        replay = service.mark_attendance(
            game_id=seeded.game.game_id,
            registration_id=first_id,
            owner_user_id=seeded.owner_id,
            idempotency_key=ATTENDANCE_KEY,
            request=request,
        )

        assert replay == first


def test_attendance_digest_covers_every_command_dimension() -> None:
    game_id = uuid.uuid4()
    registration_id = uuid.uuid4()
    request = _mark_request()
    baseline = service_module._attendance_request_digest(
        operation="MARK_OPEN_GAME_ATTENDANCE",
        game_id=game_id,
        registration_id=registration_id,
        request=request,
    )
    variants = (
        ("other-operation", game_id, registration_id, request),
        ("MARK_OPEN_GAME_ATTENDANCE", uuid.uuid4(), registration_id, request),
        ("MARK_OPEN_GAME_ATTENDANCE", game_id, uuid.uuid4(), request),
        (
            "MARK_OPEN_GAME_ATTENDANCE",
            game_id,
            registration_id,
            _mark_request(OpenGameAttendanceStatus.NO_SHOW),
        ),
        (
            "MARK_OPEN_GAME_ATTENDANCE",
            game_id,
            registration_id,
            _mark_request(expected_version=3),
        ),
    )
    assert all(
        service_module._attendance_request_digest(
            operation=operation,
            game_id=variant_game_id,
            registration_id=variant_registration_id,
            request=variant_request,
        )
        != baseline
        for operation, variant_game_id, variant_registration_id, variant_request in variants
    )


def test_mark_attendance_rolls_back_row_and_idempotency_after_completion_flush(
    pg_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seeded = _seed_completed_attendance_game(pg_engine)
    target_id = seeded.joined_ids[0]
    with Session(pg_engine) as session:
        order_repository = OrderRepository(session)
        complete = order_repository.complete_idempotency

        def fail_after_completion_flush(
            record: IdempotencyRecord,
            *,
            response_status: int,
            response_body: dict[str, object],
        ) -> None:
            complete(
                record,
                response_status=response_status,
                response_body=response_body,
            )
            raise SQLAlchemyError("injected after completion flush")

        monkeypatch.setattr(
            order_repository,
            "complete_idempotency",
            fail_after_completion_flush,
        )
        service = _service(
            session,
            now=ATTENDANCE_NOW,
            order_repository=order_repository,
        )

        _assert_error(
            lambda: service.mark_attendance(
                game_id=seeded.game.game_id,
                registration_id=target_id,
                owner_user_id=seeded.owner_id,
                idempotency_key=ATTENDANCE_KEY,
                request=_mark_request(),
            ),
            status=503,
            code="SERVICE_UNAVAILABLE",
        )

        row = session.get_one(OpenGameRegistration, target_id)
        assert row.attendance_status is OpenGameAttendanceStatus.UNMARKED
        assert row.attendance_recorded_at is None
        assert row.attendance_recorded_by_user_id is None
        assert row.version == 2
        assert session.scalar(select(IdempotencyRecord)) is None


@pytest.mark.parametrize("condition", ["state", "status", "version", "result"])
def test_mark_or_replay_rejects_changed_authoritative_state(
    pg_engine: Engine,
    condition: str,
) -> None:
    seeded = _seed_completed_attendance_game(pg_engine)
    target_id = seeded.joined_ids[0]
    with Session(pg_engine) as session:
        service = _service(session, now=ATTENDANCE_NOW)
        request = _mark_request()
        if condition in {"result", "state"}:
            service.mark_attendance(
                game_id=seeded.game.game_id,
                registration_id=target_id,
                owner_user_id=seeded.owner_id,
                idempotency_key=ATTENDANCE_KEY,
                request=request,
            )
        row = session.get_one(OpenGameRegistration, target_id)
        if condition == "state":
            order = session.get_one(Order, seeded.game.booking.order_id)
            order.status = OrderStatus.CONFIRMED
            order.checked_in_at = None
            order.checked_in_by_user_id = None
            order.completed_at = None
            order.completed_by_user_id = None
        elif condition == "status":
            row.status = OpenGameRegistrationStatus.REJECTED
        elif condition == "version":
            row.version += 1
        elif condition == "result":
            row.attendance_status = OpenGameAttendanceStatus.NO_SHOW
        session.commit()

        _assert_error(
            lambda: _service(session, now=ATTENDANCE_NOW).mark_attendance(
                game_id=seeded.game.game_id,
                registration_id=target_id,
                owner_user_id=seeded.owner_id,
                idempotency_key=ATTENDANCE_KEY,
                request=request,
            ),
            status=409,
            code="ATTENDANCE_STATE_CHANGED",
        )
