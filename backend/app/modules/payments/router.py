from __future__ import annotations

import json
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Annotated, cast

from fastapi import APIRouter, Depends, Header, Request, Response
from sqlalchemy.orm import Session

from backend.app.database import get_database
from backend.app.errors import AppError, ErrorEnvelope
from backend.app.models import User
from backend.app.modules.auth.router import get_current_user, get_phone_vault
from backend.app.modules.orders.dto import OrderDetailResponse
from backend.app.modules.orders.repository import OrderRepository
from backend.app.modules.orders.service import OrderService
from backend.app.modules.payments.convergence import PaymentConvergenceService
from backend.app.modules.payments.dto import (
    PaymentAlreadyConfirmedResponse,
    PaymentConfirmingResponse,
    PaymentPrepayCreatedResponse,
)
from backend.app.modules.payments.provider import PaymentProvider
from backend.app.modules.payments.reconciliation import PaymentReconciliationService
from backend.app.modules.payments.service import PaymentCreationService
from backend.app.security.phone_vault import PhoneVault

router = APIRouter(prefix="/api/v1/orders", tags=["payments"])


def get_payment_provider(request: Request) -> PaymentProvider:
    provider = request.app.state.payment_provider
    if provider is None:
        raise AppError(503, "PAYMENT_CREATE_FAILED", "支付创建失败，请稍后重试。")
    return cast(PaymentProvider, provider)


def get_payment_clock() -> datetime:
    return datetime.now(UTC)


@router.post(
    "/{order_id}/pay",
    response_model=PaymentPrepayCreatedResponse,
    status_code=201,
    responses={
        200: {"model": PaymentPrepayCreatedResponse | PaymentAlreadyConfirmedResponse},
        202: {"model": PaymentConfirmingResponse},
        401: {"model": ErrorEnvelope},
        404: {"model": ErrorEnvelope},
        409: {"model": ErrorEnvelope},
        503: {"model": ErrorEnvelope},
    },
)
def create_payment(
    order_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    database: Annotated[Session, Depends(get_database)],
    provider: Annotated[PaymentProvider, Depends(get_payment_provider)],
    phone_vault: Annotated[PhoneVault | None, Depends(get_phone_vault)],
    idempotency_key: Annotated[str, Header(alias="Idempotency-Key", min_length=16, max_length=128)],
) -> Response:
    factory = _session_factory(database)
    result = PaymentCreationService(session_factory=factory, provider=provider).create_payment(
        user_id=user.id,
        order_id=order_id,
        idempotency_key=idempotency_key,
        payer_openid=user.wechat_openid,
    )

    if result.status_code == 202:
        raw_payment_id = result.body.get("payment_id")
        if not isinstance(raw_payment_id, str):
            raise RuntimeError("confirming payment omitted payment_id")
        payment_id = uuid.UUID(raw_payment_id)
        immediate = _reconciliation(factory, provider).reconcile(
            user_id=user.id,
            order_id=order_id,
            payment_id=payment_id,
        )
        order = _order_projection(database, phone_vault, user.id, order_id)
        if immediate.status_code == 200 and order.status.value == "CONFIRMED":
            return _json_response(
                200,
                {
                    "order_id": str(order_id),
                    "status": "ALREADY_CONFIRMED",
                    "order": order.model_dump(mode="json"),
                },
            )
        return _json_response(
            202,
            {
                "order_id": str(order_id),
                "payment_id": str(payment_id),
                "status": "PAYMENT_CONFIRMING",
                "order": order.model_dump(mode="json"),
            },
        )

    body = dict(result.body)
    if body.get("status") == "ALREADY_CONFIRMED":
        body["order"] = _order_projection(database, phone_vault, user.id, order_id).model_dump(
            mode="json"
        )
    return _json_response(result.status_code, body)


@router.post(
    "/{order_id}/payments/{payment_id}/reconcile",
    response_model=OrderDetailResponse,
    responses={
        202: {"model": PaymentConfirmingResponse},
        401: {"model": ErrorEnvelope},
        404: {"model": ErrorEnvelope},
    },
)
def reconcile_payment(
    order_id: uuid.UUID,
    payment_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    database: Annotated[Session, Depends(get_database)],
    provider: Annotated[PaymentProvider, Depends(get_payment_provider)],
    phone_vault: Annotated[PhoneVault | None, Depends(get_phone_vault)],
) -> Response:
    result = _reconciliation(_session_factory(database), provider).reconcile(
        user_id=user.id,
        order_id=order_id,
        payment_id=payment_id,
    )
    order = _order_projection(database, phone_vault, user.id, order_id)
    if result.status_code == 200:
        return _json_response(200, order.model_dump(mode="json"))
    return _json_response(
        202,
        {
            "order_id": str(order_id),
            "payment_id": str(payment_id),
            "status": "PAYMENT_CONFIRMING",
            "order": order.model_dump(mode="json"),
        },
    )


def _reconciliation(
    factory: Callable[[], Session], provider: PaymentProvider
) -> PaymentReconciliationService:
    convergence = PaymentConvergenceService(
        session_factory=factory,
        expected_app_id=provider.app_id,
        expected_merchant_id=provider.merchant_id,
    )
    return PaymentReconciliationService(
        session_factory=factory,
        provider=provider,
        convergence=convergence,
    )


def _session_factory(database: Session) -> Callable[[], Session]:
    bind = database.get_bind()
    return lambda: Session(bind=bind)


def _order_projection(
    database: Session,
    phone_vault: PhoneVault | None,
    user_id: uuid.UUID,
    order_id: uuid.UUID,
) -> OrderDetailResponse:
    database.expire_all()
    return OrderService(
        repository=OrderRepository(database),
        phone_vault=phone_vault,
    ).get_order_detail(user_id=user_id, order_id=order_id)


def _json_response(status_code: int, body: dict[str, object]) -> Response:
    return Response(
        content=json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
        status_code=status_code,
        media_type="application/json",
    )
