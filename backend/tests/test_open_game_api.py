import hashlib
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.exc import SQLAlchemyError
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
    Slot,
    User,
    UserSession,
)
from backend.app.modules.open_games.dto import (
    OpenGameVersionRequest,
    UpdateOpenGameRequest,
)
from backend.app.modules.open_games.repository import OpenGameRepository
from backend.app.modules.open_games.router import get_open_game_clock
from backend.app.modules.open_games.service import OpenGameService
from backend.app.modules.orders.repository import OrderRepository
from backend.tests.test_open_game_service import (
    NOW,
    SeededOpenGameCase,
    add_joined_registration,
    draft_request,
    seed_confirmed_order,
)

pytestmark = pytest.mark.integration

OWNER_TOKEN = "captain-open-game-owner-token-with-at-least-256-bits"
STRANGER_TOKEN = "captain-open-game-stranger-token-with-256-bits"
CREATE_KEY = "api-create-open-game-key-000001"
UPDATE_KEY = "api-update-open-game-key-000001"
PUBLISH_KEY = "api-publish-open-game-key-00001"
CANCEL_KEY = "api-cancel-open-game-key-000001"


def _client(engine: Engine, *, now: datetime = NOW) -> TestClient:
    app = create_app(settings=Settings(app_env="test", wechat_provider="development"))

    def database_override() -> Iterator[Session]:
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_database] = database_override
    app.dependency_overrides[get_open_game_clock] = lambda: now
    return TestClient(app, raise_server_exceptions=False)


def _auth(token: str = OWNER_TOKEN) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _idempotent(key: str, *, token: str = OWNER_TOKEN) -> dict[str, str]:
    return {**_auth(token), "Idempotency-Key": key}


def _attach_sessions(engine: Engine, seeded: SeededOpenGameCase) -> None:
    with Session(engine) as session:
        for user_id, token in (
            (seeded.owner_id, OWNER_TOKEN),
            (seeded.stranger_id, STRANGER_TOKEN),
        ):
            session.add(
                UserSession(
                    user=session.get_one(User, user_id),
                    token_hash=hashlib.sha256(token.encode()).hexdigest(),
                    issued_at=datetime.now(UTC) - timedelta(minutes=1),
                    expires_at=datetime.now(UTC) + timedelta(days=1),
                )
            )
        session.commit()


def _body(seeded: SeededOpenGameCase) -> dict[str, object]:
    return draft_request(seeded).model_dump(mode="json")


def _create_draft(engine: Engine, seeded: SeededOpenGameCase) -> uuid.UUID:
    with Session(engine) as session:
        result = OpenGameService(
            repository=OpenGameRepository(session),
            order_repository=OrderRepository(session),
            now=lambda: NOW,
            token_factory=lambda: "A" * 32,
        ).create_draft(
            user_id=seeded.owner_id,
            order_id=seeded.order_id,
            idempotency_key=CREATE_KEY,
            request=draft_request(seeded),
        )
        return result.id


