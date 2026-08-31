from __future__ import annotations

import json
import time
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from threading import Event, Lock

import pytest
from sqlalchemy import Engine, select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from backend.app import worker as worker_module
from backend.app.config import Settings
from backend.app.errors import AppError
from backend.app.models import (
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
    RefundCase,
    RefundCasePurpose,
    RefundReason,
    User,
)
from backend.app.modules.open_game_notifications.provider import (
    PROVIDER_MAX_REQUEST_DURATION,
    NotificationAccepted,
    NotificationRejected,
    NotificationResult,
    WaitlistPromotionRecipient,
    WaitlistPromotionRequest,
)
from backend.app.modules.open_game_notifications.repository import (
    OpenGameNotificationClaim,
    OpenGameNotificationRepository,
)
from backend.app.modules.open_game_notifications.worker import (
    CLAIM_LEASE,
    OpenGameNotificationWorker,
)
from backend.app.modules.open_games.dto import OpenGameVersionRequest
from backend.app.modules.open_games.repository import OpenGameRepository
from backend.app.modules.open_games.service import OpenGameService
from backend.app.modules.orders.repository import OrderRepository
from backend.app.worker import ExpiryWorker, main
from backend.tests.test_open_game_service import (
    SeededOpenGameCase,
    add_stored_game,
    seed_confirmed_order,
)
from backend.tests.test_open_game_service import (
    service as open_game_service,
)

NOW = datetime(2026, 8, 30, 4, tzinfo=UTC)


@dataclass(frozen=True, slots=True)
class SeededNotification:
    booking: SeededOpenGameCase
    game_id: uuid.UUID
    registration_id: uuid.UUID
    outbox_id: uuid.UUID


class RecordingNotificationProvider:
    provider_name = "recording"

    def __init__(
        self,
        results: list[NotificationResult | BaseException] | None = None,
    ) -> None:
        self._results = list(results or [NotificationAccepted()])
        self._lock = Lock()
        self.calls: list[WaitlistPromotionRequest] = []

    def send(self, request: WaitlistPromotionRequest) -> NotificationResult:
        with self._lock:
            self.calls.append(request)
            result = self._results.pop(0)
        if isinstance(result, BaseException):
            raise result
        return result


class BlockingNotificationProvider:
    provider_name = "blocking"

    def __init__(self) -> None:
        self.started = Event()
        self.release = Event()
        self.calls: list[WaitlistPromotionRequest] = []

    def send(self, request: WaitlistPromotionRequest) -> NotificationResult:
        self.calls.append(request)
        self.started.set()
        if not self.release.wait(timeout=5):
            raise RuntimeError("test did not release notification provider")
        return NotificationAccepted()


def _factory(engine: Engine) -> Callable[[], Session]:
    return lambda: Session(engine)


def _seed_notification(engine: Engine) -> SeededNotification:
    booking = seed_confirmed_order(engine, starts_at=NOW.replace(day=31))
    with Session(engine) as session:
        game = add_stored_game(
            session,
            seeded=booking,
            status=OpenGameStatus.PUBLISHED,
        )
        applicant = User(
            wechat_app_id="wx-notification-test",
            wechat_openid=f"notification-recipient-{uuid.uuid4()}",
        )
        session.add(applicant)
        session.flush()
        registration = OpenGameRegistration(
            game_id=game.id,
            applicant_user_id=applicant.id,
            display_name="候补球员",
            position=OpenGameRegistrationPosition.ANY,
            note=None,
            status=OpenGameRegistrationStatus.JOINED,
            version=3,
            consent_version="c1a-2026-08-24",
            adult_confirmed_at=NOW,
            risk_confirmed_at=NOW,
            applied_at=NOW,
            decided_at=NOW,
            decided_by_user_id=booking.owner_id,
            waitlist_seq=1,
            waitlisted_at=NOW,
            promoted_at=NOW,
        )
        session.add(registration)
        session.flush()
        outbox = OpenGameNotificationOutbox(
            dedupe_key=f"waitlist-promoted:{registration.id}:3",
            game_id=game.id,
            registration_id=registration.id,
            recipient_user_id=applicant.id,
            event=OpenGameNotificationEvent.WAITLIST_PROMOTED,
            template_key="waitlist-promoted",
            status=OpenGameNotificationStatus.PENDING,
            payload={
                "game_name": "周末轻松局",
                "starts_at": booking.starts_at.isoformat(),
                "venue_name": "测试球场",
            },
            attempt_count=0,
            available_at=NOW,
            claim_token=None,
            lease_until=None,
            completed_at=None,
            last_failure_code=None,
        )
        session.add(outbox)
        session.commit()
        return SeededNotification(
            booking=booking,
            game_id=game.id,
            registration_id=registration.id,
            outbox_id=outbox.id,
        )


