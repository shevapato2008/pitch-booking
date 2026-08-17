import uuid
from collections.abc import Iterator
from datetime import UTC, datetime

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, MetaData, Table, create_engine, insert, inspect, text
from sqlalchemy.exc import IntegrityError

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


def _seed_principals(engine: Engine) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID]:
    applicant_id = uuid.uuid4()
    reviewer_id = uuid.uuid4()
    target_venue_id = uuid.uuid4()
    other_venue_id = uuid.uuid4()
    users = Table("users", MetaData(), autoload_with=engine)
    venues = Table("venues", MetaData(), autoload_with=engine)
    venue_values = {
        "description": "",
        "price_advantage_text": "price",
        "timezone": "Asia/Shanghai",
        "business_hours_text": "09:00-23:00",
        "address": "天津市和平区测试路 1 号",
        "district_code": "120101",
        "district_name": "和平区",
        "parking_text": "parking",
        "phone": "13800000000",
        "refund_policy_text": "refund",
        "latitude": 39.0,
        "longitude": 117.0,
        "booking_mode": "ONLINE",
        "navigation_poi_name": "Test POI",
        "navigation_latitude": 39.0,
        "navigation_longitude": 117.0,
        "sort_order": 0,
        "content_verified_at": datetime.now(UTC),
        "is_listed": True,
        "public_pitch_types": [],
        "is_primary": False,
        "is_active": True,
    }
    with engine.begin() as connection:
        connection.execute(
            insert(users),
            [
                {
                    "id": applicant_id,
                    "wechat_app_id": "wx-onboarding",
                    "wechat_openid": f"applicant-{applicant_id}",
                },
                {
                    "id": reviewer_id,
                    "wechat_app_id": "wx-onboarding",
                    "wechat_openid": f"reviewer-{reviewer_id}",
                },
            ],
        )
        connection.execute(
            insert(venues),
            [
                {
                    **venue_values,
                    "id": target_venue_id,
                    "slug": f"target-{target_venue_id}",
                    "name": "Existing target venue",
                },
                {
                    **venue_values,
                    "id": other_venue_id,
                    "slug": f"other-{other_venue_id}",
                    "name": "Other venue",
                },
            ],
        )
    return applicant_id, reviewer_id, target_venue_id, other_venue_id


def _claim(
    applicant_id: uuid.UUID,
    target_venue_id: uuid.UUID | None,
    **overrides: object,
) -> dict[str, object]:
    values: dict[str, object] = {
        "id": uuid.uuid4(),
        "applicant_user_id": applicant_id,
        "kind": "CLAIM",
        "target_venue_id": target_venue_id,
        "proposed_name": None,
        "proposed_address": None,
        "proposed_district_code": None,
        "proposed_district_name": None,
        "proposed_latitude": None,
        "proposed_longitude": None,
        "normalized_proposed_name": None,
        "normalized_proposed_address": None,
        "contact_phone_ciphertext": b"encrypted-phone-tag",
        "contact_phone_nonce": b"abcdefghijkl",
        "contact_phone_key_version": 1,
        "contact_name": "张三",
        "status": "SUBMITTED",
        "submitted_at": datetime(2026, 8, 1, tzinfo=UTC),
        "reviewer_user_id": None,
        "reviewed_at": None,
        "review_reason": None,
        "approved_venue_id": None,
    }
    values.update(overrides)
    return values


def _create(applicant_id: uuid.UUID, **overrides: object) -> dict[str, object]:
    values = _claim(
        applicant_id,
        None,
        kind="CREATE",
        proposed_name="天津新星足球场",
        proposed_address="天津市和平区新星路 8 号",
        proposed_district_code="120101",
        proposed_district_name="和平区",
        proposed_latitude=39.12,
        proposed_longitude=117.21,
        normalized_proposed_name="天津新星足球场",
        normalized_proposed_address="天津市和平区新星路8号",
    )
    values.update(overrides)
    return values


def _insert_application(engine: Engine, values: dict[str, object]) -> None:
    table = Table("venue_onboarding_applications", MetaData(), autoload_with=engine)
    with engine.begin() as connection:
        connection.execute(insert(table).values(**values))


