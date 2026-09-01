from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import (
    DateTime,
    Engine,
    Integer,
    String,
    create_engine,
    inspect,
    text,
)
from sqlalchemy import Enum as SAEnum
from sqlalchemy.exc import DBAPIError

from backend.app import models
from backend.tests.postgres_test_database import (
    disposable_database,
    override_test_database_url,
)
from backend.tests.test_open_game_schema import (
    _insert_game,
    _insert_team,
    _seed_booking_parents,
    _valid_game,
)

pytestmark = pytest.mark.integration


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
    config.set_main_option("sqlalchemy.url", engine.url.render_as_string(hide_password=False))
    return config


def _enum_labels(engine: Engine, enum_name: str) -> list[str]:
    with engine.connect() as connection:
        return list(
            connection.execute(
                text(
                    "SELECT label.enumlabel "
                    "FROM pg_type AS type "
                    "JOIN pg_enum AS label ON label.enumtypid = type.oid "
                    "WHERE type.typname = :enum_name "
                    "ORDER BY label.enumsortorder"
                ),
                {"enum_name": enum_name},
            ).scalars()
        )


def _seed_registration_parents(
    engine: Engine,
) -> tuple[UUID, UUID, tuple[UUID, UUID, UUID]]:
    captain_id, order_id = _seed_booking_parents(engine)
    team_id = UUID("30000000-0000-0000-0000-000000000020")
    game_id = UUID("30000000-0000-0000-0000-000000000030")
    applicant_ids = (
        UUID("30000000-0000-0000-0000-000000000041"),
        UUID("30000000-0000-0000-0000-000000000042"),
        UUID("30000000-0000-0000-0000-000000000043"),
    )
    _insert_team(engine, team_id=team_id, captain_id=captain_id)
    _insert_game(
        engine,
        _valid_game(
            game_id=game_id,
            order_id=order_id,
            team_id=team_id,
            share_token="registration-schema-game",
        ),
    )
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO users (id, wechat_app_id, wechat_openid, created_at) "
                "VALUES "
                "(:applicant_1, 'wx-registration', 'applicant-1', now()), "
                "(:applicant_2, 'wx-registration', 'applicant-2', now()), "
                "(:applicant_3, 'wx-registration', 'applicant-3', now())"
            ),
            {
                "applicant_1": applicant_ids[0],
                "applicant_2": applicant_ids[1],
                "applicant_3": applicant_ids[2],
            },
        )
    return captain_id, game_id, applicant_ids


def _valid_registration(
    *, registration_id: UUID, game_id: UUID, applicant_user_id: UUID
) -> dict[str, object]:
    return {
        "id": registration_id,
        "game_id": game_id,
        "applicant_user_id": applicant_user_id,
        "display_name": "逐光球员",
        "position": "ANY",
        "note": None,
        "status": "APPLIED",
        "version": 1,
        "consent_version": "c1a-2026-08-24",
        "adult_confirmed_at": datetime(2026, 8, 24, 12, tzinfo=UTC),
        "risk_confirmed_at": datetime(2026, 8, 24, 12, 1, tzinfo=UTC),
        "applied_at": datetime(2026, 8, 24, 12, 2, tzinfo=UTC),
        "decided_at": None,
        "decided_by_user_id": None,
    }


def _insert_registration(engine: Engine, values: dict[str, object]) -> None:
    columns = ", ".join(values)
    parameters = ", ".join(f":{key}" for key in values)
    with engine.begin() as connection:
        connection.execute(
            text(
                f"INSERT INTO open_game_registrations ({columns}) "
                f"VALUES ({parameters})"
            ),
            values,
        )