def test_provider_dtos_keep_recipient_secret_out_of_repr_and_reject_open_payloads() -> None:
    recipient = WaitlistPromotionRecipient(
        app_id="wx-notification-test",
        openid="sensitive-openid",
    )
    request = WaitlistPromotionRequest(
        dedupe_key="waitlist-promoted:registration:2",
        recipient=recipient,
        template_key="waitlist-promoted",
        data={
            "game_name": "周末轻松局",
            "starts_at": "2026-09-01T12:00:00+00:00",
            "venue_name": "测试球场",
        },
    )

    assert "sensitive-openid" not in repr(recipient)
    assert "sensitive-openid" not in repr(request)
    with pytest.raises(ValueError, match="closed waitlist-promotion payload"):
        WaitlistPromotionRequest(
            dedupe_key=request.dedupe_key,
            recipient=recipient,
            template_key=request.template_key,
            data={**request.data, "phone": "secret"},  # type: ignore[typeddict-unknown-key]
        )
    with pytest.raises(ValueError, match="safe failure code"):
        NotificationRejected("raw provider body: sensitive", retryable=True)


def test_claim_lease_exceeds_provider_timeout_contract() -> None:
    assert CLAIM_LEASE >= PROVIDER_MAX_REQUEST_DURATION * 2


@pytest.mark.integration
def test_send_start_renews_lease_for_full_provider_window(
    pg_engine: Engine,
) -> None:
    seeded = _seed_notification(pg_engine)
    with Session(pg_engine) as session:
        claim = OpenGameNotificationRepository(session).claim_next_due(
            now=NOW,
            lease_until=NOW + CLAIM_LEASE,
        )
        session.commit()
    assert claim is not None
    authorization_time = NOW + CLAIM_LEASE - timedelta(seconds=1)

    with Session(pg_engine) as session:
        prepared = OpenGameNotificationRepository(session).prepare_claim(
            claim,
            clock=lambda: authorization_time,
        )
        session.commit()
    assert prepared is not None
    with Session(pg_engine) as session:
        event = session.get_one(OpenGameNotificationOutbox, seeded.outbox_id)
        assert event.delivery_started_at == authorization_time
        assert event.lease_until == authorization_time + CLAIM_LEASE


@pytest.mark.integration
def test_worker_sends_due_notification_and_does_not_mutate_registration(
    pg_engine: Engine,
) -> None:
    seeded = _seed_notification(pg_engine)
    provider = RecordingNotificationProvider()

    processed = OpenGameNotificationWorker(
        session_factory=_factory(pg_engine),
        provider=provider,
        clock=lambda: NOW,
    ).run_once()

    assert processed == 1
    assert provider.calls == [
        WaitlistPromotionRequest(
            dedupe_key=f"waitlist-promoted:{seeded.registration_id}:3",
            recipient=WaitlistPromotionRecipient(
                app_id="wx-notification-test",
                openid=provider.calls[0].recipient.openid,
            ),
            template_key="waitlist-promoted",
            data={
                "game_name": "周末轻松局",
                "starts_at": seeded.booking.starts_at.isoformat(),
                "venue_name": "测试球场",
            },
        )
    ]
    with Session(pg_engine) as session:
        event = session.get_one(OpenGameNotificationOutbox, seeded.outbox_id)
        registration = session.get_one(
            OpenGameRegistration,
            seeded.registration_id,
        )
        assert event.status is OpenGameNotificationStatus.SENT
        assert event.attempt_count == 1
        assert event.claim_token is None
        assert event.lease_until is None
        assert event.delivery_started_at == NOW
        assert event.completed_at == NOW
        assert event.last_failure_code is None
        assert registration.status is OpenGameRegistrationStatus.JOINED
        assert registration.version == 3


@pytest.mark.integration
@pytest.mark.parametrize("offset", [timedelta(0), timedelta(seconds=1)])
def test_worker_supersedes_at_or_after_start_without_provider_io(
    pg_engine: Engine,
    offset: timedelta,
) -> None:
    seeded = _seed_notification(pg_engine)
    provider = RecordingNotificationProvider()
    authorization_time = seeded.booking.starts_at + offset

    processed = OpenGameNotificationWorker(
        session_factory=_factory(pg_engine),
        provider=provider,
        clock=lambda: authorization_time,
    ).run_once()

    assert processed == 1
    assert provider.calls == []
    with Session(pg_engine) as session:
        event = session.get_one(OpenGameNotificationOutbox, seeded.outbox_id)
        assert event.status is OpenGameNotificationStatus.SUPERSEDED
        assert event.delivery_started_at is None
        assert event.completed_at == authorization_time
        assert event.claim_token is None
        assert event.lease_until is None


