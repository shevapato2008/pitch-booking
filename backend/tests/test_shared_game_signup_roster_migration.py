from collections.abc import Iterator
from datetime import UTC, datetime
from uuid import UUID

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

from backend.tests.postgres_test_database import (
    disposable_database,
    override_test_database_url,
)
from backend.tests.test_open_game_member_removal_migration import (
    REGISTRATION_ID,
    REMOVED_AT,
    _insert_removal,
    _seed_joined,
    _valid_removal,
)
from backend.tests.test_open_game_registration_schema import (
    _insert_registration,
    _seed_registration_parents,
    _valid_registration,
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
    config.set_main_option(
        "sqlalchemy.url",
        engine.url.render_as_string(hide_password=False),
    )
    return config


def _publish_for_future_signup(engine: Engine, *, game_id: UUID) -> None:
    with engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE open_games SET status = 'PUBLISHED', "
                "published_at = CURRENT_TIMESTAMP - interval '1 hour', "
                "registration_deadline = CURRENT_TIMESTAMP + interval '1 day' "
                "WHERE id = :game_id"
            ),
            {"game_id": game_id},
        )
        connection.execute(
            text(
                "UPDATE slots SET "
                "starts_at = CURRENT_DATE + interval '2 days 4 hours', "
                "ends_at = CURRENT_DATE + interval '2 days 5 hours' "
                "WHERE id = (SELECT orders.slot_id FROM orders "
                "JOIN open_games ON open_games.order_id = orders.id "
                "WHERE open_games.id = :game_id)"
            ),
            {"game_id": game_id},
        )


def test_0028_allows_single_character_direct_signup_names_and_guards_downgrade(
    migration_engine: Engine,
) -> None:
    config = _config(migration_engine)
    command.upgrade(config, "0027")
    captain_id, game_id, applicant_ids = _seed_registration_parents(migration_engine)
    joined_id = UUID("30000000-0000-0000-0000-000000000068")
    waitlisted_id = UUID("30000000-0000-0000-0000-000000000069")
    applied_id = UUID("30000000-0000-0000-0000-00000000006a")
    joined = _valid_registration(
        registration_id=joined_id,
        game_id=game_id,
        applicant_user_id=applicant_ids[0],
    ) | {
        "display_name": "甲",
        "status": "JOINED",
        "decided_at": datetime(2026, 8, 24, 12, 2, tzinfo=UTC),
        "decided_by_user_id": captain_id,
    }
    waitlisted = _valid_registration(
        registration_id=waitlisted_id,
        game_id=game_id,
        applicant_user_id=applicant_ids[1],
    ) | {
        "display_name": "乙",
        "status": "WAITLISTED",
        "decided_at": datetime(2026, 8, 24, 12, 2, tzinfo=UTC),
        "decided_by_user_id": captain_id,
        "waitlist_seq": 1,
        "waitlisted_at": datetime(2026, 8, 24, 12, 2, tzinfo=UTC),
    }
    legacy_applied = _valid_registration(
        registration_id=applied_id,
        game_id=game_id,
        applicant_user_id=applicant_ids[2],
    ) | {"display_name": "丙"}

    with pytest.raises(IntegrityError):
        _insert_registration(migration_engine, joined)

    command.upgrade(config, "0028")
    _insert_registration(migration_engine, joined)
    _insert_registration(migration_engine, waitlisted)
    with pytest.raises(IntegrityError):
        _insert_registration(migration_engine, legacy_applied)
    with migration_engine.connect() as connection:
        assert connection.execute(
            text(
                "SELECT display_name, status::text "
                "FROM open_game_registrations "
                "WHERE id IN (:joined_id, :waitlisted_id) ORDER BY id"
            ),
            {"joined_id": joined_id, "waitlisted_id": waitlisted_id},
        ).all() == [("甲", "JOINED"), ("乙", "WAITLISTED")]

    with pytest.raises(
        RuntimeError,
        match="single-character registration names exist",
    ):
        command.downgrade(config, "0027")

    with migration_engine.begin() as connection:
        connection.execute(
            text(
                "DELETE FROM open_game_registrations "
                "WHERE id IN (:joined_id, :waitlisted_id)"
            ),
            {"joined_id": joined_id, "waitlisted_id": waitlisted_id},
        )
    command.downgrade(config, "0027")
    with pytest.raises(IntegrityError):
        _insert_registration(migration_engine, joined)


