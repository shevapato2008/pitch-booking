import json
from importlib import import_module
from pathlib import Path
from typing import Any, Protocol, cast

import pytest
from fastapi.openapi.utils import get_openapi
from jsonschema import Draft202012Validator

from backend.app.config import Settings
from backend.app.main import create_app
from backend.app.modules.open_game_registrations.router import (
    align_my_open_game_applications_openapi,
)

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
CONTRACT_PATH = REPOSITORY_ROOT / "contracts" / "openapi.yaml"
EXAMPLES_DIRECTORY = CONTRACT_PATH.parent / "examples"


class _YamlLoader(Protocol):
    def safe_load(self, stream: str) -> object: ...


YAML = cast(_YamlLoader, import_module("yaml"))

REGISTRATION_OPERATIONS = {
    "/api/v1/open-game-applications": {"get"},
    "/api/v1/open-game-applications/{application_id}/withdraw": {"post"},
    "/api/v1/shared-games/{share_token}/registration-context": {"get"},
    "/api/v1/shared-games/{share_token}/applications": {"post"},
    "/api/v1/games/{game_id}/applications": {"get"},
    "/api/v1/games/{game_id}/applications/{application_id}/decision": {"post"},
}

MY_OPEN_GAME_APPLICATION_FIELDS = {
    "id",
    "effective_status",
    "applied_at",
    "waitlist_position",
    "waitlisted_at",
    "promoted_at",
    "attendance_status",
    "attendance_recorded_at",
    "detail_path",
    "game_name",
    "starts_at",
    "ends_at",
    "time_zone",
    "venue_name",
    "pitch_name",
    "pitch_specification",
}

ATTENDANCE_ROSTER_PATH = "/api/v1/games/{game_id}/attendance-roster"
ATTENDANCE_MARK_PATH = (
    "/api/v1/games/{game_id}/registrations/{registration_id}/attendance"
)


def test_my_open_game_applications_contract_is_closed_paginated_and_authenticated() -> None:
    contract = _contract()
    path = "/api/v1/open-game-applications"
    assert path in contract["paths"], "my applications list path must be frozen"
    assert set(contract["paths"][path]) == {"get"}
    operation = contract["paths"][path]["get"]

    assert operation["operationId"] == "listMyOpenGameApplications"
    assert operation["security"] == [{"bearerAuth": []}]
    assert operation["parameters"] == [
        {
            "name": "limit",
            "in": "query",
            "required": False,
            "schema": {"type": "integer", "minimum": 1, "maximum": 50, "default": 20},
        },
        {
            "name": "cursor",
            "in": "query",
            "required": False,
            "schema": {"type": "string", "minLength": 1},
        },
    ]
    assert set(operation["responses"]) == {"200", "401", "422", "503"}
    for response in operation["responses"].values():
        assert response["headers"] == {
            "X-Request-Id": {"$ref": "#/components/headers/RequestId"}
        }
    assert _response_schema(operation, "200") == {
        "$ref": "#/components/schemas/MyOpenGameApplicationsResponse"
    }
    assert operation["responses"]["200"]["content"]["application/json"]["examples"] == {
        "Ready": {"externalValue": "./examples/my-open-game-applications-ready.json"},
        "Empty": {"externalValue": "./examples/my-open-game-applications-empty.json"},
    }

    expected_codes = {
        "401": "AUTH_REQUIRED",
        "422": "INVALID_ARGUMENT",
        "503": "SERVICE_UNAVAILABLE",
    }
    for status, code in expected_codes.items():
        schema = _response_schema(operation, status)
        assert schema["allOf"][0] == {"$ref": "#/components/schemas/ErrorEnvelope"}
        assert schema["allOf"][1]["properties"]["error"]["properties"]["code"] == {
            "const": code
        }

    invalid_argument = operation["responses"]["422"]["content"]["application/json"]
    assert invalid_argument["examples"] == {
        "InvalidArgument": {
            "externalValue": (
                "./examples/error-my-open-game-applications-invalid-argument.json"
            )
        }
    }
    invalid_example = json.loads(
        (
            EXAMPLES_DIRECTORY
            / "error-my-open-game-applications-invalid-argument.json"
        ).read_text()
    )
    assert invalid_example["error"] == {
        "code": "INVALID_ARGUMENT",
        "message": "请求参数格式不正确，请检查后重试。",
        "request_id": "req_my_open_game_applications_invalid_001",
        "details": {},
    }

    schemas = contract["components"]["schemas"]
    item = schemas["MyOpenGameApplication"]
    assert item["additionalProperties"] is False
    assert set(item["required"]) == MY_OPEN_GAME_APPLICATION_FIELDS
    assert set(item["properties"]) == MY_OPEN_GAME_APPLICATION_FIELDS
    assert item["properties"]["detail_path"] == {
        "type": "string",
        "pattern": r"^/pages/captain-game-public/index\?token=[A-Za-z0-9_-]{32}$",
    }
    assert item["properties"]["effective_status"] == {
        "$ref": "#/components/schemas/OpenGameRegistrationEffectiveStatus"
    }
    for field in ("applied_at", "starts_at", "ends_at"):
        assert item["properties"][field] == {"type": "string", "format": "date-time"}
    assert item["properties"]["waitlist_position"] == {
        "type": ["integer", "null"],
        "minimum": 1,
    }
    for field in ("waitlisted_at", "promoted_at"):
        assert item["properties"][field] == {
            "type": ["string", "null"],
            "format": "date-time",
        }

    response = schemas["MyOpenGameApplicationsResponse"]
    assert response["additionalProperties"] is False
    assert set(response["required"]) == {"items", "next_cursor"}
    assert set(response["properties"]) == {"items", "next_cursor"}
    assert response["properties"]["next_cursor"] == {
        "type": ["string", "null"],
        "minLength": 1,
    }

    for filename in (
        "my-open-game-applications-ready.json",
        "my-open-game-applications-empty.json",
    ):
        example = json.loads((EXAMPLES_DIRECTORY / filename).read_text())
        validator = Draft202012Validator(
            _dereference_local_schema(contract, response)
        )
        assert validator.is_valid(example), filename


def test_my_applications_aligner_does_not_overwrite_shared_error_schemas() -> None:
    frozen_schemas = _contract()["components"]["schemas"]
    error_schema_names = _local_schema_closure(frozen_schemas, root="ErrorEnvelope")
    sentinels = {name: {"owner": "shared"} for name in error_schema_names}
    schema = {
        "paths": {
            "/api/v1/open-game-applications": {"get": {}},
            ATTENDANCE_ROSTER_PATH: {"get": {}},
            ATTENDANCE_MARK_PATH: {"post": {}},
        },
        "components": {"schemas": dict(sentinels)},
    }

    align_my_open_game_applications_openapi(schema)

    assert {
        name: schema["components"]["schemas"][name]
        for name in error_schema_names
    } == sentinels


def test_my_open_game_applications_runtime_openapi_matches_frozen_operation() -> None:
    frozen = _contract()
    runtime = create_app(
        settings=Settings(app_env="test", wechat_provider="development")
    ).openapi()
    path = "/api/v1/open-game-applications"

    assert runtime["paths"][path]["get"] == frozen["paths"][path]["get"]
    assert runtime["components"]["securitySchemes"]["bearerAuth"] == frozen[
        "components"
    ]["securitySchemes"]["bearerAuth"]
    assert runtime["components"]["headers"]["RequestId"] == frozen["components"][
        "headers"
    ]["RequestId"]
    for response in runtime["paths"][path]["get"]["responses"].values():
        assert response["headers"]["X-Request-Id"] == {
            "$ref": "#/components/headers/RequestId"
        }
    for name in ("MyOpenGameApplication", "MyOpenGameApplicationsResponse"):
        assert runtime["components"]["schemas"][name] == frozen["components"][
            "schemas"
        ][name]

    frozen_schemas = frozen["components"]["schemas"]
    error_schema_names = _local_schema_closure(
        frozen_schemas,
        root="ErrorEnvelope",
    )
    assert {"ErrorEnvelope", "Error", "ErrorDetails"} <= error_schema_names
    for name in sorted(error_schema_names):
        assert runtime["components"]["schemas"][name] == frozen_schemas[name]


def _contract() -> dict[str, Any]:
    loaded = YAML.safe_load(CONTRACT_PATH.read_text())
    if not isinstance(loaded, dict):
        raise TypeError("OpenAPI contract root must be an object")
    return cast(dict[str, Any], loaded)


def _local_schema_references(value: Any) -> set[str]:
    if isinstance(value, list):
        return set().union(*(_local_schema_references(item) for item in value))
    if not isinstance(value, dict):
        return set()
    references = set()
    reference = value.get("$ref")
    if isinstance(reference, str) and reference.startswith("#/components/schemas/"):
        references.add(reference.rsplit("/", 1)[-1])
    for child in value.values():
        references.update(_local_schema_references(child))
    return references


def _local_schema_closure(
    schemas: dict[str, Any],
    *,
    root: str,
) -> set[str]:
    names: set[str] = set()
    pending = [root]
    while pending:
        name = pending.pop()
        if name in names:
            continue
        names.add(name)
        pending.extend(_local_schema_references(schemas[name]))
    return names


