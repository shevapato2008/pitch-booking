import hashlib
import json
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import Engine, Table, func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from backend.app.errors import AppError
from backend.app.models import (
    IdempotencyRecord,
    IdempotencyState,
    OpenGame,
    OpenGameNotificationEvent,
    OpenGameNotificationOutbox,
    OpenGameNotificationStatus,
    OpenGameRegistration,
    OpenGameRegistrationPosition,
    OpenGameRegistrationStatus,
    OpenGameRegistrationWithdrawalKind,
    OpenGameStatus,
    Order,
    OrderStatus,
    Payment,
    RefundAttempt,
    RefundCase,
    RefundCasePurpose,
    Slot,
    User,
)
from backend.app.modules.open_game_registrations.dto import (
    OPEN_GAME_REGISTRATION_CONSENT_VERSION,
    ApplicationDecision,
    CreateApplicationRequest,
    DecisionRequest,
    WithdrawalRequest,
)
from backend.app.modules.open_game_registrations.lifecycle import WithdrawalAction
from backend.app.modules.open_game_registrations.privacy import (
    CAPTAIN_APPLICATION_FIELDS,
    VIEWER_REGISTRATION_FIELDS,
)
from backend.app.modules.open_game_registrations.repository import (
    OpenGameRegistrationRepository,
)
from backend.app.modules.open_game_registrations.service import (
    CREATE_OPEN_GAME_APPLICATION_OPERATION,
    DECIDE_OPEN_GAME_APPLICATION_OPERATION,
    WITHDRAW_OPEN_GAME_APPLICATION_OPERATION,
    OpenGameRegistrationService,
    _application_request_digest,
    _decision_request_digest,
)
from backend.app.modules.open_games.privacy import PUBLIC_OPEN_GAME_FIELDS
from backend.app.modules.open_games.repository import OpenGameRepository
from backend.app.modules.orders.repository import OrderRepository
from backend.tests.test_open_game_service import (
    NOW,
    SeededOpenGameCase,
    add_stored_game,
    seed_confirmed_order,
)

pytestmark = pytest.mark.integration

SHARE_TOKEN = "R" * 32
APPLICATION_KEY = "create-open-game-application-key-000001"
DECISION_KEY = "decide-open-game-application-key-000001"
WITHDRAWAL_KEY = "withdraw-open-game-application-key-0001"


@dataclass(frozen=True, slots=True)
class SeededRegistrationCase:
    booking: SeededOpenGameCase
    game_id: uuid.UUID
    share_token: str


def _seed_published_game(
    engine: Engine,
    *,
    share_token: str = SHARE_TOKEN,
    refund_purpose: RefundCasePurpose | None = RefundCasePurpose.DUPLICATE_CHARGE,
) -> SeededRegistrationCase:
    booking = seed_confirmed_order(
        engine,
        refund_purpose=refund_purpose,
    )
    with Session(engine) as session:
        game = add_stored_game(
            session,
            seeded=booking,
            status=OpenGameStatus.PUBLISHED,
            share_token=share_token,
        )
        session.commit()
        return SeededRegistrationCase(
            booking=booking,
            game_id=game.id,
            share_token=share_token,
        )


def _request(
    *,
    display_name: str = "周末小翼",
    position: OpenGameRegistrationPosition = OpenGameRegistrationPosition.FORWARD,
    note: str | None = "可以补边路，按时到场。",
) -> CreateApplicationRequest:
    return CreateApplicationRequest(
        display_name=display_name,
        position=position,
        note=note,
        adult_confirmed=True,
        risk_confirmed=True,
    )


def _service(
    session: Session,
    *,
    now: datetime = NOW,
    registration_repository: OpenGameRegistrationRepository | None = None,
    order_repository: OrderRepository | None = None,
) -> OpenGameRegistrationService:
    return OpenGameRegistrationService(
        repository=registration_repository
        or OpenGameRegistrationRepository(session),
        open_game_repository=OpenGameRepository(session),
        order_repository=order_repository or OrderRepository(session),
        now=lambda: now,
    )


def _add_registration(
    session: Session,
    *,
    game_id: uuid.UUID,
    applicant_user_id: uuid.UUID,
    status: OpenGameRegistrationStatus,
    application_id: uuid.UUID | None = None,
    display_name: str = "周末小翼",
    position: OpenGameRegistrationPosition = OpenGameRegistrationPosition.FORWARD,
    note: str | None = "可以补边路，按时到场。",
    applied_at: datetime = NOW - timedelta(minutes=10),
    decided_by_user_id: uuid.UUID | None = None,
    version: int | None = None,
    withdrawal_kind: OpenGameRegistrationWithdrawalKind | None = None,
    withdrawn_at: datetime | None = None,
    late_exit_recorded: bool = False,
    waitlist_seq: int | None = None,
    waitlisted_at: datetime | None = None,
    promoted_at: datetime | None = None,
) -> OpenGameRegistration:
    decision_required = status in {
        OpenGameRegistrationStatus.WAITLISTED,
        OpenGameRegistrationStatus.JOINED,
        OpenGameRegistrationStatus.REJECTED,
    } or (
        status is OpenGameRegistrationStatus.WITHDRAWN
        and withdrawal_kind
        in {
            OpenGameRegistrationWithdrawalKind.WAITLIST_WITHDRAWAL,
            OpenGameRegistrationWithdrawalKind.GAME_EXIT,
        }
    )
    row = OpenGameRegistration(
        id=application_id or uuid.uuid4(),
        game_id=game_id,
        applicant_user_id=applicant_user_id,
        display_name=display_name,
        position=position,
        note=note,
        status=status,
        version=version if version is not None else (2 if decision_required else 1),
        consent_version=OPEN_GAME_REGISTRATION_CONSENT_VERSION,
        adult_confirmed_at=applied_at,
        risk_confirmed_at=applied_at,
        applied_at=applied_at,
        decided_at=(
            waitlisted_at or NOW - timedelta(minutes=5)
            if decision_required
            else None
        ),
        decided_by_user_id=decided_by_user_id if decision_required else None,
        withdrawn_at=withdrawn_at,
        withdrawal_kind=withdrawal_kind,
        late_exit_recorded=late_exit_recorded,
        waitlist_seq=waitlist_seq,
        waitlisted_at=waitlisted_at,
        promoted_at=promoted_at,
    )
    session.add(row)
    session.flush()
    return row


def _new_user(session: Session, label: str) -> User:
    user = User(
        wechat_app_id="wx-open-game-registration-test",
        wechat_openid=f"registration-{label}-{uuid.uuid4()}",
    )
    session.add(user)
    session.flush()
    return user


def _table_rows(
    session: Session,
    table: Table,
) -> tuple[tuple[tuple[str, object], ...], ...]:
    rows = session.execute(select(table).order_by(table.c.id)).mappings()
    return tuple(tuple(row.items()) for row in rows)


def _b1_snapshot(
    session: Session,
) -> dict[str, tuple[tuple[tuple[str, object], ...], ...]]:
    tables = (
        Order.__table__,
        Slot.__table__,
        Payment.__table__,
        RefundCase.__table__,
        RefundAttempt.__table__,
    )
    return {table.name: _table_rows(session, table) for table in tables}


def _c1a_snapshot(
    session: Session,
) -> dict[str, tuple[tuple[tuple[str, object], ...], ...]]:
    tables = (
        OpenGameRegistration.__table__,
        OpenGameNotificationOutbox.__table__,
        IdempotencyRecord.__table__,
    )
    return {table.name: _table_rows(session, table) for table in tables}


def _decision(
    decision: ApplicationDecision,
    *,
    expected_version: int = 1,
) -> DecisionRequest:
    return DecisionRequest(
        decision=decision,
        expected_version=expected_version,
    )


def test_unknown_write_commands_are_rejected_before_repository_or_transaction_work(
    pg_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with Session(pg_engine) as session:
        service = _service(session)

        def unexpected(*_args: object, **_kwargs: object) -> None:
            raise AssertionError("future write command reached repository work")

        monkeypatch.setattr(service._open_game_repository, "locate_order_id", unexpected)
        monkeypatch.setattr(service._repository, "locate_withdrawal_target", unexpected)
        monkeypatch.setattr(service._repository, "rollback", unexpected)

        operations = (
            lambda: service.decide(
                game_id=uuid.uuid4(),
                application_id=uuid.uuid4(),
                owner_user_id=uuid.uuid4(),
                idempotency_key=DECISION_KEY,
                request=DecisionRequest.model_construct(
                    decision="PROMOTE_FROM_WAITLIST",
                    expected_version=1,
                ),
            ),
            lambda: service.withdraw(
                application_id=uuid.uuid4(),
                applicant_user_id=uuid.uuid4(),
                idempotency_key=WITHDRAWAL_KEY,
                request=WithdrawalRequest.model_construct(
                    action="AUTO",
                    expected_version=1,
                ),
            ),
        )
        for operation in operations:
            with pytest.raises(AppError) as rejected:
                operation()
            assert (rejected.value.status_code, rejected.value.code) == (
                422,
                "INVALID_ARGUMENT",
            )


def _withdrawal(
    action: WithdrawalAction,
    *,
    expected_version: int,
) -> WithdrawalRequest:
    return WithdrawalRequest(action=action, expected_version=expected_version)


def _assert_context_privacy(context: Any) -> None:
    dumped = context.model_dump(mode="json")
    assert set(dumped) == {
        "game",
        "remaining_spots",
        "viewer_authenticated",
        "viewer_registration",
        "allowed_actions",
    }
    assert set(dumped["game"]) == PUBLIC_OPEN_GAME_FIELDS
    if dumped["viewer_registration"] is not None:
        assert set(dumped["viewer_registration"]) == VIEWER_REGISTRATION_FIELDS
    serialized = json.dumps(dumped, ensure_ascii=False)
    for private_key in (
        "applicant_user_id",
        "decided_by_user_id",
        "consent_version",
        "adult_confirmed_at",
        "risk_confirmed_at",
        "created_at",
        "updated_at",
    ):
        assert private_key not in serialized


def _assert_queue_privacy(queue: Any) -> None:
    dumped = queue.model_dump(mode="json")
    assert set(dumped) == {
        "remaining_spots",
        "pending_count",
        "applications",
        "waitlist_count",
        "waitlist",
    }
    for application in dumped["applications"]:
        assert set(application) == CAPTAIN_APPLICATION_FIELDS
    assert dumped["waitlist_count"] == len(dumped["waitlist"])
    assert dumped["waitlist"] == []
    serialized = json.dumps(dumped, ensure_ascii=False)
    for private_key in (
        "applicant_user_id",
        "decided_by_user_id",
        "consent_version",
        "adult_confirmed_at",
        "risk_confirmed_at",
        "created_at",
        "updated_at",
    ):
        assert private_key not in serialized


def _set_review_authority(
    session: Session,
    *,
    case: SeededRegistrationCase,
    condition: str,
) -> datetime:
    game = session.get_one(OpenGame, case.game_id)
    order = session.get_one(Order, case.booking.order_id)
    if condition == "cancelled":
        game.status = OpenGameStatus.CANCELLED
        game.cancelled_at = NOW
    elif condition == "suspended":
        order.status = OrderStatus.PAYMENT_EXCEPTION
    elif condition == "completed":
        order.status = OrderStatus.COMPLETED
        order.checked_in_at = NOW
        order.checked_in_by_user_id = case.booking.owner_id
        order.completed_at = NOW
        order.completed_by_user_id = case.booking.owner_id
    elif condition == "started":
        return case.booking.starts_at
    else:
        raise AssertionError(f"unsupported review condition: {condition}")
    return NOW


def test_context_projects_viewer_blockers_and_exact_privacy(pg_engine: Engine) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        service = _service(session)
        anonymous = service.get_context(
            share_token=case.share_token,
            viewer_user_id=None,
        )
        assert anonymous.viewer_authenticated is False
        assert anonymous.viewer_registration is None
        assert anonymous.remaining_spots == 4
        assert anonymous.allowed_actions.model_dump() == {
            "can_apply": False,
            "apply_blocked_reason": "AUTH_REQUIRED",
        }
        _assert_context_privacy(anonymous)

        applicant = service.get_context(
            share_token=case.share_token,
            viewer_user_id=case.booking.stranger_id,
        )
        assert applicant.allowed_actions.model_dump() == {
            "can_apply": True,
            "apply_blocked_reason": None,
        }

        owner = service.get_context(
            share_token=case.share_token,
            viewer_user_id=case.booking.owner_id,
        )
        assert owner.allowed_actions.apply_blocked_reason == "OWNER_CANNOT_APPLY"

        _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=case.booking.stranger_id,
            status=OpenGameRegistrationStatus.REJECTED,
            decided_by_user_id=case.booking.owner_id,
        )
        session.commit()
        existing = service.get_context(
            share_token=case.share_token,
            viewer_user_id=case.booking.stranger_id,
        )
        assert existing.allowed_actions.apply_blocked_reason == "ALREADY_APPLIED"
        assert existing.viewer_registration is not None
        assert existing.viewer_registration.persisted_status == "REJECTED"
        assert existing.viewer_registration.effective_status == "REJECTED"
        _assert_context_privacy(existing)


