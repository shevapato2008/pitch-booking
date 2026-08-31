from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import cast
from uuid import UUID

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, create_engine, inspect, text
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

pytestmark = pytest.mark.integration


@pytest.fixture  # type: ignore[untyped-decorator]
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
    config.set_main_option("sqlalchemy.url", engine.url.render_as_string(hide_password=False))
    return config


def _revision(engine: Engine) -> str:
    with engine.connect() as connection:
        return cast(
            str,
            connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one(),
        )


def test_0018_round_trips_empty_database_and_preserves_0017_rows(
    migration_engine: Engine,
) -> None:
    config = _config(migration_engine)
    command.upgrade(config, "0017")
    _, game_id, applicant_ids = _seed_registration_parents(migration_engine)
    registration_id = UUID("30000000-0000-0000-0000-000000000071")
    _insert_registration(
        migration_engine,
        _valid_registration(
            registration_id=registration_id,
            game_id=game_id,
            applicant_user_id=applicant_ids[0],
        ),
    )

    command.upgrade(config, "0018")
    assert _revision(migration_engine) == "0018"
    assert _enum_labels(migration_engine, "open_game_registration_status") == [
        "APPLIED",
        "JOINED",
        "REJECTED",
        "WITHDRAWN",
    ]
    assert _enum_labels(
        migration_engine, "open_game_registration_withdrawal_kind"
    ) == ["APPLICATION_WITHDRAWAL", "GAME_EXIT"]
    columns = {
        column["name"]: column
        for column in inspect(migration_engine).get_columns("open_game_registrations")
    }
    assert columns["withdrawn_at"]["nullable"] is True
    assert columns["withdrawal_kind"]["nullable"] is True
    assert columns["late_exit_recorded"]["nullable"] is False
    with migration_engine.connect() as connection:
        row = connection.execute(
            text(
                "SELECT status::text, withdrawn_at, withdrawal_kind::text, "
                "late_exit_recorded FROM open_game_registrations WHERE id = :id"
            ),
            {"id": registration_id},
        ).one()
    assert tuple(row) == ("APPLIED", None, None, False)

    command.downgrade(config, "0017")
    assert _revision(migration_engine) == "0017"
    assert _enum_labels(migration_engine, "open_game_registration_status") == [
        "APPLIED",
        "JOINED",
        "REJECTED",
    ]
    assert _enum_labels(
        migration_engine, "open_game_registration_withdrawal_kind"
    ) == []
    with migration_engine.connect() as connection:
        assert connection.execute(
            text("SELECT status::text FROM open_game_registrations WHERE id = :id"),
            {"id": registration_id},
        ).scalar_one() == "APPLIED"


def test_0018_accepts_only_the_frozen_lifecycle_matrix(
    migration_engine: Engine,
) -> None:
    config = _config(migration_engine)
    command.upgrade(config, "0018")
    captain_id, game_id, applicant_ids = _seed_registration_parents(migration_engine)
    applied_at = datetime(2026, 8, 30, 12, tzinfo=UTC)
    valid_rows = (
        {
            "status": "WITHDRAWN",
            "withdrawn_at": applied_at + timedelta(minutes=1),
            "withdrawal_kind": "APPLICATION_WITHDRAWAL",
            "late_exit_recorded": False,
        },
        {
            "status": "WITHDRAWN",
            "decided_at": applied_at + timedelta(minutes=1),
            "decided_by_user_id": captain_id,
            "withdrawn_at": applied_at + timedelta(minutes=2),
            "withdrawal_kind": "GAME_EXIT",
            "late_exit_recorded": True,
        },
    )
    for index, overrides in enumerate(valid_rows):
        _insert_registration(
            migration_engine,
            {
                **_valid_registration(
                    registration_id=UUID(
                        f"30000000-0000-0000-0000-{80 + index:012d}"
                    ),
                    game_id=game_id,
                    applicant_user_id=applicant_ids[index],
                ),
                "applied_at": applied_at,
                **overrides,
            },
        )

    invalid_cases = (
        {
            "status": "APPLIED",
            "withdrawn_at": applied_at + timedelta(minutes=1),
            "withdrawal_kind": "APPLICATION_WITHDRAWAL",
        },
        {
            "status": "JOINED",
            "decided_at": applied_at,
            "decided_by_user_id": captain_id,
            "late_exit_recorded": True,
        },
        {
            "status": "WITHDRAWN",
            "decided_at": applied_at,
            "decided_by_user_id": captain_id,
            "withdrawn_at": applied_at + timedelta(minutes=1),
            "withdrawal_kind": "APPLICATION_WITHDRAWAL",
        },
        {
            "status": "WITHDRAWN",
            "withdrawn_at": applied_at + timedelta(minutes=1),
            "withdrawal_kind": "GAME_EXIT",
        },
        {
            "status": "WITHDRAWN",
            "withdrawn_at": applied_at - timedelta(seconds=1),
            "withdrawal_kind": "APPLICATION_WITHDRAWAL",
        },
        {
            "status": "WITHDRAWN",
            "decided_at": applied_at + timedelta(minutes=2),
            "decided_by_user_id": captain_id,
            "withdrawn_at": applied_at + timedelta(minutes=1),
            "withdrawal_kind": "GAME_EXIT",
        },
        {
            "status": "WITHDRAWN",
            "withdrawn_at": applied_at + timedelta(minutes=1),
            "withdrawal_kind": "APPLICATION_WITHDRAWAL",
            "late_exit_recorded": True,
        },
    )
    invalid_base = {
        **_valid_registration(
            registration_id=UUID("30000000-0000-0000-0000-000000000089"),
            game_id=game_id,
            applicant_user_id=applicant_ids[2],
        ),
        "applied_at": applied_at,
    }
    for overrides in invalid_cases:
        with pytest.raises(DBAPIError):
            _insert_registration(
                migration_engine,
                {**invalid_base, **overrides},
            )


def test_0018_refuses_downgrade_when_withdrawn_rows_exist(
    migration_engine: Engine,
) -> None:
    config = _config(migration_engine)
    command.upgrade(config, "0018")
    _, game_id, applicant_ids = _seed_registration_parents(migration_engine)
    applied_at = datetime(2026, 8, 30, 12, tzinfo=UTC)
    _insert_registration(
        migration_engine,
        {
            **_valid_registration(
                registration_id=UUID("30000000-0000-0000-0000-000000000091"),
                game_id=game_id,
                applicant_user_id=applicant_ids[0],
            ),
            "applied_at": applied_at,
            "status": "WITHDRAWN",
            "withdrawn_at": applied_at,
            "withdrawal_kind": "APPLICATION_WITHDRAWAL",
            "late_exit_recorded": False,
        },
    )

    with pytest.raises(RuntimeError, match="WITHDRAWN"):
        command.downgrade(config, "0017")
    assert _revision(migration_engine) == "0018"
