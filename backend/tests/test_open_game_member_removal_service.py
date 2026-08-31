import json
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier

import pytest
from sqlalchemy import Engine, create_engine, func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool

from backend.app.errors import AppError
from backend.app.models import (
    IdempotencyRecord,
    OpenGame,
    OpenGameAttendanceStatus,
    OpenGameMemberRemoval,
    OpenGameNotificationEvent,
    OpenGameNotificationOutbox,
    OpenGameRegistration,
    OpenGameRegistrationPosition,
    OpenGameRegistrationStatus,
    Order,
    OrderStatus,
)
from backend.app.modules.open_game_registrations.dto import (
    OpenGameMemberRemovalRequest,
)
from backend.app.modules.open_game_registrations.privacy import (
    MEMBER_ROSTER_ITEM_FIELDS,
)
from backend.app.modules.open_game_registrations.repository import (
    OpenGameRegistrationRepository,
)
from backend.app.modules.open_game_registrations.service import (
    REMOVE_OPEN_GAME_MEMBER_OPERATION,
    _member_removal_request_digest,
)
from backend.app.modules.orders.repository import OrderRepository
from backend.tests.test_open_game_registration_service import (
    _add_registration,
    _new_user,
    _seed_published_game,
    _service,
)
from backend.tests.test_open_game_service import NOW

pytestmark = pytest.mark.integration

REMOVAL_KEY = "remove-open-game-member-key-000001"


def _request(
    *, expected_version: int = 2, reason: str = "临时无法联系到队员"
) -> OpenGameMemberRemovalRequest:
    return OpenGameMemberRemovalRequest(
        expected_version=expected_version,
        reason=reason,
    )


def test_owner_member_roster_is_joined_only_stable_private_and_current(
    pg_engine: Engine,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        promoted_user = _new_user(session, "member-roster-promoted")
        direct_user = _new_user(session, "member-roster-direct")
        excluded_user = _new_user(session, "member-roster-excluded")
        promoted = _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=promoted_user.id,
            status=OpenGameRegistrationStatus.JOINED,
            decided_by_user_id=case.booking.owner_id,
            display_name="候补小翼",
            position=OpenGameRegistrationPosition.FORWARD,
            applied_at=NOW - timedelta(minutes=20),
            waitlist_seq=3,
            waitlisted_at=NOW - timedelta(minutes=10),
            promoted_at=NOW - timedelta(minutes=5),
            version=3,
        )
        direct = _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=direct_user.id,
            status=OpenGameRegistrationStatus.JOINED,
            decided_by_user_id=case.booking.owner_id,
            display_name="直接加入",
            position=OpenGameRegistrationPosition.DEFENDER,
            applied_at=NOW - timedelta(minutes=20),
        )
        _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=excluded_user.id,
            status=OpenGameRegistrationStatus.WAITLISTED,
            decided_by_user_id=case.booking.owner_id,
            display_name="候补隐私",
            note="绝不能泄漏的私密说明",
            waitlist_seq=4,
            waitlisted_at=NOW - timedelta(minutes=3),
        )
        session.commit()

        roster = _service(session).get_member_roster(
            game_id=case.game_id,
            owner_user_id=case.booking.owner_id,
        )

        dumped = roster.model_dump(mode="json")
        assert dumped["joined_count"] == 2
        assert dumped["remaining_spots"] == 2
        assert dumped["waitlist_count"] == 1
        assert [item["registration_id"] for item in dumped["members"]] == [
            str(item) for item in sorted((promoted.id, direct.id))
        ]
        assert all(set(item) == MEMBER_ROSTER_ITEM_FIELDS for item in dumped["members"])
        by_id = {item["registration_id"]: item for item in dumped["members"]}
        assert by_id[str(promoted.id)]["promoted_from_waitlist"] is True
        assert by_id[str(promoted.id)]["joined_at"] == (
            NOW - timedelta(minutes=5)
        ).isoformat().replace("+00:00", "Z")
        assert all(
            item["allowed_actions"] == {"can_remove": True, "remove_blocked_reason": None}
            for item in dumped["members"]
        )
        serialized = json.dumps(dumped, ensure_ascii=False)
        assert "候补隐私" not in serialized
        assert "绝不能泄漏的私密说明" not in serialized
        for private_field in (
            "applicant_user_id",
            "note",
            "decided_by_user_id",
            "attendance_recorded_by_user_id",
            "removed_by_user_id",
        ):
            assert private_field not in serialized

        for game_id, owner_id in (
            (case.game_id, case.booking.stranger_id),
            (uuid.uuid4(), case.booking.owner_id),
        ):
            with pytest.raises(AppError) as hidden:
                _service(session).get_member_roster(
                    game_id=game_id,
                    owner_user_id=owner_id,
                )
            assert (hidden.value.status_code, hidden.value.code) == (
                404,
                "OPEN_GAME_NOT_FOUND",
            )


