from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, replace
from pathlib import Path

from pydantic import BaseModel, ConfigDict, ValidationError
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from backend.app.models import Venue, VenueMembership, VenueMembershipRole


class OwnerMappingError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(code)
        self.code = code
        self.message = message


@dataclass(frozen=True, slots=True)
class OwnerMappingEntry:
    venue_id: uuid.UUID
    membership_id: uuid.UUID


@dataclass(frozen=True, slots=True)
class MembershipMappingState:
    membership_id: uuid.UUID
    venue_id: uuid.UUID
    is_active: bool
    role: VenueMembershipRole
    can_manage_profile: bool = False
    can_manage_pitches: bool = False
    can_manage_inventory: bool = False
    can_fulfill_orders: bool = False
    version: int = 1

    @property
    def permissions(self) -> tuple[bool, bool, bool, bool]:
        return (
            self.can_manage_profile,
            self.can_manage_pitches,
            self.can_manage_inventory,
            self.can_fulfill_orders,
        )


@dataclass(frozen=True, slots=True)
class ValidatedOwnerMapping:
    entries: tuple[OwnerMappingEntry, ...]


@dataclass(frozen=True, slots=True)
class OwnerMappingReport:
    managed_venue_count: int
    mapped_owner_count: int
    changed_membership_count: int
    applied: bool


class _OwnerEntryDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    venue_id: uuid.UUID
    membership_id: uuid.UUID


class _OwnerMappingDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    owners: list[_OwnerEntryDocument]


def load_owner_mapping(path: Path) -> list[OwnerMappingEntry]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        document = _OwnerMappingDocument.model_validate(raw)
    except (OSError, json.JSONDecodeError, ValidationError) as error:
        raise OwnerMappingError(
            "OWNER_MAPPING_INVALID",
            "负责人映射文件无效。",
        ) from error
    return [
        OwnerMappingEntry(
            venue_id=entry.venue_id,
            membership_id=entry.membership_id,
        )
        for entry in document.owners
    ]


def validate_owner_mapping(
    entries: list[OwnerMappingEntry],
    *,
    managed_venue_ids: set[uuid.UUID],
    memberships: list[MembershipMappingState],
) -> ValidatedOwnerMapping:
    seen_venues: set[uuid.UUID] = set()
    seen_memberships: set[uuid.UUID] = set()
    for entry in entries:
        if entry.venue_id in seen_venues:
            raise OwnerMappingError(
                "OWNER_MAPPING_DUPLICATE_VENUE",
                "同一场馆只能映射一个负责人。",
            )
        if entry.membership_id in seen_memberships:
            raise OwnerMappingError(
                "OWNER_MAPPING_DUPLICATE_MEMBERSHIP",
                "同一成员不能映射到多个场馆。",
            )
        seen_venues.add(entry.venue_id)
        seen_memberships.add(entry.membership_id)

    missing = managed_venue_ids - seen_venues
    if missing:
        raise OwnerMappingError(
            "OWNER_MAPPING_MISSING",
            "存在尚未映射负责人的场馆。",
        )
    if seen_venues - managed_venue_ids:
        raise OwnerMappingError(
            "OWNER_MAPPING_UNKNOWN_VENUE",
            "映射包含不存在、停用或不可管理的场馆。",
        )

    membership_by_id = {item.membership_id: item for item in memberships}
    for entry in entries:
        membership = membership_by_id.get(entry.membership_id)
        if membership is None:
            raise OwnerMappingError(
                "OWNER_MAPPING_NOT_FOUND",
                "映射中的成员不存在。",
            )
        if membership.venue_id != entry.venue_id:
            raise OwnerMappingError(
                "OWNER_MAPPING_CROSS_VENUE",
                "成员不属于映射的场馆。",
            )
        if not membership.is_active:
            raise OwnerMappingError(
                "OWNER_MAPPING_INACTIVE",
                "停用成员不能成为场馆负责人。",
            )
        conflicting_owner = next(
            (
                item
                for item in memberships
                if item.venue_id == entry.venue_id
                and item.is_active
                and item.role is VenueMembershipRole.OWNER
                and item.membership_id != entry.membership_id
            ),
            None,
        )
        if conflicting_owner is not None:
            raise OwnerMappingError(
                "OWNER_MAPPING_CONFLICT",
                "场馆已有其他负责人，不能用历史回填覆盖。",
            )

    return ValidatedOwnerMapping(entries=tuple(entries))


