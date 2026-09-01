from __future__ import annotations

import importlib.util
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, MetaData, Table, create_engine, insert, inspect, text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.orm import Session

from backend.app.modules.venue_staff.owner_mapping import (
    OwnerMappingEntry,
    backfill_venue_staff_owners,
    owner_mapping_is_complete,
)
from backend.tests.postgres_test_database import (
    disposable_database,
    override_test_database_url,
)

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "backend/migrations/versions/0026_venue_staff_authorization.py"
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
        "sqlalchemy.url", engine.url.render_as_string(hide_password=False)
    )
    return config


def _seed_legacy_memberships(engine: Engine) -> tuple[uuid.UUID, dict[str, uuid.UUID]]:
    metadata = MetaData()
    users = Table("users", metadata, autoload_with=engine)
    venues = Table("venues", metadata, autoload_with=engine)
    memberships = Table("venue_memberships", metadata, autoload_with=engine)
    venue_id = uuid.uuid4()
    user_ids = {name: uuid.uuid4() for name in ("inventory", "empty", "inactive")}
    membership_ids = {name: uuid.uuid4() for name in user_ids}
    venue_defaults = {
        "description": "",
        "price_advantage_text": None,
        "timezone": "Asia/Shanghai",
        "business_hours_text": None,
        "address": "天津市和平区权限迁移测试路 1 号",
        "district_code": "120101",
        "district_name": "和平区",
        "parking_text": None,
        "phone": None,
        "refund_policy_text": None,
        "latitude": 39.0,
        "longitude": 117.0,
        "booking_mode": "DIRECTORY_ONLY",
        "navigation_poi_name": "权限迁移测试场馆",
        "navigation_latitude": 39.0,
        "navigation_longitude": 117.0,
        "sort_order": 0,
        "content_verified_at": datetime(2026, 9, 1, tzinfo=UTC),
        "is_listed": False,
        "public_pitch_types": [],
        "is_primary": False,
        "is_active": True,
    }
    with engine.begin() as connection:
        connection.execute(
            insert(users),
            [
                {
                    "id": user_id,
                    "wechat_app_id": "wx-d1b-migration",
                    "wechat_openid": f"d1b-{name}-{user_id}",
                }
                for name, user_id in user_ids.items()
            ],
        )
        connection.execute(
            insert(venues),
            {
                **venue_defaults,
                "id": venue_id,
                "slug": f"d1b-migration-{venue_id}",
                "name": "D1b 权限迁移场馆",
            },
        )
        connection.execute(
            insert(memberships),
            [
                {
                    "id": membership_ids[name],
                    "venue_id": venue_id,
                    "user_id": user_ids[name],
                    "is_active": name != "inactive",
                    "can_manage_inventory": name != "empty",
                }
                for name in user_ids
            ],
        )
    return venue_id, membership_ids


def _insert_user(engine: Engine, *, label: str) -> uuid.UUID:
    user_id = uuid.uuid4()
    users = Table("users", MetaData(), autoload_with=engine)
    with engine.begin() as connection:
        connection.execute(
            insert(users),
            {
                "id": user_id,
                "wechat_app_id": "wx-d1b-migration",
                "wechat_openid": f"d1b-{label}-{user_id}",
            },
        )
    return user_id


def test_0026_extends_0025_with_authority_constraints_and_immutable_audit() -> None:
    assert MIGRATION.exists()
    spec = importlib.util.spec_from_file_location("migration_0026", MIGRATION)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    assert module.revision == "0026"
    assert module.down_revision == "0025"

    source = MIGRATION.read_text(encoding="utf-8")
    for fragment in (
        "uq_venue_memberships_active_owner",
        "ck_venue_memberships_role_permissions",
        "venue_staff_invitations",
        "venue_membership_audit_events",
        "prevent_venue_membership_audit_mutation",
        "RAISE EXCEPTION",
    ):
        assert fragment in source


def test_0026_preserves_real_legacy_inventory_and_round_trips(
    migration_engine: Engine,
) -> None:
    config = _config(migration_engine)
    command.upgrade(config, "0025")
    _, membership_ids = _seed_legacy_memberships(migration_engine)

    command.upgrade(config, "0026")

    with migration_engine.connect() as connection:
        records = {
            row.id: row
            for row in connection.execute(
                text(
                    "SELECT id, role, is_active, can_manage_profile, "
                    "can_manage_pitches, can_manage_inventory, can_fulfill_orders, "
                    "version, revoked_at FROM venue_memberships"
                )
            ).all()
        }
        assert connection.execute(
            text("SELECT version_num FROM alembic_version")
        ).scalar_one() == "0026"

    inventory = records[membership_ids["inventory"]]
    assert inventory.role == "STAFF"
    assert inventory.is_active is True
    assert inventory.can_manage_inventory is True
    assert inventory.can_manage_profile is False
    assert inventory.can_manage_pitches is False
    assert inventory.can_fulfill_orders is False
    assert inventory.version == 1
    assert inventory.revoked_at is None

    empty = records[membership_ids["empty"]]
    assert empty.role == "STAFF"
    assert empty.is_active is False
    assert empty.revoked_at is not None
    inactive = records[membership_ids["inactive"]]
    assert inactive.is_active is False
    assert inactive.can_manage_inventory is True
    assert inactive.revoked_at is not None

    command.downgrade(config, "0025")
    membership_columns = {
        column["name"]
        for column in inspect(migration_engine).get_columns("venue_memberships")
    }
    assert "role" not in membership_columns
    assert "venue_staff_invitations" not in inspect(migration_engine).get_table_names()
    command.upgrade(config, "0026")
    with migration_engine.connect() as connection:
        assert connection.execute(
            text("SELECT version_num FROM alembic_version")
        ).scalar_one() == "0026"


