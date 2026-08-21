import json
from importlib import import_module
from pathlib import Path
from typing import Any, Protocol, cast

from jsonschema import Draft202012Validator

from backend.app.config import Settings
from backend.app.main import create_app

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
CONTRACT_PATH = REPOSITORY_ROOT / "contracts" / "openapi.yaml"
EXAMPLES_DIRECTORY = CONTRACT_PATH.parent / "examples"


class _YamlLoader(Protocol):
    def safe_load(self, stream: str) -> object: ...


YAML = cast(_YamlLoader, import_module("yaml"))


def _contract() -> dict[str, Any]:
    loaded = YAML.safe_load(CONTRACT_PATH.read_text())
    if not isinstance(loaded, dict):
        raise TypeError("OpenAPI contract root must be an object")
    return cast(dict[str, Any], loaded)


def _resolve_schema(contract: dict[str, Any], schema: dict[str, Any]) -> dict[str, Any]:
    reference = schema.get("$ref")
    if reference is None:
        return schema
    assert reference.startswith("#/components/schemas/")
    return cast(
        dict[str, Any], contract["components"]["schemas"][reference.rsplit("/", 1)[-1]]
    )


def _response_schema(operation: dict[str, Any], status: str) -> dict[str, Any]:
    return cast(
        dict[str, Any],
        operation["responses"][status]["content"]["application/json"]["schema"],
    )


def _assert_example_matches_schema(
    contract: dict[str, Any], value: Any, raw_schema: dict[str, Any]
) -> None:
    schema = _resolve_schema(contract, raw_schema)
    if "const" in schema:
        assert value == schema["const"]
    if "enum" in schema:
        assert value in schema["enum"]
    schema_type = schema.get("type")
    if isinstance(schema_type, list):
        if value is None:
            assert "null" in schema_type
            return
        schema_type = next(item for item in schema_type if item != "null")
    if schema_type == "object":
        assert isinstance(value, dict)
        required = set(schema.get("required", []))
        assert required <= set(value)
        if schema.get("additionalProperties") is False:
            assert set(value) <= set(schema.get("properties", {}))
        for key, child in value.items():
            if child_schema := schema.get("properties", {}).get(key):
                _assert_example_matches_schema(contract, child, child_schema)
    elif schema_type == "array":
        assert isinstance(value, list)
        for child in value:
            _assert_example_matches_schema(contract, child, schema["items"])
    elif schema_type == "string":
        assert isinstance(value, str)
    elif schema_type == "integer":
        assert isinstance(value, int) and not isinstance(value, bool)
    elif schema_type == "number":
        assert isinstance(value, int | float) and not isinstance(value, bool)
    elif schema_type == "boolean":
        assert isinstance(value, bool)


def test_openapi_exposes_only_implemented_slice_paths() -> None:
    schema = create_app().openapi()
    paths = schema["paths"]

    assert "/api/v1/health" in paths
    assert "/api/v1/venues/primary" in paths
    assert "/api/v1/venues/{venue_id}/availability" in paths
    assert set(paths["/api/v1/venues/primary"]) == {"get"}


def test_platform_onboarding_review_contract_is_closed_and_runtime_aligned() -> None:
    contract = _contract()
    paths = contract["paths"]
    schemas = contract["components"]["schemas"]
    expected = {
        "/platform-admin/api/v1/onboarding/applications": {"get"},
        "/platform-admin/api/v1/onboarding/applications/{application_id}": {"get"},
        "/platform-admin/api/v1/onboarding/evidence/{evidence_id}/download": {"get"},
        "/platform-admin/api/v1/onboarding/applications/{application_id}/decisions": {"post"},
    }
    assert {path: set(paths[path]) for path in expected} == expected
    for path, methods in expected.items():
        for method in methods:
            operation = paths[path][method]
            assert operation["security"] == [{"platformSession": []}]
            assert "401" in operation["responses"]
            assert "403" in operation["responses"]

    queue_operation = paths["/platform-admin/api/v1/onboarding/applications"]["get"]
    parameters = {parameter["name"]: parameter for parameter in queue_operation["parameters"]}
    assert parameters["limit"]["schema"] == {
        "type": "integer",
        "minimum": 1,
        "maximum": 50,
        "default": 20,
    }
    assert parameters["kind"]["schema"]["enum"] == ["CLAIM", "CREATE"]
    assert parameters["status"]["schema"]["enum"] == [
        "SUBMITTED",
        "APPROVED",
        "REJECTED",
    ]

    decision_operation = paths[
        "/platform-admin/api/v1/onboarding/applications/{application_id}/decisions"
    ]["post"]
    assert decision_operation["parameters"][0] == {
        "$ref": "#/components/parameters/OnboardingApplicationId"
    }
    assert {
        parameter["name"] for parameter in decision_operation["parameters"][1:]
    } == {"Origin", "X-CSRF-Token"}
    decision_request = schemas["PlatformOnboardingDecisionRequest"]
    assert decision_request["additionalProperties"] is False
    assert set(decision_request["required"]) == {"outcome", "reason"}
    assert decision_request["properties"]["reason"]["minLength"] == 1

    for schema_name in (
        "PlatformOnboardingQueue",
        "PlatformOnboardingApplicationDetail",
        "PlatformOnboardingEvidenceDownload",
        "PlatformOnboardingDecision",
    ):
        assert schemas[schema_name]["additionalProperties"] is False

    detail_example = json.loads(
        (EXAMPLES_DIRECTORY / "platform-onboarding-detail.json").read_text()
    )
    _assert_example_matches_schema(
        contract, detail_example, schemas["PlatformOnboardingApplicationDetail"]
    )
    detail_text = json.dumps(detail_example)
    assert "object_key" not in detail_text
    assert "content_sha256" not in detail_text
    assert "ciphertext" not in detail_text

    runtime = create_app().openapi()
    for path, methods in expected.items():
        assert set(runtime["paths"][path]) == methods
        for method in methods:
            assert set(runtime["paths"][path][method]["responses"]) == set(
                paths[path][method]["responses"]
            )
    assert runtime["components"]["schemas"]["PlatformOnboardingDecision"][
        "properties"
    ]["outcome"] == {
        "type": "string",
        "enum": ["APPROVED", "REJECTED"],
        "title": "Outcome",
    }


def test_managed_venues_contract_and_runtime_are_closed_and_authenticated() -> None:
    contract = _contract()
    operation = contract["paths"]["/api/v1/admin/venues"]["get"]
    schemas = contract["components"]["schemas"]

    assert operation["security"] == [{"bearerAuth": []}]
    assert set(operation["responses"]) == {"200", "401"}
    assert _response_schema(operation, "200") == {
        "$ref": "#/components/schemas/ManagedVenuesResponse"
    }
    assert operation["responses"]["200"]["content"]["application/json"]["examples"] == {
        "ManagedVenues": {"externalValue": "./examples/managed-venues.json"}
    }

    response_schema = schemas["ManagedVenuesResponse"]
    assert response_schema["additionalProperties"] is False
    assert set(response_schema["required"]) == {"venues"}
    item_schema = schemas["ManagedVenue"]
    assert item_schema["additionalProperties"] is False
    assert set(item_schema["required"]) == {"id", "name", "district_name", "address"}
    assert set(item_schema["properties"]) == set(item_schema["required"])

    example = json.loads((EXAMPLES_DIRECTORY / "managed-venues.json").read_text())
    _assert_example_matches_schema(contract, example, response_schema)

    runtime = create_app().openapi()
    runtime_operation = runtime["paths"]["/api/v1/admin/venues"]["get"]
    runtime_response = runtime_operation["responses"]["200"]["content"][
        "application/json"
    ]["schema"]
    runtime_schema = runtime["components"]["schemas"][runtime_response["$ref"].rsplit("/", 1)[-1]]
    assert runtime_schema["additionalProperties"] is False
    assert set(runtime_schema["required"]) == {"venues"}


def test_contract_freezes_auth_checkout_and_order_operation_matrix() -> None:
    contract = _contract()
    expected_operations = {
        "/api/v1/auth/wechat/session": {"post"},
        "/api/v1/auth/wechat/phone": {"post"},
        "/api/v1/slots/{slot_id}/checkout": {"get"},
        "/api/v1/orders": {"get", "post"},
        "/api/v1/orders/{order_id}": {"get"},
        "/api/v1/orders/{order_id}/pay": {"post"},
        "/api/v1/orders/{order_id}/payments/{payment_id}/reconcile": {"post"},
    }
    actual_operations = {
        path: set(contract["paths"][path])
        for path in set(contract["paths"]) & set(expected_operations)
    }

    assert actual_operations == expected_operations

    expected_statuses = {
        ("/api/v1/auth/wechat/session", "post"): {"200", "422", "502"},
        ("/api/v1/auth/wechat/phone", "post"): {"200", "401", "422", "502", "503"},
        ("/api/v1/slots/{slot_id}/checkout", "get"): {"200", "401", "404", "409"},
        ("/api/v1/orders", "get"): {"200", "401", "422", "503"},
        ("/api/v1/orders", "post"): {"200", "201", "401", "404", "409", "422"},
        ("/api/v1/orders/{order_id}", "get"): {"200", "401", "404", "422"},
        ("/api/v1/orders/{order_id}/pay", "post"): {
            "200", "201", "202", "401", "404", "409", "503"
        },
        ("/api/v1/orders/{order_id}/payments/{payment_id}/reconcile", "post"): {
            "200", "202", "401", "404"
        },
    }
    protected_operations = set(expected_statuses) - {("/api/v1/auth/wechat/session", "post")}
    for (path, method), statuses in expected_statuses.items():
        operation = contract["paths"][path][method]
        assert set(operation["responses"]) == statuses
        if (path, method) in protected_operations:
            assert operation["security"] == [{"bearerAuth": []}]
        else:
            assert operation.get("security", []) == []
        for status in statuses:
            if int(status) >= 400:
                schema = _response_schema(operation, status)
                assert {"$ref": "#/components/schemas/ErrorEnvelope"} in schema["allOf"]

    assert contract["components"]["securitySchemes"]["bearerAuth"] == {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "opaque",
    }