def test_open_game_registration_migration_round_trips_strictly(
    migration_engine: Engine,
) -> None:
    config = _config(migration_engine)
    command.upgrade(config, "0015")
    inspector = inspect(migration_engine)
    assert "open_game_registrations" not in inspector.get_table_names()
    assert _enum_labels(migration_engine, "open_game_registration_position") == []
    assert _enum_labels(migration_engine, "open_game_registration_status") == []

    command.upgrade(config, "0016")
    inspector = inspect(migration_engine)
    assert "open_game_registrations" in inspector.get_table_names()
    with migration_engine.connect() as connection:
        assert connection.execute(
            text("SELECT version_num FROM alembic_version")
        ).scalar_one() == "0016"

    command.downgrade(config, "0015")
    inspector = inspect(migration_engine)
    assert "open_game_registrations" not in inspector.get_table_names()
    assert "open_games" in inspector.get_table_names()
    assert _enum_labels(migration_engine, "open_game_registration_position") == []
    assert _enum_labels(migration_engine, "open_game_registration_status") == []
    with migration_engine.connect() as connection:
        assert connection.execute(
            text("SELECT version_num FROM alembic_version")
        ).scalar_one() == "0015"

    command.upgrade(config, "0016")
    inspector = inspect(migration_engine)
    assert "open_game_registrations" in inspector.get_table_names()
    assert _enum_labels(
        migration_engine, "open_game_registration_position"
    ) == ["GOALKEEPER", "DEFENDER", "MIDFIELDER", "FORWARD", "ANY"]
    assert _enum_labels(migration_engine, "open_game_registration_status") == [
        "APPLIED",
        "JOINED",
        "REJECTED",
    ]
    with migration_engine.connect() as connection:
        assert connection.execute(
            text("SELECT version_num FROM alembic_version")
        ).scalar_one() == "0016"


def test_open_game_registration_schema_catalog(migration_engine: Engine) -> None:
    command.upgrade(_config(migration_engine), "0016")
    inspector = inspect(migration_engine)
    columns = {
        column["name"]: column
        for column in inspector.get_columns("open_game_registrations")
    }
    assert list(columns) == [
        "id",
        "game_id",
        "applicant_user_id",
        "display_name",
        "position",
        "note",
        "status",
        "version",
        "consent_version",
        "adult_confirmed_at",
        "risk_confirmed_at",
        "applied_at",
        "decided_at",
        "decided_by_user_id",
        "created_at",
        "updated_at",
    ]
    assert {
        name for name, column in columns.items() if column["nullable"]
    } == {"note", "decided_at", "decided_by_user_id"}
    assert inspect(migration_engine).get_pk_constraint(
        "open_game_registrations"
    )["constrained_columns"] == ["id"]
    assert str(columns["id"]["type"]) == "UUID"
    assert str(columns["game_id"]["type"]) == "UUID"
    assert str(columns["applicant_user_id"]["type"]) == "UUID"
    assert str(columns["decided_by_user_id"]["type"]) == "UUID"
    assert isinstance(columns["display_name"]["type"], String)
    assert columns["display_name"]["type"].length == 24
    assert isinstance(columns["note"]["type"], String)
    assert columns["note"]["type"].length == 120
    assert isinstance(columns["version"]["type"], Integer)
    assert isinstance(columns["consent_version"]["type"], String)
    assert columns["consent_version"]["type"].length == 32
    assert columns["position"]["type"].name == "open_game_registration_position"
    assert columns["status"]["type"].name == "open_game_registration_status"
    for name in (
        "adult_confirmed_at",
        "risk_confirmed_at",
        "applied_at",
        "decided_at",
        "created_at",
        "updated_at",
    ):
        assert isinstance(columns[name]["type"], DateTime)
        assert columns[name]["type"].timezone is True
    assert str(columns["created_at"]["default"]).lower() == "now()"
    assert str(columns["updated_at"]["default"]).lower() == "now()"

    foreign_keys = {
        item["name"]: item
        for item in inspector.get_foreign_keys("open_game_registrations")
    }
    assert set(foreign_keys) == {
        "fk_open_game_registrations_game_id_open_games",
        "fk_open_game_registrations_applicant_user_id_users",
        "fk_open_game_registrations_decided_by_user_id_users",
    }
    assert foreign_keys["fk_open_game_registrations_game_id_open_games"][
        "constrained_columns"
    ] == ["game_id"]
    assert foreign_keys["fk_open_game_registrations_game_id_open_games"][
        "referred_table"
    ] == "open_games"
    assert foreign_keys[
        "fk_open_game_registrations_applicant_user_id_users"
    ]["constrained_columns"] == ["applicant_user_id"]
    assert foreign_keys[
        "fk_open_game_registrations_decided_by_user_id_users"
    ]["constrained_columns"] == ["decided_by_user_id"]
    for foreign_key in foreign_keys.values():
        assert foreign_key["referred_columns"] == ["id"]
        assert foreign_key["options"]["ondelete"] == "RESTRICT"

    assert {
        item["name"]
        for item in inspector.get_check_constraints("open_game_registrations")
    } == {
        "ck_open_game_registrations_display_name",
        "ck_open_game_registrations_note",
        "ck_open_game_registrations_version",
        "ck_open_game_registrations_consent_version",
        "ck_open_game_registrations_decision_pair",
        "ck_open_game_registrations_decision_time",
    }
    unique_constraints = {
        item["name"]: item["column_names"]
        for item in inspector.get_unique_constraints("open_game_registrations")
    }
    assert unique_constraints == {
        "uq_open_game_registrations_game_applicant": [
            "game_id",
            "applicant_user_id",
        ]
    }
    pending_index = next(
        item
        for item in inspector.get_indexes("open_game_registrations")
        if item["name"] == "ix_open_game_registrations_pending"
    )
    assert pending_index["unique"] is False
    assert pending_index["column_names"] == ["game_id", "status", "applied_at", "id"]
    with migration_engine.connect() as connection:
        predicate = connection.execute(
            text(
                "SELECT pg_get_expr(definition.indpred, definition.indrelid) "
                "FROM pg_index AS definition "
                "JOIN pg_class AS index_relation "
                "ON index_relation.oid = definition.indexrelid "
                "JOIN pg_namespace AS namespace "
                "ON namespace.oid = index_relation.relnamespace "
                "WHERE index_relation.relname = :index_name "
                "AND namespace.nspname = current_schema()"
            ),
            {"index_name": "ix_open_game_registrations_pending"},
        ).scalar_one()
    assert predicate == "(status = 'APPLIED'::open_game_registration_status)"
    assert {
        item["name"]
        for item in inspector.get_indexes("open_game_registrations")
        if item["name"].startswith("ix_open_game_registrations")
    } == {"ix_open_game_registrations_pending"}