def test_nonfull_member_removal_is_terminal_audited_idempotent_and_does_not_promote(
    pg_engine: Engine,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        target_user = _new_user(session, "member-remove-target")
        target = _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=target_user.id,
            status=OpenGameRegistrationStatus.JOINED,
            decided_by_user_id=case.booking.owner_id,
            display_name="待移除队员",
        )
        candidate_user = _new_user(session, "member-remove-nonfull-waitlist")
        candidate = _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=candidate_user.id,
            status=OpenGameRegistrationStatus.WAITLISTED,
            decided_by_user_id=case.booking.owner_id,
            waitlist_seq=1,
            waitlisted_at=NOW - timedelta(minutes=5),
        )
        session.commit()
        service = _service(session)

        first = service.remove_member(
            game_id=case.game_id,
            registration_id=target.id,
            owner_user_id=case.booking.owner_id,
            idempotency_key=REMOVAL_KEY,
            request=_request(reason="  临时无法联系到队员  "),
        )
        replay = service.remove_member(
            game_id=case.game_id,
            registration_id=target.id,
            owner_user_id=case.booking.owner_id,
            idempotency_key=REMOVAL_KEY,
            request=_request(),
        )

        assert replay == first
        assert first.model_dump(mode="json") == {
            "removed_registration_id": str(target.id),
            "removed_display_name": "待移除队员",
            "status": "REMOVED",
            "version": 3,
            "removed_at": NOW.isoformat().replace("+00:00", "Z"),
            "joined_count": 0,
            "remaining_spots": 4,
            "waitlist_count": 1,
            "promoted_member": None,
        }
        persisted = session.get_one(OpenGameRegistration, target.id)
        assert persisted.status is OpenGameRegistrationStatus.REMOVED
        assert persisted.version == 3
        assert persisted.removed_at == NOW
        assert persisted.removed_by_user_id == case.booking.owner_id
        assert (
            session.get_one(OpenGameRegistration, candidate.id).status
            is OpenGameRegistrationStatus.WAITLISTED
        )
        audit = session.scalar(select(OpenGameMemberRemoval))
        assert audit is not None
        assert audit.registration_id == target.id
        assert audit.game_id == case.game_id
        assert audit.order_id == case.booking.order_id
        assert audit.removed_by_user_id == case.booking.owner_id
        assert audit.reason == "临时无法联系到队员"
        assert (audit.registration_version_before, audit.registration_version_after) == (2, 3)
        assert audit.promoted_registration_id is None
        assert audit.idempotency_key == REMOVAL_KEY
        assert session.scalar(select(func.count()).select_from(OpenGameNotificationOutbox)) == 0
        records = tuple(session.scalars(select(IdempotencyRecord)))
        assert len(records) == 1
        assert records[0].operation == REMOVE_OPEN_GAME_MEMBER_OPERATION
        assert records[0].response_body == first.model_dump(mode="json")

        context = service.get_context(
            share_token=case.share_token,
            viewer_user_id=target_user.id,
        )
        assert context.viewer_registration is not None
        assert context.viewer_registration.persisted_status == "REMOVED"
        assert context.viewer_registration.effective_status == "REMOVED"
        assert context.viewer_registration.removed_at == NOW
        roster = service.get_member_roster(
            game_id=case.game_id,
            owner_user_id=case.booking.owner_id,
        )
        assert all(member.registration_id != target.id for member in roster.members)

        with pytest.raises(AppError) as reused:
            service.remove_member(
                game_id=case.game_id,
                registration_id=target.id,
                owner_user_id=case.booking.owner_id,
                idempotency_key=REMOVAL_KEY,
                request=_request(reason="已经更换的原因"),
            )
        assert (reused.value.status_code, reused.value.code) == (
            409,
            "IDEMPOTENCY_KEY_REUSED",
        )


