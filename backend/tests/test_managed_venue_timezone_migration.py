from __future__ import annotations

import uuid
from collections.abc import Iterator
from datetime import UTC, datetime

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, MetaData, Table, create_engine, insert, text

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


def test_0014_repairs_only_venues_with_effective_management_membership(
    migration_engine: Engine,
) -> None:
    config = _config(migration_engine)
    command.upgrade(config, "0013")
    metadata = MetaData()
    users = Table("users", metadata, autoload_with=migration_engine)
    venues = Table("venues", metadata, autoload_with=migration_engine)
    memberships = Table("venue_memberships", metadata, autoload_with=migration_engine)
    managed_user_id = uuid.uuid4()
    inactive_manager_id = uuid.uuid4()
    active_nonmanager_id = uuid.uuid4()
    venue_ids = {
        "managed-null": uuid.uuid4(),
        "managed-utc": uuid.uuid4(),
        "managed-shanghai": uuid.uuid4(),
        "unmanaged-null": uuid.uuid4(),
    }
    venue_timezones = {
        "managed-null": None,
        "managed-utc": "UTC",
        "managed-shanghai": "Asia/Shanghai",
        "unmanaged-null": None,
    }
    venue_defaults = {
        "description": "",
        "price_advantage_text": None,
        "business_hours_text": None,
        "address": "天津市和平区迁移测试路 1 号",
        "district_code": "120101",
        "district_name": "和平区",
        "parking_text": None,
        "phone": None,
        "refund_policy_text": None,
        "latitude": 39.0,
        "longitude": 117.0,
        "booking_mode": "DIRECTORY_ONLY",
        "navigation_poi_name": "Migration Test POI",
        "navigation_latitude": 39.0,
        "navigation_longitude": 117.0,
        "sort_order": 0,
        "content_verified_at": datetime(2026, 8, 19, tzinfo=UTC),
        "is_listed": True,
        "public_pitch_types": [],
        "is_primary": False,
        "is_active": True,
    }

    with migration_engine.begin() as connection:
        connection.execute(
            insert(users),
            [
                {
                    "id": user_id,
                    "wechat_app_id": "wx-migration",
                    "wechat_openid": openid,
                }
                for user_id, openid in (
                    (managed_user_id, "managed-user"),
                    (inactive_manager_id, "inactive-manager"),
                    (active_nonmanager_id, "active-nonmanager"),
                )
            ],
        )
        connection.execute(
            insert(venues),
            [
                {
                    **venue_defaults,
                    "id": venue_ids[slug],
                    "slug": slug,
                    "name": slug,
                    "timezone": timezone,
                }
                for slug, timezone in venue_timezones.items()
            ],
        )
        connection.execute(
            insert(memberships),
            [
                {
                    "id": uuid.uuid4(),
                    "venue_id": venue_ids[slug],
                    "user_id": managed_user_id,
                    "is_active": True,
                    "can_manage_inventory": True,
                }
                for slug in ("managed-null", "managed-utc", "managed-shanghai")
            ]
            + [
                {
                    "id": uuid.uuid4(),
                    "venue_id": venue_ids["unmanaged-null"],
                    "user_id": inactive_manager_id,
                    "is_active": False,
                    "can_manage_inventory": True,
                },
                {
                    "id": uuid.uuid4(),
                    "venue_id": venue_ids["unmanaged-null"],
                    "user_id": active_nonmanager_id,
                    "is_active": True,
                    "can_manage_inventory": False,
                },
            ],
        )

    command.upgrade(config, "0014")

    expected_timezones = {
        "managed-null": "Asia/Shanghai",
        "managed-shanghai": "Asia/Shanghai",
        "managed-utc": "Asia/Shanghai",
        "unmanaged-null": None,
    }
    with migration_engine.connect() as connection:
        timezone_by_slug = dict(
            connection.execute(
                text("SELECT slug, timezone FROM venues ORDER BY slug")
            ).all()
        )
    assert timezone_by_slug == expected_timezones

    command.downgrade(config, "0013")

    with migration_engine.connect() as connection:
        repaired_timezone_by_slug = dict(
            connection.execute(
                text("SELECT slug, timezone FROM venues ORDER BY slug")
            ).all()
        )
        version = connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
    assert repaired_timezone_by_slug == expected_timezones
    assert version == "0013"
