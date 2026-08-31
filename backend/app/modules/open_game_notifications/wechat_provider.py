"""Strict WeChat subscription-message adapter for waitlist promotions."""

from __future__ import annotations

import re
import threading
import time
from collections.abc import Callable, Mapping
from datetime import datetime
from typing import Literal
from zoneinfo import ZoneInfo

import httpx

from backend.app.config import Settings
from backend.app.modules.auth.provider import configure_safe_http_logging
from backend.app.modules.open_game_notifications.provider import (
    NotificationAccepted,
    NotificationRejected,
    NotificationResult,
    WaitlistPromotionRequest,
)

_WECHAT_BASE_URL = "https://api.weixin.qq.com"
_STRICT_TIMEOUT = httpx.Timeout(connect=2.0, read=3.0, write=3.0, pool=2.0)
_TEMPLATE_ID = re.compile(r"[A-Za-z0-9_-]{1,128}", re.ASCII)
_KEYWORDS = {
    "game_name": re.compile(r"thing[1-9][0-9]*", re.ASCII),
    "starts_at": re.compile(r"time[1-9][0-9]*", re.ASCII),
    "venue_name": re.compile(r"thing[1-9][0-9]*", re.ASCII),
}
_INVALID_TOKEN_CODES = frozenset({40001, 40014, 42001})
_TEMPORARY_CODES = frozenset({-1, 45009})
_BUSINESS_FAILURES = {
    43101: "RECIPIENT_UNSUBSCRIBED",
    40037: "TEMPLATE_INVALID",
    47003: "TEMPLATE_DATA_INVALID",
    41030: "PAGE_INVALID",
    40003: "RECIPIENT_INVALID",
}
_SHANGHAI = ZoneInfo("Asia/Shanghai")
_PAGE = "pages/my-game-registrations/index"


class _ProviderFailure(Exception):
    def __init__(self, safe_error_code: str, *, retryable: bool) -> None:
        super().__init__(safe_error_code)
        self.result = NotificationRejected(safe_error_code, retryable=retryable)