def test_my_orders_list_contract_is_closed_owner_only_and_private() -> None:
    contract = _contract()
    path_item = contract["paths"]["/api/v1/orders"]

    assert "get" in path_item, "GET /api/v1/orders list operation is missing"
    operation = path_item["get"]
    schemas = contract["components"]["schemas"]

    assert operation["security"] == [{"bearerAuth": []}]
    assert "current authenticated user" in operation["description"]
    assert operation["parameters"] == [
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
    ]
    assert set(operation["responses"]) == {"200", "401", "422", "503"}
    assert _response_schema(operation, "200") == {
        "$ref": "#/components/schemas/OrderListResponse"
    }
    assert operation["responses"]["200"]["content"]["application/json"][
        "examples"
    ] == {
        "Ready": {"externalValue": "./examples/my-orders-ready.json"},
        "Empty": {"externalValue": "./examples/my-orders-empty.json"},
    }

    for status, code in (
        ("401", "AUTH_REQUIRED"),
        ("422", "INVALID_ARGUMENT"),
        ("503", "SERVICE_UNAVAILABLE"),
    ):
        response = operation["responses"][status]
        assert response["headers"]["X-Request-Id"] == {
            "$ref": "#/components/headers/RequestId"
        }
        schema = _response_schema(operation, status)
        assert {"$ref": "#/components/schemas/ErrorEnvelope"} in schema["allOf"]
        assert schema["allOf"][1]["properties"]["error"]["properties"]["code"] == {
            "const": code
        }

    summary = schemas["OrderSummary"]
    expected_summary_fields = {
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
    }
    assert summary["additionalProperties"] is False
    assert set(summary["required"]) == expected_summary_fields
    assert set(summary["properties"]) == expected_summary_fields
    assert summary["properties"]["venue"] == {
        "$ref": "#/components/schemas/CheckoutVenue"
    }
    assert summary["properties"]["pitch"] == {
        "$ref": "#/components/schemas/PhysicalPitch"
    }
    for nested_name in ("CheckoutVenue", "PhysicalPitch"):
        nested = schemas[nested_name]
        assert nested["additionalProperties"] is False
        assert set(nested["required"]) == {"id", "name"}
        assert set(nested["properties"]) == {"id", "name"}

    response_schema = schemas["OrderListResponse"]
    assert response_schema["additionalProperties"] is False
    assert set(response_schema["required"]) == {"orders", "next_cursor"}
    assert set(response_schema["properties"]) == {"orders", "next_cursor"}
    assert response_schema["properties"]["orders"] == {
        "type": "array",
        "items": {"$ref": "#/components/schemas/OrderSummary"},
    }
    assert response_schema["properties"]["next_cursor"] == {
        "type": ["string", "null"],
        "minLength": 1,
    }

    for filename in ("my-orders-ready.json", "my-orders-empty.json"):
        example = json.loads((EXAMPLES_DIRECTORY / filename).read_text())
        _assert_example_matches_schema(contract, example, response_schema)

    serialized = json.dumps(
        {
            "summary": summary,
            "ready": json.loads(
                (EXAMPLES_DIRECTORY / "my-orders-ready.json").read_text()
            ),
            "empty": json.loads(
                (EXAMPLES_DIRECTORY / "my-orders-empty.json").read_text()
            ),
        }
    )
    for forbidden in (
        "contact",
        "masked_phone",
        "phone",
        "address",
        "latitude",
        "longitude",
        "payment_id",
        "payment_state",
        "paid_at",
        "prepay_id",
        "transaction_id",
        "refund_id",
        "refund_case_id",
        "refund_attempt_id",
        "provider",
        "provider_refund_no",
        "merchant_order_no",
        "merchant_refund_no",
        "requested_by_user_id",
        "checked_in_by_user_id",
        "completed_by_user_id",
    ):
        assert forbidden not in serialized, forbidden


def test_my_orders_runtime_openapi_matches_the_frozen_list_operation() -> None:
    frozen = _contract()
    runtime = create_app(
        settings=Settings(app_env="test", wechat_provider="development")
    ).openapi()

    assert runtime["paths"]["/api/v1/orders"]["get"] == frozen["paths"][
        "/api/v1/orders"
    ]["get"]
    assert runtime["components"]["securitySchemes"]["bearerAuth"] == frozen[
        "components"
    ]["securitySchemes"]["bearerAuth"]
    assert runtime["components"]["headers"]["RequestId"] == frozen["components"][
        "headers"
    ]["RequestId"]
    for name in (
        "OrderListResponse",
        "OrderSummary",
        "OrderAllowedActions",
        "FundingAlert",
        "CheckoutVenue",
        "PhysicalPitch",
    ):
        assert runtime["components"]["schemas"][name] == frozen["components"][
            "schemas"
        ][name]


def test_order_create_and_owner_reads_use_separate_closed_projections() -> None:
    contract = _contract()
    schemas = contract["components"]["schemas"]
    create = contract["paths"]["/api/v1/orders"]["post"]
    list_orders = contract["paths"]["/api/v1/orders"]["get"]
    detail = contract["paths"]["/api/v1/orders/{order_id}"]["get"]
    pending = json.loads((EXAMPLES_DIRECTORY / "order-pending.json").read_text())

    for status in ("200", "201"):
        assert _response_schema(create, status) == {
            "$ref": "#/components/schemas/CreateOrderResponse"
        }
    legacy = schemas["CreateOrderResponse"]
    assert legacy["additionalProperties"] is False
    assert set(legacy["required"]) == set(pending)
    assert set(legacy["properties"]) == set(pending)
    assert "allowed_actions" not in pending
    assert "funding_alerts" not in pending

    assert _response_schema(list_orders, "200") == {
        "$ref": "#/components/schemas/OrderListResponse"
    }
    assert _response_schema(detail, "200") == {
        "$ref": "#/components/schemas/OrderDetail"
    }
    detail_examples = detail["responses"]["200"]["content"]["application/json"][
        "examples"
    ]
    assert "./examples/order-pending.json" not in {
        example["externalValue"] for example in detail_examples.values()
    }
    assert set(detail["responses"]) == {"200", "401", "404", "422"}


def test_owner_lifecycle_projection_contract_and_runtime_openapi_are_closed() -> None:
    contract = _contract()
    runtime = create_app(
        settings=Settings(app_env="test", wechat_provider="development")
    ).openapi()
    schemas = contract["components"]["schemas"]
    statuses = [
        "PENDING_PAYMENT",
        "CONFIRMED",
        "EXPIRED",
        "PAYMENT_EXCEPTION",
        "CANCELLED",
        "REFUND_PENDING",
        "REFUND_FAILED",
        "REFUNDED",
        "COMPLETED",
    ]
    lifecycle_fields = {
        "cancel_requested_at",
        "cancelled_at",
        "checked_in_at",
        "completed_at",
        "allowed_actions",
        "funding_alerts",
    }

    for name in ("OrderSummary", "OrderDetail"):
        schema = schemas[name]
        assert schema["additionalProperties"] is False
        assert schema["properties"]["status"]["enum"] == statuses
        assert lifecycle_fields <= set(schema["required"])
        assert lifecycle_fields <= set(schema["properties"])
        for timestamp in lifecycle_fields - {"allowed_actions", "funding_alerts"}:
            assert schema["properties"][timestamp] == {
                "type": ["string", "null"],
                "format": "date-time",
            }
    assert schemas["OrderDetail"]["properties"]["expired_at"] == {
        "type": ["string", "null"],
        "format": "date-time",
    }

    actions = schemas["OrderAllowedActions"]
    action_fields = {
        "can_pay",
        "can_cancel",
        "can_check_in",
        "can_complete",
        "can_refund",
        "blocked_reason",
    }
    assert actions["additionalProperties"] is False
    assert set(actions["required"]) == action_fields
    assert set(actions["properties"]) == action_fields
    assert actions["properties"]["blocked_reason"] == {
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
    }
    alert = schemas["FundingAlert"]
    assert alert["additionalProperties"] is False
    assert set(alert["required"]) == {"code", "status"}
    assert set(alert["properties"]) == {"code", "status"}
    assert alert["properties"]["code"] == {
        "type": "string",
        "const": "DUPLICATE_CHARGE_REFUND",
    }
    assert alert["properties"]["status"] == {
        "type": "string",
        "enum": ["REFUND_PENDING", "REFUND_FAILED", "REFUNDED"],
    }

    for path, method in (
        ("/api/v1/orders", "get"),
        ("/api/v1/orders", "post"),
        ("/api/v1/orders/{order_id}", "get"),
    ):
        assert set(runtime["paths"][path][method]["responses"]) == set(
            contract["paths"][path][method]["responses"]
        )
    for name in (
        "CreateOrderResponse",
        "OrderListResponse",
        "OrderSummary",
        "OrderDetailResponse",
        "OrderAllowedActionsResponse",
        "FundingAlertResponse",
    ):
        assert name in runtime["components"]["schemas"]