def _resolve_schema(contract: dict[str, Any], schema: dict[str, Any]) -> dict[str, Any]:
    reference = schema.get("$ref")
    if reference is None:
        return schema
    assert reference.startswith("#/components/schemas/")
    return cast(
        dict[str, Any], contract["components"]["schemas"][reference.rsplit("/", 1)[-1]]
    )


def _dereference_local_schema(contract: dict[str, Any], value: Any) -> Any:
    if isinstance(value, list):
        return [_dereference_local_schema(contract, item) for item in value]
    if not isinstance(value, dict):
        return value
    reference = value.get("$ref")
    if isinstance(reference, str) and reference.startswith("#/components/schemas/"):
        return _dereference_local_schema(
            contract, contract["components"]["schemas"][reference.rsplit("/", 1)[-1]]
        )
    return {
        key: _dereference_local_schema(contract, child)
        for key, child in value.items()
        if not key.startswith("x-")
    }


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
        expected_example_keys = {"InvalidArgument"}
        if (path, method) == ("/api/v1/games/{game_id}", "put"):
            expected_example_keys.add("JoinedUpdateInvalid")
        assert set(invalid["examples"]) == expected_example_keys
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
    assert schemas["CreateOpenGameRequest"] == schemas["OpenGameDraftInput"]
    for schema_name in (
        "OpenGameDraftInput",
        "CreateOpenGameRequest",
        "UpdateOpenGameRequest",
    ):
        assert schemas[schema_name]["properties"]["positions"] == {
            "$ref": "#/components/schemas/OpenGamePositionSelection"
        }

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
    assert owner["properties"]["positions"] == {
        "$ref": "#/components/schemas/OpenGamePositions"
    }
    assert schemas["OpenGamePublic"]["properties"]["positions"] == {
        "$ref": "#/components/schemas/OpenGamePositions"
    }
    assert schemas["OpenGameShare"]["properties"]["image_url"] == {
        "type": ["string", "null"],
        "format": "uri",
        "pattern": "^https://",
        "description": (
            "Approved published venue cover, or null so the Mini Program omits "
            "imageUrl and uses WeChat's default page card."
        ),
    }

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


def test_open_game_registration_operations_freeze_exact_boundaries() -> None:
    contract = _contract()
    paths = contract["paths"]

    assert {path: set(paths[path]) for path in REGISTRATION_OPERATIONS} == (
        REGISTRATION_OPERATIONS
    )
    operation_ids = {
        (
            "/api/v1/open-game-applications",
            "get",
        ): "listMyOpenGameApplications",
        (
            "/api/v1/open-game-applications/{application_id}/withdraw",
            "post",
        ): "withdrawOpenGameApplication",
        (
            "/api/v1/shared-games/{share_token}/registration-context",
            "get",
        ): "getOpenGameRegistrationContext",
        (
            "/api/v1/shared-games/{share_token}/applications",
            "post",
        ): "createOpenGameApplication",
        (
            "/api/v1/games/{game_id}/applications",
            "get",
        ): "listOpenGameApplications",
        (
            "/api/v1/games/{game_id}/applications/{application_id}/decision",
            "post",
        ): "decideOpenGameApplication",
    }
    statuses = {
        (
            "/api/v1/open-game-applications",
            "get",
        ): {"200", "401", "422", "503"},
        (
            "/api/v1/open-game-applications/{application_id}/withdraw",
            "post",
        ): {"200", "401", "404", "409", "422", "503"},
        (
            "/api/v1/shared-games/{share_token}/registration-context",
            "get",
        ): {"200", "401", "404", "503"},
        (
            "/api/v1/shared-games/{share_token}/applications",
            "post",
        ): {"201", "401", "404", "409", "422", "503"},
        (
            "/api/v1/games/{game_id}/applications",
            "get",
        ): {"200", "401", "404", "422", "503"},
        (
            "/api/v1/games/{game_id}/applications/{application_id}/decision",
            "post",
        ): {"200", "401", "404", "409", "422", "503"},
    }
    response_schemas = {
        (
            "/api/v1/open-game-applications",
            "get",
        ): ("200", "MyOpenGameApplicationsResponse"),
        (
            "/api/v1/open-game-applications/{application_id}/withdraw",
            "post",
        ): ("200", "OpenGameRegistrationContext"),
        (
            "/api/v1/shared-games/{share_token}/registration-context",
            "get",
        ): ("200", "OpenGameRegistrationContext"),
        (
            "/api/v1/shared-games/{share_token}/applications",
            "post",
        ): ("201", "OpenGameRegistrationContext"),
        (
            "/api/v1/games/{game_id}/applications",
            "get",
        ): ("200", "OpenGameApplicationQueue"),
        (
            "/api/v1/games/{game_id}/applications/{application_id}/decision",
            "post",
        ): ("200", "OpenGameApplicationDecisionResult"),
    }

    for path, methods in REGISTRATION_OPERATIONS.items():
        for method in methods:
            operation = paths[path][method]
            key = (path, method)
            assert operation["operationId"] == operation_ids[key]
            assert set(operation["responses"]) == statuses[key]
            if path.endswith("registration-context"):
                assert operation["security"] == [{}, {"bearerAuth": []}]
            else:
                assert operation["security"] == [{"bearerAuth": []}]
            status, schema_name = response_schemas[key]
            assert _response_schema(operation, status) == {
                "$ref": f"#/components/schemas/{schema_name}"
            }

    request_schemas = {
        (
            "/api/v1/shared-games/{share_token}/applications",
            "post",
        ): "CreateOpenGameApplicationRequest",
        (
            "/api/v1/games/{game_id}/applications/{application_id}/decision",
            "post",
        ): "OpenGameApplicationDecisionRequest",
        (
            "/api/v1/open-game-applications/{application_id}/withdraw",
            "post",
        ): "OpenGameApplicationWithdrawalRequest",
    }
    for (path, method), schema_name in request_schemas.items():
        operation = paths[path][method]
        assert {parameter.get("$ref") for parameter in operation["parameters"]} >= {
            "#/components/parameters/IdempotencyKey"
        }
        assert operation["requestBody"] == {
            "required": True,
            "content": {
                "application/json": {
                    "schema": {"$ref": f"#/components/schemas/{schema_name}"}
                }
            },
        }
    for path in (
        "/api/v1/open-game-applications",
        "/api/v1/shared-games/{share_token}/registration-context",
        "/api/v1/games/{game_id}/applications",
    ):
        assert "requestBody" not in paths[path]["get"]
        assert all(
            parameter.get("$ref") != "#/components/parameters/IdempotencyKey"
            for parameter in paths[path]["get"]["parameters"]
        )

    expected_examples = {
        (
            "/api/v1/shared-games/{share_token}/registration-context",
            "get",
            "200",
        ): {
            "Anonymous": "open-game-registration-context-anonymous.json",
            "ApplyReady": "open-game-registration-context-apply-ready.json",
            "Applied": "open-game-registration-context-applied.json",
            "Waitlisted": "open-game-registration-context-waitlisted.json",
            "Joined": "open-game-registration-context-joined.json",
            "Rejected": "open-game-registration-context-rejected.json",
            "WithdrawnApplication": (
                "open-game-registration-context-withdrawn-application.json"
            ),
            "WithdrawnWaitlist": (
                "open-game-registration-context-withdrawn-waitlist.json"
            ),
            "WithdrawnGameExit": (
                "open-game-registration-context-withdrawn-game-exit.json"
            ),
            "Cancelled": "open-game-registration-context-cancelled.json",
        },
        (
            "/api/v1/shared-games/{share_token}/registration-context",
            "get",
            "401",
        ): {"AuthRequired": "error-auth-required.json"},
        (
            "/api/v1/shared-games/{share_token}/registration-context",
            "get",
            "404",
        ): {"OpenGameNotFound": "error-open-game-not-found.json"},
        (
            "/api/v1/shared-games/{share_token}/registration-context",
            "get",
            "503",
        ): {"ServiceUnavailable": "error-service-unavailable.json"},
        (
            "/api/v1/open-game-applications/{application_id}/withdraw",
            "post",
            "200",
        ): {
            "ApplicationWithdrawn": (
                "open-game-registration-context-withdrawn-application.json"
            ),
            "WaitlistWithdrawn": (
                "open-game-registration-context-withdrawn-waitlist.json"
            ),
            "GameExited": "open-game-registration-context-withdrawn-game-exit.json",
        },
        (
            "/api/v1/open-game-applications/{application_id}/withdraw",
            "post",
            "401",
        ): {"AuthRequired": "error-auth-required.json"},
        (
            "/api/v1/open-game-applications/{application_id}/withdraw",
            "post",
            "404",
        ): {"ApplicationNotFound": "error-application-not-found.json"},
        (
            "/api/v1/open-game-applications/{application_id}/withdraw",
            "post",
            "409",
        ): {
            "ApplicationStateChanged": "error-application-state-changed.json",
            "IdempotencyKeyReused": "error-idempotency-key-reused.json",
        },
        (
            "/api/v1/open-game-applications/{application_id}/withdraw",
            "post",
            "422",
        ): {"InvalidArgument": "error-invalid-argument.json"},
        (
            "/api/v1/open-game-applications/{application_id}/withdraw",
            "post",
            "503",
        ): {"ServiceUnavailable": "error-service-unavailable.json"},
        (
            "/api/v1/shared-games/{share_token}/applications",
            "post",
            "201",
        ): {"Applied": "open-game-registration-context-applied.json"},
        (
            "/api/v1/shared-games/{share_token}/applications",
            "post",
            "401",
        ): {"AuthRequired": "error-auth-required.json"},
        (
            "/api/v1/shared-games/{share_token}/applications",
            "post",
            "404",
        ): {"OpenGameNotFound": "error-open-game-not-found.json"},
        (
            "/api/v1/shared-games/{share_token}/applications",
            "post",
            "409",
        ): {
            "ApplicationAlreadyExists": "error-application-already-exists.json",
            "ApplicationNotAllowed": "error-application-not-allowed.json",
            "IdempotencyKeyReused": "error-idempotency-key-reused.json",
        },
        (
            "/api/v1/shared-games/{share_token}/applications",
            "post",
            "422",
        ): {"InvalidArgument": "error-invalid-argument.json"},
        (
            "/api/v1/shared-games/{share_token}/applications",
            "post",
            "503",
        ): {"ServiceUnavailable": "error-service-unavailable.json"},
        (
            "/api/v1/games/{game_id}/applications",
            "get",
            "200",
        ): {
            "Pending": "open-game-applications-pending.json",
            "FullWaitlist": "open-game-applications-full-waitlist.json",
            "Empty": "open-game-applications-empty.json",
        },
        (
            "/api/v1/games/{game_id}/applications",
            "get",
            "401",
        ): {"AuthRequired": "error-auth-required.json"},
        (
            "/api/v1/games/{game_id}/applications",
            "get",
            "404",
        ): {"OpenGameNotFound": "error-open-game-not-found.json"},
        (
            "/api/v1/games/{game_id}/applications",
            "get",
            "422",
        ): {"InvalidArgument": "error-invalid-argument.json"},
        (
            "/api/v1/games/{game_id}/applications",
            "get",
            "503",
        ): {"ServiceUnavailable": "error-service-unavailable.json"},
        (
            "/api/v1/games/{game_id}/applications/{application_id}/decision",
            "post",
            "200",
        ): {
            "Waitlisted": "open-game-application-decision-waitlisted.json",
            "Joined": "open-game-application-decision-joined.json",
            "Rejected": "open-game-application-decision-rejected.json",
        },
        (
            "/api/v1/games/{game_id}/applications/{application_id}/decision",
            "post",
            "401",
        ): {"AuthRequired": "error-auth-required.json"},
        (
            "/api/v1/games/{game_id}/applications/{application_id}/decision",
            "post",
            "404",
        ): {
            "ApplicationNotFound": "error-application-not-found.json",
            "OpenGameNotFound": "error-open-game-not-found.json",
        },
        (
            "/api/v1/games/{game_id}/applications/{application_id}/decision",
            "post",
            "409",
        ): {
            "ApplicationStateChanged": "error-application-state-changed.json",
            "ApplicationCapacityChanged": "error-application-capacity-changed.json",
            "IdempotencyKeyReused": "error-idempotency-key-reused.json",
        },
        (
            "/api/v1/games/{game_id}/applications/{application_id}/decision",
            "post",
            "422",
        ): {"InvalidArgument": "error-invalid-argument.json"},
        (
            "/api/v1/games/{game_id}/applications/{application_id}/decision",
            "post",
            "503",
        ): {"ServiceUnavailable": "error-service-unavailable.json"},
    }
    for (path, method, status), examples in expected_examples.items():
        actual = paths[path][method]["responses"][status]["content"][
            "application/json"
        ]["examples"]
        assert actual == {
            key: {"externalValue": f"./examples/{filename}"}
            for key, filename in examples.items()
        }

    joined_update = paths["/api/v1/games/{game_id}"]["put"]["responses"][
        "422"
    ]["content"]["application/json"]["examples"]
    assert joined_update["JoinedUpdateInvalid"] == {
        "externalValue": "./examples/error-open-game-joined-update-invalid.json"
    }


