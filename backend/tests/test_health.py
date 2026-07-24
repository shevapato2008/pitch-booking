from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.database import get_database
from backend.app.main import create_app
from backend.tests.conftest import RecordingDatabase


def test_health_reports_database_connectivity(
    client: TestClient, database: RecordingDatabase
) -> None:
    response = client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert response.headers["X-Request-Id"]
    assert database.statements == ["SELECT 1"]


def test_health_returns_503_without_leaking_database_details(broken_client: TestClient) -> None:
    response = broken_client.get("/api/v1/health")

    assert response.status_code == 503
    assert response.json()["error"] == {
        "code": "SERVICE_UNAVAILABLE",
        "message": "服务暂时不可用",
        "request_id": response.headers["X-Request-Id"],
        "details": {},
    }
    assert "secret" not in response.text


def test_health_exposes_injected_application_revision() -> None:
    app = create_app(settings=Settings(app_revision="abc123"))
    app.dependency_overrides[get_database] = RecordingDatabase

    with TestClient(app) as client:
        response = client.get("/api/v1/health")

    assert response.headers["X-App-Revision"] == "abc123"
