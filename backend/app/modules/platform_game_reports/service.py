from __future__ import annotations

import base64
import hashlib
import json
import uuid
from collections.abc import Callable
from datetime import datetime

from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from backend.app.errors import AppError
from backend.app.models import (
    OpenGameCancellationSource,
    OpenGameReportResolution,
    OpenGameReportResolutionOutcome,
    OpenGameStatus,
    Order,
    PaymentState,
    RefundCasePurpose,
)
from backend.app.modules.open_game_notifications.repository import (
    OpenGameNotificationRepository,
)
from backend.app.modules.open_game_reports.dto import (
    OpenGameReportStatus,
    OpenGameReportTargetSummary,
)
from backend.app.modules.open_game_reports.text_policy import (
    ReportTextError,
    normalize_and_validate_report_text,
)
from backend.app.modules.open_games.lifecycle import (
    EffectiveOpenGameState,
    OpenGameFacts,
    project_open_game_state,
    published_authority_is_healthy,
)
from backend.app.modules.open_games.repository import (
    OpenGameRepository,
    OrderAuthorityRows,
)
from backend.app.modules.orders.lifecycle import OrderLifecycleFacts
from backend.app.modules.platform_game_reports.dto import (
    PlatformGameReportAuthority,
    PlatformGameReportCancellationBlockedReason,
    PlatformGameReportDetail,
    PlatformGameReportList,
    PlatformGameReportQueueItem,
    PlatformGameReportResolution,
    PlatformGameReportResolutionRequest,
)
from backend.app.modules.platform_game_reports.repository import (
    PlatformGameReportRepository,
    PlatformReportGraph,
)

RESOLVE_PLATFORM_GAME_REPORT_OPERATION = "RESOLVE_PLATFORM_GAME_REPORT"
_PAYMENT_MAY_EXIST = frozenset(
    {
        PaymentState.CREATING,
        PaymentState.PREPAY_CREATED,
        PaymentState.CONFIRMING,
        PaymentState.UNKNOWN,
        PaymentState.SUCCESS,
    }
)
_CONTROLLING_REFUND_PURPOSES = frozenset(
    {
        RefundCasePurpose.ORDER_CANCELLATION,
        RefundCasePurpose.PAYMENT_INVENTORY_CONFLICT,
    }
)