def test_open_game_registration_runtime_openapi_matches_the_frozen_operations() -> None:
    contract = _contract()
    runtime = create_app(
        settings=Settings(app_env="test", wechat_provider="development")
    ).openapi()
    operation_ids = {
        (
            "/api/v1/shared-games/{share_token}/registration-context",
            "get",
        ): "getOpenGameRegistrationContext",
        (
            "/api/v1/open-game-applications/{application_id}/withdraw",
            "post",
        ): "withdrawOpenGameApplication",
        (
            "/api/v1/shared-games/{share_token}/applications",
            "post",
        ): "createOpenGameApplication",
        (
            "/api/v1/games/{game_id}/applications",
            "get",
        ): "listOpenGameApplications",
        (
            "/api/v1/games/{game_id}/applications/{application_id}/decision",
            "post",
        ): "decideOpenGameApplication",
    }
    statuses = {
        (
            "/api/v1/shared-games/{share_token}/registration-context",
            "get",
        ): {"200", "401", "404", "503"},
        (
            "/api/v1/open-game-applications/{application_id}/withdraw",
            "post",
        ): {"200", "401", "404", "409", "422", "503"},
        (
            "/api/v1/shared-games/{share_token}/applications",
            "post",
        ): {"201", "401", "404", "409", "422", "503"},
        (
            "/api/v1/games/{game_id}/applications",
            "get",
        ): {"200", "401", "404", "422", "503"},
        (
            "/api/v1/games/{game_id}/applications/{application_id}/decision",
            "post",
        ): {"200", "401", "404", "409", "422", "503"},
    }

    for key, operation_id in operation_ids.items():
        path, method = key
        operation = runtime["paths"][path][method]
        assert operation["operationId"] == operation_id
        assert set(operation["responses"]) == statuses[key]
        assert operation["security"] == (
            [{}, {"bearerAuth": []}]
            if path.endswith("registration-context")
            else [{"bearerAuth": []}]
        )

    withdrawal_path = "/api/v1/open-game-applications/{application_id}/withdraw"
    assert runtime["paths"][withdrawal_path]["post"] == (
        contract["paths"][withdrawal_path]["post"]
    )

    queue_invalid = runtime["paths"][
        "/api/v1/games/{game_id}/applications"
    ]["get"]["responses"]["422"]["content"]["application/json"]["examples"]
    assert queue_invalid == {
        "InvalidArgument": {
            "value": json.loads(
                (EXAMPLES_DIRECTORY / "error-invalid-argument.json").read_text()
            )
        }
    }

    for path, status in (
        (
            "/api/v1/shared-games/{share_token}/registration-context",
            "200",
        ),
        ("/api/v1/shared-games/{share_token}/applications", "201"),
        ("/api/v1/open-game-applications/{application_id}/withdraw", "200"),
    ):
        runtime_response = runtime["paths"][path][
            "get" if path.endswith("registration-context") else "post"
        ]["responses"][status]["content"]["application/json"]["schema"]
        static_response = contract["paths"][path][
            "get" if path.endswith("registration-context") else "post"
        ]["responses"][status]["content"]["application/json"]["schema"]
        assert runtime_response == static_response

    affected_schemas = (
        "OpenGameRegistrationPosition",
        "OpenGameRegistrationPersistedStatus",
        "OpenGameRegistrationEffectiveStatus",
        "OpenGameRegistrationWithdrawalKind",
        "OpenGameRegistrationAvailableWithdrawalAction",
        "OpenGameRegistrationWithdrawalAction",
        "OpenGameApplyBlockedReason",
        "OpenGameApplyActions",
        "OpenGameReviewBlockedReason",
        "OpenGameWaitlistBlockedReason",
        "OpenGameReviewActions",
        "OpenGameViewerRegistration",
        "OpenGameRegistrationContext",
        "CaptainOpenGameWaitlistApplication",
        "OpenGameApplicationQueue",
        "OpenGameApplicationDecisionResult",
        "OpenGameApplicationWithdrawalRequest",
    )
    for schema_name in affected_schemas:
        assert runtime["components"]["schemas"][schema_name] == (
            contract["components"]["schemas"][schema_name]
        )