def _assert_application_rejected(engine: Engine, values: dict[str, object]) -> None:
    with pytest.raises(IntegrityError):
        _insert_application(engine, values)


def test_upgrade_and_downgrade_create_only_private_onboarding_records(
    migration_engine: Engine,
) -> None:
    config = _config(migration_engine)
    command.upgrade(config, "0010")
    assert "venue_onboarding_applications" not in inspect(migration_engine).get_table_names()

    command.upgrade(config, "0011")

    inspector = inspect(migration_engine)
    assert set(inspector.get_table_names()) >= {
        "venue_onboarding_applications",
        "venue_onboarding_evidence",
    }
    assert {index["name"] for index in inspector.get_indexes("venue_onboarding_applications")} >= {
        "uq_venue_onboarding_submitted_claim",
        "uq_venue_onboarding_submitted_create",
    }
    with migration_engine.connect() as connection:
        assert connection.execute(text("SELECT count(*) FROM venues")).scalar_one() == 0
        assert connection.execute(text("SELECT count(*) FROM venue_memberships")).scalar_one() == 0

    command.downgrade(config, "0010")

    assert {
        "venue_onboarding_applications",
        "venue_onboarding_evidence",
    }.isdisjoint(inspect(migration_engine).get_table_names())
    with migration_engine.connect() as connection:
        enum_names = set(
            connection.execute(
                text("SELECT typname FROM pg_type WHERE typname LIKE 'venue_onboarding_%'")
            ).scalars()
        )
        assert enum_names == set()


def test_application_kind_fields_are_isolated(migration_engine: Engine) -> None:
    command.upgrade(_config(migration_engine), "0011")
    applicant_id, _, target_venue_id, _ = _seed_principals(migration_engine)

    _insert_application(migration_engine, _claim(applicant_id, target_venue_id))
    _insert_application(migration_engine, _create(applicant_id))

    _assert_application_rejected(migration_engine, _claim(applicant_id, target_venue_id=None))
    proposed_values: dict[str, object] = {
        "proposed_name": "forbidden",
        "proposed_address": "forbidden",
        "proposed_district_code": "120101",
        "proposed_district_name": "forbidden",
        "proposed_latitude": 39.0,
        "proposed_longitude": 117.0,
        "normalized_proposed_name": "forbidden",
        "normalized_proposed_address": "forbidden",
    }
    for field, value in proposed_values.items():
        _assert_application_rejected(
            migration_engine,
            _claim(applicant_id, target_venue_id, **{field: value}),
        )

    _assert_application_rejected(
        migration_engine,
        _create(applicant_id, target_venue_id=target_venue_id),
    )
    for field in proposed_values:
        _assert_application_rejected(
            migration_engine,
            _create(applicant_id, **{field: None}),
        )


def test_application_review_state_is_consistent(migration_engine: Engine) -> None:
    command.upgrade(_config(migration_engine), "0011")
    applicant_id, reviewer_id, target_venue_id, other_venue_id = _seed_principals(migration_engine)
    reviewed_at = datetime.now(UTC)

    for field, value in {
        "reviewer_user_id": reviewer_id,
        "reviewed_at": reviewed_at,
        "review_reason": "not allowed yet",
        "approved_venue_id": target_venue_id,
    }.items():
        _assert_application_rejected(
            migration_engine,
            _claim(applicant_id, target_venue_id, **{field: value}),
        )

    approved = _claim(
        applicant_id,
        target_venue_id,
        status="APPROVED",
        reviewer_user_id=reviewer_id,
        reviewed_at=reviewed_at,
        review_reason="ownership verified",
        approved_venue_id=target_venue_id,
    )
    _insert_application(migration_engine, approved)
    for field in ("reviewer_user_id", "reviewed_at", "review_reason", "approved_venue_id"):
        _assert_application_rejected(
            migration_engine,
            {**approved, "id": uuid.uuid4(), field: None},
        )
    _assert_application_rejected(
        migration_engine,
        {**approved, "id": uuid.uuid4(), "review_reason": "   "},
    )
    _assert_application_rejected(
        migration_engine,
        {**approved, "id": uuid.uuid4(), "approved_venue_id": other_venue_id},
    )

    rejected = _create(
        applicant_id,
        status="REJECTED",
        reviewer_user_id=reviewer_id,
        reviewed_at=reviewed_at,
        review_reason="identity could not be verified",
    )
    _insert_application(migration_engine, rejected)
    for field in ("reviewer_user_id", "reviewed_at", "review_reason"):
        _assert_application_rejected(
            migration_engine,
            {**rejected, "id": uuid.uuid4(), field: None},
        )
    _assert_application_rejected(
        migration_engine,
        {**rejected, "id": uuid.uuid4(), "review_reason": ""},
    )
    _assert_application_rejected(
        migration_engine,
        {**rejected, "id": uuid.uuid4(), "approved_venue_id": target_venue_id},
    )


