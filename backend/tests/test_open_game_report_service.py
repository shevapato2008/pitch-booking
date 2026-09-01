from __future__ import annotations

import json
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.orm import Session

from backend.app.errors import AppError
from backend.app.modules.open_game_reports.dto import OpenGameReportSubmissionRequest
from backend.app.modules.open_game_reports.repository import OpenGameReportRepository
from backend.app.modules.open_game_reports.service import OpenGameReportService
from backend.app.modules.open_game_reports.text_policy import (
    ReportTextError,
    normalize_and_validate_report_text,
)
from backend.tests.postgres_test_database import (
    disposable_database,
    override_test_database_url,
)
from backend.tests.test_open_game_registration_schema import (
    _insert_registration,
    _seed_registration_parents,
    _valid_registration,
)

pytestmark = pytest.mark.integration

REGISTRATION_ID = UUID("56000000-0000-4000-8000-000000000001")


@pytest.fixture
def report_engine(test_database_url: str) -> Iterator[Engine]:
    with disposable_database(test_database_url) as migration_url:
        rendered = migration_url.render_as_string(hide_password=False)
        with override_test_database_url(rendered):
            engine = create_engine(migration_url)
            config = Config("alembic.ini")
            config.set_main_option("sqlalchemy.url", rendered)
            command.upgrade(config, "head")
            try:
                yield engine
            finally:
                engine.dispose()


def _seed_reporter(engine: Engine) -> tuple[UUID, UUID, UUID]:
    captain_id, game_id, applicant_ids = _seed_registration_parents(engine)
    _insert_registration(
        engine,
        _valid_registration(
            registration_id=REGISTRATION_ID,
            game_id=game_id,
            applicant_user_id=applicant_ids[0],
        ),
    )
    return captain_id, game_id, applicant_ids[0]


def _service(session: Session, *, now: datetime) -> OpenGameReportService:
    return OpenGameReportService(
        repository=OpenGameReportRepository(session),
        now=lambda: now,
    )


def test_reporter_context_submission_and_idempotent_replay(
    report_engine: Engine,
) -> None:
    captain_id, game_id, reporter_id = _seed_reporter(report_engine)
    now = datetime(2026, 9, 1, 12, 30, tzinfo=UTC)
    request = OpenGameReportSubmissionRequest(
        category="FALSE_INFORMATION",
        facts="公开说明称费用已包含，但现场要求额外支付场地费。",
    )

    with Session(report_engine) as session:
        service = _service(session, now=now)
        context = service.get_my_report(game_id=game_id, reporter_user_id=reporter_id)
        assert context.submission_allowed is True
        assert context.submission_blocker is None
        assert context.report is None
        assert context.target.game_id == game_id
        assert context.target.organizer_team_name == "逐光队"

        submitted = service.submit(
            game_id=game_id,
            reporter_user_id=reporter_id,
            idempotency_key="submit-game-report-0001",
            request=request,
        )
        assert submitted.created is True
        assert submitted.report.status == "PENDING"
        assert submitted.report.outcome is None

        replay = service.submit(
            game_id=game_id,
            reporter_user_id=reporter_id,
            idempotency_key="submit-game-report-0001",
            request=request,
        )
        assert replay.created is False
        assert replay.report.report_id == submitted.report.report_id
        assert (
            service.get_my_report(
                game_id=game_id,
                reporter_user_id=reporter_id,
            ).report
            == submitted.report
        )

        with pytest.raises(AppError) as duplicate:
            service.submit(
                game_id=game_id,
                reporter_user_id=reporter_id,
                idempotency_key="submit-game-report-0002",
                request=request,
            )
        assert duplicate.value.status_code == 409
        assert duplicate.value.code == "REPORT_ALREADY_EXISTS"

        with pytest.raises(AppError) as reused:
            service.submit(
                game_id=game_id,
                reporter_user_id=reporter_id,
                idempotency_key="submit-game-report-0001",
                request=OpenGameReportSubmissionRequest(
                    category="EXTRA_CHARGE",
                    facts="现场临时要求额外支付费用。",
                ),
            )
        assert reused.value.status_code == 409
        assert reused.value.code == "IDEMPOTENCY_KEY_REUSED"

    assert captain_id != reporter_id


def test_context_requires_persisted_registration_and_uses_strict_deadline(
    report_engine: Engine,
) -> None:
    _, game_id, reporter_id = _seed_reporter(report_engine)
    with report_engine.connect() as connection:
        ends_at = connection.execute(
            text(
                "SELECT slots.ends_at FROM slots "
                "JOIN orders ON orders.slot_id = slots.id "
                "JOIN open_games ON open_games.order_id = orders.id "
                "WHERE open_games.id = :game_id"
            ),
            {"game_id": game_id},
        ).scalar_one()

    with Session(report_engine) as session:
        context = _service(
            session,
            now=ends_at + timedelta(days=30),
        ).get_my_report(game_id=game_id, reporter_user_id=reporter_id)
        assert context.submission_allowed is False
        assert context.submission_blocker == "REPORTING_WINDOW_CLOSED"

    with Session(report_engine) as session:
        with pytest.raises(AppError) as missing:
            _service(session, now=datetime.now(UTC)).get_my_report(
                game_id=game_id,
                reporter_user_id=UUID("56000000-0000-4000-8000-000000000099"),
            )
        assert missing.value.status_code == 404
        assert missing.value.code == "REPORT_CONTEXT_NOT_FOUND"


def test_shared_text_policy_matches_contract_vectors() -> None:
    vectors = json.loads(
        (
            Path(__file__).resolve().parents[2] / "contracts/examples/game-report-text-vectors.json"
        ).read_text()
    )["vectors"]
    for vector in vectors:
        if vector["valid"]:
            assert normalize_and_validate_report_text(vector["input"]) == vector["normalized"]
        else:
            with pytest.raises(ReportTextError) as error:
                normalize_and_validate_report_text(vector["input"])
            assert error.value.code == vector["error"]