def test_open_game_registration_duplicate_game_applicant_is_rejected(
    migration_engine: Engine,
) -> None:
    command.upgrade(_config(migration_engine), "0016")
    _, game_id, applicant_ids = _seed_registration_parents(migration_engine)
    first = _valid_registration(
        registration_id=UUID("30000000-0000-0000-0000-000000000051"),
        game_id=game_id,
        applicant_user_id=applicant_ids[0],
    )
    _insert_registration(migration_engine, first)

    with pytest.raises(DBAPIError):
        _insert_registration(
            migration_engine,
            {
                **first,
                "id": UUID("30000000-0000-0000-0000-000000000052"),
            },
        )


def test_open_game_registration_accepts_valid_decision_matrix(
    migration_engine: Engine,
) -> None:
    command.upgrade(_config(migration_engine), "0016")
    captain_id, game_id, applicant_ids = _seed_registration_parents(migration_engine)
    applied_at = datetime(2026, 8, 24, 12, 2, tzinfo=UTC)
    cases = (
        ("APPLIED", None, None),
        ("JOINED", applied_at, captain_id),
        ("REJECTED", applied_at + timedelta(minutes=1), captain_id),
    )
    for index, (status, decided_at, decided_by_user_id) in enumerate(cases, start=1):
        _insert_registration(
            migration_engine,
            {
                **_valid_registration(
                    registration_id=UUID(
                        f"30000000-0000-0000-0000-{60 + index:012d}"
                    ),
                    game_id=game_id,
                    applicant_user_id=applicant_ids[index - 1],
                ),
                "status": status,
                "decided_at": decided_at,
                "decided_by_user_id": decided_by_user_id,
            },
        )

    with migration_engine.connect() as connection:
        assert connection.execute(
            text("SELECT count(*) FROM open_game_registrations")
        ).scalar_one() == 3


