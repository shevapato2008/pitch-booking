import hashlib
import json
import subprocess
import sys
import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import cast

import pytest
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session

from backend.app.models import BookingMode, Pitch, Venue, VenueTransitStop
from backend.app.modules.venues.loader import (
    VenueDirectoryLoader,
    VenueDirectoryValidationError,
    validate_production_approval,
)

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "deploy" / "venue-directory.json"
SCHEMA = ROOT / "deploy" / "venue-directory.schema.json"
PRIMARY_ID = uuid.UUID("7e68d7d8-4b7e-4f04-a5c5-3fe263e69c6f")


def _manifest() -> dict[str, object]:
    return cast(dict[str, object], json.loads(MANIFEST.read_text()))


def _write_json(path: Path, value: object) -> Path:
    path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
    return path


def _approval(
    manifest_bytes: bytes,
    *,
    environment: str = "production",
    app_revision: str = "revision-123",
    approved_at: datetime,
    expires_at: datetime,
) -> dict[str, str]:
    return {
        "manifest_sha256": hashlib.sha256(manifest_bytes).hexdigest(),
        "environment": environment,
        "app_revision": app_revision,
        "approved_at": approved_at.isoformat(),
        "expires_at": expires_at.isoformat(),
    }


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (lambda value: value.pop("manifest_sha256"), "manifest_sha256"),
        (lambda value: value.update(environment="staging"), "environment"),
        (lambda value: value.update(app_revision="wrong"), "app_revision"),
        (
            lambda value: value.update(manifest_sha256="0" * 64),
            "digest",
        ),
        (
            lambda value: value.update(
                approved_at="2026-07-30T13:00:01+00:00",
                expires_at="2026-07-30T14:00:00+00:00",
            ),
            "valid",
        ),
        (
            lambda value: value.update(
                approved_at="2026-07-30T12:00:00+00:00",
                expires_at="2026-07-30T12:59:59+00:00",
            ),
            "expired",
        ),
        (
            lambda value: value.update(
                approved_at="2026-07-30T00:00:00+00:00",
                expires_at="2026-08-01T00:00:01+00:00",
            ),
            "24 hours",
        ),
    ],
)
def test_production_approval_rejects_every_unbound_or_invalid_case(
    mutate: Callable[[dict[str, str]], object],
    message: str,
) -> None:
    manifest_bytes = MANIFEST.read_bytes()
    now = datetime(2026, 7, 30, 13, 0, tzinfo=UTC)
    approval = _approval(
        manifest_bytes,
        approved_at=now - timedelta(minutes=1),
        expires_at=now + timedelta(hours=1),
    )
    mutate(approval)

    with pytest.raises(VenueDirectoryValidationError, match=message):
        validate_production_approval(
            manifest_bytes=manifest_bytes,
            approval=approval,
            environment="production",
            app_revision="revision-123",
            now=now,
        )


def test_production_approval_accepts_exact_bytes_revision_and_active_window() -> None:
    manifest_bytes = MANIFEST.read_bytes()
    now = datetime(2026, 7, 30, 13, 0, tzinfo=UTC)
    validate_production_approval(
        manifest_bytes=manifest_bytes,
        approval=_approval(
            manifest_bytes,
            approved_at=now - timedelta(minutes=1),
            expires_at=now + timedelta(hours=1),
        ),
        environment="production",
        app_revision="revision-123",
        now=now,
    )


def test_schema_and_semantic_validation_happen_before_database_access(
    tmp_path: Path,
) -> None:
    manifest = _manifest()
    manifest["coordinate_system"] = "WGS84"
    invalid = _write_json(tmp_path / "invalid.json", manifest)

    class DatabaseMustNotBeTouched:
        def execute(self, *_args: object, **_kwargs: object) -> None:
            raise AssertionError("database was touched before validation")

    with pytest.raises(VenueDirectoryValidationError, match="schema"):
        VenueDirectoryLoader(cast(Session, DatabaseMustNotBeTouched())).load(
            manifest_path=invalid,
            schema_path=SCHEMA,
            environment="development",
        )