class PlatformGameReportService:
    def __init__(
        self,
        *,
        repository: PlatformGameReportRepository,
        now: Callable[[], datetime],
    ) -> None:
        self.repository = repository
        self.now = now
        self.open_games = OpenGameRepository(repository.session)
        self.notifications = OpenGameNotificationRepository(repository.session)

    def list_reports(
        self,
        *,
        state: OpenGameReportStatus,
        limit: int,
        cursor: str | None,
    ) -> PlatformGameReportList:
        try:
            submitted_at, report_id = _decode_cursor(cursor)
            graphs = self.repository.list_graphs(
                resolved=state is OpenGameReportStatus.RESOLVED,
                limit=limit,
                cursor_submitted_at=submitted_at,
                cursor_id=report_id,
            )
            page = graphs[:limit]
            next_cursor = (
                _encode_cursor(page[-1].report.submitted_at, page[-1].report.id)
                if len(graphs) > limit and page
                else None
            )
            result = PlatformGameReportList(
                items=tuple(_queue_item(graph) for graph in page),
                next_cursor=next_cursor,
            )
            self.repository.commit()
            return result
        except AppError:
            self.repository.rollback()
            raise
        except (SQLAlchemyError, ValidationError, ValueError, RuntimeError):
            self.repository.rollback()
            raise _service_unavailable() from None

    def get_report(self, report_id: uuid.UUID) -> PlatformGameReportDetail:
        try:
            graph, authority = self._lock_graph(report_id)
            detail = _detail(graph, authority=authority, now=self.now())
            self.repository.commit()
            return detail
        except AppError:
            self.repository.rollback()
            raise
        except (SQLAlchemyError, ValidationError, ValueError, RuntimeError):
            self.repository.rollback()
            raise _service_unavailable() from None

    def resolve(
        self,
        *,
        report_id: uuid.UUID,
        principal_id: str,
        idempotency_key: str,
        request: PlatformGameReportResolutionRequest,
    ) -> PlatformGameReportResolution:
        principal = principal_id.strip()
        if not 1 <= len(principal) <= 128 or not 16 <= len(idempotency_key) <= 128:
            raise _invalid_argument()
        try:
            note = normalize_and_validate_report_text(request.resolution_note)
        except ReportTextError as error:
            if error.code == "SENSITIVE_CONTENT_NOT_ALLOWED":
                raise AppError(
                    422,
                    error.code,
                    "处置说明中不能包含联系方式、链接或控制字符。",
                    details={"field": "resolution_note"},
                ) from None
            raise _invalid_argument() from None

        try:
            graph, authority = self._lock_graph(report_id)
            digest = _digest(
                report_id=report_id,
                game_id=graph.game.id,
                outcome=request.outcome,
                note=note,
            )
            replay = self.repository.get_idempotency_resolution(
                principal_id=principal,
                idempotency_key=idempotency_key,
            )
            if replay is not None:
                result = _replay(replay, digest=digest)
                self.repository.commit()
                return result
            if graph.resolution is not None:
                raise _already_resolved()

            now = self.now()
            detail_authority = _authority(graph, authority=authority, now=now)
            if (
                request.outcome is OpenGameReportResolutionOutcome.CONFIRMED_GAME_CANCELLED
                and not detail_authority.cancellation_allowed
            ):
                raise _state_changed()

            before: int | None = None
            after: int | None = None
            if request.outcome is OpenGameReportResolutionOutcome.CONFIRMED_GAME_CANCELLED:
                before = graph.game.version
                graph.game.status = OpenGameStatus.CANCELLED
                graph.game.cancelled_at = now
                graph.game.cancellation_source = OpenGameCancellationSource.PLATFORM_REPORT
                graph.game.version += 1
                after = graph.game.version
                self.repository.flush()
                self.notifications.supersede_unsent_for_game(
                    game_id=graph.game.id,
                    completed_at=now,
                )

            resolution = OpenGameReportResolution(
                id=uuid.uuid4(),
                report_id=graph.report.id,
                outcome=request.outcome,
                resolution_note=note,
                resolved_by_principal_id=principal,
                resolved_at=now,
                game_version_before=before,
                game_version_after=after,
                idempotency_key=idempotency_key,
                request_sha256=digest,
            )
            self.repository.add_resolution(resolution)
            try:
                self.repository.flush()
            except IntegrityError as error:
                constraint = _constraint_name(error)
                self.repository.rollback()
                if constraint == "uq_open_game_report_resolutions_principal_idempotency_key":
                    persisted = self.repository.get_idempotency_resolution(
                        principal_id=principal,
                        idempotency_key=idempotency_key,
                    )
                    if persisted is None:
                        raise _service_unavailable() from None
                    return _replay(persisted, digest=digest)
                if constraint == "uq_open_game_report_resolutions_report":
                    raise _already_resolved() from None
                raise
            result = _resolution(resolution)
            self.repository.commit()
            return result
        except AppError:
            self.repository.rollback()
            raise
        except (SQLAlchemyError, ValidationError, ValueError, RuntimeError):
            self.repository.rollback()
            raise _service_unavailable() from None

    def _lock_graph(self, report_id: uuid.UUID) -> tuple[PlatformReportGraph, OrderAuthorityRows]:
        target = self.repository.locate_target(report_id)
        if target is None:
            raise _not_found()
        order = self.repository.lock_order(target.order_id)
        if order is None:
            raise _not_found()
        game = self.repository.lock_game(
            game_id=target.game_id,
            order_id=order.id,
        )
        if game is None:
            raise _not_found()
        report = self.repository.lock_report(report_id=report_id, game_id=game.id)
        if report is None:
            raise _not_found()
        resolution = self.repository.get_resolution(report.id)
        authority = self.open_games.lock_order_authority(order_id=order.id)
        graph = self.repository.get_graph(report.id)
        if (
            graph is None
            or graph.order.id != order.id
            or graph.game.id != game.id
            or graph.report.id != report.id
            or graph.resolution != resolution
        ):
            raise RuntimeError("platform report graph changed while locked")
        return graph, authority


