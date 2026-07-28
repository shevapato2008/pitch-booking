import base64
import hashlib
import logging
import subprocess
import sys
import threading
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, func, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

import backend.app.modules.auth.provider as auth_provider_module
from backend.app.config import Settings
from backend.app.database import get_database
from backend.app.errors import AppError
from backend.app.main import create_app
from backend.app.models import User, UserSession
from backend.app.modules.auth.dto import VerifiedPhone, WeChatIdentity
from backend.app.modules.auth.provider import (
    DevelopmentWeChatProvider,
    IdentityProviderError,
    PhoneCapabilityUnavailableError,
    PhoneProviderError,
    ProviderBundle,
    RealWeChatIdentityProvider,
    RealWeChatPhoneProvider,
    build_providers,
)
from backend.app.modules.auth.repository import AuthRepository
from backend.app.modules.auth.router import get_identity_provider, get_phone_provider
from backend.app.modules.auth.service import AuthService
from backend.app.security.phone_vault import PhoneVault, SealedPhone

APP_SECRET = "app-secret-auth-leak-sentinel"
LOGIN_CODE = "login-code-auth-leak-sentinel"
PHONE_CODE = "phone-code-auth-leak-sentinel"
ACCESS_TOKEN = "access-token-auth-leak-sentinel"
SESSION_KEY = "session-key-auth-leak-sentinel"
UNIONID = "unionid-auth-leak-sentinel"
BUSINESS_TOKEN = "business-token-auth-leak-sentinel-012345678901234567890"
RAW_MARKER = "raw-provider-response-auth-leak-sentinel"
FULL_PHONE = "13812345678"
KEY_BASE64 = base64.b64encode(bytes(range(32))).decode("ascii")
NOW = datetime(2026, 7, 28, 12, 0, tzinfo=UTC)


class StubIdentityProvider:
    def __init__(self, identity: WeChatIdentity | Exception) -> None:
        self.identity = identity
        self.codes: list[str] = []

    def exchange(self, code: str) -> WeChatIdentity:
        self.codes.append(code)
        if isinstance(self.identity, Exception):
            raise self.identity
        return self.identity


class StubPhoneProvider:
    def __init__(self, phones: dict[str, VerifiedPhone | Exception]) -> None:
        self.phones = phones
        self.codes: list[str] = []

    def exchange(self, code: str) -> VerifiedPhone:
        self.codes.append(code)
        result = self.phones[code]
        if isinstance(result, Exception):
            raise result
        return result


class ConcurrentIdentityProvider:
    def __init__(self, request_count: int) -> None:
        self._barrier = threading.Barrier(request_count)

    def exchange(self, _code: str) -> WeChatIdentity:
        self._barrier.wait(timeout=10)
        return WeChatIdentity("concurrent-openid", "concurrent-unionid", SESSION_KEY)


class ConcurrentMappedIdentityProvider:
    def __init__(self, identities: dict[str, WeChatIdentity]) -> None:
        self._identities = identities
        self._barrier = threading.Barrier(len(identities))

    def exchange(self, code: str) -> WeChatIdentity:
        self._barrier.wait(timeout=10)
        return self._identities[code]


@pytest.fixture
def vault() -> PhoneVault:
    return PhoneVault(key_base64=KEY_BASE64, key_version=7)


def _service(
    session: Session,
    vault: PhoneVault,
    *,
    identity: WeChatIdentity | Exception | None = None,
    phones: dict[str, VerifiedPhone | Exception] | None = None,
    now: datetime = NOW,
) -> AuthService:
    return AuthService(
        repository=AuthRepository(session),
        identity_provider=StubIdentityProvider(
            identity
            or WeChatIdentity(
                openid="openid-one",
                unionid="unionid-one",
                session_key=SESSION_KEY,
            )
        ),
        phone_provider=StubPhoneProvider(phones or {}),
        phone_vault=vault,
        session_ttl=timedelta(days=30),
        now=lambda: now,
    )