def test_context_reads_withdrawn_audit_fields_but_keeps_write_action_closed(
    pg_engine: Engine,
) -> None:
    case = _seed_published_game(pg_engine)
    withdrawn_at = NOW - timedelta(minutes=1)
    application_id = uuid.uuid4()
    with Session(pg_engine) as session:
        _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=case.booking.stranger_id,
            application_id=application_id,
            status=OpenGameRegistrationStatus.WITHDRAWN,
            version=2,
            withdrawal_kind=(
                OpenGameRegistrationWithdrawalKind.APPLICATION_WITHDRAWAL
            ),
            withdrawn_at=withdrawn_at,
        )
        session.commit()

        context = _service(session).get_context(
            share_token=case.share_token,
            viewer_user_id=case.booking.stranger_id,
        )

    assert context.viewer_registration is not None
    assert context.viewer_registration.model_dump(mode="json") == {
        "id": str(application_id),
        "display_name": "周末小翼",
        "position": "FORWARD",
        "note": "可以补边路，按时到场。",
        "persisted_status": "WITHDRAWN",
        "effective_status": "WITHDRAWN",
        "version": 2,
        "applied_at": (NOW - timedelta(minutes=10)).isoformat().replace(
            "+00:00", "Z"
        ),
        "decided_at": None,
        "withdrawn_at": withdrawn_at.isoformat().replace("+00:00", "Z"),
        "withdrawal_kind": "APPLICATION_WITHDRAWAL",
        "late_exit_recorded": False,
        "available_withdrawal_action": None,
        "late_exit_will_be_recorded": False,
        "waitlist_position": None,
        "waitlisted_at": None,
        "promoted_at": None,
    }


@pytest.mark.parametrize(
    ("status", "now", "expected_action", "expected_late"),
    [
        (
            OpenGameRegistrationStatus.APPLIED,
            NOW,
            "WITHDRAW_APPLICATION",
            False,
        ),
        (
            OpenGameRegistrationStatus.JOINED,
            NOW,
            "LEAVE_GAME",
            False,
        ),
        (
            OpenGameRegistrationStatus.JOINED,
            NOW + timedelta(days=3) - timedelta(hours=6) + timedelta(microseconds=1),
            "LEAVE_GAME",
            True,
        ),
    ],
)
def test_context_projects_real_withdrawal_action_and_server_late_warning(
    pg_engine: Engine,
    status: OpenGameRegistrationStatus,
    now: datetime,
    expected_action: str,
    expected_late: bool,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=case.booking.stranger_id,
            status=status,
            decided_by_user_id=(
                case.booking.owner_id
                if status is OpenGameRegistrationStatus.JOINED
                else None
            ),
        )
        session.commit()

        context = _service(session, now=now).get_context(
            share_token=case.share_token,
            viewer_user_id=case.booking.stranger_id,
        )

    assert context.viewer_registration is not None
    assert context.viewer_registration.available_withdrawal_action == expected_action
    assert context.viewer_registration.late_exit_will_be_recorded is expected_late


def test_context_uses_one_clock_snapshot_for_public_and_actions(
    pg_engine: Engine,
) -> None:
    case = _seed_published_game(pg_engine)
    deadline = NOW + timedelta(microseconds=1)
    with Session(pg_engine) as session:
        game = session.get_one(OpenGame, case.game_id)
        game.registration_deadline = deadline
        session.commit()
        clock_values = iter((NOW, deadline))
        registration_service = OpenGameRegistrationService(
            repository=OpenGameRegistrationRepository(session),
            open_game_repository=OpenGameRepository(session),
            order_repository=OrderRepository(session),
            now=lambda: next(clock_values),
        )

        context = registration_service.get_context(
            share_token=case.share_token,
            viewer_user_id=case.booking.stranger_id,
        )

    assert context.game.state_reason is None
    assert context.allowed_actions.can_apply is True
    assert context.allowed_actions.apply_blocked_reason is None


