import threading
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import UTC, date, datetime

import pytest
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session

import scripts.seed_demo as seed_demo
from backend.app.models import (
    BookingMode,
    Order,
    Slot,
    SlotStatus,
    User,
    Venue,
    VenueMembership,
)
from scripts.seed_demo import parse_anchor_date, run_seed


def test_parse_anchor_date_supports_iso_and_today() -> None:
    assert parse_anchor_date("2026-07-22") == date(2026, 7, 22)
    assert isinstance(parse_anchor_date("today"), date)


def test_seed_refuses_production(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_ENV", "production")

    with pytest.raises(SystemExit, match="seed is disabled in production"):
        run_seed(anchor="2026-07-22", days=31)


@pytest.mark.parametrize("app_env", [None, "", "invalid"])
def test_seed_requires_an_explicit_supported_nonproduction_environment(
    monkeypatch: pytest.MonkeyPatch,
    app_env: str | None,
) -> None:
    if app_env is None:
        monkeypatch.delenv("APP_ENV", raising=False)
    else:
        monkeypatch.setenv("APP_ENV", app_env)

    with pytest.raises(SystemExit, match="explicit non-production APP_ENV"):
        run_seed(anchor="2026-07-22", days=31)


def test_seed_rejects_non_positive_days() -> None:
    with pytest.raises(ValueError, match="days must be positive"):
        run_seed(anchor="2026-07-22", days=0)


def test_seed_disposes_engine_when_session_setup_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class RecordingEngine:
        disposed = False

        def dispose(self) -> None:
            self.disposed = True

    class FailingSessionContext:
        def __enter__(self) -> None:
            raise RuntimeError("injected session failure")

        def __exit__(self, *_args: object) -> None:
            return None

    engine = RecordingEngine()
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setattr(seed_demo, "create_engine", lambda _url: engine)
    monkeypatch.setattr(seed_demo, "Session", lambda _engine: FailingSessionContext())

    with pytest.raises(RuntimeError, match="injected session failure"):
        run_seed(
            anchor="2026-07-28",
            days=1,
            database_url="postgresql+psycopg://unused/unused",
        )

    assert engine.disposed is True


def test_seed_writes_all_directory_era_venue_fields_explicitly(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: list[tuple[type[object], dict[str, object]]] = []

    class RecordingSession:
        def __enter__(self) -> "RecordingSession":
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def commit(self) -> None:
            return None

    @contextmanager
    def recording_engine(_database_url: str) -> Iterator[object]:
        yield object()

    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setattr(seed_demo, "_seed_engine", recording_engine)
    monkeypatch.setattr(seed_demo, "Session", lambda _engine: RecordingSession())
    monkeypatch.setattr(
        seed_demo,
        "_insert_missing",
        lambda _session, model, values: captured.append((model, values)),
    )

    run_seed(
        anchor="2026-07-30",
        days=1,
        database_url="postgresql+psycopg://unused/unused",
        now=datetime(2026, 7, 30, tzinfo=UTC),
    )

    venue_values = next(values for model, values in captured if model is Venue)
    assert venue_values["booking_mode"] == BookingMode.ONLINE
    assert venue_values["navigation_poi_name"] == "天津市渤海元丰科技有限公司-南门"
    assert venue_values["district_code"] == "120111"
    assert venue_values["district_name"] == "西青区"
    assert venue_values["navigation_latitude"] == 39.000157
    assert venue_values["navigation_longitude"] == 117.212208
    assert venue_values["sort_order"] == 0
    assert venue_values["content_verified_at"] == datetime.fromisoformat(
        "2026-07-30T18:15:00+08:00"
    )
    assert venue_values["is_listed"] is True
    assert venue_values["public_pitch_types"] == ["FIVE_A_SIDE", "SEVEN_A_SIDE"]
    assert venue_values["profile_version"] == 1
    assert venue_values["facility_version"] == 1
    user_values = next(values for model, values in captured if model is User)
    membership_values = next(
        values for model, values in captured if model is VenueMembership
    )
    assert user_values["wechat_openid"].startswith("dev-openid-")
    assert membership_values["venue_id"] == seed_demo.VENUE_ID
    assert membership_values["user_id"] == user_values["id"]
    assert membership_values["is_active"] is True
    assert membership_values["can_manage_inventory"] is True
    pitch_values = [values for model, values in captured if model is seed_demo.Pitch]
    assert pitch_values == [
        {
            "id": seed_demo.stable_id("pitch-five-a"),
            "venue_id": seed_demo.VENUE_ID,
            "code": "FIVE-A",
            "name": "五人制 A 场",
            "pitch_type": "FIVE_A_SIDE",
            "sort_order": 0,
            "players_per_side": 5,
            "system_name": "五人制 A 场",
            "custom_name": None,
            "sequence": 1,
            "status": "ACTIVE",
        },
        {
            "id": seed_demo.stable_id("pitch-seven-a"),
            "venue_id": seed_demo.VENUE_ID,
            "code": "SEVEN-A",
            "name": "七人制 A 场",
            "pitch_type": "SEVEN_A_SIDE",
            "sort_order": 1,
            "players_per_side": 7,
            "system_name": "七人制 A 场",
            "custom_name": None,
            "sequence": 1,
            "status": "ACTIVE",
        },
    ]
    counter_values = [
        values
        for model, values in captured
        if model is seed_demo.VenuePitchSequenceCounter
    ]
    assert counter_values == [
        {"venue_id": seed_demo.VENUE_ID, "players_per_side": 5, "last_sequence": 1},
        {"venue_id": seed_demo.VENUE_ID, "players_per_side": 7, "last_sequence": 1},
    ]


@pytest.mark.integration
def test_seed_is_idempotent_preserves_business_rows_and_has_future_inventory(
    pg_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("APP_ENV", "test")
    frozen_now = datetime(2026, 7, 28, 13, 30, tzinfo=UTC)  # 21:30 in Shanghai
    database_url = pg_engine.url.render_as_string(hide_password=False)

    run_seed(
        anchor="2026-07-28",
        days=1,
        database_url=database_url,
        now=frozen_now,
    )
    with Session(pg_engine) as session:
        available = session.scalars(
            select(Slot).where(
                Slot.status == SlotStatus.AVAILABLE,
                Slot.starts_at > frozen_now,
            )
        ).all()
        assert available
        protected = available[0]
        protected.price_cents = 45600
        protected.status = SlotStatus.BOOKED
        session.commit()
        protected_id = protected.id

    run_seed(
        anchor="2026-07-28",
        days=1,
        database_url=database_url,
        now=frozen_now,
    )
    with Session(pg_engine) as session:
        protected = session.get_one(Slot, protected_id)
        assert (protected.price_cents, protected.status) == (45600, SlotStatus.BOOKED)
        assert session.scalar(select(func.count()).select_from(User)) == 1
        assert session.scalar(select(func.count()).select_from(VenueMembership)) == 1
        assert session.scalar(select(func.count()).select_from(Order)) == 0


@pytest.mark.integration
def test_two_concurrent_seeds_converge_without_overwriting_future_inventory(
    pg_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("APP_ENV", "test")
    frozen_now = datetime(2026, 7, 28, 13, 30, tzinfo=UTC)
    database_url = pg_engine.url.render_as_string(hide_password=False)

    def seed_pair() -> None:
        barrier = threading.Barrier(2)

        def seed_after_barrier(_index: int) -> None:
            barrier.wait()
            run_seed(
                anchor="2026-07-28",
                days=1,
                database_url=database_url,
                now=frozen_now,
            )

        with ThreadPoolExecutor(max_workers=2) as executor:
            list(executor.map(seed_after_barrier, range(2)))

    seed_pair()
    with Session(pg_engine) as session:
        future_available = session.scalars(
            select(Slot).where(
                Slot.status == SlotStatus.AVAILABLE,
                Slot.starts_at > frozen_now,
            )
        ).all()
        assert len(future_available) == 1
        protected_id = future_available[0].id
        future_available[0].status = SlotStatus.BOOKED
        future_available[0].price_cents = 45600
        session.commit()

    seed_pair()
    with Session(pg_engine) as session:
        protected = session.get_one(Slot, protected_id)
        assert (protected.status, protected.price_cents) == (
            SlotStatus.BOOKED,
            45600,
        )