@pytest.mark.integration
def test_retryable_rejection_reschedules_with_capped_backoff_then_succeeds(
    pg_engine: Engine,
) -> None:
    seeded = _seed_notification(pg_engine)
    provider = RecordingNotificationProvider(
        [
            NotificationRejected("PROVIDER_TEMPORARY", retryable=True),
            NotificationAccepted(),
        ]
    )

    first = OpenGameNotificationWorker(
        session_factory=_factory(pg_engine),
        provider=provider,
        clock=lambda: NOW,
    ).run_once()
    early = OpenGameNotificationWorker(
        session_factory=_factory(pg_engine),
        provider=provider,
        clock=lambda: NOW + timedelta(seconds=29),
    ).run_once()

    assert (first, early) == (1, 0)
    with Session(pg_engine) as session:
        event = session.get_one(OpenGameNotificationOutbox, seeded.outbox_id)
        assert event.status is OpenGameNotificationStatus.PENDING
        assert event.available_at == NOW + timedelta(seconds=30)
        assert event.attempt_count == 1
        assert event.claim_token is None
        assert event.lease_until is None
        assert event.delivery_started_at is None
        assert event.completed_at is None
        assert event.last_failure_code == "PROVIDER_TEMPORARY"

    later = OpenGameNotificationWorker(
        session_factory=_factory(pg_engine),
        provider=provider,
        clock=lambda: NOW + timedelta(seconds=30),
    ).run_once()

    assert later == 1
    assert len(provider.calls) == 2
    with Session(pg_engine) as session:
        event = session.get_one(OpenGameNotificationOutbox, seeded.outbox_id)
        registration = session.get_one(
            OpenGameRegistration,
            seeded.registration_id,
        )
        assert event.status is OpenGameNotificationStatus.SENT
        assert event.attempt_count == 2
        assert event.last_failure_code is None
        assert registration.status is OpenGameRegistrationStatus.JOINED
        assert registration.version == 3


@pytest.mark.integration
def test_permanent_rejection_fails_with_only_safe_code(
    pg_engine: Engine,
) -> None:
    seeded = _seed_notification(pg_engine)
    provider = RecordingNotificationProvider(
        [NotificationRejected("RECIPIENT_UNSUBSCRIBED", retryable=False)]
    )

    assert OpenGameNotificationWorker(
        session_factory=_factory(pg_engine),
        provider=provider,
        clock=lambda: NOW,
    ).run_once() == 1

    with Session(pg_engine) as session:
        event = session.get_one(OpenGameNotificationOutbox, seeded.outbox_id)
        registration = session.get_one(
            OpenGameRegistration,
            seeded.registration_id,
        )
        assert event.status is OpenGameNotificationStatus.FAILED
        assert event.delivery_started_at == NOW
        assert event.completed_at == NOW
        assert event.claim_token is None
        assert event.lease_until is None
        assert event.last_failure_code == "RECIPIENT_UNSUBSCRIBED"
        assert registration.status is OpenGameRegistrationStatus.JOINED
        assert registration.version == 3


@pytest.mark.integration
def test_provider_exception_is_safely_rescheduled_without_logging_secret(
    pg_engine: Engine,
    caplog: pytest.LogCaptureFixture,
) -> None:
    seeded = _seed_notification(pg_engine)
    provider = RecordingNotificationProvider(
        [RuntimeError("raw-provider-secret-sensitive-openid")]
    )

    assert OpenGameNotificationWorker(
        session_factory=_factory(pg_engine),
        provider=provider,
        clock=lambda: NOW,
    ).run_once() == 1

    with Session(pg_engine) as session:
        event = session.get_one(OpenGameNotificationOutbox, seeded.outbox_id)
        assert event.status is OpenGameNotificationStatus.PENDING
        assert event.delivery_started_at is None
        assert event.available_at == NOW + timedelta(seconds=30)
        assert event.last_failure_code == "PROVIDER_IO_FAILED"
    assert "raw-provider-secret-sensitive-openid" not in caplog.text


@pytest.mark.integration
def test_invalid_runtime_recipient_fails_without_calling_provider(
    pg_engine: Engine,
) -> None:
    seeded = _seed_notification(pg_engine)
    with Session(pg_engine) as session:
        event = session.get_one(OpenGameNotificationOutbox, seeded.outbox_id)
        session.get_one(User, event.recipient_user_id).wechat_openid = ""
        session.commit()
    provider = RecordingNotificationProvider()

    assert OpenGameNotificationWorker(
        session_factory=_factory(pg_engine),
        provider=provider,
        clock=lambda: NOW,
    ).run_once() == 1

    assert provider.calls == []
    with Session(pg_engine) as session:
        event = session.get_one(OpenGameNotificationOutbox, seeded.outbox_id)
        assert event.status is OpenGameNotificationStatus.FAILED
        assert event.delivery_started_at is None
        assert event.completed_at == NOW
        assert event.last_failure_code == "INVALID_NOTIFICATION_DATA"