@pytest.mark.parametrize(
    ("condition", "expected_reason"),
    [
        ("deadline", "REGISTRATION_DEADLINE_PASSED"),
        ("cancelled", "GAME_CANCELLED"),
    ],
)
def test_context_projects_authoritative_deadline_capacity_and_cancellation(
    pg_engine: Engine,
    condition: str,
    expected_reason: str,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        game = session.get_one(OpenGame, case.game_id)
        if condition == "deadline":
            game.registration_deadline = NOW
        else:
            game.status = OpenGameStatus.CANCELLED
            game.cancelled_at = NOW
            _add_registration(
                session,
                game_id=game.id,
                applicant_user_id=case.booking.stranger_id,
                status=OpenGameRegistrationStatus.JOINED,
                decided_by_user_id=case.booking.owner_id,
            )
        session.commit()

        context = _service(session).get_context(
            share_token=case.share_token,
            viewer_user_id=case.booking.stranger_id,
        )
        assert context.allowed_actions.apply_blocked_reason == expected_reason
        if condition == "cancelled":
            assert context.game.state == "CANCELLED"
            assert context.viewer_registration is not None
            assert context.viewer_registration.persisted_status == "JOINED"
            assert context.viewer_registration.effective_status == "CANCELLED"


def test_apply_is_idempotent_persists_server_authority_and_leaves_b1_unchanged(
    pg_engine: Engine,
) -> None:
    case = _seed_published_game(pg_engine)
    request = _request()
    with Session(pg_engine) as session:
        before = _b1_snapshot(session)
        first = _service(session).apply(
            share_token=case.share_token,
            applicant_user_id=case.booking.stranger_id,
            idempotency_key=APPLICATION_KEY,
            request=request,
        )
        assert first.viewer_registration is not None
        assert first.viewer_registration.persisted_status == "APPLIED"
        assert first.viewer_registration.effective_status == "APPLIED"
        assert first.allowed_actions.apply_blocked_reason == "ALREADY_APPLIED"
        _assert_context_privacy(first)

        registration = session.scalar(select(OpenGameRegistration))
        assert registration is not None
        assert registration.applicant_user_id == case.booking.stranger_id
        assert registration.consent_version == OPEN_GAME_REGISTRATION_CONSENT_VERSION
        assert registration.adult_confirmed_at == NOW
        assert registration.risk_confirmed_at == NOW
        assert registration.applied_at == NOW
        assert registration.created_at is not None
        assert registration.updated_at is not None

        record = session.scalar(select(IdempotencyRecord))
        assert record is not None
        canonical = json.dumps(
            {
                "operation": CREATE_OPEN_GAME_APPLICATION_OPERATION,
                "share_token": case.share_token,
                "resolved_game_id": str(case.game_id),
                "body": request.model_dump(mode="json"),
                "version": 1,
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        assert record.request_sha256 == hashlib.sha256(canonical.encode()).hexdigest()
        assert record.response_status == 201
        assert record.response_body == first.model_dump(mode="json")

        game = session.get_one(OpenGame, case.game_id)
        game.status = OpenGameStatus.CANCELLED
        game.cancelled_at = NOW
        session.commit()
        replay = _service(session).apply(
            share_token=case.share_token,
            applicant_user_id=case.booking.stranger_id,
            idempotency_key=APPLICATION_KEY,
            request=request,
        )
        assert replay == first
        assert _b1_snapshot(session) == before


def test_full_game_still_creates_a_plain_applied_registration_with_zero_remaining(
    pg_engine: Engine,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        game = session.get_one(OpenGame, case.game_id)
        game.open_spots = 1
        joined = _new_user(session, "full-apply-joined")
        _add_registration(
            session,
            game_id=game.id,
            applicant_user_id=joined.id,
            status=OpenGameRegistrationStatus.JOINED,
            decided_by_user_id=case.booking.owner_id,
        )
        session.commit()

        context = _service(session).apply(
            share_token=case.share_token,
            applicant_user_id=case.booking.stranger_id,
            idempotency_key="full-plain-application-key-000001",
            request=_request(),
        )

        registration = session.scalar(
            select(OpenGameRegistration).where(
                OpenGameRegistration.applicant_user_id
                == case.booking.stranger_id
            )
        )
        assert registration is not None
        assert registration.status is OpenGameRegistrationStatus.APPLIED
        assert context.remaining_spots == 0
        assert context.viewer_registration is not None
        assert context.viewer_registration.persisted_status.value == "APPLIED"
        assert context.viewer_registration.waitlist_position is None
        assert context.viewer_registration.waitlisted_at is None
        assert context.viewer_registration.promoted_at is None


def test_apply_replays_a_legacy_c1a_context_after_the_viewer_contract_expands(
    pg_engine: Engine,
) -> None:
    case = _seed_published_game(pg_engine)
    request = _request()
    with Session(pg_engine) as session:
        first = _service(session).apply(
            share_token=case.share_token,
            applicant_user_id=case.booking.stranger_id,
            idempotency_key=APPLICATION_KEY,
            request=request,
        )
        registration = session.scalar(select(OpenGameRegistration))
        record = session.scalar(select(IdempotencyRecord))
        assert registration is not None
        assert record is not None
        assert record.response_body is not None
        legacy_body = dict(record.response_body)
        legacy_viewer = dict(legacy_body["viewer_registration"])
        for field in (
            "id",
            "version",
            "withdrawn_at",
            "withdrawal_kind",
            "late_exit_recorded",
            "available_withdrawal_action",
            "late_exit_will_be_recorded",
            "waitlist_position",
            "waitlisted_at",
            "promoted_at",
        ):
            legacy_viewer.pop(field)
        legacy_body["viewer_registration"] = legacy_viewer
        record.response_body = legacy_body
        session.commit()

        replay = _service(session).apply(
            share_token=case.share_token,
            applicant_user_id=case.booking.stranger_id,
            idempotency_key=APPLICATION_KEY,
            request=request,
        )

        expected = first.model_dump(mode="json")
        assert expected["viewer_registration"] is not None
        expected["viewer_registration"]["available_withdrawal_action"] = None
        assert replay.model_dump(mode="json") == expected
        assert replay.viewer_registration is not None
        assert replay.viewer_registration.id == registration.id
        assert replay.viewer_registration.version == 1
        assert replay.viewer_registration.withdrawn_at is None
        assert replay.viewer_registration.withdrawal_kind is None
        assert replay.viewer_registration.late_exit_recorded is False
        assert replay.viewer_registration.available_withdrawal_action is None
        assert replay.viewer_registration.late_exit_will_be_recorded is False


def test_apply_duplicate_and_idempotency_reuse_are_distinct(pg_engine: Engine) -> None:
    first_case = _seed_published_game(pg_engine, share_token="A" * 32)
    second_case = seed_confirmed_order(pg_engine)
    with Session(pg_engine) as session:
        second_game = add_stored_game(
            session,
            seeded=second_case,
            status=OpenGameStatus.PUBLISHED,
            share_token="B" * 32,
        )
        session.commit()
        service = _service(session)
        service.apply(
            share_token=first_case.share_token,
            applicant_user_id=first_case.booking.stranger_id,
            idempotency_key=APPLICATION_KEY,
            request=_request(),
        )

        with pytest.raises(AppError) as duplicate:
            service.apply(
                share_token=first_case.share_token,
                applicant_user_id=first_case.booking.stranger_id,
                idempotency_key="different-application-key-000001",
                request=_request(),
            )
        assert (duplicate.value.status_code, duplicate.value.code) == (
            409,
            "APPLICATION_ALREADY_EXISTS",
        )
        assert (
            duplicate.value.message
            == "你已申请过本场球局，请刷新查看当前结果。"
        )

        with pytest.raises(AppError) as changed_body:
            service.apply(
                share_token=first_case.share_token,
                applicant_user_id=first_case.booking.stranger_id,
                idempotency_key=APPLICATION_KEY,
                request=_request(display_name="另一个称呼"),
            )
        assert (changed_body.value.status_code, changed_body.value.code) == (
            409,
            "IDEMPOTENCY_KEY_REUSED",
        )

        with pytest.raises(AppError) as changed_target:
            service.apply(
                share_token=second_game.share_token,
                applicant_user_id=first_case.booking.stranger_id,
                idempotency_key=APPLICATION_KEY,
                request=_request(),
            )
        assert (changed_target.value.status_code, changed_target.value.code) == (
            409,
            "IDEMPOTENCY_KEY_REUSED",
        )
        with pytest.raises(AppError) as missing_target:
            service.apply(
                share_token="Z" * 32,
                applicant_user_id=first_case.booking.stranger_id,
                idempotency_key=APPLICATION_KEY,
                request=_request(),
            )
        assert (missing_target.value.status_code, missing_target.value.code) == (
            404,
            "OPEN_GAME_NOT_FOUND",
        )
        assert session.scalar(select(func.count()).select_from(OpenGameRegistration)) == 1
        assert session.scalar(select(func.count()).select_from(IdempotencyRecord)) == 1


@pytest.mark.parametrize(
    ("condition", "expected_reason", "expected_remaining"),
    [
        ("owner", "OWNER_CANNOT_APPLY", 4),
        ("deadline", "REGISTRATION_DEADLINE_PASSED", 4),
        ("cancelled", "GAME_CANCELLED", 4),
    ],
)
def test_apply_blockers_return_closed_details_and_rollback_claim(
    pg_engine: Engine,
    condition: str,
    expected_reason: str,
    expected_remaining: int,
) -> None:
    case = _seed_published_game(pg_engine)
    applicant_user_id = case.booking.stranger_id
    with Session(pg_engine) as session:
        game = session.get_one(OpenGame, case.game_id)
        if condition == "owner":
            applicant_user_id = case.booking.owner_id
        elif condition == "deadline":
            game.registration_deadline = NOW
        else:
            game.status = OpenGameStatus.CANCELLED
            game.cancelled_at = NOW
        session.commit()
        before_b1 = _b1_snapshot(session)
        registration_ids_before = tuple(
            session.scalars(
                select(OpenGameRegistration.id).order_by(OpenGameRegistration.id)
            )
        )

        with pytest.raises(AppError) as blocked:
            _service(session).apply(
                share_token=case.share_token,
                applicant_user_id=applicant_user_id,
                idempotency_key=f"blocked-{condition}-application-key-00001",
                request=_request(),
            )

        assert (blocked.value.status_code, blocked.value.code) == (
            409,
            "APPLICATION_NOT_ALLOWED",
        )
        assert blocked.value.details == {
            "apply_blocked_reason": expected_reason,
            "remaining_spots": expected_remaining,
        }
        assert blocked.value.message == "当前球局暂不允许提交申请。"
        assert _b1_snapshot(session) == before_b1
        assert tuple(
            session.scalars(
                select(OpenGameRegistration.id).order_by(OpenGameRegistration.id)
            )
        ) == registration_ids_before
        assert session.scalar(
            select(func.count())
            .select_from(OpenGameRegistration)
            .where(OpenGameRegistration.applicant_user_id == applicant_user_id)
        ) == 0
        assert session.scalar(select(func.count()).select_from(IdempotencyRecord)) == 0


def test_application_digest_covers_operation_target_token_and_closed_body() -> None:
    game_id = uuid.uuid4()
    request = _request()
    base = _application_request_digest(
        operation=CREATE_OPEN_GAME_APPLICATION_OPERATION,
        share_token=SHARE_TOKEN,
        resolved_game_id=game_id,
        request=request,
    )
    variations = (
        {"operation": "another_operation"},
        {"share_token": "S" * 32},
        {"resolved_game_id": uuid.uuid4()},
        {"request": _request(display_name="另一称呼")},
        {"request": _request(position=OpenGameRegistrationPosition.DEFENDER)},
        {"request": _request(note=None)},
    )
    defaults: dict[str, object] = {
        "operation": CREATE_OPEN_GAME_APPLICATION_OPERATION,
        "share_token": SHARE_TOKEN,
        "resolved_game_id": game_id,
        "request": request,
    }
    assert request.model_dump(mode="json") == {
        "display_name": "周末小翼",
        "position": "FORWARD",
        "note": "可以补边路，按时到场。",
        "adult_confirmed": True,
        "risk_confirmed": True,
    }
    for variation in variations:
        assert _application_request_digest(**(defaults | variation)) != base


def test_repository_returns_joined_count_and_complete_pending_order(
    pg_engine: Engine,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        applicant_a = session.get_one(User, case.booking.stranger_id)
        applicant_b = _new_user(session, "pending-b")
        joined = _new_user(session, "joined")
        same_time = NOW - timedelta(minutes=10)
        row_b = _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=applicant_b.id,
            status=OpenGameRegistrationStatus.APPLIED,
            applied_at=same_time,
        )
        row_a = _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=applicant_a.id,
            status=OpenGameRegistrationStatus.APPLIED,
            applied_at=same_time,
        )
        _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=joined.id,
            status=OpenGameRegistrationStatus.JOINED,
            applied_at=same_time - timedelta(minutes=1),
            decided_by_user_id=case.booking.owner_id,
        )
        session.commit()

        repository = OpenGameRegistrationRepository(session)
        assert repository.get_registration(
            game_id=case.game_id,
            applicant_user_id=applicant_a.id,
        ).id == row_a.id
        assert repository.count_joined(game_id=case.game_id) == 1
        assert [row.id for row in repository.list_pending(game_id=case.game_id)] == sorted(
            (row_a.id, row_b.id)
        )
        assert repository.lock_order(order_id=case.booking.order_id).id == case.booking.order_id


def test_repository_projects_only_active_waitlist_in_immutable_fifo_order(
    pg_engine: Engine,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        waitlisted_at = NOW - timedelta(minutes=5)
        active_nine = _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=case.booking.stranger_id,
            status=OpenGameRegistrationStatus.WAITLISTED,
            application_id=uuid.UUID(int=1),
            applied_at=NOW - timedelta(minutes=20),
            decided_by_user_id=case.booking.owner_id,
            waitlist_seq=9,
            waitlisted_at=waitlisted_at,
        )
        active_three_user = _new_user(session, "waitlist-three")
        active_three = _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=active_three_user.id,
            status=OpenGameRegistrationStatus.WAITLISTED,
            application_id=uuid.UUID(int=99),
            applied_at=NOW - timedelta(minutes=10),
            decided_by_user_id=case.booking.owner_id,
            waitlist_seq=3,
            waitlisted_at=waitlisted_at,
        )
        withdrawn_user = _new_user(session, "waitlist-withdrawn")
        _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=withdrawn_user.id,
            status=OpenGameRegistrationStatus.WITHDRAWN,
            applied_at=NOW - timedelta(minutes=12),
            decided_by_user_id=case.booking.owner_id,
            withdrawal_kind=OpenGameRegistrationWithdrawalKind.WAITLIST_WITHDRAWAL,
            withdrawn_at=NOW - timedelta(minutes=1),
            waitlist_seq=5,
            waitlisted_at=waitlisted_at,
        )
        promoted_user = _new_user(session, "waitlist-promoted")
        _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=promoted_user.id,
            status=OpenGameRegistrationStatus.JOINED,
            applied_at=NOW - timedelta(minutes=15),
            decided_by_user_id=case.booking.owner_id,
            waitlist_seq=7,
            waitlisted_at=waitlisted_at,
            promoted_at=NOW - timedelta(minutes=2),
        )
        session.commit()

        repository = OpenGameRegistrationRepository(session)
        assert [
            row.id for row in repository.list_waitlisted(game_id=case.game_id)
        ] == [active_three.id, active_nine.id]
        assert repository.get_waitlist_position(
            game_id=case.game_id,
            application_id=active_nine.id,
            waitlist_seq=9,
        ) == 2


def test_owner_queue_is_complete_ordered_pending_only_and_private(
    pg_engine: Engine,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        pending_specs = (
            (uuid.UUID(int=15), NOW - timedelta(minutes=8)),
            (uuid.UUID(int=12), NOW - timedelta(minutes=10)),
            (uuid.UUID(int=11), NOW - timedelta(minutes=10)),
            (uuid.UUID(int=14), NOW - timedelta(minutes=9)),
            (uuid.UUID(int=13), NOW - timedelta(minutes=10)),
        )
        for index, (application_id, applied_at) in enumerate(pending_specs):
            applicant = _new_user(session, f"queue-{index}")
            _add_registration(
                session,
                game_id=case.game_id,
                applicant_user_id=applicant.id,
                status=OpenGameRegistrationStatus.APPLIED,
                application_id=application_id,
                display_name=f"候选球员{index}",
                position=OpenGameRegistrationPosition.ANY,
                note=None,
                applied_at=applied_at,
            )
        joined = _new_user(session, "queue-joined")
        _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=joined.id,
            status=OpenGameRegistrationStatus.JOINED,
            decided_by_user_id=case.booking.owner_id,
        )
        rejected = _new_user(session, "queue-rejected")
        _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=rejected.id,
            status=OpenGameRegistrationStatus.REJECTED,
            decided_by_user_id=case.booking.owner_id,
        )
        session.commit()

        queue = _service(session).get_queue(
            game_id=case.game_id,
            owner_user_id=case.booking.owner_id,
        )

    expected_ids = [
        application_id
        for application_id, _ in sorted(
            pending_specs,
            key=lambda item: (item[1], item[0]),
        )
    ]
    assert queue.pending_count == len(pending_specs)
    assert queue.pending_count == len(queue.applications)
    assert queue.remaining_spots == 3
    assert [row.id for row in queue.applications] == expected_ids
    assert all(
        row.allowed_actions.model_dump() == {
            "can_accept": True,
            "accept_blocked_reason": None,
            "can_waitlist": False,
            "waitlist_blocked_reason": "GAME_NOT_FULL",
            "can_reject": True,
            "reject_blocked_reason": None,
        }
        for row in queue.applications
    )
    _assert_queue_privacy(queue)


