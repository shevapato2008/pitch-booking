import uuid
from datetime import UTC, date, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from backend.app.database import get_database
from backend.app.errors import ErrorEnvelope
from backend.app.models import User
from backend.app.modules.auth.router import get_current_user, get_phone_vault
from backend.app.modules.venue_fulfillment.dto import VenueFulfillmentOrdersResponse
from backend.app.modules.venue_fulfillment.repository import (
    VenueFulfillmentRepository,
)
from backend.app.modules.venue_fulfillment.service import VenueFulfillmentService
from backend.app.security.phone_vault import PhoneVault

router = APIRouter(
    prefix="/api/v1/venues/{venue_id}/fulfillment/orders",
    tags=["venue-fulfillment"],
)


def get_fulfillment_clock() -> datetime:
    return datetime.now(UTC)


@router.get(
    "",
    response_model=VenueFulfillmentOrdersResponse,
    responses={
        401: {"model": ErrorEnvelope},
        404: {"model": ErrorEnvelope},
        422: {"model": ErrorEnvelope},
        503: {"model": ErrorEnvelope},
    },
)
def list_venue_fulfillment_orders(
    venue_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    database: Annotated[Session, Depends(get_database)],
    phone_vault: Annotated[PhoneVault | None, Depends(get_phone_vault)],
    now: Annotated[datetime, Depends(get_fulfillment_clock)],
    service_date: Annotated[date | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    cursor: Annotated[str | None, Query(min_length=1)] = None,
) -> VenueFulfillmentOrdersResponse:
    return VenueFulfillmentService(
        repository=VenueFulfillmentRepository(database),
        phone_vault=phone_vault,
        now=lambda: now,
    ).list_orders(
        user=user,
        venue_id=venue_id,
        service_date=service_date,
        limit=limit,
        cursor=cursor,
    )