@pytest.mark.integration
def test_second_worker_cannot_send_during_first_workers_active_lease(
    pg_engine: Engine,
) -> None:
    _seed_notification(pg_engine)
    provider = BlockingNotificationProvider()

    def run_worker() -> int:
        return OpenGameNotificationWorker(
            session_factory=_factory(pg_engine),
            provider=provider,
            clock=lambda: NOW,
        ).run_once()

    with ThreadPoolExecutor(max_workers=1) as pool:
        first = pool.submit(run_worker)
        assert provider.started.wait(timeout=5)
        try:
            assert run_worker() == 0
        finally:
            provider.release.set()
        assert first.result(timeout=5) == 1

    assert len(provider.calls) == 1


@pytest.mark.integration
def test_provider_io_runs_without_registration_lock(pg_engine: Engine) -> None:
    seeded = _seed_notification(pg_engine)

    class RegistrationLockCheckingProvider(RecordingNotificationProvider):
        def send(self, request: WaitlistPromotionRequest) -> NotificationResult:
            with Session(pg_engine) as probe:
                registration = probe.scalar(
                    select(OpenGameRegistration)
                    .where(OpenGameRegistration.id == seeded.registration_id)
                    .with_for_update(nowait=True)
                )
                assert registration is not None
                probe.commit()
            return super().send(request)

    provider = RegistrationLockCheckingProvider()

    assert OpenGameNotificationWorker(
        session_factory=_factory(pg_engine),
        provider=provider,
        clock=lambda: NOW,
    ).run_once() == 1
    assert len(provider.calls) == 1


@pytest.mark.integration
def test_prepare_waiting_past_lease_does_not_send_before_fresh_reclaim(
    pg_engine: Engine,
) -> None:
    seeded = _seed_notification(pg_engine)
    with Session(pg_engine) as session:
        claim = OpenGameNotificationRepository(session).claim_next_due(
            now=NOW,
            lease_until=NOW + CLAIM_LEASE,
        )
        session.commit()
    assert claim is not None

    provider = RecordingNotificationProvider()
    stale_worker = OpenGameNotificationWorker(
        session_factory=_factory(pg_engine),
        provider=provider,
        clock=lambda: NOW + CLAIM_LEASE,
    )
    blocker = pg_engine.connect()
    blocker_transaction = blocker.begin()
    blocker_pid = blocker.execute(text("SELECT pg_backend_pid()")).scalar_one()
    blocker.execute(
        select(Order.id)
        .where(Order.id == seeded.booking.order_id)
        .with_for_update()
    ).scalar_one()

    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            stale = pool.submit(stale_worker._process, claim)
            deadline = time.monotonic() + 5
            observed_lock_wait = False
            while time.monotonic() < deadline:
                with pg_engine.connect() as observer:
                    observed_lock_wait = bool(
                        observer.execute(
                            text(
                                "SELECT EXISTS (SELECT 1 FROM pg_stat_activity "
                                "WHERE datname = current_database() "
                                "AND pid != :blocker_pid "
                                "AND wait_event_type = 'Lock')"
                            ),
                            {"blocker_pid": blocker_pid},
                        ).scalar_one()
                    )
                if observed_lock_wait:
                    break
                time.sleep(0.02)
            assert observed_lock_wait
            blocker_transaction.commit()
            stale.result(timeout=5)
    finally:
        if blocker_transaction.is_active:
            blocker_transaction.rollback()
        blocker.close()

    assert provider.calls == []
    with Session(pg_engine) as session:
        event = session.get_one(OpenGameNotificationOutbox, seeded.outbox_id)
        assert event.status is OpenGameNotificationStatus.CLAIMED
        assert event.claim_token == claim.claim_token
        assert event.delivery_started_at is None

    assert OpenGameNotificationWorker(
        session_factory=_factory(pg_engine),
        provider=provider,
        clock=lambda: NOW + CLAIM_LEASE,
    ).run_once() == 1
    assert len(provider.calls) == 1
    with Session(pg_engine) as session:
        event = session.get_one(OpenGameNotificationOutbox, seeded.outbox_id)
        assert event.status is OpenGameNotificationStatus.SENT
        assert event.attempt_count == 2
        assert event.delivery_started_at == NOW + CLAIM_LEASE


