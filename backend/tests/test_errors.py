from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from backend.app.main import create_app


def test_error_envelope_reuses_header_request_id(client: TestClient) -> None:
    response = client.get("/__test__/known-error", headers={"X-Request-Id": "req-safe_123"})

    assert response.status_code == 400
    assert set(response.json()) == {"error"}
    assert response.json()["error"] == {
        "code": "INVALID_ARGUMENT",
        "message": "请求参数无效",
        "request_id": "req-safe_123",
        "details": {},
    }
    assert response.headers["X-Request-Id"] == "req-safe_123"


def test_unsafe_request_id_is_replaced(client: TestClient) -> None:
    response = client.get("/api/v1/health", headers={"X-Request-Id": "unsafe id\n"})

    assert response.status_code == 200
    assert response.headers["X-Request-Id"] != "unsafe id\n"


def test_test_routes_are_absent_from_production_app() -> None:
    paths = {route.path for route in create_app().routes if isinstance(route, APIRoute)}

    assert "/__test__/known-error" not in paths
    assert "/__test__/unexpected-error" not in paths


def test_unexpected_error_returns_only_public_details(client: TestClient) -> None:
    response = client.get("/__test__/unexpected-error")

    assert response.status_code == 500
    assert response.json()["error"] == {
        "code": "INTERNAL_ERROR",
        "message": "服务内部错误",
        "request_id": response.headers["X-Request-Id"],
        "details": {},
    }
    assert "database-password" not in response.text