def test_owner_http_journey_exposes_all_six_private_operations(
    pg_engine: Engine,
) -> None:
    seeded = seed_confirmed_order(pg_engine)
    _attach_sessions(pg_engine, seeded)

    with _client(pg_engine) as client:
        entry = client.get(
            f"/api/v1/orders/{seeded.order_id}/game", headers=_auth()
        )
        assert entry.status_code == 200
        assert entry.json()["entry"] == "CREATE"

        created = client.post(
            f"/api/v1/orders/{seeded.order_id}/game",
            headers=_idempotent(CREATE_KEY),
            json=_body(seeded),
        )
        assert created.status_code == 201
        created_body = created.json()
        assert created_body["persisted_status"] == "DRAFT"
        assert created_body["version"] == 1
        game_id = created_body["id"]

        managed_entry = client.get(
            f"/api/v1/orders/{seeded.order_id}/game", headers=_auth()
        )
        assert managed_entry.json() == {
            "entry": "MANAGE",
            "order": None,
            "game_id": game_id,
            "blocked_reason": None,
        }
        owned = client.get(f"/api/v1/games/{game_id}", headers=_auth())
        assert owned.status_code == 200
        assert owned.json() == created_body

        update_body = {**_body(seeded), "name": "更新后的周末球局", "expected_version": 1}
        updated = client.put(
            f"/api/v1/games/{game_id}",
            headers=_idempotent(UPDATE_KEY),
            json=update_body,
        )
        assert updated.status_code == 200
        assert updated.json()["name"] == "更新后的周末球局"
        assert updated.json()["version"] == 2

        published = client.post(
            f"/api/v1/games/{game_id}/publish",
            headers=_idempotent(PUBLISH_KEY),
            json={"expected_version": 2},
        )
        assert published.status_code == 200
        assert published.json()["persisted_status"] == "PUBLISHED"
        assert published.json()["state"] == "PUBLISHED"
        assert published.json()["version"] == 3
        share_path = published.json()["share"]["path"]
        assert share_path.startswith("/pages/captain-game-public/index?token=")
        assert len(share_path.rsplit("=", 1)[1]) == 32

        cancelled = client.post(
            f"/api/v1/games/{game_id}/cancel",
            headers=_idempotent(CANCEL_KEY),
            json={"expected_version": 3},
        )
        assert cancelled.status_code == 200
        assert cancelled.json()["persisted_status"] == "CANCELLED"
        assert cancelled.json()["state"] == "CANCELLED"
        assert cancelled.json()["version"] == 4
        assert cancelled.json()["share"] is None


def test_publish_replay_precedes_state_version_and_current_order_authority(
    pg_engine: Engine,
) -> None:
    seeded = seed_confirmed_order(pg_engine)
    _attach_sessions(pg_engine, seeded)
    game_id = _create_draft(pg_engine, seeded)

    with _client(pg_engine) as client:
        first = client.post(
            f"/api/v1/games/{game_id}/publish",
            headers=_idempotent(PUBLISH_KEY),
            json={"expected_version": 1},
        )
        assert first.status_code == 200

        with Session(pg_engine) as session:
            order = session.get_one(Order, seeded.order_id)
            order.status = OrderStatus.REFUNDED
            order.cancel_requested_at = NOW
            order.cancelled_at = NOW
            session.commit()

        replay = client.post(
            f"/api/v1/games/{game_id}/publish",
            headers=_idempotent(PUBLISH_KEY),
            json={"expected_version": 1},
        )
        assert replay.status_code == 200
        assert replay.json() == first.json()


def test_publish_revalidates_b1_eligibility_and_keeps_draft_unchanged(
    pg_engine: Engine,
) -> None:
    seeded = seed_confirmed_order(pg_engine)
    _attach_sessions(pg_engine, seeded)
    game_id = _create_draft(pg_engine, seeded)
    with Session(pg_engine) as session:
        order = session.get_one(Order, seeded.order_id)
        order.cancel_requested_at = NOW
        session.commit()

    with _client(pg_engine) as client:
        response = client.post(
            f"/api/v1/games/{game_id}/publish",
            headers=_idempotent(PUBLISH_KEY),
            json={"expected_version": 1},
        )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "ORDER_NOT_ELIGIBLE"
    with Session(pg_engine) as session:
        game = session.get_one(OpenGame, game_id)
        assert (game.status, game.published_at, game.version) == (
            OpenGameStatus.DRAFT,
            None,
            1,
        )


def test_publish_elapsed_persisted_deadline_has_no_non_request_field_details(
    pg_engine: Engine,
) -> None:
    seeded = seed_confirmed_order(pg_engine)
    _attach_sessions(pg_engine, seeded)
    deadline = NOW + timedelta(hours=4)
    with Session(pg_engine) as session:
        game = OpenGameService(
            repository=OpenGameRepository(session),
            order_repository=OrderRepository(session),
            now=lambda: NOW,
            token_factory=lambda: "A" * 32,
        ).create_draft(
            user_id=seeded.owner_id,
            order_id=seeded.order_id,
            idempotency_key=CREATE_KEY,
            request=draft_request(seeded, registration_deadline=deadline),
        )

    with _client(pg_engine, now=deadline + timedelta(microseconds=1)) as client:
        response = client.post(
            f"/api/v1/games/{game.id}/publish",
            headers=_idempotent(PUBLISH_KEY),
            json={"expected_version": 1},
        )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_ARGUMENT"
    assert response.json()["error"]["details"] == {}


