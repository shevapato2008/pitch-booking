from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session

from backend.app.errors import AppError
from backend.app.models import (
    OpenGame,
    OpenGameRegistrationStatus,
    OpenGameReportResolutionOutcome,
    OpenGameStatus,
    Order,
    Payment,
    RefundAttempt,
    RefundCase,
)
from backend.app.modules.open_game_reports.dto import OpenGameReportSubmissionRequest
from backend.app.modules.open_game_reports.repository import OpenGameReportRepository
from backend.app.modules.open_game_reports.service import OpenGameReportService
from backend.app.modules.open_games.dto import OpenGameVersionRequest
from backend.app.modules.platform_game_reports.dto import (
    PlatformGameReportResolutionRequest,
)
from backend.app.modules.platform_game_reports.repository import (
    PlatformGameReportRepository,
)
from backend.app.modules.platform_game_reports.service import PlatformGameReportService
from backend.tests.test_open_game_registration_api import _seed_published_game
from backend.tests.test_open_game_registration_service import _add_registration
from backend.tests.test_open_game_service import (
    SeededOpenGameCase,
    add_stored_game,
    draft_request,
)
from backend.tests.test_open_game_service import (
    service as open_game_service,
)

pytestmark = pytest.mark.integration

PLATFORM_KEY = "platform-game-report-resolution-key-0001"


def _seed_report(
    engine: Engine,
) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID, datetime, SeededOpenGameCase]:
    case = _seed_published_game(engine)
    now = datetime.now(UTC)
    with Session(engine) as session:
        _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=case.booking.stranger_id,
            status=OpenGameRegistrationStatus.JOINED,
            display_name="甲",
            decided_by_user_id=case.booking.stranger_id,
        )
        session.commit()
    with Session(engine) as session:
        submitted = OpenGameReportService(
            repository=OpenGameReportRepository(session),
            now=lambda: now,
        ).submit(
            game_id=case.game_id,
            reporter_user_id=case.booking.stranger_id,
            idempotency_key=f"seed-report-{case.game_id}",
            request=OpenGameReportSubmissionRequest(
                category="EXTRA_CHARGE",
                facts="现场要求支付公开说明中未列出的额外费用。",
            ),
        )
    with Session(engine) as session:
        order_id = session.get_one(OpenGame, case.game_id).order_id
    assert submitted.report.report_id
    return submitted.report.report_id, case.game_id, order_id, now, case.booking


def _service(session: Session, *, now: datetime) -> PlatformGameReportService:
    return PlatformGameReportService(
        repository=PlatformGameReportRepository(session),
        now=lambda: now,
    )


@pytest.mark.parametrize(
    "outcome",
    [
        OpenGameReportResolutionOutcome.DISMISSED,
        OpenGameReportResolutionOutcome.CONFIRMED_RECORDED,
    ],
)
def test_platform_lists_reads_and_records_non_cancelling_resolution(
    pg_engine: Engine,
    outcome: OpenGameReportResolutionOutcome,
) -> None:
    report_id, game_id, _order_id, now, _booking = _seed_report(pg_engine)
    request = PlatformGameReportResolutionRequest(
        outcome=outcome,
        resolution_note="已核对公开页面、现场记录与双方陈述，完成本次人工结论。",
    )
    with Session(pg_engine) as session:
        service = _service(session, now=now)
        queue = service.list_reports(state="PENDING", limit=20, cursor=None)
        assert [item.report_id for item in queue.items] == [report_id]
        detail = service.get_report(report_id)
        assert detail.allowed_outcomes == (
            "DISMISSED",
            "CONFIRMED_RECORDED",
            "CONFIRMED_GAME_CANCELLED",
        )
        assert detail.reporter_display_name == "甲"
        resolved = service.resolve(
            report_id=report_id,
            principal_id="platform-admin-yangfan",
            idempotency_key=PLATFORM_KEY,
            request=request,
        )
        replay = service.resolve(
            report_id=report_id,
            principal_id="platform-admin-yangfan",
            idempotency_key=PLATFORM_KEY,
            request=request,
        )
        assert replay == resolved
        refreshed = service.get_report(report_id)
        assert refreshed.status == "RESOLVED"
        assert refreshed.allowed_outcomes == ()
        assert refreshed.resolution == resolved
        assert refreshed.authority.cancellation_blocker == "REPORT_ALREADY_RESOLVED"

        with pytest.raises(AppError) as duplicate:
            service.resolve(
                report_id=report_id,
                principal_id="platform-admin-yangfan",
                idempotency_key="platform-game-report-resolution-key-0002",
                request=request,
            )
        assert duplicate.value.code == "REPORT_ALREADY_RESOLVED"

    with Session(pg_engine) as session:
        assert session.get_one(OpenGame, game_id).status == "PUBLISHED"