def test_order_detail_allows_unapplied_success_without_a_primary_payment() -> None:
    branches = _contract()["components"]["schemas"]["OrderDetail"]["oneOf"]
    branch = next(
        (
            candidate
            for candidate in branches
            if candidate.get("properties", {})
            .get("status", {})
            .get("enum", [])
            and "PAYMENT_EXCEPTION"
            in candidate["properties"]["status"]["enum"]
            and candidate["properties"].get("payment_state") == {"const": None}
        ),
        None,
    )

    assert branch == {
        "type": "object",
        "description": (
            "Unapplied successful funds never become the primary payment projection."
        ),
        "properties": {
            "status": {
                "enum": [
                    "PAYMENT_EXCEPTION",
                    "REFUND_PENDING",
                    "REFUND_FAILED",
                    "REFUNDED",
                ]
            },
            "payment_state": {"const": None},
            "payment_confirming": {"const": False},
            "closing_payment": {"const": False},
            "paid_at": {"const": None},
            "expired_at": {"const": None},
        },
    }
    assert any(
        candidate["properties"].get("status") == {"const": "PAYMENT_EXCEPTION"}
        and candidate["properties"].get("payment_state") == {"const": "SUCCESS"}
        for candidate in branches
    )


def test_captain_open_game_contract_is_closed_authenticated_and_private() -> None:
    contract = _contract()
    paths = contract["paths"]
    schemas = contract["components"]["schemas"]
    operations = {
        "/api/v1/orders/{order_id}/game": {
            "get": {"200", "401", "404", "422", "503"},
            "post": {"201", "401", "404", "409", "422", "503"},
        },
        "/api/v1/games/{game_id}": {
            "get": {"200", "401", "404", "422", "503"},
            "put": {"200", "401", "404", "409", "422", "503"},
        },
        "/api/v1/games/{game_id}/publish": {
            "post": {"200", "401", "404", "409", "422", "503"}
        },
        "/api/v1/games/{game_id}/cancel": {
            "post": {"200", "401", "404", "409", "422", "503"}
        },
        "/api/v1/shared-games/{share_token}": {
            "get": {"200", "404", "503"}
        },
    }
    operation_ids = {
        ("/api/v1/orders/{order_id}/game", "get"): "getOpenGameEntry",
        ("/api/v1/orders/{order_id}/game", "post"): "createOpenGame",
        ("/api/v1/games/{game_id}", "get"): "getOpenGame",
        ("/api/v1/games/{game_id}", "put"): "updateOpenGame",
        ("/api/v1/games/{game_id}/publish", "post"): "publishOpenGame",
        ("/api/v1/games/{game_id}/cancel", "post"): "cancelOpenGame",
        ("/api/v1/shared-games/{share_token}", "get"): "getSharedOpenGame",
    }

    for path, methods in operations.items():
        assert set(paths[path]) == set(methods)
        for method, statuses in methods.items():
            operation = paths[path][method]
            assert operation["operationId"] == operation_ids[(path, method)]
            assert set(operation["responses"]) == statuses
            if method == "get":
                assert "requestBody" not in operation
            if path == "/api/v1/shared-games/{share_token}":
                assert operation.get("security", []) == []
            else:
                assert operation["security"] == [{"bearerAuth": []}]

    shared = paths["/api/v1/shared-games/{share_token}"]["get"]
    assert {parameter["name"]: parameter for parameter in shared["parameters"]} == {
        "share_token": {
            "name": "share_token",
            "in": "path",
            "required": True,
            "schema": {"type": "string"},
        }
    }
    assert "401" not in shared["responses"]
    assert "422" not in shared["responses"]

    for path, method in (
        ("/api/v1/orders/{order_id}/game", "post"),
        ("/api/v1/games/{game_id}", "put"),
        ("/api/v1/games/{game_id}/publish", "post"),
        ("/api/v1/games/{game_id}/cancel", "post"),
    ):
        operation = paths[path][method]
        assert {parameter.get("$ref") for parameter in operation["parameters"]} >= {
            "#/components/parameters/IdempotencyKey"
        }
        idempotency = contract["components"]["parameters"]["IdempotencyKey"]
        assert idempotency["schema"] == {
            "type": "string",
            "minLength": 16,
            "maxLength": 128,
        }

    invalid_argument_details = {
        ("/api/v1/orders/{order_id}/game", "get"): {},
        ("/api/v1/orders/{order_id}/game", "post"): {
            "fields": [
                {
                    "field": "registration_deadline",
                    "message": "必须晚于当前时间且不晚于开场前 2 小时。",
                }
            ]
        },
        ("/api/v1/games/{game_id}", "get"): {},
        ("/api/v1/games/{game_id}", "put"): {
            "fields": [
                {
                    "field": "registration_deadline",
                    "message": "必须晚于当前时间且不晚于开场前 2 小时。",
                }
            ]
        },
        ("/api/v1/games/{game_id}/publish", "post"): {
            "fields": [
                {
                    "field": "expected_version",
                    "message": "必须是当前球局版本。",
                }
            ]
        },
        ("/api/v1/games/{game_id}/cancel", "post"): {
            "fields": [
                {
                    "field": "expected_version",
                    "message": "必须是当前球局版本。",
                }
            ]
        },
    }
    for (path, method), expected_details in invalid_argument_details.items():
        invalid = paths[path][method]["responses"]["422"]["content"][
            "application/json"
        ]
        assert invalid["schema"] == {
            "$ref": "#/components/schemas/OpenGameInvalidArgumentError"
        }
        assert set(invalid["examples"]) == {"InvalidArgument"}
        assert invalid["examples"]["InvalidArgument"]["value"]["error"][
            "details"
        ] == expected_details

    draft_fields = {
        "name",
        "team_name",
        "total_players",
        "fixed_players",
        "open_spots",
        "intensity",
        "minimum_experience",
        "positions",
        "aa_cents",
        "registration_deadline",
        "equipment_and_arrival_notes",
        "visibility",
    }
    expected_write_schemas = {
        ("/api/v1/orders/{order_id}/game", "post"): "CreateOpenGameRequest",
        ("/api/v1/games/{game_id}", "put"): "UpdateOpenGameRequest",
        ("/api/v1/games/{game_id}/publish", "post"): "OpenGameVersionRequest",
        ("/api/v1/games/{game_id}/cancel", "post"): "OpenGameVersionRequest",
    }
    for (path, method), schema_name in expected_write_schemas.items():
        assert paths[path][method]["requestBody"] == {
            "required": True,
            "content": {
                "application/json": {
                    "schema": {"$ref": f"#/components/schemas/{schema_name}"}
                }
            },
        }
    for schema_name, fields in (
        ("OpenGameDraftInput", draft_fields),
        ("CreateOpenGameRequest", draft_fields),
        ("UpdateOpenGameRequest", draft_fields | {"expected_version"}),
        ("OpenGameVersionRequest", {"expected_version"}),
    ):
        schema = schemas[schema_name]
        assert schema["additionalProperties"] is False
        assert set(schema["properties"]) == fields
        assert set(schema["required"]) == fields

    public_schema = schemas["OpenGamePublic"]
    public_fields = {
        "name",
        "team_name",
        "state",
        "state_reason",
        "venue_name",
        "pitch_name",
        "pitch_specification",
        "starts_at",
        "ends_at",
        "time_zone",
        "total_players",
        "fixed_players",
        "open_spots",
        "intensity",
        "minimum_experience",
        "positions",
        "aa_cents",
        "registration_deadline",
        "equipment_and_arrival_notes",
        "visibility",
    }
    assert public_schema["additionalProperties"] is False
    assert set(public_schema["properties"]) == public_fields
    assert set(public_schema["required"]) == public_fields
    for forbidden in (
        "order_id",
        "order_number",
        "user_id",
        "phone",
        "openid",
        "payment",
        "refund",
        "contact",
        "idempotency_key",
        "booking_price_cents",
    ):
        assert forbidden not in public_schema["properties"]