def test_loader_script_file_entrypoint_can_import_the_backend() -> None:
    result = subprocess.run(
        [sys.executable, "scripts/load_venue_directory.py", "--help"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert "--environment" in result.stdout


def _seed_online(session: Session) -> None:
    session.add(
        Venue(
            id=PRIMARY_ID,
            slug="bohai-yuanfeng-football-pitch",
            name="渤海元丰足球场",
            description="测试环境场馆数据",
            price_advantage_text="测试价格",
            timezone="Asia/Shanghai",
            business_hours_text="09:00-23:00",
            address="天津市西青区利达路",
            district_code="120111",
            district_name="西青区",
            parking_text="测试停车信息",
            phone="+86-22-0000-0000",
            refund_policy_text="测试退款规则",
            latitude=39.000867,
            longitude=117.212396,
            booking_mode=BookingMode.ONLINE,
            navigation_poi_name="天津市渤海元丰科技有限公司-南门",
            navigation_latitude=39.000157,
            navigation_longitude=117.212208,
            sort_order=0,
            content_verified_at=datetime.fromisoformat("2026-07-30T18:15:00+08:00"),
            is_listed=True,
            public_pitch_types=[],
            is_primary=True,
            is_active=True,
        )
    )
    session.commit()


@pytest.mark.integration
def test_load_is_transactional_idempotent_and_unlists_missing_entries(
    pg_engine: Engine,
    tmp_path: Path,
) -> None:
    with Session(pg_engine) as session:
        _seed_online(session)
        loader = VenueDirectoryLoader(session)
        dry_run = loader.load(
            manifest_path=MANIFEST,
            schema_path=SCHEMA,
            environment="development",
            dry_run=True,
        )
        assert (dry_run.created, dry_run.updated, dry_run.unlisted) == (4, 1, 0)
        assert session.scalar(select(func.count()).select_from(Venue)) == 1
        first = loader.load(
            manifest_path=MANIFEST,
            schema_path=SCHEMA,
            environment="development",
        )
        assert (first.created, first.updated, first.unlisted) == (4, 1, 0)
        second = loader.load(
            manifest_path=MANIFEST,
            schema_path=SCHEMA,
            environment="development",
        )
        assert (second.created, second.updated, second.unlisted) == (0, 0, 0)
        assert session.scalar(select(func.count()).select_from(Venue)) == 5
        assert session.scalar(select(func.count()).select_from(VenueTransitStop)) == 1
        assert session.scalar(select(func.count()).select_from(Pitch)) == 0
        assert [
            (venue.id, venue.district_code, venue.district_name)
            for venue in session.scalars(select(Venue).order_by(Venue.sort_order))
        ] == [
            (
                uuid.UUID(cast(str, item["id"])),
                item["district_code"],
                item["district_name"],
            )
            for item in cast(list[dict[str, object]], _manifest()["venues"])
        ]

        reduced = _manifest()
        reduced_venues = cast(list[dict[str, object]], reduced["venues"])
        removed_id = cast(str, reduced_venues.pop()["id"])
        reduced_path = _write_json(tmp_path / "reduced.json", reduced)
        future_schema = json.loads(SCHEMA.read_text())
        future_schema["properties"]["venues"]["minItems"] = 1
        future_schema_path = _write_json(tmp_path / "future-schema.json", future_schema)
        result = loader.load(
            manifest_path=reduced_path,
            schema_path=future_schema_path,
            environment="development",
        )
        assert result.unlisted == 1
        removed = session.get_one(Venue, uuid.UUID(removed_id))
        assert removed.is_listed is False


@pytest.mark.integration
def test_loader_rejects_identity_collision_and_rolls_back_all_changes(
    pg_engine: Engine,
    tmp_path: Path,
) -> None:
    with Session(pg_engine) as session:
        _seed_online(session)
        colliding = Venue(
            id=uuid.uuid4(),
            slug="tianjin-locomotive-stadium",
            name="Collision",
            description="",
            address="Collision",
            district_code="120105",
            district_name="河北区",
            latitude=39.0,
            longitude=117.0,
            booking_mode=BookingMode.DIRECTORY_ONLY,
            navigation_poi_name="Collision",
            navigation_latitude=39.0,
            navigation_longitude=117.0,
            sort_order=99,
            content_verified_at=datetime.now(UTC),
            is_listed=False,
            public_pitch_types=[],
            is_primary=False,
            is_active=True,
        )
        session.add(colliding)
        session.commit()

        with pytest.raises(VenueDirectoryValidationError, match="collision"):
            VenueDirectoryLoader(session).load(
                manifest_path=MANIFEST,
                schema_path=SCHEMA,
                environment="development",
            )
        assert session.scalar(select(func.count()).select_from(Venue)) == 2


@pytest.mark.integration
def test_guarded_unload_preserves_online_and_refuses_directory_history(
    pg_engine: Engine,
) -> None:
    with Session(pg_engine) as session:
        _seed_online(session)
        loader = VenueDirectoryLoader(session)
        loader.load(
            manifest_path=MANIFEST,
            schema_path=SCHEMA,
            environment="development",
        )
        directory = session.scalar(
            select(Venue).where(Venue.booking_mode == BookingMode.DIRECTORY_ONLY)
        )
        assert directory is not None
        session.add(
            Pitch(
                venue_id=directory.id,
                code="inconsistent",
                name="Inconsistent history",
                pitch_type="FIVE_A_SIDE",
                sort_order=0,
            )
        )
        session.commit()

        with pytest.raises(VenueDirectoryValidationError, match="business history"):
            loader.unload(dry_run=False)
        assert session.scalar(select(func.count()).select_from(Venue)) == 5

        session.query(Pitch).filter(Pitch.venue_id == directory.id).delete()
        session.commit()
        dry_run = loader.unload(dry_run=True)
        assert dry_run.deleted == 4
        assert session.scalar(select(func.count()).select_from(Venue)) == 5
        result = loader.unload(dry_run=False)
        assert result.deleted == 4
        remaining = session.scalars(select(Venue)).all()
        assert [venue.id for venue in remaining] == [PRIMARY_ID]
