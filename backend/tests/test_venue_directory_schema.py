from typing import cast

from sqlalchemy import Table
from sqlalchemy.dialects.postgresql import JSONB

from backend.app.models import (
    BookingMode,
    TransitDistanceBasis,
    TransitKind,
    Venue,
    VenueTransitStop,
)


def _constraint_names(table_name: str) -> set[str | None]:
    table = Venue.metadata.tables[table_name]
    return {cast(str | None, constraint.name) for constraint in table.constraints}


def test_venue_directory_enums_are_closed() -> None:
    assert [mode.value for mode in BookingMode] == ["ONLINE", "DIRECTORY_ONLY"]
    assert [kind.value for kind in TransitKind] == ["SUBWAY", "BUS"]
    assert [basis.value for basis in TransitDistanceBasis] == [
        "STRAIGHT_LINE",
        "MAP_VERIFIED",
    ]


def test_venue_model_separates_public_directory_content_from_inventory() -> None:
    columns = Venue.__table__.columns
    assert columns.booking_mode.nullable is False
    assert columns.navigation_poi_name.nullable is False
    assert columns.navigation_latitude.nullable is False
    assert columns.navigation_longitude.nullable is False
    assert columns.sort_order.nullable is False
    assert columns.content_verified_at.nullable is False
    assert columns.is_listed.nullable is False
    assert isinstance(columns.public_pitch_types.type, JSONB)
    for field in (
        "price_advantage_text",
        "timezone",
        "business_hours_text",
        "parking_text",
        "phone",
        "refund_policy_text",
    ):
        assert columns[field].nullable is True

    assert _constraint_names("venues") >= {
        "ck_venues_booking_content",
        "ck_venues_primary_online",
        "ck_venues_navigation_latitude",
        "ck_venues_navigation_longitude",
        "ck_venues_sort_order",
        "ck_venues_public_pitch_types_array",
    }


def test_transit_stop_model_freezes_public_and_evidence_fields() -> None:
    columns = VenueTransitStop.__table__.columns
    assert set(columns.keys()) == {
        "id",
        "venue_id",
        "kind",
        "name",
        "lines",
        "latitude",
        "longitude",
        "distance_meters",
        "distance_basis",
        "source_name",
        "source_url",
        "verified_at",
        "sort_order",
    }
    assert isinstance(columns.lines.type, JSONB)
    assert columns.source_url.nullable is True
    assert all(
        not columns[name].nullable
        for name in set(columns.keys()) - {"source_url"}
    )
    assert _constraint_names("venue_transit_stops") >= {
        "uq_venue_transit_stops_venue_kind_name",
        "ck_venue_transit_stops_name_nonempty",
        "ck_venue_transit_stops_lines_array",
        "ck_venue_transit_stops_latitude",
        "ck_venue_transit_stops_longitude",
        "ck_venue_transit_stops_distance_meters",
        "ck_venue_transit_stops_source_name_nonempty",
        "ck_venue_transit_stops_sort_order",
    }
    transit_table = cast(Table, VenueTransitStop.__table__)
    assert {index.name for index in transit_table.indexes} == {
        "ix_venue_transit_stops_venue_id"
    }
