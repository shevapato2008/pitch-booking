import argparse
import logging
import time
import uuid
from collections.abc import Callable, Sequence
from contextlib import AbstractContextManager
from datetime import UTC, datetime
from typing import Protocol

from sqlalchemy.orm import Session

from backend.app.config import Settings
from backend.app.database import get_engine
from backend.app.modules.orders.expiry import PendingOrderExpiryService
from backend.app.modules.orders.repository import OrderRepository
from backend.app.modules.payments import build_payment_provider
from backend.app.modules.payments.convergence import PaymentConvergenceService
from backend.app.modules.payments.reconciliation import (
    RECOVERY_LEASE_DURATION,
    PaymentReconciliationService,
)
from backend.app.modules.payments.repository import PaymentRepository
from backend.app.modules.refunds.convergence import RefundConvergenceService
from backend.app.modules.refunds.repository import RefundRepository
from backend.app.modules.refunds.worker import RefundReconciliationService
from backend.app.modules.venue_profiles.dashscope_moderation import DashScopeModerationProvider
from backend.app.modules.venue_profiles.local_storage import LocalMediaStorage
from backend.app.modules.venue_profiles.moderation import ContentModerationProvider
from backend.app.modules.venue_profiles.oss_storage import OssMediaStorage
from backend.app.modules.venue_profiles.publisher import VenueProfilePublisher
from backend.app.modules.venue_profiles.storage import VenueMediaStore
from backend.app.modules.venue_profiles.worker import VenueProfileModerationWorker

DEFAULT_BATCH_SIZE = 100
DEFAULT_INTERVAL_SECONDS = 60.0
SessionFactory = Callable[[], AbstractContextManager[Session]]
logger = logging.getLogger(__name__)


class PaymentRecovery(Protocol):
    @property
    def provider_name(self) -> str: ...

    def recover(
        self,
        payment_id: uuid.UUID,
        *,
        claim_token: uuid.UUID | None = None,
    ) -> object: ...


class ProfileModerationScan(Protocol):
    def run_once(self) -> int: ...


class RefundRecovery(Protocol):
    @property
    def provider_name(self) -> str: ...

    def recover(
        self,
        attempt_id: uuid.UUID,
        *,
        claim_token: uuid.UUID | None = None,
    ) -> object: ...


