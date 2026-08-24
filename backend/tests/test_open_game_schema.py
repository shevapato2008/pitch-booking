from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, create_engine, inspect, text
from sqlalchemy.exc import DBAPIError

from backend.app import models
from backend.tests.postgres_test_database import (
    disposable_database,
    override_test_database_url,
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


def _seed_booking_parents(engine: Engine) -> tuple[UUID, UUID]:
    captain_id = UUID("20000000-0000-0000-0000-000000000001")
    order_id = UUID("20000000-0000-0000-0000-000000000004")
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO venues "
                "(id, slug, name, description, price_advantage_text, timezone, "
                "business_hours_text, address, district_code, district_name, parking_text, "
                "phone, refund_policy_text, latitude, longitude, booking_mode, "
                "navigation_poi_name, navigation_latitude, navigation_longitude, sort_order, "
                "content_verified_at, is_listed, public_pitch_types, is_primary, is_active) "
                "VALUES "
                "('20000000-0000-0000-0000-000000000010', 'open-game-venue', "
                "'Open Game Venue', '', 'price', 'Asia/Shanghai', 'hours', 'address', "
                "'120111', '西青区', 'parking', 'phone', 'refund', 31, 121, 'ONLINE', "
                "'Open Game Venue', 31, 121, 0, now(), true, "
                "'[\"FIVE_A_SIDE\"]'::jsonb, false, true)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO pitches "
                "(id, venue_id, code, name, pitch_type, sort_order, players_per_side, "
                "system_name, sequence, status) "
                "VALUES ('20000000-0000-0000-0000-000000000011', "
                "'20000000-0000-0000-0000-000000000010', 'P1', 'Pitch 1', "
                "'FIVE_A_SIDE', 0, 5, '5人制A场', 1, 'ACTIVE')"
            )
        )
        connection.execute(
            text(
                "INSERT INTO slots "
                "(id, pitch_id, starts_at, ends_at, status, price_cents, "
                "checkout_version, locked_until, locked_by_order_id) VALUES "
                "('20000000-0000-0000-0000-000000000012', "
                "'20000000-0000-0000-0000-000000000011', "
                "'2026-09-01T12:00:00Z', '2026-09-01T13:00:00Z', "
                "'BOOKED', 36000, 1, NULL, NULL)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO users "
                "(id, wechat_app_id, wechat_openid, created_at) VALUES "
                "(:captain_id, 'wx-open-game', 'captain-openid', now())"
            ),
            {"captain_id": captain_id},
        )
        connection.execute(
            text(
                "INSERT INTO orders "
                "(id, order_number, user_id, slot_id, status, price_cents, contact_name, "
                "contact_phone_ciphertext, contact_phone_nonce, contact_phone_key_version, "
                "created_at, expires_at) VALUES "
                "(:order_id, 'PB-OPEN-GAME', :captain_id, "
                "'20000000-0000-0000-0000-000000000012', 'CONFIRMED', 36000, "
                "'Captain', decode('00112233445566778899aabbccddeeff', 'hex'), "
                "decode('00112233445566778899aabb', 'hex'), 1, "
                "'2026-08-22T00:00:00Z', '2026-08-22T00:15:00Z')"
            ),
            {"order_id": order_id, "captain_id": captain_id},
        )
    return captain_id, order_id


def _insert_team(
    engine: Engine,
    *,
    team_id: UUID,
    captain_id: UUID,
    name: str = "逐光队",
    name_key: str = "逐光队",
) -> None:
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO teams (id, captain_user_id, name, name_key) "
                "VALUES (:id, :captain_user_id, :name, :name_key)"
            ),
            {
                "id": team_id,
                "captain_user_id": captain_id,
                "name": name,
                "name_key": name_key,
            },
        )


def _valid_game(
    *,
    game_id: UUID,
    order_id: UUID,
    team_id: UUID,
    share_token: str,
) -> dict[str, object]:
    return {
        "id": game_id,
        "order_id": order_id,
        "team_id": team_id,
        "name": "周六友谊赛",
        "total_players": 10,
        "fixed_players": 5,
        "open_spots": 5,
        "intensity": "CASUAL",
        "minimum_experience": "有基础传接球经验",
        "position_mask": 0,
        "aa_cents": 3600,
        "registration_deadline": datetime(2026, 9, 1, 8, tzinfo=UTC),
        "equipment_and_arrival_notes": "请提前十分钟到场",
        "visibility": "PUBLIC",
        "status": "DRAFT",
        "version": 1,
        "share_token": share_token,
        "published_at": None,
        "cancelled_at": None,
    }


