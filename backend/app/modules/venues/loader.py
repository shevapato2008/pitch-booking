from __future__ import annotations

import hashlib
import json
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, NoReturn

from jsonschema import Draft202012Validator, FormatChecker  # type: ignore[import-untyped]
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.models import (
    BookingMode,
    Pitch,
    TransitDistanceBasis,
    TransitKind,
    Venue,
    VenueTransitStop,
)

CANONICAL_PRIMARY_ID = uuid.UUID("7e68d7d8-4b7e-4f04-a5c5-3fe263e69c6f")
CANONICAL_PRIMARY_SLUG = "bohai-yuanfeng-football-pitch"
LEGACY_PRIMARY_SLUG = "test-xingyue-football-park"
TRANSIT_NAMESPACE = uuid.UUID("5060f5d8-8f4c-5e96-97aa-b3e9c9de9184")
APPROVAL_FIELDS = {
    "manifest_sha256",
    "environment",
    "app_revision",
    "approved_at",
    "expires_at",
}


class VenueDirectoryValidationError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class LoadResult:
    created: int = 0
    updated: int = 0
    unlisted: int = 0
    deleted: int = 0
    dry_run: bool = False


def _reject(message: str) -> NoReturn:
    raise VenueDirectoryValidationError(message)


def _aware_datetime(value: object, field: str) -> datetime:
    if not isinstance(value, str):
        _reject(f"approval {field} must be an ISO date-time")
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        _reject(f"approval {field} must be an ISO date-time")
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        _reject(f"approval {field} must include a timezone")
    return parsed.astimezone(UTC)


def validate_production_approval(
    *,
    manifest_bytes: bytes,
    approval: object,
    environment: str,
    app_revision: str,
    now: datetime,
) -> None:
    if environment != "production":
        _reject("production approval is valid only for environment production")
    if now.tzinfo is None or now.utcoffset() is None:
        _reject("approval clock must be timezone-aware")
    if not isinstance(approval, dict) or set(approval) != APPROVAL_FIELDS:
        _reject(
            "approval must contain exactly manifest_sha256, environment, "
            "app_revision, approved_at, expires_at"
        )
    if approval["environment"] != environment:
        _reject("approval environment does not match")
    if approval["app_revision"] != app_revision:
        _reject("approval app_revision does not match")
    expected_digest = hashlib.sha256(manifest_bytes).hexdigest()
    if approval["manifest_sha256"] != expected_digest:
        _reject("approval manifest digest does not match")
    approved_at = _aware_datetime(approval["approved_at"], "approved_at")
    expires_at = _aware_datetime(approval["expires_at"], "expires_at")
    if expires_at <= approved_at or expires_at - approved_at > timedelta(hours=24):
        _reject("approval window must be positive and no longer than 24 hours")
    now_utc = now.astimezone(UTC)
    if now_utc < approved_at:
        _reject("approval is not yet valid")
    if now_utc > expires_at:
        _reject("approval has expired")


def _read_json(path: Path, label: str) -> tuple[bytes, object]:
    try:
        raw = path.read_bytes()
        return raw, json.loads(raw)
    except (OSError, json.JSONDecodeError) as error:
        _reject(f"{label} is malformed: {error}")


def _validated_manifest(manifest_path: Path, schema_path: Path) -> tuple[bytes, dict[str, Any]]:
    manifest_bytes, manifest = _read_json(manifest_path, "manifest")
    _schema_bytes, schema = _read_json(schema_path, "schema")
    if not isinstance(schema, dict):
        _reject("schema root must be an object")
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    errors = sorted(validator.iter_errors(manifest), key=lambda error: list(error.path))
    if errors:
        first = errors[0]
        location = ".".join(str(part) for part in first.path) or "$"
        _reject(f"manifest schema validation failed at {location}: {first.message}")
    if not isinstance(manifest, dict):
        _reject("manifest schema validation failed: root must be an object")
    _validate_semantics(manifest)
    return manifest_bytes, manifest


