from __future__ import annotations

import hashlib
import json
import uuid
from collections.abc import Callable
from datetime import datetime, timedelta

from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from backend.app.errors import AppError
from backend.app.models import OpenGameReport, OpenGameReportResolutionOutcome
from backend.app.modules.open_game_reports.dto import (
    OpenGameReportContext,
    OpenGameReportForReporter,
    OpenGameReportStatus,
    OpenGameReportSubmissionBlocker,
    OpenGameReportSubmissionRequest,
    OpenGameReportSubmissionResult,
    OpenGameReportTargetSummary,
)
from backend.app.modules.open_game_reports.repository import (
    OpenGameReportRepository,
    ReportGraph,
    ReportWithResolution,
)
from backend.app.modules.open_game_reports.text_policy import (
    ReportTextError,
    normalize_and_validate_report_text,
)

SUBMIT_OPEN_GAME_REPORT_OPERATION = "SUBMIT_OPEN_GAME_REPORT"


class OpenGameReportService:
    def __init__(
        self,
        *,
        repository: OpenGameReportRepository,
        now: Callable[[], datetime],
    ) -> None:
        self.repository = repository
        self.now = now

    def get_my_report(
        self, *, game_id: uuid.UUID, reporter_user_id: uuid.UUID
    ) -> OpenGameReportContext:
        try:
            graph = self.repository.get_graph(game_id=game_id, reporter_user_id=reporter_user_id)
            if graph is None:
                raise _context_not_found()
            bundle = self.repository.get_report(game_id=game_id, reporter_user_id=reporter_user_id)
            context = _context(graph, bundle, now=self.now())
            self.repository.commit()
            return context
        except AppError:
            self.repository.rollback()
            raise
        except (SQLAlchemyError, ValidationError, ValueError, RuntimeError):
            self.repository.rollback()
            raise _service_unavailable() from None

    def submit(
        self,
        *,
        game_id: uuid.UUID,
        reporter_user_id: uuid.UUID,
        idempotency_key: str,
        request: OpenGameReportSubmissionRequest,
    ) -> OpenGameReportSubmissionResult:
        if not 16 <= len(idempotency_key) <= 128:
            raise _invalid_argument("idempotency_key")
        try:
            facts = normalize_and_validate_report_text(request.facts)
        except ReportTextError as error:
            if error.code == "SENSITIVE_CONTENT_NOT_ALLOWED":
                raise AppError(
                    422,
                    error.code,
                    "说明中不能包含联系方式、链接或控制字符。",
                    details={"field": "facts"},
                ) from None
            raise _invalid_argument("facts") from None

        try:
            target = self.repository.locate_target(
                game_id=game_id, reporter_user_id=reporter_user_id
            )
            if target is None:
                raise _context_not_found()
            order = self.repository.lock_order(target.order_id)
            if order is None:
                raise _context_not_found()
            game = self.repository.lock_game(game_id=game_id, order_id=order.id)
            if game is None:
                raise _context_not_found()
            registration = self.repository.lock_registration(
                registration_id=target.registration_id,
                game_id=game.id,
                reporter_user_id=reporter_user_id,
            )
            if registration is None:
                raise _context_not_found()
            graph = self.repository.get_graph(game_id=game.id, reporter_user_id=reporter_user_id)
            if (
                graph is None
                or graph.order.id != order.id
                or graph.registration.id != registration.id
                or graph.order.user_id != graph.team.captain_user_id
            ):
                raise _context_not_found()
            digest = _digest(
                game_id=game.id,
                registration_id=registration.id,
                organizer_user_id=order.user_id,
                category=request.category.value,
                facts=facts,
            )
            replay = self.repository.get_idempotency_report(
                reporter_user_id=reporter_user_id,
                idempotency_key=idempotency_key,
            )
            if replay is not None:
                return self._finish_replay(replay, digest=digest)
            if (
                self.repository.get_report(game_id=game.id, reporter_user_id=reporter_user_id)
                is not None
            ):
                raise _already_exists()
            now = self.now()
            if now >= graph.slot.ends_at + timedelta(days=30):
                raise _window_closed()

            report = OpenGameReport(
                id=uuid.uuid4(),
                game_id=game.id,
                reporter_registration_id=registration.id,
                reporter_user_id=reporter_user_id,
                organizer_user_id=order.user_id,
                category=request.category,
                facts=facts,
                submitted_at=now,
                idempotency_key=idempotency_key,
                request_sha256=digest,
            )
            self.repository.add_report(report)
            try:
                self.repository.flush()
            except IntegrityError as error:
                constraint = _constraint_name(error)
                self.repository.rollback()
                if constraint == "uq_open_game_reports_reporter_idempotency_key":
                    persisted = self.repository.get_idempotency_report(
                        reporter_user_id=reporter_user_id,
                        idempotency_key=idempotency_key,
                    )
                    if persisted is None:
                        raise _service_unavailable() from None
                    return self._finish_replay(persisted, digest=digest)
                if constraint == "uq_open_game_reports_game_reporter":
                    raise _already_exists() from None
                raise
            result = OpenGameReportSubmissionResult(
                report=_report(ReportWithResolution(report=report, resolution=None)),
                created=True,
            )
            self.repository.commit()
            return result
        except AppError:
            self.repository.rollback()
            raise
        except (SQLAlchemyError, ValidationError, ValueError, RuntimeError):
            self.repository.rollback()
            raise _service_unavailable() from None

    def _finish_replay(
        self, bundle: ReportWithResolution, *, digest: str
    ) -> OpenGameReportSubmissionResult:
        if bundle.report.request_sha256 != digest:
            raise _idempotency_reused()
        result = OpenGameReportSubmissionResult(
            report=_report(bundle),
            created=False,
        )
        self.repository.commit()
        return result


