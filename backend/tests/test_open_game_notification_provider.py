from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import Callable
from datetime import datetime
from threading import Event, Thread

import httpx
import pytest

from backend.app.config import Settings
from backend.app.modules.open_game_notifications.provider import (
    NotificationAccepted,
    NotificationRejected,
    WaitlistPromotionRecipient,
    WaitlistPromotionRequest,
)
from backend.app.modules.open_game_notifications.wechat_provider import (
    WeChatOpenGameNotificationProvider,
    build_open_game_notification_provider,
)

APP_ID = "wx-notification-test"
APP_SECRET = "wechat-notification-secret"
TEMPLATE_ID = "zun-LzcQyW-edafCVvzPkK4de2Rllr1fFpw2A_x0oXE"
MAPPING = {
    "game_name": "thing1",
    "starts_at": "time2",
    "venue_name": "thing3",
}


def notification_request(
    *,
    app_id: str = APP_ID,
    starts_at: str = "2026-09-01T12:05:00+00:00",
    game_name: str = "周末轻松局",
    venue_name: str = "测试球场",
    template_key: str = "waitlist-promoted",
) -> WaitlistPromotionRequest:
    return WaitlistPromotionRequest(
        dedupe_key="waitlist-promoted:registration:3",
        recipient=WaitlistPromotionRecipient(
            app_id=app_id,
            openid="sensitive-recipient-openid",
        ),
        template_key=template_key,
        data={
            "game_name": game_name,
            "starts_at": starts_at,
            "venue_name": venue_name,
        },
    )


def provider(
    handler: Callable[[httpx.Request], httpx.Response],
    *,
    now: Callable[[], float] = lambda: 100.0,
) -> tuple[WeChatOpenGameNotificationProvider, httpx.AsyncClient]:
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return (
        WeChatOpenGameNotificationProvider._from_test_client(
            client=client,
            app_id=APP_ID,
            app_secret=APP_SECRET,
            template_id=TEMPLATE_ID,
            keyword_mapping=MAPPING,
            miniprogram_state="formal",
            now=now,
        ),
        client,
    )


def test_provider_sends_only_closed_fields_with_shanghai_time_and_strict_timeout() -> None:
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        timeout = request.extensions["timeout"]
        assert timeout == {"connect": 1.0, "read": 2.0, "write": 2.0, "pool": 1.0}
        if request.url.path == "/cgi-bin/token":
            assert dict(request.url.params) == {
                "grant_type": "client_credential",
                "appid": APP_ID,
                "secret": APP_SECRET,
            }
            return httpx.Response(200, json={"access_token": "sensitive-token", "expires_in": 7200})
        assert request.url.path == "/cgi-bin/message/subscribe/send"
        assert dict(request.url.params) == {"access_token": "sensitive-token"}
        assert json.loads(request.content) == {
            "touser": "sensitive-recipient-openid",
            "template_id": TEMPLATE_ID,
            "page": "pages/my-game-registrations/index",
            "miniprogram_state": "formal",
            "lang": "zh_CN",
            "data": {
                "thing1": {"value": "周末轻松局"},
                "time2": {"value": "2026年09月01日 20:05"},
                "thing3": {"value": "测试球场"},
            },
        }
        return httpx.Response(200, json={"errcode": 0, "errmsg": "ok"})

    target, client = provider(handler)
    try:
        assert target.send(notification_request()) == NotificationAccepted()
    finally:
        target.close()
    assert len(calls) == 2


def test_provider_truncates_thing_values_by_unicode_character() -> None:
    sent: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/cgi-bin/token":
            return httpx.Response(200, json={"access_token": "token", "expires_in": 7200})
        sent.update(json.loads(request.content))
        return httpx.Response(200, json={"errcode": 0})

    target, client = provider(handler)
    try:
        result = target.send(notification_request(
            game_name="⚽" * 25,
            venue_name="津" * 21,
        ))
    finally:
        target.close()

    assert result == NotificationAccepted()
    data = sent["data"]
    assert isinstance(data, dict)
    assert data["thing1"] == {"value": "⚽" * 20}
    assert data["thing3"] == {"value": "津" * 20}


def test_provider_cache_is_private_and_refreshes_once_for_an_invalid_token() -> None:
    paths: list[str] = []
    tokens = iter(["token-one", "token-two"])

    def handler(request: httpx.Request) -> httpx.Response:
        paths.append(request.url.path)
        if request.url.path == "/cgi-bin/token":
            return httpx.Response(200, json={"access_token": next(tokens), "expires_in": 7200})
        if request.url.params["access_token"] == "token-one":
            return httpx.Response(200, json={"errcode": 40014, "errmsg": "raw detail"})
        return httpx.Response(200, json={"errcode": 0})

    target, client = provider(handler)
    try:
        assert target.send(notification_request()) == NotificationAccepted()
        assert target.send(notification_request()) == NotificationAccepted()
    finally:
        target.close()

    assert paths == [
        "/cgi-bin/token",
        "/cgi-bin/message/subscribe/send",
        "/cgi-bin/token",
        "/cgi-bin/message/subscribe/send",
        "/cgi-bin/message/subscribe/send",
    ]


