from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import cast
from uuid import UUID

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import DateTime, Engine, Integer, String, create_engine, inspect, text
from sqlalchemy.exc import DBAPIError

from backend.tests.postgres_test_database import (
    disposable_database,
    override_test_database_url,
)
from backend.tests.test_open_game_registration_schema import (
    _enum_labels,
    _insert_registration,
    _seed_registration_parents,
    _valid_registration,
)
from backend.tests.test_open_game_schema import _insert_game, _valid_game

pytestmark = pytest.mark.integration

REGISTRATION_ID = UUID("52000000-0000-4000-8000-000000000001")
PROMOTED_ID = UUID("52000000-0000-4000-8000-000000000002")
REMOVAL_ID = UUID("53000000-0000-4000-8000-000000000001")
OTHER_ORDER_ID = UUID("54000000-0000-4000-8000-000000000001")
OTHER_GAME_ID = UUID("54000000-0000-4000-8000-000000000002")
OTHER_REGISTRATION_ID = UUID("54000000-0000-4000-8000-000000000003")
REMOVED_AT = datetime(2026, 9, 1, 10, tzinfo=UTC)


@pytest.fixture
def migration_engine(test_database_url: str) -> Iterator[Engine]:
    with disposable_database(test_database_url) as migration_url:
        rendered = migration_url.render_as_string(hide_password=False)
        with override_test_database_url(rendered):
            engine = create_engine(migration_url)
            try:
                yield engine
            finally:
                engine.dispose()


def _config(engine: Engine) -> Config:
    config = Config("alembic.ini")
    config.set_main_option(
        "sqlalchemy.url", engine.url.render_as_string(hide_password=False)
    )
    return config


def _revision(engine: Engine) -> str:
    with engine.connect() as connection:
        return cast(
            str,
            connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one(),
        )


def _seed_joined(
    engine: Engine,
) -> tuple[UUID, UUID, UUID, tuple[UUID, UUID, UUID]]:
    captain_id, game_id, applicant_ids = _seed_registration_parents(engine)
    with engine.connect() as connection:
        order_id = cast(
            UUID,
            connection.execute(
                text("SELECT order_id FROM open_games WHERE id = :game_id"),
                {"game_id": game_id},
            ).scalar_one(),
        )
    for index, registration_id in enumerate((REGISTRATION_ID, PROMOTED_ID)):
        values = _valid_registration(
            registration_id=registration_id,
            game_id=game_id,
            applicant_user_id=applicant_ids[index],
        )
        applied_at = cast(datetime, values["applied_at"])
        _insert_registration(
            engine,
            {
                **values,
                "status": "JOINED" if index == 0 else "WAITLISTED",
                "version": 2,
                "decided_at": applied_at + timedelta(minutes=1),
                "decided_by_user_id": captain_id,
                **(
                    {}
                    if index == 0
                    else {
                        "waitlist_seq": 1,
                        "waitlisted_at": applied_at + timedelta(minutes=1),
                    }
                ),
            },
        )
    return captain_id, order_id, game_id, applicant_ids


def _valid_removal(
    *,
    captain_id: UUID,
    order_id: UUID,
    game_id: UUID,
    applicant_user_id: UUID,
    promoted_applicant_user_id: UUID,
    **overrides: object,
) -> dict[str, object]:
    return {
        "id": REMOVAL_ID,
        "registration_id": REGISTRATION_ID,
        "applicant_user_id": applicant_user_id,
        "game_id": game_id,
        "order_id": order_id,
        "removed_by_user_id": captain_id,
        "reason": "临时阵容调整",
        "removed_at": REMOVED_AT,
        "registration_version_before": 2,
        "registration_version_after": 3,
        "promoted_registration_id": PROMOTED_ID,
        "promoted_applicant_user_id": promoted_applicant_user_id,
        "promoted_registration_version_before": 2,
        "promoted_registration_version_after": 3,
        "idempotency_key": "member-removal-key-0001",
        "request_sha256": "a" * 64,
        **overrides,
    }


def _insert_removal(engine: Engine, values: dict[str, object]) -> None:
    columns = ", ".join(values)
    parameters = ", ".join(f":{column}" for column in values)
    with engine.begin() as connection:
        connection.execute(
            text(
                f"INSERT INTO open_game_member_removals ({columns}) "
                f"VALUES ({parameters})"
            ),
            values,
        )