class WeChatOpenGameNotificationProvider:
    provider_name = "wechat"

    def __init__(
        self,
        *,
        client: httpx.Client,
        app_id: str,
        app_secret: str,
        template_id: str,
        keyword_mapping: Mapping[str, str],
        miniprogram_state: Literal["formal", "trial", "developer"],
        now: Callable[[], float] | None = None,
    ) -> None:
        configure_safe_http_logging()
        if not isinstance(app_id, str) or not app_id.strip():
            raise ValueError("WeChat notification app id is required")
        if not isinstance(app_secret, str) or not app_secret.strip():
            raise ValueError("WeChat notification app secret is required")
        if _TEMPLATE_ID.fullmatch(template_id) is None:
            raise ValueError("WeChat notification template id is invalid")
        copied_mapping = dict(keyword_mapping)
        if (
            set(copied_mapping) != set(_KEYWORDS)
            or any(
                type(copied_mapping.get(name)) is not str
                or pattern.fullmatch(copied_mapping[name]) is None
                for name, pattern in _KEYWORDS.items()
            )
            or len(set(copied_mapping.values())) != len(copied_mapping)
        ):
            raise ValueError("WeChat notification keyword mapping is invalid")
        if miniprogram_state not in {"formal", "trial", "developer"}:
            raise ValueError("WeChat notification Mini Program state is invalid")
        self._client = client
        self._app_id = app_id
        self._app_secret = app_secret
        self._template_id = template_id
        self._keyword_mapping = copied_mapping
        self._miniprogram_state = miniprogram_state
        self._now = now or time.monotonic
        self._access_token: str | None = None
        self._access_token_expires_at = 0.0
        self._access_token_lock = threading.Lock()
        self._close_lock = threading.Lock()
        self._closed = False

    def __repr__(self) -> str:
        return f"{type(self).__name__}(provider_name='wechat')"

    def close(self) -> None:
        with self._close_lock:
            if self._closed:
                return
            self._client.close()
            self._closed = True

    def send(self, request: WaitlistPromotionRequest) -> NotificationResult:
        if request.recipient.app_id != self._app_id:
            return NotificationRejected("RECIPIENT_APP_MISMATCH", retryable=False)
        if request.template_key != "waitlist-promoted":
            return NotificationRejected("TEMPLATE_KEY_UNSUPPORTED", retryable=False)
        payload = self._build_payload(request)
        if payload is None:
            return NotificationRejected("TEMPLATE_DATA_INVALID", retryable=False)
        try:
            access_token = self._get_access_token()
        except _ProviderFailure as failure:
            return failure.result
        for send_number in range(2):
            result = self._send_once(access_token, payload)
            if result != "INVALID_TOKEN":
                return result
            if send_number == 1:
                return NotificationRejected("WECHAT_TOKEN_REJECTED", retryable=False)
            self._invalidate_access_token(access_token)
            try:
                access_token = self._get_access_token()
            except _ProviderFailure as failure:
                return failure.result
        return NotificationRejected("WECHAT_NOTIFICATION_REJECTED", retryable=False)

    def _build_payload(self, request: WaitlistPromotionRequest) -> dict[str, object] | None:
        try:
            starts_at = datetime.fromisoformat(request.data["starts_at"])
        except (TypeError, ValueError):
            return None
        if starts_at.tzinfo is None or starts_at.utcoffset() is None:
            return None
        starts_at_shanghai = starts_at.astimezone(_SHANGHAI)
        values = {
            "game_name": request.data["game_name"][:20],
            "starts_at": starts_at_shanghai.strftime("%Y年%m月%d日 %H:%M"),
            "venue_name": request.data["venue_name"][:20],
        }
        return {
            "touser": request.recipient.openid,
            "template_id": self._template_id,
            "page": _PAGE,
            "miniprogram_state": self._miniprogram_state,
            "lang": "zh_CN",
            "data": {
                self._keyword_mapping[name]: {"value": value}
                for name, value in values.items()
            },
        }

    def _send_once(
        self,
        access_token: str,
        payload: dict[str, object],
    ) -> NotificationResult | Literal["INVALID_TOKEN"]:
        try:
            response = self._client.post(
                f"{_WECHAT_BASE_URL}/cgi-bin/message/subscribe/send",
                params={"access_token": access_token},
                json=payload,
                timeout=_STRICT_TIMEOUT,
            )
        except httpx.HTTPError:
            return NotificationRejected("WECHAT_NOTIFICATION_TEMPORARY", retryable=True)
        if response.status_code == 429 or response.status_code >= 500:
            return NotificationRejected("WECHAT_NOTIFICATION_TEMPORARY", retryable=True)
        if response.status_code < 200 or response.status_code >= 300:
            return NotificationRejected("WECHAT_NOTIFICATION_REJECTED", retryable=False)
        try:
            body = response.json()
        except (TypeError, ValueError):
            return NotificationRejected("WECHAT_NOTIFICATION_TEMPORARY", retryable=True)
        if not isinstance(body, dict) or type(body.get("errcode", 0)) is not int:
            return NotificationRejected("WECHAT_NOTIFICATION_TEMPORARY", retryable=True)
        errcode = body.get("errcode", 0)
        if errcode == 0:
            return NotificationAccepted()
        if errcode in _INVALID_TOKEN_CODES:
            return "INVALID_TOKEN"
        if errcode in _TEMPORARY_CODES:
            return NotificationRejected("WECHAT_NOTIFICATION_TEMPORARY", retryable=True)
        safe_error_code = _BUSINESS_FAILURES.get(errcode, "WECHAT_NOTIFICATION_REJECTED")
        return NotificationRejected(safe_error_code, retryable=False)

    def _get_access_token(self) -> str:
        now = self._now()
        if self._access_token is not None and now < self._access_token_expires_at:
            return self._access_token
        with self._access_token_lock:
            now = self._now()
            if self._access_token is not None and now < self._access_token_expires_at:
                return self._access_token
            return self._refresh_access_token(now)

    def _refresh_access_token(self, now: float) -> str:
        try:
            response = self._client.get(
                f"{_WECHAT_BASE_URL}/cgi-bin/token",
                params={
                    "grant_type": "client_credential",
                    "appid": self._app_id,
                    "secret": self._app_secret,
                },
                timeout=_STRICT_TIMEOUT,
            )
        except httpx.HTTPError:
            raise _ProviderFailure("WECHAT_TOKEN_UNAVAILABLE", retryable=True) from None
        if response.status_code == 429 or response.status_code >= 500:
            raise _ProviderFailure("WECHAT_TOKEN_UNAVAILABLE", retryable=True)
        if response.status_code < 200 or response.status_code >= 300:
            raise _ProviderFailure("WECHAT_TOKEN_REJECTED", retryable=False)
        try:
            body = response.json()
        except (TypeError, ValueError):
            raise _ProviderFailure("WECHAT_TOKEN_UNAVAILABLE", retryable=True) from None
        if not isinstance(body, dict):
            raise _ProviderFailure("WECHAT_TOKEN_UNAVAILABLE", retryable=True)
        errcode = body.get("errcode", 0)
        if type(errcode) is not int:
            raise _ProviderFailure("WECHAT_TOKEN_UNAVAILABLE", retryable=True)
        if errcode != 0:
            if errcode in _TEMPORARY_CODES:
                raise _ProviderFailure("WECHAT_TOKEN_UNAVAILABLE", retryable=True)
            raise _ProviderFailure("WECHAT_TOKEN_REJECTED", retryable=False)
        token = body.get("access_token")
        expires_in = body.get("expires_in")
        if (
            type(token) is not str
            or not token
            or type(expires_in) is not int
            or expires_in <= 0
        ):
            raise _ProviderFailure("WECHAT_TOKEN_UNAVAILABLE", retryable=True)
        self._access_token = token
        self._access_token_expires_at = now + max(1, expires_in - 300)
        return token

    def _invalidate_access_token(self, rejected_token: str) -> None:
        with self._access_token_lock:
            if self._access_token != rejected_token:
                return
            self._access_token = None
            self._access_token_expires_at = 0.0


def build_open_game_notification_provider(
    settings: Settings,
    *,
    client_factory: Callable[[], httpx.Client] | None = None,
) -> WeChatOpenGameNotificationProvider | None:
    if settings.open_game_notification_provider == "disabled":
        return None
    mapping = settings.open_game_notification_keyword_mapping
    if (
        settings.wechat_app_id is None
        or settings.wechat_app_secret is None
        or settings.open_game_notification_template_id is None
        or mapping is None
    ):
        raise ValueError("WeChat notification configuration is incomplete")
    client = (client_factory or httpx.Client)()
    try:
        return WeChatOpenGameNotificationProvider(
            client=client,
            app_id=settings.wechat_app_id,
            app_secret=settings.wechat_app_secret.get_secret_value(),
            template_id=settings.open_game_notification_template_id,
            keyword_mapping=mapping,
            miniprogram_state=settings.open_game_notification_miniprogram_state,
        )
    except BaseException:
        client.close()
        raise