@pytest.mark.integration
def test_expired_lease_uses_new_fencing_token_and_rejects_stale_completion(
    pg_engine: Engine,
) -> None:
    seeded = _seed_notification(pg_engine)
    with Session(pg_engine) as session:
        first = OpenGameNotificationRepository(session).claim_next_due(
            now=NOW,
            lease_until=NOW + CLAIM_LEASE,
        )
        session.commit()
    assert first is not None

    reclaimed_at = NOW + CLAIM_LEASE
    with Session(pg_engine) as session:
        second = OpenGameNotificationRepository(session).claim_next_due(
            now=reclaimed_at,
            lease_until=reclaimed_at + CLAIM_LEASE,
        )
        session.commit()
    assert second is not None
    assert second.outbox_id == seeded.outbox_id
    assert second.claim_token != first.claim_token

    with Session(pg_engine) as session:
        prepared = OpenGameNotificationRepository(session).prepare_claim(
            second,
            clock=lambda: reclaimed_at,
        )
        session.commit()
    assert prepared is not None

    with Session(pg_engine) as session:
        assert not OpenGameNotificationRepository(session).complete_sent(
            first,
            completed_at=reclaimed_at,
        )
        assert not OpenGameNotificationRepository(session).reschedule(
            first,
            available_at=reclaimed_at,
            safe_failure_code="STALE_RETRY",
        )
        assert not OpenGameNotificationRepository(session).fail(
            first,
            completed_at=reclaimed_at,
            safe_failure_code="STALE_FAILURE",
        )
        assert not OpenGameNotificationRepository(session).supersede_claim(
            first,
            completed_at=reclaimed_at,
        )
        session.commit()
    with Session(pg_engine) as session:
        assert OpenGameNotificationRepository(session).complete_sent(
            second,
            completed_at=reclaimed_at,
        )
        session.commit()
    with Session(pg_engine) as session:
        event = session.get_one(OpenGameNotificationOutbox, seeded.outbox_id)
        assert event.status is OpenGameNotificationStatus.SENT
        assert event.delivery_started_at == reclaimed_at
        assert event.attempt_count == 2


@pytest.mark.integration
def test_provider_acceptance_before_sent_commit_is_at_least_once(
    pg_engine: Engine,
) -> None:
    seeded = _seed_notification(pg_engine)
    provider = RecordingNotificationProvider(
        [NotificationAccepted(), NotificationAccepted()]
    )
    with Session(pg_engine) as session:
        first = OpenGameNotificationRepository(session).claim_next_due(
            now=NOW,
            lease_until=NOW + CLAIM_LEASE,
        )
        session.commit()
    assert first is not None
    with Session(pg_engine) as session:
        prepared = OpenGameNotificationRepository(session).prepare_claim(
            first,
            clock=lambda: NOW,
        )
        session.commit()
    assert prepared is not None

    assert isinstance(provider.send(prepared.request), NotificationAccepted)
    # Simulate a process crash after Provider acceptance and before SENT accounting.
    assert OpenGameNotificationWorker(
        session_factory=_factory(pg_engine),
        provider=provider,
        clock=lambda: NOW + CLAIM_LEASE,
    ).run_once() == 1

    assert len(provider.calls) == 2
    assert provider.calls[0].dedupe_key == provider.calls[1].dedupe_key
    with Session(pg_engine) as session:
        event = session.get_one(OpenGameNotificationOutbox, seeded.outbox_id)
        assert event.status is OpenGameNotificationStatus.SENT
        assert event.delivery_started_at == NOW + CLAIM_LEASE
        assert event.attempt_count == 2


@pytest.mark.integration
def test_retry_backoff_caps_at_120_seconds_without_terminal_attempt_limit(
    pg_engine: Engine,
) -> None:
    seeded = _seed_notification(pg_engine)
    provider = RecordingNotificationProvider(
        [
            NotificationRejected("PROVIDER_TEMPORARY", retryable=True),
            NotificationRejected("PROVIDER_TEMPORARY", retryable=True),
            NotificationRejected("PROVIDER_TEMPORARY", retryable=True),
        ]
    )
    scheduled_times = (
        NOW,
        NOW + timedelta(seconds=30),
        NOW + timedelta(seconds=150),
    )

    for scheduled_at in scheduled_times:
        assert OpenGameNotificationWorker(
            session_factory=_factory(pg_engine),
            provider=provider,
            clock=lambda scheduled_at=scheduled_at: scheduled_at,
        ).run_once() == 1

    with Session(pg_engine) as session:
        event = session.get_one(OpenGameNotificationOutbox, seeded.outbox_id)
        assert event.status is OpenGameNotificationStatus.PENDING
        assert event.delivery_started_at is None
        assert event.attempt_count == 3
        assert event.available_at == NOW + timedelta(seconds=270)
        assert event.completed_at is None


