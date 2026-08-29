from __future__ import annotations

import base64
import hashlib
import json
import threading
import time
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import httpx
import pytest
import uvicorn
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from backend.app.config import Settings
from backend.app.database import get_database
from backend.app.main import create_app
from backend.app.models import User
from backend.tests.test_my_open_game_applications_service import (
    ITEM_FIELDS,
    PRIVATE_FIELDS,
    _all_keys,
    _seed_application,
)

pytestmark = pytest.mark.integration

WECHAT_APP_ID = "wx-my-open-game-applications-http"
LOGIN_CODE = "dev-my-open-game-applications-http-user"


@pytest.fixture
def my_applications_backend_url(pg_engine: Engine) -> Iterator[str]:
    app = create_app(
        settings=Settings(
            app_env="test",
            database_url=pg_engine.url.render_as_string(hide_password=False),
            payment_provider="disabled",
            wechat_app_id=WECHAT_APP_ID,
            wechat_provider="development",
        )
    )

    def database_override() -> Iterator[Session]:
        with Session(pg_engine) as session:
            yield session

    app.dependency_overrides[get_database] = database_override
    config = uvicorn.Config(
        app,
        host="127.0.0.1",
        port=0,
        access_log=False,
        log_level="warning",
        lifespan="on",
    )
    server = uvicorn.Server(config)
    listener = config.bind_socket()
    base_url = f"http://127.0.0.1:{listener.getsockname()[1]}"
    failures: list[BaseException] = []

    def serve() -> None:
        try:
            server.run(sockets=[listener])
        except BaseException as error:
            failures.append(error)

    thread = threading.Thread(target=serve, daemon=True)
    deadline = time.monotonic() + 5
    try:
        thread.start()
        with httpx.Client(timeout=0.5, trust_env=False) as probe:
            while True:
                if failures:
                    raise RuntimeError("local server failed") from failures[0]
                try:
                    if probe.get(f"{base_url}/api/v1/health").status_code == 200:
                        break
                except httpx.TransportError:
                    pass
                if time.monotonic() >= deadline:
                    raise RuntimeError("local server timed out")
                time.sleep(0.01)
        yield base_url
    finally:
        server.should_exit = True
        if thread.ident is not None:
            thread.join(timeout=5)
        listener.close()
        app.dependency_overrides.clear()
        if thread.is_alive() or failures:
            raise RuntimeError("local server did not stop cleanly")


def _development_openid(code: str) -> str:
    return f"dev-openid-{hashlib.sha256(code.encode()).hexdigest()[:32]}"


def test_authenticated_my_applications_journey_over_real_local_http(
    pg_engine: Engine,
    my_applications_backend_url: str,
) -> None:
    with Session(pg_engine) as session:
        user = User(
            wechat_app_id=WECHAT_APP_ID,
            wechat_openid=_development_openid(LOGIN_CODE),
        )
        session.add(user)
        session.commit()
        user_id = user.id
    newest_id = _seed_application(
        pg_engine,
        applicant_user_id=user_id,
        label="真实新报名",
        applied_at=datetime.now(UTC),
    )
    older_id = _seed_application(
        pg_engine,
        applicant_user_id=user_id,
        label="真实旧报名",
        applied_at=datetime.now(UTC) - timedelta(minutes=1),
    )

    with httpx.Client(
        base_url=my_applications_backend_url,
        timeout=5,
        trust_env=False,
    ) as client:
        anonymous = client.get("/api/v1/open-game-applications")
        login = client.post("/api/v1/auth/wechat/session", json={"code": LOGIN_CODE})
        assert login.status_code == 200, login.text
        token = login.json()["session_token"]
        invalid_responses = (
            client.get(
                "/api/v1/open-game-applications",
                params={"limit": 0},
                headers={"Authorization": f"Bearer {token}"},
            ),
            client.get(
                "/api/v1/open-game-applications",
                params={"cursor": "bad!"},
                headers={"Authorization": f"Bearer {token}"},
            ),
        )
        first = client.get(
            "/api/v1/open-game-applications",
            params={"limit": 1},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert first.status_code == 200, first.text
        second = client.get(
            "/api/v1/open-game-applications",
            params={"limit": 1, "cursor": first.json()["next_cursor"]},
            headers={"Authorization": f"Bearer {token}"},
        )

    assert anonymous.status_code == 401
    for invalid in invalid_responses:
        assert invalid.status_code == 422
        error = invalid.json()["error"]
        request_id = error.pop("request_id")
        assert isinstance(request_id, str) and request_id
        assert error == {
            "code": "INVALID_ARGUMENT",
            "message": "请求参数格式不正确，请检查后重试。",
            "details": {},
        }
        assert not {"loc", "type", "input", "msg", "ctx"} & _all_keys(
            invalid.json()
        )
    assert [first.json()["items"][0]["id"], second.json()["items"][0]["id"]] == [
        str(newest_id),
        str(older_id),
    ]
    first_payload = first.json()
    cursor = first_payload["next_cursor"]
    assert cursor is not None
    decoded_cursor = json.loads(
        base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
    )
    assert decoded_cursor == {
        "v": 1,
        "applied_at": first_payload["items"][-1]["applied_at"],
        "id": first_payload["items"][-1]["id"],
    }
    assert second.json()["next_cursor"] is None
    for response in (first, second):
        payload = response.json()
        assert set(payload) == {"items", "next_cursor"}
        assert set(payload["items"][0]) == ITEM_FIELDS
        assert not PRIVATE_FIELDS & _all_keys(payload)
        assert str(user_id) not in response.text