def test_0023_round_trips_empty_storage_and_declares_exact_schema(
    migration_engine: Engine,
) -> None:
    config = _config(migration_engine)
    command.upgrade(config, "0022")
    _seed_joined(migration_engine)

    command.upgrade(config, "0023")

    assert _revision(migration_engine) == "0023"
    assert _enum_labels(migration_engine, "open_game_registration_status") == [
        "APPLIED",
        "WAITLISTED",
        "JOINED",
        "REJECTED",
        "WITHDRAWN",
        "REMOVED",
    ]
    inspector = inspect(migration_engine)
    registration_columns = {
        column["name"]: column
        for column in inspector.get_columns("open_game_registrations")
    }
    for name in ("removed_at", "removed_by_user_id"):
        assert name in registration_columns
        assert registration_columns[name]["nullable"] is True
    assert isinstance(registration_columns["removed_at"]["type"], DateTime)
    assert registration_columns["removed_at"]["type"].timezone is True

    columns = {
        column["name"]: column
        for column in inspector.get_columns("open_game_member_removals")
    }
    assert list(columns) == [
        "id",
        "registration_id",
        "applicant_user_id",
        "game_id",
        "order_id",
        "removed_by_user_id",
        "reason",
        "removed_at",
        "registration_version_before",
        "registration_version_after",
        "promoted_registration_id",
        "promoted_applicant_user_id",
        "promoted_registration_version_before",
        "promoted_registration_version_after",
        "idempotency_key",
        "request_sha256",
    ]
    assert isinstance(columns["reason"]["type"], String)
    assert columns["reason"]["type"].length == 120
    assert isinstance(columns["registration_version_before"]["type"], Integer)
    assert {foreign_key["name"] for foreign_key in inspector.get_foreign_keys(
        "open_game_member_removals"
    )} == {
        "fk_member_removals_registration_identity",
        "fk_member_removals_game_order",
        "fk_member_removals_order",
        "fk_member_removals_removed_by_user",
        "fk_member_removals_promoted_registration_identity",
    }
    assert "uq_open_games_id_order_id" in {
        constraint["name"]
        for constraint in inspector.get_unique_constraints("open_games")
    }

    command.downgrade(config, "0022")
    assert _revision(migration_engine) == "0022"
    assert "open_game_member_removals" not in inspect(migration_engine).get_table_names()
    assert "removed_at" not in {
        column["name"]
        for column in inspect(migration_engine).get_columns("open_game_registrations")
    }
    assert _enum_labels(migration_engine, "open_game_registration_status") == [
        "APPLIED",
        "WAITLISTED",
        "JOINED",
        "REJECTED",
        "WITHDRAWN",
    ]


def test_0023_enforces_terminal_registration_and_append_only_audit(
    migration_engine: Engine,
) -> None:
    command.upgrade(_config(migration_engine), "0023")
    captain_id, order_id, game_id, applicant_ids = _seed_joined(migration_engine)
    with migration_engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE open_game_registrations SET status = 'REMOVED', "
                "removed_at = :removed_at, removed_by_user_id = :captain_id, "
                "version = 3 WHERE id = :registration_id"
            ),
            {
                "removed_at": REMOVED_AT,
                "captain_id": captain_id,
                "registration_id": REGISTRATION_ID,
            },
        )
    _insert_removal(
        migration_engine,
        _valid_removal(
            captain_id=captain_id,
            order_id=order_id,
            game_id=game_id,
            applicant_user_id=applicant_ids[0],
            promoted_applicant_user_id=applicant_ids[1],
        ),
    )

    for statement in (
        "UPDATE open_game_member_removals SET reason = '修改' WHERE id = :id",
        "DELETE FROM open_game_member_removals WHERE id = :id",
    ):
        with pytest.raises(DBAPIError) as error:
            with migration_engine.begin() as connection:
                connection.execute(text(statement), {"id": REMOVAL_ID})
        assert error.value.orig.diag.constraint_name == (
            "ck_open_game_member_removals_append_only"
        )

    with pytest.raises(RuntimeError, match="member removal history"):
        command.downgrade(_config(migration_engine), "0022")