def _queue_item(graph: PlatformReportGraph) -> PlatformGameReportQueueItem:
    return PlatformGameReportQueueItem(
        report_id=graph.report.id,
        category=graph.report.category,
        status=(
            OpenGameReportStatus.RESOLVED
            if graph.resolution is not None
            else OpenGameReportStatus.PENDING
        ),
        target=_target(graph),
        submitted_at=graph.report.submitted_at,
    )


def _detail(
    graph: PlatformReportGraph,
    *,
    authority: OrderAuthorityRows,
    now: datetime,
) -> PlatformGameReportDetail:
    projected_authority = _authority(graph, authority=authority, now=now)
    if graph.resolution is not None:
        outcomes: tuple[OpenGameReportResolutionOutcome, ...] = ()
        status = OpenGameReportStatus.RESOLVED
    else:
        outcomes = (
            OpenGameReportResolutionOutcome.DISMISSED,
            OpenGameReportResolutionOutcome.CONFIRMED_RECORDED,
        )
        if projected_authority.cancellation_allowed:
            outcomes += (OpenGameReportResolutionOutcome.CONFIRMED_GAME_CANCELLED,)
        status = OpenGameReportStatus.PENDING
    return PlatformGameReportDetail(
        report_id=graph.report.id,
        category=graph.report.category,
        status=status,
        facts=graph.report.facts,
        submitted_at=graph.report.submitted_at,
        reporter_display_name=graph.registration.display_name,
        reporter_registration_status=graph.registration.status,
        target=_target(graph),
        authority=projected_authority,
        allowed_outcomes=outcomes,
        resolution=(_resolution(graph.resolution) if graph.resolution is not None else None),
    )


def _target(graph: PlatformReportGraph) -> OpenGameReportTargetSummary:
    if graph.venue.timezone != "Asia/Shanghai":
        raise RuntimeError("report target timezone is unsupported")
    return OpenGameReportTargetSummary(
        game_id=graph.game.id,
        game_name=graph.game.name,
        organizer_team_name=graph.team.name,
        venue_name=graph.venue.name,
        pitch_name=graph.pitch.name,
        starts_at=graph.slot.starts_at,
        ends_at=graph.slot.ends_at,
        time_zone="Asia/Shanghai",
    )


def _authority(
    graph: PlatformReportGraph,
    *,
    authority: OrderAuthorityRows,
    now: datetime,
) -> PlatformGameReportAuthority:
    facts = _order_facts(graph.order, graph.slot.starts_at, graph.slot.ends_at, authority)
    effective = project_open_game_state(
        OpenGameFacts(
            stored_status=graph.game.status,
            order_facts=facts,
            registration_deadline=graph.game.registration_deadline,
        )
    )
    blocker: PlatformGameReportCancellationBlockedReason | None = None
    if graph.resolution is not None:
        blocker = PlatformGameReportCancellationBlockedReason.REPORT_ALREADY_RESOLVED
    elif graph.slot.starts_at <= now:
        blocker = PlatformGameReportCancellationBlockedReason.GAME_ALREADY_STARTED
    elif graph.game.status is not OpenGameStatus.PUBLISHED:
        blocker = PlatformGameReportCancellationBlockedReason.GAME_NOT_PUBLISHED
    elif effective is not EffectiveOpenGameState.PUBLISHED or not published_authority_is_healthy(
        facts
    ):
        blocker = PlatformGameReportCancellationBlockedReason.GAME_AUTHORITY_UNHEALTHY
    return PlatformGameReportAuthority(
        persisted_status=graph.game.status,
        effective_status=effective,
        cancellation_source=graph.game.cancellation_source,
        version=graph.game.version,
        cancellation_allowed=blocker is None,
        cancellation_blocker=blocker,
    )


