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
    OpenGame,
    OpenGameRegistration,
    OpenGameRegistrationPosition,
    OpenGameRegistrationStatus,
    OpenGameStatus,
    Order,
    Payment,
    RefundAttempt,
    RefundCase,
    RefundCasePurpose,
    Slot,
    User,
)
from backend.app.modules.open_game_registrations.dto import (
    OPEN_GAME_REGISTRATION_CONSENT_VERSION,
    CreateApplicationRequest,
)
from backend.app.modules.open_game_registrations.privacy import (
    VIEWER_REGISTRATION_FIELDS,
)
from backend.app.modules.open_game_registrations.repository import (
    OpenGameRegistrationRepository,
)
from backend.app.modules.open_game_registrations.service import (
    CREATE_OPEN_GAME_APPLICATION_OPERATION,
    OpenGameRegistrationService,
    _application_request_digest,
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


@dataclass(frozen=True, slots=True)
class SeededRegistrationCase:
    booking: SeededOpenGameCase
    game_id: uuid.UUID
    share_token: str


def _seed_published_game(
    engine: Engine,
    *,
    share_token: str = SHARE_TOKEN,
) -> SeededRegistrationCase:
    booking = seed_confirmed_order(
        engine,
        refund_purpose=RefundCasePurpose.DUPLICATE_CHARGE,
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
    display_name: str = "周末小翼",
    applied_at: datetime = NOW - timedelta(minutes=10),
    decided_by_user_id: uuid.UUID | None = None,
) -> OpenGameRegistration:
    terminal = status is not OpenGameRegistrationStatus.APPLIED
    row = OpenGameRegistration(
        id=uuid.uuid4(),
        game_id=game_id,
        applicant_user_id=applicant_user_id,
        display_name=display_name,
        position=OpenGameRegistrationPosition.FORWARD,
        note="可以补边路，按时到场。",
        status=status,
        version=2 if terminal else 1,
        consent_version=OPEN_GAME_REGISTRATION_CONSENT_VERSION,
        adult_confirmed_at=applied_at,
        risk_confirmed_at=applied_at,
        applied_at=applied_at,
        decided_at=NOW - timedelta(minutes=5) if terminal else None,
        decided_by_user_id=decided_by_user_id if terminal else None,
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
        ("full", "GAME_FULL"),
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
        elif condition == "full":
            game.open_spots = 1
            joined = _new_user(session, "joined")
            _add_registration(
                session,
                game_id=game.id,
                applicant_user_id=joined.id,
                status=OpenGameRegistrationStatus.JOINED,
                decided_by_user_id=case.booking.owner_id,
            )
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
        if condition == "full":
            assert context.remaining_spots == 0
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
        ("full", "GAME_FULL", 0),
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
        elif condition == "full":
            game.open_spots = 1
            joined = _new_user(session, "full-capacity")
            _add_registration(
                session,
                game_id=game.id,
                applicant_user_id=joined.id,
                status=OpenGameRegistrationStatus.JOINED,
                decided_by_user_id=case.booking.owner_id,
            )
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


class _FailingContextRepository(OpenGameRegistrationRepository):
    def count_joined(self, *, game_id: uuid.UUID) -> int:
        raise SQLAlchemyError("injected secret context read failure")


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


class _FailingCompletionOrderRepository(OrderRepository):
    def complete_idempotency(self, *args: object, **kwargs: object) -> None:
        raise SQLAlchemyError("injected secret completion failure")


class _FailingCommitOrderRepository(OrderRepository):
    def commit(self) -> None:
        raise SQLAlchemyError("injected secret commit failure")


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