def test_full_member_removal_promotes_only_fifo_head_and_notifies_only_promoted_member(
    pg_engine: Engine,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        game = session.get_one(OpenGame, case.game_id)
        game.open_spots = 1
        target_user = _new_user(session, "member-full-target")
        target = _add_registration(
            session,
            game_id=game.id,
            applicant_user_id=target_user.id,
            status=OpenGameRegistrationStatus.JOINED,
            decided_by_user_id=case.booking.owner_id,
            display_name="已满待移除",
        )
        candidate_rows: list[OpenGameRegistration] = []
        candidate_users = []
        for index, sequence in enumerate((8, 2)):
            candidate_user = _new_user(session, f"member-full-candidate-{index}")
            candidate_users.append(candidate_user)
            candidate_rows.append(
                _add_registration(
                    session,
                    game_id=game.id,
                    applicant_user_id=candidate_user.id,
                    status=OpenGameRegistrationStatus.WAITLISTED,
                    decided_by_user_id=case.booking.owner_id,
                    display_name=f"候补队员{index}",
                    waitlist_seq=sequence,
                    waitlisted_at=NOW - timedelta(minutes=sequence),
                )
            )
        session.commit()

        result = _service(session).remove_member(
            game_id=game.id,
            registration_id=target.id,
            owner_user_id=case.booking.owner_id,
            idempotency_key="remove-full-member-key-000000001",
            request=_request(),
        )

        promoted = candidate_rows[1]
        waiting = candidate_rows[0]
        assert result.remaining_spots == 0
        assert result.joined_count == 1
        assert result.waitlist_count == 1
        assert result.promoted_member is not None
        assert result.promoted_member.registration_id == promoted.id
        assert result.promoted_member.version == 3
        assert (
            session.get_one(OpenGameRegistration, promoted.id).status
            is OpenGameRegistrationStatus.JOINED
        )
        assert (
            session.get_one(OpenGameRegistration, waiting.id).status
            is OpenGameRegistrationStatus.WAITLISTED
        )
        audit = session.scalar(select(OpenGameMemberRemoval))
        assert audit is not None
        assert audit.promoted_registration_id == promoted.id
        assert (
            audit.promoted_registration_version_before,
            audit.promoted_registration_version_after,
        ) == (2, 3)
        events = tuple(session.scalars(select(OpenGameNotificationOutbox)))
        assert len(events) == 1
        assert events[0].event is OpenGameNotificationEvent.WAITLIST_PROMOTED
        assert events[0].registration_id == promoted.id
        assert events[0].recipient_user_id == candidate_users[1].id
        assert events[0].recipient_user_id != target_user.id


@pytest.mark.parametrize(
    "condition", ["stale", "waitlisted", "attendance", "draft", "unhealthy", "started"]
)
def test_member_removal_rejects_ineligible_or_changed_state_atomically(
    pg_engine: Engine,
    condition: str,
) -> None:
    case = _seed_published_game(pg_engine)
    now = NOW
    with Session(pg_engine) as session:
        target_user = _new_user(session, f"member-blocked-{condition}")
        status = (
            OpenGameRegistrationStatus.WAITLISTED
            if condition == "waitlisted"
            else OpenGameRegistrationStatus.JOINED
        )
        target = _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=target_user.id,
            status=status,
            decided_by_user_id=case.booking.owner_id,
            waitlist_seq=1 if status is OpenGameRegistrationStatus.WAITLISTED else None,
            waitlisted_at=NOW - timedelta(minutes=5)
            if status is OpenGameRegistrationStatus.WAITLISTED
            else None,
            attendance_status=(
                OpenGameAttendanceStatus.PRESENT
                if condition == "attendance"
                else OpenGameAttendanceStatus.UNMARKED
            ),
            attendance_recorded_at=NOW - timedelta(minutes=1)
            if condition == "attendance"
            else None,
            attendance_recorded_by_user_id=case.booking.owner_id
            if condition == "attendance"
            else None,
        )
        game = session.get_one(OpenGame, case.game_id)
        order = session.get_one(Order, case.booking.order_id)
        if condition == "draft":
            game.status = "DRAFT"
            game.published_at = None
        elif condition == "unhealthy":
            order.status = OrderStatus.PAYMENT_EXCEPTION
        elif condition == "started":
            now = case.booking.starts_at
        session.commit()
        before_status = target.status

        with pytest.raises(AppError) as changed:
            _service(session, now=now).remove_member(
                game_id=case.game_id,
                registration_id=target.id,
                owner_user_id=case.booking.owner_id,
                idempotency_key=f"blocked-member-{condition}-key-0001",
                request=_request(expected_version=3 if condition == "stale" else 2),
            )

        assert (changed.value.status_code, changed.value.code) == (
            409,
            "APPLICATION_STATE_CHANGED",
        )
        session.expire_all()
        persisted = session.get_one(OpenGameRegistration, target.id)
        assert persisted.status is before_status
        assert persisted.removed_at is None
        assert session.scalar(select(func.count()).select_from(OpenGameMemberRemoval)) == 0
        assert session.scalar(select(func.count()).select_from(IdempotencyRecord)) == 0