def _insert_game(engine: Engine, values: dict[str, object]) -> None:
    columns = ", ".join(values)
    parameters = ", ".join(f":{key}" for key in values)
    with engine.begin() as connection:
        connection.execute(
            text(f"INSERT INTO open_games ({columns}) VALUES ({parameters})"),
            values,
        )


def test_open_game_migration_upgrades_downgrades_and_reupgrades(
    migration_engine: Engine,
) -> None:
    config = _config(migration_engine)
    command.upgrade(config, "0014")
    assert {"teams", "open_games"}.isdisjoint(
        inspect(migration_engine).get_table_names()
    )

    command.upgrade(config, "0015")

    inspector = inspect(migration_engine)
    assert {"teams", "open_games"} <= set(inspector.get_table_names())
    assert {column["name"] for column in inspector.get_columns("teams")} == {
        "id",
        "captain_user_id",
        "name",
        "name_key",
        "created_at",
        "updated_at",
    }
    assert {column["name"] for column in inspector.get_columns("open_games")} == {
        "id",
        "order_id",
        "team_id",
        "name",
        "total_players",
        "fixed_players",
        "open_spots",
        "intensity",
        "minimum_experience",
        "position_mask",
        "aa_cents",
        "registration_deadline",
        "equipment_and_arrival_notes",
        "visibility",
        "status",
        "version",
        "share_token",
        "published_at",
        "cancelled_at",
        "created_at",
        "updated_at",
    }
    assert _enum_labels(migration_engine, "open_game_status") == [
        "DRAFT",
        "PUBLISHED",
        "CANCELLED",
    ]
    assert _enum_labels(migration_engine, "open_game_visibility") == [
        "PUBLIC",
        "LINK_ONLY",
    ]
    assert _enum_labels(migration_engine, "open_game_intensity") == [
        "BEGINNER_FRIENDLY",
        "CASUAL",
        "COMPETITIVE",
    ]
    assert {
        constraint["name"]: constraint["column_names"]
        for constraint in inspector.get_unique_constraints("teams")
    }["uq_teams_captain_name_key"] == ["captain_user_id", "name_key"]
    assert {
        constraint["name"]: constraint["column_names"]
        for constraint in inspector.get_unique_constraints("open_games")
    }["uq_open_games_share_token"] == ["share_token"]
    foreign_keys = {
        item["name"]: item for table in ("teams", "open_games")
        for item in inspector.get_foreign_keys(table)
    }
    assert foreign_keys["fk_teams_captain_user_id_users"]["options"]["ondelete"] == "RESTRICT"
    assert foreign_keys["fk_open_games_order_id_orders"]["options"]["ondelete"] == "RESTRICT"
    assert foreign_keys["fk_open_games_team_id_teams"]["options"]["ondelete"] == "RESTRICT"
    active_index = next(
        index
        for index in inspector.get_indexes("open_games")
        if index["name"] == "uq_open_games_one_active_per_order"
    )
    assert active_index["unique"] is True
    assert active_index["column_names"] == ["order_id"]
    predicate = str(active_index["dialect_options"]["postgresql_where"]).upper()
    assert "STATUS" in predicate and "CANCELLED" in predicate and "<>" in predicate

    command.downgrade(config, "0014")
    assert {"teams", "open_games"}.isdisjoint(
        inspect(migration_engine).get_table_names()
    )
    for enum_name in (
        "open_game_status",
        "open_game_visibility",
        "open_game_intensity",
    ):
        assert _enum_labels(migration_engine, enum_name) == []

    command.upgrade(config, "0015")
    with migration_engine.connect() as connection:
        assert connection.execute(
            text("SELECT version_num FROM alembic_version")
        ).scalar_one() == "0015"


