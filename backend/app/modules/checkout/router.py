import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from backend.app.database import get_database
from backend.app.errors import AppError, ErrorEnvelope
from backend.app.models import User
from backend.app.modules.auth.router import get_current_user, get_phone_vault
from backend.app.modules.checkout.dto import CheckoutResponse
from backend.app.modules.checkout.repository import CheckoutRepository
from backend.app.modules.checkout.service import CheckoutService
from backend.app.security.phone_vault import PhoneVault

router = APIRouter(prefix="/api/v1/slots", tags=["checkout"])


@router.get(
    "/{slot_id}/checkout",
    response_model=CheckoutResponse,
    responses={
        401: {"model": ErrorEnvelope},
        409: {"model": ErrorEnvelope},
    },
    openapi_extra={
        "parameters": [
            {
                "name": "slot_id",
                "in": "path",
                "required": True,
                "schema": {"type": "string", "format": "uuid"},
            }
        ]
    },
)
def get_slot_checkout(
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    database: Annotated[Session, Depends(get_database)],
    phone_vault: Annotated[PhoneVault | None, Depends(get_phone_vault)],
) -> CheckoutResponse:
    try:
        slot_id = uuid.UUID(request.path_params["slot_id"])
    except (KeyError, TypeError, ValueError, AttributeError):
        raise AppError(
            409,
            "SLOT_NOT_AVAILABLE",
            "所选时段已不可预订，请重新选择。",
        ) from None
    return CheckoutService(
        repository=CheckoutRepository(database),
        phone_vault=phone_vault,
    ).get_checkout(slot_id, user)