def test_open_game_registration_schemas_are_closed_and_exact() -> None:
    contract = _contract()
    schemas = contract["components"]["schemas"]
    required_fields = {
        "OpenGameApplyActions": {"can_apply", "apply_blocked_reason"},
        "OpenGameReviewActions": {
            "can_accept",
            "accept_blocked_reason",
            "can_waitlist",
            "waitlist_blocked_reason",
            "can_reject",
            "reject_blocked_reason",
        },
        "OpenGameViewerRegistration": {
            "id",
            "display_name",
            "position",
            "note",
            "persisted_status",
            "effective_status",
            "version",
            "applied_at",
            "decided_at",
            "withdrawn_at",
            "withdrawal_kind",
            "late_exit_recorded",
            "available_withdrawal_action",
            "late_exit_will_be_recorded",
            "waitlist_position",
            "waitlisted_at",
            "promoted_at",
            "attendance_status",
            "attendance_recorded_at",
        },
        "OpenGameRegistrationContext": {
            "game",
            "remaining_spots",
            "viewer_authenticated",
            "viewer_registration",
            "allowed_actions",
        },
        "CreateOpenGameApplicationRequest": {
            "display_name",
            "position",
            "note",
            "adult_confirmed",
            "risk_confirmed",
        },
        "CaptainOpenGameApplication": {
            "id",
            "display_name",
            "position",
            "note",
            "applied_at",
            "version",
            "allowed_actions",
        },
        "OpenGameApplicationQueue": {
            "remaining_spots",
            "pending_count",
            "applications",
            "waitlist_count",
            "waitlist",
        },
        "CaptainOpenGameWaitlistApplication": {
            "id",
            "display_name",
            "position",
            "note",
            "applied_at",
            "waitlisted_at",
            "waitlist_position",
        },
        "OpenGameApplicationDecisionRequest": {"decision", "expected_version"},
        "OpenGameApplicationWithdrawalRequest": {"action", "expected_version"},
        "OpenGameApplicationDecisionResult": {
            "application_id",
            "status",
            "version",
            "decided_at",
            "remaining_spots",
            "allowed_actions",
        },
        "ApplicationNotAllowedDetails": {
            "apply_blocked_reason",
            "remaining_spots",
        },
        "ApplicationCapacityChangedDetails": {
            "remaining_spots",
            "allowed_actions",
        },
    }
    for schema_name, fields in required_fields.items():
        schema = schemas[schema_name]
        assert schema["type"] == "object"
        assert schema["additionalProperties"] is False
        assert set(schema["required"]) == fields
        assert set(schema["properties"]) == fields

    assert schemas["OpenGameRegistrationPosition"] == {
        "type": "string",
        "enum": ["GOALKEEPER", "DEFENDER", "MIDFIELDER", "FORWARD", "ANY"],
    }
    assert schemas["OpenGameRegistrationPersistedStatus"] == {
        "type": "string",
        "enum": ["APPLIED", "WAITLISTED", "JOINED", "REJECTED", "WITHDRAWN"],
    }
    assert schemas["OpenGameRegistrationEffectiveStatus"] == {
        "type": "string",
        "enum": [
            "APPLIED",
            "WAITLISTED",
            "JOINED",
            "REJECTED",
            "WITHDRAWN",
            "CANCELLED",
        ],
    }
    assert schemas["OpenGameRegistrationWithdrawalKind"] == {
        "type": "string",
        "enum": ["APPLICATION_WITHDRAWAL", "WAITLIST_WITHDRAWAL", "GAME_EXIT"],
    }
    assert schemas["OpenGameRegistrationWithdrawalAction"] == {
        "type": "string",
        "enum": ["WITHDRAW_APPLICATION", "WITHDRAW_WAITLIST", "LEAVE_GAME"],
    }
    assert schemas["OpenGameApplyBlockedReason"] == {
        "type": "string",
        "enum": [
            "AUTH_REQUIRED",
            "OWNER_CANNOT_APPLY",
            "ALREADY_APPLIED",
            "GAME_NOT_PUBLISHED",
            "REGISTRATION_DEADLINE_PASSED",
            "GAME_SUSPENDED",
            "GAME_CANCELLED",
            "GAME_COMPLETED",
            "GAME_STARTED",
        ],
    }
    assert schemas["OpenGameReviewBlockedReason"] == {
        "type": "string",
        "enum": [
            "APPLICATION_NOT_PENDING",
            "GAME_SUSPENDED",
            "GAME_CANCELLED",
            "GAME_COMPLETED",
            "GAME_STARTED",
            "GAME_FULL",
        ],
    }
    for schema_name in (
        "OpenGameViewerRegistration",
        "CreateOpenGameApplicationRequest",
        "CaptainOpenGameApplication",
        "CaptainOpenGameWaitlistApplication",
    ):
        properties = schemas[schema_name]["properties"]
        assert properties["display_name"] == {
            "type": "string",
            "minLength": 2,
            "maxLength": 24,
        }
        assert properties["position"] == {
            "$ref": "#/components/schemas/OpenGameRegistrationPosition"
        }
        assert properties["note"] == {
            "type": ["string", "null"],
            "maxLength": 120,
        }
    request = schemas["CreateOpenGameApplicationRequest"]["properties"]
    assert request["adult_confirmed"] == {"type": "boolean", "const": True}
    assert request["risk_confirmed"] == {"type": "boolean", "const": True}

    viewer = schemas["OpenGameViewerRegistration"]["properties"]
    assert viewer["id"] == {"type": "string", "format": "uuid"}
    assert viewer["persisted_status"] == {
        "$ref": "#/components/schemas/OpenGameRegistrationPersistedStatus"
    }
    assert viewer["effective_status"] == {
        "$ref": "#/components/schemas/OpenGameRegistrationEffectiveStatus"
    }
    assert viewer["applied_at"] == {"type": "string", "format": "date-time"}
    assert viewer["decided_at"] == {
        "type": ["string", "null"],
        "format": "date-time",
    }
    assert viewer["version"] == {"type": "integer", "minimum": 1}
    assert viewer["withdrawn_at"] == {
        "type": ["string", "null"],
        "format": "date-time",
    }
    assert viewer["withdrawal_kind"] == {
        "oneOf": [
            {"$ref": "#/components/schemas/OpenGameRegistrationWithdrawalKind"},
            {"type": "null"},
        ]
    }
    assert viewer["late_exit_recorded"] == {"type": "boolean"}
    assert viewer["available_withdrawal_action"] == {
        "oneOf": [
            {
                "$ref": (
                    "#/components/schemas/"
                    "OpenGameRegistrationAvailableWithdrawalAction"
                )
            },
            {"type": "null"},
        ]
    }
    assert viewer["late_exit_will_be_recorded"] == {"type": "boolean"}
    assert viewer["waitlist_position"] == {
        "type": ["integer", "null"],
        "minimum": 1,
    }
    for field in ("waitlisted_at", "promoted_at"):
        assert viewer[field] == {
            "type": ["string", "null"],
            "format": "date-time",
        }

    context = schemas["OpenGameRegistrationContext"]["properties"]
    assert context["game"] == {"$ref": "#/components/schemas/OpenGamePublic"}
    assert context["remaining_spots"] == {"type": "integer", "minimum": 0}
    assert context["viewer_authenticated"] == {"type": "boolean"}
    assert context["viewer_registration"] == {
        "oneOf": [
            {"$ref": "#/components/schemas/OpenGameViewerRegistration"},
            {"type": "null"},
        ]
    }
    assert context["allowed_actions"] == {
        "$ref": "#/components/schemas/OpenGameApplyActions"
    }

    captain = schemas["CaptainOpenGameApplication"]["properties"]
    assert captain["id"] == {"type": "string", "format": "uuid"}
    assert captain["applied_at"] == {"type": "string", "format": "date-time"}
    assert captain["version"] == {"type": "integer", "minimum": 1}
    assert captain["allowed_actions"] == {
        "$ref": "#/components/schemas/OpenGameReviewActions"
    }
    queue = schemas["OpenGameApplicationQueue"]["properties"]
    assert queue["remaining_spots"] == {"type": "integer", "minimum": 0}
    assert queue["pending_count"] == {"type": "integer", "minimum": 0}
    assert queue["applications"] == {
        "type": "array",
        "items": {"$ref": "#/components/schemas/CaptainOpenGameApplication"},
    }
    assert queue["waitlist_count"] == {"type": "integer", "minimum": 0}
    assert queue["waitlist"] == {
        "type": "array",
        "items": {
            "$ref": "#/components/schemas/CaptainOpenGameWaitlistApplication"
        },
    }

    decision_request = schemas["OpenGameApplicationDecisionRequest"]["properties"]
    assert decision_request["decision"] == {
        "type": "string",
        "enum": ["ACCEPT", "REJECT", "WAITLIST"],
    }
    assert decision_request["expected_version"] == {
        "type": "integer",
        "minimum": 1,
    }
    withdrawal_request = schemas["OpenGameApplicationWithdrawalRequest"]["properties"]
    assert withdrawal_request["action"] == {
        "$ref": "#/components/schemas/OpenGameRegistrationWithdrawalAction"
    }
    assert withdrawal_request["expected_version"] == {
        "type": "integer",
        "minimum": 1,
    }
    decision_result = schemas["OpenGameApplicationDecisionResult"]["properties"]
    assert decision_result["application_id"] == {
        "type": "string",
        "format": "uuid",
    }
    assert decision_result["status"] == {
        "type": "string",
        "enum": ["WAITLISTED", "JOINED", "REJECTED"],
    }
    assert decision_result["version"] == {"type": "integer", "minimum": 1}
    assert decision_result["decided_at"] == {
        "type": ["string", "null"],
        "format": "date-time",
    }
    assert decision_result["remaining_spots"] == {
        "type": "integer",
        "minimum": 0,
    }
    assert decision_result["allowed_actions"] == {
        "$ref": "#/components/schemas/OpenGameReviewActions"
    }

    not_allowed = schemas["ApplicationNotAllowedDetails"]["properties"]
    assert not_allowed["apply_blocked_reason"] == {
        "$ref": "#/components/schemas/OpenGameApplyBlockedReason"
    }
    assert not_allowed["remaining_spots"] == {"type": "integer", "minimum": 0}
    capacity_changed = schemas["ApplicationCapacityChangedDetails"]["properties"]
    assert capacity_changed["remaining_spots"] == {
        "type": "integer",
        "minimum": 0,
    }
    assert capacity_changed["allowed_actions"] == {
        "$ref": "#/components/schemas/OpenGameReviewActions"
    }

    apply_actions = Draft202012Validator(
        _dereference_local_schema(contract, schemas["OpenGameApplyActions"])
    )
    assert apply_actions.is_valid(
        {"can_apply": True, "apply_blocked_reason": None}
    )
    assert apply_actions.is_valid(
        {
            "can_apply": False,
            "apply_blocked_reason": "REGISTRATION_DEADLINE_PASSED",
        }
    )
    assert not apply_actions.is_valid(
        {
            "can_apply": True,
            "apply_blocked_reason": "REGISTRATION_DEADLINE_PASSED",
        }
    )
    assert not apply_actions.is_valid(
        {"can_apply": False, "apply_blocked_reason": None}
    )

    review_actions = Draft202012Validator(
        _dereference_local_schema(contract, schemas["OpenGameReviewActions"])
    )
    assert review_actions.is_valid(
        {
            "can_accept": True,
            "accept_blocked_reason": None,
            "can_waitlist": False,
            "waitlist_blocked_reason": "GAME_NOT_FULL",
            "can_reject": True,
            "reject_blocked_reason": None,
        }
    )
    assert review_actions.is_valid(
        {
            "can_accept": False,
            "accept_blocked_reason": "GAME_FULL",
            "can_waitlist": False,
            "waitlist_blocked_reason": "WAITLIST_NOT_ENABLED",
            "can_reject": True,
            "reject_blocked_reason": None,
        }
    )
    assert review_actions.is_valid(
        {
            "can_accept": False,
            "accept_blocked_reason": "GAME_FULL",
            "can_waitlist": True,
            "waitlist_blocked_reason": None,
            "can_reject": True,
            "reject_blocked_reason": None,
        }
    )
    assert not review_actions.is_valid(
        {
            "can_accept": True,
            "accept_blocked_reason": "GAME_FULL",
            "can_waitlist": False,
            "waitlist_blocked_reason": "GAME_NOT_FULL",
            "can_reject": True,
            "reject_blocked_reason": None,
        }
    )
    assert not review_actions.is_valid(
        {
            "can_accept": False,
            "accept_blocked_reason": "GAME_FULL",
            "can_waitlist": False,
            "waitlist_blocked_reason": "GAME_NOT_FULL",
            "can_reject": True,
            "reject_blocked_reason": None,
        }
    )
    assert not review_actions.is_valid(
        {
            "can_accept": False,
            "accept_blocked_reason": "GAME_STARTED",
            "can_waitlist": False,
            "waitlist_blocked_reason": "GAME_CANCELLED",
            "can_reject": False,
            "reject_blocked_reason": "GAME_STARTED",
        }
    )
    assert not review_actions.is_valid(
        {
            "can_accept": False,
            "accept_blocked_reason": "GAME_FULL",
            "can_waitlist": False,
            "waitlist_blocked_reason": "WAITLIST_NOT_ENABLED",
            "can_reject": False,
            "reject_blocked_reason": "GAME_FULL",
        }
    )
    assert not review_actions.is_valid(
        {
            "can_accept": True,
            "accept_blocked_reason": None,
            "can_waitlist": True,
            "waitlist_blocked_reason": None,
            "can_reject": True,
            "reject_blocked_reason": None,
        }
    )