def test_open_game_registration_rejects_invalid_decision_matrix(
    migration_engine: Engine,
) -> None:
    command.upgrade(_config(migration_engine), "0016")
    captain_id, game_id, applicant_ids = _seed_registration_parents(migration_engine)
    base = _valid_registration(
        registration_id=UUID("30000000-0000-0000-0000-000000000071"),
        game_id=game_id,
        applicant_user_id=applicant_ids[0],
    )
    applied_at = base["applied_at"]
    assert isinstance(applied_at, datetime)
    cases = (
        ("APPLIED", applied_at, captain_id),
        ("APPLIED", applied_at, None),
        ("APPLIED", None, captain_id),
        ("JOINED", None, None),
        ("JOINED", applied_at, None),
        ("JOINED", None, captain_id),
        ("REJECTED", None, None),
        ("REJECTED", applied_at, None),
        ("REJECTED", None, captain_id),
        ("JOINED", applied_at - timedelta(seconds=1), captain_id),
        ("REJECTED", applied_at - timedelta(seconds=1), captain_id),
    )
    for status, decided_at, decided_by_user_id in cases:
        with pytest.raises(DBAPIError):
            _insert_registration(
                migration_engine,
                {
                    **base,
                    "status": status,
                    "decided_at": decided_at,
                    "decided_by_user_id": decided_by_user_id,
                },
            )


def test_open_game_registration_rejects_invalid_text_and_version_values(
    migration_engine: Engine,
) -> None:
    command.upgrade(_config(migration_engine), "0016")
    _, game_id, applicant_ids = _seed_registration_parents(migration_engine)
    base = _valid_registration(
        registration_id=UUID("30000000-0000-0000-0000-000000000081"),
        game_id=game_id,
        applicant_user_id=applicant_ids[0],
    )
    invalid_changes = (
        {"display_name": ""},
        {"display_name": "甲"},
        {"display_name": " 球员"},
        {"display_name": "球员 "},
        {"display_name": "球" * 25},
        {"note": ""},
        {"note": " 到场"},
        {"note": "到场 "},
        {"note": "球" * 121},
        {"version": 0},
        {"consent_version": ""},
        {"consent_version": " c1a"},
        {"consent_version": "c1a "},
        {"consent_version": "c" * 33},
    )
    for changes in invalid_changes:
        with pytest.raises(DBAPIError):
            _insert_registration(migration_engine, {**base, **changes})


