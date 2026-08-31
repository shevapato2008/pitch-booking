"""Lease-based worker for durable open-game notifications.

Delivery is at least once.  The final authority/token transaction persists
``delivery_started_at`` before closing; that commit is the send-attempt
linearization point.  A cancel committed after that point fences the stale
database completion, but cannot atomically revoke the in-memory request
without holding database locks across Provider I/O; the Provider may therefore
still receive that request.
"""

from __future__ import annotations

from collections.abc import Callable
from contextlib import AbstractContextManager
from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from .provider import (
    NotificationAccepted,
    NotificationRejected,
    NotificationResult,
    OpenGameNotificationProvider,
    WaitlistPromotionRequest,
)
from .repository import (
    CLAIM_LEASE,
    OpenGameNotificationClaim,
    OpenGameNotificationRepository,
    SupersededOpenGameNotification,
)

BACKOFF_SECONDS = (30, 120)
DEFAULT_BATCH_SIZE = 20
SessionFactory = Callable[[], AbstractContextManager[Session]]


class OpenGameNotificationWorker:
    def __init__(
        self,
        *,
        session_factory: SessionFactory,
        provider: OpenGameNotificationProvider,
        clock: Callable[[], datetime] | None = None,
        batch_size: int = DEFAULT_BATCH_SIZE,
    ) -> None:
        if not 1 <= batch_size <= 100:
            raise ValueError("notification batch size must be between 1 and 100")
        self._session_factory = session_factory
        self._provider = provider
        self._clock = clock or (lambda: datetime.now(UTC))
        self._batch_size = batch_size

    def run_once(self) -> int:
        processed = 0
        for _ in range(self._batch_size):
            claim = self._claim_next()
            if claim is None:
                break
            processed += 1
            self._process(claim)
        return processed

    def _claim_next(self) -> OpenGameNotificationClaim | None:
        now = self._clock()
        with self._session_factory() as session:
            claim = OpenGameNotificationRepository(session).claim_next_due(
                now=now,
                lease_until=now + CLAIM_LEASE,
            )
            session.commit()
            return claim

    def _process(self, claim: OpenGameNotificationClaim) -> None:
        try:
            with self._session_factory() as session:
                prepared = OpenGameNotificationRepository(session).prepare_claim(
                    claim,
                    clock=self._clock,
                )
                session.commit()
        except ValueError:
            with self._session_factory() as session:
                OpenGameNotificationRepository(session).fail(
                    claim,
                    completed_at=self._clock(),
                    safe_failure_code="INVALID_NOTIFICATION_DATA",
                )
                session.commit()
            return
        if prepared is None:
            return
        if isinstance(prepared, SupersededOpenGameNotification):
            with self._session_factory() as session:
                OpenGameNotificationRepository(session).supersede_claim(
                    claim,
                    completed_at=prepared.completed_at,
                )
                session.commit()
            return
        try:
            # The durable send-start marker committed and all row locks were
            # released above.  Later cancellation can fence accounting but
            # cannot promise that the Provider will not receive this request.
            result = self._send(prepared.request)
        except Exception:
            result = NotificationRejected("PROVIDER_IO_FAILED", retryable=True)
        with self._session_factory() as session:
            repository = OpenGameNotificationRepository(session)
            now = self._clock()
            if isinstance(result, NotificationAccepted):
                repository.complete_sent(claim, completed_at=now)
            elif isinstance(result, NotificationRejected) and result.retryable:
                delay = BACKOFF_SECONDS[
                    min(prepared.attempt_count - 1, len(BACKOFF_SECONDS) - 1)
                ]
                repository.reschedule(
                    claim,
                    available_at=now + timedelta(seconds=delay),
                    safe_failure_code=result.safe_error_code,
                )
            elif isinstance(result, NotificationRejected):
                repository.fail(
                    claim,
                    completed_at=now,
                    safe_failure_code=result.safe_error_code,
                )
            session.commit()

    def _send(self, request: WaitlistPromotionRequest) -> NotificationResult:
        return self._provider.send(request)