@pytest.mark.integration
@pytest.mark.parametrize(
    "authority_case",
    [
        "game_cancelled",
        "order_cancel_requested",
        "order_refunded",
        "controlling_refund",
        "registration_withdrawn",
    ],
)
def test_worker_supersedes_unhealthy_authority_before_provider_io(
    pg_engine: Engine,
    authority_case: str,
) -> None:
    seeded = _seed_notification(pg_engine)
    with Session(pg_engine) as session:
        game = session.get_one(OpenGame, seeded.game_id)
        order = session.get_one(Order, seeded.booking.order_id)
        if authority_case == "game_cancelled":
            game.status = OpenGameStatus.CANCELLED
            game.cancelled_at = NOW
        elif authority_case == "order_cancel_requested":
            order.cancel_requested_at = NOW
        elif authority_case == "order_refunded":
            order.status = OrderStatus.REFUNDED
            order.cancel_requested_at = NOW
            order.cancelled_at = NOW
        elif authority_case == "registration_withdrawn":
            registration = session.get_one(
                OpenGameRegistration,
                seeded.registration_id,
            )
            registration.status = OpenGameRegistrationStatus.WITHDRAWN
            registration.withdrawal_kind = (
                OpenGameRegistrationWithdrawalKind.GAME_EXIT
            )
            registration.withdrawn_at = NOW
            registration.version += 1
        else:
            payment = session.get_one(Payment, seeded.booking.payment_id)
            session.add(
                RefundCase(
                    order_id=order.id,
                    payment_id=payment.id,
                    purpose=RefundCasePurpose.ORDER_CANCELLATION,
                    reason=RefundReason.USER_CANCELLED,
                    reason_note=None,
                    requested_by_user_id=seeded.booking.owner_id,
                    amount_cents=payment.amount_cents,
                    currency=payment.currency,
                    created_at=NOW,
                )
            )
        session.commit()
    provider = RecordingNotificationProvider()

    assert OpenGameNotificationWorker(
        session_factory=_factory(pg_engine),
        provider=provider,
        clock=lambda: NOW,
    ).run_once() == 1

    assert provider.calls == []
    with Session(pg_engine) as session:
        event = session.get_one(OpenGameNotificationOutbox, seeded.outbox_id)
        registration = session.get_one(
            OpenGameRegistration,
            seeded.registration_id,
        )
        assert event.status is OpenGameNotificationStatus.SUPERSEDED
        assert event.completed_at == NOW
        assert event.claim_token is None
        assert event.lease_until is None
        assert event.last_failure_code is None
        expected_status = (
            OpenGameRegistrationStatus.WITHDRAWN
            if authority_case == "registration_withdrawn"
            else OpenGameRegistrationStatus.JOINED
        )
        assert registration.status is expected_status
        assert registration.version == (
            4 if authority_case == "registration_withdrawn" else 3
        )


@pytest.mark.integration
def test_captain_cancel_supersedes_pending_and_claimed_in_same_commit(
    pg_engine: Engine,
) -> None:
    seeded = _seed_notification(pg_engine)
    token = uuid.uuid4()
    with Session(pg_engine) as session:
        claimed = session.get_one(OpenGameNotificationOutbox, seeded.outbox_id)
        claimed.status = OpenGameNotificationStatus.CLAIMED
        claimed.claim_token = token
        claimed.lease_until = NOW + CLAIM_LEASE
        claimed.attempt_count = 1
        session.add(
            OpenGameNotificationOutbox(
                dedupe_key=f"waitlist-promoted:{seeded.registration_id}:4",
                game_id=seeded.game_id,
                registration_id=seeded.registration_id,
                recipient_user_id=claimed.recipient_user_id,
                event=OpenGameNotificationEvent.WAITLIST_PROMOTED,
                template_key="waitlist-promoted",
                status=OpenGameNotificationStatus.PENDING,
                payload=claimed.payload,
                attempt_count=0,
                available_at=NOW,
                claim_token=None,
                lease_until=None,
                completed_at=None,
                last_failure_code=None,
            )
        )
        session.commit()

    with Session(pg_engine) as session:
        cancelled = open_game_service(session, now=NOW).cancel(
            user_id=seeded.booking.owner_id,
            game_id=seeded.game_id,
            idempotency_key="cancel-notification-outbox-key-001",
            request=OpenGameVersionRequest(expected_version=1),
        )
        assert cancelled.persisted_status is OpenGameStatus.CANCELLED

    with Session(pg_engine) as session:
        events = list(
            session.scalars(
                select(OpenGameNotificationOutbox)
                .where(OpenGameNotificationOutbox.game_id == seeded.game_id)
                .order_by(OpenGameNotificationOutbox.dedupe_key)
            )
        )
        assert len(events) == 2
        assert all(
            event.status is OpenGameNotificationStatus.SUPERSEDED
            and event.completed_at == NOW
            and event.claim_token is None
            and event.lease_until is None
            for event in events
        )
        stale_claim = OpenGameNotificationRepository(session).complete_sent(
            OpenGameNotificationClaim(seeded.outbox_id, token),
            completed_at=NOW,
        )
        session.commit()
        assert stale_claim is False