def test_member_removal_digest_covers_operation_target_version_and_reason() -> None:
    game_id = uuid.uuid4()
    registration_id = uuid.uuid4()
    defaults = {
        "operation": REMOVE_OPEN_GAME_MEMBER_OPERATION,
        "game_id": game_id,
        "registration_id": registration_id,
        "request": _request(),
    }
    digest = _member_removal_request_digest(**defaults)
    for variation in (
        {"operation": "other-operation"},
        {"game_id": uuid.uuid4()},
        {"registration_id": uuid.uuid4()},
        {"request": _request(expected_version=3)},
        {"request": _request(reason="另一个原因")},
    ):
        assert _member_removal_request_digest(**(defaults | variation)) != digest


class _FailingRemovalAuditRepository(OpenGameRegistrationRepository):
    def add_member_removal(self, removal: OpenGameMemberRemoval) -> None:
        super().add_member_removal(removal)
        raise SQLAlchemyError("injected private audit failure")


class _FailingRemovalOutboxRepository(OpenGameRegistrationRepository):
    def add_notification(self, notification: OpenGameNotificationOutbox) -> None:
        super().add_notification(notification)
        raise SQLAlchemyError("injected private outbox failure")


class _FailingRemovalCompletionRepository(OrderRepository):
    def complete_idempotency(self, *args: object, **kwargs: object) -> None:
        raise SQLAlchemyError("injected private idempotency completion failure")


