import hashlib
import threading
import time
from collections.abc import Iterator, Mapping
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
import uvicorn
from sqlalchemy import Engine, Table, func, select
from sqlalchemy.orm import Session

from backend.app.config import Settings
from backend.app.database import get_database
from backend.app.main import create_app
from backend.app.models import (
    OpenGame,
    OpenGameStatus,
    Order,
    OrderStatus,
    Payment,
    RefundAttempt,
    RefundCase,
    Slot,
    SlotStatus,
    User,
)
from backend.app.modules.open_games.privacy import PUBLIC_OPEN_GAME_FIELDS
from backend.tests.test_open_game_service import (
    SeededOpenGameCase,
    draft_request,
    seed_confirmed_order,
)

pytestmark = pytest.mark.integration

OWNER_CODE = "dev-captain-http-owner"
NON_OWNER_CODE = "dev-captain-http-non-owner"
CREATE_KEY = "http-journey-create-key-000001"
UPDATE_KEY = "http-journey-update-key-000001"
PUBLISH_KEY = "http-journey-publish-key-00001"
CANCEL_KEY = "http-journey-cancel-key-000001"
SECOND_CREATE_KEY = "http-journey-create-key-000002"
PRIVATE_KEY_FRAGMENTS = frozenset(
    {
        "booking_price",
        "contact",
        "currency",
        "merchant",
        "openid",
        "order",
        "paid_at",
        "payment",
        "phone",
        "provider",
        "refund",
        "user_id",
    }
)


