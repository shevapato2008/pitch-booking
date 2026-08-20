import json
import uuid
from contextlib import suppress
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, Query, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from backend.app.database import get_database
from backend.app.errors import AppError, ErrorEnvelope
from backend.app.models import User
from backend.app.modules.auth.repository import AuthRepository
from backend.app.modules.auth.router import get_current_user, get_phone_vault
from backend.app.modules.auth.service import resolve_authenticated_user
from backend.app.modules.orders.cancellation import OrderCancellationService
from backend.app.modules.orders.dto import (
    CreateOrderRequest,
    CreateOrderResponse,
    OrderDetailResponse,
    OrderListResponse,
)
from backend.app.modules.orders.repository import OrderRepository
from backend.app.modules.orders.service import OrderService
from backend.app.modules.refunds.repository import RefundRepository
from backend.app.security.phone_vault import PhoneVault

router = APIRouter(prefix="/api/v1/orders", tags=["orders"])
_order_list_bearer = HTTPBearer(
    auto_error=False,
    scheme_name="bearerAuth",
    bearerFormat="opaque",
)


def get_order_clock() -> datetime:
    return datetime.now(UTC)


def align_order_list_openapi(schema: dict[str, Any]) -> None:
    request_id_header = {"$ref": "#/components/headers/RequestId"}

    def error_response(
        description: str,
        *,
        code: str,
        example_name: str,
        example_file: str,
    ) -> dict[str, Any]:
        return {
            "description": description,
            "headers": {"X-Request-Id": request_id_header},
            "content": {
                "application/json": {
                    "schema": {
                        "allOf": [
                            {"$ref": "#/components/schemas/ErrorEnvelope"},
                            {
                                "type": "object",
                                "properties": {
                                    "error": {
                                        "type": "object",
                                        "properties": {"code": {"const": code}},
                                    }
                                },
                            },
                        ]
                    },
                    "examples": {
                        example_name: {"externalValue": f"./examples/{example_file}"}
                    },
                }
            },
        }

    schema["paths"]["/api/v1/orders"]["get"] = {
        "operationId": "listOrders",
        "description": (
            "Lists newest-first orders owned by the current authenticated user."
        ),
        "security": [{"bearerAuth": []}],
        "parameters": [
            {
                "name": "limit",
                "in": "query",
                "required": False,
                "schema": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 50,
                    "default": 20,
                },
            },
            {
                "name": "cursor",
                "in": "query",
                "required": False,
                "description": "Opaque cursor returned by the previous page.",
                "schema": {"type": "string", "minLength": 1},
            },
        ],
        "responses": {
            "200": {
                "description": (
                    "Owner-only order summaries ordered by created_at and id "
                    "descending."
                ),
                "headers": {"X-Request-Id": request_id_header},
                "content": {
                    "application/json": {
                        "schema": {
                            "$ref": "#/components/schemas/OrderListResponse"
                        },
                        "examples": {
                            "Ready": {
                                "externalValue": "./examples/my-orders-ready.json"
                            },
                            "Empty": {
                                "externalValue": "./examples/my-orders-empty.json"
                            },
                        },
                    }
                },
            },
            "401": error_response(
                "Business session is missing, invalid, or expired.",
                code="AUTH_REQUIRED",
                example_name="AuthRequired",
                example_file="error-auth-required.json",
            ),
            "422": error_response(
                "Cursor or limit is invalid.",
                code="INVALID_ARGUMENT",
                example_name="InvalidArgument",
                example_file="error-invalid-argument.json",
            ),
            "503": error_response(
                "Order list service is temporarily unavailable.",
                code="SERVICE_UNAVAILABLE",
                example_name="ServiceUnavailable",
                example_file="error-service-unavailable.json",
            ),
        },
    }

    components = schema["components"]
    components.setdefault("securitySchemes", {})["bearerAuth"] = {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "opaque",
    }
    components.setdefault("headers", {})["RequestId"] = {
        "description": "Identifier used to trace the request.",
        "required": True,
        "schema": {"type": "string", "minLength": 1},
    }
    identity_schema = {
        "type": "object",
        "additionalProperties": False,
        "required": ["id", "name"],
        "properties": {
            "id": {"type": "string", "format": "uuid"},
            "name": {"type": "string", "minLength": 1},
        },
    }
    components["schemas"].update(
        {
            "CheckoutVenue": identity_schema,
            "PhysicalPitch": identity_schema,
            "OrderSummary": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "id",
                    "order_number",
                    "status",
                    "venue",
                    "pitch",
                    "starts_at",
                    "ends_at",
                    "price_cents",
                    "currency",
                    "created_at",
                    "expires_at",
                    "payment_confirming",
                    "closing_payment",
                    "cancel_requested_at",
                    "cancelled_at",
                    "checked_in_at",
                    "completed_at",
                    "allowed_actions",
                    "funding_alerts",
                ],
                "properties": {
                    "id": {"type": "string", "format": "uuid"},
                    "order_number": {"type": "string", "minLength": 1},
                    "status": {
                        "type": "string",
                        "enum": [
                            "PENDING_PAYMENT",
                            "CONFIRMED",
                            "EXPIRED",
                            "PAYMENT_EXCEPTION",
                            "CANCELLED",
                            "REFUND_PENDING",
                            "REFUND_FAILED",
                            "REFUNDED",
                            "COMPLETED",
                        ],
                    },
                    "venue": {"$ref": "#/components/schemas/CheckoutVenue"},
                    "pitch": {"$ref": "#/components/schemas/PhysicalPitch"},
                    "starts_at": {"type": "string", "format": "date-time"},
                    "ends_at": {"type": "string", "format": "date-time"},
                    "price_cents": {"type": "integer", "minimum": 0},
                    "currency": {"type": "string", "const": "CNY"},
                    "created_at": {"type": "string", "format": "date-time"},
                    "expires_at": {"type": "string", "format": "date-time"},
                    "payment_confirming": {"type": "boolean"},
                    "closing_payment": {"type": "boolean"},
                    "cancel_requested_at": {
                        "type": ["string", "null"],
                        "format": "date-time",
                    },
                    "cancelled_at": {
                        "type": ["string", "null"],
                        "format": "date-time",
                    },
                    "checked_in_at": {
                        "type": ["string", "null"],
                        "format": "date-time",
                    },
                    "completed_at": {
                        "type": ["string", "null"],
                        "format": "date-time",
                    },
                    "allowed_actions": {
                        "$ref": "#/components/schemas/OrderAllowedActions"
                    },
                    "funding_alerts": {
                        "type": "array",
                        "items": {"$ref": "#/components/schemas/FundingAlert"},
                    },
                },
            },
            "OrderAllowedActions": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "can_pay",
                    "can_cancel",
                    "can_check_in",
                    "can_complete",
                    "can_refund",
                    "blocked_reason",
                ],
                "properties": {
                    "can_pay": {"type": "boolean"},
                    "can_cancel": {"type": "boolean"},
                    "can_check_in": {"type": "boolean"},
                    "can_complete": {"type": "boolean"},
                    "can_refund": {"type": "boolean"},
                    "blocked_reason": {
                        "type": ["string", "null"],
                        "enum": [
                            "PAYMENT_RESULT_PENDING",
                            "CANCELLATION_WINDOW_CLOSED",
                            "CANCELLATION_REQUIRES_SUPPORT",
                            "CHECK_IN_TOO_EARLY",
                            "CHECK_IN_REQUIRED",
                            "SESSION_NOT_ENDED",
                            "ORDER_TERMINAL",
                            "REFUND_IN_PROGRESS",
                            None,
                        ],
                    },
                },
            },
            "FundingAlert": {
                "type": "object",
                "additionalProperties": False,
                "required": ["code", "status"],
                "properties": {
                    "code": {
                        "type": "string",
                        "const": "DUPLICATE_CHARGE_REFUND",
                    },
                    "status": {
                        "type": "string",
                        "enum": ["REFUND_PENDING", "REFUND_FAILED", "REFUNDED"],
                    },
                },
            },
            "OrderListResponse": {
                "type": "object",
                "additionalProperties": False,
                "required": ["orders", "next_cursor"],
                "properties": {
                    "orders": {
                        "type": "array",
                        "items": {"$ref": "#/components/schemas/OrderSummary"},
                    },
                    "next_cursor": {
                        "type": ["string", "null"],
                        "minLength": 1,
                    },
                },
            },
        }
    )