def test_published_owner_remains_published_past_creation_boundary_and_can_retain_deadline(
    pg_engine: Engine,
) -> None:
    seeded = seed_confirmed_order(pg_engine)
    deadline = NOW + timedelta(hours=4)
    with Session(pg_engine) as session:
        created = OpenGameService(
            repository=OpenGameRepository(session),
            order_repository=OrderRepository(session),
            now=lambda: NOW,
            token_factory=lambda: "B" * 32,
        ).create_draft(
            user_id=seeded.owner_id,
            order_id=seeded.order_id,
            idempotency_key=CREATE_KEY,
            request=draft_request(seeded, registration_deadline=deadline),
        )
        published = OpenGameService(
            repository=OpenGameRepository(session),
            order_repository=OrderRepository(session),
            now=lambda: NOW,
        ).publish(
            user_id=seeded.owner_id,
            game_id=created.id,
            idempotency_key=PUBLISH_KEY,
            request=OpenGameVersionRequest(expected_version=1),
        )
        later = seeded.starts_at - timedelta(hours=2)
        owner = OpenGameService(
            repository=OpenGameRepository(session),
            order_repository=OrderRepository(session),
            now=lambda: later,
        ).get_owner(user_id=seeded.owner_id, game_id=created.id)
        assert owner.state.value == "PUBLISHED"
        assert owner.share == published.share

        update = UpdateOpenGameRequest(
            **draft_request(
                seeded, registration_deadline=deadline
            ).model_dump(),
            expected_version=2,
        )
        retained = OpenGameService(
            repository=OpenGameRepository(session),
            order_repository=OrderRepository(session),
            now=lambda: deadline + timedelta(minutes=1),
        ).update(
            user_id=seeded.owner_id,
            game_id=created.id,
            idempotency_key=UPDATE_KEY,
            request=update,
        )
        assert retained.registration_deadline == deadline


@pytest.mark.parametrize("initial_state", ["DRAFT", "PUBLISHED", "SUSPENDED"])
def test_cancel_real_action_is_idempotent_and_never_mutates_b1(
    pg_engine: Engine,
    initial_state: str,
) -> None:
    seeded = seed_confirmed_order(pg_engine)
    _attach_sessions(pg_engine, seeded)
    game_id = _create_draft(pg_engine, seeded)
    expected_version = 1
    with _client(pg_engine) as client:
        if initial_state == "PUBLISHED":
            published = client.post(
                f"/api/v1/games/{game_id}/publish",
                headers=_idempotent(PUBLISH_KEY),
                json={"expected_version": 1},
            )
            assert published.status_code == 200
            expected_version = 2
        elif initial_state == "SUSPENDED":
            with Session(pg_engine) as session:
                order = session.get_one(Order, seeded.order_id)
                order.cancel_requested_at = NOW
                session.commit()
            suspended = client.get(f"/api/v1/games/{game_id}", headers=_auth())
            assert suspended.json()["state"] == "SUSPENDED"
            assert suspended.json()["allowed_actions"] == {
                "can_edit": False,
                "can_publish": False,
                "can_share": False,
                "can_cancel": True,
                "can_preview": True,
            }

        with Session(pg_engine) as session:
            order = session.get_one(Order, seeded.order_id)
            slot = session.get_one(Slot, seeded.slot_id)
            payment = session.get_one(Payment, seeded.payment_id)
            snapshot = (
                order.status,
                order.cancel_requested_at,
                order.cancelled_at,
                slot.status,
                slot.checkout_version,
                payment.status,
                payment.applied_to_order_at,
            )

        first = client.post(
            f"/api/v1/games/{game_id}/cancel",
            headers=_idempotent(CANCEL_KEY),
            json={"expected_version": expected_version},
        )
        replay = client.post(
            f"/api/v1/games/{game_id}/cancel",
            headers=_idempotent(CANCEL_KEY),
            json={"expected_version": expected_version},
        )
        assert first.status_code == replay.status_code == 200
        assert replay.json() == first.json()
        assert first.json()["persisted_status"] == "CANCELLED"

    with Session(pg_engine) as session:
        order = session.get_one(Order, seeded.order_id)
        slot = session.get_one(Slot, seeded.slot_id)
        payment = session.get_one(Payment, seeded.payment_id)
        assert (
            order.status,
            order.cancel_requested_at,
            order.cancelled_at,
            slot.status,
            slot.checkout_version,
            payment.status,
            payment.applied_to_order_at,
        ) == snapshot