@pytest.fixture
def local_backend_url(pg_engine: Engine) -> Iterator[str]:
    app = create_app(
        settings=Settings(
            app_env="test",
            database_url=pg_engine.url.render_as_string(hide_password=False),
            payment_provider="disabled",
            wechat_app_id="wx-open-game-test",
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
    port = listener.getsockname()[1]
    failures: list[BaseException] = []

    def serve() -> None:
        try:
            server.run(sockets=[listener])
        except BaseException as error:
            failures.append(error)

    thread = threading.Thread(
        target=serve,
        name="open-game-http-journey-uvicorn",
        daemon=True,
    )
    deadline = time.monotonic() + 5
    try:
        thread.start()
        while not server.started:
            if failures:
                raise RuntimeError("local Uvicorn server failed to start") from failures[0]
            if not thread.is_alive():
                raise RuntimeError("local Uvicorn server exited before startup")
            if time.monotonic() >= deadline:
                raise RuntimeError("local Uvicorn server startup timed out")
            time.sleep(0.01)
        yield f"http://127.0.0.1:{port}"
    finally:
        server.should_exit = True
        if thread.ident is not None:
            thread.join(timeout=5)
        listener.close()
        app.dependency_overrides.clear()
        if thread.is_alive():
            raise RuntimeError("local Uvicorn server did not stop")
        if failures:
            raise RuntimeError("local Uvicorn server failed") from failures[0]


def _align_development_identities(engine: Engine, seeded: SeededOpenGameCase) -> None:
    with Session(engine) as session:
        owner = session.get_one(User, seeded.owner_id)
        non_owner = session.get_one(User, seeded.stranger_id)
        owner.wechat_openid = _development_openid(OWNER_CODE)
        non_owner.wechat_openid = _development_openid(NON_OWNER_CODE)
        session.commit()


def _development_openid(code: str) -> str:
    suffix = hashlib.sha256(code.encode()).hexdigest()[:32]
    return f"dev-openid-{suffix}"


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _idempotent(key: str, *, token: str) -> dict[str, str]:
    return {**_auth(token), "Idempotency-Key": key}


def _draft_body(
    seeded: SeededOpenGameCase,
    *,
    name: str = "真实 HTTP 周末球局",
    team_name: str = "真实 HTTP 联队",
) -> dict[str, object]:
    return draft_request(
        seeded,
        name=name,
        team_name=team_name,
    ).model_dump(mode="json")


def _table_rows(
    session: Session,
    table: Table,
) -> tuple[tuple[tuple[str, object], ...], ...]:
    rows = session.execute(select(table).order_by(table.c.id)).mappings()
    return tuple(tuple(row.items()) for row in rows)


def _b1_authority_rows(
    session: Session,
) -> dict[str, tuple[tuple[tuple[str, object], ...], ...]]:
    tables = (
        Order.__table__,
        Slot.__table__,
        Payment.__table__,
        RefundCase.__table__,
        RefundAttempt.__table__,
    )
    return {table.name: _table_rows(session, table) for table in tables}


def _all_json_keys(value: Any) -> set[str]:
    if isinstance(value, Mapping):
        return {
            key
            for raw_key, child in value.items()
            for key in ({str(raw_key)} | _all_json_keys(child))
        }
    if isinstance(value, list):
        return {key for child in value for key in _all_json_keys(child)}
    return set()


def _assert_strictly_public(
    response: httpx.Response,
    *,
    sensitive_values: set[str],
) -> dict[str, object]:
    payload = response.json()
    assert isinstance(payload, dict)
    assert set(payload) == PUBLIC_OPEN_GAME_FIELDS
    for key in _all_json_keys(payload):
        lowered_key = key.casefold()
        assert all(fragment not in lowered_key for fragment in PRIVATE_KEY_FRAGMENTS)
    serialized = response.text.casefold()
    assert all(value.casefold() not in serialized for value in sensitive_values)
    return payload


def _assert_one_active_game(engine: Engine, *, order_id: object) -> None:
    with Session(engine) as session:
        active = session.scalar(
            select(func.count())
            .select_from(OpenGame)
            .where(
                OpenGame.order_id == order_id,
                OpenGame.status != OpenGameStatus.CANCELLED,
            )
        )
        assert active == 1


def test_captain_open_game_runs_over_real_http_without_changing_b1_authority(
    pg_engine: Engine,
    local_backend_url: str,
) -> None:
    seeded = seed_confirmed_order(
        pg_engine,
        starts_at=(datetime.now(UTC) + timedelta(days=3)).replace(
            hour=8,
            minute=0,
            second=0,
            microsecond=0,
        ),
    )
    _align_development_identities(pg_engine, seeded)
    with Session(pg_engine) as session:
        baseline = _b1_authority_rows(session)
        payment = session.get_one(Payment, seeded.payment_id)
        order = session.get_one(Order, seeded.order_id)
        sensitive_values = {
            str(seeded.owner_id),
            str(seeded.order_id),
            order.order_number,
            order.contact_name,
            payment.provider,
            payment.merchant_order_no,
            payment.provider_transaction_no or "",
        } - {""}
        assert len(baseline["payments"]) == 1
        assert baseline["refund_cases"] == ()
        assert baseline["refund_attempts"] == ()

    first_draft = _draft_body(seeded)
    with httpx.Client(
        base_url=local_backend_url,
        timeout=5.0,
        trust_env=False,
    ) as client:
        owner_login = client.post(
            "/api/v1/auth/wechat/session",
            json={"code": OWNER_CODE},
        )
        assert owner_login.status_code == 200, owner_login.text
        assert owner_login.json()["user"]["id"] == str(seeded.owner_id)
        owner_token = owner_login.json()["session_token"]

        non_owner_login = client.post(
            "/api/v1/auth/wechat/session",
            json={"code": NON_OWNER_CODE},
        )
        assert non_owner_login.status_code == 200, non_owner_login.text
        assert non_owner_login.json()["user"]["id"] == str(seeded.stranger_id)
        non_owner_token = non_owner_login.json()["session_token"]

        unauthenticated = client.get(f"/api/v1/orders/{seeded.order_id}/game")
        assert unauthenticated.status_code == 401, unauthenticated.text

        entry = client.get(
            f"/api/v1/orders/{seeded.order_id}/game",
            headers=_auth(owner_token),
        )
        assert entry.status_code == 200, entry.text
        assert entry.json()["entry"] == "CREATE"

        non_owner_entry = client.get(
            f"/api/v1/orders/{seeded.order_id}/game",
            headers=_auth(non_owner_token),
        )
        assert non_owner_entry.status_code == 404, non_owner_entry.text

        created = client.post(
            f"/api/v1/orders/{seeded.order_id}/game",
            headers=_idempotent(CREATE_KEY, token=owner_token),
            json=first_draft,
        )
        assert created.status_code == 201, created.text
        created_body = created.json()
        assert created_body["persisted_status"] == "DRAFT"
        assert created_body["state"] == "DRAFT"
        assert created_body["version"] == 1
        game_id = created_body["id"]
        _assert_one_active_game(pg_engine, order_id=seeded.order_id)

        create_replay = client.post(
            f"/api/v1/orders/{seeded.order_id}/game",
            headers=_idempotent(CREATE_KEY, token=owner_token),
            json=first_draft,
        )
        assert create_replay.status_code == 201, create_replay.text
        assert create_replay.content == created.content
        _assert_one_active_game(pg_engine, order_id=seeded.order_id)

        owner_read = client.get(
            f"/api/v1/games/{game_id}",
            headers=_auth(owner_token),
        )
        assert owner_read.status_code == 200, owner_read.text
        assert owner_read.json() == created_body

        non_owner_read = client.get(
            f"/api/v1/games/{game_id}",
            headers=_auth(non_owner_token),
        )
        assert non_owner_read.status_code == 404, non_owner_read.text

        update_body = {
            **first_draft,
            "name": "更新后的真实 HTTP 球局",
            "expected_version": 1,
        }
        updated = client.put(
            f"/api/v1/games/{game_id}",
            headers=_idempotent(UPDATE_KEY, token=owner_token),
            json=update_body,
        )
        assert updated.status_code == 200, updated.text
        updated_body = updated.json()
        assert updated_body["name"] == "更新后的真实 HTTP 球局"
        assert updated_body["version"] == 2
        assert set(updated_body["public_view"]) == PUBLIC_OPEN_GAME_FIELDS
        assert updated_body["public_view"]["name"] == updated_body["name"]

        update_replay = client.put(
            f"/api/v1/games/{game_id}",
            headers=_idempotent(UPDATE_KEY, token=owner_token),
            json=update_body,
        )
        assert update_replay.status_code == 200, update_replay.text
        assert update_replay.content == updated.content
        _assert_one_active_game(pg_engine, order_id=seeded.order_id)

        published = client.post(
            f"/api/v1/games/{game_id}/publish",
            headers=_idempotent(PUBLISH_KEY, token=owner_token),
            json={"expected_version": 2},
        )
        assert published.status_code == 200, published.text
        published_body = published.json()
        assert published_body["persisted_status"] == "PUBLISHED"
        assert published_body["state"] == "PUBLISHED"
        assert published_body["version"] == 3
        share = published_body["share"]
        assert share is not None
        share_token = share["path"].rsplit("=", 1)[1]

        publish_replay = client.post(
            f"/api/v1/games/{game_id}/publish",
            headers=_idempotent(PUBLISH_KEY, token=owner_token),
            json={"expected_version": 2},
        )
        assert publish_replay.status_code == 200, publish_replay.text
        assert publish_replay.content == published.content
        _assert_one_active_game(pg_engine, order_id=seeded.order_id)

        public = client.get(f"/api/v1/shared-games/{share_token}")
        assert public.status_code == 200, public.text
        public_body = _assert_strictly_public(
            public,
            sensitive_values=sensitive_values,
        )
        assert public_body == published_body["public_view"]

        cancelled = client.post(
            f"/api/v1/games/{game_id}/cancel",
            headers=_idempotent(CANCEL_KEY, token=owner_token),
            json={"expected_version": 3},
        )
        assert cancelled.status_code == 200, cancelled.text
        cancelled_body = cancelled.json()
        assert cancelled_body["persisted_status"] == "CANCELLED"
        assert cancelled_body["state"] == "CANCELLED"
        assert cancelled_body["version"] == 4

        cancel_replay = client.post(
            f"/api/v1/games/{game_id}/cancel",
            headers=_idempotent(CANCEL_KEY, token=owner_token),
            json={"expected_version": 3},
        )
        assert cancel_replay.status_code == 200, cancel_replay.text
        assert cancel_replay.content == cancelled.content

        post_cancel_public = client.get(f"/api/v1/shared-games/{share_token}")
        assert post_cancel_public.status_code == 200, post_cancel_public.text
        post_cancel_body = _assert_strictly_public(
            post_cancel_public,
            sensitive_values=sensitive_values,
        )
        assert post_cancel_body == cancelled_body["public_view"]
        assert post_cancel_body["state_reason"] == "CAPTAIN_CANCELLED"

        post_cancel_entry = client.get(
            f"/api/v1/orders/{seeded.order_id}/game",
            headers=_auth(owner_token),
        )
        assert post_cancel_entry.status_code == 200, post_cancel_entry.text
        assert post_cancel_entry.json()["entry"] == "CREATE"

        second_draft = _draft_body(
            seeded,
            name="取消后新建的真实 HTTP 球局",
            team_name="取消后新建联队",
        )
        second_created = client.post(
            f"/api/v1/orders/{seeded.order_id}/game",
            headers=_idempotent(SECOND_CREATE_KEY, token=owner_token),
            json=second_draft,
        )
        assert second_created.status_code == 201, second_created.text
        assert second_created.json()["id"] != game_id
        assert second_created.json()["persisted_status"] == "DRAFT"

    with Session(pg_engine) as session:
        assert _b1_authority_rows(session) == baseline
        assert session.get_one(Order, seeded.order_id).status is OrderStatus.CONFIRMED
        assert session.get_one(Slot, seeded.slot_id).status is SlotStatus.BOOKED
        assert session.scalar(select(func.count()).select_from(Payment)) == 1
        assert session.scalar(select(func.count()).select_from(RefundCase)) == 0
        assert session.scalar(select(func.count()).select_from(RefundAttempt)) == 0
        games = session.scalars(
            select(OpenGame)
            .where(OpenGame.order_id == seeded.order_id)
            .order_by(OpenGame.created_at, OpenGame.id)
        ).all()
        assert len(games) == 2
        assert [game.status for game in games].count(OpenGameStatus.CANCELLED) == 1
        assert sum(game.status is not OpenGameStatus.CANCELLED for game in games) == 1