def test_0029_allows_confirmed_avatarless_profiles_and_guards_downgrade(
    migration_engine: Engine,
) -> None:
    config = _config(migration_engine)
    command.upgrade(config, "0028")
    user_id = UUID("30000000-0000-0000-0000-00000000006b")
    with migration_engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO users (id, wechat_app_id, wechat_openid, created_at) "
                "VALUES (:id, 'wx-registration', 'avatarless-profile', now())"
            ),
            {"id": user_id},
        )

    confirmation = text(
        "UPDATE users SET public_nickname = '微信用户', "
        "public_avatar_object_key = NULL, "
        "public_profile_updated_at = CURRENT_TIMESTAMP, "
        "public_profile_version = 1 WHERE id = :id"
    )
    with pytest.raises(IntegrityError):
        with migration_engine.begin() as connection:
            connection.execute(confirmation, {"id": user_id})

    command.upgrade(config, "0029")
    with migration_engine.begin() as connection:
        connection.execute(confirmation, {"id": user_id})
    with migration_engine.connect() as connection:
        assert connection.execute(
            text(
                "SELECT public_nickname, public_avatar_object_key, "
                "public_profile_version, public_profile_updated_at IS NOT NULL "
                "FROM users WHERE id = :id"
            ),
            {"id": user_id},
        ).one() == ("微信用户", None, 1, True)

    with pytest.raises(RuntimeError, match="avatarless confirmed public profiles exist"):
        command.downgrade(config, "0028")

    with migration_engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE users SET public_nickname = NULL, "
                "public_profile_updated_at = NULL, public_profile_version = 0 "
                "WHERE id = :id"
            ),
            {"id": user_id},
        )
    command.downgrade(config, "0028")
    with pytest.raises(IntegrityError):
        with migration_engine.begin() as connection:
            connection.execute(confirmation, {"id": user_id})


def test_shared_signup_roster_schema_persists_public_profiles_and_reapply_blocks(
    pg_engine: Engine,
) -> None:
    inspector = inspect(pg_engine)
    user_columns = {column["name"]: column for column in inspector.get_columns("users")}
    registration_columns = {
        column["name"]: column for column in inspector.get_columns("open_game_registrations")
    }

    assert {
        "public_nickname",
        "public_avatar_object_key",
        "public_profile_updated_at",
        "public_profile_version",
    } <= user_columns.keys()
    assert user_columns["public_nickname"]["nullable"] is True
    assert user_columns["public_avatar_object_key"]["nullable"] is True
    assert user_columns["public_profile_updated_at"]["nullable"] is True
    assert user_columns["public_profile_version"]["nullable"] is False

    assert "reapply_blocked" in registration_columns
    assert registration_columns["reapply_blocked"]["nullable"] is False

    removal_uniques = {
        constraint["name"]: tuple(constraint["column_names"])
        for constraint in inspector.get_unique_constraints("open_game_member_removals")
    }
    assert "uq_open_game_member_removals_registration" not in removal_uniques
    assert removal_uniques["uq_open_game_member_removals_registration_version"] == (
        "registration_id",
        "registration_version_after",
    )


