import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime

import pytest
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session

import scripts.seed_demo as seed_demo
from backend.app.models import Order, Slot, SlotStatus, User
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
        assert session.scalar(select(func.count()).select_from(User)) == 0
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
