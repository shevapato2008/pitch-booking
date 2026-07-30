"""persist map venue directory

Revision ID: 0006
Revises: 0005
Create Date: 2026-07-30

"""

import json
from collections.abc import Sequence
from typing import Any, Final, TypedDict

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006"
down_revision: str | Sequence[str] | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CANONICAL_PRIMARY_ID: Final = "7e68d7d8-4b7e-4f04-a5c5-3fe263e69c6f"
LEGACY_PRIMARY_SLUG: Final = "test-xingyue-football-park"
CANONICAL_PRIMARY_SLUG: Final = "bohai-yuanfeng-football-pitch"
UNSAFE_DOWNGRADE_MESSAGE: Final = (
    "cannot downgrade while directory content is loaded; run "
    "scripts/load_venue_directory.py --unload-directory first"
)

class _VenueBackfill(TypedDict):
    accepted_slugs: set[str]
    slug: str
    booking_mode: str
    navigation_poi_name: str
    navigation_latitude: float
    navigation_longitude: float
    sort_order: int
    public_pitch_types: list[str]
    content_verified_at: str


_VENUE_BACKFILLS: Final[dict[str, _VenueBackfill]] = {
    CANONICAL_PRIMARY_ID: {
        "accepted_slugs": {LEGACY_PRIMARY_SLUG, CANONICAL_PRIMARY_SLUG},
        "slug": CANONICAL_PRIMARY_SLUG,
        "booking_mode": "ONLINE",
        "navigation_poi_name": "天津市渤海元丰科技有限公司-南门",
        "navigation_latitude": 39.000157,
        "navigation_longitude": 117.212208,
        "sort_order": 0,
        "public_pitch_types": [],
        "content_verified_at": "2026-07-30T18:15:00+08:00",
    },
    "e03d801d-1254-5c62-9a16-9a8800280162": {
        "accepted_slugs": {"tianjin-olympic-center-five-a-side-football-pitch"},
        "slug": "tianjin-olympic-center-five-a-side-football-pitch",
        "booking_mode": "DIRECTORY_ONLY",
        "navigation_poi_name": "天津奥林匹克中心体育馆",
        "navigation_latitude": 39.077539,
        "navigation_longitude": 117.178054,
        "sort_order": 1,
        "public_pitch_types": ["FIVE_A_SIDE"],
        "content_verified_at": "2026-07-30T18:15:00+08:00",
    },
    "2a9640a5-f625-5ad8-9cb9-3440acb70967": {
        "accepted_slugs": {"tianjin-locomotive-stadium"},
        "slug": "tianjin-locomotive-stadium",
        "booking_mode": "DIRECTORY_ONLY",
        "navigation_poi_name": "火车头体育场",
        "navigation_latitude": 39.17033,
        "navigation_longitude": 117.210679,
        "sort_order": 2,
        "public_pitch_types": ["ELEVEN_A_SIDE"],
        "content_verified_at": "2026-07-30T18:15:00+08:00",
    },
    "80532433-8038-5ee5-9963-3e6282aa4abd": {
        "accepted_slugs": {"tianjin-peoples-gymnasium-football-pitch"},
        "slug": "tianjin-peoples-gymnasium-football-pitch",
        "booking_mode": "DIRECTORY_ONLY",
        "navigation_poi_name": "天津市人民体育馆",
        "navigation_latitude": 39.108701,
        "navigation_longitude": 117.194873,
        "sort_order": 3,
        "public_pitch_types": ["FIVE_A_SIDE"],
        "content_verified_at": "2026-07-30T18:15:00+08:00",
    },
    "c0372328-6fa4-585a-b951-3324925763d6": {
        "accepted_slugs": {"dongli-sports-center-football-pitch"},
        "slug": "dongli-sports-center-football-pitch",
        "booking_mode": "DIRECTORY_ONLY",
        "navigation_poi_name": "东丽体育中心",
        "navigation_latitude": 39.083772,
        "navigation_longitude": 117.324276,
        "sort_order": 4,
        "public_pitch_types": ["ELEVEN_A_SIDE"],
        "content_verified_at": "2026-07-30T18:15:00+08:00",
    },
}

_booking_mode = postgresql.ENUM(
    "ONLINE", "DIRECTORY_ONLY", name="booking_mode", create_type=False
)
_transit_kind = postgresql.ENUM("SUBWAY", "BUS", name="transit_kind", create_type=False)
_distance_basis = postgresql.ENUM(
    "STRAIGHT_LINE", "MAP_VERIFIED", name="transit_distance_basis", create_type=False
)


