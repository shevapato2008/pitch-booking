from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from backend.app.database import get_database
from backend.app.errors import AppError
from backend.app.modules.payments.convergence import PaymentConvergenceService
from backend.app.modules.payments.mock_provider import MockPaymentProvider
from backend.app.modules.payments.provider import (
    AuthoritativePaymentFacts,
    QueryPaymentResult,
    QueryPaymentStatus,
)
from backend.app.modules.payments.repository import PaymentRepository
from backend.app.modules.payments.router import get_payment_provider

router = APIRouter(prefix="/api/v1/development/payments", tags=["development"])


class DevelopmentAuthorityRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["SUCCESS", "CLOSED", "UNKNOWN"]
    provider_transaction_no: str | None = None


@router.post("/{payment_id}/authority", include_in_schema=False)
def drive_authority(
    payment_id: uuid.UUID,
    request: DevelopmentAuthorityRequest,
    database: Annotated[Session, Depends(get_database)],
    provider: Annotated[MockPaymentProvider, Depends(get_payment_provider)],
) -> dict[str, str]:
    payment = PaymentRepository(database).locate_payment(payment_id)
    if payment is None or payment.provider != provider.name:
        raise AppError(404, "ORDER_NOT_FOUND", "支付不存在或不可访问。")
    if request.status == "SUCCESS":
        transaction_no = request.provider_transaction_no or f"mock-tx-{payment.id.hex}"
        facts = AuthoritativePaymentFacts(
            app_id=provider.app_id,
            merchant_id=provider.merchant_id,
            merchant_order_no=payment.merchant_order_no,
            provider_transaction_no=transaction_no,
            amount_cents=payment.amount_cents,
            currency="CNY",
            paid_at=datetime.now(UTC),
        )
        result = QueryPaymentResult(QueryPaymentStatus.SUCCESS, facts=facts)
    elif request.status == "CLOSED":
        result = QueryPaymentResult(QueryPaymentStatus.CLOSED)
    else:
        result = QueryPaymentResult(
            QueryPaymentStatus.UNKNOWN,
            safe_error_code="MOCK_AUTHORITY_UNKNOWN",
        )
    bind = database.get_bind()
    converged = PaymentConvergenceService(
        session_factory=lambda: Session(bind=bind),
        expected_app_id=provider.app_id,
        expected_merchant_id=provider.merchant_id,
    ).converge(payment_id=payment.id, provider=provider.name, result=result)
    return {
        "order_id": str(converged.order_id),
        "payment_id": str(converged.payment_id),
        "status": request.status,
    }