def test_explicit_owner_mapping_dry_run_apply_and_replay_use_real_postgres(
    migration_engine: Engine,
) -> None:
    config = _config(migration_engine)
    command.upgrade(config, "0025")
    venue_id, membership_ids = _seed_legacy_memberships(migration_engine)
    command.upgrade(config, "0026")
    mapping = [OwnerMappingEntry(venue_id, membership_ids["inventory"])]

    with Session(migration_engine) as session:
        assert owner_mapping_is_complete(session) is False

        dry_run = backfill_venue_staff_owners(session, mapping, apply=False)
        assert dry_run.managed_venue_count == 1
        assert dry_run.mapped_owner_count == 1
        assert dry_run.changed_membership_count == 1
        assert dry_run.applied is False
        assert owner_mapping_is_complete(session) is False

        applied = backfill_venue_staff_owners(session, mapping, apply=True)
        assert applied.changed_membership_count == 1
        assert applied.applied is True
        assert owner_mapping_is_complete(session) is True

        replay = backfill_venue_staff_owners(session, mapping, apply=True)
        assert replay.changed_membership_count == 0
        assert replay.applied is True

    with migration_engine.connect() as connection:
        owner = connection.execute(
            text(
                "SELECT role, can_manage_profile, can_manage_pitches, "
                "can_manage_inventory, can_fulfill_orders, version "
                "FROM venue_memberships WHERE id = :membership_id"
            ),
            {"membership_id": membership_ids["inventory"]},
        ).one()
    assert owner == ("OWNER", True, True, True, True, 2)

def test_0026_enforces_owner_staff_and_append_only_audit(
    migration_engine: Engine,
) -> None:
    config = _config(migration_engine)
    command.upgrade(config, "0025")
    venue_id, membership_ids = _seed_legacy_memberships(migration_engine)
    command.upgrade(config, "0026")
    memberships = Table("venue_memberships", MetaData(), autoload_with=migration_engine)

    def add_membership(**values: object) -> None:
        user_id = _insert_user(migration_engine, label=uuid.uuid4().hex)
        with migration_engine.begin() as connection:
            connection.execute(
                insert(memberships),
                {
                    "id": uuid.uuid4(),
                    "venue_id": venue_id,
                    "user_id": user_id,
                    "is_active": True,
                    "version": 1,
                    "revoked_at": None,
                    **values,
                },
            )

    with pytest.raises(IntegrityError):
        add_membership(
            role="STAFF",
            can_manage_profile=False,
            can_manage_pitches=False,
            can_manage_inventory=False,
            can_fulfill_orders=False,
        )
    with pytest.raises(IntegrityError):
        add_membership(
            role="OWNER",
            can_manage_profile=True,
            can_manage_pitches=True,
            can_manage_inventory=True,
            can_fulfill_orders=False,
        )

    owner_id = uuid.uuid4()
    owner_user_id = _insert_user(migration_engine, label="owner")
    with migration_engine.begin() as connection:
        connection.execute(
            insert(memberships),
            {
                "id": owner_id,
                "venue_id": venue_id,
                "user_id": owner_user_id,
                "is_active": True,
                "role": "OWNER",
                "can_manage_profile": True,
                "can_manage_pitches": True,
                "can_manage_inventory": True,
                "can_fulfill_orders": True,
                "version": 1,
                "revoked_at": None,
            },
        )
    with pytest.raises(IntegrityError):
        add_membership(
            role="OWNER",
            can_manage_profile=True,
            can_manage_pitches=True,
            can_manage_inventory=True,
            can_fulfill_orders=True,
        )

    audit_id = uuid.uuid4()
    with migration_engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO venue_membership_audit_events "
                "(id, venue_id, actor_kind, actor_user_id, target_membership_id, "
                "action, operation, idempotency_key, request_sha256, "
                "permissions_before, permissions_after, target_display_name, "
                "response_status, response_body) VALUES "
                "(:id, :venue_id, 'USER', :actor_user_id, :target_membership_id, "
                "'PERMISSIONS_UPDATED', 'permissions.update', :key, :digest, "
                "'[\"MANAGE_INVENTORY\"]'::jsonb, "
                "'[\"MANAGE_PROFILE\",\"MANAGE_INVENTORY\"]'::jsonb, "
                "'场馆员工', 200, jsonb_build_object('ok', true))"
            ),
            {
                "id": audit_id,
                "venue_id": venue_id,
                "actor_user_id": owner_user_id,
                "target_membership_id": membership_ids["inventory"],
                "key": "d1b-audit-key-0001",
                "digest": "a" * 64,
            },
        )

    for statement in (
        "UPDATE venue_membership_audit_events SET response_status = 201 WHERE id = :id",
        "DELETE FROM venue_membership_audit_events WHERE id = :id",
    ):
        with pytest.raises(DBAPIError, match="audit events are immutable"):
            with migration_engine.begin() as connection:
                connection.execute(text(statement), {"id": audit_id})