def test_private_owner_mismatch_and_missing_are_symmetric_404(pg_engine: Engine) -> None:
    seeded = seed_confirmed_order(pg_engine)
    _attach_sessions(pg_engine, seeded)
    game_id = _create_draft(pg_engine, seeded)
    with _client(pg_engine) as client:
        foreign = client.get(
            f"/api/v1/games/{game_id}", headers=_auth(STRANGER_TOKEN)
        )
        missing = client.get(f"/api/v1/games/{uuid.uuid4()}", headers=_auth())
    assert foreign.status_code == missing.status_code == 404
    assert foreign.json()["error"]["code"] == missing.json()["error"]["code"] == (
        "OPEN_GAME_NOT_FOUND"
    )


def test_owner_auth_and_database_failures_are_closed_and_rollback() -> None:
    class FailingAuthDatabase:
        rollback_called = False

        def scalar(self, _statement: object) -> object:
            raise SQLAlchemyError("injected secret database failure")

        def rollback(self) -> None:
            self.rollback_called = True

    database = FailingAuthDatabase()
    app = create_app(settings=Settings(app_env="test", wechat_provider="development"))
    app.dependency_overrides[get_database] = lambda: database
    with TestClient(app, raise_server_exceptions=False) as client:
        missing = client.get(f"/api/v1/games/{uuid.uuid4()}")
        unavailable = client.get(
            f"/api/v1/games/{uuid.uuid4()}", headers=_auth()
        )
    assert missing.status_code == 401
    assert missing.json()["error"]["code"] == "AUTH_REQUIRED"
    assert unavailable.status_code == 503
    assert unavailable.json()["error"]["code"] == "SERVICE_UNAVAILABLE"
    assert "secret" not in unavailable.text
    assert database.rollback_called is True


