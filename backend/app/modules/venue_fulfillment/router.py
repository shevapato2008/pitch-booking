import uuid
from collections.abc import Callable
from datetime import UTC, date, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query, Response
from sqlalchemy.orm import Session

from backend.app.database import get_database
from backend.app.errors import ErrorEnvelope
from backend.app.models import User
from backend.app.modules.auth.router import get_current_user, get_phone_vault
from backend.app.modules.refunds.repository import RefundRepository
from backend.app.modules.venue_fulfillment.dto import (
    RefundAcceptedResponse,
    VenueFulfillmentOrderResponse,
    VenueFulfillmentOrdersResponse,
    VenueRefundRequest,
)
from backend.app.modules.venue_fulfillment.refund import VenueRefundService
from backend.app.modules.venue_fulfillment.repository import (
    VenueFulfillmentRepository,
)
from backend.app.modules.venue_fulfillment.service import VenueFulfillmentService
from backend.app.security.phone_vault import PhoneVault

router = APIRouter(
    prefix="/api/v1/venues/{venue_id}/fulfillment/orders",
    tags=["venue-fulfillment"],
)

refund_router = APIRouter(
    prefix="/api/v1/venues/{venue_id}/fulfillment/orders",
    tags=["venue-fulfillment"],
)


def get_fulfillment_clock() -> datetime:
    return datetime.now(UTC)


def get_refund_provider_name_resolver() -> Callable[[], str | None]:
    return lambda: None


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


@router.post(
    "/{order_id}/check-in",
    response_model=VenueFulfillmentOrderResponse,
    responses={
        401: {"model": ErrorEnvelope},
        404: {"model": ErrorEnvelope},
        409: {"model": ErrorEnvelope},
        503: {"model": ErrorEnvelope},
    },
)
def check_in_venue_order(
    venue_id: uuid.UUID,
    order_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    database: Annotated[Session, Depends(get_database)],
    phone_vault: Annotated[PhoneVault | None, Depends(get_phone_vault)],
    now: Annotated[datetime, Depends(get_fulfillment_clock)],
    idempotency_key: Annotated[
        str,
        Header(alias="Idempotency-Key", min_length=16, max_length=128),
    ],
) -> VenueFulfillmentOrderResponse:
    return VenueFulfillmentService(
        repository=VenueFulfillmentRepository(database),
        phone_vault=phone_vault,
        now=lambda: now,
    ).check_in_order(
        user=user,
        venue_id=venue_id,
        order_id=order_id,
        idempotency_key=idempotency_key,
    )


@router.post(
    "/{order_id}/complete",
    response_model=VenueFulfillmentOrderResponse,
    responses={
        401: {"model": ErrorEnvelope},
        404: {"model": ErrorEnvelope},
        409: {"model": ErrorEnvelope},
        503: {"model": ErrorEnvelope},
    },
)
def complete_venue_order(
    venue_id: uuid.UUID,
    order_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    database: Annotated[Session, Depends(get_database)],
    phone_vault: Annotated[PhoneVault | None, Depends(get_phone_vault)],
    now: Annotated[datetime, Depends(get_fulfillment_clock)],
    idempotency_key: Annotated[
        str,
        Header(alias="Idempotency-Key", min_length=16, max_length=128),
    ],
) -> VenueFulfillmentOrderResponse:
    return VenueFulfillmentService(
        repository=VenueFulfillmentRepository(database),
        phone_vault=phone_vault,
        now=lambda: now,
    ).complete_order(
        user=user,
        venue_id=venue_id,
        order_id=order_id,
        idempotency_key=idempotency_key,
    )


@refund_router.post(
    "/{order_id}/refund",
    response_model=RefundAcceptedResponse,
    status_code=202,
    responses={
        200: {"model": RefundAcceptedResponse},
        401: {"model": ErrorEnvelope},
        404: {"model": ErrorEnvelope},
        409: {"model": ErrorEnvelope},
        422: {"model": ErrorEnvelope},
        503: {"model": ErrorEnvelope},
    },
)
def refund_venue_order(
    venue_id: uuid.UUID,
    order_id: uuid.UUID,
    body: VenueRefundRequest,
    response: Response,
    user: Annotated[User, Depends(get_current_user)],
    database: Annotated[Session, Depends(get_database)],
    now: Annotated[datetime, Depends(get_fulfillment_clock)],
    provider_name_resolver: Annotated[
        Callable[[], str | None],
        Depends(get_refund_provider_name_resolver),
    ],
    idempotency_key: Annotated[
        str,
        Header(alias="Idempotency-Key", min_length=16, max_length=128),
    ],
) -> RefundAcceptedResponse:
    result = VenueRefundService(
        repository=VenueFulfillmentRepository(database),
        refund_repository=RefundRepository(database),
        provider_name_resolver=provider_name_resolver,
        now=lambda: now,
    ).request_refund(
        user=user,
        venue_id=venue_id,
        order_id=order_id,
        idempotency_key=idempotency_key,
        reason_note=body.reason_note,
    )
    response.status_code = result.status_code
    return result.response