def test_owner_queue_projects_active_waitlist_fifo_without_internal_sequence(
    pg_engine: Engine,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        waitlisted_at = NOW - timedelta(minutes=5)
        rows: list[OpenGameRegistration] = []
        for index, waitlist_seq in enumerate((8, 2)):
            applicant = _new_user(session, f"owner-waitlist-{index}")
            rows.append(
                _add_registration(
                    session,
                    game_id=case.game_id,
                    applicant_user_id=applicant.id,
                    status=OpenGameRegistrationStatus.WAITLISTED,
                    display_name=f"候补球员{index}",
                    applied_at=NOW - timedelta(minutes=20 - index),
                    decided_by_user_id=case.booking.owner_id,
                    waitlist_seq=waitlist_seq,
                    waitlisted_at=waitlisted_at,
                )
            )
        session.commit()

        queue = _service(session).get_queue(
            game_id=case.game_id,
            owner_user_id=case.booking.owner_id,
        )

    assert queue.waitlist_count == 2
    assert [item.id for item in queue.waitlist] == [rows[1].id, rows[0].id]
    assert [item.waitlist_position for item in queue.waitlist] == [1, 2]
    assert all(item.waitlisted_at == waitlisted_at for item in queue.waitlist)
    dumped = queue.model_dump(mode="json")
    assert "waitlist_seq" not in json.dumps(dumped)
    assert "applicant_user_id" not in json.dumps(dumped)


def test_context_projects_waitlisted_viewer_with_compressed_visible_position(
    pg_engine: Engine,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        waitlisted_at = NOW - timedelta(minutes=5)
        earlier = _new_user(session, "context-earlier")
        _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=earlier.id,
            status=OpenGameRegistrationStatus.WAITLISTED,
            decided_by_user_id=case.booking.owner_id,
            waitlist_seq=3,
            waitlisted_at=waitlisted_at,
        )
        viewer = _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=case.booking.stranger_id,
            status=OpenGameRegistrationStatus.WAITLISTED,
            decided_by_user_id=case.booking.owner_id,
            waitlist_seq=9,
            waitlisted_at=waitlisted_at,
        )
        departed = _new_user(session, "context-departed")
        _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=departed.id,
            status=OpenGameRegistrationStatus.WITHDRAWN,
            decided_by_user_id=case.booking.owner_id,
            withdrawal_kind=OpenGameRegistrationWithdrawalKind.WAITLIST_WITHDRAWAL,
            withdrawn_at=NOW - timedelta(minutes=1),
            waitlist_seq=5,
            waitlisted_at=waitlisted_at,
        )
        session.commit()

        context = _service(session).get_context(
            share_token=case.share_token,
            viewer_user_id=case.booking.stranger_id,
        )

    assert context.viewer_registration is not None
    assert context.viewer_registration.id == viewer.id
    assert context.viewer_registration.persisted_status == "WAITLISTED"
    assert context.viewer_registration.effective_status == "WAITLISTED"
    assert context.viewer_registration.waitlist_position == 2
    assert context.viewer_registration.waitlisted_at == waitlisted_at
    assert context.viewer_registration.promoted_at is None
    assert (
        context.viewer_registration.available_withdrawal_action
        == "WITHDRAW_WAITLIST"
    )
    assert "waitlist_seq" not in json.dumps(
        context.model_dump(mode="json"),
    )


def test_queue_hides_nonowner_and_missing_games_symmetrically(
    pg_engine: Engine,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        service = _service(session)
        for game_id, user_id in (
            (case.game_id, case.booking.stranger_id),
            (uuid.uuid4(), case.booking.owner_id),
        ):
            with pytest.raises(AppError) as hidden:
                service.get_queue(game_id=game_id, owner_user_id=user_id)
            assert (hidden.value.status_code, hidden.value.code) == (
                404,
                "OPEN_GAME_NOT_FOUND",
            )
            assert hidden.value.message == "球局不存在。"
            assert hidden.value.details == {}


@pytest.mark.parametrize(
    ("condition", "blocked_reason"),
    [
        ("cancelled", "GAME_CANCELLED"),
        ("suspended", "GAME_SUSPENDED"),
        ("completed", "GAME_COMPLETED"),
        ("started", "GAME_STARTED"),
    ],
)
def test_queue_projects_review_blockers_from_current_authority(
    pg_engine: Engine,
    condition: str,
    blocked_reason: str,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=case.booking.stranger_id,
            status=OpenGameRegistrationStatus.APPLIED,
        )
        review_now = _set_review_authority(
            session,
            case=case,
            condition=condition,
        )
        session.commit()

        queue = _service(session, now=review_now).get_queue(
            game_id=case.game_id,
            owner_user_id=case.booking.owner_id,
        )

    assert queue.pending_count == 1
    assert queue.applications[0].allowed_actions.model_dump() == {
        "can_accept": False,
        "accept_blocked_reason": blocked_reason,
        "can_waitlist": False,
        "waitlist_blocked_reason": blocked_reason,
        "can_reject": False,
        "reject_blocked_reason": blocked_reason,
    }


def test_queue_projects_current_capacity_for_accept_only(pg_engine: Engine) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        game = session.get_one(OpenGame, case.game_id)
        game.open_spots = 1
        _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=case.booking.stranger_id,
            status=OpenGameRegistrationStatus.APPLIED,
        )
        joined = _new_user(session, "queue-full")
        _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=joined.id,
            status=OpenGameRegistrationStatus.JOINED,
            decided_by_user_id=case.booking.owner_id,
        )
        session.commit()

        queue = _service(session).get_queue(
            game_id=case.game_id,
            owner_user_id=case.booking.owner_id,
        )

    assert queue.remaining_spots == 0
    assert queue.applications[0].allowed_actions.model_dump() == {
        "can_accept": False,
        "accept_blocked_reason": "GAME_FULL",
        "can_waitlist": True,
        "waitlist_blocked_reason": None,
        "can_reject": True,
        "reject_blocked_reason": None,
    }


@pytest.mark.parametrize(
    ("decision", "expected_status", "expected_remaining", "make_full"),
    [
        (ApplicationDecision.ACCEPT, "JOINED", 3, False),
        (ApplicationDecision.REJECT, "REJECTED", 0, True),
    ],
)
def test_decision_persists_server_terminal_state_without_mutating_b1(
    pg_engine: Engine,
    decision: ApplicationDecision,
    expected_status: str,
    expected_remaining: int,
    make_full: bool,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        target = _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=case.booking.stranger_id,
            status=OpenGameRegistrationStatus.APPLIED,
        )
        if make_full:
            session.get_one(OpenGame, case.game_id).open_spots = 1
            joined = _new_user(session, "decision-full")
            _add_registration(
                session,
                game_id=case.game_id,
                applicant_user_id=joined.id,
                status=OpenGameRegistrationStatus.JOINED,
                decided_by_user_id=case.booking.owner_id,
            )
        session.commit()
        before_b1 = _b1_snapshot(session)

        result = _service(session).decide(
            game_id=case.game_id,
            application_id=target.id,
            owner_user_id=case.booking.owner_id,
            idempotency_key=DECISION_KEY,
            request=_decision(decision),
        )

        persisted = session.get_one(OpenGameRegistration, target.id)
        assert persisted.status == expected_status
        assert persisted.version == 2
        assert persisted.decided_at == NOW
        assert persisted.decided_by_user_id == case.booking.owner_id
        assert result.application_id == target.id
        assert result.status == expected_status
        assert result.version == 2
        assert result.decided_at == NOW
        assert result.remaining_spots == expected_remaining
        assert result.allowed_actions.model_dump() == {
            "can_accept": False,
            "accept_blocked_reason": "APPLICATION_NOT_PENDING",
            "can_waitlist": False,
            "waitlist_blocked_reason": "APPLICATION_NOT_PENDING",
            "can_reject": False,
            "reject_blocked_reason": "APPLICATION_NOT_PENDING",
        }
        record = session.scalar(
            select(IdempotencyRecord).where(
                IdempotencyRecord.operation
                == DECIDE_OPEN_GAME_APPLICATION_OPERATION
            )
        )
        assert record is not None
        assert record.response_status == 200
        assert record.response_body == result.model_dump(mode="json")
        assert _b1_snapshot(session) == before_b1


def test_decision_replays_stored_result_after_terminal_capacity_and_authority_change(
    pg_engine: Engine,
) -> None:
    case = _seed_published_game(pg_engine)
    request = _decision(ApplicationDecision.ACCEPT)
    with Session(pg_engine) as session:
        game = session.get_one(OpenGame, case.game_id)
        game.open_spots = 1
        target = _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=case.booking.stranger_id,
            status=OpenGameRegistrationStatus.APPLIED,
        )
        session.commit()
        before_b1 = _b1_snapshot(session)
        service = _service(session)
        first = service.decide(
            game_id=case.game_id,
            application_id=target.id,
            owner_user_id=case.booking.owner_id,
            idempotency_key=DECISION_KEY,
            request=request,
        )
        game = session.get_one(OpenGame, case.game_id)
        game.status = OpenGameStatus.CANCELLED
        game.cancelled_at = NOW
        record = session.scalar(
            select(IdempotencyRecord).where(
                IdempotencyRecord.operation
                == DECIDE_OPEN_GAME_APPLICATION_OPERATION
            )
        )
        assert record is not None
        assert record.response_body is not None
        legacy_body = dict(record.response_body)
        legacy_actions = dict(legacy_body["allowed_actions"])
        legacy_actions.pop("can_waitlist")
        legacy_actions.pop("waitlist_blocked_reason")
        legacy_body["allowed_actions"] = legacy_actions
        record.response_body = legacy_body
        session.commit()

        replay = service.decide(
            game_id=case.game_id,
            application_id=target.id,
            owner_user_id=case.booking.owner_id,
            idempotency_key=DECISION_KEY,
            request=request,
        )

        assert replay == first
        assert first.remaining_spots == 0
        assert session.get_one(OpenGameRegistration, target.id).status == "JOINED"
        assert session.scalar(select(func.count()).select_from(IdempotencyRecord)) == 1
        assert _b1_snapshot(session) == before_b1


def test_decision_idempotency_rejects_changed_target_decision_and_version(
    pg_engine: Engine,
) -> None:
    first_case = _seed_published_game(pg_engine, share_token="D" * 32)
    second_booking = seed_confirmed_order(
        pg_engine,
        owner_id=first_case.booking.owner_id,
    )
    with Session(pg_engine) as session:
        second_game = add_stored_game(
            session,
            seeded=second_booking,
            status=OpenGameStatus.PUBLISHED,
            share_token="E" * 32,
            team_name="第二联队",
        )
        first = _add_registration(
            session,
            game_id=first_case.game_id,
            applicant_user_id=first_case.booking.stranger_id,
            status=OpenGameRegistrationStatus.APPLIED,
        )
        another_user = _new_user(session, "same-game-another")
        another = _add_registration(
            session,
            game_id=first_case.game_id,
            applicant_user_id=another_user.id,
            status=OpenGameRegistrationStatus.APPLIED,
        )
        second_user = _new_user(session, "second-game")
        second = _add_registration(
            session,
            game_id=second_game.id,
            applicant_user_id=second_user.id,
            status=OpenGameRegistrationStatus.APPLIED,
        )
        session.commit()
        service = _service(session)
        service.decide(
            game_id=first_case.game_id,
            application_id=first.id,
            owner_user_id=first_case.booking.owner_id,
            idempotency_key=DECISION_KEY,
            request=_decision(ApplicationDecision.REJECT),
        )
        after_first = _c1a_snapshot(session)

        variations = (
            (first_case.game_id, another.id, _decision(ApplicationDecision.REJECT)),
            (second_game.id, second.id, _decision(ApplicationDecision.REJECT)),
            (first_case.game_id, first.id, _decision(ApplicationDecision.ACCEPT)),
            (first_case.game_id, first.id, _decision(ApplicationDecision.WAITLIST)),
            (
                first_case.game_id,
                first.id,
                _decision(ApplicationDecision.REJECT, expected_version=2),
            ),
        )
        for game_id, application_id, request in variations:
            with pytest.raises(AppError) as reused:
                service.decide(
                    game_id=game_id,
                    application_id=application_id,
                    owner_user_id=first_case.booking.owner_id,
                    idempotency_key=DECISION_KEY,
                    request=request,
                )
            assert (reused.value.status_code, reused.value.code) == (
                409,
                "IDEMPOTENCY_KEY_REUSED",
            )
            assert reused.value.message == "该幂等键已用于其他请求，请生成新键后重试。"
            assert reused.value.details == {}
        assert _c1a_snapshot(session) == after_first


def test_decision_digest_covers_operation_game_application_decision_and_version() -> None:
    game_id = uuid.uuid4()
    application_id = uuid.uuid4()
    request = _decision(ApplicationDecision.ACCEPT)
    defaults: dict[str, object] = {
        "operation": DECIDE_OPEN_GAME_APPLICATION_OPERATION,
        "game_id": game_id,
        "application_id": application_id,
        "request": request,
    }
    base = _decision_request_digest(**defaults)
    variations = (
        {"operation": "another_operation"},
        {"game_id": uuid.uuid4()},
        {"application_id": uuid.uuid4()},
        {"request": _decision(ApplicationDecision.REJECT)},
        {"request": _decision(ApplicationDecision.WAITLIST)},
        {
            "request": _decision(
                ApplicationDecision.ACCEPT,
                expected_version=2,
            )
        },
    )
    for variation in variations:
        assert _decision_request_digest(**(defaults | variation)) != base