@pytest.mark.integration
def test_cancel_failure_rolls_back_game_and_outbox_supersede(
    pg_engine: Engine,
) -> None:
    seeded = _seed_notification(pg_engine)

    class FailingOrderRepository(OrderRepository):
        def complete_idempotency(self, *args: object, **kwargs: object) -> None:
            raise SQLAlchemyError("injected completion failure")

    with Session(pg_engine) as session, pytest.raises(AppError) as unavailable:
        OpenGameService(
            repository=OpenGameRepository(session),
            order_repository=FailingOrderRepository(session),
            now=lambda: NOW,
        ).cancel(
            user_id=seeded.booking.owner_id,
            game_id=seeded.game_id,
            idempotency_key="cancel-outbox-rollback-key-0001",
            request=OpenGameVersionRequest(expected_version=1),
        )
    assert (unavailable.value.status_code, unavailable.value.code) == (
        503,
        "SERVICE_UNAVAILABLE",
    )

    with Session(pg_engine) as session:
        game = session.get_one(OpenGame, seeded.game_id)
        event = session.get_one(OpenGameNotificationOutbox, seeded.outbox_id)
        assert game.status is OpenGameStatus.PUBLISHED
        assert game.version == 1
        assert event.status is OpenGameNotificationStatus.PENDING
        assert event.completed_at is None


@pytest.mark.integration
def test_cancel_before_worker_prepare_supersedes_without_provider_io(
    pg_engine: Engine,
) -> None:
    seeded = _seed_notification(pg_engine)
    provider = RecordingNotificationProvider()
    with Session(pg_engine) as session:
        claim = OpenGameNotificationRepository(session).claim_next_due(
            now=NOW,
            lease_until=NOW + CLAIM_LEASE,
        )
        session.commit()
    assert claim is not None

    with Session(pg_engine) as session:
        open_game_service(session, now=NOW).cancel(
            user_id=seeded.booking.owner_id,
            game_id=seeded.game_id,
            idempotency_key="cancel-before-notification-worker-key-001",
            request=OpenGameVersionRequest(expected_version=1),
        )

    worker = OpenGameNotificationWorker(
        session_factory=_factory(pg_engine),
        provider=provider,
        clock=lambda: NOW,
    )
    worker._process(claim)
    assert provider.calls == []
    with Session(pg_engine) as session:
        event = session.get_one(OpenGameNotificationOutbox, seeded.outbox_id)
        assert event.status is OpenGameNotificationStatus.SUPERSEDED
        assert event.delivery_started_at is None
        assert event.completed_at == NOW


@pytest.mark.integration
def test_cancel_after_send_start_may_reach_provider_but_stale_write_is_fenced(
    pg_engine: Engine,
) -> None:
    seeded = _seed_notification(pg_engine)
    provider = RecordingNotificationProvider()
    send_started = Event()
    release_send = Event()

    class PausingAfterSendStartWorker(OpenGameNotificationWorker):
        def _send(
            self,
            request: WaitlistPromotionRequest,
        ) -> NotificationResult:
            send_started.set()
            if not release_send.wait(timeout=5):
                raise RuntimeError("test did not release notification send")
            return super()._send(request)

    worker = PausingAfterSendStartWorker(
        session_factory=_factory(pg_engine),
        provider=provider,
        clock=lambda: NOW,
    )

    with ThreadPoolExecutor(max_workers=1) as pool:
        running = pool.submit(worker.run_once)
        assert send_started.wait(timeout=5)
        assert provider.calls == []
        try:
            with Session(pg_engine) as session:
                open_game_service(session, now=NOW).cancel(
                    user_id=seeded.booking.owner_id,
                    game_id=seeded.game_id,
                    idempotency_key="cancel-after-send-start-key-001",
                    request=OpenGameVersionRequest(expected_version=1),
                )
        finally:
            release_send.set()
        assert running.result(timeout=5) == 1

    assert len(provider.calls) == 1
    with Session(pg_engine) as session:
        event = session.get_one(OpenGameNotificationOutbox, seeded.outbox_id)
        assert event.status is OpenGameNotificationStatus.SUPERSEDED
        assert event.delivery_started_at == NOW
        assert event.completed_at == NOW


@pytest.mark.integration
def test_cancel_during_provider_io_preserves_superseded_against_stale_completion(
    pg_engine: Engine,
) -> None:
    seeded = _seed_notification(pg_engine)
    provider = BlockingNotificationProvider()
    worker = OpenGameNotificationWorker(
        session_factory=_factory(pg_engine),
        provider=provider,
        clock=lambda: NOW,
    )

    with ThreadPoolExecutor(max_workers=1) as pool:
        running = pool.submit(worker.run_once)
        assert provider.started.wait(timeout=5)
        try:
            with Session(pg_engine) as session:
                open_game_service(session, now=NOW).cancel(
                    user_id=seeded.booking.owner_id,
                    game_id=seeded.game_id,
                    idempotency_key="cancel-during-provider-io-key-001",
                    request=OpenGameVersionRequest(expected_version=1),
                )
        finally:
            provider.release.set()
        assert running.result(timeout=5) == 1

    assert len(provider.calls) == 1
    with Session(pg_engine) as session:
        event = session.get_one(OpenGameNotificationOutbox, seeded.outbox_id)
        registration = session.get_one(
            OpenGameRegistration,
            seeded.registration_id,
        )
        assert event.status is OpenGameNotificationStatus.SUPERSEDED
        assert event.completed_at == NOW
        assert registration.status is OpenGameRegistrationStatus.JOINED
        assert registration.version == 3


