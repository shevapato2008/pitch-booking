from __future__ import annotations

import hashlib
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime

import pytest
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session

from backend.app.errors import AppError
from backend.app.models import OpenGameReport, OpenGameReportResolution, UserSession
from backend.app.modules.open_game_reports.dto import OpenGameReportSubmissionRequest
from backend.app.modules.open_game_reports.repository import OpenGameReportRepository
from backend.app.modules.open_game_reports.service import OpenGameReportService
from backend.app.modules.platform_game_reports.dto import (
    PlatformGameReportResolutionRequest,
)
from backend.app.modules.platform_game_reports.repository import (
    PlatformGameReportRepository,
)
from backend.app.modules.platform_game_reports.service import PlatformGameReportService
from backend.tests.test_open_game_registration_api import APPLICANT_TOKEN
from backend.tests.test_open_game_report_api import _seed_report_context
from backend.tests.test_platform_game_report_service import _seed_report

pytestmark = pytest.mark.integration


def test_concurrent_report_submissions_create_exactly_one_immutable_row(
    pg_engine: Engine,
) -> None:
    game_id = _seed_report_context(pg_engine)
    with Session(pg_engine) as session:
        reporter_id = session.scalar(
            select(UserSession.user_id).where(
                UserSession.token_hash == hashlib.sha256(APPLICANT_TOKEN.encode()).hexdigest()
            )
        )
    assert reporter_id is not None
    barrier = threading.Barrier(2)
    request = OpenGameReportSubmissionRequest(
        category="FALSE_INFORMATION",
        facts="公开说明与现场收费安排不一致，请平台核实。",
    )

    def submit(key: str) -> tuple[str, str]:
        with Session(pg_engine) as session:
            barrier.wait()
            try:
                result = OpenGameReportService(
                    repository=OpenGameReportRepository(session),
                    now=lambda: datetime.now(UTC),
                ).submit(
                    game_id=uuid.UUID(game_id),
                    reporter_user_id=reporter_id,
                    idempotency_key=key,
                    request=request,
                )
                return "ok", str(result.report.report_id)
            except AppError as error:
                return "error", error.code

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(
            executor.map(
                submit,
                ("concurrent-report-key-000001", "concurrent-report-key-000002"),
            )
        )

    assert sorted(kind for kind, _value in results) == ["error", "ok"]
    assert {value for kind, value in results if kind == "error"} == {"REPORT_ALREADY_EXISTS"}
    with Session(pg_engine) as session:
        assert session.scalar(select(func.count()).select_from(OpenGameReport)) == 1


def test_concurrent_platform_resolution_is_single_and_auditable(
    pg_engine: Engine,
) -> None:
    report_id, _game_id, _order_id, now, _booking = _seed_report(pg_engine)
    barrier = threading.Barrier(2)
    request = PlatformGameReportResolutionRequest(
        outcome="CONFIRMED_RECORDED",
        resolution_note="已核对公开信息与双方陈述，记录本次成立结论。",
    )

    def resolve(key: str) -> tuple[str, str]:
        with Session(pg_engine) as session:
            barrier.wait()
            try:
                result = PlatformGameReportService(
                    repository=PlatformGameReportRepository(session),
                    now=lambda: now,
                ).resolve(
                    report_id=report_id,
                    principal_id="platform-admin-yangfan",
                    idempotency_key=key,
                    request=request,
                )
                return "ok", str(result.resolution_id)
            except AppError as error:
                return "error", error.code

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(
            executor.map(
                resolve,
                (
                    "concurrent-resolution-key-0001",
                    "concurrent-resolution-key-0002",
                ),
            )
        )

    assert sorted(kind for kind, _value in results) == ["error", "ok"]
    assert {value for kind, value in results if kind == "error"} == {"REPORT_ALREADY_RESOLVED"}
    with Session(pg_engine) as session:
        assert session.scalar(select(func.count()).select_from(OpenGameReportResolution)) == 1