def _validate_semantics(manifest: dict[str, Any]) -> None:
    venues = manifest["venues"]
    online = [venue for venue in venues if venue["booking_mode"] == "ONLINE"]
    if len(online) != 1:
        _reject("manifest must contain exactly one ONLINE venue")
    if online[0]["id"] != str(CANONICAL_PRIMARY_ID) or online[0]["slug"] != CANONICAL_PRIMARY_SLUG:
        _reject("ONLINE venue must use the canonical primary identity")
    mappings = manifest["legacy_identity_mappings"]
    if mappings != [
        {
            "id": str(CANONICAL_PRIMARY_ID),
            "legacy_slug": LEGACY_PRIMARY_SLUG,
            "slug": CANONICAL_PRIMARY_SLUG,
        }
    ]:
        _reject("legacy identity mapping does not bind the canonical primary")
    for venue in venues:
        if venue["booking_mode"] == "DIRECTORY_ONLY" and any(
            key in venue for key in ("price", "phone", "inventory", "availability_window")
        ):
            _reject("directory venue contains forbidden booking data")


def _venue_values(item: dict[str, Any]) -> dict[str, Any]:
    marker = item["marker"]
    navigation = item["navigation"]
    values: dict[str, Any] = {
        "slug": item["slug"],
        "name": item["name"],
        "description": item["description"],
        "address": item["address"],
        "district_code": item["district_code"],
        "district_name": item["district_name"],
        "latitude": marker["latitude"],
        "longitude": marker["longitude"],
        "booking_mode": BookingMode(item["booking_mode"]),
        "navigation_poi_name": navigation["poi_name"],
        "navigation_latitude": navigation["coordinate"]["latitude"],
        "navigation_longitude": navigation["coordinate"]["longitude"],
        "sort_order": item["sort_order"],
        "content_verified_at": datetime.fromisoformat(item["content_verified_at"]),
        "is_listed": True,
        "public_pitch_types": list(item["pitch_types"]),
    }
    if item["booking_mode"] == "DIRECTORY_ONLY":
        values.update(
            price_advantage_text=None,
            timezone=None,
            business_hours_text=item["business_hours_text"],
            parking_text=item["parking_text"],
            phone=None,
            refund_policy_text=None,
            is_primary=False,
        )
    return values


def _transit_values(venue_id: uuid.UUID, item: dict[str, Any]) -> list[dict[str, Any]]:
    values = []
    for sort_order, stop in enumerate(item["nearest_transit"]):
        evidence = stop["evidence"]
        source_url = evidence.get("source_url")
        source_name = source_url or evidence.get("internal_reference")
        if not source_name:
            _reject(f"transit evidence source missing for {venue_id}/{stop['id']}")
        values.append(
            {
                "id": uuid.uuid5(TRANSIT_NAMESPACE, f"{venue_id}:{stop['id']}"),
                "venue_id": venue_id,
                "kind": TransitKind(stop["kind"]),
                "name": stop["name"],
                "lines": list(stop["lines"]),
                "latitude": stop["coordinate"]["latitude"],
                "longitude": stop["coordinate"]["longitude"],
                "distance_meters": stop["distance_meters"],
                "distance_basis": TransitDistanceBasis(stop["distance_basis"]),
                "source_name": source_name,
                "source_url": source_url,
                "verified_at": datetime.fromisoformat(evidence["verified_at"]),
                "sort_order": sort_order,
            }
        )
    return values


def _different(venue: Venue, values: dict[str, Any]) -> bool:
    return any(getattr(venue, key) != value for key, value in values.items())


def _transit_different(
    existing: Sequence[VenueTransitStop], desired: list[dict[str, Any]]
) -> bool:
    keys = (
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
    )
    current = [tuple(getattr(stop, key) for key in keys) for stop in existing]
    target = [tuple(values[key] for key in keys) for values in desired]
    return current != target


