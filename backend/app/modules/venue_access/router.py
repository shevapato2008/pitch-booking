from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.app.database import get_database
from backend.app.errors import ErrorEnvelope
from backend.app.models import User
from backend.app.modules.auth.router import get_current_user
from backend.app.modules.venue_access.dto import ManagedVenuesResponse
from backend.app.modules.venue_access.repository import VenueAccessRepository
from backend.app.modules.venue_access.service import VenueAccessService

router = APIRouter(prefix="/api/v1/admin", tags=["venue-access"])


@router.get(
    "/venues",
    response_model=ManagedVenuesResponse,
    responses={401: {"model": ErrorEnvelope}},
)
def list_managed_venues(
    user: Annotated[User, Depends(get_current_user)],
    database: Annotated[Session, Depends(get_database)],
) -> ManagedVenuesResponse:
    return VenueAccessService(VenueAccessRepository(database)).list_managed_venues(user)
