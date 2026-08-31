import uuid
from collections.abc import Iterator
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from backend.app.config import Settings
from backend.app.database import get_database
from backend.app.main import create_app
from backend.app.models import (
    OpenGameStatus,
    OpenGameVisibility,
    Order,
    OrderStatus,
)
from backend.app.modules.open_games.privacy import PUBLIC_OPEN_GAME_FIELDS
from backend.app.modules.open_games.router import get_open_game_clock
from backend.tests.test_open_game_service import (
    NOW,
    add_stored_game,
    seed_confirmed_order,
)

pytestmark = pytest.mark.integration


def _client(engine: Engine) -> TestClient:
    app = create_app(settings=Settings(app_env="test", wechat_provider="development"))

    def database_override() -> Iterator[Session]:
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_database] = database_override
    app.dependency_overrides[get_open_game_clock] = lambda: NOW
    return TestClient(app, raise_server_exceptions=False)


def test_unpublished_histories_are_uniformly_not_found(pg_engine: Engine) -> None:
    seeded = seed_confirmed_order(pg_engine)
    draft_token = "D" * 32
    with Session(pg_engine) as session:
        add_stored_game(
            session,
            seeded=seeded,
            status=OpenGameStatus.DRAFT,
            share_token=draft_token,
        )
        session.commit()
    with _client(pg_engine) as client:
        assert client.get(f"/api/v1/shared-games/{draft_token}").status_code == 404

    never_published = seed_confirmed_order(pg_engine)
    cancelled_token = "C" * 32
    with Session(pg_engine) as session:
        add_stored_game(
            session,
            seeded=never_published,
            status=OpenGameStatus.CANCELLED,
            share_token=cancelled_token,
        )
        session.commit()
    with _client(pg_engine) as client:
        assert client.get(f"/api/v1/shared-games/{cancelled_token}").status_code == 404

    indirectly_terminal = seed_confirmed_order(pg_engine)
    indirect_token = "I" * 32
    with Session(pg_engine) as session:
        add_stored_game(
            session,
            seeded=indirectly_terminal,
            status=OpenGameStatus.DRAFT,
            share_token=indirect_token,
        )
        order = session.get_one(Order, indirectly_terminal.order_id)
        order.status = OrderStatus.CANCELLED
        order.cancel_requested_at = NOW
        order.cancelled_at = NOW
        session.commit()
    with _client(pg_engine) as client:
        assert client.get(f"/api/v1/shared-games/{indirect_token}").status_code == 404


@pytest.mark.parametrize(
    ("effective", "visibility", "reason"),
    [
        ("PUBLISHED", OpenGameVisibility.PUBLIC, None),
        ("PUBLISHED", OpenGameVisibility.LINK_ONLY, None),
        ("SUSPENDED", OpenGameVisibility.PUBLIC, "BOOKING_UNAVAILABLE"),
        ("CANCELLED", OpenGameVisibility.LINK_ONLY, "CAPTAIN_CANCELLED"),
        ("COMPLETED", OpenGameVisibility.PUBLIC, "BOOKING_COMPLETED"),
    ],
)
def test_formerly_published_states_are_token_readable_and_strictly_public(
    pg_engine: Engine,
    effective: str,
    visibility: OpenGameVisibility,
    reason: str | None,
) -> None:
    seeded = seed_confirmed_order(pg_engine)
    token = uuid.uuid4().hex
    with Session(pg_engine) as session:
        game = add_stored_game(
            session,
            seeded=seeded,
            status=(
                OpenGameStatus.CANCELLED
                if effective == "CANCELLED"
                else OpenGameStatus.PUBLISHED
            ),
            share_token=token,
        )
        game.visibility = visibility
        game.published_at = NOW
        if effective == "CANCELLED":
            game.cancelled_at = NOW + timedelta(minutes=1)
        order = session.get_one(Order, seeded.order_id)
        if effective == "SUSPENDED":
            order.cancel_requested_at = NOW
        elif effective == "COMPLETED":
            order.status = OrderStatus.COMPLETED
            order.checked_in_at = NOW
            order.checked_in_by_user_id = seeded.owner_id
            order.completed_at = NOW + timedelta(minutes=1)
            order.completed_by_user_id = seeded.owner_id
        session.commit()

    with _client(pg_engine) as client:
        response = client.get(f"/api/v1/shared-games/{token}")
        response_with_invalid_bearer = client.get(
            f"/api/v1/shared-games/{token}",
            headers={"Authorization": "Bearer deliberately-invalid"},
        )
    assert response.status_code == response_with_invalid_bearer.status_code == 200
    assert response.json() == response_with_invalid_bearer.json()
    payload = response.json()
    assert set(payload) == PUBLIC_OPEN_GAME_FIELDS
    assert payload["state"] == effective
    assert payload["state_reason"] == reason
    assert payload["visibility"] == visibility.value
    serialized = response.text.casefold()
    for forbidden in (
        "order_id",
        "order_number",
        "user_id",
        "phone",
        "openid",
        "payment",
        "refund",
        "contact",
        "idempotency",
        "booking_price_cents",
        "attendance_status",
        "attendance_recorded_at",
        "attendance_recorded_by_user_id",
        "recorded_by",
    ):
        assert forbidden not in serialized


@pytest.mark.parametrize(
    "token",
    [
        "",
        "too-short",
        "A" * 31,
        "A" * 33,
        "A" * 31 + ".",
        "%2F" + "A" * 29,
        "0" * 32,
        "不存在的token______________________",
    ],
)
def test_malformed_and_unknown_share_tokens_are_same_404(
    pg_engine: Engine,
    token: str,
) -> None:
    with _client(pg_engine) as client:
        response = client.get(f"/api/v1/shared-games/{token}")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "OPEN_GAME_NOT_FOUND"
    assert "token" not in response.text.casefold()


def test_public_database_failure_is_sanitized_503_and_rolls_back() -> None:
    class FailingPublicDatabase:
        rollback_called = False

        def scalar(self, _statement: object) -> object:
            raise SQLAlchemyError("postgresql://private-secret@database")

        def rollback(self) -> None:
            self.rollback_called = True

    database = FailingPublicDatabase()
    app = create_app(settings=Settings(app_env="test", wechat_provider="development"))
    app.dependency_overrides[get_database] = lambda: database
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get(f"/api/v1/shared-games/{'P' * 32}")
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "SERVICE_UNAVAILABLE"
    assert "secret" not in response.text
    assert database.rollback_called is True


def test_public_projection_rejects_persisted_unsafe_free_text(pg_engine: Engine) -> None:
    seeded = seed_confirmed_order(pg_engine)
    token = "U" * 32
    with Session(pg_engine) as session:
        game = add_stored_game(
            session,
            seeded=seeded,
            status=OpenGameStatus.PUBLISHED,
            share_token=token,
        )
        game.equipment_and_arrival_notes = "联系微信 wx: captain-secret"
        session.commit()
    with _client(pg_engine) as client:
        response = client.get(f"/api/v1/shared-games/{token}")
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "SERVICE_UNAVAILABLE"
    assert "captain-secret" not in response.text