def test_waitlist_contract_opens_only_explicit_waitlist_writes() -> None:
    contract = _contract()
    schemas = contract["components"]["schemas"]

    assert schemas["OpenGameRegistrationPersistedStatus"]["enum"] == [
        "APPLIED",
        "WAITLISTED",
        "JOINED",
        "REJECTED",
        "WITHDRAWN",
    ]
    assert schemas["OpenGameRegistrationEffectiveStatus"]["enum"] == [
        "APPLIED",
        "WAITLISTED",
        "JOINED",
        "REJECTED",
        "WITHDRAWN",
        "CANCELLED",
    ]
    assert schemas["OpenGameRegistrationWithdrawalKind"]["enum"] == [
        "APPLICATION_WITHDRAWAL",
        "WAITLIST_WITHDRAWAL",
        "GAME_EXIT",
    ]
    assert schemas["OpenGameRegistrationAvailableWithdrawalAction"]["enum"] == [
        "WITHDRAW_APPLICATION",
        "WITHDRAW_WAITLIST",
        "LEAVE_GAME",
    ]
    assert schemas["OpenGameRegistrationWithdrawalAction"]["enum"] == [
        "WITHDRAW_APPLICATION",
        "WITHDRAW_WAITLIST",
        "LEAVE_GAME",
    ]
    assert schemas["OpenGameApplicationDecisionRequest"]["properties"]["decision"][
        "enum"
    ] == ["ACCEPT", "REJECT", "WAITLIST"]
    assert schemas["OpenGameApplicationWithdrawalRequest"]["properties"]["action"] == {
        "$ref": "#/components/schemas/OpenGameRegistrationWithdrawalAction"
    }

    assert "GAME_FULL" not in schemas["OpenGameApplyBlockedReason"]["enum"]
    assert schemas["OpenGameWaitlistBlockedReason"]["enum"] == [
        "APPLICATION_NOT_PENDING",
        "GAME_SUSPENDED",
        "GAME_CANCELLED",
        "GAME_COMPLETED",
        "GAME_STARTED",
        "GAME_NOT_FULL",
        "WAITLIST_NOT_ENABLED",
    ]
    review = schemas["OpenGameReviewActions"]
    assert set(review["required"]) == {
        "can_accept",
        "accept_blocked_reason",
        "can_waitlist",
        "waitlist_blocked_reason",
        "can_reject",
        "reject_blocked_reason",
    }
    assert set(review["properties"]) == set(review["required"])

    viewer = schemas["OpenGameViewerRegistration"]
    assert {"waitlist_position", "waitlisted_at", "promoted_at"} <= set(
        viewer["required"]
    )
    assert viewer["properties"]["waitlist_position"] == {
        "type": ["integer", "null"],
        "minimum": 1,
    }
    for field in ("waitlisted_at", "promoted_at"):
        assert viewer["properties"][field] == {
            "type": ["string", "null"],
            "format": "date-time",
        }
    assert viewer["properties"]["available_withdrawal_action"] == {
        "oneOf": [
            {
                "$ref": (
                    "#/components/schemas/"
                    "OpenGameRegistrationAvailableWithdrawalAction"
                )
            },
            {"type": "null"},
        ]
    }

    mine = schemas["MyOpenGameApplication"]
    assert {"waitlist_position", "waitlisted_at", "promoted_at"} <= set(
        mine["required"]
    )

    queue = schemas["OpenGameApplicationQueue"]
    assert set(queue["required"]) == {
        "remaining_spots",
        "pending_count",
        "applications",
        "waitlist_count",
        "waitlist",
    }
    assert queue["properties"]["waitlist"] == {
        "type": "array",
        "items": {
            "$ref": "#/components/schemas/CaptainOpenGameWaitlistApplication"
        },
    }
    waitlist_item = schemas["CaptainOpenGameWaitlistApplication"]
    assert set(waitlist_item["required"]) == {
        "id",
        "display_name",
        "position",
        "note",
        "applied_at",
        "waitlisted_at",
        "waitlist_position",
    }
    assert "allowed_actions" not in waitlist_item["properties"]
    assert "waitlist_seq" not in waitlist_item["properties"]
    assert schemas["OpenGameApplicationDecisionResult"]["properties"]["status"][
        "enum"
    ] == ["WAITLISTED", "JOINED", "REJECTED"]

    runtime = create_app(
        settings=Settings(app_env="test", wechat_provider="development")
    ).openapi()
    for schema_name in (
        "OpenGameRegistrationPersistedStatus",
        "OpenGameRegistrationEffectiveStatus",
        "OpenGameRegistrationWithdrawalKind",
        "OpenGameRegistrationAvailableWithdrawalAction",
        "OpenGameApplyBlockedReason",
        "OpenGameReviewBlockedReason",
        "OpenGameWaitlistBlockedReason",
        "OpenGameReviewActions",
        "OpenGameViewerRegistration",
        "MyOpenGameApplication",
        "CaptainOpenGameWaitlistApplication",
        "OpenGameApplicationQueue",
        "OpenGameApplicationDecisionResult",
    ):
        assert runtime["components"]["schemas"][schema_name] == schemas[schema_name]


def test_registration_withdrawal_feature_contract_opens_only_the_frozen_write() -> None:
    withdrawal_path = (
        "/api/v1/open-game-applications/{application_id}/withdraw"
    )
    frozen = _contract()["paths"][withdrawal_path]
    assert set(frozen) == {"post"}

    runtime = create_app(
        settings=Settings(app_env="test", wechat_provider="development")
    ).openapi()
    assert runtime["paths"][withdrawal_path] == frozen


