from datetime import date

import pytest

from scripts.seed_demo import parse_anchor_date, run_seed


def test_parse_anchor_date_supports_iso_and_today() -> None:
    assert parse_anchor_date("2026-07-22") == date(2026, 7, 22)
    assert isinstance(parse_anchor_date("today"), date)


def test_seed_refuses_production(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_ENV", "production")

    with pytest.raises(SystemExit, match="seed is disabled in production"):
        run_seed(anchor="2026-07-22", days=31)


def test_seed_rejects_non_positive_days() -> None:
    with pytest.raises(ValueError, match="days must be positive"):
        run_seed(anchor="2026-07-22", days=0)