def test_captain_open_game_schemas_freeze_state_actions_and_examples() -> None:
    contract = _contract()
    schemas = contract["components"]["schemas"]
    owner_fields = {
        "id",
        "order_id",
        "order",
        "name",
        "team",
        "total_players",
        "fixed_players",
        "open_spots",
        "intensity",
        "minimum_experience",
        "positions",
        "aa_cents",
        "registration_deadline",
        "equipment_and_arrival_notes",
        "visibility",
        "persisted_status",
        "state",
        "state_reason",
        "version",
        "allowed_actions",
        "share",
        "public_view",
    }
    owner = schemas["OpenGameOwner"]
    assert owner["additionalProperties"] is False
    assert set(owner["properties"]) == owner_fields
    assert set(owner["required"]) == owner_fields
    assert owner["properties"]["public_view"] == {
        "$ref": "#/components/schemas/OpenGamePublic"
    }
    assert schemas["OpenGamePersistedStatus"]["enum"] == [
        "DRAFT",
        "PUBLISHED",
        "CANCELLED",
    ]
    assert schemas["OpenGameState"]["enum"] == [
        "DRAFT",
        "PUBLISHED",
        "SUSPENDED",
        "CANCELLED",
        "COMPLETED",
    ]
    assert schemas["OpenGameStateReason"]["enum"] == [
        "REGISTRATION_WINDOW_CLOSED",
        "REGISTRATION_DEADLINE_PASSED",
        "CAPTAIN_CANCELLED",
        "ORDER_CANCELLATION_PENDING",
        "ORDER_PAYMENT_EXCEPTION",
        "ORDER_REFUND_PENDING",
        "ORDER_REFUND_FAILED",
        "ORDER_CANCELLED",
        "ORDER_REFUNDED",
        "ORDER_COMPLETED",
        None,
    ]
    assert schemas["OpenGameIntensity"]["enum"] == [
        "BEGINNER_FRIENDLY",
        "CASUAL",
        "COMPETITIVE",
    ]
    assert schemas["OpenGameVisibility"]["enum"] == ["PUBLIC", "LINK_ONLY"]
    assert schemas["OpenGamePositions"]["x-canonical-order"] == [
        "GOALKEEPER",
        "DEFENDER",
        "MIDFIELDER",
        "FORWARD",
    ]

    order = schemas["OpenGameOrderSummary"]
    order_fields = {
        "venue_name",
        "pitch_name",
        "pitch_specification",
        "players_per_side",
        "booking_price_cents",
        "starts_at",
        "ends_at",
        "time_zone",
    }
    assert order["additionalProperties"] is False
    assert set(order["properties"]) == order_fields
    assert set(order["required"]) == order_fields
    assert order["properties"]["pitch_specification"]["pattern"] == "^[1-9][0-9]*人制$"
    assert order["properties"]["pitch_specification"]["x-derived-from"] == (
        "players_per_side"
    )
    assert order["properties"]["pitch_specification"]["x-derived-template"] == (
        "{players_per_side}人制"
    )

    entry = schemas["OpenGameEntry"]
    assert entry["discriminator"] == {"propertyName": "entry"}
    assert len(entry["oneOf"]) == 3
    entry_examples = [
        json.loads((EXAMPLES_DIRECTORY / filename).read_text())
        for filename in (
            "open-game-entry-create.json",
            "open-game-entry-manage.json",
            "open-game-entry-none.json",
        )
    ]
    for example in entry_examples:
        _assert_example_matches_schema(contract, example, entry)
    assert {example["entry"] for example in entry_examples} == {
        "CREATE",
        "MANAGE",
        "NONE",
    }
    create_entry = next(
        example for example in entry_examples if example["entry"] == "CREATE"
    )
    assert create_entry["order"]["pitch_specification"] == (
        f'{create_entry["order"]["players_per_side"]}人制'
    )

    owner_examples = []
    for filename in (
        "open-game-owner-draft.json",
        "open-game-owner-published.json",
        "open-game-owner-suspended.json",
        "open-game-owner-cancelled.json",
    ):
        owner_example = json.loads((EXAMPLES_DIRECTORY / filename).read_text())
        owner_examples.append(owner_example)
        _assert_example_matches_schema(contract, owner_example, owner)
        assert owner_example["order"]["pitch_specification"] == (
            f'{owner_example["order"]["players_per_side"]}人制'
        )
        assert owner_example["public_view"]["pitch_specification"] == (
            owner_example["order"]["pitch_specification"]
        )
    public_example = json.loads(
        (EXAMPLES_DIRECTORY / "open-game-public-published.json").read_text()
    )
    _assert_example_matches_schema(contract, public_example, schemas["OpenGamePublic"])
    published_owner = next(
        example for example in owner_examples if example["state"] == "PUBLISHED"
    )
    assert public_example["pitch_specification"] == published_owner["public_view"][
        "pitch_specification"
    ]
    public_text = json.dumps(public_example).lower()
    for forbidden in (
        "order_id",
        "order_number",
        "user_id",
        "phone",
        "openid",
        "payment",
        "refund",
        "contact",
        "idempotency_key",
        "booking_price_cents",
    ):
        assert forbidden not in public_text

    assert schemas["ErrorDetails"]["properties"]["fields"] == {
        "type": "array",
        "items": {"$ref": "#/components/schemas/ErrorField"},
    }
    error_field = schemas["ErrorField"]
    assert error_field["additionalProperties"] is False
    assert set(error_field["required"]) == {"field", "message"}
    assert set(error_field["properties"]) == {"field", "message"}
    invalid_details = schemas["OpenGameInvalidArgumentDetails"]
    assert invalid_details["oneOf"] == [
        {
            "type": "object",
            "additionalProperties": False,
            "maxProperties": 0,
        },
        {
            "type": "object",
            "additionalProperties": False,
            "required": ["fields"],
            "properties": {
                "fields": {
                    "type": "array",
                    "minItems": 1,
                    "items": {"$ref": "#/components/schemas/ErrorField"},
                }
            },
        },
    ]


def test_lifecycle_operations_publish_only_available_runtime_routes() -> None:
    contract = _contract()
    runtime = create_app(
        settings=Settings(app_env="test", wechat_provider="development")
    ).openapi()
    published_operations = {
        "/api/v1/orders/{order_id}/cancel": (
            "post",
            {"200", "202", "401", "404", "409", "503"},
        ),
        "/api/v1/venues/{venue_id}/fulfillment/orders": (
            "get",
            {"200", "401", "404", "422", "503"},
        ),
        "/api/v1/venues/{venue_id}/fulfillment/orders/{order_id}/check-in": (
            "post",
            {"200", "401", "404", "409", "503"},
        ),
        "/api/v1/venues/{venue_id}/fulfillment/orders/{order_id}/complete": (
            "post",
            {"200", "401", "404", "409", "503"},
        ),
    }
    notification_operations = {
        "/api/v1/payments/wechat/notify": ("post", {"204", "400", "503"}),
        "/api/v1/refunds/wechat/notify": ("post", {"204", "400", "503"}),
    }
    unpublished_operations = (
        (
            "/api/v1/venues/{venue_id}/fulfillment/orders/{order_id}/refund",
            "post",
            {"200", "202", "401", "404", "409", "422", "503"},
        ),
        (
            "/api/v1/orders/{order_id}/game",
            "get",
            {"200", "401", "404", "422", "503"},
        ),
        (
            "/api/v1/orders/{order_id}/game",
            "post",
            {"201", "401", "404", "409", "422", "503"},
        ),
        (
            "/api/v1/games/{game_id}",
            "get",
            {"200", "401", "404", "422", "503"},
        ),
        (
            "/api/v1/games/{game_id}",
            "put",
            {"200", "401", "404", "409", "422", "503"},
        ),
        (
            "/api/v1/games/{game_id}/publish",
            "post",
            {"200", "401", "404", "409", "422", "503"},
        ),
        (
            "/api/v1/games/{game_id}/cancel",
            "post",
            {"200", "401", "404", "409", "422", "503"},
        ),
        (
            "/api/v1/shared-games/{share_token}",
            "get",
            {"200", "404", "503"},
        ),
    )

    for path, (method, statuses) in published_operations.items():
        assert set(contract["paths"][path]) == {method}
        assert set(contract["paths"][path][method]["responses"]) == statuses
        assert set(runtime["paths"][path]) == {method}
        assert set(runtime["paths"][path][method]["responses"]) == statuses

    for path, method, statuses in unpublished_operations:
        assert method in contract["paths"][path]
        assert set(contract["paths"][path][method]["responses"]) == statuses
        assert path not in runtime["paths"]

    for path, (method, statuses) in notification_operations.items():
        assert set(contract["paths"][path]) == {method}
        assert set(contract["paths"][path][method]["responses"]) == statuses
        assert set(runtime["paths"][path]) == {method}

    for path in (
        "/api/v1/orders/{order_id}/cancel",
        "/api/v1/venues/{venue_id}/fulfillment/orders/{order_id}/check-in",
        "/api/v1/venues/{venue_id}/fulfillment/orders/{order_id}/complete",
        "/api/v1/venues/{venue_id}/fulfillment/orders/{order_id}/refund",
    ):
        operation = contract["paths"][path]["post"]
        assert operation["security"] == [{"bearerAuth": []}]
        idempotency = next(
            parameter
            for parameter in operation["parameters"]
            if parameter.get("name") == "Idempotency-Key"
            or parameter.get("$ref") == "#/components/parameters/IdempotencyKey"
        )
        schema = (
            contract["components"]["parameters"]["IdempotencyKey"]["schema"]
            if "$ref" in idempotency
            else idempotency["schema"]
        )
        assert schema == {"type": "string", "minLength": 16, "maxLength": 128}
    assert "requestBody" not in contract["paths"][
        "/api/v1/orders/{order_id}/cancel"
    ]["post"]


def test_venue_fulfillment_service_date_is_an_optional_exact_date_query() -> None:
    operation = _contract()["paths"][
        "/api/v1/venues/{venue_id}/fulfillment/orders"
    ]["get"]
    service_date = next(
        parameter
        for parameter in operation["parameters"]
        if parameter.get("name") == "service_date"
    )

    assert service_date == {
        "name": "service_date",
        "in": "query",
        "required": False,
        "schema": {"type": "string", "format": "date"},
    }


def test_venue_fulfillment_list_has_closed_venue_and_generation_context() -> None:
    contract = _contract()
    schema = contract["components"]["schemas"]["VenueFulfillmentOrdersResponse"]
    example = json.loads(
        (EXAMPLES_DIRECTORY / "venue-fulfillment-orders.json").read_text()
    )
    fields = ["venue", "service_date", "generated_at", "orders", "next_cursor"]

    assert schema["additionalProperties"] is False
    assert schema["required"] == fields
    assert list(schema["properties"]) == fields
    assert schema["properties"]["venue"] == {
        "$ref": "#/components/schemas/CheckoutVenue"
    }
    assert schema["properties"]["service_date"] == {
        "type": "string",
        "format": "date",
    }
    assert schema["properties"]["generated_at"] == {
        "type": "string",
        "format": "date-time",
    }
    assert list(example) == fields


