import json
import uuid
from importlib import import_module
from pathlib import Path
from typing import Protocol, cast

import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from backend.app.config import Settings
from backend.app.main import create_app
from backend.app.models import (
    OpenGameRegistrationPosition,
    OpenGameRegistrationStatus,
)
from backend.app.modules.open_game_registrations.privacy import (
    MEMBER_ROSTER_ITEM_FIELDS,
)
from backend.tests.test_open_game_registration_api import (
    APPLICANT_TOKEN,
    OWNER_TOKEN,
    _attach_sessions,
    _auth,
    _client,
    _idempotent,
    _seed_published_game,
)
from backend.tests.test_open_game_registration_service import (
    _add_registration,
)

pytestmark = pytest.mark.integration

REMOVE_KEY = "member-removal-api-key-000000001"


class _YamlLoader(Protocol):
    def safe_load(self, stream: str) -> object: ...


YAML = cast(_YamlLoader, import_module("yaml"))


def test_member_routes_enforce_owner_privacy_validation_and_byte_stable_replay(
    pg_engine: Engine,
) -> None:
    case = _seed_published_game(pg_engine)
    _attach_sessions(pg_engine, case)
    with Session(pg_engine) as session:
        target = _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=case.booking.stranger_id,
            status=OpenGameRegistrationStatus.JOINED,
            decided_by_user_id=case.booking.owner_id,
            display_name="接口待移除队员",
            position=OpenGameRegistrationPosition.MIDFIELDER,
            note="不可暴露的申请说明",
        )
        session.commit()
        target_id = target.id

    roster_path = f"/api/v1/games/{case.game_id}/members"
    remove_path = f"{roster_path}/{target_id}/remove"
    body = {"expected_version": 2, "reason": "临时无法联系到队员"}
    with _client(pg_engine) as client:
        unauthenticated = client.get(roster_path)
        hidden_roster = client.get(
            roster_path,
            headers=_auth(APPLICANT_TOKEN),
        )
        roster = client.get(roster_path, headers=_auth(OWNER_TOKEN))
        invalid = client.post(
            remove_path,
            headers=_idempotent("short", token=OWNER_TOKEN),
            json={"expected_version": 0, "reason": "  ", "actor": "forbidden"},
        )
        hidden_remove = client.post(
            remove_path,
            headers=_idempotent(REMOVE_KEY, token=APPLICANT_TOKEN),
            json=body,
        )
        removed = client.post(
            remove_path,
            headers=_idempotent(REMOVE_KEY, token=OWNER_TOKEN),
            json=body,
        )
        replay = client.post(
            remove_path,
            headers=_idempotent(REMOVE_KEY, token=OWNER_TOKEN),
            json=body,
        )
        reused = client.post(
            remove_path,
            headers=_idempotent(REMOVE_KEY, token=OWNER_TOKEN),
            json={**body, "reason": "更换了原因"},
        )

    assert unauthenticated.status_code == 401
    assert unauthenticated.json()["error"]["code"] == "AUTH_REQUIRED"
    assert hidden_roster.status_code == 404
    assert hidden_roster.json()["error"]["code"] == "OPEN_GAME_NOT_FOUND"
    assert roster.status_code == 200, roster.text
    roster_body = roster.json()
    assert set(roster_body) == {
        "game",
        "joined_count",
        "remaining_spots",
        "waitlist_count",
        "members",
    }
    assert set(roster_body["members"][0]) == MEMBER_ROSTER_ITEM_FIELDS
    assert "不可暴露的申请说明" not in json.dumps(roster_body, ensure_ascii=False)
    assert invalid.status_code == 422
    assert invalid.json()["error"]["code"] == "INVALID_ARGUMENT"
    assert invalid.json()["error"]["details"] == {
        "fields": [
            {"field": "expected_version", "message": "字段值不符合要求。"},
            {"field": "reason", "message": "字段值不符合要求。"},
        ]
    }
    assert hidden_remove.status_code == 404
    assert hidden_remove.json()["error"]["code"] == "OPEN_GAME_NOT_FOUND"
    assert removed.status_code == 200, removed.text
    assert removed.json()["status"] == "REMOVED"
    assert removed.json()["removed_registration_id"] == str(target_id)
    assert replay.status_code == 200
    assert replay.content == removed.content
    assert reused.status_code == 409
    assert reused.json()["error"]["code"] == "IDEMPOTENCY_KEY_REUSED"
    serialized = json.dumps(removed.json(), ensure_ascii=False)
    for private_field in (
        "reason",
        "removed_by_user_id",
        "applicant_user_id",
        "idempotency_key",
        "request_sha256",
    ):
        assert private_field not in serialized


def test_member_remove_route_hides_missing_relationship_and_validates_path(
    pg_engine: Engine,
) -> None:
    case = _seed_published_game(pg_engine)
    _attach_sessions(pg_engine, case)
    missing = uuid.uuid4()
    path = f"/api/v1/games/{case.game_id}/members/{missing}/remove"
    body = {"expected_version": 2, "reason": "成员不再参加本场"}

    with _client(pg_engine) as client:
        absent = client.post(
            path,
            headers=_idempotent(REMOVE_KEY, token=OWNER_TOKEN),
            json=body,
        )
        invalid_game = client.get(
            "/api/v1/games/not-a-uuid/members",
            headers=_auth(OWNER_TOKEN),
        )
        invalid_registration = client.post(
            f"/api/v1/games/{case.game_id}/members/not-a-uuid/remove",
            headers=_idempotent(REMOVE_KEY, token=OWNER_TOKEN),
            json=body,
        )

    assert absent.status_code == 404
    assert absent.json()["error"]["code"] == "APPLICATION_NOT_FOUND"
    for response in (invalid_game, invalid_registration):
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "INVALID_ARGUMENT"


def test_member_runtime_openapi_matches_frozen_operations_and_schemas() -> None:
    contract_path = Path(__file__).resolve().parents[2] / "contracts/openapi.yaml"
    contract = cast(dict[str, object], YAML.safe_load(contract_path.read_text()))
    runtime = create_app(
        settings=Settings(app_env="test", wechat_provider="development")
    ).openapi()
    paths = cast(dict[str, object], contract["paths"])
    runtime_paths = runtime["paths"]
    member_paths = (
        ("/api/v1/games/{game_id}/members", "get"),
        (
            "/api/v1/games/{game_id}/members/{registration_id}/remove",
            "post",
        ),
    )
    for path, method in member_paths:
        assert runtime_paths[path][method] == paths[path][method]

    schemas = cast(
        dict[str, object],
        cast(dict[str, object], contract["components"])["schemas"],
    )
    for name in (
        "OpenGameMemberRemovalBlockedReason",
        "OpenGameMemberRemovalActions",
        "OpenGameMemberGameSummary",
        "OpenGameMemberRosterItem",
        "OpenGameMemberRoster",
        "OpenGameMemberRemovalRequest",
        "OpenGamePromotedMember",
        "OpenGameMemberRemovalResult",
    ):
        assert runtime["components"]["schemas"][name] == schemas[name]
