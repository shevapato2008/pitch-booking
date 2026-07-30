import json
from importlib import import_module
from pathlib import Path
from typing import Any, Protocol, cast

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


def test_contract_freezes_auth_checkout_and_order_operation_matrix() -> None:
    contract = _contract()
    expected_operations = {
        "/api/v1/auth/wechat/session": {"post"},
        "/api/v1/auth/wechat/phone": {"post"},
        "/api/v1/slots/{slot_id}/checkout": {"get"},
        "/api/v1/orders": {"post"},
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
        ("/api/v1/orders", "post"): {"200", "201", "401", "404", "409", "422"},
        ("/api/v1/orders/{order_id}", "get"): {"200", "401", "404"},
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
        "PENDING_PAYMENT", "CONFIRMED", "EXPIRED", "PAYMENT_EXCEPTION"
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
    assert set(venue["required"]) >= {
        "id",
        "name",
        "address",
        "latitude",
        "longitude",
        "customer_service_phone",
    }
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
        "images",
        "facilities",
        "pitch_types",
        "availability_window",
        "generated_at",
    }


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
