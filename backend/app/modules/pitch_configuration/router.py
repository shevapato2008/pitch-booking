import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Header
from sqlalchemy.orm import Session

from backend.app.database import get_database
from backend.app.errors import ErrorEnvelope
from backend.app.models import User
from backend.app.modules.auth.router import get_current_user
from backend.app.modules.pitch_configuration.dto import (
    PitchConfigurationResponse,
    SavePitchConfigurationRequest,
)
from backend.app.modules.pitch_configuration.repository import PitchConfigurationRepository
from backend.app.modules.pitch_configuration.service import PitchConfigurationService

router = APIRouter(prefix="/api/v1/admin/venues", tags=["pitch-configuration"])


@router.get(
    "/{venue_id}/pitch-configuration",
    response_model=PitchConfigurationResponse,
    responses={401: {"model": ErrorEnvelope}, 403: {"model": ErrorEnvelope}},
)
def get_pitch_configuration(
    venue_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    database: Annotated[Session, Depends(get_database)],
) -> PitchConfigurationResponse:
    return PitchConfigurationService(PitchConfigurationRepository(database)).get(
        venue_id=venue_id, user=user
    )


@router.put(
    "/{venue_id}/pitch-configuration",
    response_model=PitchConfigurationResponse,
    responses={401: {"model": ErrorEnvelope}, 403: {"model": ErrorEnvelope}},
)
def save_pitch_configuration(
    venue_id: uuid.UUID,
    request_body: SavePitchConfigurationRequest,
    user: Annotated[User, Depends(get_current_user)],
    database: Annotated[Session, Depends(get_database)],
    idempotency_key: Annotated[str, Header(alias="Idempotency-Key", min_length=16, max_length=128)],
) -> PitchConfigurationResponse:
    return PitchConfigurationService(PitchConfigurationRepository(database)).save(
        venue_id=venue_id,
        user=user,
        request=request_body,
        idempotency_key=idempotency_key,
    )