def test_wechat_notification_contract_requires_raw_bytes_before_json_parse() -> None:
    contract = _contract()
    schemas = contract["components"]["schemas"]
    header_names = {
        "Wechatpay-Timestamp",
        "Wechatpay-Nonce",
        "Wechatpay-Signature",
        "Wechatpay-Serial",
    }
    for path in (
        "/api/v1/payments/wechat/notify",
        "/api/v1/refunds/wechat/notify",
    ):
        operation = contract["paths"][path]["post"]
        assert operation["security"] == []
        assert (
            operation["x-wechatpay-raw-body-verification"]
            == "required-before-json-parse"
        )
        headers = {parameter["name"]: parameter for parameter in operation["parameters"]}
        assert set(headers) == header_names
        for header in headers.values():
            assert header["in"] == "header"
            assert header["required"] is True
            assert header["schema"] == {"type": "string", "minLength": 1}
        assert operation["requestBody"]["content"]["application/json"]["schema"] == {
            "$ref": "#/components/schemas/WeChatNotificationEnvelope"
        }
        assert "content" not in operation["responses"]["204"]
        assert "duplicate" in operation["responses"]["204"]["description"].lower()

    envelope = schemas["WeChatNotificationEnvelope"]
    assert envelope["additionalProperties"] is False
    assert set(envelope["required"]) == {
        "id",
        "create_time",
        "event_type",
        "resource_type",
        "summary",
        "resource",
    }
    assert set(envelope["properties"]) == set(envelope["required"])
    resource = schemas["WeChatNotificationResource"]
    assert resource["additionalProperties"] is False
    assert set(resource["required"]) == {
        "original_type",
        "algorithm",
        "ciphertext",
        "associated_data",
        "nonce",
    }
    assert set(resource["properties"]) == set(resource["required"])
    assert resource["properties"]["algorithm"] == {
        "type": "string",
        "const": "AEAD_AES_256_GCM",
    }


def test_lifecycle_error_examples_and_pay_503_are_closed() -> None:
    contract = _contract()
    filenames_by_code = {
        "AUTH_REQUIRED": "error-auth-required.json",
        "INVALID_ARGUMENT": "error-invalid-argument.json",
        "ORDER_NOT_FOUND": "error-order-not-found.json",
        "ORDER_STATE_CHANGED": "error-order-state-changed.json",
        "IDEMPOTENCY_KEY_REUSED": "error-idempotency-key-reused.json",
        "PAYMENT_RESULT_PENDING": "error-payment-result-pending.json",
        "REFUND_IN_PROGRESS": "error-refund-in-progress.json",
        "PAYMENT_CREATE_FAILED": "error-payment-create-failed.json",
        "PAYMENT_PROVIDER_UNAVAILABLE": "error-payment-provider-unavailable.json",
        "WECHAT_NOTIFICATION_INVALID": "error-wechat-notification-invalid.json",
        "SERVICE_UNAVAILABLE": "error-service-unavailable.json",
    }
    for code, filename in filenames_by_code.items():
        example = json.loads((EXAMPLES_DIRECTORY / filename).read_text())
        assert example["error"]["code"] == code

    pay_503 = contract["paths"]["/api/v1/orders/{order_id}/pay"]["post"][
        "responses"
    ]["503"]
    assert pay_503["content"]["application/json"]["schema"]["allOf"][1][
        "properties"
    ]["error"]["properties"]["code"] == {
        "enum": ["PAYMENT_CREATE_FAILED", "PAYMENT_PROVIDER_UNAVAILABLE"]
    }
    assert set(
        example["externalValue"]
        for example in pay_503["content"]["application/json"]["examples"].values()
    ) == {
        "./examples/error-payment-create-failed.json",
        "./examples/error-payment-provider-unavailable.json",
    }


def test_contract_freezes_map_and_discriminated_venue_detail() -> None:
    contract = _contract()
    paths = contract["paths"]
    schemas = contract["components"]["schemas"]

    assert set(paths["/api/v1/venues/map"]) == {"get"}
    assert set(paths["/api/v1/venues/{venue_id}"]) == {"get"}
    assert paths["/api/v1/venues/map"]["get"]["responses"]["200"]["content"][
        "application/json"
    ]["schema"] == {"$ref": "#/components/schemas/VenueMapResponse"}
    assert paths["/api/v1/venues/{venue_id}"]["get"]["responses"]["200"]["content"][
        "application/json"
    ]["schema"] == {"$ref": "#/components/schemas/VenueDetail"}

    map_item = schemas["VenueMapItem"]
    assert {"district_code", "district_name"} <= set(map_item["required"])
    assert map_item["properties"]["district_code"] == {
        "type": "string",
        "pattern": "^[0-9]{6}$",
    }
    assert map_item["properties"]["district_name"] == {
        "type": "string",
        "minLength": 1,
    }

    detail = schemas["VenueDetail"]
    assert detail["oneOf"] == [
        {"$ref": "#/components/schemas/OnlineVenueDetail"},
        {"$ref": "#/components/schemas/DirectoryVenueDetail"},
    ]
    assert detail["discriminator"]["propertyName"] == "booking_mode"
    for name, mode in (
        ("OnlineVenueDetail", "ONLINE"),
        ("DirectoryVenueDetail", "DIRECTORY_ONLY"),
    ):
        schema = schemas[name]
        assert schema["additionalProperties"] is False
        assert schema["properties"]["booking_mode"] == {"type": "string", "const": mode}
        assert "district_code" not in schema["properties"]
        assert "district_name" not in schema["properties"]


def test_runtime_openapi_exposes_districts_only_on_map_items() -> None:
    schemas = create_app().openapi()["components"]["schemas"]
    map_item = schemas["VenueMapItemResponse"]

    assert {"district_code", "district_name"} <= set(map_item["required"])
    assert map_item["properties"]["district_code"]["pattern"] == "^[0-9]{6}$"
    assert map_item["properties"]["district_name"]["minLength"] == 1
    for detail_name in ("OnlineVenueDetailResponse", "DirectoryVenueDetailResponse"):
        assert "district_code" not in schemas[detail_name]["properties"]
        assert "district_name" not in schemas[detail_name]["properties"]


def test_contract_freezes_non_disclosing_venue_guard_errors() -> None:
    contract = _contract()
    operations = (
        ("/api/v1/venues/{venue_id}/availability", "get"),
        ("/api/v1/slots/{slot_id}/checkout", "get"),
        ("/api/v1/orders", "post"),
        ("/api/v1/orders/{order_id}/pay", "post"),
    )
    for path, method in operations:
        response = contract["paths"][path][method]["responses"]["404"]
        assert "venue" in response["description"].lower()
        assert response["content"]["application/json"]["examples"]["VenueNotFound"] == {
            "externalValue": "./examples/error-venue-not-found.json"
        }

    order_detail = contract["paths"]["/api/v1/orders/{order_id}"]["get"]
    assert set(order_detail["responses"]["404"]["content"]["application/json"]["examples"]) == {
        "OrderNotFound"
    }


def test_every_auth_checkout_and_order_response_declares_request_id_header() -> None:
    contract = _contract()
    operations = {
        ("/api/v1/auth/wechat/session", "post"),
        ("/api/v1/auth/wechat/phone", "post"),
        ("/api/v1/slots/{slot_id}/checkout", "get"),
        ("/api/v1/orders", "get"),
        ("/api/v1/orders", "post"),
        ("/api/v1/orders/{order_id}", "get"),
        ("/api/v1/orders/{order_id}/pay", "post"),
        ("/api/v1/orders/{order_id}/payments/{payment_id}/reconcile", "post"),
    }

    for path, method in operations:
        for response in contract["paths"][path][method]["responses"].values():
            assert response["headers"]["X-Request-Id"] == {
                "$ref": "#/components/headers/RequestId"
            }


def test_auth_checkout_and_create_order_schemas_are_closed_and_complete() -> None:
    contract = _contract()
    schemas = contract["components"]["schemas"]

    session = schemas["WeChatSession"]
    assert session["additionalProperties"] is False
    assert set(session["required"]) == {"session_token", "expires_at", "user"}
    assert session["properties"]["session_token"]["minLength"] >= 43
    session_user = _resolve_schema(contract, session["properties"]["user"])
    assert session_user["additionalProperties"] is False
    assert set(session_user["required"]) == {"id", "masked_phone", "last_contact_name"}

    checkout = schemas["Checkout"]
    assert checkout["additionalProperties"] is False
    assert set(checkout["required"]) == {
        "slot_id",
        "venue",
        "pitch",
        "date",
        "starts_at",
        "ends_at",
        "duration_minutes",
        "price_cents",
        "currency",
        "available",
        "cancellation_summary",
        "lock_duration_seconds",
        "contact",
        "checkout_version",
    }
    for nested_name, required in {
        "venue": {"id", "name"},
        "pitch": {"id", "name"},
        "contact": {"masked_phone", "last_contact_name"},
    }.items():
        nested = _resolve_schema(contract, checkout["properties"][nested_name])
        assert nested["additionalProperties"] is False
        assert set(nested["required"]) == required

    create_order = schemas["CreateOrderRequest"]
    assert create_order["additionalProperties"] is False
    assert set(create_order["required"]) == {"slot_id", "checkout_version", "contact_name"}
    assert set(create_order["properties"]) == {"slot_id", "checkout_version", "contact_name"}
    create_operation = contract["paths"]["/api/v1/orders"]["post"]
    idempotency_key = next(
        parameter
        for parameter in create_operation["parameters"]
        if parameter["name"] == "Idempotency-Key"
    )
    assert idempotency_key["in"] == "header"
    assert idempotency_key["required"] is True
    request_schema = create_operation["requestBody"]["content"]["application/json"]["schema"]
    assert request_schema == {"$ref": "#/components/schemas/CreateOrderRequest"}