def test_open_game_registration_success_examples_match_closed_schemas() -> None:
    contract = _contract()
    schemas = contract["components"]["schemas"]
    example_schemas = {
        "open-game-registration-context-anonymous.json": (
            "OpenGameRegistrationContext"
        ),
        "open-game-registration-context-apply-ready.json": (
            "OpenGameRegistrationContext"
        ),
        "open-game-registration-context-applied.json": (
            "OpenGameRegistrationContext"
        ),
        "open-game-registration-context-waitlisted.json": (
            "OpenGameRegistrationContext"
        ),
        "open-game-registration-context-joined.json": (
            "OpenGameRegistrationContext"
        ),
        "open-game-registration-context-rejected.json": (
            "OpenGameRegistrationContext"
        ),
        "open-game-registration-context-withdrawn-application.json": (
            "OpenGameRegistrationContext"
        ),
        "open-game-registration-context-withdrawn-waitlist.json": (
            "OpenGameRegistrationContext"
        ),
        "open-game-registration-context-withdrawn-game-exit.json": (
            "OpenGameRegistrationContext"
        ),
        "open-game-registration-context-cancelled.json": (
            "OpenGameRegistrationContext"
        ),
        "open-game-applications-pending.json": "OpenGameApplicationQueue",
        "open-game-applications-full-waitlist.json": "OpenGameApplicationQueue",
        "open-game-applications-empty.json": "OpenGameApplicationQueue",
        "open-game-application-decision-joined.json": (
            "OpenGameApplicationDecisionResult"
        ),
        "open-game-application-decision-waitlisted.json": (
            "OpenGameApplicationDecisionResult"
        ),
        "open-game-application-decision-rejected.json": (
            "OpenGameApplicationDecisionResult"
        ),
    }
    examples: dict[str, dict[str, Any]] = {}
    for filename, schema_name in example_schemas.items():
        example = json.loads((EXAMPLES_DIRECTORY / filename).read_text())
        examples[filename] = example
        validator = Draft202012Validator(
            _dereference_local_schema(contract, schemas[schema_name])
        )
        assert validator.is_valid(example), filename

    context_states = {
        "open-game-registration-context-anonymous.json": (
            False,
            None,
            None,
            False,
            "AUTH_REQUIRED",
        ),
        "open-game-registration-context-apply-ready.json": (
            True,
            None,
            None,
            True,
            None,
        ),
        "open-game-registration-context-applied.json": (
            True,
            "APPLIED",
            "APPLIED",
            False,
            "ALREADY_APPLIED",
        ),
        "open-game-registration-context-waitlisted.json": (
            True,
            "WAITLISTED",
            "WAITLISTED",
            False,
            "ALREADY_APPLIED",
        ),
        "open-game-registration-context-joined.json": (
            True,
            "JOINED",
            "JOINED",
            False,
            "ALREADY_APPLIED",
        ),
        "open-game-registration-context-rejected.json": (
            True,
            "REJECTED",
            "REJECTED",
            False,
            "ALREADY_APPLIED",
        ),
        "open-game-registration-context-withdrawn-application.json": (
            True,
            "WITHDRAWN",
            "WITHDRAWN",
            False,
            "ALREADY_APPLIED",
        ),
        "open-game-registration-context-withdrawn-waitlist.json": (
            True,
            "WITHDRAWN",
            "WITHDRAWN",
            False,
            "ALREADY_APPLIED",
        ),
        "open-game-registration-context-withdrawn-game-exit.json": (
            True,
            "WITHDRAWN",
            "WITHDRAWN",
            False,
            "ALREADY_APPLIED",
        ),
        "open-game-registration-context-cancelled.json": (
            True,
            "JOINED",
            "CANCELLED",
            False,
            "GAME_CANCELLED",
        ),
    }
    for filename, expected in context_states.items():
        context = examples[filename]
        registration = context["viewer_registration"]
        persisted = registration["persisted_status"] if registration else None
        effective = registration["effective_status"] if registration else None
        actual = (
            context["viewer_authenticated"],
            persisted,
            effective,
            context["allowed_actions"]["can_apply"],
            context["allowed_actions"]["apply_blocked_reason"],
        )
        assert actual == expected
        if registration is not None:
            expected_withdrawal_action = {
                "APPLIED": "WITHDRAW_APPLICATION",
                "WAITLISTED": "WITHDRAW_WAITLIST",
                "JOINED": (
                    None
                    if registration["effective_status"] == "CANCELLED"
                    else "LEAVE_GAME"
                ),
                "REJECTED": None,
                "WITHDRAWN": None,
            }[registration["persisted_status"]]
            assert (
                registration["available_withdrawal_action"]
                == expected_withdrawal_action
            )
            assert registration["late_exit_will_be_recorded"] is False

    pending = examples["open-game-applications-pending.json"]
    assert pending["pending_count"] == len(pending["applications"])
    assert pending["pending_count"] > 0
    assert examples["open-game-applications-empty.json"]["applications"] == []
    assert examples["open-game-applications-empty.json"]["pending_count"] == 0
    assert examples["open-game-application-decision-joined.json"]["status"] == (
        "JOINED"
    )
    assert examples["open-game-application-decision-waitlisted.json"]["status"] == (
        "WAITLISTED"
    )
    assert examples["open-game-application-decision-rejected.json"]["status"] == (
        "REJECTED"
    )

    serialized = json.dumps(examples).lower()
    for forbidden in (
        "applicant_user_id",
        "user_id",
        "phone",
        "openid",
        "avatar",
        "order_id",
        "payment",
        "fulfillment",
        "rating",
    ):
        assert forbidden not in serialized