def test_decision_hides_foreign_application_relationship_without_mutation(
    pg_engine: Engine,
) -> None:
    first_case = _seed_published_game(pg_engine, share_token="F" * 32)
    second_booking = seed_confirmed_order(
        pg_engine,
        owner_id=first_case.booking.owner_id,
    )
    with Session(pg_engine) as session:
        second_game = add_stored_game(
            session,
            seeded=second_booking,
            status=OpenGameStatus.PUBLISHED,
            share_token="G" * 32,
            team_name="关系验证联队",
        )
        first = _add_registration(
            session,
            game_id=first_case.game_id,
            applicant_user_id=first_case.booking.stranger_id,
            status=OpenGameRegistrationStatus.APPLIED,
        )
        second_user = _new_user(session, "foreign-application")
        foreign = _add_registration(
            session,
            game_id=second_game.id,
            applicant_user_id=second_user.id,
            status=OpenGameRegistrationStatus.APPLIED,
        )
        session.commit()
        before_c1a = _c1a_snapshot(session)
        before_b1 = _b1_snapshot(session)

        for application_id in (foreign.id, uuid.uuid4()):
            with pytest.raises(AppError) as hidden:
                _service(session).decide(
                    game_id=first_case.game_id,
                    application_id=application_id,
                    owner_user_id=first_case.booking.owner_id,
                    idempotency_key=f"hidden-{application_id}",
                    request=_decision(ApplicationDecision.ACCEPT),
                )
            assert (hidden.value.status_code, hidden.value.code) == (
                404,
                "APPLICATION_NOT_FOUND",
            )
            assert hidden.value.message == "报名不存在。"
            assert hidden.value.details == {}
        assert session.get_one(OpenGameRegistration, first.id).status == "APPLIED"
        assert _c1a_snapshot(session) == before_c1a
        assert _b1_snapshot(session) == before_b1


def test_decision_hides_nonowner_game_before_idempotency_history(
    pg_engine: Engine,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        target = _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=case.booking.stranger_id,
            status=OpenGameRegistrationStatus.APPLIED,
        )
        session.add(
            IdempotencyRecord(
                user_id=case.booking.stranger_id,
                operation=DECIDE_OPEN_GAME_APPLICATION_OPERATION,
                key=DECISION_KEY,
                request_sha256="0" * 64,
                state=IdempotencyState.COMPLETED,
                response_status=200,
                response_body={},
            )
        )
        session.commit()
        before = _c1a_snapshot(session)

        with pytest.raises(AppError) as hidden:
            _service(session).decide(
                game_id=case.game_id,
                application_id=target.id,
                owner_user_id=case.booking.stranger_id,
                idempotency_key=DECISION_KEY,
                request=_decision(ApplicationDecision.ACCEPT),
            )

        assert (hidden.value.status_code, hidden.value.code) == (
            404,
            "OPEN_GAME_NOT_FOUND",
        )
        assert hidden.value.message == "球局不存在。"
        assert hidden.value.details == {}
        assert _c1a_snapshot(session) == before


@pytest.mark.parametrize(
    "condition",
    ["terminal", "version", "cancelled", "suspended", "completed", "started"],
)
@pytest.mark.parametrize(
    "decision",
    [ApplicationDecision.ACCEPT, ApplicationDecision.WAITLIST],
)
def test_decision_state_or_authority_change_rolls_back_claim(
    pg_engine: Engine,
    condition: str,
    decision: ApplicationDecision,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        terminal = condition == "terminal"
        target = _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=case.booking.stranger_id,
            status=(
                OpenGameRegistrationStatus.JOINED
                if terminal
                else OpenGameRegistrationStatus.APPLIED
            ),
            decided_by_user_id=case.booking.owner_id if terminal else None,
        )
        review_now = (
            _set_review_authority(session, case=case, condition=condition)
            if condition in {"cancelled", "suspended", "completed", "started"}
            else NOW
        )
        session.commit()
        before_c1a = _c1a_snapshot(session)
        before_b1 = _b1_snapshot(session)
        expected_version = 2 if condition in {"terminal", "version"} else 1

        with pytest.raises(AppError) as changed:
            _service(session, now=review_now).decide(
                game_id=case.game_id,
                application_id=target.id,
                owner_user_id=case.booking.owner_id,
                idempotency_key=f"state-{condition}-decision-key-000001",
                request=_decision(
                    decision,
                    expected_version=expected_version,
                ),
            )

        assert (changed.value.status_code, changed.value.code) == (
            409,
            "APPLICATION_STATE_CHANGED",
        )
        assert changed.value.message == "报名状态或版本已变化，请刷新后重试。"
        assert changed.value.details == {}
        assert _c1a_snapshot(session) == before_c1a
        assert _b1_snapshot(session) == before_b1


def test_accept_capacity_change_is_closed_and_leaves_target_pending(
    pg_engine: Engine,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        session.get_one(OpenGame, case.game_id).open_spots = 1
        target = _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=case.booking.stranger_id,
            status=OpenGameRegistrationStatus.APPLIED,
        )
        joined = _new_user(session, "capacity-conflict")
        _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=joined.id,
            status=OpenGameRegistrationStatus.JOINED,
            decided_by_user_id=case.booking.owner_id,
        )
        session.commit()
        before_c1a = _c1a_snapshot(session)
        before_b1 = _b1_snapshot(session)

        with pytest.raises(AppError) as changed:
            _service(session).decide(
                game_id=case.game_id,
                application_id=target.id,
                owner_user_id=case.booking.owner_id,
                idempotency_key=DECISION_KEY,
                request=_decision(ApplicationDecision.ACCEPT),
            )

        assert (changed.value.status_code, changed.value.code) == (
            409,
            "APPLICATION_CAPACITY_CHANGED",
        )
        assert changed.value.message == "剩余名额已变化，请刷新报名队列。"
        assert changed.value.details == {
            "remaining_spots": 0,
            "allowed_actions": {
                "can_accept": False,
                "accept_blocked_reason": "GAME_FULL",
                "can_waitlist": True,
                "waitlist_blocked_reason": None,
                "can_reject": True,
                "reject_blocked_reason": None,
            },
        }
        assert _c1a_snapshot(session) == before_c1a
        assert _b1_snapshot(session) == before_b1


def test_waitlist_decision_persists_historical_fifo_without_capacity_or_outbox(
    pg_engine: Engine,
) -> None:
    case = _seed_published_game(pg_engine)
    other_case = _seed_published_game(pg_engine, share_token="W" * 32)
    with Session(pg_engine) as session:
        game = session.get_one(OpenGame, case.game_id)
        game.open_spots = 1
        game.registration_deadline = NOW - timedelta(minutes=1)
        joined_user = _new_user(session, "waitlist-full-joined")
        _add_registration(
            session,
            game_id=game.id,
            applicant_user_id=joined_user.id,
            status=OpenGameRegistrationStatus.JOINED,
            decided_by_user_id=case.booking.owner_id,
            waitlist_seq=9,
            waitlisted_at=NOW - timedelta(minutes=6),
            promoted_at=NOW - timedelta(minutes=2),
        )
        withdrawn_user = _new_user(session, "waitlist-history-withdrawn")
        _add_registration(
            session,
            game_id=game.id,
            applicant_user_id=withdrawn_user.id,
            status=OpenGameRegistrationStatus.WITHDRAWN,
            decided_by_user_id=case.booking.owner_id,
            withdrawal_kind=OpenGameRegistrationWithdrawalKind.WAITLIST_WITHDRAWAL,
            withdrawn_at=NOW - timedelta(minutes=1),
            waitlist_seq=7,
            waitlisted_at=NOW - timedelta(minutes=5),
        )
        target = _add_registration(
            session,
            game_id=game.id,
            applicant_user_id=case.booking.stranger_id,
            status=OpenGameRegistrationStatus.APPLIED,
        )
        unrelated_user = _new_user(session, "waitlist-other-game-history")
        _add_registration(
            session,
            game_id=other_case.game_id,
            applicant_user_id=unrelated_user.id,
            status=OpenGameRegistrationStatus.WITHDRAWN,
            decided_by_user_id=other_case.booking.owner_id,
            withdrawal_kind=OpenGameRegistrationWithdrawalKind.WAITLIST_WITHDRAWAL,
            withdrawn_at=NOW - timedelta(minutes=1),
            waitlist_seq=99,
            waitlisted_at=NOW - timedelta(minutes=5),
        )
        session.commit()
        before_b1 = _b1_snapshot(session)

        service = _service(session)
        first = service.decide(
            game_id=game.id,
            application_id=target.id,
            owner_user_id=case.booking.owner_id,
            idempotency_key="waitlist-decision-key-00000000001",
            request=_decision(ApplicationDecision.WAITLIST),
        )
        replay = service.decide(
            game_id=game.id,
            application_id=target.id,
            owner_user_id=case.booking.owner_id,
            idempotency_key="waitlist-decision-key-00000000001",
            request=_decision(ApplicationDecision.WAITLIST),
        )

        persisted = session.get_one(OpenGameRegistration, target.id)
        assert first == replay
        assert first.status == "WAITLISTED"
        assert first.version == 2
        assert first.decided_at == NOW
        assert first.remaining_spots == 0
        assert "waitlist_seq" not in json.dumps(first.model_dump(mode="json"))
        assert persisted.status is OpenGameRegistrationStatus.WAITLISTED
        assert persisted.version == 2
        assert persisted.decided_at == NOW
        assert persisted.decided_by_user_id == case.booking.owner_id
        assert persisted.waitlist_seq == 10
        assert persisted.waitlisted_at == NOW
        assert persisted.promoted_at is None
        assert session.scalar(
            select(func.count()).select_from(OpenGameNotificationOutbox)
        ) == 0
        assert _b1_snapshot(session) == before_b1

        queue = service.get_queue(
            game_id=game.id,
            owner_user_id=case.booking.owner_id,
        )
        context = service.get_context(
            share_token=case.share_token,
            viewer_user_id=case.booking.stranger_id,
        )
        assert queue.pending_count == 0
        assert queue.waitlist_count == 1
        assert queue.waitlist[0].id == target.id
        assert context.viewer_registration is not None
        assert context.viewer_registration.persisted_status == "WAITLISTED"
        assert context.viewer_registration.waitlist_position == 1
        assert "waitlist_seq" not in json.dumps(context.model_dump(mode="json"))


def test_waitlist_decision_requires_full_game_and_rolls_back_claim(
    pg_engine: Engine,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        target = _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=case.booking.stranger_id,
            status=OpenGameRegistrationStatus.APPLIED,
        )
        session.commit()
        before = _c1a_snapshot(session)

        with pytest.raises(AppError) as changed:
            _service(session).decide(
                game_id=case.game_id,
                application_id=target.id,
                owner_user_id=case.booking.owner_id,
                idempotency_key="waitlist-game-not-full-key-0000001",
                request=_decision(ApplicationDecision.WAITLIST),
            )

        assert (changed.value.status_code, changed.value.code) == (
            409,
            "APPLICATION_CAPACITY_CHANGED",
        )
        assert changed.value.details == {
            "remaining_spots": 4,
            "allowed_actions": {
                "can_accept": True,
                "accept_blocked_reason": None,
                "can_waitlist": False,
                "waitlist_blocked_reason": "GAME_NOT_FULL",
                "can_reject": True,
                "reject_blocked_reason": None,
            },
        }
        assert _c1a_snapshot(session) == before