def test_order_detail_and_price_changed_contract_are_complete() -> None:
    contract = _contract()
    schemas = contract["components"]["schemas"]
    order = schemas["OrderDetail"]
    assert order["additionalProperties"] is False
    assert set(order["required"]) >= {
        "id",
        "order_number",
        "status",
        "venue",
        "pitch",
        "starts_at",
        "ends_at",
        "price_cents",
        "currency",
        "contact",
        "expires_at",
        "cancellation_summary",
        "closing_payment",
        "payment_state",
        "payment_confirming",
        "paid_at",
    }
    assert order["properties"]["status"]["enum"] == [
        "PENDING_PAYMENT",
        "CONFIRMED",
        "EXPIRED",
        "PAYMENT_EXCEPTION",
        "CANCELLED",
        "REFUND_PENDING",
        "REFUND_FAILED",
        "REFUNDED",
        "COMPLETED",
    ]
    assert order["properties"]["payment_state"] == {
        "type": ["string", "null"],
        "enum": [
            "CREATING",
            "PREPAY_CREATED",
            "CONFIRMING",
            "SUCCESS",
            "CLOSED",
            "UNKNOWN",
            None,
        ],
    }
    assert order["properties"]["payment_confirming"] == {"type": "boolean"}
    assert order["properties"]["closing_payment"] == {"type": "boolean"}
    assert order["properties"]["paid_at"] == {
        "type": ["string", "null"], "format": "date-time"
    }
    venue = _resolve_schema(contract, order["properties"]["venue"])
    assert set(venue["required"]) == {
        "id",
        "name",
        "address",
        "latitude",
        "longitude",
    }
    assert set(venue["properties"]) == set(venue["required"])
    pitch = _resolve_schema(contract, order["properties"]["pitch"])
    assert set(pitch["required"]) == {"id", "name"}
    contact = _resolve_schema(contract, order["properties"]["contact"])
    assert set(contact["required"]) == {"name", "masked_phone"}

    price_changed = json.loads((EXAMPLES_DIRECTORY / "error-price-changed.json").read_text())
    assert price_changed["error"]["code"] == "PRICE_CHANGED"
    assert price_changed["error"]["message"] == "价格已变化，请重新确认"
    assert price_changed["error"]["request_id"] == "req-contract-price-change"
    current_checkout = price_changed["error"]["details"]["current_checkout"]
    _assert_example_matches_schema(contract, current_checkout, schemas["Checkout"])


def test_every_booking_business_error_has_a_canonical_external_example() -> None:
    contract = _contract()
    expected_examples = {
        "AUTH_REQUIRED": "error-auth-required.json",
        "WECHAT_LOGIN_FAILED": "error-wechat-login-failed.json",
        "PHONE_AUTH_REQUIRED": "error-phone-auth-required.json",
        "PHONE_AUTH_UNAVAILABLE": "error-phone-auth-unavailable.json",
        "PHONE_AUTH_FAILED": "error-phone-auth-failed.json",
        "INVALID_CONTACT": "error-invalid-contact.json",
        "SLOT_NOT_AVAILABLE": "error-slot-not-available.json",
        "PRICE_CHANGED": "error-price-changed.json",
        "IDEMPOTENCY_KEY_REUSED": "error-idempotency-key-reused.json",
        "ORDER_NOT_FOUND": "error-order-not-found.json",
        "ORDER_EXPIRED": "error-order-expired.json",
        "PAYMENT_CREATE_FAILED": "error-payment-create-failed.json",
        "PAYMENT_EXCEPTION": "error-payment-exception.json",
        "VENUE_DIRECTORY_MISCONFIGURED": "error-venue-directory-misconfigured.json",
    }
    attached_external_values = {
        example["externalValue"]
        for path_item in contract["paths"].values()
        for operation in path_item.values()
        for response in operation["responses"].values()
        for example in response.get("content", {})
        .get("application/json", {})
        .get("examples", {})
        .values()
        if "externalValue" in example
    }

    for code, filename in expected_examples.items():
        reference = f"./examples/{filename}"
        assert reference in attached_external_values
        example = json.loads((EXAMPLES_DIRECTORY / filename).read_text())
        assert example["error"]["code"] == code


def test_primary_response_schema_is_closed_and_requires_contract_fields() -> None:
    schema = create_app().openapi()
    operation = schema["paths"]["/api/v1/venues/primary"]["get"]
    response_schema = operation["responses"]["200"]["content"]["application/json"]["schema"]
    component_name = response_schema["$ref"].rsplit("/", 1)[-1]
    component = schema["components"]["schemas"][component_name]

    assert component["additionalProperties"] is False
    assert set(component["required"]) >= {
        "id",
        "name",
        "profile",
        "pitch_types",
        "availability_window",
        "generated_at",
    }
    assert not {"phone", "description", "images", "facilities"} & set(
        component["properties"]
    )
    assert component["properties"]["timezone"]["const"] == "Asia/Shanghai"
    profile_name = component["properties"]["profile"]["$ref"].rsplit("/", 1)[-1]
    profile = schema["components"]["schemas"][profile_name]
    assert profile["additionalProperties"] is False
    assert set(profile["required"]) == {
        "publication_state",
        "published_version",
        "description",
        "cover_image",
        "images",
        "facilities",
        "pitch_sizes",
        "live_price",
        "availability_target",
    }


def test_runtime_online_and_directory_profiles_are_closed_and_phone_free() -> None:
    schemas = create_app().openapi()["components"]["schemas"]

    for name in ("OnlineVenueDetailResponse", "DirectoryVenueDetailResponse"):
        schema = schemas[name]
        assert schema["additionalProperties"] is False
        assert {"profile", "booking_mode", "coordinate_system"} <= set(
            schema["required"]
        )
        assert not {"phone", "description", "cover_image", "images", "facilities"} & set(
            schema["properties"]
        )

    order_venue = schemas["OrderVenueResponse"]
    assert "customer_service_phone" not in order_venue["properties"]

    map_response = schemas["VenueMapResponse"]
    assert "coordinate_system" in map_response["required"]


def test_availability_response_schema_is_closed() -> None:
    schema = create_app().openapi()
    operation = schema["paths"]["/api/v1/venues/{venue_id}/availability"]["get"]
    response_schema = operation["responses"]["200"]["content"]["application/json"]["schema"]
    component_name = response_schema["$ref"].rsplit("/", 1)[-1]
    component = schema["components"]["schemas"][component_name]

    assert component["additionalProperties"] is False
    assert set(component["required"]) >= {
        "venue_id",
        "timezone",
        "date",
        "pitch_type",
        "availability_window",
        "pitches",
        "generated_at",
    }


def test_contract_freezes_authenticated_venue_onboarding_operation_matrix() -> None:
    contract = _contract()
    expected_operations = {
        "/api/v1/venue-onboarding/candidates": "get",
        "/api/v1/venue-onboarding/evidence/upload-intents": "post",
        "/api/v1/venue-onboarding/evidence/{evidence_id}/complete": "post",
        "/api/v1/venue-onboarding/claims": "post",
        "/api/v1/venue-onboarding/venues": "post",
        "/api/v1/venue-onboarding/applications": "get",
    }

    for path, method in expected_operations.items():
        assert set(contract["paths"][path]) == {method}
        operation = contract["paths"][path][method]
        assert operation["security"] == [{"bearerAuth": []}]
        assert "401" in operation["responses"]

    mutations = set(expected_operations.items()) - {
        ("/api/v1/venue-onboarding/candidates", "get"),
        ("/api/v1/venue-onboarding/applications", "get"),
    }
    for path, method in mutations:
        parameters = operation_parameters = contract["paths"][path][method].get(
            "parameters", []
        )
        assert {parameter.get("$ref") for parameter in parameters} >= {
            "#/components/parameters/IdempotencyKey"
        }, operation_parameters

    candidates_parameters = {
        parameter["name"]: parameter
        for parameter in contract["paths"][
            "/api/v1/venue-onboarding/candidates"
        ]["get"]["parameters"]
    }
    assert candidates_parameters["q"]["required"] is True
    assert candidates_parameters["q"]["schema"] == {
        "type": "string",
        "minLength": 2,
        "maxLength": 80,
    }
    assert candidates_parameters["limit"]["schema"]["minimum"] == 1
    assert candidates_parameters["limit"]["schema"]["maximum"] == 20

    applications = contract["paths"][
        "/api/v1/venue-onboarding/applications"
    ]["get"]
    applications_parameters = {
        parameter["name"]: parameter for parameter in applications["parameters"]
    }
    assert set(applications_parameters) == {"cursor", "limit"}
    assert applications_parameters["limit"]["schema"]["minimum"] == 1
    assert applications_parameters["limit"]["schema"]["maximum"] == 20
    assert "current applicant" in applications["description"].lower()
    assert "newest-first" in applications["responses"]["200"]["description"].lower()


