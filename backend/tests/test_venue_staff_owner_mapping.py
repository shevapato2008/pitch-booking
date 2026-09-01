import json
import uuid
from pathlib import Path

import pytest

from backend.app.models import VenueMembershipRole
from backend.app.modules.venue_staff.owner_mapping import (
    MembershipMappingState,
    OwnerMappingEntry,
    OwnerMappingError,
    apply_validated_owner_mapping,
    load_owner_mapping,
    validate_owner_mapping,
)

VENUE_A = uuid.UUID("10000000-0000-0000-0000-000000000001")
VENUE_B = uuid.UUID("10000000-0000-0000-0000-000000000002")
MEMBER_A = uuid.UUID("20000000-0000-0000-0000-000000000001")
MEMBER_B = uuid.UUID("20000000-0000-0000-0000-000000000002")


def state(
    membership_id: uuid.UUID,
    venue_id: uuid.UUID,
    *,
    active: bool = True,
    role: VenueMembershipRole = VenueMembershipRole.STAFF,
) -> MembershipMappingState:
    return MembershipMappingState(
        membership_id=membership_id,
        venue_id=venue_id,
        is_active=active,
        role=role,
    )


@pytest.mark.parametrize(
    ("entries", "managed", "memberships", "code"),
    [
        ([], {VENUE_A}, [state(MEMBER_A, VENUE_A)], "OWNER_MAPPING_MISSING"),
        (
            [OwnerMappingEntry(VENUE_A, MEMBER_A), OwnerMappingEntry(VENUE_A, MEMBER_B)],
            {VENUE_A},
            [state(MEMBER_A, VENUE_A), state(MEMBER_B, VENUE_A)],
            "OWNER_MAPPING_DUPLICATE_VENUE",
        ),
        (
            [OwnerMappingEntry(VENUE_A, MEMBER_A), OwnerMappingEntry(VENUE_B, MEMBER_A)],
            {VENUE_A, VENUE_B},
            [state(MEMBER_A, VENUE_A), state(MEMBER_B, VENUE_B)],
            "OWNER_MAPPING_DUPLICATE_MEMBERSHIP",
        ),
        (
            [OwnerMappingEntry(VENUE_B, MEMBER_A)],
            {VENUE_B},
            [state(MEMBER_A, VENUE_A), state(MEMBER_B, VENUE_B)],
            "OWNER_MAPPING_CROSS_VENUE",
        ),
        (
            [OwnerMappingEntry(VENUE_A, MEMBER_A)],
            {VENUE_A},
            [state(MEMBER_A, VENUE_A, active=False)],
            "OWNER_MAPPING_INACTIVE",
        ),
        (
            [OwnerMappingEntry(VENUE_A, MEMBER_A)],
            {VENUE_A},
            [
                state(MEMBER_A, VENUE_A),
                state(MEMBER_B, VENUE_A, role=VenueMembershipRole.OWNER),
            ],
            "OWNER_MAPPING_CONFLICT",
        ),
    ],
)
def test_owner_mapping_rejects_unsafe_historical_inference(
    entries: list[OwnerMappingEntry],
    managed: set[uuid.UUID],
    memberships: list[MembershipMappingState],
    code: str,
) -> None:
    with pytest.raises(OwnerMappingError) as captured:
        validate_owner_mapping(entries, managed_venue_ids=managed, memberships=memberships)

    assert captured.value.code == code


def test_owner_mapping_apply_is_idempotent_and_grants_owner_all_capabilities() -> None:
    memberships = [state(MEMBER_A, VENUE_A)]
    validated = validate_owner_mapping(
        [OwnerMappingEntry(VENUE_A, MEMBER_A)],
        managed_venue_ids={VENUE_A},
        memberships=memberships,
    )
    first = apply_validated_owner_mapping(validated, memberships)
    second = apply_validated_owner_mapping(validated, first)

    assert first == second
    assert first[0].role is VenueMembershipRole.OWNER
    assert first[0].permissions == (
        True,
        True,
        True,
        True,
    )


def test_mapping_document_is_closed_and_requires_canonical_unique_entries(
    tmp_path: Path,
) -> None:
    mapping_path = tmp_path / "owner-mapping.json"
    mapping_path.write_text(
        json.dumps(
            {
                "owners": [
                    {
                        "venue_id": str(VENUE_A),
                        "membership_id": str(MEMBER_A),
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    assert load_owner_mapping(mapping_path) == [OwnerMappingEntry(VENUE_A, MEMBER_A)]

    mapping_path.write_text(
        json.dumps({"owners": [], "unexpected": True}),
        encoding="utf-8",
    )
    with pytest.raises(OwnerMappingError) as captured:
        load_owner_mapping(mapping_path)
    assert captured.value.code == "OWNER_MAPPING_INVALID"