@pytest.mark.parametrize("condition", ["draft", "unhealthy_authority"])
def test_waitlist_decision_requires_published_healthy_authority(
    pg_engine: Engine,
    condition: str,
) -> None:
    case = _seed_published_game(
        pg_engine,
        refund_purpose=(
            RefundCasePurpose.ORDER_CANCELLATION
            if condition == "unhealthy_authority"
            else RefundCasePurpose.DUPLICATE_CHARGE
        ),
    )
    with Session(pg_engine) as session:
        game = session.get_one(OpenGame, case.game_id)
        game.open_spots = 1
        if condition == "draft":
            game.status = OpenGameStatus.DRAFT
            game.published_at = None
        joined_user = _new_user(session, f"waitlist-{condition}-joined")
        _add_registration(
            session,
            game_id=game.id,
            applicant_user_id=joined_user.id,
            status=OpenGameRegistrationStatus.JOINED,
            decided_by_user_id=case.booking.owner_id,
        )
        target = _add_registration(
            session,
            game_id=game.id,
            applicant_user_id=case.booking.stranger_id,
            status=OpenGameRegistrationStatus.APPLIED,
        )
        session.commit()
        before_c1a = _c1a_snapshot(session)
        before_b1 = _b1_snapshot(session)

        with pytest.raises(AppError) as changed:
            _service(session).decide(
                game_id=game.id,
                application_id=target.id,
                owner_user_id=case.booking.owner_id,
                idempotency_key=f"waitlist-{condition}-authority-key-0001",
                request=_decision(ApplicationDecision.WAITLIST),
            )

        assert (changed.value.status_code, changed.value.code) == (
            409,
            "APPLICATION_STATE_CHANGED",
        )
        assert _c1a_snapshot(session) == before_c1a
        assert _b1_snapshot(session) == before_b1


@pytest.mark.parametrize("suspended", [False, True])
def test_withdraw_waitlist_preserves_history_capacity_and_has_no_side_effects(
    pg_engine: Engine,
    suspended: bool,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        target = _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=case.booking.stranger_id,
            status=OpenGameRegistrationStatus.WAITLISTED,
            decided_by_user_id=case.booking.owner_id,
            waitlist_seq=11,
            waitlisted_at=NOW - timedelta(minutes=5),
        )
        if suspended:
            session.get_one(Order, case.booking.order_id).status = (
                OrderStatus.PAYMENT_EXCEPTION
            )
        session.commit()
        before_b1 = _b1_snapshot(session)

        service = _service(session)
        first = service.withdraw(
            application_id=target.id,
            applicant_user_id=case.booking.stranger_id,
            idempotency_key=f"waitlist-withdraw-{suspended}-key-000001",
            request=_withdrawal(
                WithdrawalAction.WITHDRAW_WAITLIST,
                expected_version=2,
            ),
        )
        replay = service.withdraw(
            application_id=target.id,
            applicant_user_id=case.booking.stranger_id,
            idempotency_key=f"waitlist-withdraw-{suspended}-key-000001",
            request=_withdrawal(
                WithdrawalAction.WITHDRAW_WAITLIST,
                expected_version=2,
            ),
        )

        persisted = session.get_one(OpenGameRegistration, target.id)
        assert first == replay
        assert first.remaining_spots == 4
        assert first.viewer_registration is not None
        assert first.viewer_registration.persisted_status == "WITHDRAWN"
        assert first.viewer_registration.withdrawal_kind == "WAITLIST_WITHDRAWAL"
        assert first.viewer_registration.waitlist_position is None
        assert first.viewer_registration.waitlisted_at == NOW - timedelta(minutes=5)
        assert persisted.status is OpenGameRegistrationStatus.WITHDRAWN
        assert persisted.version == 3
        assert persisted.withdrawn_at == NOW
        assert persisted.withdrawal_kind is (
            OpenGameRegistrationWithdrawalKind.WAITLIST_WITHDRAWAL
        )
        assert persisted.late_exit_recorded is False
        assert persisted.waitlist_seq == 11
        assert persisted.waitlisted_at == NOW - timedelta(minutes=5)
        assert persisted.promoted_at is None
        assert session.scalar(
            select(func.count()).select_from(OpenGameNotificationOutbox)
        ) == 0
        assert _b1_snapshot(session) == before_b1

        with pytest.raises(AppError) as second_key:
            service.withdraw(
                application_id=target.id,
                applicant_user_id=case.booking.stranger_id,
                idempotency_key=f"waitlist-withdraw-second-{suspended}-0001",
                request=_withdrawal(
                    WithdrawalAction.WITHDRAW_WAITLIST,
                    expected_version=2,
                ),
            )
        assert second_key.value.code == "APPLICATION_STATE_CHANGED"


@pytest.mark.parametrize(
    ("condition", "expected_version"),
    [
        ("wrong_action", 2),
        ("stale_version", 3),
        ("cancelled", 2),
        ("completed", 2),
        ("started", 2),
    ],
)
def test_withdraw_waitlist_rejects_nonmatching_or_closed_authority_atomically(
    pg_engine: Engine,
    condition: str,
    expected_version: int,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        target = _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=case.booking.stranger_id,
            status=OpenGameRegistrationStatus.WAITLISTED,
            decided_by_user_id=case.booking.owner_id,
            waitlist_seq=3,
            waitlisted_at=NOW - timedelta(minutes=5),
        )
        now = (
            _set_review_authority(session, case=case, condition=condition)
            if condition in {"cancelled", "completed", "started"}
            else NOW
        )
        session.commit()
        before = _c1a_snapshot(session)

        action = (
            WithdrawalAction.WITHDRAW_APPLICATION
            if condition == "wrong_action"
            else WithdrawalAction.WITHDRAW_WAITLIST
        )
        with pytest.raises(AppError) as changed:
            _service(session, now=now).withdraw(
                application_id=target.id,
                applicant_user_id=case.booking.stranger_id,
                idempotency_key=f"waitlist-withdraw-invalid-{condition}-001",
                request=_withdrawal(action, expected_version=expected_version),
            )

        assert (changed.value.status_code, changed.value.code) == (
            409,
            "APPLICATION_STATE_CHANGED",
        )
        assert _c1a_snapshot(session) == before


@pytest.mark.parametrize(
    ("status", "action", "expected_kind", "expected_version"),
    [
        (
            OpenGameRegistrationStatus.APPLIED,
            WithdrawalAction.WITHDRAW_APPLICATION,
            OpenGameRegistrationWithdrawalKind.APPLICATION_WITHDRAWAL,
            1,
        ),
        (
            OpenGameRegistrationStatus.JOINED,
            WithdrawalAction.LEAVE_GAME,
            OpenGameRegistrationWithdrawalKind.GAME_EXIT,
            2,
        ),
    ],
)
def test_withdraw_is_terminal_idempotent_and_preserves_capacity_authority(
    pg_engine: Engine,
    status: OpenGameRegistrationStatus,
    action: WithdrawalAction,
    expected_kind: OpenGameRegistrationWithdrawalKind,
    expected_version: int,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        target = _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=case.booking.stranger_id,
            status=status,
            decided_by_user_id=(
                case.booking.owner_id
                if status is OpenGameRegistrationStatus.JOINED
                else None
            ),
        )
        game = session.get_one(OpenGame, case.game_id)
        open_spots_before = game.open_spots
        joined_before = 1 if status is OpenGameRegistrationStatus.JOINED else 0
        session.commit()

        service = _service(session)
        first = service.withdraw(
            application_id=target.id,
            applicant_user_id=case.booking.stranger_id,
            idempotency_key=WITHDRAWAL_KEY,
            request=_withdrawal(action, expected_version=expected_version),
        )
        record = session.scalar(
            select(IdempotencyRecord).where(
                IdempotencyRecord.operation
                == WITHDRAW_OPEN_GAME_APPLICATION_OPERATION
            )
        )
        assert record is not None
        assert record.response_body is not None
        legacy_body = dict(record.response_body)
        legacy_viewer = dict(legacy_body["viewer_registration"])
        for field in ("waitlist_position", "waitlisted_at", "promoted_at"):
            legacy_viewer.pop(field)
        legacy_body["viewer_registration"] = legacy_viewer
        record.response_body = legacy_body
        session.commit()
        replay = service.withdraw(
            application_id=target.id,
            applicant_user_id=case.booking.stranger_id,
            idempotency_key=WITHDRAWAL_KEY,
            request=_withdrawal(action, expected_version=expected_version),
        )

        assert replay.model_dump(mode="json") == first.model_dump(mode="json")
        assert first.remaining_spots == open_spots_before
        assert first.remaining_spots == open_spots_before - joined_before + joined_before
        assert first.viewer_registration is not None
        assert first.viewer_registration.model_dump(mode="json") | {} == {
            **first.viewer_registration.model_dump(mode="json"),
            "persisted_status": "WITHDRAWN",
            "effective_status": "WITHDRAWN",
            "version": expected_version + 1,
            "withdrawn_at": NOW.isoformat().replace("+00:00", "Z"),
            "withdrawal_kind": expected_kind.value,
            "late_exit_recorded": False,
            "available_withdrawal_action": None,
            "late_exit_will_be_recorded": False,
        }
        persisted = session.get_one(OpenGameRegistration, target.id)
        assert persisted.status is OpenGameRegistrationStatus.WITHDRAWN
        assert persisted.version == expected_version + 1
        assert persisted.withdrawal_kind is expected_kind
        assert persisted.withdrawn_at == NOW
        assert persisted.late_exit_recorded is False
        assert session.get_one(OpenGame, case.game_id).open_spots == open_spots_before
        assert (
            session.scalar(
                select(func.count())
                .select_from(OpenGameRegistration)
                .where(
                    OpenGameRegistration.game_id == case.game_id,
                    OpenGameRegistration.status
                    == OpenGameRegistrationStatus.JOINED,
                )
            )
            == 0
        )
        records = tuple(session.scalars(select(IdempotencyRecord)))
        assert len(records) == 1
        assert records[0].response_status == 200


