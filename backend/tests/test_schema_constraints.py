import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import Engine, inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.app.models import Payment, Pitch, Slot, Venue, VenueFacility, VenueImage

pytestmark = pytest.mark.integration


def venue(**overrides: object) -> Venue:
    values: dict[str, object] = {
        "slug": f"venue-{uuid.uuid4()}",
        "name": "浦东星跃足球公园",
        "description": "",
        "price_advantage_text": "透明场地价",
        "timezone": "Asia/Shanghai",
        "business_hours_text": "每日 09:00–23:00",
        "address": "上海市浦东新区锦绣东路 2777 弄 18 号",
        "district_code": "120111",
        "district_name": "西青区",
        "parking_text": "前 30 分钟免费",
        "phone": "+86-21-5899-2608",
        "refund_policy_text": "开场前 24 小时可取消",
        "latitude": 31.2304,
        "longitude": 121.4737,
        "is_primary": False,
        "is_active": True,
    }
    values.update(overrides)
    return Venue(**values)


def add_pitch(session: Session, parent: Venue) -> Pitch:
    pitch = Pitch(
        venue=parent,
        code=f"P-{uuid.uuid4()}",
        name="五人制 A 场",
        pitch_type="FIVE_A_SIDE",
        sort_order=0,
    )
    session.add(pitch)
    session.flush()
    return pitch


def add_slot(
    session: Session,
    pitch: Pitch,
    starts_at: datetime,
    ends_at: datetime,
    **overrides: object,
) -> Slot:
    values: dict[str, object] = {
        "pitch": pitch,
        "starts_at": starts_at,
        "ends_at": ends_at,
        "status": "AVAILABLE",
        "price_cents": 36000,
    }
    values.update(overrides)
    row = Slot(**values)
    session.add(row)
    return row


def test_only_one_active_primary_venue(pg_session: Session) -> None:
    pg_session.add(venue(is_primary=True))
    pg_session.commit()
    pg_session.add(venue(is_primary=True))

    with pytest.raises(IntegrityError):
        pg_session.commit()


def test_one_cover_per_venue(pg_session: Session) -> None:
    parent = venue()
    pg_session.add_all(
        [
            VenueImage(venue=parent, url="https://img.example/a.jpg", alt="主图", role="COVER"),
            VenueImage(venue=parent, url="https://img.example/b.jpg", alt="主图二", role="COVER"),
        ]
    )

    with pytest.raises(IntegrityError):
        pg_session.commit()


def test_adjacent_slots_are_allowed_but_overlap_is_rejected(pg_session: Session) -> None:
    pitch = add_pitch(pg_session, venue())
    start = datetime(2026, 7, 24, 10, tzinfo=UTC)
    add_slot(pg_session, pitch, start, start + timedelta(hours=2))
    add_slot(pg_session, pitch, start + timedelta(hours=2), start + timedelta(hours=4))
    pg_session.commit()

    add_slot(pg_session, pitch, start + timedelta(hours=1), start + timedelta(hours=3))
    with pytest.raises(IntegrityError):
        pg_session.commit()


@pytest.mark.parametrize(
    ("status", "locked_until", "order_id", "valid"),
    [
        ("LOCKED", datetime(2026, 7, 24, 11, tzinfo=UTC), uuid.uuid4(), False),
        ("LOCKED", None, None, False),
        ("AVAILABLE", datetime(2026, 7, 24, 11, tzinfo=UTC), uuid.uuid4(), False),
        ("BOOKED", None, None, True),
    ],
)
def test_lock_fields_correlate_with_status(
    pg_session: Session,
    status: str,
    locked_until: datetime | None,
    order_id: uuid.UUID | None,
    valid: bool,
) -> None:
    pitch = add_pitch(pg_session, venue())
    start = datetime(2026, 7, 24, 10, tzinfo=UTC)
    add_slot(
        pg_session,
        pitch,
        start,
        start + timedelta(hours=1),
        status=status,
        locked_until=locked_until,
        locked_by_order_id=order_id,
    )

    if valid:
        pg_session.commit()
    else:
        with pytest.raises(IntegrityError):
            pg_session.commit()


@pytest.mark.parametrize(
    "row",
    [
        lambda: venue(latitude=91),
        lambda: venue(longitude=181),
        lambda: venue(district_code="12011"),
        lambda: venue(district_name=""),
        lambda: VenueFacility(venue=venue(), code="LIGHTING", name="照明", sort_order=-1),
    ],
)
def test_basic_ranges_are_database_constraints(
    pg_session: Session, row: Callable[[], object]
) -> None:
    pg_session.add(row())
    with pytest.raises(IntegrityError):
        pg_session.commit()


def test_declared_indexes_and_overlap_constraint_exist(pg_engine: Engine) -> None:
    inspector = inspect(pg_engine)

    assert {index["name"] for index in inspector.get_indexes("venues")} >= {
        "uq_one_active_primary_venue"
    }
    assert {index["name"] for index in inspector.get_indexes("venue_images")} >= {
        "uq_one_cover_per_venue",
        "ix_venue_images_venue_id",
    }
    assert {index["name"] for index in inspector.get_indexes("venue_facilities")} >= {
        "ix_venue_facilities_venue_id"
    }
    assert {index["name"] for index in inspector.get_indexes("pitches")} >= {"ix_pitches_venue_id"}
    assert {index["name"] for index in inspector.get_indexes("slots")} >= {"ix_slots_pitch_id"}
    assert Payment.__tablename__ == "payments"
    assert {index["name"] for index in inspector.get_indexes("payments")} >= {
        "ix_payments_order_id",
        "ix_payments_reconciliation_due",
        "uq_payments_one_nonterminal_per_order",
    }
    assert {constraint["name"] for constraint in inspector.get_unique_constraints("slots")} >= {
        "uq_slots_pitch_time"
    }
    with pg_engine.connect() as connection:
        exclusions = connection.execute(
            text(
                "SELECT conname FROM pg_constraint "
                "WHERE contype = 'x' AND conrelid = 'slots'::regclass"
            )
        )
        assert {row[0] for row in exclusions} == {"ex_slots_no_overlap"}
