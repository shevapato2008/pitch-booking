import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.app.database import get_database
from backend.app.modules.venues.dto import (
    PrimaryVenueResponse,
    VenueDetailResponse,
    VenueMapResponse,
)
from backend.app.modules.venues.repository import VenueRepository
from backend.app.modules.venues.service import PrimaryVenueService, VenueDirectoryService

router = APIRouter(prefix="/api/v1/venues", tags=["venues"])


@router.get("/primary", response_model=PrimaryVenueResponse)
def get_primary_venue(
    database: Annotated[Session, Depends(get_database)],
) -> PrimaryVenueResponse:
    return PrimaryVenueService(VenueRepository(database)).get_primary()


@router.get("/map", response_model=VenueMapResponse)
def get_venue_map(
    database: Annotated[Session, Depends(get_database)],
) -> VenueMapResponse:
    return VenueDirectoryService(VenueRepository(database)).get_map()


@router.get("/{venue_id}", response_model=VenueDetailResponse)
def get_venue_detail(
    venue_id: uuid.UUID,
    database: Annotated[Session, Depends(get_database)],
) -> VenueDetailResponse:
    return VenueDirectoryService(VenueRepository(database)).get_detail(venue_id)