def test_only_one_matching_submitted_application_is_allowed(
    migration_engine: Engine,
) -> None:
    command.upgrade(_config(migration_engine), "0011")
    applicant_id, reviewer_id, target_venue_id, _ = _seed_principals(migration_engine)

    _insert_application(migration_engine, _claim(applicant_id, target_venue_id))
    _assert_application_rejected(migration_engine, _claim(applicant_id, target_venue_id))

    reviewed_at = datetime.now(UTC)
    _insert_application(
        migration_engine,
        _claim(
            applicant_id,
            target_venue_id,
            status="REJECTED",
            reviewer_user_id=reviewer_id,
            reviewed_at=reviewed_at,
            review_reason="retry allowed after review",
        ),
    )

    create_values = _create(applicant_id)
    _insert_application(migration_engine, create_values)
    _assert_application_rejected(migration_engine, _create(applicant_id))
    _insert_application(
        migration_engine,
        _create(applicant_id, normalized_proposed_address="天津市和平区新星路9号"),
    )


def test_evidence_is_private_completed_owner_data_with_optional_single_attachment(
    migration_engine: Engine,
) -> None:
    command.upgrade(_config(migration_engine), "0011")
    applicant_id, _, target_venue_id, _ = _seed_principals(migration_engine)
    application = _claim(applicant_id, target_venue_id)
    _insert_application(migration_engine, application)
    evidence = Table("venue_onboarding_evidence", MetaData(), autoload_with=migration_engine)

    uploading = {
        "id": uuid.uuid4(),
        "owner_user_id": applicant_id,
        "application_id": None,
        "kind": "BUSINESS_LICENSE",
        "state": "UPLOADING",
        "object_key": f"private/venue-onboarding/{applicant_id}/license.jpg",
        "content_type": "image/jpeg",
        "byte_size": None,
        "content_sha256": None,
    }
    completed = {
        **uploading,
        "id": uuid.uuid4(),
        "application_id": application["id"],
        "kind": "VENUE_EXTERIOR",
        "object_key": f"private/venue-onboarding/{applicant_id}/exterior.jpg",
        "state": "COMPLETED",
        "byte_size": 4096,
        "content_sha256": "a" * 64,
    }
    with migration_engine.begin() as connection:
        connection.execute(insert(evidence), [uploading, completed])

    invalid_rows = [
        {**uploading, "id": uuid.uuid4(), "object_key": "https://public.example/license.jpg"},
        {**uploading, "id": uuid.uuid4(), "application_id": application["id"]},
        {**completed, "id": uuid.uuid4(), "object_key": "private/missing-size", "byte_size": None},
        {
            **completed,
            "id": uuid.uuid4(),
            "object_key": "private/missing-digest",
            "content_sha256": None,
        },
        {
            **uploading,
            "id": uuid.uuid4(),
            "object_key": "private/premature-metadata",
            "byte_size": 1,
            "content_sha256": "b" * 64,
        },
    ]
    for row in invalid_rows:
        with pytest.raises(IntegrityError):
            with migration_engine.begin() as connection:
                connection.execute(insert(evidence).values(**row))

    evidence_columns = {
        column["name"]
        for column in inspect(migration_engine).get_columns("venue_onboarding_evidence")
    }
    assert "owner_user_id" in evidence_columns
    assert "application_id" in evidence_columns
    assert "url" not in evidence_columns