def apply_validated_owner_mapping(
    mapping: ValidatedOwnerMapping,
    memberships: list[MembershipMappingState],
) -> list[MembershipMappingState]:
    owner_ids = {entry.membership_id for entry in mapping.entries}
    return [
        (
            item
            if item.membership_id not in owner_ids
            or (
                item.role is VenueMembershipRole.OWNER
                and item.permissions == (True, True, True, True)
            )
            else replace(
                item,
                role=VenueMembershipRole.OWNER,
                can_manage_profile=True,
                can_manage_pitches=True,
                can_manage_inventory=True,
                can_fulfill_orders=True,
                version=item.version + 1,
            )
        )
        for item in memberships
    ]


def backfill_venue_staff_owners(
    session: Session,
    entries: list[OwnerMappingEntry],
    *,
    apply: bool,
) -> OwnerMappingReport:
    managed_venues = list(
        session.scalars(
            select(Venue)
            .where(
                Venue.is_active.is_(True),
                select(VenueMembership.id)
                .where(
                    VenueMembership.venue_id == Venue.id,
                    VenueMembership.is_active.is_(True),
                )
                .exists(),
            )
            .order_by(Venue.id)
            .with_for_update()
        )
    )
    managed_venue_ids = {item.id for item in managed_venues}
    mapped_membership_ids = {entry.membership_id for entry in entries}
    membership_records = list(
        session.scalars(
            select(VenueMembership)
            .where(
                or_(
                    VenueMembership.venue_id.in_(managed_venue_ids),
                    VenueMembership.id.in_(mapped_membership_ids),
                )
            )
            .order_by(VenueMembership.venue_id, VenueMembership.id)
            .with_for_update()
        )
    )
    states = [_mapping_state(item) for item in membership_records]
    validated = validate_owner_mapping(
        entries,
        managed_venue_ids=managed_venue_ids,
        memberships=states,
    )
    projected = apply_validated_owner_mapping(validated, states)
    projected_by_id = {item.membership_id: item for item in projected}
    changed = 0
    for record in membership_records:
        target = projected_by_id[record.id]
        if _mapping_state(record) == target:
            continue
        record.role = target.role
        record.can_manage_profile = target.can_manage_profile
        record.can_manage_pitches = target.can_manage_pitches
        record.can_manage_inventory = target.can_manage_inventory
        record.can_fulfill_orders = target.can_fulfill_orders
        record.version = target.version
        changed += 1

    if apply:
        session.commit()
    else:
        session.rollback()
    return OwnerMappingReport(
        managed_venue_count=len(managed_venue_ids),
        mapped_owner_count=len(entries),
        changed_membership_count=changed,
        applied=apply,
    )


def owner_mapping_is_complete(session: Session) -> bool:
    managed_venue_ids = set(
        session.scalars(
            select(Venue.id).where(
                Venue.is_active.is_(True),
                select(VenueMembership.id)
                .where(
                    VenueMembership.venue_id == Venue.id,
                    VenueMembership.is_active.is_(True),
                )
                .exists(),
            )
        )
    )
    owner_venue_ids = list(
        session.scalars(
            select(VenueMembership.venue_id).where(
                VenueMembership.is_active.is_(True),
                VenueMembership.role == VenueMembershipRole.OWNER,
            )
        )
    )
    return len(owner_venue_ids) == len(set(owner_venue_ids)) and set(
        owner_venue_ids
    ) == managed_venue_ids


def _mapping_state(record: VenueMembership) -> MembershipMappingState:
    return MembershipMappingState(
        membership_id=record.id,
        venue_id=record.venue_id,
        is_active=record.is_active,
        role=record.role,
        can_manage_profile=record.can_manage_profile,
        can_manage_pitches=record.can_manage_pitches,
        can_manage_inventory=record.can_manage_inventory,
        can_fulfill_orders=record.can_fulfill_orders,
        version=record.version,
    )
