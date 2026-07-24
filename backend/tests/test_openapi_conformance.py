from backend.app.main import create_app


def test_openapi_exposes_only_implemented_slice_paths() -> None:
    schema = create_app().openapi()
    paths = schema["paths"]

    assert "/api/v1/health" in paths
    assert "/api/v1/venues/primary" in paths
    assert "/api/v1/venues/{venue_id}/availability" not in paths
    assert set(paths["/api/v1/venues/primary"]) == {"get"}


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
