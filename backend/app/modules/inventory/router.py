import uuid
from datetime import UTC, date, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query
from sqlalchemy.orm import Session

from backend.app.database import get_database
from backend.app.errors import ErrorEnvelope
from backend.app.models import User
from backend.app.modules.auth.router import get_current_user
from backend.app.modules.inventory.dto import (
    CreateInventorySlotRequest,
    InventoryResponse,
    InventorySlotResponse,
    UpdateInventorySlotRequest,
)
from backend.app.modules.inventory.repository import InventoryRepository
from backend.app.modules.inventory.service import InventoryService

router = APIRouter(prefix="/api/v1/admin/venues", tags=["admin-inventory"])


def get_inventory_clock() -> datetime:
    return datetime.now(UTC)


@router.get(
    "/{venue_id}/inventory",
    response_model=InventoryResponse,
    responses={401: {"model": ErrorEnvelope}, 403: {"model": ErrorEnvelope}},
)
def get_inventory(
    venue_id: uuid.UUID,
    local_date: Annotated[date, Query()],
    user: Annotated[User, Depends(get_current_user)],
    database: Annotated[Session, Depends(get_database)],
    now: Annotated[datetime, Depends(get_inventory_clock)],
    pitch_id: Annotated[uuid.UUID | None, Query()] = None,
) -> InventoryResponse:
    return InventoryService(
        InventoryRepository(database), now=lambda timezone: now.astimezone(timezone)
    ).get_inventory(
        venue_id=venue_id, user=user, local_date=local_date, pitch_id=pitch_id
    )


@router.post(
    "/{venue_id}/inventory/slots",
    response_model=InventorySlotResponse,
    status_code=201,
    responses={401: {"model": ErrorEnvelope}, 403: {"model": ErrorEnvelope}},
)
def create_inventory_slot(
    venue_id: uuid.UUID,
    request_body: CreateInventorySlotRequest,
    user: Annotated[User, Depends(get_current_user)],
    database: Annotated[Session, Depends(get_database)],
    now: Annotated[datetime, Depends(get_inventory_clock)],
    idempotency_key: Annotated[
        str, Header(alias="Idempotency-Key", min_length=16, max_length=128)
    ],
) -> InventorySlotResponse:
    return InventoryService(
        InventoryRepository(database), now=lambda timezone: now.astimezone(timezone)
    ).create_slot(
        venue_id=venue_id,
        user=user,
        request=request_body,
        idempotency_key=idempotency_key,
    )


@router.put(
    "/{venue_id}/inventory/slots/{slot_id}",
    response_model=InventorySlotResponse,
    responses={401: {"model": ErrorEnvelope}, 403: {"model": ErrorEnvelope}},
)
def update_inventory_slot(
    venue_id: uuid.UUID,
    slot_id: uuid.UUID,
    request_body: UpdateInventorySlotRequest,
    user: Annotated[User, Depends(get_current_user)],
    database: Annotated[Session, Depends(get_database)],
    now: Annotated[datetime, Depends(get_inventory_clock)],
) -> InventorySlotResponse:
    return InventoryService(
        InventoryRepository(database), now=lambda timezone: now.astimezone(timezone)
    ).update_slot(
        venue_id=venue_id, slot_id=slot_id, user=user, request=request_body
    )