@pytest.mark.integration
def test_root_worker_runs_explicit_notification_scan_and_counts_it(
    pg_engine: Engine,
) -> None:
    class RecordingScan:
        calls = 0

        def run_once(self) -> int:
            self.calls += 1
            return 2

    scan = RecordingScan()

    processed = ExpiryWorker(
        session_factory=_factory(pg_engine),
        open_game_notifications=scan,
        clock=lambda: NOW,
    ).run_once()

    assert processed == 2
    assert scan.calls == 1
    assert main(
        ["--once"],
        session_factory=_factory(pg_engine),
        open_game_notifications=scan,
        clock=lambda: NOW,
        settings=Settings(app_env="test", payment_provider="disabled"),
    ) == 0
    assert scan.calls == 2


@pytest.mark.integration
def test_default_worker_composition_leaves_outbox_pending_without_real_provider(
    pg_engine: Engine,
) -> None:
    seeded = _seed_notification(pg_engine)

    assert main(
        ["--once", "--batch-size", "1"],
        session_factory=_factory(pg_engine),
        clock=lambda: NOW,
        settings=Settings(app_env="test", payment_provider="disabled"),
    ) == 0

    with Session(pg_engine) as session:
        event = session.get_one(OpenGameNotificationOutbox, seeded.outbox_id)
        assert event.status is OpenGameNotificationStatus.PENDING
        assert event.attempt_count == 0
        assert event.claim_token is None


@pytest.mark.integration
def test_root_worker_composes_enabled_notifications_and_closes_owned_provider(
    pg_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seeded = _seed_notification(pg_engine)

    class OwnedProvider(RecordingNotificationProvider):
        closed = False

        def close(self) -> None:
            self.closed = True

    provider = OwnedProvider()
    monkeypatch.setattr(
        worker_module,
        "build_open_game_notification_provider",
        lambda settings: provider,
    )

    assert main(
        ["--once", "--batch-size", "1"],
        session_factory=_factory(pg_engine),
        clock=lambda: NOW,
        settings=Settings(
            app_env="test",
            payment_provider="disabled",
            wechat_app_id="wx-notification-test",
            wechat_app_secret="notification-secret",
            open_game_notification_provider="wechat",
            open_game_notification_template_id="template_id-123",
            open_game_notification_keyword_mapping_json=json.dumps({
                "game_name": "thing1",
                "starts_at": "time2",
                "venue_name": "thing3",
            }),
        ),
    ) == 0

    assert len(provider.calls) == 1
    assert provider.closed is True
    with Session(pg_engine) as session:
        event = session.get_one(OpenGameNotificationOutbox, seeded.outbox_id)
        assert event.status is OpenGameNotificationStatus.SENT


def test_root_worker_closes_owned_notification_provider_when_run_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class OwnedProvider(RecordingNotificationProvider):
        closed = False

        def close(self) -> None:
            self.closed = True

    provider = OwnedProvider()
    monkeypatch.setattr(
        worker_module,
        "build_open_game_notification_provider",
        lambda settings: provider,
    )
    monkeypatch.setattr(
        worker_module.ExpiryWorker,
        "run",
        lambda worker, **kwargs: (_ for _ in ()).throw(RuntimeError("injected")),
    )
    settings = Settings(
        app_env="test",
        payment_provider="disabled",
        wechat_app_id="wx-notification-test",
        wechat_app_secret="notification-secret",
        open_game_notification_provider="wechat",
        open_game_notification_template_id="template_id-123",
        open_game_notification_keyword_mapping_json=json.dumps({
            "game_name": "thing1",
            "starts_at": "time2",
            "venue_name": "thing3",
        }),
    )

    with pytest.raises(RuntimeError, match="injected"):
        main(["--once"], settings=settings)
    assert provider.closed is True


def test_root_worker_disabled_notification_config_never_builds_a_provider(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        worker_module,
        "build_open_game_notification_provider",
        lambda settings: pytest.fail("disabled notifications must not build a provider"),
    )
    monkeypatch.setattr(worker_module.ExpiryWorker, "run", lambda worker, **kwargs: 0)

    assert main(
        ["--once"],
        settings=Settings(
            app_env="test",
            payment_provider="disabled",
            open_game_notification_provider="disabled",
            open_game_notification_template_id="residual invalid value",
            open_game_notification_keyword_mapping_json="residual invalid json",
        ),
    ) == 0