@pytest.mark.parametrize(
    ("errcode", "expected"),
    [
        (43101, NotificationRejected("RECIPIENT_UNSUBSCRIBED", retryable=False)),
        (40037, NotificationRejected("TEMPLATE_INVALID", retryable=False)),
        (47003, NotificationRejected("TEMPLATE_DATA_INVALID", retryable=False)),
        (41030, NotificationRejected("PAGE_INVALID", retryable=False)),
        (40003, NotificationRejected("RECIPIENT_INVALID", retryable=False)),
        (-1, NotificationRejected("WECHAT_NOTIFICATION_TEMPORARY", retryable=True)),
        (45009, NotificationRejected("WECHAT_NOTIFICATION_TEMPORARY", retryable=True)),
        (99999, NotificationRejected("WECHAT_NOTIFICATION_REJECTED", retryable=False)),
    ],
)
def test_provider_classifies_send_business_errors_safely(
    errcode: int,
    expected: NotificationRejected,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/cgi-bin/token":
            return httpx.Response(200, json={"access_token": "token", "expires_in": 7200})
        return httpx.Response(200, json={"errcode": errcode, "errmsg": "sensitive raw detail"})

    target, client = provider(handler)
    try:
        assert target.send(notification_request()) == expected
    finally:
        target.close()


def test_second_invalid_token_is_permanent_and_never_loops() -> None:
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if request.url.path == "/cgi-bin/token":
            return httpx.Response(200, json={"access_token": f"token-{calls}", "expires_in": 7200})
        return httpx.Response(200, json={"errcode": 42001, "errmsg": "expired"})

    target, client = provider(handler)
    try:
        assert target.send(notification_request()) == NotificationRejected(
            "WECHAT_TOKEN_REJECTED",
            retryable=False,
        )
    finally:
        target.close()
    assert calls == 4


@pytest.mark.parametrize("failure", ["network", "http", "malformed"])
def test_token_failures_are_retryable_without_exposing_raw_data(failure: str) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if failure == "network":
            raise httpx.ConnectTimeout("sensitive-token-timeout", request=request)
        if failure == "http":
            return httpx.Response(503, text="sensitive-token-body")
        return httpx.Response(200, content=b"not-json-sensitive")

    target, client = provider(handler)
    try:
        result = target.send(notification_request())
    finally:
        target.close()
    assert result == NotificationRejected("WECHAT_TOKEN_UNAVAILABLE", retryable=True)
    assert "sensitive" not in repr(result)


def test_rejected_token_credentials_and_send_transport_failures_are_safely_classified() -> None:
    def rejected_token(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"errcode": 40125, "errmsg": "sensitive secret rejected"})

    target, client = provider(rejected_token)
    try:
        assert target.send(notification_request()) == NotificationRejected(
            "WECHAT_TOKEN_REJECTED",
            retryable=False,
        )
    finally:
        target.close()

    def failed_send(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/cgi-bin/token":
            return httpx.Response(200, json={"access_token": "token", "expires_in": 7200})
        return httpx.Response(502, text="sensitive send body")

    target, client = provider(failed_send)
    try:
        assert target.send(notification_request()) == NotificationRejected(
            "WECHAT_NOTIFICATION_TEMPORARY",
            retryable=True,
        )
    finally:
        target.close()


def test_provider_rejects_internal_mismatches_before_io() -> None:
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(500)

    target, client = provider(handler)
    try:
        assert target.send(notification_request(app_id="another-app")) == NotificationRejected(
            "RECIPIENT_APP_MISMATCH",
            retryable=False,
        )
        assert target.send(notification_request(template_key="unexpected")) == NotificationRejected(
            "TEMPLATE_KEY_UNSUPPORTED",
            retryable=False,
        )
        assert target.send(
            notification_request(starts_at="not-an-instant")
        ) == NotificationRejected("TEMPLATE_DATA_INVALID", retryable=False)
    finally:
        target.close()
    assert calls == 0


def test_provider_never_logs_or_renders_secrets(
    caplog: pytest.LogCaptureFixture,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"errcode": 40125, "errmsg": "raw-sensitive-body"})

    target, client = provider(handler)
    try:
        with caplog.at_level(logging.DEBUG):
            result = target.send(notification_request())
        rendered = f"{target!r}\n{result!r}\n{caplog.text}"
    finally:
        target.close()
    for secret in [APP_SECRET, "sensitive-recipient-openid", "raw-sensitive-body"]:
        assert secret not in rendered