def test_0027_converts_legacy_applied_fifo_without_skipping_existing_waitlist(
    migration_engine: Engine,
) -> None:
    config = _config(migration_engine)
    command.upgrade(config, "0026")
    captain_id, game_id, applicant_ids = _seed_registration_parents(migration_engine)
    _publish_for_future_signup(migration_engine, game_id=game_id)
    applied_at = datetime(2026, 9, 1, 8, tzinfo=UTC)
    joined_id = UUID("30000000-0000-0000-0000-000000000060")
    waitlisted_id = UUID("30000000-0000-0000-0000-000000000061")
    first_applied_id = UUID("30000000-0000-0000-0000-000000000062")
    second_applied_id = UUID("30000000-0000-0000-0000-000000000063")
    extra_user_id = UUID("30000000-0000-0000-0000-000000000044")
    with migration_engine.begin() as connection:
        connection.execute(
            text("UPDATE open_games SET open_spots = 2 WHERE id = :game_id"),
            {"game_id": game_id},
        )
        connection.execute(
            text(
                "INSERT INTO users (id, wechat_app_id, wechat_openid, created_at) "
                "VALUES (:id, 'wx-registration', 'applicant-4', now())"
            ),
            {"id": extra_user_id},
        )

    _insert_registration(
        migration_engine,
        _valid_registration(
            registration_id=joined_id,
            game_id=game_id,
            applicant_user_id=applicant_ids[0],
        )
        | {
            "status": "JOINED",
            "version": 2,
            "applied_at": applied_at,
            "decided_at": applied_at,
            "decided_by_user_id": captain_id,
        },
    )
    _insert_registration(
        migration_engine,
        _valid_registration(
            registration_id=waitlisted_id,
            game_id=game_id,
            applicant_user_id=applicant_ids[1],
        )
        | {
            "status": "WAITLISTED",
            "version": 2,
            "applied_at": applied_at,
            "decided_at": applied_at,
            "decided_by_user_id": captain_id,
            "waitlist_seq": 7,
            "waitlisted_at": applied_at,
        },
    )
    for registration_id, applicant_user_id in (
        (second_applied_id, extra_user_id),
        (first_applied_id, applicant_ids[2]),
    ):
        _insert_registration(
            migration_engine,
            _valid_registration(
                registration_id=registration_id,
                game_id=game_id,
                applicant_user_id=applicant_user_id,
            )
            | {"applied_at": applied_at},
        )

    command.upgrade(config, "0027")

    with migration_engine.connect() as connection:
        rows = connection.execute(
            text(
                "SELECT id, status::text, version, applied_at, decided_at, "
                "decided_by_user_id, waitlist_seq, waitlisted_at, promoted_at "
                "FROM open_game_registrations "
                "WHERE id IN (:waitlisted_id, :first_id, :second_id) ORDER BY id"
            ),
            {
                "waitlisted_id": waitlisted_id,
                "first_id": first_applied_id,
                "second_id": second_applied_id,
            },
        ).mappings().all()

    assert [row["id"] for row in rows] == [
        waitlisted_id,
        first_applied_id,
        second_applied_id,
    ]
    assert rows[0]["status"] == "JOINED"
    assert rows[0]["version"] == 3
    assert rows[0]["waitlist_seq"] == 7
    assert rows[0]["waitlisted_at"] == applied_at
    assert rows[0]["promoted_at"] is not None
    assert rows[1] == {
        "id": first_applied_id,
        "status": "WAITLISTED",
        "version": 2,
        "applied_at": applied_at,
        "decided_at": applied_at,
        "decided_by_user_id": applicant_ids[2],
        "waitlist_seq": 8,
        "waitlisted_at": applied_at,
        "promoted_at": None,
    }
    assert rows[2] == {
        "id": second_applied_id,
        "status": "WAITLISTED",
        "version": 2,
        "applied_at": applied_at,
        "decided_at": applied_at,
        "decided_by_user_id": extra_user_id,
        "waitlist_seq": 9,
        "waitlisted_at": applied_at,
        "promoted_at": None,
    }