def test_mutation_validation_maps_only_known_first_level_body_fields(
    pg_engine: Engine,
) -> None:
    seeded = seed_confirmed_order(pg_engine)
    _attach_sessions(pg_engine, seeded)
    body = _body(seeded)
    with _client(pg_engine) as client:
        ordinary = client.post(
            f"/api/v1/orders/{seeded.order_id}/game",
            headers=_idempotent(CREATE_KEY),
            json={**body, "name": "x"},
        )
        assert ordinary.status_code == 422
        assert ordinary.json()["error"]["code"] == "INVALID_ARGUMENT"
        assert [item["field"] for item in ordinary.json()["error"]["details"]["fields"]] == [
            "name"
        ]

        ordinary_capacity = client.post(
            f"/api/v1/orders/{seeded.order_id}/game",
            headers=_idempotent("api-ordinary-capacity-key-0001"),
            json={**body, "open_spots": 0},
        )
        assert ordinary_capacity.status_code == 422
        assert ordinary_capacity.json()["error"] | {
            "request_id": "ignored"
        } == {
            "code": "INVALID_ARGUMENT",
            "message": "请求参数格式不正确，请检查后重试。",
            "details": {
                "fields": [
                    {"field": "open_spots", "message": "字段值不符合要求。"}
                ]
            },
            "request_id": "ignored",
        }

        extra = client.post(
            f"/api/v1/orders/{seeded.order_id}/game",
            headers=_idempotent(CREATE_KEY),
            json={**body, "unexpected": True},
        )
        assert extra.status_code == 422
        assert extra.json()["error"]["details"] == {}

        model_level = client.post(
            f"/api/v1/orders/{seeded.order_id}/game",
            headers=_idempotent(CREATE_KEY),
            json={**body, "total_players": 4, "fixed_players": 3, "open_spots": 2},
        )
        assert model_level.status_code == 422
        assert model_level.json()["error"]["details"] == {}

        cross_field = client.post(
            f"/api/v1/orders/{seeded.order_id}/game",
            headers=_idempotent("api-cross-field-key-00000001"),
            json={
                **body,
                "registration_deadline": (
                    seeded.starts_at - timedelta(hours=1)
                ).isoformat(),
            },
        )
        assert cross_field.status_code == 422
        assert cross_field.json()["error"]["code"] == "INVALID_ARGUMENT"
        assert cross_field.json()["error"]["details"] == {
            "fields": [
                {
                    "field": "registration_deadline",
                    "message": "必须晚于当前时间且不晚于开场前 2 小时。",
                }
            ]
        }

        bad_path = client.post(
            "/api/v1/games/not-a-uuid/publish",
            headers=_idempotent(PUBLISH_KEY),
            json={"expected_version": 1},
        )
        assert bad_path.status_code == 422
        assert bad_path.json()["error"]["details"] == {}

        bad_header = client.post(
            f"/api/v1/games/{uuid.uuid4()}/publish",
            headers=_idempotent("short"),
            json={"expected_version": 1},
        )
        assert bad_header.status_code == 422
        assert bad_header.json()["error"]["details"] == {}

        version = client.post(
            f"/api/v1/games/{uuid.uuid4()}/publish",
            headers=_idempotent(PUBLISH_KEY),
            json={"expected_version": 0},
        )
        assert version.status_code == 422
        assert version.json()["error"]["details"] == {
            "fields": [
                {
                    "field": "expected_version",
                    "message": "必须是当前球局版本。",
                }
            ]
        }


def test_no_collection_or_list_endpoint_is_published(pg_engine: Engine) -> None:
    with _client(pg_engine) as client:
        assert client.get("/api/v1/games").status_code == 404


def test_joined_update_http_error_is_frozen_and_minimal(pg_engine: Engine) -> None:
    seeded = seed_confirmed_order(pg_engine)
    _attach_sessions(pg_engine, seeded)
    game_id = _create_draft(pg_engine, seeded)
    with Session(pg_engine) as session:
        for index in range(3):
            add_joined_registration(
                session,
                game_id=game_id,
                owner_id=seeded.owner_id,
                label=f"api-{index}",
            )
        session.commit()

    body = _body(seeded) | {
        "total_players": 8,
        "open_spots": 2,
        "aa_cents": 3601,
        "expected_version": 1,
    }
    with _client(pg_engine) as client:
        response = client.put(
            f"/api/v1/games/{game_id}",
            headers=_idempotent(UPDATE_KEY),
            json=body,
        )

    assert response.status_code == 422
    payload = response.json()
    request_id = payload["error"].pop("request_id")
    assert isinstance(request_id, str) and request_id
    assert payload == {
        "error": {
            "code": "INVALID_ARGUMENT",
            "message": "球局已有加入成员，开放容量或预计 AA 不符合要求。",
            "details": {
                "fields": [
                    {"field": "open_spots", "message": "不能小于已加入人数。"},
                    {
                        "field": "total_players",
                        "message": "不能小于固定人数与已加入人数之和。",
                    },
                    {
                        "field": "aa_cents",
                        "message": "已有加入成员后预计 AA 只能保持或降低。",
                    },
                ]
            },
        }
    }