def test_open_game_public_states_are_coarse_and_position_inputs_are_unordered() -> None:
    contract = _contract()
    schemas = contract["components"]["schemas"]
    public_reason = schemas["OpenGamePublicStateReason"]
    assert public_reason == {
        "type": ["string", "null"],
        "enum": [
            "REGISTRATION_WINDOW_CLOSED",
            "REGISTRATION_DEADLINE_PASSED",
            "CAPTAIN_CANCELLED",
            "BOOKING_UNAVAILABLE",
            "BOOKING_COMPLETED",
            None,
        ],
    }
    assert schemas["OpenGamePublic"]["properties"]["state_reason"] == {
        "$ref": "#/components/schemas/OpenGamePublicStateReason"
    }

    selection_validator = Draft202012Validator(
        _dereference_local_schema(contract, schemas["OpenGamePositionSelection"])
    )
    output_validator = Draft202012Validator(
        _dereference_local_schema(contract, schemas["OpenGamePositions"])
    )
    reversed_specific = ["FORWARD", "DEFENDER", "GOALKEEPER"]
    assert selection_validator.is_valid(reversed_specific)
    assert not output_validator.is_valid(reversed_specific)
    assert selection_validator.is_valid(["ANY"])
    for invalid in (
        ["ANY", "FORWARD"],
        ["FORWARD", "FORWARD"],
        ["STRIKER"],
    ):
        assert not selection_validator.is_valid(invalid)

    public_validator = Draft202012Validator(
        _dereference_local_schema(contract, schemas["OpenGamePublic"])
    )
    public_example = json.loads(
        (EXAMPLES_DIRECTORY / "open-game-public-published.json").read_text()
    )
    assert public_validator.is_valid(public_example)
    for state, reason in (
        ("SUSPENDED", "ORDER_PAYMENT_EXCEPTION"),
        ("SUSPENDED", "ORDER_REFUND_PENDING"),
        ("SUSPENDED", "ORDER_REFUND_FAILED"),
        ("PUBLISHED", "BOOKING_UNAVAILABLE"),
        ("SUSPENDED", None),
        ("COMPLETED", "REGISTRATION_DEADLINE_PASSED"),
    ):
        contradictory = {**public_example, "state": state, "state_reason": reason}
        assert not public_validator.is_valid(contradictory)

    owner_validator = Draft202012Validator(
        _dereference_local_schema(contract, schemas["OpenGameOwner"])
    )
    for filename in (
        "open-game-owner-draft.json",
        "open-game-owner-published.json",
        "open-game-owner-suspended.json",
        "open-game-owner-cancelled.json",
    ):
        owner_example = json.loads((EXAMPLES_DIRECTORY / filename).read_text())
        assert owner_validator.is_valid(owner_example)
        contradictory = json.loads(json.dumps(owner_example))
        contradictory["public_view"]["state"] = "PUBLISHED"
        contradictory["public_view"]["state_reason"] = None
        if owner_example["state"] == "PUBLISHED":
            contradictory["public_view"][
                "state_reason"
            ] = "REGISTRATION_DEADLINE_PASSED"
        assert not owner_validator.is_valid(contradictory)

    cancelled_example = json.loads(
        (EXAMPLES_DIRECTORY / "open-game-owner-cancelled.json").read_text()
    )
    assert cancelled_example["persisted_status"] == "CANCELLED"
    assert cancelled_example["state_reason"] == "CAPTAIN_CANCELLED"
    assert cancelled_example["public_view"]["state_reason"] == "CAPTAIN_CANCELLED"

    published_example = json.loads(
        (EXAMPLES_DIRECTORY / "open-game-owner-published.json").read_text()
    )
    order_cancelled = json.loads(json.dumps(published_example))
    order_cancelled.update(
        {
            "persisted_status": "PUBLISHED",
            "state": "CANCELLED",
            "state_reason": "ORDER_CANCELLED",
            "allowed_actions": {
                "can_edit": False,
                "can_publish": False,
                "can_share": False,
                "can_cancel": False,
                "can_preview": False,
                "can_manage_attendance": False,
            },
            "share": None,
        }
    )
    order_cancelled["public_view"].update(
        {"state": "CANCELLED", "state_reason": "BOOKING_UNAVAILABLE"}
    )
    assert owner_validator.is_valid(order_cancelled)
    incorrectly_persisted = {**order_cancelled, "persisted_status": "CANCELLED"}
    assert not owner_validator.is_valid(incorrectly_persisted)


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
    open_game_operations = {
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
        "/api/v1/shared-games/{share_token}": {"get": {"200", "404", "503"}},
    }
    unpublished_operations = (
        (
            "/api/v1/venues/{venue_id}/fulfillment/orders/{order_id}/refund",
            "post",
            {"200", "202", "401", "404", "409", "422", "503"},
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

    open_game_operation_ids = {
        ("/api/v1/orders/{order_id}/game", "get"): "getOpenGameEntry",
        ("/api/v1/orders/{order_id}/game", "post"): "createOpenGame",
        ("/api/v1/games/{game_id}", "get"): "getOpenGame",
        ("/api/v1/games/{game_id}", "put"): "updateOpenGame",
        ("/api/v1/games/{game_id}/publish", "post"): "publishOpenGame",
        ("/api/v1/games/{game_id}/cancel", "post"): "cancelOpenGame",
        ("/api/v1/shared-games/{share_token}", "get"): "getSharedOpenGame",
    }
    open_game_write_schemas = {
        ("/api/v1/orders/{order_id}/game", "post"): "CreateOpenGameRequest",
        ("/api/v1/games/{game_id}", "put"): "UpdateOpenGameRequest",
        ("/api/v1/games/{game_id}/publish", "post"): "OpenGameVersionRequest",
        ("/api/v1/games/{game_id}/cancel", "post"): "OpenGameVersionRequest",
    }
    for path, methods in open_game_operations.items():
        assert set(contract["paths"][path]) == set(methods)
        assert set(runtime["paths"][path]) == set(methods)
        for method, statuses in methods.items():
            contract_operation = contract["paths"][path][method]
            runtime_operation = runtime["paths"][path][method]
            assert set(contract_operation["responses"]) == statuses
            assert set(runtime_operation["responses"]) == statuses
            assert (
                runtime_operation["operationId"]
                == open_game_operation_ids[(path, method)]
            )
            if path == "/api/v1/shared-games/{share_token}":
                assert runtime_operation.get("security", []) == []
            else:
                assert runtime_operation["security"] == [{"bearerAuth": []}]
            if method == "get":
                assert "requestBody" not in runtime_operation
            else:
                idempotency = next(
                    parameter
                    for parameter in runtime_operation["parameters"]
                    if parameter.get("name") == "Idempotency-Key"
                )
                assert idempotency["required"] is True
                assert {
                    key: idempotency["schema"][key]
                    for key in ("type", "minLength", "maxLength")
                } == {"type": "string", "minLength": 16, "maxLength": 128}
                schema_name = open_game_write_schemas[(path, method)]
                assert runtime_operation["requestBody"] == {
                    "required": True,
                    "content": {
                        "application/json": {
                            "schema": {
                                "$ref": f"#/components/schemas/{schema_name}"
                            }
                        }
                    },
                }
    assert "/api/v1/games" not in runtime["paths"]

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


def test_public_game_directory_contract_is_anonymous_closed_and_exampled() -> None:
    contract = _contract()
    schemas = contract["components"]["schemas"]
    path_item = contract["paths"]["/api/v1/public-games"]

    assert set(path_item) == {"get"}
    operation = path_item["get"]
    assert operation["security"] == []
    assert "requestBody" not in operation
    assert operation["parameters"] == [
        {
            "name": "local_date",
            "in": "query",
            "required": False,
            "schema": {"type": "string", "format": "date"},
        },
        {
            "name": "format",
            "in": "query",
            "required": False,
            "schema": {"$ref": "#/components/schemas/PublicGameFormat"},
        },
        {
            "name": "available_only",
            "in": "query",
            "required": False,
            "schema": {"type": "boolean", "default": False},
        },
    ]
    assert set(operation["responses"]) == {"200", "422", "503"}
    assert _response_schema(operation, "200") == {
        "$ref": "#/components/schemas/PublicGameDirectoryResponse"
    }
    assert operation["responses"]["200"]["content"]["application/json"][
        "examples"
    ] == {
        "Ready": {"externalValue": "./examples/public-games-ready.json"},
        "Empty": {"externalValue": "./examples/public-games-empty.json"},
    }
    for status, code, example_name, filename in (
        ("422", "INVALID_ARGUMENT", "InvalidArgument", "error-invalid-argument.json"),
        (
            "503",
            "SERVICE_UNAVAILABLE",
            "ServiceUnavailable",
            "error-service-unavailable.json",
        ),
    ):
        response = operation["responses"][status]["content"]["application/json"]
        assert {"$ref": "#/components/schemas/ErrorEnvelope"} in response[
            "schema"
        ]["allOf"]
        assert response["schema"]["allOf"][1]["properties"]["error"][
            "properties"
        ]["code"] == {"const": code}
        assert response["examples"] == {
            example_name: {"externalValue": f"./examples/{filename}"}
        }

    assert schemas["PublicGameFormat"] == {
        "type": "string",
        "enum": ["FIVE", "SEVEN"],
    }
    item = schemas["PublicGameDirectoryItem"]
    item_fields = {
        "detail_path",
        "local_date",
        "format",
        "current_players",
        "remaining_spots",
        "game",
    }
    assert item["additionalProperties"] is False
    assert set(item["required"]) == item_fields
    assert set(item["properties"]) == item_fields
    assert item["properties"]["detail_path"] == {
        "type": "string",
        "pattern": (
            "^/pages/captain-game-public/index\\?token="
            "[A-Za-z0-9_-]{32}$"
        ),
    }
    assert item["properties"]["local_date"] == {
        "type": "string",
        "format": "date",
    }
    assert item["properties"]["format"] == {
        "$ref": "#/components/schemas/PublicGameFormat"
    }
    assert item["properties"]["current_players"] == {
        "type": "integer",
        "minimum": 1,
    }
    assert item["properties"]["remaining_spots"] == {
        "type": "integer",
        "minimum": 0,
    }
    assert item["properties"]["game"] == {
        "$ref": "#/components/schemas/OpenGamePublic"
    }

    response_schema = schemas["PublicGameDirectoryResponse"]
    response_fields = {"authoritative_now", "available_dates", "items"}
    assert response_schema["additionalProperties"] is False
    assert set(response_schema["required"]) == response_fields
    assert set(response_schema["properties"]) == response_fields
    assert response_schema["properties"]["authoritative_now"] == {
        "type": "string",
        "format": "date-time",
    }
    assert response_schema["properties"]["available_dates"] == {
        "type": "array",
        "uniqueItems": True,
        "items": {"type": "string", "format": "date"},
    }
    assert response_schema["properties"]["items"] == {
        "type": "array",
        "items": {"$ref": "#/components/schemas/PublicGameDirectoryItem"},
    }

    for filename in ("public-games-ready.json", "public-games-empty.json"):
        example = json.loads((EXAMPLES_DIRECTORY / filename).read_text())
        _assert_example_matches_schema(contract, example, response_schema)
        serialized = json.dumps(example)
        for private in (
            "order_id",
            "captain_user_id",
            "share_token",
            "payment",
            "refund",
            "application",
            "members",
        ):
            assert private not in serialized, private


def test_open_game_attendance_routes_exist_before_runtime_openapi_alignment() -> None:
    application = create_app(
        settings=Settings(app_env="test", wechat_provider="development")
    )
    raw = get_openapi(
        title=application.title,
        version=application.version,
        routes=application.routes,
    )
    expected = {
        (ATTENDANCE_ROSTER_PATH, "get"): "getOpenGameAttendanceRoster",
        (ATTENDANCE_MARK_PATH, "post"): "markOpenGameAttendance",
    }
    for (path, method), operation_id in expected.items():
        assert set(raw["paths"][path]) == {method}
        assert raw["paths"][path][method]["operationId"] == operation_id


@pytest.mark.parametrize(
    ("path", "method"),
    [
        (ATTENDANCE_ROSTER_PATH, "get"),
        (ATTENDANCE_MARK_PATH, "post"),
    ],
)
def test_attendance_runtime_aligner_rejects_a_missing_raw_route(
    path: str,
    method: str,
) -> None:
    application = create_app(
        settings=Settings(app_env="test", wechat_provider="development")
    )
    raw = get_openapi(
        title=application.title,
        version=application.version,
        routes=application.routes,
    )
    del raw["paths"][path][method]

    with pytest.raises(RuntimeError, match="raw OpenAPI.*attendance"):
        align_my_open_game_applications_openapi(raw)


def test_open_game_attendance_operations_and_examples_are_frozen() -> None:
    contract = _contract()
    paths = contract["paths"]
    schemas = contract["components"]["schemas"]
    expected = {
        (ATTENDANCE_ROSTER_PATH, "get"): (
            "getOpenGameAttendanceRoster",
            {"200", "401", "404", "422", "503"},
            "OpenGameAttendanceRoster",
        ),
        (ATTENDANCE_MARK_PATH, "post"): (
            "markOpenGameAttendance",
            {"200", "401", "404", "409", "422", "503"},
            "OpenGameAttendanceMarkResult",
        ),
    }
    assert set(paths[ATTENDANCE_ROSTER_PATH]) == {"get"}
    assert set(paths[ATTENDANCE_MARK_PATH]) == {"post"}
    for (path, method), (operation_id, statuses, response_schema) in expected.items():
        operation = paths[path][method]
        assert operation["operationId"] == operation_id
        assert operation["security"] == [{"bearerAuth": []}]
        assert set(operation["responses"]) == statuses
        assert _response_schema(operation, "200") == {
            "$ref": f"#/components/schemas/{response_schema}"
        }
        for response in operation["responses"].values():
            assert response["headers"] == {
                "X-Request-Id": {"$ref": "#/components/headers/RequestId"}
            }

    roster_parameters = paths[ATTENDANCE_ROSTER_PATH]["get"]["parameters"]
    assert roster_parameters == [
        {
            "name": "game_id",
            "in": "path",
            "required": True,
            "schema": {"type": "string", "format": "uuid"},
        }
    ]
    mark = paths[ATTENDANCE_MARK_PATH]["post"]
    assert mark["parameters"] == [
        {
            "name": "game_id",
            "in": "path",
            "required": True,
            "schema": {"type": "string", "format": "uuid"},
        },
        {
            "name": "registration_id",
            "in": "path",
            "required": True,
            "schema": {"type": "string", "format": "uuid"},
        },
        {"$ref": "#/components/parameters/IdempotencyKey"},
    ]
    assert mark["requestBody"] == {
        "required": True,
        "content": {
            "application/json": {
                "schema": {
                    "$ref": "#/components/schemas/OpenGameAttendanceMarkRequest"
                }
            }
        },
    }
    assert "requestBody" not in paths[ATTENDANCE_ROSTER_PATH]["get"]

    expected_examples = {
        (ATTENDANCE_ROSTER_PATH, "get", "200"): {
            "Ready": "open-game-attendance-roster-ready.json",
            "Empty": "open-game-attendance-roster-empty.json",
        },
        (ATTENDANCE_MARK_PATH, "post", "200"): {
            "MarkedPresent": "open-game-attendance-mark-present.json",
            "MarkedNoShow": "open-game-attendance-mark-no-show.json",
        },
        (ATTENDANCE_MARK_PATH, "post", "409"): {
            "AttendanceStateChanged": "error-attendance-state-changed.json",
            "IdempotencyKeyReused": "error-idempotency-key-reused.json",
        },
    }
    for (path, method, status), examples in expected_examples.items():
        assert paths[path][method]["responses"][status]["content"][
            "application/json"
        ]["examples"] == {
            name: {"externalValue": f"./examples/{filename}"}
            for name, filename in examples.items()
        }

    example_schemas = {
        "open-game-attendance-roster-ready.json": "OpenGameAttendanceRoster",
        "open-game-attendance-roster-empty.json": "OpenGameAttendanceRoster",
        "open-game-attendance-mark-present.json": "OpenGameAttendanceMarkResult",
        "open-game-attendance-mark-no-show.json": "OpenGameAttendanceMarkResult",
        "error-attendance-state-changed.json": "ErrorEnvelope",
    }
    examples = {}
    for filename, schema_name in example_schemas.items():
        value = json.loads((EXAMPLES_DIRECTORY / filename).read_text())
        examples[filename] = value
        assert Draft202012Validator(
            _dereference_local_schema(contract, schemas[schema_name])
        ).is_valid(value), filename
    ready = examples["open-game-attendance-roster-ready.json"]
    assert (ready["recorded_count"], ready["total_count"]) == (2, 3)
    assert ready["attendance_complete"] is False
    empty = examples["open-game-attendance-roster-empty.json"]
    assert (empty["recorded_count"], empty["total_count"]) == (0, 0)
    assert empty["attendance_complete"] is True


def test_open_game_attendance_schemas_are_closed_private_and_runtime_aligned() -> None:
    contract = _contract()
    schemas = contract["components"]["schemas"]
    required_fields = {
        "OpenGameAttendanceGameSummary": {
            "id",
            "name",
            "venue_name",
            "pitch_name",
            "starts_at",
            "ends_at",
            "time_zone",
            "state",
        },
        "OpenGameAttendanceRosterItem": {
            "registration_id",
            "display_name",
            "position",
            "attendance_status",
            "attendance_recorded_at",
            "version",
        },
        "OpenGameAttendanceRoster": {
            "game",
            "recorded_count",
            "total_count",
            "attendance_complete",
            "registrations",
        },
        "OpenGameAttendanceMarkRequest": {
            "attendance_status",
            "expected_version",
        },
        "OpenGameAttendanceMarkResult": {
            "registration_id",
            "attendance_status",
            "attendance_recorded_at",
            "version",
            "recorded_count",
            "total_count",
            "attendance_complete",
        },
    }
    for schema_name, fields in required_fields.items():
        schema = schemas[schema_name]
        assert schema["type"] == "object"
        assert schema["additionalProperties"] is False
        assert set(schema["required"]) == fields
        assert set(schema["properties"]) == fields
    assert schemas["OpenGameAttendanceStatus"] == {
        "type": "string",
        "enum": ["UNMARKED", "PRESENT", "NO_SHOW"],
    }
    assert schemas["OpenGameAttendanceGameSummary"]["properties"]["state"] == {
        "type": "string",
        "const": "COMPLETED",
    }
    assert schemas["OpenGameAttendanceMarkRequest"]["properties"][
        "attendance_status"
    ] == {"type": "string", "enum": ["PRESENT", "NO_SHOW"]}

    roster_serialized = json.dumps(
        {
            "schema": schemas["OpenGameAttendanceRoster"],
            "item": schemas["OpenGameAttendanceRosterItem"],
            "ready": json.loads(
                (EXAMPLES_DIRECTORY / "open-game-attendance-roster-ready.json").read_text()
            ),
        }
    ).lower()
    for forbidden in (
        "note",
        "applicant_user_id",
        "user_id",
        "recorded_by",
        "adult_confirmed",
        "risk_confirmed",
        "consent_version",
        "created_at",
        "updated_at",
    ):
        assert forbidden not in roster_serialized, forbidden
    assert not any(
        "attendance" in field
        for field in schemas["OpenGamePublic"]["properties"]
    )

    owner_actions = schemas["OpenGameAllowedActions"]
    assert set(owner_actions["required"]) == {
        "can_edit",
        "can_publish",
        "can_share",
        "can_cancel",
        "can_preview",
        "can_manage_attendance",
    }
    assert set(owner_actions["properties"]) == set(owner_actions["required"])
    self_attendance_pair = [
        {
            "properties": {
                "attendance_status": {"const": None},
                "attendance_recorded_at": {"const": None},
            }
        },
        {
            "properties": {
                "attendance_status": {"const": "UNMARKED"},
                "attendance_recorded_at": {"const": None},
            }
        },
        {
            "properties": {
                "attendance_status": {"enum": ["PRESENT", "NO_SHOW"]},
                "attendance_recorded_at": {
                    "type": "string",
                    "format": "date-time",
                },
            }
        },
    ]
    self_examples = {
        "OpenGameViewerRegistration": json.loads(
            (
                EXAMPLES_DIRECTORY / "open-game-registration-context-joined.json"
            ).read_text()
        )["viewer_registration"],
        "MyOpenGameApplication": json.loads(
            (EXAMPLES_DIRECTORY / "my-open-game-applications-ready.json").read_text()
        )["items"][0],
    }
    for self_schema_name in ("OpenGameViewerRegistration", "MyOpenGameApplication"):
        self_schema = schemas[self_schema_name]
        assert {"attendance_status", "attendance_recorded_at"} <= set(
            self_schema["required"]
        )
        assert self_schema["properties"]["attendance_status"] == {
            "oneOf": [
                {"$ref": "#/components/schemas/OpenGameAttendanceStatus"},
                {"type": "null"},
            ]
        }
        assert self_schema["properties"]["attendance_recorded_at"] == {
            "type": ["string", "null"],
            "format": "date-time",
        }
        assert self_schema["oneOf"] == self_attendance_pair
        assert "attendance_recorded_by_user_id" not in self_schema["properties"]
        validator = Draft202012Validator(
            _dereference_local_schema(contract, self_schema)
        )
        base = self_examples[self_schema_name]
        recorded_at = "2026-08-30T20:36:00+08:00"
        for attendance_status, attendance_recorded_at in (
            (None, None),
            ("UNMARKED", None),
            ("PRESENT", recorded_at),
            ("NO_SHOW", recorded_at),
        ):
            assert validator.is_valid(
                {
                    **base,
                    "attendance_status": attendance_status,
                    "attendance_recorded_at": attendance_recorded_at,
                }
            )
        for attendance_status, attendance_recorded_at in (
            (None, recorded_at),
            ("UNMARKED", recorded_at),
            ("PRESENT", None),
            ("NO_SHOW", None),
        ):
            assert not validator.is_valid(
                {
                    **base,
                    "attendance_status": attendance_status,
                    "attendance_recorded_at": attendance_recorded_at,
                }
            )

    runtime = create_app(
        settings=Settings(app_env="test", wechat_provider="development")
    ).openapi()
    for path, method in (
        (ATTENDANCE_ROSTER_PATH, "get"),
        (ATTENDANCE_MARK_PATH, "post"),
    ):
        assert runtime["paths"][path][method] == contract["paths"][path][method]
    for schema_name in (*required_fields, "OpenGameAttendanceStatus"):
        assert runtime["components"]["schemas"][schema_name] == schemas[schema_name]