def _order_facts(
    order: Order,
    starts_at: datetime,
    ends_at: datetime,
    authority: OrderAuthorityRows,
) -> OrderLifecycleFacts:
    controlling = [
        item for item in authority.refund_cases if item.purpose in _CONTROLLING_REFUND_PURPOSES
    ]
    purpose = (
        max(controlling, key=lambda item: (item.created_at, item.id)).purpose
        if controlling
        else None
    )
    return OrderLifecycleFacts(
        status=order.status,
        starts_at=starts_at,
        ends_at=ends_at,
        cancel_requested_at=order.cancel_requested_at,
        checked_in_at=order.checked_in_at,
        payment_may_exist=any(item.status in _PAYMENT_MAY_EXIST for item in authority.payments),
        controlling_refund_purpose=purpose,
    )


def _resolution(row: OpenGameReportResolution) -> PlatformGameReportResolution:
    return PlatformGameReportResolution(
        resolution_id=row.id,
        outcome=row.outcome,
        resolution_note=row.resolution_note,
        resolved_by_principal_id=row.resolved_by_principal_id,
        resolved_at=row.resolved_at,
        game_version_before=row.game_version_before,
        game_version_after=row.game_version_after,
    )


def _digest(
    *,
    report_id: uuid.UUID,
    game_id: uuid.UUID,
    outcome: OpenGameReportResolutionOutcome,
    note: str,
) -> str:
    canonical = json.dumps(
        {
            "operation": RESOLVE_PLATFORM_GAME_REPORT_OPERATION,
            "report_id": str(report_id),
            "game_id": str(game_id),
            "outcome": outcome.value,
            "resolution_note": note,
            "schema_version": 1,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode()).hexdigest()


def _replay(resolution: OpenGameReportResolution, *, digest: str) -> PlatformGameReportResolution:
    if resolution.request_sha256 != digest:
        raise _idempotency_reused()
    return _resolution(resolution)


def _encode_cursor(submitted_at: datetime, report_id: uuid.UUID) -> str:
    raw = json.dumps(
        {"submitted_at": submitted_at.isoformat(), "report_id": str(report_id)},
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _decode_cursor(cursor: str | None) -> tuple[datetime | None, uuid.UUID | None]:
    if cursor is None:
        return None, None
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        value = json.loads(base64.b64decode(padded, altchars=b"-_", validate=True))
        if set(value) != {"submitted_at", "report_id"}:
            raise ValueError
        submitted_at = datetime.fromisoformat(value["submitted_at"])
        if submitted_at.tzinfo is None:
            raise ValueError
        return submitted_at, uuid.UUID(value["report_id"])
    except (ValueError, TypeError, json.JSONDecodeError, UnicodeDecodeError):
        raise _invalid_argument() from None


def _constraint_name(error: IntegrityError) -> str | None:
    return getattr(getattr(error.orig, "diag", None), "constraint_name", None)


def _not_found() -> AppError:
    return AppError(404, "REPORT_NOT_FOUND", "未找到该举报记录。")


def _invalid_argument() -> AppError:
    return AppError(422, "INVALID_ARGUMENT", "请求参数格式不正确，请检查后重试。")


def _state_changed() -> AppError:
    return AppError(409, "REPORT_RESOLUTION_STATE_CHANGED", "举报或球局状态已变化，请刷新后重试。")


def _already_resolved() -> AppError:
    return AppError(409, "REPORT_ALREADY_RESOLVED", "该举报已经完成处置。")


def _idempotency_reused() -> AppError:
    return AppError(409, "IDEMPOTENCY_KEY_REUSED", "幂等键已用于另一请求。")


def _service_unavailable() -> AppError:
    return AppError(503, "SERVICE_UNAVAILABLE", "举报处置服务暂时不可用。")
