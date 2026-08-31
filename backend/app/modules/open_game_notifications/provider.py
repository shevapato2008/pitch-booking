"""Provider-neutral contract for open-game notifications."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Protocol, cast

from backend.app.models import WaitlistPromotedNotificationPayload

PROVIDER_MAX_REQUEST_DURATION = timedelta(seconds=30)
_PAYLOAD_KEYS = frozenset({"game_name", "starts_at", "venue_name"})
_SAFE_FAILURE_CODE = re.compile(r"^[A-Z][A-Z0-9_]{0,63}$")


def _nonempty(value: str, *, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field_name} must be a non-empty string")
    return value


def validate_safe_failure_code(value: str) -> str:
    if _SAFE_FAILURE_CODE.fullmatch(value) is None:
        raise ValueError("safe failure code must match ^[A-Z][A-Z0-9_]{0,63}$")
    return value


@dataclass(frozen=True, slots=True)
class WaitlistPromotionRecipient:
    app_id: str
    openid: str = field(repr=False)

    def __post_init__(self) -> None:
        _nonempty(self.app_id, field_name="app_id")
        _nonempty(self.openid, field_name="openid")


@dataclass(frozen=True, slots=True)
class WaitlistPromotionRequest:
    dedupe_key: str
    recipient: WaitlistPromotionRecipient
    template_key: str
    data: WaitlistPromotedNotificationPayload

    def __post_init__(self) -> None:
        _nonempty(self.dedupe_key, field_name="dedupe_key")
        _nonempty(self.template_key, field_name="template_key")
        if not isinstance(self.data, dict):
            raise ValueError("data must be a closed waitlist-promotion payload")
        copied: dict[str, object] = dict(self.data)
        if set(copied) != _PAYLOAD_KEYS or any(
            not isinstance(value, str) or not value.strip()
            for value in copied.values()
        ):
            raise ValueError("data must be a closed waitlist-promotion payload")
        object.__setattr__(
            self,
            "data",
            cast(WaitlistPromotedNotificationPayload, copied),
        )


@dataclass(frozen=True, slots=True)
class NotificationAccepted:
    pass


@dataclass(frozen=True, slots=True)
class NotificationRejected:
    safe_error_code: str
    retryable: bool

    def __post_init__(self) -> None:
        validate_safe_failure_code(self.safe_error_code)


type NotificationResult = NotificationAccepted | NotificationRejected


class OpenGameNotificationProvider(Protocol):
    """Provider adapter whose complete ``send`` call hard-times out within 30s."""

    @property
    def provider_name(self) -> str: ...

    def send(self, request: WaitlistPromotionRequest) -> NotificationResult: ...