def _context(
    graph: ReportGraph,
    bundle: ReportWithResolution | None,
    *,
    now: datetime,
) -> OpenGameReportContext:
    deadline = graph.slot.ends_at + timedelta(days=30)
    report = _report(bundle) if bundle is not None else None
    blocker = (
        OpenGameReportSubmissionBlocker.REPORT_ALREADY_EXISTS
        if report is not None
        else OpenGameReportSubmissionBlocker.REPORTING_WINDOW_CLOSED
        if now >= deadline
        else None
    )
    time_zone = graph.venue.timezone
    if time_zone != "Asia/Shanghai":
        raise RuntimeError("report target timezone is unsupported")
    return OpenGameReportContext(
        target=OpenGameReportTargetSummary(
            game_id=graph.game.id,
            game_name=graph.game.name,
            organizer_team_name=graph.team.name,
            venue_name=graph.venue.name,
            pitch_name=graph.pitch.name,
            starts_at=graph.slot.starts_at,
            ends_at=graph.slot.ends_at,
            time_zone="Asia/Shanghai",
        ),
        report_deadline=deadline,
        submission_allowed=blocker is None,
        submission_blocker=blocker,
        report=report,
    )


def _report(bundle: ReportWithResolution) -> OpenGameReportForReporter:
    resolution = bundle.resolution
    if resolution is None:
        return OpenGameReportForReporter(
            report_id=bundle.report.id,
            category=bundle.report.category,
            facts=bundle.report.facts,
            submitted_at=bundle.report.submitted_at,
            status=OpenGameReportStatus.PENDING,
            outcome=None,
            resolved_at=None,
            result_title=None,
            result_message=None,
        )
    title, message = {
        OpenGameReportResolutionOutcome.DISMISSED: (
            "本次举报未确认成立",
            "平台已完成核实并结案。",
        ),
        OpenGameReportResolutionOutcome.CONFIRMED_RECORDED: (
            "举报成立，已记录",
            "平台已记录本次核实结论。",
        ),
        OpenGameReportResolutionOutcome.CONFIRMED_GAME_CANCELLED: (
            "举报成立，球局已取消",
            "平台已取消公开球局；订场订单和退款状态不因此改变。",
        ),
    }[resolution.outcome]
    return OpenGameReportForReporter(
        report_id=bundle.report.id,
        category=bundle.report.category,
        facts=bundle.report.facts,
        submitted_at=bundle.report.submitted_at,
        status=OpenGameReportStatus.RESOLVED,
        outcome=resolution.outcome,
        resolved_at=resolution.resolved_at,
        result_title=title,
        result_message=message,
    )


def _digest(
    *,
    game_id: uuid.UUID,
    registration_id: uuid.UUID,
    organizer_user_id: uuid.UUID,
    category: str,
    facts: str,
) -> str:
    payload = {
        "operation": SUBMIT_OPEN_GAME_REPORT_OPERATION,
        "game_id": str(game_id),
        "registration_id": str(registration_id),
        "organizer_user_id": str(organizer_user_id),
        "category": category,
        "facts": facts,
        "schema_version": 1,
    }
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


def _constraint_name(error: IntegrityError) -> str | None:
    return getattr(getattr(error.orig, "diag", None), "constraint_name", None)


def _invalid_argument(field: str) -> AppError:
    return AppError(422, "INVALID_ARGUMENT", "请求参数格式不正确。", {"field": field})


def _context_not_found() -> AppError:
    return AppError(404, "REPORT_CONTEXT_NOT_FOUND", "未找到可举报的球局报名。")


def _window_closed() -> AppError:
    return AppError(409, "REPORTING_WINDOW_CLOSED", "本场球局的举报提交期限已结束。")


def _already_exists() -> AppError:
    return AppError(409, "REPORT_ALREADY_EXISTS", "你已提交过本场球局的举报。")


def _idempotency_reused() -> AppError:
    return AppError(409, "IDEMPOTENCY_KEY_REUSED", "幂等键已用于另一请求。")


def _service_unavailable() -> AppError:
    return AppError(503, "SERVICE_UNAVAILABLE", "举报服务暂时不可用。")