def test_factory_is_disabled_without_allocating_and_owns_enabled_default_transport(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    original_client = httpx.AsyncClient
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda *args, **kwargs: pytest.fail("disabled provider must not allocate a client"),
    )
    assert build_open_game_notification_provider(Settings()) is None
    monkeypatch.setattr(httpx, "AsyncClient", original_client)
    settings = Settings(
        wechat_app_id=APP_ID,
        wechat_app_secret=APP_SECRET,
        open_game_notification_provider="wechat",
        open_game_notification_template_id=TEMPLATE_ID,
        open_game_notification_keyword_mapping_json=json.dumps(MAPPING),
    )
    built = build_open_game_notification_provider(settings)
    assert isinstance(built, WeChatOpenGameNotificationProvider)
    assert type(built._client._transport) is httpx.AsyncHTTPTransport
    assert not built._client.is_closed
    built.close()
    built.close()
    assert built._client.is_closed


def test_production_construction_rejects_custom_transport_injection() -> None:
    settings = Settings(
        wechat_app_id=APP_ID,
        wechat_app_secret=APP_SECRET,
        open_game_notification_provider="wechat",
        open_game_notification_template_id=TEMPLATE_ID,
        open_game_notification_keyword_mapping_json=json.dumps(MAPPING),
    )

    with pytest.raises(TypeError, match="client_factory"):
        build_open_game_notification_provider(  # type: ignore[call-arg]
            settings,
            client_factory=lambda: pytest.fail("production accepted a custom transport"),
        )

    custom_client = httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: httpx.Response(200))
    )
    try:
        with pytest.raises(ValueError, match="Custom WeChat notification transports"):
            WeChatOpenGameNotificationProvider(
                client=custom_client,
                app_id=APP_ID,
                app_secret=APP_SECRET,
                template_id=TEMPLATE_ID,
                keyword_mapping=MAPPING,
                miniprogram_state="formal",
            )
    finally:
        asyncio.run(custom_client.aclose())


def test_provider_rejects_a_naive_start_instant_before_io() -> None:
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(500)

    target, client = provider(handler)
    try:
        naive = datetime(2026, 9, 1, 12, 5).isoformat()
        assert target.send(
            notification_request(starts_at=naive)
        ) == NotificationRejected("TEMPLATE_DATA_INVALID", retryable=False)
    finally:
        target.close()
    assert calls == 0


def test_slow_stream_is_cancelled_by_the_whole_send_wall_clock_deadline() -> None:
    class SlowBody(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b'{"errcode":'
            await asyncio.sleep(5)
            yield b"0}"

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/cgi-bin/token":
            return httpx.Response(200, json={"access_token": "token", "expires_in": 7200})
        return httpx.Response(200, stream=SlowBody())

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    target = WeChatOpenGameNotificationProvider._from_test_client(
        client=client,
        app_id=APP_ID,
        app_secret=APP_SECRET,
        template_id=TEMPLATE_ID,
        keyword_mapping=MAPPING,
        miniprogram_state="formal",
        send_timeout_seconds=0.1,
    )
    started_at = time.monotonic()
    try:
        assert target.send(notification_request()) == NotificationRejected(
            "WECHAT_NOTIFICATION_TEMPORARY",
            retryable=True,
        )
    finally:
        target.close()

    assert time.monotonic() - started_at < 0.5
    assert client.is_closed
    assert not target._loop_thread.is_alive()


def test_token_lock_wait_is_bounded_by_each_send_wall_clock_deadline() -> None:
    first_request_started = Event()

    async def handler(request: httpx.Request) -> httpx.Response:
        first_request_started.set()
        await asyncio.sleep(5)
        return httpx.Response(200, json={"access_token": "too-late", "expires_in": 7200})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    target = WeChatOpenGameNotificationProvider._from_test_client(
        client=client,
        app_id=APP_ID,
        app_secret=APP_SECRET,
        template_id=TEMPLATE_ID,
        keyword_mapping=MAPPING,
        miniprogram_state="formal",
        send_timeout_seconds=0.15,
    )
    first_result: list[NotificationRejected | NotificationAccepted] = []
    first = Thread(target=lambda: first_result.append(target.send(notification_request())))
    first.start()
    assert first_request_started.wait(timeout=0.5)

    started_at = time.monotonic()
    try:
        second_result = target.send(notification_request())
    finally:
        first.join(timeout=0.5)
        target.close()

    assert second_result == NotificationRejected(
        "WECHAT_NOTIFICATION_TEMPORARY",
        retryable=True,
    )
    assert time.monotonic() - started_at < 0.5
    assert first_result == [
        NotificationRejected("WECHAT_NOTIFICATION_TEMPORARY", retryable=True)
    ]
    assert not first.is_alive()