def test_venue_onboarding_evidence_contract_freezes_limits_and_closed_completion() -> None:
    contract = _contract()
    schemas = contract["components"]["schemas"]

    kind = schemas["VenueOnboardingEvidenceKind"]
    assert kind["enum"] == [
        "BUSINESS_LICENSE",
        "MANAGEMENT_AUTHORIZATION",
        "VENUE_EXTERIOR",
        "VENUE_INTERIOR",
    ]
    document = schemas["VenueOnboardingDocumentEvidenceConstraints"]
    assert document["properties"]["accepted_mime_types"]["const"] == [
        "image/jpeg",
        "image/png",
        "application/pdf",
    ]
    assert document["properties"]["maximum_bytes"]["const"] == 10 * 1024 * 1024
    photo = schemas["VenueOnboardingPhotoEvidenceConstraints"]
    assert photo["properties"]["accepted_mime_types"]["const"] == [
        "image/jpeg",
        "image/png",
    ]
    assert photo["properties"]["maximum_bytes"]["const"] == 15 * 1024 * 1024

    intent = schemas["VenueOnboardingUploadIntent"]
    assert intent["additionalProperties"] is False
    assert set(intent["required"]) == {
        "evidence_id",
        "status",
        "post_policy",
        "constraints",
    }
    assert intent["properties"]["status"] == {
        "type": "string",
        "const": "PENDING_UPLOAD",
    }
    assert "owner-bound" in intent["description"].lower()
    policy = schemas["VenueOnboardingPostPolicy"]
    assert policy["properties"]["method"] == {"type": "string", "const": "POST"}
    assert policy["properties"]["expires_at"]["format"] == "date-time"

    complete_operation = contract["paths"][
        "/api/v1/venue-onboarding/evidence/{evidence_id}/complete"
    ]["post"]
    assert set(complete_operation["responses"]) >= {"200", "401", "404", "409", "422"}
    completed = schemas["VenueOnboardingEvidenceClosed"]
    assert completed["additionalProperties"] is False
    assert set(completed["required"]) == {"evidence_id", "status"}
    assert set(completed["properties"]) == {"evidence_id", "status"}
    assert completed["properties"]["status"] == {
        "type": "string",
        "const": "COMPLETED",
    }
    description = complete_operation["description"].lower()
    for phrase in ("stream", "sha-256", "jpeg", "png", "pdf", "non-authoritative"):
        assert phrase in description
    assert "first completion and an idempotent replay both return 200" in description


def test_venue_onboarding_submission_schemas_require_exact_evidence_and_no_phone() -> None:
    contract = _contract()
    schemas = contract["components"]["schemas"]

    claim_evidence = schemas["VenueClaimEvidence"]
    assert claim_evidence["additionalProperties"] is False
    assert set(claim_evidence["required"]) == {
        "MANAGEMENT_AUTHORIZATION",
        "VENUE_EXTERIOR",
    }
    assert set(claim_evidence["properties"]) == set(claim_evidence["required"])

    create_evidence = schemas["VenueCreateEvidence"]
    assert create_evidence["additionalProperties"] is False
    assert set(create_evidence["required"]) == {
        "BUSINESS_LICENSE",
        "MANAGEMENT_AUTHORIZATION",
        "VENUE_EXTERIOR",
        "VENUE_INTERIOR",
    }
    assert set(create_evidence["properties"]) == set(create_evidence["required"])

    claim_request = schemas["SubmitVenueClaim"]
    assert set(claim_request["required"]) == {
        "venue_id",
        "contact_name",
        "evidence",
    }
    assert set(claim_request["properties"]) == {
        "venue_id",
        "contact_name",
        "evidence",
    }
    for name in ("SubmitVenueClaim", "SubmitVenueCreate"):
        request = schemas[name]
        assert request["additionalProperties"] is False
        assert request["properties"]["contact_name"] == {
            "type": "string",
            "minLength": 1,
            "maxLength": 40,
        }
        assert "phone" not in request["properties"]
        assert "phone" not in request.get("required", [])
        assert "verified phone" in request["description"].lower()
        assert "server" in request["description"].lower()

    for path in (
        "/api/v1/venue-onboarding/claims",
        "/api/v1/venue-onboarding/venues",
    ):
        operation = contract["paths"][path]["post"]
        assert set(operation["responses"]) >= {"200", "201", "401", "409", "422"}
        assert "first submission returns 201" in operation["description"].lower()
        assert "idempotent replay returns 200" in operation["description"].lower()

    application = schemas["VenueOnboardingApplication"]
    assert application["additionalProperties"] is False
    assert application["properties"]["status"]["enum"] == [
        "SUBMITTED",
        "APPROVED",
        "REJECTED",
    ]
    assert "rejection_reason" not in application["required"]
    assert "rejection_reason" not in application["properties"]
    applicant_application = schemas["VenueOnboardingApplicantApplication"]
    assert "rejection_reason" in applicant_application["required"]
    assert applicant_application["properties"]["rejection_reason"] == {
        "description": "Applicant-visible reason populated only for a rejected application.",
        "type": ["string", "null"],
        "minLength": 1,
    }
    forbidden = {"phone", "phone_number", "object_key", "reviewer_notes", "review_material"}
    assert not forbidden & set(application["properties"])
    applications = schemas["VenueOnboardingApplications"]
    assert applications["additionalProperties"] is False
    assert set(applications["required"]) == {"items", "next_cursor"}
    assert applications["properties"]["items"]["items"] == {
        "$ref": "#/components/schemas/VenueOnboardingApplicantApplication"
    }


def test_venue_create_request_requires_authoritative_location() -> None:
    contract = _contract()
    request = contract["components"]["schemas"]["SubmitVenueCreate"]
    expected_fields = {
        "name",
        "address",
        "district_code",
        "district_name",
        "latitude",
        "longitude",
        "contact_name",
        "evidence",
    }
    assert set(request["required"]) == expected_fields
    assert set(request["properties"]) == expected_fields
    assert request["properties"]["district_code"] == {
        "type": "string",
        "pattern": "^[0-9]{6}$",
    }
    assert request["properties"]["district_name"] == {
        "type": "string",
        "minLength": 1,
        "maxLength": 120,
    }
    assert request["properties"]["latitude"] == {
        "type": "number",
        "minimum": -90,
        "maximum": 90,
    }
    assert request["properties"]["longitude"] == {
        "type": "number",
        "minimum": -180,
        "maximum": 180,
    }

    value = {
        "name": "前滩社区足球场",
        "address": "前滩大道88号",
        "district_code": "310115",
        "district_name": "浦东新区",
        "latitude": 31.152,
        "longitude": 121.507,
        "contact_name": "张三",
        "evidence": {
            "BUSINESS_LICENSE": "3e096d1f-e847-45aa-81e8-358886b87f3a",
            "MANAGEMENT_AUTHORIZATION": "b722736c-bc48-4312-9c18-12f44dbc062f",
            "VENUE_EXTERIOR": "10b305df-c2e8-4bc9-b2d5-9dc92c07a865",
            "VENUE_INTERIOR": "24aa9cc2-2de8-48d6-80ea-11bb5a190fbf",
        },
    }
    validator = Draft202012Validator(contract).evolve(schema=request)
    assert validator.is_valid(value)

    for field in (
        "district_code",
        "district_name",
        "latitude",
        "longitude",
        "contact_name",
    ):
        without_field = {
            key: item for key, item in value.items() if key != field
        }
        assert not validator.is_valid(without_field)
    for field, invalid in (
        ("district_code", "31015"),
        ("district_name", ""),
        ("latitude", -90.01),
        ("latitude", 90.01),
        ("longitude", -180.01),
        ("longitude", 180.01),
        ("contact_name", ""),
        ("contact_name", "甲" * 41),
    ):
        assert not validator.is_valid({**value, field: invalid})


def test_venue_onboarding_errors_and_examples_are_closed_and_non_disclosing() -> None:
    contract = _contract()
    schemas = contract["components"]["schemas"]
    codes = set(schemas["Error"]["properties"]["code"]["enum"])
    assert {
        "POSSIBLE_DUPLICATE_VENUE",
        "ONBOARDING_EVIDENCE_REQUIRED",
        "ONBOARDING_EVIDENCE_INVALID",
        "ONBOARDING_APPLICATION_EXISTS",
        "ONBOARDING_APPLICATION_NOT_FOUND",
        "ONBOARDING_APPLICATION_STATE_CHANGED",
        "IDEMPOTENCY_KEY_REUSED",
    } <= codes

    duplicate_details = schemas["PossibleDuplicateVenueDetails"]
    assert duplicate_details["additionalProperties"] is False
    assert set(duplicate_details["properties"]) == {"claim_candidate"}
    candidate = schemas["VenueOnboardingCandidate"]
    assert candidate["additionalProperties"] is False
    assert set(candidate["properties"]) == {
        "venue_id",
        "name",
        "district_name",
        "address",
    }
    assert "listed and active" in candidate["description"].lower()

    expected_examples = {
        "venue-onboarding-candidates.json": "VenueOnboardingCandidates",
        "venue-claim-submitted.json": "VenueOnboardingApplication",
        "venue-create-submitted.json": "VenueOnboardingApplication",
        "venue-onboarding-applications.json": "VenueOnboardingApplications",
        "venue-onboarding-upload-intent.json": "VenueOnboardingUploadIntent",
        "error-possible-duplicate-venue.json": "ErrorEnvelope",
        "error-onboarding-evidence-required.json": "ErrorEnvelope",
    }
    for filename, schema_name in expected_examples.items():
        example = json.loads((EXAMPLES_DIRECTORY / filename).read_text())
        _assert_example_matches_schema(contract, example, schemas[schema_name])

    generic_duplicate = json.loads(
        (EXAMPLES_DIRECTORY / "error-possible-duplicate-venue.json").read_text()
    )
    assert generic_duplicate["error"]["code"] == "POSSIBLE_DUPLICATE_VENUE"
    assert generic_duplicate["error"]["details"] == {}
    assert not {
        "venue_id",
        "name",
        "district_name",
        "address",
        "latitude",
        "longitude",
    } & set(generic_duplicate["error"]["details"])