@pytest.mark.parametrize(
    "authority_update",
    (
        "UPDATE open_games SET status = 'DRAFT', published_at = NULL "
        "WHERE id = :game_id",
        "UPDATE open_games SET status = 'CANCELLED', "
        "cancelled_at = CURRENT_TIMESTAMP, cancellation_source = 'CAPTAIN' "
        "WHERE id = :game_id",
        "UPDATE orders SET status = 'COMPLETED', "
        "checked_in_at = CURRENT_TIMESTAMP - interval '2 hours', "
        "checked_in_by_user_id = orders.user_id, "
        "completed_at = CURRENT_TIMESTAMP - interval '1 hour', "
        "completed_by_user_id = orders.user_id "
        "WHERE id = (SELECT order_id FROM open_games WHERE id = :game_id)",
        "UPDATE orders SET cancel_requested_at = CURRENT_TIMESTAMP "
        "WHERE id = (SELECT order_id FROM open_games WHERE id = :game_id)",
        "WITH target_order AS (SELECT orders.id, orders.price_cents "
        "FROM orders JOIN open_games ON open_games.order_id = orders.id "
        "WHERE open_games.id = :game_id), inserted_payment AS ("
        "INSERT INTO payments (id, order_id, provider, merchant_order_no, "
        "provider_transaction_no, amount_cents, currency, status, paid_at, "
        "reconcile_attempts) SELECT "
        "'30000000-0000-0000-0000-000000000080', id, 'WECHAT_PAY', "
        "'PB-SIGNUP-MIGRATION', 'tx-signup-migration', price_cents, 'CNY', "
        "'SUCCESS', CURRENT_TIMESTAMP, 0 FROM target_order "
        "RETURNING id, order_id, amount_cents, currency) "
        "INSERT INTO refund_cases (id, order_id, payment_id, purpose, reason, "
        "reason_note, requested_by_user_id, amount_cents, currency) SELECT "
        "'30000000-0000-0000-0000-000000000081', order_id, id, "
        "'PAYMENT_INVENTORY_CONFLICT', 'AUTOMATIC_RECOVERY', NULL, NULL, "
        "amount_cents, currency FROM inserted_payment",
        "UPDATE open_games SET registration_deadline = CURRENT_TIMESTAMP "
        "WHERE id = :game_id",
        "UPDATE slots SET starts_at = '2000-01-01T12:00:00Z', "
        "ends_at = '2000-01-01T13:00:00Z' "
        "WHERE id = (SELECT orders.slot_id FROM orders "
        "JOIN open_games ON open_games.order_id = orders.id "
        "WHERE open_games.id = :game_id)",
    ),
    ids=(
        "draft",
        "cancelled",
        "completed",
        "suspended",
        "controlling-refund",
        "deadline-passed",
        "started",
    ),
)
def test_0027_leaves_legacy_queue_untouched_for_non_signup_games(
    migration_engine: Engine,
    authority_update: str,
) -> None:
    config = _config(migration_engine)
    command.upgrade(config, "0026")
    captain_id, game_id, applicant_ids = _seed_registration_parents(migration_engine)
    _publish_for_future_signup(migration_engine, game_id=game_id)
    applied_at = datetime(2026, 8, 24, 12, 2, tzinfo=UTC)
    waitlisted_id = UUID("30000000-0000-0000-0000-000000000070")
    applied_id = UUID("30000000-0000-0000-0000-000000000071")
    with migration_engine.begin() as connection:
        connection.execute(text(authority_update), {"game_id": game_id})

    _insert_registration(
        migration_engine,
        _valid_registration(
            registration_id=waitlisted_id,
            game_id=game_id,
            applicant_user_id=applicant_ids[0],
        )
        | {
            "status": "WAITLISTED",
            "version": 2,
            "decided_at": applied_at,
            "decided_by_user_id": captain_id,
            "waitlist_seq": 1,
            "waitlisted_at": applied_at,
        },
    )
    _insert_registration(
        migration_engine,
        _valid_registration(
            registration_id=applied_id,
            game_id=game_id,
            applicant_user_id=applicant_ids[1],
        ),
    )

    command.upgrade(config, "0027")

    with migration_engine.connect() as connection:
        rows = connection.execute(
            text(
                "SELECT id, status::text, version, decided_at, waitlist_seq, "
                "waitlisted_at, promoted_at FROM open_game_registrations "
                "WHERE id IN (:waitlisted_id, :applied_id) ORDER BY id"
            ),
            {"waitlisted_id": waitlisted_id, "applied_id": applied_id},
        ).mappings().all()

    assert rows == [
        {
            "id": waitlisted_id,
            "status": "WAITLISTED",
            "version": 2,
            "decided_at": applied_at,
            "waitlist_seq": 1,
            "waitlisted_at": applied_at,
            "promoted_at": None,
        },
        {
            "id": applied_id,
            "status": "APPLIED",
            "version": 1,
            "decided_at": None,
            "waitlist_seq": None,
            "waitlisted_at": None,
            "promoted_at": None,
        },
    ]


def test_0027_can_rollback_an_unchanged_legacy_removed_registration(
    migration_engine: Engine,
) -> None:
    config = _config(migration_engine)
    command.upgrade(config, "0026")
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

    command.upgrade(config, "0027")
    with migration_engine.connect() as connection:
        assert connection.execute(
            text(
                "SELECT reapply_blocked FROM open_game_registrations "
                "WHERE id = :registration_id"
            ),
            {"registration_id": REGISTRATION_ID},
        ).scalar_one() is True

    command.downgrade(config, "0026")

    assert "reapply_blocked" not in {
        column["name"]
        for column in inspect(migration_engine).get_columns("open_game_registrations")
    }
