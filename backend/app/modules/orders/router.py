import json
import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query, Response
from sqlalchemy.orm import Session

from backend.app.database import get_database
from backend.app.errors import ErrorEnvelope
from backend.app.models import User
from backend.app.modules.auth.router import get_current_user, get_phone_vault
from backend.app.modules.orders.dto import (
    CreateOrderRequest,
    OrderDetailResponse,
    OrderListResponse,
)
from backend.app.modules.orders.repository import OrderRepository
from backend.app.modules.orders.service import OrderService
from backend.app.security.phone_vault import PhoneVault

router = APIRouter(prefix="/api/v1/orders", tags=["orders"])


def get_order_clock() -> datetime:
    return datetime.now(UTC)


@router.get(
    "",
    response_model=OrderListResponse,
    responses={
        401: {"model": ErrorEnvelope},
        422: {"model": ErrorEnvelope},
        503: {"model": ErrorEnvelope},
    },
)
def list_orders(
    user: Annotated[User, Depends(get_current_user)],
    database: Annotated[Session, Depends(get_database)],
    now: Annotated[datetime, Depends(get_order_clock)],
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    cursor: Annotated[str | None, Query(min_length=1)] = None,
) -> OrderListResponse:
    return OrderService(
        repository=OrderRepository(database),
        phone_vault=None,
        now=lambda: now,
    ).list_orders(user_id=user.id, limit=limit, cursor=cursor)


@router.post(
    "",
    response_model=OrderDetailResponse,
    status_code=201,
    responses={
        200: {"model": OrderDetailResponse},
        401: {"model": ErrorEnvelope},
        409: {"model": ErrorEnvelope},
        422: {"model": ErrorEnvelope},
    },
)
def create_order(
    request_body: CreateOrderRequest,
    user: Annotated[User, Depends(get_current_user)],
    database: Annotated[Session, Depends(get_database)],
    phone_vault: Annotated[PhoneVault | None, Depends(get_phone_vault)],
    idempotency_key: Annotated[
        str,
        Header(alias="Idempotency-Key", min_length=16, max_length=128),
    ],
) -> Response:
    result = OrderService(
        repository=OrderRepository(database),
        phone_vault=phone_vault,
    ).create_order(
        user=user,
        idempotency_key=idempotency_key,
        request=request_body,
    )
    content = json.dumps(
        result.body,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return Response(
        content=content,
        status_code=result.status_code,
        media_type="application/json",
    )


@router.get(
    "/{order_id}",
    response_model=OrderDetailResponse,
    responses={
        401: {"model": ErrorEnvelope},
        404: {"model": ErrorEnvelope},
        422: {"model": ErrorEnvelope},
    },
)
def get_order_detail(
    order_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    database: Annotated[Session, Depends(get_database)],
    phone_vault: Annotated[PhoneVault | None, Depends(get_phone_vault)],
    now: Annotated[datetime, Depends(get_order_clock)],
) -> OrderDetailResponse:
    return OrderService(
        repository=OrderRepository(database),
        phone_vault=phone_vault,
        now=lambda: now,
    ).get_order_detail(user_id=user.id, order_id=order_id)