@pytest.mark.parametrize("failure", ["audit", "outbox", "idempotency"])
def test_member_removal_failure_rolls_back_terminal_audit_promotion_and_claim(
    pg_engine: Engine,
    failure: str,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        game = session.get_one(OpenGame, case.game_id)
        game.open_spots = 1
        target_user = _new_user(session, f"rollback-removal-target-{failure}")
        target = _add_registration(
            session,
            game_id=game.id,
            applicant_user_id=target_user.id,
            status=OpenGameRegistrationStatus.JOINED,
            decided_by_user_id=case.booking.owner_id,
        )
        candidate_user = _new_user(session, f"rollback-removal-candidate-{failure}")
        candidate = _add_registration(
            session,
            game_id=game.id,
            applicant_user_id=candidate_user.id,
            status=OpenGameRegistrationStatus.WAITLISTED,
            decided_by_user_id=case.booking.owner_id,
            waitlist_seq=1,
            waitlisted_at=NOW - timedelta(minutes=5),
        )
        session.commit()
        registration_repository: OpenGameRegistrationRepository | None = None
        order_repository: OrderRepository | None = None
        if failure == "audit":
            registration_repository = _FailingRemovalAuditRepository(session)
        elif failure == "outbox":
            registration_repository = _FailingRemovalOutboxRepository(session)
        else:
            order_repository = _FailingRemovalCompletionRepository(session)

        with pytest.raises(AppError) as unavailable:
            _service(
                session,
                registration_repository=registration_repository,
                order_repository=order_repository,
            ).remove_member(
                game_id=game.id,
                registration_id=target.id,
                owner_user_id=case.booking.owner_id,
                idempotency_key=f"rollback-member-{failure}-key-00001",
                request=_request(),
            )

        assert (unavailable.value.status_code, unavailable.value.code) == (
            503,
            "SERVICE_UNAVAILABLE",
        )
        session.expire_all()
        persisted_target = session.get_one(OpenGameRegistration, target.id)
        persisted_candidate = session.get_one(OpenGameRegistration, candidate.id)
        assert persisted_target.status is OpenGameRegistrationStatus.JOINED
        assert persisted_target.version == 2
        assert persisted_target.removed_at is None
        assert persisted_candidate.status is OpenGameRegistrationStatus.WAITLISTED
        assert persisted_candidate.version == 2
        assert session.scalar(select(func.count()).select_from(OpenGameMemberRemoval)) == 0
        assert session.scalar(select(func.count()).select_from(OpenGameNotificationOutbox)) == 0
        assert session.scalar(select(func.count()).select_from(IdempotencyRecord)) == 0


def test_concurrent_different_keys_remove_and_promote_exactly_once(
    pg_engine: Engine,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        game = session.get_one(OpenGame, case.game_id)
        game.open_spots = 1
        target_user = _new_user(session, "concurrent-removal-target")
        target = _add_registration(
            session,
            game_id=game.id,
            applicant_user_id=target_user.id,
            status=OpenGameRegistrationStatus.JOINED,
            decided_by_user_id=case.booking.owner_id,
        )
        candidate_user = _new_user(session, "concurrent-removal-candidate")
        candidate = _add_registration(
            session,
            game_id=game.id,
            applicant_user_id=candidate_user.id,
            status=OpenGameRegistrationStatus.WAITLISTED,
            decided_by_user_id=case.booking.owner_id,
            waitlist_seq=1,
            waitlisted_at=NOW - timedelta(minutes=5),
        )
        session.commit()
        target_id = target.id
        candidate_id = candidate.id

    barrier = Barrier(2)

    def worker(idempotency_key: str) -> str:
        worker_engine = create_engine(pg_engine.url, poolclass=NullPool)
        worker_session = Session(worker_engine)
        try:
            barrier.wait(timeout=5)
            try:
                _service(worker_session).remove_member(
                    game_id=case.game_id,
                    registration_id=target_id,
                    owner_user_id=case.booking.owner_id,
                    idempotency_key=idempotency_key,
                    request=_request(),
                )
                return "REMOVED"
            except AppError as error:
                return error.code
        finally:
            worker_session.rollback()
            worker_session.close()
            worker_engine.dispose()

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = tuple(
            executor.map(
                worker,
                (
                    "concurrent-remove-member-key-00001",
                    "concurrent-remove-member-key-00002",
                ),
            )
        )

    assert sorted(results) == ["APPLICATION_STATE_CHANGED", "REMOVED"]
    with Session(pg_engine) as session:
        assert session.get_one(OpenGameRegistration, target_id).status is (
            OpenGameRegistrationStatus.REMOVED
        )
        assert session.get_one(OpenGameRegistration, candidate_id).status is (
            OpenGameRegistrationStatus.JOINED
        )
        assert session.scalar(select(func.count()).select_from(OpenGameMemberRemoval)) == 1
        assert session.scalar(select(func.count()).select_from(OpenGameNotificationOutbox)) == 1
        assert session.scalar(select(func.count()).select_from(IdempotencyRecord)) == 1
