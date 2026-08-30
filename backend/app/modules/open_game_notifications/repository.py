"""Persistence transitions for the open-game notification outbox."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session

from backend.app.models import (
    OpenGame,
    OpenGameNotificationOutbox,
    OpenGameNotificationStatus,
    OpenGameRegistration,
    OpenGameRegistrationStatus,
    OpenGameStatus,
    Order,
    OrderStatus,
    RefundCase,
    RefundCasePurpose,
    User,
)

from .provider import (
    WaitlistPromotionRecipient,
    WaitlistPromotionRequest,
    validate_safe_failure_code,
)


@dataclass(frozen=True, slots=True)
class OpenGameNotificationClaim:
    outbox_id: uuid.UUID
    claim_token: uuid.UUID


@dataclass(frozen=True, slots=True)
class PreparedOpenGameNotification:
    request: WaitlistPromotionRequest
    attempt_count: int


@dataclass(frozen=True, slots=True)
class SupersededOpenGameNotification:
    pass


NotificationPreparation = (
    PreparedOpenGameNotification | SupersededOpenGameNotification
)

_CONTROLLING_REFUND_PURPOSES = (
    RefundCasePurpose.ORDER_CANCELLATION,
    RefundCasePurpose.PAYMENT_INVENTORY_CONFLICT,
)
CLAIM_LEASE = timedelta(minutes=2)


def _affected_rows(result: object) -> int:
    rowcount = getattr(result, "rowcount", None)
    if not isinstance(rowcount, int):
        raise RuntimeError("notification outbox update did not report rowcount")
    return rowcount


class OpenGameNotificationRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def claim_next_due(
        self,
        *,
        now: datetime,
        lease_until: datetime,
    ) -> OpenGameNotificationClaim | None:
        event = self.session.scalar(
            select(OpenGameNotificationOutbox)
            .where(
                OpenGameNotificationOutbox.available_at <= now,
                or_(
                    OpenGameNotificationOutbox.status
                    == OpenGameNotificationStatus.PENDING,
                    (
                        (
                            OpenGameNotificationOutbox.status
                            == OpenGameNotificationStatus.CLAIMED
                        )
                        & (OpenGameNotificationOutbox.lease_until <= now)
                    ),
                ),
            )
            .order_by(
                OpenGameNotificationOutbox.available_at,
                OpenGameNotificationOutbox.id,
            )
            .limit(1)
            .with_for_update(skip_locked=True)
        )
        if event is None:
            return None
        token = uuid.uuid4()
        event.status = OpenGameNotificationStatus.CLAIMED
        event.claim_token = token
        event.lease_until = lease_until
        event.delivery_started_at = None
        event.completed_at = None
        event.attempt_count += 1
        self.session.flush()
        return OpenGameNotificationClaim(event.id, token)

    def prepare_claim(
        self,
        claim: OpenGameNotificationClaim,
        *,
        clock: Callable[[], datetime],
    ) -> NotificationPreparation | None:
        identity = self.session.execute(
            select(
                OpenGameNotificationOutbox.game_id,
                OpenGameNotificationOutbox.registration_id,
                OpenGameNotificationOutbox.recipient_user_id,
                OpenGame.order_id,
            )
            .join(OpenGame, OpenGame.id == OpenGameNotificationOutbox.game_id)
            .where(
                OpenGameNotificationOutbox.id == claim.outbox_id,
                OpenGameNotificationOutbox.status
                == OpenGameNotificationStatus.CLAIMED,
                OpenGameNotificationOutbox.claim_token == claim.claim_token,
                OpenGameNotificationOutbox.delivery_started_at.is_(None),
            )
        ).one_or_none()
        if identity is None:
            return None
        game_id, registration_id, recipient_user_id, order_id = identity

        # Match the domain mutation order.  These locks are held only during
        # final authorization/marker commit and are released before Provider I/O.
        order = self.session.scalar(
            select(Order)
            .where(Order.id == order_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if order is None:
            return None
        game = self.session.scalar(
            select(OpenGame)
            .where(OpenGame.id == game_id, OpenGame.order_id == order.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if game is None:
            return None
        registration = self.session.scalar(
            select(OpenGameRegistration)
            .where(
                OpenGameRegistration.id == registration_id,
                OpenGameRegistration.game_id == game.id,
                OpenGameRegistration.applicant_user_id == recipient_user_id,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if registration is None:
            return None
        event = self.session.scalar(
            select(OpenGameNotificationOutbox)
            .where(
                OpenGameNotificationOutbox.id == claim.outbox_id,
                OpenGameNotificationOutbox.game_id == game.id,
                OpenGameNotificationOutbox.registration_id == registration.id,
                OpenGameNotificationOutbox.recipient_user_id
                == recipient_user_id,
                OpenGameNotificationOutbox.status
                == OpenGameNotificationStatus.CLAIMED,
                OpenGameNotificationOutbox.claim_token == claim.claim_token,
                OpenGameNotificationOutbox.delivery_started_at.is_(None),
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if event is None:
            return None
        recipient = self.session.execute(
            select(User.wechat_app_id, User.wechat_openid).where(
                User.id == recipient_user_id
            )
        ).one_or_none()
        if recipient is None:
            return None
        controlling_refund_exists = self.session.scalar(
            select(RefundCase.id)
            .where(
                RefundCase.order_id == order.id,
                RefundCase.purpose.in_(_CONTROLLING_REFUND_PURPOSES),
            )
            .limit(1)
        )
        if (
            registration.status is not OpenGameRegistrationStatus.JOINED
            or game.status is not OpenGameStatus.PUBLISHED
            or order.status is not OrderStatus.CONFIRMED
            or order.cancel_requested_at is not None
            or controlling_refund_exists is not None
        ):
            return SupersededOpenGameNotification()
        request = WaitlistPromotionRequest(
            dedupe_key=event.dedupe_key,
            recipient=WaitlistPromotionRecipient(
                app_id=recipient[0],
                openid=recipient[1],
            ),
            template_key=event.template_key,
            data=event.payload,
        )
        authorization_time = clock()
        if (
            event.lease_until is None
            or event.lease_until <= authorization_time
        ):
            return None
        event.delivery_started_at = authorization_time
        event.lease_until = authorization_time + CLAIM_LEASE
        self.session.flush()
        return PreparedOpenGameNotification(
            request=request,
            attempt_count=event.attempt_count,
        )

    def complete_sent(
        self,
        claim: OpenGameNotificationClaim,
        *,
        completed_at: datetime,
    ) -> bool:
        result = self.session.execute(
            update(OpenGameNotificationOutbox)
            .where(
                OpenGameNotificationOutbox.id == claim.outbox_id,
                OpenGameNotificationOutbox.status
                == OpenGameNotificationStatus.CLAIMED,
                OpenGameNotificationOutbox.claim_token == claim.claim_token,
                OpenGameNotificationOutbox.delivery_started_at.is_not(None),
            )
            .values(
                status=OpenGameNotificationStatus.SENT,
                completed_at=completed_at,
                claim_token=None,
                lease_until=None,
                last_failure_code=None,
            )
        )
        self.session.flush()
        return _affected_rows(result) == 1

    def reschedule(
        self,
        claim: OpenGameNotificationClaim,
        *,
        available_at: datetime,
        safe_failure_code: str,
    ) -> bool:
        validate_safe_failure_code(safe_failure_code)
        result = self.session.execute(
            update(OpenGameNotificationOutbox)
            .where(
                OpenGameNotificationOutbox.id == claim.outbox_id,
                OpenGameNotificationOutbox.status
                == OpenGameNotificationStatus.CLAIMED,
                OpenGameNotificationOutbox.claim_token == claim.claim_token,
            )
            .values(
                status=OpenGameNotificationStatus.PENDING,
                available_at=available_at,
                delivery_started_at=None,
                completed_at=None,
                claim_token=None,
                lease_until=None,
                last_failure_code=safe_failure_code,
            )
        )
        self.session.flush()
        return _affected_rows(result) == 1

    def fail(
        self,
        claim: OpenGameNotificationClaim,
        *,
        completed_at: datetime,
        safe_failure_code: str,
    ) -> bool:
        validate_safe_failure_code(safe_failure_code)
        result = self.session.execute(
            update(OpenGameNotificationOutbox)
            .where(
                OpenGameNotificationOutbox.id == claim.outbox_id,
                OpenGameNotificationOutbox.status
                == OpenGameNotificationStatus.CLAIMED,
                OpenGameNotificationOutbox.claim_token == claim.claim_token,
            )
            .values(
                status=OpenGameNotificationStatus.FAILED,
                completed_at=completed_at,
                claim_token=None,
                lease_until=None,
                last_failure_code=safe_failure_code,
            )
        )
        self.session.flush()
        return _affected_rows(result) == 1

    def supersede_claim(
        self,
        claim: OpenGameNotificationClaim,
        *,
        completed_at: datetime,
    ) -> bool:
        result = self.session.execute(
            update(OpenGameNotificationOutbox)
            .where(
                OpenGameNotificationOutbox.id == claim.outbox_id,
                OpenGameNotificationOutbox.status
                == OpenGameNotificationStatus.CLAIMED,
                OpenGameNotificationOutbox.claim_token == claim.claim_token,
            )
            .values(
                status=OpenGameNotificationStatus.SUPERSEDED,
                completed_at=completed_at,
                claim_token=None,
                lease_until=None,
                last_failure_code=None,
            )
        )
        self.session.flush()
        return _affected_rows(result) == 1

    def supersede_unsent_for_game(
        self,
        *,
        game_id: uuid.UUID,
        completed_at: datetime,
    ) -> int:
        """Fence open work; CLAIMED work may already have crossed send-start."""
        result = self.session.execute(
            update(OpenGameNotificationOutbox)
            .where(
                OpenGameNotificationOutbox.game_id == game_id,
                OpenGameNotificationOutbox.status.in_(
                    (
                        OpenGameNotificationStatus.PENDING,
                        OpenGameNotificationStatus.CLAIMED,
                    )
                ),
            )
            .values(
                status=OpenGameNotificationStatus.SUPERSEDED,
                completed_at=completed_at,
                claim_token=None,
                lease_until=None,
                last_failure_code=None,
            )
        )
        self.session.flush()
        return _affected_rows(result)
