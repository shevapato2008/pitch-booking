from importlib import import_module
from pathlib import Path
from typing import Any, cast

from backend.app.main import create_app


def _contract() -> dict[str, Any]:
    yaml = import_module("yaml")
    return cast(
        dict[str, Any],
        yaml.safe_load(Path("contracts/openapi.yaml").read_text()),
    )


def test_admin_inventory_contract_freezes_three_real_operations() -> None:
    contract = _contract()
    expected = {
        "/api/v1/admin/venues/{venue_id}/inventory": {"get"},
        "/api/v1/admin/venues/{venue_id}/inventory/slots": {"post"},
        "/api/v1/admin/venues/{venue_id}/inventory/slots/{slot_id}": {"put"},
    }
    assert {path: set(contract["paths"][path]) for path in expected} == expected
    for path, methods in expected.items():
        for method in methods:
            assert contract["paths"][path][method]["security"] == [{"bearerAuth": []}]


def test_runtime_inventory_schema_bootstraps_pitches_and_versions_slots() -> None:
    schema = create_app().openapi()
    get_operation = schema["paths"]["/api/v1/admin/venues/{venue_id}/inventory"]["get"]
    parameters = {item["name"]: item for item in get_operation["parameters"]}
    assert parameters["local_date"]["required"] is True
    assert parameters["pitch_id"]["required"] is False

    inventory = schema["components"]["schemas"]["InventoryResponse"]
    assert set(inventory["required"]) == {
        "venue",
        "local_date",
        "availability_window",
        "pitches",
        "selected_pitch_id",
        "slots",
        "generated_at",
    }
    slot = schema["components"]["schemas"]["InventorySlotResponse"]
    assert {"status", "checkout_version", "editable", "read_only_reason"} <= set(
        slot["required"]
    )