def test_venue_onboarding_error_responses_freeze_operation_specific_codes() -> None:
    contract = _contract()
    assert set(
        contract["paths"][
            "/api/v1/venue-onboarding/evidence/{evidence_id}/complete"
        ]["post"]["responses"]
    ) == {"200", "401", "404", "409", "422", "503"}
    for path in (
        "/api/v1/venue-onboarding/claims",
        "/api/v1/venue-onboarding/venues",
    ):
        assert set(contract["paths"][path]["post"]["responses"]) == {
            "200",
            "201",
            "401",
            "409",
            "422",
            "503",
        }
    assert set(
        contract["paths"]["/api/v1/venue-onboarding/applications"]["get"][
            "responses"
        ]
    ) == {"200", "401", "422", "503"}

    expected = {
        ("/api/v1/venue-onboarding/candidates", "get", "422"): {
            "INVALID_ARGUMENT"
        },
        ("/api/v1/venue-onboarding/evidence/upload-intents", "post", "409"): {
            "IDEMPOTENCY_KEY_REUSED"
        },
        ("/api/v1/venue-onboarding/evidence/upload-intents", "post", "422"): {
            "INVALID_ARGUMENT",
            "ONBOARDING_EVIDENCE_INVALID",
        },
        (
            "/api/v1/venue-onboarding/evidence/{evidence_id}/complete",
            "post",
            "404",
        ): {"ONBOARDING_APPLICATION_NOT_FOUND"},
        (
            "/api/v1/venue-onboarding/evidence/{evidence_id}/complete",
            "post",
            "409",
        ): {"ONBOARDING_APPLICATION_STATE_CHANGED", "IDEMPOTENCY_KEY_REUSED"},
        (
            "/api/v1/venue-onboarding/evidence/{evidence_id}/complete",
            "post",
            "422",
        ): {"INVALID_ARGUMENT", "ONBOARDING_EVIDENCE_INVALID"},
        ("/api/v1/venue-onboarding/claims", "post", "409"): {
            "ONBOARDING_APPLICATION_EXISTS",
            "ONBOARDING_APPLICATION_STATE_CHANGED",
            "IDEMPOTENCY_KEY_REUSED",
        },
        ("/api/v1/venue-onboarding/applications", "get", "422"): {
            "INVALID_ARGUMENT"
        },
    }
    submission_validation_codes = {
        "INVALID_ARGUMENT",
        "PHONE_AUTH_REQUIRED",
        "ONBOARDING_EVIDENCE_REQUIRED",
        "ONBOARDING_EVIDENCE_INVALID",
    }
    expected[("/api/v1/venue-onboarding/claims", "post", "422")] = (
        submission_validation_codes
    )
    expected[("/api/v1/venue-onboarding/venues", "post", "422")] = (
        submission_validation_codes
    )
    for path, method in (
        ("/api/v1/venue-onboarding/candidates", "get"),
        ("/api/v1/venue-onboarding/evidence/upload-intents", "post"),
        ("/api/v1/venue-onboarding/evidence/{evidence_id}/complete", "post"),
        ("/api/v1/venue-onboarding/claims", "post"),
        ("/api/v1/venue-onboarding/venues", "post"),
        ("/api/v1/venue-onboarding/applications", "get"),
    ):
        expected[(path, method, "503")] = {"SERVICE_UNAVAILABLE"}

    for (path, method, status), codes in expected.items():
        schema = _response_schema(contract["paths"][path][method], status)
        assert schema["allOf"][0] == {"$ref": "#/components/schemas/ErrorEnvelope"}
        code_schema = schema["allOf"][1]["properties"]["error"]["properties"][
            "code"
        ]
        actual = set(code_schema.get("enum", [code_schema.get("const")]))
        assert actual == codes

    invalid_argument_reference = "./examples/error-invalid-argument.json"
    for path, method in (
        ("/api/v1/venue-onboarding/evidence/{evidence_id}/complete", "post"),
        ("/api/v1/venue-onboarding/claims", "post"),
        ("/api/v1/venue-onboarding/venues", "post"),
        ("/api/v1/venue-onboarding/applications", "get"),
    ):
        examples = contract["paths"][path][method]["responses"]["422"]["content"][
            "application/json"
        ]["examples"]
        assert examples["InvalidArgument"] == {
            "externalValue": invalid_argument_reference
        }


def test_possible_duplicate_response_rejects_unrelated_error_details() -> None:
    contract = _contract()
    response_schema = _response_schema(
        contract["paths"]["/api/v1/venue-onboarding/venues"]["post"], "409"
    )
    assert response_schema == {
        "oneOf": [
            {"$ref": "#/components/schemas/PossibleDuplicateVenueError"},
            {"$ref": "#/components/schemas/VenueOnboardingSubmissionConflictError"},
        ]
    }

    possible_duplicate = contract["components"]["schemas"][
        "PossibleDuplicateVenueError"
    ]
    assert possible_duplicate["allOf"][1]["properties"]["error"]["properties"][
        "details"
    ] == {"$ref": "#/components/schemas/PossibleDuplicateVenueDetails"}
    assert possible_duplicate["allOf"][1]["properties"]["error"]["properties"][
        "code"
    ] == {"const": "POSSIBLE_DUPLICATE_VENUE"}
    submission_conflict = contract["components"]["schemas"][
        "VenueOnboardingSubmissionConflictError"
    ]
    assert set(
        submission_conflict["allOf"][1]["properties"]["error"]["properties"][
            "code"
        ]["enum"]
    ) == {
        "ONBOARDING_APPLICATION_EXISTS",
        "ONBOARDING_APPLICATION_STATE_CHANGED",
        "IDEMPOTENCY_KEY_REUSED",
    }

    validator = Draft202012Validator(contract).evolve(schema=response_schema)
    safe_error = {
        "error": {
            "code": "POSSIBLE_DUPLICATE_VENUE",
            "message": "可能已存在该场馆",
            "request_id": "req-duplicate",
            "details": {},
        }
    }
    assert validator.is_valid(safe_error)

    safe_error["error"]["details"] = {"field": "address"}
    assert not validator.is_valid(safe_error)


def test_platform_session_contract_is_closed_cookie_authenticated_and_csrf_protected() -> None:
    contract = _contract()
    path = contract["paths"]["/platform-admin/api/v1/auth/session"]
    assert set(path) == {"post", "get", "delete"}

    assert path["post"].get("security", []) == []
    assert set(path["post"]["responses"]) == {"200", "401", "403", "422", "503"}
    assert path["get"]["security"] == [{"platformSession": []}]
    assert set(path["get"]["responses"]) == {"200", "401", "503"}
    assert path["delete"]["security"] == [{"platformSession": []}]
    assert set(path["delete"]["responses"]) == {"204", "401", "403", "503"}

    exchange = contract["components"]["schemas"]["PlatformSessionExchange"]
    assert exchange["additionalProperties"] is False
    assert set(exchange["required"]) == {"access_token"}
    assert set(exchange["properties"]) == {"access_token"}
    assert exchange["properties"]["access_token"] == {
        "type": "string",
        "minLength": 32,
        "maxLength": 256,
        "writeOnly": True,
    }

    response = contract["components"]["schemas"]["PlatformSession"]
    assert response["additionalProperties"] is False
    assert set(response["required"]) == {
        "principal_id",
        "display_name",
        "roles",
        "csrf_token",
        "expires_at",
    }
    assert not {"access_token", "token_sha256", "session_token"} & set(
        response["properties"]
    )
    assert response["properties"]["roles"]["items"]["enum"] == [
        "PLATFORM_ADMIN",
        "ONBOARDING_REVIEWER",
    ]

    post_parameters = {item["name"]: item for item in path["post"]["parameters"]}
    assert set(post_parameters) == {"Origin"}
    delete_parameters = {item["name"]: item for item in path["delete"]["parameters"]}
    assert set(delete_parameters) == {"Origin", "X-CSRF-Token"}
    assert all(
        item["in"] == "header" and item["required"]
        for item in (*post_parameters.values(), *delete_parameters.values())
    )
    assert contract["components"]["securitySchemes"]["platformSession"] == {
        "type": "apiKey",
        "in": "cookie",
        "name": "pitch_platform_session",
    }

    expected_error_codes = {
        ("post", "401"): "PLATFORM_AUTH_INVALID",
        ("post", "403"): "PLATFORM_CSRF_INVALID",
        ("post", "422"): "INVALID_ARGUMENT",
        ("post", "503"): "SERVICE_UNAVAILABLE",
        ("get", "401"): "PLATFORM_AUTH_REQUIRED",
        ("get", "503"): "SERVICE_UNAVAILABLE",
        ("delete", "401"): "PLATFORM_AUTH_REQUIRED",
        ("delete", "403"): "PLATFORM_CSRF_INVALID",
        ("delete", "503"): "SERVICE_UNAVAILABLE",
    }
    for (method, status), code in expected_error_codes.items():
        schema = _response_schema(path[method], status)
        assert schema["allOf"][0] == {
            "$ref": "#/components/schemas/ErrorEnvelope"
        }
        assert schema["allOf"][1]["properties"]["error"]["properties"][
            "code"
        ] == {"const": code}

    example = json.loads((EXAMPLES_DIRECTORY / "platform-session.json").read_text())
    _assert_example_matches_schema(contract, example, response)

    runtime = create_app().openapi()
    runtime_path = runtime["paths"]["/platform-admin/api/v1/auth/session"]
    assert set(runtime_path) == {"post", "get", "delete"}
    for method, expected_names in (
        ("post", {"Origin"}),
        ("delete", {"Origin", "X-CSRF-Token"}),
    ):
        static_parameters = {
            item["name"]: item for item in path[method]["parameters"]
        }
        runtime_parameters = {
            item["name"]: item for item in runtime_path[method]["parameters"]
        }
        assert set(runtime_parameters) == expected_names == set(static_parameters)
        for name in expected_names:
            assert runtime_parameters[name]["required"] is True
            assert runtime_parameters[name]["schema"].get("nullable") is not True
            runtime_types = {
                item.get("type")
                for item in runtime_parameters[name]["schema"].get("anyOf", [])
            }
            assert runtime_types != {"string", "null"}