@pytest.mark.parametrize(
    ("name", "name_key"),
    [
        ("", "team"),
        (" 逐光队", "team"),
        ("逐光队 ", "team"),
        ("逐" * 25, "team"),
        ("逐光队", ""),
        ("逐光队", " team"),
        ("逐光队", "team "),
        ("逐光队", "t" * 65),
    ],
)
def test_team_constraints_reject_untrimmed_or_out_of_range_names(
    migration_engine: Engine,
    name: str,
    name_key: str,
) -> None:
    command.upgrade(_config(migration_engine), "0015")
    captain_id, _ = _seed_booking_parents(migration_engine)

    with pytest.raises(DBAPIError):
        _insert_team(
            migration_engine,
            team_id=UUID("20000000-0000-0000-0000-000000000020"),
            captain_id=captain_id,
            name=name,
            name_key=name_key,
        )


def test_team_name_key_is_unique_per_captain(migration_engine: Engine) -> None:
    command.upgrade(_config(migration_engine), "0015")
    captain_id, _ = _seed_booking_parents(migration_engine)
    _insert_team(
        migration_engine,
        team_id=UUID("20000000-0000-0000-0000-000000000020"),
        captain_id=captain_id,
    )

    with pytest.raises(DBAPIError):
        _insert_team(
            migration_engine,
            team_id=UUID("20000000-0000-0000-0000-000000000021"),
            captain_id=captain_id,
            name="另一支队",
        )


@pytest.mark.parametrize(
    "changes",
    [
        {"name": ""},
        {"name": " 周六友谊赛"},
        {"name": "周" * 31},
        {"total_players": 3},
        {"total_players": 31},
        {"fixed_players": 0},
        {"open_spots": 0},
        {"fixed_players": 6, "open_spots": 5},
        {"position_mask": -1},
        {"position_mask": 16},
        {"aa_cents": -1},
        {"version": 0},
        {"minimum_experience": " "},
        {"minimum_experience": "x" * 61},
        {"equipment_and_arrival_notes": " notes"},
        {"equipment_and_arrival_notes": "x" * 201},
        {"share_token": " token"},
        {"share_token": "x" * 65},
    ],
)
def test_open_game_constraints_reject_invalid_values(
    migration_engine: Engine,
    changes: dict[str, object],
) -> None:
    command.upgrade(_config(migration_engine), "0015")
    captain_id, order_id = _seed_booking_parents(migration_engine)
    team_id = UUID("20000000-0000-0000-0000-000000000020")
    _insert_team(migration_engine, team_id=team_id, captain_id=captain_id)
    values = _valid_game(
        game_id=UUID("20000000-0000-0000-0000-000000000030"),
        order_id=order_id,
        team_id=team_id,
        share_token="game-token",
    )

    with pytest.raises(DBAPIError):
        _insert_game(migration_engine, {**values, **changes})


@pytest.mark.parametrize(
    ("status", "published_at", "cancelled_at"),
    [
        ("DRAFT", datetime(2026, 8, 22, tzinfo=UTC), None),
        ("DRAFT", None, datetime(2026, 8, 22, tzinfo=UTC)),
        ("PUBLISHED", None, None),
        (
            "PUBLISHED",
            datetime(2026, 8, 22, tzinfo=UTC),
            datetime(2026, 8, 22, tzinfo=UTC),
        ),
        ("CANCELLED", None, None),
        (
            "CANCELLED",
            datetime(2026, 8, 22, 1, tzinfo=UTC),
            datetime(2026, 8, 22, tzinfo=UTC),
        ),
    ],
)
def test_open_game_timestamp_matrix_rejects_invalid_states(
    migration_engine: Engine,
    status: str,
    published_at: datetime | None,
    cancelled_at: datetime | None,
) -> None:
    command.upgrade(_config(migration_engine), "0015")
    captain_id, order_id = _seed_booking_parents(migration_engine)
    team_id = UUID("20000000-0000-0000-0000-000000000020")
    _insert_team(migration_engine, team_id=team_id, captain_id=captain_id)
    values = _valid_game(
        game_id=UUID("20000000-0000-0000-0000-000000000030"),
        order_id=order_id,
        team_id=team_id,
        share_token="timestamp-token",
    )

    with pytest.raises(DBAPIError):
        _insert_game(
            migration_engine,
            {
                **values,
                "status": status,
                "published_at": published_at,
                "cancelled_at": cancelled_at,
            },
        )