class ExpiryWorker:
    def __init__(
        self,
        *,
        session_factory: SessionFactory,
        expiry_service: PendingOrderExpiryService | None = None,
        payment_reconciliation: PaymentRecovery | None = None,
        refund_reconciliation: RefundRecovery | None = None,
        profile_moderation: ProfileModerationScan | None = None,
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
        self._refund_reconciliation = refund_reconciliation
        self._profile_moderation = profile_moderation
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
        payment_count = 0
        if self._payment_reconciliation is not None:
            for _ in range(self._batch_size):
                claim_now = self._clock()
                with self._session_factory() as payment_claim:
                    claim = PaymentRepository(payment_claim).claim_next_due_payment(
                        now=claim_now,
                        provider=self._payment_reconciliation.provider_name,
                        lease_until=claim_now + RECOVERY_LEASE_DURATION,
                    )
                    payment_claim.commit()
                if claim is None:
                    break
                payment_count += 1
                try:
                    self._payment_reconciliation.recover(
                        claim.payment_id,
                        claim_token=claim.claim_token,
                    )
                except Exception:
                    logger.exception(
                        "Failed to reconcile payment payment_id=%s",
                        claim.payment_id,
                    )

        refund_count = 0
        if self._refund_reconciliation is not None:
            for _ in range(self._batch_size):
                claim_now = self._clock()
                with self._session_factory() as refund_claim:
                    claim = RefundRepository(refund_claim).claim_next_due_attempt(
                        now=claim_now,
                        provider=self._refund_reconciliation.provider_name,
                        lease_until=claim_now + RECOVERY_LEASE_DURATION,
                    )
                    refund_claim.commit()
                if claim is None:
                    break
                refund_count += 1
                try:
                    self._refund_reconciliation.recover(
                        claim.attempt_id,
                        claim_token=claim.claim_token,
                    )
                except Exception:
                    logger.exception(
                        "Failed to reconcile refund attempt_id=%s",
                        claim.attempt_id,
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
        moderation_count = 0
        if self._profile_moderation is not None:
            try:
                moderation_count = self._profile_moderation.run_once()
            except Exception:
                logger.exception("Failed to scan venue profile moderation jobs")
        return payment_count + refund_count + len(candidate_ids) + moderation_count

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
    refund_reconciliation: RefundRecovery | None = None,
    profile_moderation: ProfileModerationScan | None = None,
    settings: Settings | None = None,
    venue_media_store: VenueMediaStore | None = None,
    moderation_provider: ContentModerationProvider | None = None,
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
    resolved_settings = settings or Settings()
    owned_payment_provider = None
    resolved_payment_reconciliation = payment_reconciliation
    resolved_refund_reconciliation = refund_reconciliation
    if resolved_payment_reconciliation is None or resolved_refund_reconciliation is None:
        if (
            resolved_settings.mock_payment_provider_enabled
            or resolved_settings.wechat_payment_configured
        ):
            owned_payment_provider = build_payment_provider(resolved_settings)
            payment_convergence = PaymentConvergenceService(
                session_factory=resolved_factory,
                expected_app_id=owned_payment_provider.app_id,
                expected_merchant_id=owned_payment_provider.merchant_id,
                now=clock,
            )
            refund_convergence = RefundConvergenceService(
                session_factory=resolved_factory,
                expected_merchant_id=owned_payment_provider.merchant_id,
                now=clock,
            )
            if resolved_payment_reconciliation is None:
                resolved_payment_reconciliation = PaymentReconciliationService(
                    session_factory=resolved_factory,
                    provider=owned_payment_provider,
                    convergence=payment_convergence,
                    now=clock,
                )
            if resolved_refund_reconciliation is None:
                resolved_refund_reconciliation = RefundReconciliationService(
                    session_factory=resolved_factory,
                    provider=owned_payment_provider,
                    convergence=refund_convergence,
                    now=clock,
                )
    owned_provider: DashScopeModerationProvider | None = None
    owned_store: VenueMediaStore | None = None
    resolved_profile_moderation = profile_moderation
    if resolved_profile_moderation is None:
        provider = moderation_provider
        if provider is None and resolved_settings.dashscope_api_key is not None:
            owned_provider = DashScopeModerationProvider(
                api_key=resolved_settings.dashscope_api_key,
                base_url=str(resolved_settings.dashscope_base_url),
                model=resolved_settings.dashscope_moderation_model,
            )
            provider = owned_provider
        if provider is not None:
            store = venue_media_store
            if store is None:
                store = (
                    OssMediaStorage.from_settings(resolved_settings)
                    if resolved_settings.app_env in {"staging", "production"}
                    else LocalMediaStorage()
                )
                owned_store = store
            publisher = VenueProfilePublisher(resolved_factory, store)
            resolved_profile_moderation = VenueProfileModerationWorker(
                session_factory=resolved_factory,
                provider=provider,
                media_store=store,
                publisher=publisher,
                clock=clock,
                batch_size=min(arguments.batch_size, 100),
            )
    try:
        ExpiryWorker(
            session_factory=resolved_factory,
            clock=clock,
            sleeper=sleeper,
            payment_reconciliation=resolved_payment_reconciliation,
            refund_reconciliation=resolved_refund_reconciliation,
            profile_moderation=resolved_profile_moderation,
            batch_size=arguments.batch_size,
            interval_seconds=arguments.interval_seconds,
        ).run(once=arguments.once)
    finally:
        if owned_provider is not None:
            owned_provider.close()
        close_store = getattr(owned_store, "close", None)
        if close_store is not None:
            close_store()
        close_payment_provider = getattr(owned_payment_provider, "close", None)
        if close_payment_provider is not None:
            close_payment_provider()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
