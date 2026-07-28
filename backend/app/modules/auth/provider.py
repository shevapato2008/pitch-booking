import hashlib
import logging
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Protocol

import httpx

from backend.app.config import Settings
from backend.app.modules.auth.dto import VerifiedPhone, WeChatIdentity

_WECHAT_BASE_URL = "https://api.weixin.qq.com"
_STRICT_TIMEOUT = httpx.Timeout(connect=2.0, read=3.0, write=3.0, pool=2.0)
_PHONE_UNAVAILABLE_CODES = frozenset({48001, 48002, 48004, 61011})
logger = logging.getLogger(__name__)


def configure_safe_http_logging() -> None:
    httpx_logger = logging.getLogger("httpx")
    if httpx_logger.level < logging.WARNING:
        httpx_logger.setLevel(logging.WARNING)


class IdentityProviderError(Exception):
    """Safe internal identity-exchange failure."""


class PhoneProviderError(Exception):
    """Safe internal phone-exchange failure."""


class PhoneCapabilityUnavailableError(PhoneProviderError):
    """The configured WeChat account cannot use the phone capability."""


class IdentityProvider(Protocol):
    def exchange(self, code: str) -> WeChatIdentity: ...


class PhoneProvider(Protocol):
    def exchange(self, code: str) -> VerifiedPhone: ...


@dataclass
class ProviderBundle:
    identity_provider: IdentityProvider
    phone_provider: PhoneProvider
    owned_client: httpx.Client | None = field(default=None, repr=False)
    _closed: bool = field(default=False, init=False, repr=False)
    _close_lock: threading.Lock = field(default_factory=threading.Lock, init=False, repr=False)

    @property
    def is_closed(self) -> bool:
        with self._close_lock:
            return self._closed

    def close(self) -> None:
        with self._close_lock:
            if self._closed:
                return
            if self.owned_client is not None:
                self.owned_client.close()
            self._closed = True


class RealWeChatIdentityProvider:
    def __init__(self, *, client: httpx.Client, app_id: str, app_secret: str) -> None:
        configure_safe_http_logging()
        self._client = client
        self._app_id = _required_credential(app_id, "app id")
        self._app_secret = _required_credential(app_secret, "app secret")

    def exchange(self, code: str) -> WeChatIdentity:
        try:
            response = self._client.get(
                f"{_WECHAT_BASE_URL}/sns/jscode2session",
                params={
                    "appid": self._app_id,
                    "secret": self._app_secret,
                    "js_code": code,
                    "grant_type": "authorization_code",
                },
                timeout=_STRICT_TIMEOUT,
            )
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, dict) or payload.get("errcode") not in {None, 0}:
                raise IdentityProviderError("identity exchange failed")
            openid = payload.get("openid")
            session_key = payload.get("session_key")
            unionid = payload.get("unionid")
            if (
                not isinstance(openid, str)
                or not openid
                or not isinstance(session_key, str)
                or not session_key
                or unionid is not None
                and not isinstance(unionid, str)
            ):
                raise IdentityProviderError("identity exchange failed")
            return WeChatIdentity(openid=openid, unionid=unionid, session_key=session_key)
        except IdentityProviderError:
            logger.warning("wechat_identity_exchange_failed")
            raise
        except (httpx.HTTPError, TypeError, ValueError):
            logger.warning("wechat_identity_exchange_failed")
            raise IdentityProviderError("identity exchange failed") from None


