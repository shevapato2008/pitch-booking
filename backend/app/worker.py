import argparse
import logging
import time
import uuid
from collections.abc import Callable, Sequence
from contextlib import AbstractContextManager
from datetime import UTC, datetime
from typing import Protocol

from sqlalchemy.orm import Session

from backend.app.database import get_engine
from backend.app.modules.orders.expiry import PendingOrderExpiryService
from backend.app.modules.orders.repository import OrderRepository
from backend.app.modules.payments.repository import PaymentRepository

DEFAULT_BATCH_SIZE = 100
DEFAULT_INTERVAL_SECONDS = 60.0
SessionFactory = Callable[[], AbstractContextManager[Session]]
logger = logging.getLogger(__name__)


class PaymentRecovery(Protocol):
    @property
    def provider_name(self) -> str: ...

    def recover(self, payment_id: uuid.UUID) -> object: ...


class ExpiryWorker:
    def __init__(
        self,
        *,
        session_factory: SessionFactory,
        expiry_service: PendingOrderExpiryService | None = None,
        payment_reconciliation: PaymentRecovery | None = None,
        clock: Callable[[], datetime] | None = None,
        sleeper: Callable[[float], None] | None = None,
        batch_size: int = DEFAULT_BATCH_SIZE,
        interval_seconds: float = DEFAULT_INTERVAL_SECONDS,
    ) -> None:
        if not 1 <= batch_size <= DEFAULT_BATCH_SIZE:
            raise ValueError("batch_size must be between 1 and 100")
        if interval_seconds <= 0:
            raise ValueError("interval_seconds must be positive")
        self._session_factory = session_factory
        self._expiry_service = expiry_service or PendingOrderExpiryService()
        self._payment_reconciliation = payment_reconciliation
        self._clock = clock or (lambda: datetime.now(UTC))
        self._sleeper = sleeper or time.sleep
        self._batch_size = batch_size
        self._interval_seconds = interval_seconds

    def scan_candidate_ids(self, session: Session, *, limit: int) -> list[uuid.UUID]:
        return OrderRepository(session).list_expiry_candidate_ids(
            now=self._clock(),
            limit=limit,
        )

    def run_once(self) -> int:
        payment_ids: list[uuid.UUID] = []
        if self._payment_reconciliation is not None:
            with self._session_factory() as payment_scan:
                payment_ids = PaymentRepository(payment_scan).list_due_payment_ids(
                    now=self._clock(),
                    provider=self._payment_reconciliation.provider_name,
                    limit=self._batch_size,
                )

            for payment_id in payment_ids:
                try:
                    self._payment_reconciliation.recover(payment_id)
                except Exception:
                    logger.exception(
                        "Failed to reconcile payment payment_id=%s",
                        payment_id,
                    )

        with self._session_factory() as scan_session:
            candidate_ids = self.scan_candidate_ids(
                scan_session,
                limit=self._batch_size,
            )

        for order_id in candidate_ids:
            with self._session_factory() as session:
                try:
                    self._expiry_service.expire_by_order_id(
                        session,
                        order_id,
                        self._clock(),
                    )
                    session.commit()
                except Exception:
                    session.rollback()
                    logger.exception(
                        "Failed to expire pending order order_id=%s",
                        order_id,
                    )
        return len(payment_ids) + len(candidate_ids)

    def run(self, *, once: bool = False) -> int:
        processed = 0
        while True:
            processed += self.run_once()
            if once:
                return processed
            self._sleeper(self._interval_seconds)


def _batch_size(value: str) -> int:
    parsed = int(value)
    if not 1 <= parsed <= DEFAULT_BATCH_SIZE:
        raise argparse.ArgumentTypeError("batch size must be between 1 and 100")
    return parsed


def _positive_interval(value: str) -> float:
    parsed = float(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("interval must be positive")
    return parsed


def main(
    argv: Sequence[str] | None = None,
    *,
    session_factory: SessionFactory | None = None,
    clock: Callable[[], datetime] | None = None,
    sleeper: Callable[[float], None] | None = None,
    payment_reconciliation: PaymentRecovery | None = None,
) -> int:
    parser = argparse.ArgumentParser(description="Expire stale pending orders safely")
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--batch-size", type=_batch_size, default=DEFAULT_BATCH_SIZE)
    parser.add_argument(
        "--interval-seconds",
        type=_positive_interval,
        default=DEFAULT_INTERVAL_SECONDS,
    )
    arguments = parser.parse_args(argv)
    resolved_factory = session_factory or (lambda: Session(get_engine()))
    ExpiryWorker(
        session_factory=resolved_factory,
        clock=clock,
        sleeper=sleeper,
        payment_reconciliation=payment_reconciliation,
        batch_size=arguments.batch_size,
        interval_seconds=arguments.interval_seconds,
    ).run(once=arguments.once)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
