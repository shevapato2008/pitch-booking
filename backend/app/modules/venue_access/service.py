from backend.app.models import User, VenueMembership, VenueMembershipRole
from backend.app.modules.venue_access.dto import (
    ManagedVenueResponse,
    ManagedVenuesResponse,
)
from backend.app.modules.venue_access.repository import VenueAccessRepository
from backend.app.modules.venue_staff.dto import VenueStaffPermission


def _permissions_for(membership: VenueMembership) -> list[VenueStaffPermission]:
    if membership.role is VenueMembershipRole.OWNER:
        return list(VenueStaffPermission)
    return [
        permission
        for permission, field_name in (
            (VenueStaffPermission.MANAGE_PROFILE, "can_manage_profile"),
            (VenueStaffPermission.MANAGE_PITCHES, "can_manage_pitches"),
            (VenueStaffPermission.MANAGE_INVENTORY, "can_manage_inventory"),
            (VenueStaffPermission.FULFILL_ORDERS, "can_fulfill_orders"),
        )
        if getattr(membership, field_name)
    ]


class VenueAccessService:
    def __init__(self, repository: VenueAccessRepository) -> None:
        self.repository = repository

    def list_managed_venues(self, user: User) -> ManagedVenuesResponse:
        rows = self.repository.list_managed_venues(user.id)
        return ManagedVenuesResponse(
            venues=[
                ManagedVenueResponse(
                    id=row.venue.id,
                    name=row.venue.name,
                    district_name=row.venue.district_name,
                    address=row.venue.address,
                    role=row.membership.role,
                    permissions=_permissions_for(row.membership),
                )
                for row in rows
            ]
        )