def test_real_identity_provider_returns_internal_dto_without_logging_secrets(
    caplog: pytest.LogCaptureFixture,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/sns/jscode2session"
        assert request.url.params["appid"] == "wx-app-id"
        assert request.url.params["secret"] == APP_SECRET
        assert request.url.params["js_code"] == LOGIN_CODE
        return httpx.Response(
            200,
            json={
                "openid": "openid-real",
                "unionid": "unionid-real",
                "session_key": SESSION_KEY,
                "watermark": RAW_MARKER,
            },
        )

    provider = RealWeChatIdentityProvider(
        client=httpx.Client(transport=httpx.MockTransport(handler)),
        app_id="wx-app-id",
        app_secret=APP_SECRET,
    )
    with caplog.at_level(logging.INFO):
        identity = provider.exchange(LOGIN_CODE)

    assert identity == WeChatIdentity("openid-real", "unionid-real", SESSION_KEY)
    assert repr(identity).find(SESSION_KEY) == -1
    _assert_no_secret_leak(caplog.text)


def test_auth_provider_import_and_reload_do_not_install_logging_filters() -> None:
    script = """
import importlib
import logging
import backend.app.modules.auth.provider as provider
logger = logging.getLogger('httpx')
assert not [item for item in logger.filters if item.__class__.__module__ == provider.__name__]
before = tuple(logger.filters)
importlib.reload(provider)
assert tuple(logger.filters) == before
"""

    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=".",
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr


def test_safe_http_logging_configuration_is_idempotent_and_does_not_mutate_records() -> None:
    httpx_logger = logging.getLogger("httpx")
    original_level = httpx_logger.level
    original_filters = tuple(httpx_logger.filters)
    secret_url = httpx.URL(f"https://api.weixin.qq.com/token?secret={APP_SECRET}")
    record = logging.LogRecord(
        name="httpx",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="HTTP Request: %s %s",
        args=("GET", secret_url),
        exc_info=None,
    )
    try:
        auth_provider_module.configure_safe_http_logging()
        auth_provider_module.configure_safe_http_logging()

        assert httpx_logger.level >= logging.WARNING
        assert tuple(httpx_logger.filters) == original_filters
        assert record.args == ("GET", secret_url)
    finally:
        httpx_logger.setLevel(original_level)


@pytest.mark.parametrize(
    ("response", "expected_error"),
    [
        ({"errcode": 40029, "errmsg": RAW_MARKER}, IdentityProviderError),
        (httpx.ReadTimeout(RAW_MARKER), IdentityProviderError),
    ],
)
def test_real_identity_provider_maps_raw_failures_to_safe_internal_error(
    response: dict[str, object] | Exception,
    expected_error: type[Exception],
    caplog: pytest.LogCaptureFixture,
) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        if isinstance(response, Exception):
            raise response
        return httpx.Response(200, json=response)

    provider = RealWeChatIdentityProvider(
        client=httpx.Client(transport=httpx.MockTransport(handler)),
        app_id="wx-app-id",
        app_secret=APP_SECRET,
    )
    with caplog.at_level(logging.INFO), pytest.raises(expected_error, match="identity exchange"):
        provider.exchange(LOGIN_CODE)

    _assert_no_secret_leak(caplog.text)


def test_real_phone_provider_caches_access_token_and_returns_internal_dto(
    caplog: pytest.LogCaptureFixture,
) -> None:
    requested_paths: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requested_paths.append(request.url.path)
        if request.url.path == "/cgi-bin/token":
            assert request.url.params["secret"] == APP_SECRET
            return httpx.Response(
                200,
                json={"access_token": ACCESS_TOKEN, "expires_in": 7200, "marker": RAW_MARKER},
            )
        assert request.url.path == "/wxa/business/getuserphonenumber"
        assert request.url.params["access_token"] == ACCESS_TOKEN
        assert request.read().decode() == '{"code":"' + PHONE_CODE + '"}'
        return httpx.Response(
            200,
            json={"errcode": 0, "phone_info": {"purePhoneNumber": FULL_PHONE}},
        )

    provider = RealWeChatPhoneProvider(
        client=httpx.Client(transport=httpx.MockTransport(handler)),
        app_id="wx-app-id",
        app_secret=APP_SECRET,
        now=lambda: 100.0,
    )
    with caplog.at_level(logging.INFO):
        assert provider.exchange(PHONE_CODE) == VerifiedPhone(FULL_PHONE)
        assert provider.exchange(PHONE_CODE) == VerifiedPhone(FULL_PHONE)

    assert requested_paths.count("/cgi-bin/token") == 1
    assert requested_paths.count("/wxa/business/getuserphonenumber") == 2
    _assert_no_secret_leak(caplog.text)


@pytest.mark.parametrize(
    ("wechat_error", "expected"),
    [
        ({"errcode": 40029, "errmsg": RAW_MARKER}, PhoneProviderError),
        ({"errcode": 48001, "errmsg": RAW_MARKER}, PhoneCapabilityUnavailableError),
    ],
)
def test_real_phone_provider_maps_wechat_errors(
    wechat_error: dict[str, object],
    expected: type[Exception],
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/cgi-bin/token":
            return httpx.Response(200, json={"access_token": ACCESS_TOKEN, "expires_in": 7200})
        return httpx.Response(200, json=wechat_error)

    provider = RealWeChatPhoneProvider(
        client=httpx.Client(transport=httpx.MockTransport(handler)),
        app_id="wx-app-id",
        app_secret=APP_SECRET,
    )
    with pytest.raises(expected):
        provider.exchange(PHONE_CODE)


def test_real_phone_provider_maps_access_token_timeout_with_strict_timeouts(
    caplog: pytest.LogCaptureFixture,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/cgi-bin/token"
        assert request.extensions["timeout"] == {
            "connect": 2.0,
            "read": 3.0,
            "write": 3.0,
            "pool": 2.0,
        }
        raise httpx.ConnectTimeout(RAW_MARKER, request=request)

    provider = RealWeChatPhoneProvider(
        client=httpx.Client(transport=httpx.MockTransport(handler)),
        app_id="wx-app-id",
        app_secret=APP_SECRET,
    )
    with caplog.at_level(logging.DEBUG), pytest.raises(PhoneProviderError):
        provider.exchange(PHONE_CODE)

    _assert_no_secret_leak(caplog.text)


def test_real_phone_provider_maps_phone_exchange_timeout_with_strict_timeouts(
    caplog: pytest.LogCaptureFixture,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.extensions["timeout"] == {
            "connect": 2.0,
            "read": 3.0,
            "write": 3.0,
            "pool": 2.0,
        }
        if request.url.path == "/cgi-bin/token":
            return httpx.Response(200, json={"access_token": ACCESS_TOKEN, "expires_in": 7200})
        raise httpx.ReadTimeout(RAW_MARKER, request=request)

    provider = RealWeChatPhoneProvider(
        client=httpx.Client(transport=httpx.MockTransport(handler)),
        app_id="wx-app-id",
        app_secret=APP_SECRET,
    )
    with caplog.at_level(logging.DEBUG), pytest.raises(PhoneProviderError):
        provider.exchange(PHONE_CODE)

    _assert_no_secret_leak(caplog.text)


def test_real_phone_provider_refreshes_access_token_after_safe_cache_expiry() -> None:
    clock = [100.0]
    issued_tokens: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/cgi-bin/token":
            token = f"{ACCESS_TOKEN}-{len(issued_tokens) + 1}"
            issued_tokens.append(token)
            return httpx.Response(200, json={"access_token": token, "expires_in": 600})
        return httpx.Response(
            200,
            json={"errcode": 0, "phone_info": {"purePhoneNumber": FULL_PHONE}},
        )

    provider = RealWeChatPhoneProvider(
        client=httpx.Client(transport=httpx.MockTransport(handler)),
        app_id="wx-app-id",
        app_secret=APP_SECRET,
        now=lambda: clock[0],
    )
    provider.exchange(PHONE_CODE)
    clock[0] = 399.0
    provider.exchange(PHONE_CODE)
    clock[0] = 400.0
    provider.exchange(PHONE_CODE)

    assert issued_tokens == [f"{ACCESS_TOKEN}-1", f"{ACCESS_TOKEN}-2"]


def test_real_phone_provider_concurrent_cache_miss_refreshes_access_token_once() -> None:
    request_count = 8
    start_barrier = threading.Barrier(request_count)
    token_condition = threading.Condition()
    token_get_count = 0
    phone_post_count = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal token_get_count, phone_post_count
        if request.url.path == "/cgi-bin/token":
            with token_condition:
                token_get_count += 1
                token_condition.notify_all()
                if token_get_count == 1:
                    token_condition.wait_for(
                        lambda: token_get_count == request_count,
                        timeout=0.5,
                    )
            return httpx.Response(200, json={"access_token": ACCESS_TOKEN, "expires_in": 7200})
        with token_condition:
            phone_post_count += 1
        return httpx.Response(
            200,
            json={"errcode": 0, "phone_info": {"purePhoneNumber": FULL_PHONE}},
        )

    provider = RealWeChatPhoneProvider(
        client=httpx.Client(transport=httpx.MockTransport(handler)),
        app_id="wx-app-id",
        app_secret=APP_SECRET,
    )

    def exchange() -> VerifiedPhone:
        start_barrier.wait(timeout=10)
        return provider.exchange(PHONE_CODE)

    with ThreadPoolExecutor(max_workers=request_count) as executor:
        results = list(executor.map(lambda _index: exchange(), range(request_count)))

    assert results == [VerifiedPhone(FULL_PHONE)] * request_count
    assert token_get_count == 1
    assert phone_post_count == request_count


def test_development_provider_is_guarded_and_accepts_only_explicit_dev_codes() -> None:
    provider = DevelopmentWeChatProvider(
        Settings(app_env="test", wechat_provider="development")
    )
    assert provider.exchange("dev-login-code").openid.startswith("dev-openid-")
    assert provider.exchange_phone("dev-phone-code") == VerifiedPhone("13812345678")

    with pytest.raises(IdentityProviderError):
        provider.exchange("anything")
    with pytest.raises(PhoneProviderError):
        provider.exchange_phone("anything")
    with pytest.raises(ValueError, match="development provider"):
        DevelopmentWeChatProvider(
            Settings(
                app_env="test",
                wechat_provider="real",
                wechat_app_id="wx-app-id",
                wechat_app_secret=APP_SECRET,
            )
        )


def test_development_provider_bundle_does_not_allocate_an_http_client() -> None:
    bundle = build_providers(Settings(app_env="test", wechat_provider="development"))

    assert bundle.owned_client is None
    bundle.close()
    bundle.close()


def test_real_provider_builder_closes_shared_client_if_construction_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = httpx.Client(transport=httpx.MockTransport(lambda _request: httpx.Response(500)))

    def fail_phone_provider(**_values: object) -> object:
        raise RuntimeError("provider-construction-sentinel")

    monkeypatch.setattr(
        "backend.app.modules.auth.provider.RealWeChatPhoneProvider",
        fail_phone_provider,
    )
    with pytest.raises(RuntimeError, match="provider-construction-sentinel"):
        build_providers(
            Settings(
                app_env="test",
                wechat_provider="real",
                wechat_app_id="wx-app-id",
                wechat_app_secret=APP_SECRET,
            ),
            client_factory=lambda: client,
        )

    assert client.is_closed is True


def test_real_provider_shared_client_is_closed_once_by_application_lifespan(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class CountingClient(httpx.Client):
        def __init__(self) -> None:
            super().__init__(
                transport=httpx.MockTransport(
                    lambda _request: httpx.Response(500, json={"marker": RAW_MARKER})
                )
            )
            self.close_count = 0

        def close(self) -> None:
            self.close_count += 1
            super().close()

    client = CountingClient()
    bundle = ProviderBundle(
        identity_provider=RealWeChatIdentityProvider(
            client=client,
            app_id="wx-app-id",
            app_secret=APP_SECRET,
        ),
        phone_provider=RealWeChatPhoneProvider(
            client=client,
            app_id="wx-app-id",
            app_secret=APP_SECRET,
        ),
        owned_client=client,
    )
    monkeypatch.setattr("backend.app.main.build_providers", lambda _settings: bundle)
    app = create_app(
        settings=Settings(
            app_env="test",
            wechat_provider="real",
            wechat_app_id="wx-app-id",
            wechat_app_secret=APP_SECRET,
        )
    )

    with pytest.raises(RuntimeError, match="lifespan-body-sentinel"):
        with TestClient(app):
            assert client.is_closed is False
            raise RuntimeError("lifespan-body-sentinel")

    assert client.is_closed is True
    assert client.close_count == 1


def test_provider_bundle_close_failure_remains_retryable() -> None:
    class FailOnceClient(httpx.Client):
        def __init__(self) -> None:
            super().__init__(transport=httpx.MockTransport(lambda _request: httpx.Response(500)))
            self.close_count = 0

        def close(self) -> None:
            self.close_count += 1
            if self.close_count == 1:
                raise RuntimeError("close-failure-sentinel")
            super().close()

    client = FailOnceClient()
    identity = RealWeChatIdentityProvider(
        client=client,
        app_id="wx-app-id",
        app_secret=APP_SECRET,
    )
    bundle = ProviderBundle(
        identity_provider=identity,
        phone_provider=RealWeChatPhoneProvider(
            client=client,
            app_id="wx-app-id",
            app_secret=APP_SECRET,
        ),
        owned_client=client,
    )

    with pytest.raises(RuntimeError, match="close-failure-sentinel"):
        bundle.close()
    assert bundle.is_closed is False
    assert client.is_closed is False

    bundle.close()
    bundle.close()
    assert bundle.is_closed is True
    assert client.is_closed is True
    assert client.close_count == 2


def test_provider_bundle_concurrent_close_closes_owned_client_once() -> None:
    class CountingClient(httpx.Client):
        def __init__(self) -> None:
            super().__init__(transport=httpx.MockTransport(lambda _request: httpx.Response(500)))
            self.close_count = 0
            self.count_lock = threading.Lock()

        def close(self) -> None:
            with self.count_lock:
                self.close_count += 1
            super().close()

    client = CountingClient()
    bundle = ProviderBundle(
        identity_provider=RealWeChatIdentityProvider(
            client=client,
            app_id="wx-app-id",
            app_secret=APP_SECRET,
        ),
        phone_provider=RealWeChatPhoneProvider(
            client=client,
            app_id="wx-app-id",
            app_secret=APP_SECRET,
        ),
        owned_client=client,
    )

    with ThreadPoolExecutor(max_workers=8) as executor:
        list(executor.map(lambda _index: bundle.close(), range(8)))

    assert bundle.is_closed is True
    assert client.close_count == 1


def test_real_phone_provider_rejects_malformed_nonempty_phone_without_leaking(
    caplog: pytest.LogCaptureFixture,
) -> None:
    malformed_phone = "12345678901"

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/cgi-bin/token":
            return httpx.Response(200, json={"access_token": ACCESS_TOKEN, "expires_in": 7200})
        return httpx.Response(
            200,
            json={
                "errcode": 0,
                "phone_info": {"purePhoneNumber": malformed_phone},
                "marker": RAW_MARKER,
            },
        )

    provider = RealWeChatPhoneProvider(
        client=httpx.Client(transport=httpx.MockTransport(handler)),
        app_id="wx-app-id",
        app_secret=APP_SECRET,
    )
    with caplog.at_level(logging.DEBUG), pytest.raises(PhoneProviderError):
        provider.exchange(PHONE_CODE)

    _assert_no_secret_leak(caplog.text)
    assert malformed_phone not in caplog.text


@pytest.mark.integration
def test_same_openid_reuses_user_and_business_sessions_are_hash_only(
    pg_session: Session,
    vault: PhoneVault,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tokens = iter([BUSINESS_TOKEN, BUSINESS_TOKEN + "-second"])
    calls: list[int] = []

    def token_urlsafe(length: int) -> str:
        calls.append(length)
        return next(tokens)

    monkeypatch.setattr("backend.app.modules.auth.service.secrets.token_urlsafe", token_urlsafe)
    service = _service(pg_session, vault)

    first = service.create_session(LOGIN_CODE)
    second = service.create_session(LOGIN_CODE)

    users = list(pg_session.scalars(select(User)))
    sessions = list(pg_session.scalars(select(UserSession)))
    assert first.user.id == second.user.id == users[0].id
    assert len(users) == 1
    assert len(sessions) == 2
    assert calls == [32, 32]
    assert len(first.session_token) >= 43
    assert first.expires_at == NOW + timedelta(days=30)
    assert hashlib.sha256(BUSINESS_TOKEN.encode()).hexdigest() in {
        item.token_hash for item in sessions
    }
    assert BUSINESS_TOKEN not in {item.token_hash for item in sessions}
    assert not hasattr(UserSession, "session_key")
    assert SESSION_KEY not in repr(first)


@pytest.mark.integration
def test_existing_openid_only_fills_missing_unionid_without_exposing_it(
    pg_session: Session,
    vault: PhoneVault,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tokens = iter([BUSINESS_TOKEN, BUSINESS_TOKEN + "-unionid"])
    monkeypatch.setattr(
        "backend.app.modules.auth.service.secrets.token_urlsafe", lambda _length: next(tokens)
    )
    first = _service(
        pg_session,
        vault,
        identity=WeChatIdentity("unionid-openid", None, SESSION_KEY),
    ).create_session(LOGIN_CODE)
    second = _service(
        pg_session,
        vault,
        identity=WeChatIdentity("unionid-openid", UNIONID, SESSION_KEY),
    ).create_session(LOGIN_CODE)

    users = list(pg_session.scalars(select(User)))
    assert len(users) == 1
    assert users[0].wechat_unionid == UNIONID
    assert first.user.id == second.user.id
    assert UNIONID not in first.model_dump_json() + second.model_dump_json()


@pytest.mark.integration
@pytest.mark.parametrize(
    ("users", "attempt"),
    [
        (
            [("union-owner-openid", UNIONID)],
            ("new-openid", UNIONID),
        ),
        (
            [("existing-openid", UNIONID)],
            ("existing-openid", "different-unionid"),
        ),
        (
            [("union-owner-openid", UNIONID), ("empty-unionid-openid", None)],
            ("empty-unionid-openid", UNIONID),
        ),
    ],
)
def test_unionid_conflict_rolls_back_before_token_generation(
    users: list[tuple[str, str | None]],
    attempt: tuple[str, str],
    pg_session: Session,
    vault: PhoneVault,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pg_session.add_all(
        [User(wechat_openid=openid, wechat_unionid=unionid) for openid, unionid in users]
    )
    pg_session.commit()

    def token_must_not_be_generated(_length: int) -> str:
        pytest.fail("identity conflicts must be resolved before token generation")

    monkeypatch.setattr(
        "backend.app.modules.auth.service.secrets.token_urlsafe",
        token_must_not_be_generated,
    )
    service = _service(
        pg_session,
        vault,
        identity=WeChatIdentity(attempt[0], attempt[1], SESSION_KEY),
    )

    with pytest.raises(AppError) as captured:
        service.create_session(LOGIN_CODE)

    assert captured.value.status_code == 502
    assert captured.value.code == "WECHAT_LOGIN_FAILED"
    assert pg_session.scalar(select(func.count()).select_from(UserSession)) == 0
    persisted = {
        user.wechat_openid: user.wechat_unionid for user in pg_session.scalars(select(User))
    }
    assert persisted == dict(users)
    assert pg_session.scalar(select(func.count()).select_from(User)) == len(users)


@pytest.mark.integration
@pytest.mark.parametrize("scenario", ["new-openids", "concurrent-fill"])
def test_concurrent_unionid_conflict_returns_502_without_partial_session(
    scenario: str,
    pg_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    if scenario == "new-openids":
        identities = {
            "union-race-a": WeChatIdentity("union-race-openid-a", UNIONID, SESSION_KEY),
            "union-race-b": WeChatIdentity("union-race-openid-b", UNIONID, SESSION_KEY),
        }
        synchronized_prefix = "INSERT INTO users"
    else:
        with Session(pg_engine) as seed_session:
            seed_session.add(User(wechat_openid="fill-race-openid", wechat_unionid=None))
            seed_session.commit()
        identities = {
            "union-race-a": WeChatIdentity(
                "fill-race-openid", "fill-race-unionid-a", SESSION_KEY
            ),
            "union-race-b": WeChatIdentity(
                "fill-race-openid", "fill-race-unionid-b", SESSION_KEY
            ),
        }
        synchronized_prefix = "UPDATE users SET wechat_unionid"

    token_lock = threading.Lock()
    token_number = 0

    def token_urlsafe(_length: int) -> str:
        nonlocal token_number
        with token_lock:
            token_number += 1
            return f"{BUSINESS_TOKEN}-union-race-{token_number}"

    def request_database() -> Iterator[Session]:
        with Session(pg_engine) as session:
            yield session

    dml_barrier = threading.Barrier(2)

    def synchronize_conflicting_dml(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        if statement.lstrip().startswith(synchronized_prefix):
            dml_barrier.wait(timeout=10)

    monkeypatch.setattr("backend.app.modules.auth.service.secrets.token_urlsafe", token_urlsafe)
    app = create_app(
        settings=Settings(
            app_env="test",
            wechat_provider="development",
            phone_encryption_key_base64=KEY_BASE64,
            phone_encryption_key_version=7,
        )
    )
    app.dependency_overrides[get_database] = request_database
    app.dependency_overrides[get_phone_provider] = lambda: StubPhoneProvider({})
    identity_provider = ConcurrentMappedIdentityProvider(identities)
    app.dependency_overrides[get_identity_provider] = lambda: identity_provider

    event.listen(pg_engine, "before_cursor_execute", synchronize_conflicting_dml)
    try:
        with TestClient(app, raise_server_exceptions=False) as client:
            with ThreadPoolExecutor(max_workers=2) as executor:
                responses = list(
                    executor.map(
                        lambda code: client.post(
                            "/api/v1/auth/wechat/session",
                            json={"code": code},
                        ),
                        identities,
                    )
                )
    finally:
        event.remove(pg_engine, "before_cursor_execute", synchronize_conflicting_dml)

    assert sorted(response.status_code for response in responses) == [200, 502]
    conflict = next(response for response in responses if response.status_code == 502)
    assert conflict.json()["error"]["code"] == "WECHAT_LOGIN_FAILED"
    assert UNIONID not in conflict.text
    with Session(pg_engine) as session:
        assert session.scalar(select(func.count()).select_from(User)) == 1
        assert session.scalar(select(func.count()).select_from(UserSession)) == 1


@pytest.mark.integration
def test_concurrent_first_login_reuses_one_user_and_creates_one_session_per_request(
    pg_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request_count = 6
    token_lock = threading.Lock()
    token_number = 0

    def token_urlsafe(length: int) -> str:
        nonlocal token_number
        assert length == 32
        with token_lock:
            token_number += 1
            return f"{BUSINESS_TOKEN}-{token_number}"

    def request_database() -> Iterator[Session]:
        with Session(pg_engine) as session:
            yield session

    insert_barrier = threading.Barrier(request_count)

    def synchronize_user_insert(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        if statement.lstrip().startswith("INSERT INTO users"):
            insert_barrier.wait(timeout=10)

    monkeypatch.setattr("backend.app.modules.auth.service.secrets.token_urlsafe", token_urlsafe)
    settings = Settings(
        app_env="test",
        wechat_provider="development",
        phone_encryption_key_base64=KEY_BASE64,
        phone_encryption_key_version=7,
    )
    app = create_app(settings=settings)
    app.dependency_overrides[get_database] = request_database
    app.dependency_overrides[get_phone_provider] = lambda: StubPhoneProvider({})

    identity_provider = ConcurrentIdentityProvider(request_count)
    app.dependency_overrides[get_identity_provider] = lambda: identity_provider
    event.listen(pg_engine, "before_cursor_execute", synchronize_user_insert)
    try:
        with TestClient(app, raise_server_exceptions=False) as client:
            with ThreadPoolExecutor(max_workers=request_count) as executor:
                responses = list(
                    executor.map(
                        lambda index: client.post(
                            "/api/v1/auth/wechat/session",
                            json={"code": f"concurrent-login-{index}"},
                        ),
                        range(request_count),
                    )
                )
    finally:
        event.remove(pg_engine, "before_cursor_execute", synchronize_user_insert)

    assert [response.status_code for response in responses] == [200] * request_count
    assert len({response.json()["user"]["id"] for response in responses}) == 1
    assert len({response.json()["session_token"] for response in responses}) == request_count
    with Session(pg_engine) as session:
        assert session.scalar(select(func.count()).select_from(User)) == 1
        assert session.scalar(select(func.count()).select_from(UserSession)) == request_count


@pytest.mark.integration
def test_phone_reauthorization_replaces_encrypted_phone_and_returns_only_masks(
    pg_session: Session,
    vault: PhoneVault,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "backend.app.modules.auth.service.secrets.token_urlsafe", lambda _length: BUSINESS_TOKEN
    )
    service = _service(
        pg_session,
        vault,
        phones={
            "first-phone": VerifiedPhone(FULL_PHONE),
            "second-phone": VerifiedPhone("13987654321"),
        },
    )
    session = service.create_session(LOGIN_CODE)

    first = service.verify_phone(session.user.id, "first-phone")
    user = pg_session.get(User, session.user.id)
    assert user is not None
    first_ciphertext = user.phone_ciphertext
    second = AuthService(
        repository=AuthRepository(pg_session),
        identity_provider=StubIdentityProvider(IdentityProviderError("unused")),
        phone_provider=StubPhoneProvider({"second-phone": VerifiedPhone("13987654321")}),
        phone_vault=vault,
        session_ttl=timedelta(days=30),
        now=lambda: NOW + timedelta(minutes=5),
    ).verify_phone(session.user.id, "second-phone")

    pg_session.refresh(user)
    assert first.masked_phone == "138****5678"
    assert second.masked_phone == "139****4321"
    assert second.verified_at == NOW + timedelta(minutes=5)
    assert user.phone_ciphertext != first_ciphertext
    assert user.phone_verified_at == second.verified_at
    assert user.phone_ciphertext is not None
    assert user.phone_nonce is not None
    assert user.phone_key_version is not None
    assert (
        vault.decrypt(
            SealedPhone(user.phone_ciphertext, user.phone_nonce, user.phone_key_version),
            record_type="user",
            record_id=user.id,
            field="phone",
        )
        == "13987654321"
    )
    assert FULL_PHONE not in repr(first)
    assert "13987654321" not in repr(second)


@pytest.mark.integration
@pytest.mark.parametrize("phone_state", ["corrupt", "wrong-key", "no-vault"])
def test_session_response_failure_does_not_commit_an_undelivered_business_session(
    phone_state: str,
    pg_session: Session,
    vault: PhoneVault,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tokens = iter([BUSINESS_TOKEN, BUSINESS_TOKEN + "-undelivered"])
    monkeypatch.setattr(
        "backend.app.modules.auth.service.secrets.token_urlsafe", lambda _length: next(tokens)
    )
    service = _service(
        pg_session,
        vault,
        phones={PHONE_CODE: VerifiedPhone(FULL_PHONE)},
    )
    created = service.create_session(LOGIN_CODE)
    service.verify_phone(created.user.id, PHONE_CODE)
    user = pg_session.get(User, created.user.id)
    assert user is not None
    if phone_state == "corrupt":
        user.phone_ciphertext = bytes(16)
    elif phone_state == "wrong-key":
        user.phone_key_version = 8
    pg_session.commit()

    settings_values: dict[str, object] = {
        "app_env": "test",
        "wechat_provider": "development",
    }
    if phone_state != "no-vault":
        settings_values.update(
            phone_encryption_key_base64=KEY_BASE64,
            phone_encryption_key_version=7,
        )
    app = create_app(settings=Settings(**settings_values))
    app.dependency_overrides[get_database] = lambda: pg_session
    app.dependency_overrides[get_identity_provider] = lambda: StubIdentityProvider(
        WeChatIdentity("openid-one", "unionid-one", SESSION_KEY)
    )
    app.dependency_overrides[get_phone_provider] = lambda: StubPhoneProvider({})

    before = pg_session.scalar(select(func.count()).select_from(UserSession))
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post(
            "/api/v1/auth/wechat/session",
            json={"code": LOGIN_CODE},
        )
    pg_session.expire_all()

    assert response.status_code == 500
    assert response.json()["error"]["code"] == "INTERNAL_ERROR"
    assert pg_session.scalar(select(func.count()).select_from(UserSession)) == before


@pytest.mark.integration
def test_session_commit_failure_rolls_back_user_and_undelivered_token(
    pg_session: Session,
    vault: PhoneVault,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repository = AuthRepository(pg_session)

    def fail_commit() -> None:
        pg_session.flush()
        raise RuntimeError("commit-failure-sentinel")

    monkeypatch.setattr(repository, "commit", fail_commit)
    monkeypatch.setattr(
        "backend.app.modules.auth.service.secrets.token_urlsafe", lambda _length: BUSINESS_TOKEN
    )
    service = AuthService(
        repository=repository,
        identity_provider=StubIdentityProvider(
            WeChatIdentity("commit-failure-openid", None, SESSION_KEY)
        ),
        phone_provider=StubPhoneProvider({}),
        phone_vault=vault,
        session_ttl=timedelta(days=30),
        now=lambda: NOW,
    )

    with pytest.raises(RuntimeError, match="commit-failure-sentinel"):
        service.create_session(LOGIN_CODE)

    assert pg_session.scalar(select(func.count()).select_from(User)) == 0
    assert pg_session.scalar(select(func.count()).select_from(UserSession)) == 0


@pytest.mark.integration
def test_auth_routes_match_contract_and_bearer_dependency(
    pg_session: Session,
    vault: PhoneVault,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    monkeypatch.setattr(
        "backend.app.modules.auth.service.secrets.token_urlsafe", lambda _length: BUSINESS_TOKEN
    )
    settings = Settings(
        app_env="test",
        wechat_provider="development",
        phone_encryption_key_base64=KEY_BASE64,
        phone_encryption_key_version=7,
    )
    app = create_app(settings=settings)
    identity = StubIdentityProvider(
        WeChatIdentity("router-openid", "router-unionid", SESSION_KEY)
    )
    phone = StubPhoneProvider({PHONE_CODE: VerifiedPhone(FULL_PHONE)})
    app.dependency_overrides[get_database] = lambda: pg_session
    app.dependency_overrides[get_identity_provider] = lambda: identity
    app.dependency_overrides[get_phone_provider] = lambda: phone

    with caplog.at_level(logging.INFO), TestClient(
        app, raise_server_exceptions=False
    ) as client:
        session_response = client.post(
            "/api/v1/auth/wechat/session", json={"code": LOGIN_CODE}
        )
        missing = client.post("/api/v1/auth/wechat/phone", json={"code": PHONE_CODE})
        invalid = client.post(
            "/api/v1/auth/wechat/phone",
            json={"code": PHONE_CODE},
            headers={"Authorization": "Bearer invalid-token"},
        )
        verified = client.post(
            "/api/v1/auth/wechat/phone",
            json={"code": PHONE_CODE},
            headers={"Authorization": f"Bearer {BUSINESS_TOKEN}"},
        )

    assert session_response.status_code == 200
    assert session_response.json()["session_token"] == BUSINESS_TOKEN
    assert session_response.json()["user"]["masked_phone"] is None
    assert SESSION_KEY not in session_response.text
    assert missing.status_code == invalid.status_code == 401
    assert missing.json()["error"]["code"] == "AUTH_REQUIRED"
    assert invalid.json()["error"]["code"] == "AUTH_REQUIRED"
    assert verified.status_code == 200
    assert verified.json()["masked_phone"] == "138****5678"
    assert FULL_PHONE not in verified.text
    persisted = list(pg_session.scalars(select(UserSession)))
    assert BUSINESS_TOKEN not in {item.token_hash for item in persisted}
    _assert_no_secret_leak(caplog.text + missing.text + invalid.text)


@pytest.mark.integration
@pytest.mark.parametrize(
    ("path", "payload"),
    [
        ("/api/v1/auth/wechat/session", {}),
        ("/api/v1/auth/wechat/session", {"code": ""}),
        (
            "/api/v1/auth/wechat/session",
            {"code": LOGIN_CODE, "unexpected": RAW_MARKER},
        ),
        ("/api/v1/auth/wechat/phone", {}),
        ("/api/v1/auth/wechat/phone", {"code": ""}),
        (
            "/api/v1/auth/wechat/phone",
            {"code": PHONE_CODE, "unexpected": RAW_MARKER},
        ),
    ],
)
def test_auth_request_validation_returns_safe_error_envelope(
    path: str,
    payload: dict[str, object],
    pg_session: Session,
    vault: PhoneVault,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "backend.app.modules.auth.service.secrets.token_urlsafe", lambda _length: BUSINESS_TOKEN
    )
    token = _service(pg_session, vault).create_session(LOGIN_CODE).session_token
    app = create_app(
        settings=Settings(
            app_env="test",
            wechat_provider="development",
            phone_encryption_key_base64=KEY_BASE64,
            phone_encryption_key_version=7,
        )
    )
    app.dependency_overrides[get_database] = lambda: pg_session
    headers = {"X-Request-Id": "req-validation-safe"}
    if path.endswith("/phone"):
        headers["Authorization"] = f"Bearer {token}"

    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post(path, json=payload, headers=headers)

    assert response.status_code == 422
    assert response.headers["X-Request-Id"] == "req-validation-safe"
    assert response.json()["error"] == {
        "code": "INVALID_ARGUMENT",
        "message": "请求参数格式不正确，请检查后重试。",
        "request_id": "req-validation-safe",
        "details": {},
    }
    assert RAW_MARKER not in response.text


@pytest.mark.integration
def test_phone_validation_without_bearer_remains_auth_required(pg_session: Session) -> None:
    app = create_app(settings=Settings(app_env="test", wechat_provider="development"))
    app.dependency_overrides[get_database] = lambda: pg_session

    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post("/api/v1/auth/wechat/phone", json={})

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_REQUIRED"


def test_runtime_openapi_auth_validation_uses_error_envelope() -> None:
    schema = create_app().openapi()

    for path in ("/api/v1/auth/wechat/session", "/api/v1/auth/wechat/phone"):
        validation = schema["paths"][path]["post"]["responses"]["422"]
        assert validation["content"]["application/json"]["schema"] == {
            "$ref": "#/components/schemas/ErrorEnvelope"
        }


@pytest.mark.integration
@pytest.mark.parametrize("state", ["expired", "revoked"])
def test_bearer_dependency_rejects_expired_and_revoked_sessions(
    state: str,
    pg_session: Session,
    vault: PhoneVault,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "backend.app.modules.auth.service.secrets.token_urlsafe", lambda _length: BUSINESS_TOKEN
    )
    service = _service(pg_session, vault)
    created = service.create_session(LOGIN_CODE)
    stored = pg_session.scalar(select(UserSession))
    assert stored is not None
    if state == "expired":
        stored.issued_at = datetime.now(UTC) - timedelta(minutes=2)
        stored.expires_at = datetime.now(UTC) - timedelta(minutes=1)
    else:
        stored.revoked_at = NOW
    pg_session.commit()

    settings = Settings(
        app_env="test",
        wechat_provider="development",
        phone_encryption_key_base64=KEY_BASE64,
        phone_encryption_key_version=7,
    )
    app = create_app(settings=settings)
    app.dependency_overrides[get_database] = lambda: pg_session
    app.dependency_overrides[get_phone_provider] = lambda: StubPhoneProvider(
        {PHONE_CODE: VerifiedPhone(FULL_PHONE)}
    )
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post(
            "/api/v1/auth/wechat/phone",
            json={"code": PHONE_CODE},
            headers={"Authorization": f"Bearer {created.session_token}"},
        )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_REQUIRED"


@pytest.mark.integration
@pytest.mark.parametrize(
    ("error", "status", "code"),
    [
        (IdentityProviderError(RAW_MARKER), 502, "WECHAT_LOGIN_FAILED"),
        (PhoneProviderError(RAW_MARKER), 502, "PHONE_AUTH_FAILED"),
        (PhoneCapabilityUnavailableError(RAW_MARKER), 503, "PHONE_AUTH_UNAVAILABLE"),
    ],
)
def test_router_maps_internal_provider_errors_without_leaking_provider_data(
    error: Exception,
    status: int,
    code: str,
    pg_session: Session,
    vault: PhoneVault,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    monkeypatch.setattr(
        "backend.app.modules.auth.service.secrets.token_urlsafe", lambda _length: BUSINESS_TOKEN
    )
    settings = Settings(
        app_env="test",
        wechat_provider="development",
        phone_encryption_key_base64=KEY_BASE64,
        phone_encryption_key_version=7,
    )
    app = create_app(settings=settings)
    app.dependency_overrides[get_database] = lambda: pg_session
    if isinstance(error, IdentityProviderError):
        app.dependency_overrides[get_identity_provider] = lambda: StubIdentityProvider(error)
        path = "/api/v1/auth/wechat/session"
        headers = {}
        request_code = LOGIN_CODE
    else:
        service = _service(pg_session, vault)
        token = service.create_session(LOGIN_CODE).session_token
        app.dependency_overrides[get_phone_provider] = lambda: StubPhoneProvider(
            {PHONE_CODE: error}
        )
        path = "/api/v1/auth/wechat/phone"
        headers = {"Authorization": f"Bearer {token}"}
        request_code = PHONE_CODE

    with caplog.at_level(logging.INFO), TestClient(
        app, raise_server_exceptions=False
    ) as client:
        response = client.post(path, json={"code": request_code}, headers=headers)

    assert response.status_code == status
    assert response.json()["error"]["code"] == code
    _assert_no_secret_leak(caplog.text + response.text)


@pytest.mark.integration
def test_router_maps_malformed_provider_phone_to_safe_502(
    pg_session: Session,
    vault: PhoneVault,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    malformed_phone = "12345678901"
    monkeypatch.setattr(
        "backend.app.modules.auth.service.secrets.token_urlsafe", lambda _length: BUSINESS_TOKEN
    )
    token = _service(pg_session, vault).create_session(LOGIN_CODE).session_token

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/cgi-bin/token":
            return httpx.Response(200, json={"access_token": ACCESS_TOKEN, "expires_in": 7200})
        return httpx.Response(
            200,
            json={
                "errcode": 0,
                "phone_info": {"purePhoneNumber": malformed_phone},
                "marker": RAW_MARKER,
            },
        )

    phone_provider = RealWeChatPhoneProvider(
        client=httpx.Client(transport=httpx.MockTransport(handler)),
        app_id="wx-app-id",
        app_secret=APP_SECRET,
    )
    app = create_app(
        settings=Settings(
            app_env="test",
            wechat_provider="development",
            phone_encryption_key_base64=KEY_BASE64,
            phone_encryption_key_version=7,
        )
    )
    app.dependency_overrides[get_database] = lambda: pg_session
    app.dependency_overrides[get_phone_provider] = lambda: phone_provider

    with caplog.at_level(logging.DEBUG), TestClient(
        app, raise_server_exceptions=False
    ) as client:
        response = client.post(
            "/api/v1/auth/wechat/phone",
            json={"code": PHONE_CODE},
            headers={"Authorization": f"Bearer {token}"},
        )

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "PHONE_AUTH_FAILED"
    _assert_no_secret_leak(caplog.text + response.text)
    assert malformed_phone not in caplog.text + response.text


def _assert_no_secret_leak(captured: str) -> None:
    for secret in (
        APP_SECRET,
        LOGIN_CODE,
        PHONE_CODE,
        ACCESS_TOKEN,
        SESSION_KEY,
        UNIONID,
        BUSINESS_TOKEN,
        RAW_MARKER,
        FULL_PHONE,
    ):
        assert secret not in captured