def test_open_game_registration_model_matches_persistence_contract() -> None:
    assert models.OpenGameRegistrationPosition.__members__ == {
        "GOALKEEPER": models.OpenGameRegistrationPosition.GOALKEEPER,
        "DEFENDER": models.OpenGameRegistrationPosition.DEFENDER,
        "MIDFIELDER": models.OpenGameRegistrationPosition.MIDFIELDER,
        "FORWARD": models.OpenGameRegistrationPosition.FORWARD,
        "ANY": models.OpenGameRegistrationPosition.ANY,
    }
    assert models.OpenGameRegistrationStatus.__members__ == {
        "APPLIED": models.OpenGameRegistrationStatus.APPLIED,
        "WAITLISTED": models.OpenGameRegistrationStatus.WAITLISTED,
        "JOINED": models.OpenGameRegistrationStatus.JOINED,
        "REJECTED": models.OpenGameRegistrationStatus.REJECTED,
        "WITHDRAWN": models.OpenGameRegistrationStatus.WITHDRAWN,
        "REMOVED": models.OpenGameRegistrationStatus.REMOVED,
    }
    assert models.OpenGameAttendanceStatus.__members__ == {
        "UNMARKED": models.OpenGameAttendanceStatus.UNMARKED,
        "PRESENT": models.OpenGameAttendanceStatus.PRESENT,
        "NO_SHOW": models.OpenGameAttendanceStatus.NO_SHOW,
    }
    assert models.OpenGameRegistrationWithdrawalKind.__members__ == {
        "APPLICATION_WITHDRAWAL": (
            models.OpenGameRegistrationWithdrawalKind.APPLICATION_WITHDRAWAL
        ),
        "WAITLIST_WITHDRAWAL": (
            models.OpenGameRegistrationWithdrawalKind.WAITLIST_WITHDRAWAL
        ),
        "GAME_EXIT": models.OpenGameRegistrationWithdrawalKind.GAME_EXIT,
    }
    table = models.OpenGameRegistration.__table__
    assert list(table.c.keys()) == [
        "id",
        "game_id",
        "applicant_user_id",
        "display_name",
        "position",
        "note",
        "status",
        "attendance_status",
        "attendance_recorded_at",
        "attendance_recorded_by_user_id",
        "version",
        "consent_version",
        "adult_confirmed_at",
        "risk_confirmed_at",
        "applied_at",
        "decided_at",
        "decided_by_user_id",
        "withdrawn_at",
        "withdrawal_kind",
        "late_exit_recorded",
        "waitlist_seq",
        "waitlisted_at",
        "promoted_at",
        "removed_at",
        "removed_by_user_id",
        "created_at",
        "updated_at",
    ]
    assert {column.name for column in table.c if column.nullable} == {
        "note",
        "attendance_recorded_at",
        "attendance_recorded_by_user_id",
        "decided_at",
        "decided_by_user_id",
        "withdrawn_at",
        "withdrawal_kind",
        "waitlist_seq",
        "waitlisted_at",
        "promoted_at",
        "removed_at",
        "removed_by_user_id",
    }
    assert table.c.display_name.type.length == 24
    assert table.c.note.type.length == 120
    assert table.c.consent_version.type.length == 32
    assert table.c.position.type.name == "open_game_registration_position"
    assert table.c.status.type.name == "open_game_registration_status"
    attendance_status_type = table.c.attendance_status.type
    assert isinstance(attendance_status_type, SAEnum)
    assert attendance_status_type.name == "open_game_attendance_status"
    assert (
        table.c.attendance_status.default.arg
        == models.OpenGameAttendanceStatus.UNMARKED
    )
    assert str(table.c.attendance_status.server_default.arg) == "'UNMARKED'"
    attendance_recorded_at_type = table.c.attendance_recorded_at.type
    assert isinstance(attendance_recorded_at_type, DateTime)
    assert attendance_recorded_at_type.timezone is True
    assert "attendance_version" not in table.c
    assert (
        table.c.withdrawal_kind.type.name
        == "open_game_registration_withdrawal_kind"
    )
    assert str(table.c.late_exit_recorded.server_default.arg) == "false"
    assert table.c.created_at.server_default is not None
    assert str(table.c.created_at.server_default.arg) == "now()"
    assert table.c.updated_at.server_default is not None
    assert str(table.c.updated_at.server_default.arg) == "now()"
    assert table.c.updated_at.onupdate is not None
    assert str(table.c.updated_at.onupdate.arg) == "now()"
    assert {constraint.name for constraint in table.constraints} >= {
        "fk_open_game_registrations_game_id_open_games",
        "fk_open_game_registrations_applicant_user_id_users",
        "fk_open_game_registrations_decided_by_user_id_users",
        "fk_open_game_registrations_attendance_recorded_by_user_id_users",
        "fk_open_game_registrations_removed_by_user_id_users",
        "uq_open_game_registrations_game_applicant",
        "ck_open_game_registrations_display_name",
        "ck_open_game_registrations_note",
        "ck_open_game_registrations_version",
        "ck_open_game_registrations_consent_version",
        "ck_open_game_registrations_decision_pair",
        "ck_open_game_registrations_decision_time",
        "ck_open_game_registrations_withdrawal_pair",
        "ck_open_game_registrations_withdrawal_time",
        "ck_open_game_registrations_waitlist_seq",
        "ck_open_game_registrations_waitlist_history",
        "ck_open_game_registrations_waitlist_time",
        "ck_open_game_registrations_attendance_audit",
        "ck_open_game_registrations_attendance_joined",
        "ck_open_game_registrations_removal_pair",
        "ck_open_game_registrations_removal_time",
        "uq_open_game_registrations_game_waitlist_seq",
        "uq_open_game_registrations_outbox_identity",
    }
    pending_index = next(
        item
        for item in table.indexes
        if item.name == "ix_open_game_registrations_pending"
    )
    assert [column.name for column in pending_index.columns] == [
        "game_id",
        "status",
        "applied_at",
        "id",
    ]
    waitlist_index = next(
        item
        for item in table.indexes
        if item.name == "ix_open_game_registrations_active_waitlist"
    )
    assert [column.name for column in waitlist_index.columns] == [
        "game_id",
        "status",
        "waitlist_seq",
    ]
    relationships = {
        (models.User, "open_game_registrations"): (
            table.c.applicant_user_id,
            "applicant",
        ),
        (models.User, "decided_open_game_registrations"): (
            table.c.decided_by_user_id,
            "decided_by",
        ),
        (models.OpenGame, "registrations"): (table.c.game_id, "game"),
        (models.OpenGameRegistration, "game"): (table.c.game_id, "registrations"),
        (models.OpenGameRegistration, "applicant"): (
            table.c.applicant_user_id,
            "open_game_registrations",
        ),
        (models.OpenGameRegistration, "decided_by"): (
            table.c.decided_by_user_id,
            "decided_open_game_registrations",
        ),
    }
    for (model, name), (foreign_key, back_populates) in relationships.items():
        relationship = model.__mapper__.relationships[name]
        assert relationship._user_defined_foreign_keys == {foreign_key}
        assert relationship.back_populates == back_populates