def _validate_and_backfill_legacy_venues(bind: sa.Connection) -> None:
    rows = bind.execute(sa.text("SELECT id::text, slug FROM venues ORDER BY id")).all()
    for venue_id, slug in rows:
        mapping = _VENUE_BACKFILLS.get(str(venue_id))
        if mapping is None or str(slug) not in mapping["accepted_slugs"]:
            raise RuntimeError(f"unmapped legacy venue: {venue_id}/{slug}")
        if mapping["booking_mode"] == "DIRECTORY_ONLY":
            has_inventory = bind.execute(
                sa.text(
                    "SELECT EXISTS (SELECT 1 FROM pitches "
                    "WHERE venue_id=CAST(:venue_id AS uuid))"
                ),
                {"venue_id": venue_id},
            ).scalar_one()
            if has_inventory:
                raise RuntimeError(
                    f"directory identity has booking inventory: {venue_id}/{slug}"
                )

    for venue_id, _slug in rows:
        mapping = _VENUE_BACKFILLS[str(venue_id)]
        bind.execute(
            sa.text(
                "UPDATE venues SET slug=:slug, "
                "booking_mode=CAST(:booking_mode AS booking_mode), "
                "navigation_poi_name=:navigation_poi_name, "
                "navigation_latitude=:navigation_latitude, "
                "navigation_longitude=:navigation_longitude, sort_order=:sort_order, "
                "content_verified_at=CAST(:content_verified_at AS timestamptz), "
                "is_listed=true, public_pitch_types=CAST(:public_pitch_types AS jsonb) "
                "WHERE id=CAST(:venue_id AS uuid)"
            ),
            {
                "venue_id": venue_id,
                "slug": mapping["slug"],
                "booking_mode": mapping["booking_mode"],
                "navigation_poi_name": mapping["navigation_poi_name"],
                "navigation_latitude": mapping["navigation_latitude"],
                "navigation_longitude": mapping["navigation_longitude"],
                "sort_order": mapping["sort_order"],
                "content_verified_at": mapping["content_verified_at"],
                "public_pitch_types": json.dumps(mapping["public_pitch_types"]),
            },
        )