def get_order_list_current_user(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None,
        Depends(_order_list_bearer),
    ],
    database: Annotated[Session, Depends(get_database)],
) -> User:
    token = (
        credentials.credentials
        if credentials is not None and credentials.scheme.casefold() == "bearer"
        else None
    )
    try:
        return resolve_authenticated_user(AuthRepository(database), token)
    except SQLAlchemyError:
        with suppress(Exception):
            database.rollback()
        raise AppError(
            503,
            "SERVICE_UNAVAILABLE",
            "订单服务暂不可用，请稍后重试。",
        ) from None


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
    user: Annotated[User, Depends(get_order_list_current_user)],
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
    response_model=CreateOrderResponse,
    status_code=201,
    responses={
        200: {"model": CreateOrderResponse},
        401: {"model": ErrorEnvelope},
        404: {"model": ErrorEnvelope},
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


@router.post(
    "/{order_id}/cancel",
    operation_id="cancelOwnedOrder",
    response_model=OrderDetailResponse,
    responses={
        202: {"model": OrderDetailResponse},
        401: {"model": ErrorEnvelope},
        404: {"model": ErrorEnvelope},
        409: {"model": ErrorEnvelope},
        503: {"model": ErrorEnvelope},
    },
)
def cancel_owned_order(
    order_id: uuid.UUID,
    user: Annotated[User, Depends(get_order_list_current_user)],
    database: Annotated[Session, Depends(get_database)],
    phone_vault: Annotated[PhoneVault | None, Depends(get_phone_vault)],
    now: Annotated[datetime, Depends(get_order_clock)],
    idempotency_key: Annotated[
        str,
        Header(alias="Idempotency-Key", min_length=16, max_length=128),
    ],
) -> Response:
    order_repository = OrderRepository(database)
    detail_service = OrderService(
        repository=order_repository,
        phone_vault=phone_vault,
        now=lambda: now,
    )
    result = OrderCancellationService(
        order_repository=order_repository,
        refund_repository=RefundRepository(database),
        project_order_detail=lambda order, slot: detail_service._order_response(
            order,
            slot,
        ),
        now=lambda: now,
    ).cancel_owned_order(
        user_id=user.id,
        order_id=order_id,
        idempotency_key=idempotency_key,
    )
    content = json.dumps(
        result.response.model_dump(mode="json"),
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