def test_open_game_notification_outbox_model_matches_persistence_contract() -> None:
    assert models.OpenGameNotificationEvent.__members__ == {
        "WAITLIST_PROMOTED": models.OpenGameNotificationEvent.WAITLIST_PROMOTED,
    }
    assert models.OpenGameNotificationStatus.__members__ == {
        "PENDING": models.OpenGameNotificationStatus.PENDING,
        "CLAIMED": models.OpenGameNotificationStatus.CLAIMED,
        "SENT": models.OpenGameNotificationStatus.SENT,
        "FAILED": models.OpenGameNotificationStatus.FAILED,
        "SUPERSEDED": models.OpenGameNotificationStatus.SUPERSEDED,
    }
    table = models.OpenGameNotificationOutbox.__table__
    assert list(table.c.keys()) == [
        "id",
        "dedupe_key",
        "game_id",
        "registration_id",
        "recipient_user_id",
        "event",
        "template_key",
        "status",
        "payload",
        "attempt_count",
        "available_at",
        "claim_token",
        "lease_until",
        "created_at",
        "delivery_started_at",
        "completed_at",
        "last_failure_code",
    ]
    assert {column.name for column in table.c if column.nullable} == {
        "claim_token",
        "lease_until",
        "delivery_started_at",
        "completed_at",
        "last_failure_code",
    }
    assert table.c.dedupe_key.type.length == 200
    assert table.c.template_key.type.length == 64
    assert table.c.last_failure_code.type.length == 64
    assert table.c.event.type.name == "open_game_notification_event"
    assert table.c.status.type.name == "open_game_notification_status"
    assert str(table.c.created_at.server_default.arg) == "now()"
    assert {constraint.name for constraint in table.constraints} >= {
        "pk_open_game_notification_outbox",
        "uq_open_game_notification_outbox_dedupe_key",
        "fk_open_game_notification_outbox_game_id_open_games",
        "fk_open_game_notification_outbox_registration",
        "fk_open_game_notification_outbox_recipient_user_id_users",
        "fk_open_game_notification_outbox_registration_identity",
        "ck_open_game_notification_outbox_dedupe_key",
        "ck_open_game_notification_outbox_template_key",
        "ck_open_game_notification_outbox_payload_object",
        "ck_open_game_notification_outbox_payload_waitlist_promoted",
        "ck_open_game_notification_outbox_attempt_count",
        "ck_open_game_notification_outbox_claim_lease",
        "ck_open_game_notification_outbox_completion",
        "ck_open_game_notification_outbox_failure_code",
        "ck_open_game_notification_outbox_delivery_start",
    }
    due_index = next(
        item
        for item in table.indexes
        if item.name == "ix_open_game_notification_outbox_due"
    )
    assert [column.name for column in due_index.columns] == [
        "available_at",
        "id",
    ]


def test_open_game_registration_migration_matches_model_metadata(
    migration_engine: Engine,
) -> None:
    config = _config(migration_engine)
    command.upgrade(config, "head")
    with migration_engine.connect() as connection:
        assert connection.execute(
            text("SELECT version_num FROM alembic_version")
        ).scalar_one() == "0024"

    command.check(config)