@pytest.mark.parametrize(
    ("status", "published_at", "cancelled_at"),
    [
        ("DRAFT", None, None),
        ("PUBLISHED", datetime(2026, 8, 22, tzinfo=UTC), None),
        ("CANCELLED", None, datetime(2026, 8, 22, tzinfo=UTC)),
        (
            "CANCELLED",
            datetime(2026, 8, 22, tzinfo=UTC),
            datetime(2026, 8, 22, tzinfo=UTC) + timedelta(seconds=1),
        ),
    ],
)
def test_open_game_timestamp_matrix_accepts_valid_states(
    migration_engine: Engine,
    status: str,
    published_at: datetime | None,
    cancelled_at: datetime | None,
) -> None:
    command.upgrade(_config(migration_engine), "0015")
    captain_id, order_id = _seed_booking_parents(migration_engine)
    team_id = UUID("20000000-0000-0000-0000-000000000020")
    _insert_team(migration_engine, team_id=team_id, captain_id=captain_id)
    values = _valid_game(
        game_id=UUID("20000000-0000-0000-0000-000000000030"),
        order_id=order_id,
        team_id=team_id,
        share_token="valid-timestamp-token",
    )

    _insert_game(
        migration_engine,
        {
            **values,
            "status": status,
            "published_at": published_at,
            "cancelled_at": cancelled_at,
        },
    )


def test_open_game_unique_constraints_distinguish_active_and_cancelled_games(
    migration_engine: Engine,
) -> None:
    command.upgrade(_config(migration_engine), "0015")
    captain_id, order_id = _seed_booking_parents(migration_engine)
    team_id = UUID("20000000-0000-0000-0000-000000000020")
    _insert_team(migration_engine, team_id=team_id, captain_id=captain_id)
    first = _valid_game(
        game_id=UUID("20000000-0000-0000-0000-000000000030"),
        order_id=order_id,
        team_id=team_id,
        share_token="first-token",
    )
    _insert_game(migration_engine, first)

    with pytest.raises(DBAPIError):
        _insert_game(
            migration_engine,
            {
                **first,
                "id": UUID("20000000-0000-0000-0000-000000000031"),
                "share_token": "second-token",
            },
        )
    with pytest.raises(DBAPIError):
        _insert_game(
            migration_engine,
            {
                **first,
                "id": UUID("20000000-0000-0000-0000-000000000032"),
                "status": "CANCELLED",
                "cancelled_at": datetime(2026, 8, 22, tzinfo=UTC),
            },
        )

    with migration_engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE open_games SET status = 'CANCELLED', cancelled_at = now() "
                "WHERE id = :id"
            ),
            {"id": first["id"]},
        )
    _insert_game(
        migration_engine,
        {
            **first,
            "id": UUID("20000000-0000-0000-0000-000000000033"),
            "share_token": "replacement-token",
        },
    )


def test_open_game_models_match_persistence_contract() -> None:
    assert set(models.Team.__mapper__.relationships.keys()) == {"open_games"}
    assert set(models.OpenGame.__mapper__.relationships.keys()) == {
        "order",
        "team",
        "registrations",
    }
    assert set(models.User.__mapper__.relationships.keys()) >= {
        "teams",
        "open_game_registrations",
        "decided_open_game_registrations",
    }
    assert models.User.__mapper__.relationships[
        "open_game_registrations"
    ]._user_defined_foreign_keys == {
        models.OpenGameRegistration.__table__.c.applicant_user_id
    }
    assert models.User.__mapper__.relationships[
        "decided_open_game_registrations"
    ]._user_defined_foreign_keys == {
        models.OpenGameRegistration.__table__.c.decided_by_user_id
    }
    assert set(models.Order.__mapper__.relationships.keys()) >= {"open_games"}
    assert "captain" not in models.OpenGame.__mapper__.relationships.keys()
    assert models.OpenGameStatus.__members__ == {
        "DRAFT": models.OpenGameStatus.DRAFT,
        "PUBLISHED": models.OpenGameStatus.PUBLISHED,
        "CANCELLED": models.OpenGameStatus.CANCELLED,
    }
