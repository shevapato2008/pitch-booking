import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from backend.app.database import get_database
from backend.app.modules.availability.dto import AvailabilityResponse
from backend.app.modules.availability.repository import AvailabilityRepository
from backend.app.modules.availability.service import AvailabilityService

router = APIRouter(prefix="/api/v1/venues", tags=["availability"])


@router.get("/{venue_id}/availability", response_model=AvailabilityResponse)
def get_availability(
    venue_id: uuid.UUID,
    database: Annotated[Session, Depends(get_database)],
    date: Annotated[str, Query(min_length=1)],
    pitch_type: Annotated[str, Query(min_length=1)],
) -> AvailabilityResponse:
    return AvailabilityService(AvailabilityRepository(database)).get_availability(
        venue_id, date, pitch_type
    )
