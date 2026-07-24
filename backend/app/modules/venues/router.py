from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.app.database import get_database
from backend.app.modules.venues.dto import PrimaryVenueResponse
from backend.app.modules.venues.repository import VenueRepository
from backend.app.modules.venues.service import PrimaryVenueService

router = APIRouter(prefix="/api/v1/venues", tags=["venues"])


@router.get("/primary", response_model=PrimaryVenueResponse)
def get_primary_venue(
    database: Annotated[Session, Depends(get_database)],
) -> PrimaryVenueResponse:
    return PrimaryVenueService(VenueRepository(database)).get_primary()