def test_0023_rejects_invalid_removal_pairs_and_audit_values(
    migration_engine: Engine,
) -> None:
    command.upgrade(_config(migration_engine), "0023")
    captain_id, order_id, game_id, applicant_ids = _seed_joined(migration_engine)

    invalid_updates = (
        "UPDATE open_game_registrations SET status = 'REMOVED' WHERE id = :id",
        "UPDATE open_game_registrations SET removed_at = now(), "
        "removed_by_user_id = :captain_id WHERE id = :id",
        "UPDATE open_game_registrations SET status = 'REMOVED', "
        "attendance_status = 'PRESENT', attendance_recorded_at = now(), "
        "attendance_recorded_by_user_id = :captain_id, removed_at = now(), "
        "removed_by_user_id = :captain_id WHERE id = :id",
    )
    for statement in invalid_updates:
        with pytest.raises(DBAPIError):
            with migration_engine.begin() as connection:
                connection.execute(
                    text(statement),
                    {"id": REGISTRATION_ID, "captain_id": captain_id},
                )

    invalid_audits = (
        {"reason": "  "},
        {"reason": "x" * 121},
        {"registration_version_after": 4},
        {"promoted_registration_id": None},
        {"promoted_applicant_user_id": None},
        {"promoted_registration_version_before": None},
        {"promoted_registration_version_after": 4},
        {"idempotency_key": "short"},
        {"request_sha256": "A" * 64},
    )
    for index, overrides in enumerate(invalid_audits, start=1):
        with pytest.raises(DBAPIError):
            removal_arguments = {
                "captain_id": captain_id,
                "order_id": order_id,
                "game_id": game_id,
                "applicant_user_id": applicant_ids[0],
                "promoted_applicant_user_id": applicant_ids[1],
                "id": UUID(int=600 + index),
                "registration_version_before": 20 + index,
                "registration_version_after": 21 + index,
                "idempotency_key": f"invalid-member-removal-{index:04d}",
                **overrides,
            }
            _insert_removal(
                migration_engine,
                _valid_removal(**removal_arguments),  # type: ignore[arg-type]
            )


def test_0023_rejects_cross_entity_member_removal_audit_mismatches(
    migration_engine: Engine,
) -> None:
    command.upgrade(_config(migration_engine), "0023")
    captain_id, order_id, game_id, applicant_ids = _seed_joined(migration_engine)
    with migration_engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO orders "
                "(id, order_number, user_id, slot_id, status, price_cents, "
                "contact_name, contact_phone_ciphertext, contact_phone_nonce, "
                "contact_phone_key_version, created_at, expires_at) "
                "SELECT :other_order_id, 'PB-OTHER-MEMBER-REMOVAL', user_id, "
                "slot_id, status, price_cents, contact_name, "
                "contact_phone_ciphertext, contact_phone_nonce, "
                "contact_phone_key_version, created_at, expires_at "
                "FROM orders WHERE id = :order_id"
            ),
            {"other_order_id": OTHER_ORDER_ID, "order_id": order_id},
        )
        team_id = cast(
            UUID,
            connection.execute(
                text("SELECT team_id FROM open_games WHERE id = :game_id"),
                {"game_id": game_id},
            ).scalar_one(),
        )
    _insert_game(
        migration_engine,
        _valid_game(
            game_id=OTHER_GAME_ID,
            order_id=OTHER_ORDER_ID,
            team_id=team_id,
            share_token="other-member-removal-game",
        ),
    )
    _insert_registration(
        migration_engine,
        _valid_registration(
            registration_id=OTHER_REGISTRATION_ID,
            game_id=OTHER_GAME_ID,
            applicant_user_id=applicant_ids[2],
        ),
    )

    no_promotion = {
        "promoted_registration_id": None,
        "promoted_applicant_user_id": None,
        "promoted_registration_version_before": None,
        "promoted_registration_version_after": None,
    }
    invalid_identities = (
        {"applicant_user_id": applicant_ids[1], **no_promotion},
        {
            "game_id": OTHER_GAME_ID,
            "order_id": OTHER_ORDER_ID,
            **no_promotion,
        },
        {
            "promoted_registration_id": OTHER_REGISTRATION_ID,
            "promoted_applicant_user_id": applicant_ids[2],
        },
        {"order_id": OTHER_ORDER_ID, **no_promotion},
    )
    for index, overrides in enumerate(invalid_identities, start=1):
        with pytest.raises(DBAPIError):
            removal_arguments = {
                "captain_id": captain_id,
                "order_id": order_id,
                "game_id": game_id,
                "applicant_user_id": applicant_ids[0],
                "promoted_applicant_user_id": applicant_ids[1],
                "id": UUID(int=800 + index),
                "idempotency_key": f"cross-member-removal-{index:04d}",
                **overrides,
            }
            _insert_removal(
                migration_engine,
                _valid_removal(**removal_arguments),  # type: ignore[arg-type]
            )
