from backend.app.models import User
from backend.app.modules.venue_access.dto import (
    ManagedVenueResponse,
    ManagedVenuesResponse,
)
from backend.app.modules.venue_access.repository import VenueAccessRepository


class VenueAccessService:
    def __init__(self, repository: VenueAccessRepository) -> None:
        self.repository = repository

    def list_managed_venues(self, user: User) -> ManagedVenuesResponse:
        venues = self.repository.list_managed_venues(user.id)
        return ManagedVenuesResponse(
            venues=[
                ManagedVenueResponse(
                    id=venue.id,
                    name=venue.name,
                    district_name=venue.district_name,
                    address=venue.address,
                )
                for venue in venues
            ]
        )