def upgrade() -> None:
    bind = op.get_bind()
    _booking_mode.create(bind, checkfirst=True)
    _transit_kind.create(bind, checkfirst=True)
    _distance_basis.create(bind, checkfirst=True)

    op.add_column(
        "venues",
        sa.Column(
            "booking_mode",
            _booking_mode,
            nullable=True,
            server_default=sa.text("'ONLINE'::booking_mode"),
        ),
    )
    op.add_column("venues", sa.Column("navigation_poi_name", sa.Text(), nullable=True))
    op.add_column("venues", sa.Column("navigation_latitude", sa.Float(), nullable=True))
    op.add_column("venues", sa.Column("navigation_longitude", sa.Float(), nullable=True))
    op.add_column(
        "venues",
        sa.Column("sort_order", sa.Integer(), nullable=True, server_default=sa.text("0")),
    )
    op.add_column(
        "venues",
        sa.Column("content_verified_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "venues",
        sa.Column("is_listed", sa.Boolean(), nullable=True, server_default=sa.text("true")),
    )
    op.add_column(
        "venues",
        sa.Column(
            "public_pitch_types",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )

    _validate_and_backfill_legacy_venues(bind)

    for column_name, existing_type in (
        ("booking_mode", _booking_mode),
        ("navigation_poi_name", sa.Text()),
        ("navigation_latitude", sa.Float()),
        ("navigation_longitude", sa.Float()),
        ("sort_order", sa.Integer()),
        ("content_verified_at", sa.DateTime(timezone=True)),
        ("is_listed", sa.Boolean()),
        ("public_pitch_types", postgresql.JSONB(astext_type=sa.Text())),
    ):
        op.alter_column(
            "venues", column_name, existing_type=existing_type, nullable=False
        )
    for column_name, existing_type in (
        ("booking_mode", _booking_mode),
        ("sort_order", sa.Integer()),
        ("is_listed", sa.Boolean()),
        ("public_pitch_types", postgresql.JSONB(astext_type=sa.Text())),
    ):
        op.alter_column(
            "venues", column_name, existing_type=existing_type, server_default=None
        )

    nullable_online_columns: tuple[tuple[str, sa.types.TypeEngine[Any]], ...] = (
        ("price_advantage_text", sa.Text()),
        ("timezone", sa.String(length=80)),
        ("business_hours_text", sa.Text()),
        ("parking_text", sa.Text()),
        ("phone", sa.String(length=40)),
        ("refund_policy_text", sa.Text()),
    )
    for nullable_name, nullable_type in nullable_online_columns:
        op.alter_column(
            "venues", nullable_name, existing_type=nullable_type, nullable=True
        )

    op.create_check_constraint(
        "ck_venues_navigation_latitude",
        "venues",
        "navigation_latitude BETWEEN -90 AND 90",
    )
    op.create_check_constraint(
        "ck_venues_navigation_longitude",
        "venues",
        "navigation_longitude BETWEEN -180 AND 180",
    )
    op.create_check_constraint("ck_venues_sort_order", "venues", "sort_order >= 0")
    op.create_check_constraint(
        "ck_venues_public_pitch_types_array",
        "venues",
        "jsonb_typeof(public_pitch_types) = 'array'",
    )
    op.create_check_constraint(
        "ck_venues_primary_online",
        "venues",
        "NOT is_primary OR booking_mode = 'ONLINE'",
    )
    op.create_check_constraint(
        "ck_venues_booking_content",
        "venues",
        "booking_mode <> 'ONLINE' OR ("
        "price_advantage_text IS NOT NULL AND timezone IS NOT NULL AND "
        "business_hours_text IS NOT NULL AND parking_text IS NOT NULL AND "
        "phone IS NOT NULL AND refund_policy_text IS NOT NULL)",
    )

    op.create_table(
        "venue_transit_stops",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("venue_id", sa.UUID(), nullable=False),
        sa.Column("kind", _transit_kind, nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("lines", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        sa.Column("distance_meters", sa.Integer(), nullable=False),
        sa.Column("distance_basis", _distance_basis, nullable=False),
        sa.Column("source_name", sa.Text(), nullable=False),
        sa.Column("source_url", sa.Text(), nullable=True),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.CheckConstraint(
            "length(trim(name)) > 0", name="ck_venue_transit_stops_name_nonempty"
        ),
        sa.CheckConstraint(
            "jsonb_typeof(lines) = 'array'", name="ck_venue_transit_stops_lines_array"
        ),
        sa.CheckConstraint(
            "latitude BETWEEN -90 AND 90", name="ck_venue_transit_stops_latitude"
        ),
        sa.CheckConstraint(
            "longitude BETWEEN -180 AND 180", name="ck_venue_transit_stops_longitude"
        ),
        sa.CheckConstraint(
            "distance_meters >= 0", name="ck_venue_transit_stops_distance_meters"
        ),
        sa.CheckConstraint(
            "length(trim(source_name)) > 0",
            name="ck_venue_transit_stops_source_name_nonempty",
        ),
        sa.CheckConstraint(
            "sort_order >= 0", name="ck_venue_transit_stops_sort_order"
        ),
        sa.ForeignKeyConstraint(["venue_id"], ["venues.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "venue_id",
            "kind",
            "name",
            name="uq_venue_transit_stops_venue_kind_name",
        ),
    )
    op.create_index(
        "ix_venue_transit_stops_venue_id",
        "venue_transit_stops",
        ["venue_id"],
        unique=False,
    )


def downgrade() -> None:
    bind = op.get_bind()
    unsafe_count = bind.scalar(
        sa.text(
            "SELECT count(*) FROM venues WHERE booking_mode <> 'ONLINE' OR "
            "price_advantage_text IS NULL OR timezone IS NULL OR "
            "business_hours_text IS NULL OR parking_text IS NULL OR phone IS NULL OR "
            "refund_policy_text IS NULL"
        )
    )
    if unsafe_count:
        raise RuntimeError(UNSAFE_DOWNGRADE_MESSAGE)

    op.drop_index("ix_venue_transit_stops_venue_id", table_name="venue_transit_stops")
    op.drop_table("venue_transit_stops")
    for constraint_name in (
        "ck_venues_booking_content",
        "ck_venues_primary_online",
        "ck_venues_public_pitch_types_array",
        "ck_venues_sort_order",
        "ck_venues_navigation_longitude",
        "ck_venues_navigation_latitude",
    ):
        op.drop_constraint(constraint_name, "venues", type_="check")

    for column_name, existing_type in (
        ("price_advantage_text", sa.Text()),
        ("timezone", sa.String(length=80)),
        ("business_hours_text", sa.Text()),
        ("parking_text", sa.Text()),
        ("phone", sa.String(length=40)),
        ("refund_policy_text", sa.Text()),
    ):
        op.alter_column(
            "venues", column_name, existing_type=existing_type, nullable=False
        )

    for column_name in (
        "public_pitch_types",
        "is_listed",
        "content_verified_at",
        "sort_order",
        "navigation_longitude",
        "navigation_latitude",
        "navigation_poi_name",
        "booking_mode",
    ):
        op.drop_column("venues", column_name)

    _distance_basis.drop(bind, checkfirst=True)
    _transit_kind.drop(bind, checkfirst=True)
    _booking_mode.drop(bind, checkfirst=True)