class RealWeChatPhoneProvider:
    def __init__(
        self,
        *,
        client: httpx.Client,
        app_id: str,
        app_secret: str,
        now: Callable[[], float] | None = None,
    ) -> None:
        configure_safe_http_logging()
        self._client = client
        self._app_id = _required_credential(app_id, "app id")
        self._app_secret = _required_credential(app_secret, "app secret")
        self._now = now or time.monotonic
        self._access_token: str | None = None
        self._access_token_expires_at = 0.0
        self._access_token_lock = threading.Lock()

    def exchange(self, code: str) -> VerifiedPhone:
        try:
            access_token = self._get_access_token()
            response = self._client.post(
                f"{_WECHAT_BASE_URL}/wxa/business/getuserphonenumber",
                params={"access_token": access_token},
                json={"code": code},
                timeout=_STRICT_TIMEOUT,
            )
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, dict):
                raise PhoneProviderError("phone exchange failed")
            errcode = payload.get("errcode", 0)
            if errcode in _PHONE_UNAVAILABLE_CODES:
                raise PhoneCapabilityUnavailableError("phone capability unavailable")
            if errcode != 0:
                raise PhoneProviderError("phone exchange failed")
            phone_info = payload.get("phone_info")
            phone = phone_info.get("purePhoneNumber") if isinstance(phone_info, dict) else None
            if not isinstance(phone, str) or not phone:
                raise PhoneProviderError("phone exchange failed")
            return VerifiedPhone(phone)
        except PhoneCapabilityUnavailableError:
            logger.warning("wechat_phone_capability_unavailable")
            raise
        except PhoneProviderError:
            logger.warning("wechat_phone_exchange_failed")
            raise
        except (httpx.HTTPError, TypeError, ValueError):
            logger.warning("wechat_phone_exchange_failed")
            raise PhoneProviderError("phone exchange failed") from None

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
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, dict) or payload.get("errcode") not in {None, 0}:
                raise PhoneProviderError("phone exchange failed")
            token = payload.get("access_token")
            expires_in = payload.get("expires_in")
            if (
                not isinstance(token, str)
                or not token
                or type(expires_in) is not int
                or expires_in <= 0
            ):
                raise PhoneProviderError("phone exchange failed")
            self._access_token = token
            self._access_token_expires_at = now + max(1, expires_in - 300)
            return token
        except PhoneProviderError:
            raise
        except (httpx.HTTPError, TypeError, ValueError):
            raise PhoneProviderError("phone exchange failed") from None


class DevelopmentWeChatProvider:
    def __init__(self, settings: Settings) -> None:
        if settings.app_env not in {"development", "test"} or settings.wechat_provider != (
            "development"
        ):
            raise ValueError("development provider is not allowed")

    def exchange(self, code: str) -> WeChatIdentity:
        if not code.startswith("dev-"):
            raise IdentityProviderError("identity exchange failed")
        suffix = hashlib.sha256(code.encode()).hexdigest()[:32]
        return WeChatIdentity(
            openid=f"dev-openid-{suffix}",
            unionid=None,
            session_key=f"dev-session-{suffix}",
        )

    def exchange_phone(self, code: str) -> VerifiedPhone:
        if not code.startswith("dev-"):
            raise PhoneProviderError("phone exchange failed")
        return VerifiedPhone("13812345678")


class DevelopmentWeChatPhoneProvider:
    def __init__(self, provider: DevelopmentWeChatProvider) -> None:
        self._provider = provider

    def exchange(self, code: str) -> VerifiedPhone:
        return self._provider.exchange_phone(code)


def build_providers(
    settings: Settings,
    *,
    client_factory: Callable[[], httpx.Client] | None = None,
) -> ProviderBundle:
    if settings.wechat_provider == "development":
        identity = DevelopmentWeChatProvider(settings)
        return ProviderBundle(
            identity_provider=identity,
            phone_provider=DevelopmentWeChatPhoneProvider(identity),
        )
    if settings.wechat_app_id is None or settings.wechat_app_secret is None:
        raise ValueError("real WeChat provider credentials are required")
    configure_safe_http_logging()
    client = (client_factory or httpx.Client)()
    secret = settings.wechat_app_secret.get_secret_value()
    try:
        identity_provider = RealWeChatIdentityProvider(
            client=client,
            app_id=settings.wechat_app_id,
            app_secret=secret,
        )
        phone_provider = RealWeChatPhoneProvider(
            client=client,
            app_id=settings.wechat_app_id,
            app_secret=secret,
        )
    except BaseException:
        client.close()
        raise
    return ProviderBundle(
        identity_provider=identity_provider,
        phone_provider=phone_provider,
        owned_client=client,
    )


def _required_credential(value: object, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"WeChat {name} is required")
    return value
