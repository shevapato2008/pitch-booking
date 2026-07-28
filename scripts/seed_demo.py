import argparse
import os
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import Engine, create_engine
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from backend.app.config import Settings
from backend.app.models import Pitch, Slot, Venue, VenueFacility, VenueImage

SHANGHAI = ZoneInfo("Asia/Shanghai")
NAMESPACE = uuid.UUID("f290c9b8-b58b-4e6e-8dff-b738e9705cd2")
VENUE_ID = uuid.UUID("7e68d7d8-4b7e-4f04-a5c5-3fe263e69c6f")


def stable_id(key: str) -> uuid.UUID:
    return uuid.uuid5(NAMESPACE, key)


def parse_anchor_date(value: str, *, now: datetime | None = None) -> date:
    if value == "today":
        return (now or datetime.now(UTC)).astimezone(SHANGHAI).date()
    return date.fromisoformat(value)


def _insert_missing(session: Session, model: type[object], values: dict[str, object]) -> None:
    session.execute(insert(model).values(**values).on_conflict_do_nothing())


@contextmanager
def _seed_engine(database_url: str) -> Iterator[Engine]:
    engine = create_engine(database_url)
    try:
        yield engine
    finally:
        engine.dispose()


def run_seed(
    *,
    anchor: str,
    days: int,
    database_url: str | None = None,
    now: datetime | None = None,
) -> None:
    if days <= 0:
        raise ValueError("days must be positive")
    app_env = os.environ.get("APP_ENV", "").lower()
    if app_env == "production":
        raise SystemExit("seed is disabled in production")
    if app_env not in {"development", "test", "staging"}:
        raise SystemExit(
            "seed requires explicit non-production APP_ENV="
            "development, test, or staging"
        )
    settings = Settings()
    resolved_now = now or datetime.now(UTC)
    if resolved_now.tzinfo is None or resolved_now.utcoffset() is None:
        raise ValueError("now must be timezone-aware")
    anchor_date = parse_anchor_date(anchor, now=resolved_now)
    five_id = stable_id("pitch-five-a")
    seven_id = stable_id("pitch-seven-a")
    with _seed_engine(database_url or settings.database_url) as engine, Session(
        engine
    ) as session:
        _insert_missing(
            session,
            Venue,
            {
                "id": VENUE_ID,
                "slug": "test-xingyue-football-park",
                "name": "测试环境·浦东星跃足球公园",
                "description": "测试环境场馆数据",
                "price_advantage_text": "测试环境透明场地价",
                "timezone": "Asia/Shanghai",
                "business_hours_text": "每日 09:00–23:00",
                "address": "上海市浦东新区测试地址",
                "parking_text": "测试停车信息",
                "phone": "+86-21-5899-2608",
                "refund_policy_text": "测试退款规则",
                "latitude": 31.245621,
                "longitude": 121.623847,
                "is_primary": True,
                "is_active": True,
            },
        )
        for key, url, alt, role, sort_order in (
            ("cover", "https://assets.example.com/venues/test-cover.jpg", "测试主图", "COVER", 0),
            (
                "gallery",
                "https://assets.example.com/venues/test-gallery.jpg",
                "测试相册",
                "GALLERY",
                1,
            ),
        ):
            _insert_missing(
                session,
                VenueImage,
                {
                    "id": stable_id(f"image-{key}"),
                    "venue_id": VENUE_ID,
                    "url": url,
                    "alt": alt,
                    "role": role,
                    "sort_order": sort_order,
                },
            )
        _insert_missing(
            session,
            VenueFacility,
            {
                "id": stable_id("facility-lighting"),
                "venue_id": VENUE_ID,
                "code": "LIGHTING",
                "name": "专业夜场照明",
                "sort_order": 0,
            },
        )
        for pitch_id, code, name, pitch_type, sort_order in (
            (five_id, "FIVE-A", "五人制 A 场", "FIVE_A_SIDE", 0),
            (seven_id, "SEVEN-A", "七人制 A 场", "SEVEN_A_SIDE", 1),
        ):
            _insert_missing(
                session,
                Pitch,
                {
                    "id": pitch_id,
                    "venue_id": VENUE_ID,
                    "code": code,
                    "name": name,
                    "pitch_type": pitch_type,
                    "sort_order": sort_order,
                },
            )

        for offset in range(days):
            local_day = anchor_date + timedelta(days=offset)
            for pitch_id, pitch_key in ((five_id, "five"), (seven_id, "seven")):
                if pitch_key == "seven" and offset == 13:
                    continue
                for hour, status in ((9, "AVAILABLE"), (10, "BOOKED"), (11, "CLOSED")):
                    starts_at = datetime.combine(local_day, time(hour), SHANGHAI).astimezone(UTC)
                    _insert_missing(
                        session,
                        Slot,
                        {
                            "id": stable_id(f"slot-{pitch_key}-{local_day}-{hour}"),
                            "pitch_id": pitch_id,
                            "starts_at": starts_at,
                            "ends_at": starts_at + timedelta(hours=1),
                            "status": status,
                            "price_cents": 36000 if hour < 11 else 42000,
                            "locked_until": None,
                            "locked_by_order_id": None,
                        },
                    )

        # The regular inventory intentionally includes a 09:00 AVAILABLE state for
        # projection tests. A seed executed later in the day also needs one slot that
        # is unambiguously bookable by the local HTTP journey.
        bookable_day = max(
            anchor_date,
            resolved_now.astimezone(SHANGHAI).date() + timedelta(days=1),
        )
        bookable_start = datetime.combine(
            bookable_day,
            time(19),
            SHANGHAI,
        ).astimezone(UTC)
        _insert_missing(
            session,
            Slot,
            {
                "id": stable_id(f"slot-five-{bookable_day}-19-local-booking"),
                "pitch_id": five_id,
                "starts_at": bookable_start,
                "ends_at": bookable_start + timedelta(hours=2),
                "status": "AVAILABLE",
                "price_cents": 32000,
                "locked_until": None,
                "locked_by_order_id": None,
            },
        )
        session.commit()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--anchor-date", default="today")
    parser.add_argument("--days", type=int, default=31)
    args = parser.parse_args()
    run_seed(anchor=args.anchor_date, days=args.days)


if __name__ == "__main__":
    main()