class VenueDirectoryLoader:
    def __init__(
        self,
        session: Session,
        *,
        now: datetime | None = None,
    ) -> None:
        self._session = session
        self._now = now or datetime.now(UTC)

    def load(
        self,
        *,
        manifest_path: Path,
        schema_path: Path,
        environment: str,
        app_revision: str | None = None,
        approval_path: Path | None = None,
        dry_run: bool = False,
    ) -> LoadResult:
        if environment not in {"development", "production"}:
            _reject("environment must be explicitly development or production")
        manifest_bytes, manifest = _validated_manifest(manifest_path, schema_path)
        if environment == "production":
            if not app_revision:
                _reject("production app_revision is required")
            if approval_path is None:
                _reject("production approval file is required")
            _approval_bytes, approval = _read_json(approval_path, "approval")
            validate_production_approval(
                manifest_bytes=manifest_bytes,
                approval=approval,
                environment=environment,
                app_revision=app_revision,
                now=self._now,
            )

        try:
            return self._apply(manifest, dry_run=dry_run)
        except Exception:
            self._session.rollback()
            raise

    def _apply(self, manifest: dict[str, Any], *, dry_run: bool) -> LoadResult:
        existing = self._session.scalars(select(Venue).order_by(Venue.id)).all()
        by_id = {venue.id: venue for venue in existing}
        by_slug = {venue.slug: venue for venue in existing}
        canonical = by_id.get(CANONICAL_PRIMARY_ID)
        if canonical is None:
            _reject("canonical ONLINE venue must exist before directory loading")
        if canonical.slug not in {LEGACY_PRIMARY_SLUG, CANONICAL_PRIMARY_SLUG}:
            _reject("canonical ONLINE venue slug collision")

        desired_ids: set[uuid.UUID] = set()
        prepared: list[
            tuple[uuid.UUID, Venue | None, dict[str, Any], list[dict[str, Any]], bool]
        ] = []
        created = updated = 0
        for item in manifest["venues"]:
            venue_id = uuid.UUID(item["id"])
            desired_ids.add(venue_id)
            current = by_id.get(venue_id)
            slug_owner = by_slug.get(item["slug"])
            if current is not None and current.slug not in {
                item["slug"],
                LEGACY_PRIMARY_SLUG if venue_id == CANONICAL_PRIMARY_ID else item["slug"],
            }:
                _reject(f"venue identity collision for {venue_id}")
            if slug_owner is not None and slug_owner.id != venue_id:
                _reject(f"venue slug collision for {item['slug']}")
            if current is not None and item["booking_mode"] == "DIRECTORY_ONLY":
                pitch = self._session.scalar(
                    select(Pitch.id).where(Pitch.venue_id == venue_id).limit(1)
                )
                if pitch is not None:
                    _reject(f"directory venue {venue_id} has business history")
            values = _venue_values(item)
            transit = _transit_values(venue_id, item)
            current_transit = (
                self._session.scalars(
                    select(VenueTransitStop)
                    .where(VenueTransitStop.venue_id == venue_id)
                    .order_by(VenueTransitStop.sort_order, VenueTransitStop.id)
                ).all()
                if current is not None
                else []
            )
            changed = current is None or _different(current, values) or _transit_different(
                current_transit, transit
            )
            prepared.append((venue_id, current, values, transit, changed))
            if current is None:
                created += 1
            elif changed:
                updated += 1

        to_unlist = [
            venue
            for venue in existing
            if venue.id not in desired_ids
            and venue.booking_mode is BookingMode.DIRECTORY_ONLY
            and venue.is_listed
        ]
        result = LoadResult(
            created=created,
            updated=updated,
            unlisted=len(to_unlist),
            dry_run=dry_run,
        )
        if dry_run:
            self._session.rollback()
            return result

        for venue_id, current, values, transit, changed in prepared:
            if current is None:
                current = Venue(
                    id=venue_id,
                    **values,
                    is_active=True,
                )
                self._session.add(current)
            else:
                for key, value in values.items():
                    setattr(current, key, value)
            if changed:
                self._session.query(VenueTransitStop).filter(
                    VenueTransitStop.venue_id == venue_id
                ).delete(synchronize_session=False)
                self._session.add_all(VenueTransitStop(**values) for values in transit)
        for venue in to_unlist:
            venue.is_listed = False
        self._session.commit()
        self._session.expire_all()
        return result

    def unload(self, *, dry_run: bool) -> LoadResult:
        try:
            directory = self._session.scalars(
                select(Venue).where(Venue.booking_mode == BookingMode.DIRECTORY_ONLY)
            ).all()
            directory_ids = [venue.id for venue in directory]
            if directory_ids:
                pitch = self._session.scalar(
                    select(Pitch.id).where(Pitch.venue_id.in_(directory_ids)).limit(1)
                )
                if pitch is not None:
                    _reject("cannot unload directory venue with business history")
            result = LoadResult(deleted=len(directory), dry_run=dry_run)
            if dry_run:
                self._session.rollback()
                return result
            for venue in directory:
                self._session.delete(venue)
            self._session.commit()
            self._session.expire_all()
            return result
        except Exception:
            self._session.rollback()
            raise