def test_full_joined_exit_promotes_exact_fifo_head_and_writes_safe_outbox(
    pg_engine: Engine,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        game = session.get_one(OpenGame, case.game_id)
        game.open_spots = 1
        game.registration_deadline = NOW - timedelta(minutes=1)
        departing = _add_registration(
            session,
            game_id=game.id,
            applicant_user_id=case.booking.stranger_id,
            status=OpenGameRegistrationStatus.JOINED,
            decided_by_user_id=case.booking.owner_id,
        )
        first_user = _new_user(session, "promotion-first")
        first = _add_registration(
            session,
            game_id=game.id,
            applicant_user_id=first_user.id,
            status=OpenGameRegistrationStatus.WAITLISTED,
            decided_by_user_id=case.booking.owner_id,
            waitlist_seq=7,
            waitlisted_at=NOW - timedelta(minutes=7),
        )
        second_user = _new_user(session, "promotion-second")
        second = _add_registration(
            session,
            game_id=game.id,
            applicant_user_id=second_user.id,
            status=OpenGameRegistrationStatus.WAITLISTED,
            decided_by_user_id=case.booking.owner_id,
            waitlist_seq=8,
            waitlisted_at=NOW - timedelta(minutes=6),
        )
        first_decided_at = first.decided_at
        first_decided_by = first.decided_by_user_id
        session.commit()

        service = _service(session)
        result = service.withdraw(
            application_id=departing.id,
            applicant_user_id=case.booking.stranger_id,
            idempotency_key="full-exit-promotion-key-00000001",
            request=_withdrawal(
                WithdrawalAction.LEAVE_GAME,
                expected_version=2,
            ),
        )
        replay = service.withdraw(
            application_id=departing.id,
            applicant_user_id=case.booking.stranger_id,
            idempotency_key="full-exit-promotion-key-00000001",
            request=_withdrawal(
                WithdrawalAction.LEAVE_GAME,
                expected_version=2,
            ),
        )

        persisted_departing = session.get_one(OpenGameRegistration, departing.id)
        persisted_first = session.get_one(OpenGameRegistration, first.id)
        persisted_second = session.get_one(OpenGameRegistration, second.id)
        events = tuple(session.scalars(select(OpenGameNotificationOutbox)))
        assert replay == result
        assert result.remaining_spots == 0
        assert persisted_departing.status is OpenGameRegistrationStatus.WITHDRAWN
        assert persisted_first.status is OpenGameRegistrationStatus.JOINED
        assert persisted_first.version == 3
        assert persisted_first.promoted_at == NOW
        assert persisted_first.decided_at == first_decided_at
        assert persisted_first.decided_by_user_id == first_decided_by
        assert persisted_first.waitlist_seq == 7
        assert persisted_first.waitlisted_at == NOW - timedelta(minutes=7)
        assert persisted_first.withdrawn_at is None
        assert persisted_first.withdrawal_kind is None
        assert persisted_second.status is OpenGameRegistrationStatus.WAITLISTED
        assert persisted_second.version == 2
        assert persisted_second.waitlist_seq == 8
        assert len(events) == 1
        assert events[0].dedupe_key == f"waitlist-promoted:{first.id}:3"
        assert events[0].game_id == game.id
        assert events[0].registration_id == first.id
        assert events[0].recipient_user_id == first_user.id
        assert events[0].event is OpenGameNotificationEvent.WAITLIST_PROMOTED
        assert events[0].template_key == "waitlist-promoted"
        assert events[0].status is OpenGameNotificationStatus.PENDING
        assert events[0].payload == {
            "game_name": "历史球局",
            "starts_at": case.booking.starts_at.isoformat(),
            "venue_name": "浦东星跃足球公园",
        }
        assert events[0].attempt_count == 0
        assert events[0].available_at == NOW
        assert events[0].claim_token is None
        assert events[0].lease_until is None
        assert events[0].completed_at is None
        assert events[0].last_failure_code is None
        assert session.get_one(OpenGame, game.id).open_spots == 1
        second_context = service.get_context(
            share_token=case.share_token,
            viewer_user_id=second_user.id,
        )
        assert second_context.viewer_registration is not None
        assert second_context.viewer_registration.waitlist_position == 1


@pytest.mark.parametrize(
    ("open_spots", "with_waitlist"),
    [(1, False), (2, True)],
)
def test_exit_without_candidate_or_from_nonfull_game_has_no_promotion_side_effect(
    pg_engine: Engine,
    open_spots: int,
    with_waitlist: bool,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        game = session.get_one(OpenGame, case.game_id)
        game.open_spots = open_spots
        departing = _add_registration(
            session,
            game_id=game.id,
            applicant_user_id=case.booking.stranger_id,
            status=OpenGameRegistrationStatus.JOINED,
            decided_by_user_id=case.booking.owner_id,
        )
        candidate: OpenGameRegistration | None = None
        if with_waitlist:
            candidate_user = _new_user(session, "nonfull-candidate")
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

        result = _service(session).withdraw(
            application_id=departing.id,
            applicant_user_id=case.booking.stranger_id,
            idempotency_key=f"no-promotion-{open_spots}-{with_waitlist}-key-001",
            request=_withdrawal(
                WithdrawalAction.LEAVE_GAME,
                expected_version=2,
            ),
        )

        assert result.remaining_spots == open_spots
        if candidate is not None:
            persisted = session.get_one(OpenGameRegistration, candidate.id)
            assert persisted.status is OpenGameRegistrationStatus.WAITLISTED
            assert persisted.version == 2
        assert session.scalar(
            select(func.count()).select_from(OpenGameNotificationOutbox)
        ) == 0


@pytest.mark.parametrize(
    ("condition", "exit_succeeds"),
    [
        ("suspended", True),
        ("cancelled", False),
        ("completed", False),
        ("draft", False),
        ("started", False),
    ],
)
def test_exit_never_promotes_outside_healthy_published_prestart_state(
    pg_engine: Engine,
    condition: str,
    exit_succeeds: bool,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        game = session.get_one(OpenGame, case.game_id)
        game.open_spots = 1
        departing = _add_registration(
            session,
            game_id=game.id,
            applicant_user_id=case.booking.stranger_id,
            status=OpenGameRegistrationStatus.JOINED,
            decided_by_user_id=case.booking.owner_id,
        )
        candidate_user = _new_user(session, f"blocked-promotion-{condition}")
        candidate = _add_registration(
            session,
            game_id=game.id,
            applicant_user_id=candidate_user.id,
            status=OpenGameRegistrationStatus.WAITLISTED,
            decided_by_user_id=case.booking.owner_id,
            waitlist_seq=1,
            waitlisted_at=NOW - timedelta(minutes=5),
        )
        if condition == "draft":
            game.status = OpenGameStatus.DRAFT
            game.published_at = None
            now = NOW
        else:
            now = _set_review_authority(
                session,
                case=case,
                condition=condition,
            )
        session.commit()
        before = _c1a_snapshot(session)

        def operation() -> Any:
            return _service(session, now=now).withdraw(
                application_id=departing.id,
                applicant_user_id=case.booking.stranger_id,
                idempotency_key=f"blocked-promotion-{condition}-key-000001",
                request=_withdrawal(
                    WithdrawalAction.LEAVE_GAME,
                    expected_version=2,
                ),
            )
        if exit_succeeds:
            result = operation()
            assert result.game.state == "SUSPENDED"
            assert session.get_one(
                OpenGameRegistration,
                departing.id,
            ).status is OpenGameRegistrationStatus.WITHDRAWN
        else:
            with pytest.raises(AppError) as changed:
                operation()
            assert changed.value.code == "APPLICATION_STATE_CHANGED"
            assert _c1a_snapshot(session) == before

        persisted_candidate = session.get_one(OpenGameRegistration, candidate.id)
        assert persisted_candidate.status is OpenGameRegistrationStatus.WAITLISTED
        assert persisted_candidate.version == 2
        assert session.scalar(
            select(func.count()).select_from(OpenGameNotificationOutbox)
        ) == 0


def test_exit_does_not_promote_when_effective_published_authority_is_unhealthy(
    pg_engine: Engine,
) -> None:
    case = _seed_published_game(
        pg_engine,
        refund_purpose=RefundCasePurpose.ORDER_CANCELLATION,
    )
    with Session(pg_engine) as session:
        game = session.get_one(OpenGame, case.game_id)
        game.open_spots = 1
        departing = _add_registration(
            session,
            game_id=game.id,
            applicant_user_id=case.booking.stranger_id,
            status=OpenGameRegistrationStatus.JOINED,
            decided_by_user_id=case.booking.owner_id,
        )
        candidate_user = _new_user(session, "unhealthy-published-promotion")
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

        result = _service(session).withdraw(
            application_id=departing.id,
            applicant_user_id=case.booking.stranger_id,
            idempotency_key="unhealthy-published-exit-key-000001",
            request=_withdrawal(
                WithdrawalAction.LEAVE_GAME,
                expected_version=2,
            ),
        )

        assert result.game.state == "PUBLISHED"
        assert session.get_one(
            OpenGameRegistration,
            departing.id,
        ).status is OpenGameRegistrationStatus.WITHDRAWN
        persisted_candidate = session.get_one(OpenGameRegistration, candidate.id)
        assert persisted_candidate.status is OpenGameRegistrationStatus.WAITLISTED
        assert persisted_candidate.version == 2
        assert session.scalar(
            select(func.count()).select_from(OpenGameNotificationOutbox)
        ) == 0


def test_joined_exit_records_only_strictly_inside_six_hours_and_suspended_is_allowed(
    pg_engine: Engine,
) -> None:
    for offset, expected_late in (
        (timedelta(hours=6), False),
        (timedelta(hours=6) - timedelta(microseconds=1), True),
    ):
        case = _seed_published_game(pg_engine, share_token=uuid.uuid4().hex)
        with Session(pg_engine) as session:
            target = _add_registration(
                session,
                game_id=case.game_id,
                applicant_user_id=case.booking.stranger_id,
                status=OpenGameRegistrationStatus.JOINED,
                decided_by_user_id=case.booking.owner_id,
            )
            session.get_one(Order, case.booking.order_id).status = (
                OrderStatus.PAYMENT_EXCEPTION
            )
            session.commit()

            result = _service(
                session,
                now=case.booking.starts_at - offset,
            ).withdraw(
                application_id=target.id,
                applicant_user_id=case.booking.stranger_id,
                idempotency_key=f"suspended-exit-{expected_late}-key-000001",
                request=_withdrawal(
                    WithdrawalAction.LEAVE_GAME,
                    expected_version=2,
                ),
            )

            assert result.game.state == "SUSPENDED"
            assert result.viewer_registration is not None
            assert result.viewer_registration.late_exit_recorded is expected_late


@pytest.mark.parametrize(
    ("condition", "action", "expected_version"),
    [
        ("action", WithdrawalAction.LEAVE_GAME, 1),
        ("version", WithdrawalAction.WITHDRAW_APPLICATION, 2),
        ("cancelled", WithdrawalAction.WITHDRAW_APPLICATION, 1),
        ("completed", WithdrawalAction.WITHDRAW_APPLICATION, 1),
        ("started", WithdrawalAction.WITHDRAW_APPLICATION, 1),
    ],
)
def test_withdraw_rejects_stale_action_version_and_closed_game_without_partial_writes(
    pg_engine: Engine,
    condition: str,
    action: WithdrawalAction,
    expected_version: int,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        target = _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=case.booking.stranger_id,
            status=OpenGameRegistrationStatus.APPLIED,
        )
        now = (
            _set_review_authority(session, case=case, condition=condition)
            if condition in {"cancelled", "completed", "started"}
            else NOW
        )
        session.commit()
        before_c1a = _c1a_snapshot(session)
        before_b1 = _b1_snapshot(session)

        with pytest.raises(AppError) as changed:
            _service(session, now=now).withdraw(
                application_id=target.id,
                applicant_user_id=case.booking.stranger_id,
                idempotency_key=f"withdraw-{condition}-key-0000000001",
                request=_withdrawal(action, expected_version=expected_version),
            )

        assert (changed.value.status_code, changed.value.code) == (
            409,
            "APPLICATION_STATE_CHANGED",
        )
        assert _c1a_snapshot(session) == before_c1a
        assert _b1_snapshot(session) == before_b1


def test_withdraw_hides_other_users_application_and_rejects_reused_key_payload(
    pg_engine: Engine,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        target = _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=case.booking.stranger_id,
            status=OpenGameRegistrationStatus.APPLIED,
        )
        other = _new_user(session, "withdraw-hidden")
        session.commit()

        with pytest.raises(AppError) as hidden:
            _service(session).withdraw(
                application_id=target.id,
                applicant_user_id=other.id,
                idempotency_key="hidden-withdrawal-key-000000001",
                request=_withdrawal(
                    WithdrawalAction.WITHDRAW_APPLICATION,
                    expected_version=1,
                ),
            )
        assert (hidden.value.status_code, hidden.value.code) == (
            404,
            "APPLICATION_NOT_FOUND",
        )

        service = _service(session)
        service.withdraw(
            application_id=target.id,
            applicant_user_id=case.booking.stranger_id,
            idempotency_key=WITHDRAWAL_KEY,
            request=_withdrawal(
                WithdrawalAction.WITHDRAW_APPLICATION,
                expected_version=1,
            ),
        )
        with pytest.raises(AppError) as reused:
            service.withdraw(
                application_id=target.id,
                applicant_user_id=case.booking.stranger_id,
                idempotency_key=WITHDRAWAL_KEY,
                request=_withdrawal(
                    WithdrawalAction.WITHDRAW_APPLICATION,
                    expected_version=2,
                ),
            )
        assert (reused.value.status_code, reused.value.code) == (
            409,
            "IDEMPOTENCY_KEY_REUSED",
        )


def test_later_game_cancellation_overrides_effective_status_but_retains_withdrawal_audit(
    pg_engine: Engine,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        target = _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=case.booking.stranger_id,
            status=OpenGameRegistrationStatus.APPLIED,
        )
        session.commit()
        _service(session).withdraw(
            application_id=target.id,
            applicant_user_id=case.booking.stranger_id,
            idempotency_key=WITHDRAWAL_KEY,
            request=_withdrawal(
                WithdrawalAction.WITHDRAW_APPLICATION,
                expected_version=1,
            ),
        )
        game = session.get_one(OpenGame, case.game_id)
        game.status = OpenGameStatus.CANCELLED
        game.cancelled_at = NOW
        session.commit()

        context = _service(session).get_context(
            share_token=case.share_token,
            viewer_user_id=case.booking.stranger_id,
        )

    assert context.viewer_registration is not None
    assert context.viewer_registration.persisted_status == "WITHDRAWN"
    assert context.viewer_registration.effective_status == "CANCELLED"
    assert context.viewer_registration.withdrawal_kind == "APPLICATION_WITHDRAWAL"
    assert context.viewer_registration.withdrawn_at == NOW


class _FailingContextRepository(OpenGameRegistrationRepository):
    def count_joined(self, *, game_id: uuid.UUID) -> int:
        raise SQLAlchemyError("injected secret context read failure")


class _FailingQueueRepository(OpenGameRegistrationRepository):
    def list_pending(self, *, game_id: uuid.UUID) -> list[OpenGameRegistration]:
        raise SQLAlchemyError("injected secret queue read failure")


class _FailingInsertRepository(OpenGameRegistrationRepository):
    def add_registration(self, registration: OpenGameRegistration) -> None:
        super().add_registration(registration)
        raise SQLAlchemyError("injected secret registration flush failure")


class _BlindExistingRegistrationRepository(OpenGameRegistrationRepository):
    def get_registration(
        self,
        *,
        game_id: uuid.UUID,
        applicant_user_id: uuid.UUID,
    ) -> OpenGameRegistration | None:
        return None


class _FailingDecisionFlushRepository(OpenGameRegistrationRepository):
    def flush(self) -> None:
        super().flush()
        raise SQLAlchemyError("injected secret decision flush failure")


class _FailingWithdrawalFlushRepository(OpenGameRegistrationRepository):
    def flush(self) -> None:
        super().flush()
        raise SQLAlchemyError("injected secret withdrawal flush failure")


class _FailingPromotionFlushRepository(OpenGameRegistrationRepository):
    def __init__(self, session: Session) -> None:
        super().__init__(session)
        self._flush_count = 0

    def flush(self) -> None:
        self._flush_count += 1
        super().flush()
        if self._flush_count == 2:
            raise SQLAlchemyError("injected secret promotion flush failure")


class _FailingOutboxRepository(OpenGameRegistrationRepository):
    def add_notification(self, notification: OpenGameNotificationOutbox) -> None:
        super().add_notification(notification)
        raise SQLAlchemyError("injected secret outbox write failure")


class _FailingCompletionOrderRepository(OrderRepository):
    def complete_idempotency(self, *args: object, **kwargs: object) -> None:
        raise SQLAlchemyError("injected secret completion failure")


class _FailingCommitOrderRepository(OrderRepository):
    def commit(self) -> None:
        raise SQLAlchemyError("injected secret commit failure")


def test_waitlist_flush_failure_rolls_back_sequence_timestamps_and_idempotency(
    pg_engine: Engine,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        game = session.get_one(OpenGame, case.game_id)
        game.open_spots = 1
        joined_user = _new_user(session, "waitlist-flush-joined")
        _add_registration(
            session,
            game_id=game.id,
            applicant_user_id=joined_user.id,
            status=OpenGameRegistrationStatus.JOINED,
            decided_by_user_id=case.booking.owner_id,
        )
        target = _add_registration(
            session,
            game_id=game.id,
            applicant_user_id=case.booking.stranger_id,
            status=OpenGameRegistrationStatus.APPLIED,
        )
        session.commit()
        before = _c1a_snapshot(session)

        with pytest.raises(AppError) as unavailable:
            _service(
                session,
                registration_repository=_FailingDecisionFlushRepository(session),
            ).decide(
                game_id=game.id,
                application_id=target.id,
                owner_user_id=case.booking.owner_id,
                idempotency_key="waitlist-failing-flush-key-000001",
                request=_decision(ApplicationDecision.WAITLIST),
            )

        assert (unavailable.value.status_code, unavailable.value.code) == (
            503,
            "SERVICE_UNAVAILABLE",
        )
        assert _c1a_snapshot(session) == before


def test_withdrawal_flush_failure_rolls_back_audit_status_and_idempotency(
    pg_engine: Engine,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        target = _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=case.booking.stranger_id,
            status=OpenGameRegistrationStatus.JOINED,
            decided_by_user_id=case.booking.owner_id,
        )
        session.commit()
        before_c1a = _c1a_snapshot(session)
        before_b1 = _b1_snapshot(session)

        with pytest.raises(AppError) as unavailable:
            _service(
                session,
                registration_repository=_FailingWithdrawalFlushRepository(session),
            ).withdraw(
                application_id=target.id,
                applicant_user_id=case.booking.stranger_id,
                idempotency_key="failing-withdrawal-flush-key-00001",
                request=_withdrawal(
                    WithdrawalAction.LEAVE_GAME,
                    expected_version=2,
                ),
            )

        assert (unavailable.value.status_code, unavailable.value.code) == (
            503,
            "SERVICE_UNAVAILABLE",
        )
        assert _c1a_snapshot(session) == before_c1a
        assert _b1_snapshot(session) == before_b1


@pytest.mark.parametrize("failure", ["outbox", "promotion_flush", "completion"])
def test_promotion_failure_rolls_back_exit_candidate_outbox_and_idempotency(
    pg_engine: Engine,
    failure: str,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        game = session.get_one(OpenGame, case.game_id)
        game.open_spots = 1
        departing = _add_registration(
            session,
            game_id=game.id,
            applicant_user_id=case.booking.stranger_id,
            status=OpenGameRegistrationStatus.JOINED,
            decided_by_user_id=case.booking.owner_id,
        )
        candidate_user = _new_user(session, f"rollback-{failure}")
        _add_registration(
            session,
            game_id=game.id,
            applicant_user_id=candidate_user.id,
            status=OpenGameRegistrationStatus.WAITLISTED,
            decided_by_user_id=case.booking.owner_id,
            waitlist_seq=1,
            waitlisted_at=NOW - timedelta(minutes=5),
        )
        session.commit()
        before_c1a = _c1a_snapshot(session)
        before_b1 = _b1_snapshot(session)
        registration_repository: OpenGameRegistrationRepository | None = None
        order_repository: OrderRepository | None = None
        if failure == "outbox":
            registration_repository = _FailingOutboxRepository(session)
        elif failure == "promotion_flush":
            registration_repository = _FailingPromotionFlushRepository(session)
        else:
            order_repository = _FailingCompletionOrderRepository(session)

        with pytest.raises(AppError) as unavailable:
            _service(
                session,
                registration_repository=registration_repository,
                order_repository=order_repository,
            ).withdraw(
                application_id=departing.id,
                applicant_user_id=case.booking.stranger_id,
                idempotency_key=f"promotion-{failure}-rollback-key-0001",
                request=_withdrawal(
                    WithdrawalAction.LEAVE_GAME,
                    expected_version=2,
                ),
            )

        assert (unavailable.value.status_code, unavailable.value.code) == (
            503,
            "SERVICE_UNAVAILABLE",
        )
        assert _c1a_snapshot(session) == before_c1a
        assert _b1_snapshot(session) == before_b1


def test_named_applicant_insert_race_maps_to_duplicate_and_rolls_back_claim(
    pg_engine: Engine,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        existing = _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=case.booking.stranger_id,
            status=OpenGameRegistrationStatus.REJECTED,
            decided_by_user_id=case.booking.owner_id,
        )
        session.commit()

        with pytest.raises(AppError) as duplicate:
            _service(
                session,
                registration_repository=_BlindExistingRegistrationRepository(
                    session
                ),
            ).apply(
                share_token=case.share_token,
                applicant_user_id=case.booking.stranger_id,
                idempotency_key="named-race-application-key-000001",
                request=_request(),
            )

        assert (duplicate.value.status_code, duplicate.value.code) == (
            409,
            "APPLICATION_ALREADY_EXISTS",
        )
        assert session.get_one(OpenGameRegistration, existing.id).status == "REJECTED"
        assert session.scalar(select(func.count()).select_from(OpenGameRegistration)) == 1
        assert session.scalar(select(func.count()).select_from(IdempotencyRecord)) == 0


def test_context_database_failure_rolls_back_and_returns_closed_503(
    pg_engine: Engine,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        before = _b1_snapshot(session)
        with pytest.raises(AppError) as unavailable:
            _service(
                session,
                registration_repository=_FailingContextRepository(session),
            ).get_context(
                share_token=case.share_token,
                viewer_user_id=case.booking.stranger_id,
            )
        assert (unavailable.value.status_code, unavailable.value.code) == (
            503,
            "SERVICE_UNAVAILABLE",
        )
        assert unavailable.value.message == "服务暂时不可用，请稍后重试。"
        assert _b1_snapshot(session) == before

    with Session(pg_engine) as session:
        assert session.scalar(select(func.count()).select_from(OpenGameRegistration)) == 0
        assert session.scalar(select(func.count()).select_from(IdempotencyRecord)) == 0


@pytest.mark.parametrize("failure", ["insert", "completion", "commit"])
def test_apply_database_failure_rolls_back_all_c1a_and_b1_rows(
    pg_engine: Engine,
    failure: str,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        before = _b1_snapshot(session)
        registration_repository: OpenGameRegistrationRepository | None = None
        order_repository: OrderRepository | None = None
        if failure == "insert":
            registration_repository = _FailingInsertRepository(session)
        elif failure == "completion":
            order_repository = _FailingCompletionOrderRepository(session)
        else:
            order_repository = _FailingCommitOrderRepository(session)

        with pytest.raises(AppError) as unavailable:
            _service(
                session,
                registration_repository=registration_repository,
                order_repository=order_repository,
            ).apply(
                share_token=case.share_token,
                applicant_user_id=case.booking.stranger_id,
                idempotency_key=APPLICATION_KEY,
                request=_request(),
            )
        assert (unavailable.value.status_code, unavailable.value.code) == (
            503,
            "SERVICE_UNAVAILABLE",
        )
        assert unavailable.value.message == "服务暂时不可用，请稍后重试。"
        assert _b1_snapshot(session) == before

    with Session(pg_engine) as session:
        assert session.scalar(select(func.count()).select_from(OpenGameRegistration)) == 0
        assert session.scalar(select(func.count()).select_from(IdempotencyRecord)) == 0


def test_queue_database_failure_rolls_back_and_returns_closed_503(
    pg_engine: Engine,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=case.booking.stranger_id,
            status=OpenGameRegistrationStatus.APPLIED,
        )
        session.commit()
        before_c1a = _c1a_snapshot(session)
        before_b1 = _b1_snapshot(session)

        with pytest.raises(AppError) as unavailable:
            _service(
                session,
                registration_repository=_FailingQueueRepository(session),
            ).get_queue(
                game_id=case.game_id,
                owner_user_id=case.booking.owner_id,
            )

        assert (unavailable.value.status_code, unavailable.value.code) == (
            503,
            "SERVICE_UNAVAILABLE",
        )
        assert unavailable.value.message == "服务暂时不可用，请稍后重试。"
        assert unavailable.value.details == {}
        assert _c1a_snapshot(session) == before_c1a
        assert _b1_snapshot(session) == before_b1


@pytest.mark.parametrize("failure", ["flush", "completion", "commit"])
def test_decision_database_failure_rolls_back_all_c1a_and_b1_rows(
    pg_engine: Engine,
    failure: str,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        target = _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=case.booking.stranger_id,
            status=OpenGameRegistrationStatus.APPLIED,
        )
        session.commit()
        before_c1a = _c1a_snapshot(session)
        before_b1 = _b1_snapshot(session)
        registration_repository: OpenGameRegistrationRepository | None = None
        order_repository: OrderRepository | None = None
        if failure == "flush":
            registration_repository = _FailingDecisionFlushRepository(session)
        elif failure == "completion":
            order_repository = _FailingCompletionOrderRepository(session)
        else:
            order_repository = _FailingCommitOrderRepository(session)

        with pytest.raises(AppError) as unavailable:
            _service(
                session,
                registration_repository=registration_repository,
                order_repository=order_repository,
            ).decide(
                game_id=case.game_id,
                application_id=target.id,
                owner_user_id=case.booking.owner_id,
                idempotency_key=f"failing-{failure}-decision-key-000001",
                request=_decision(ApplicationDecision.ACCEPT),
            )

        assert (unavailable.value.status_code, unavailable.value.code) == (
            503,
            "SERVICE_UNAVAILABLE",
        )
        assert unavailable.value.message == "服务暂时不可用，请稍后重试。"
        assert unavailable.value.details == {}
        assert _c1a_snapshot(session) == before_c1a
        assert _b1_snapshot(session) == before_b1