def test_platform_cancel_changes_only_game_and_appends_resolution(
    pg_engine: Engine,
) -> None:
    report_id, game_id, order_id, now, booking = _seed_report(pg_engine)
    with Session(pg_engine) as session:
        before_order = _row(session.get_one(Order, order_id))
        before_payments = [
            _row(row)
            for row in session.scalars(select(Payment).where(Payment.order_id == order_id))
        ]
        before_cases = [
            _row(row)
            for row in session.scalars(select(RefundCase).where(RefundCase.order_id == order_id))
        ]
        case_ids = [row["id"] for row in before_cases]
        before_attempts = (
            [
                _row(row)
                for row in session.scalars(
                    select(RefundAttempt).where(RefundAttempt.refund_case_id.in_(case_ids))
                )
            ]
            if case_ids
            else []
        )

    with Session(pg_engine) as session:
        resolution = _service(session, now=now).resolve(
            report_id=report_id,
            principal_id="platform-admin-yangfan",
            idempotency_key=PLATFORM_KEY,
            request=PlatformGameReportResolutionRequest(
                outcome="CONFIRMED_GAME_CANCELLED",
                resolution_note="已核实严重事实，取消公开球局；订场订单与退款状态保持不变。",
            ),
        )
        assert resolution.game_version_after == resolution.game_version_before + 1

    with Session(pg_engine) as session:
        game = session.get_one(OpenGame, game_id)
        assert game.status == "CANCELLED"
        assert game.cancellation_source == "PLATFORM_REPORT"
        assert game.cancelled_at == now
        assert _row(session.get_one(Order, order_id)) == before_order
        assert [
            _row(row)
            for row in session.scalars(select(Payment).where(Payment.order_id == order_id))
        ] == before_payments
        assert [
            _row(row)
            for row in session.scalars(select(RefundCase).where(RefundCase.order_id == order_id))
        ] == before_cases
        assert (
            [
                _row(row)
                for row in session.scalars(
                    select(RefundAttempt).where(RefundAttempt.refund_case_id.in_(case_ids))
                )
            ]
            if case_ids
            else []
        ) == before_attempts

    with Session(pg_engine) as session, pytest.raises(AppError) as frozen:
        open_game_service(session).create_draft(
            user_id=booking.owner_id,
            order_id=order_id,
            idempotency_key="platform-cancelled-replacement-key-0001",
            request=draft_request(booking),
        )
    assert frozen.value.code == "ORDER_GAME_PLATFORM_CANCELLED"

    with Session(pg_engine) as session:
        legacy_draft = add_stored_game(
            session,
            seeded=booking,
            status=OpenGameStatus.DRAFT,
            team_name="绕过创建检查的旧草稿",
        )
        session.commit()
        draft_id = legacy_draft.id
    with Session(pg_engine) as session, pytest.raises(AppError) as publish_frozen:
        open_game_service(session).publish(
            user_id=booking.owner_id,
            game_id=draft_id,
            idempotency_key="platform-cancelled-publish-key-000001",
            request=OpenGameVersionRequest(expected_version=1),
        )
    assert publish_frozen.value.code == "ORDER_GAME_PLATFORM_CANCELLED"


def test_cancel_resolution_never_silently_downgrades_after_start(
    pg_engine: Engine,
) -> None:
    report_id, _game_id, _order_id, _now, _booking = _seed_report(pg_engine)
    with Session(pg_engine) as session:
        detail = _service(session, now=datetime.max.replace(tzinfo=UTC)).get_report(report_id)
        assert detail.allowed_outcomes == ("DISMISSED", "CONFIRMED_RECORDED")
        assert detail.authority.cancellation_blocker == "GAME_ALREADY_STARTED"

    with Session(pg_engine) as session:
        with pytest.raises(AppError) as changed:
            _service(session, now=datetime.max.replace(tzinfo=UTC)).resolve(
                report_id=report_id,
                principal_id="platform-admin-yangfan",
                idempotency_key=PLATFORM_KEY,
                request=PlatformGameReportResolutionRequest(
                    outcome="CONFIRMED_GAME_CANCELLED",
                    resolution_note="核实后申请取消，但此时球局已经开场。",
                ),
            )
        assert changed.value.code == "REPORT_RESOLUTION_STATE_CHANGED"


def test_captain_cancel_still_allows_replacement_draft(pg_engine: Engine) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        cancelled = open_game_service(session).cancel(
            user_id=case.booking.owner_id,
            game_id=case.game_id,
            idempotency_key="captain-cancel-for-replacement-key-0001",
            request=OpenGameVersionRequest(expected_version=1),
        )
        assert cancelled.persisted_status == "CANCELLED"
        assert session.get_one(OpenGame, case.game_id).cancellation_source == "CAPTAIN"
        replacement = open_game_service(session).create_draft(
            user_id=case.booking.owner_id,
            order_id=case.booking.order_id,
            idempotency_key="captain-cancel-replacement-key-000001",
            request=draft_request(case.booking, name="队长取消后的替代球局"),
        )
        assert replacement.persisted_status == "DRAFT"


def _row(model: object) -> dict[str, object]:
    table = model.__class__.__table__
    return {column.name: getattr(model, column.name) for column in table.columns}
