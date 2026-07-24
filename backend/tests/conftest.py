from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from backend.app.database import get_database
from backend.app.main import create_app


class RecordingDatabase:
    def __init__(self, *, broken: bool = False) -> None:
        self.broken = broken
        self.statements: list[str] = []

    def execute(self, statement: object) -> None:
        self.statements.append(str(statement))
        if self.broken:
            raise RuntimeError("postgresql://secret@database/pitch")


@pytest.fixture
def database() -> RecordingDatabase:
    return RecordingDatabase()


@pytest.fixture
def client(database: RecordingDatabase) -> Iterator[TestClient]:
    app = create_app(include_test_routes=True)
    app.dependency_overrides[get_database] = lambda: database
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client


@pytest.fixture
def broken_client() -> Iterator[TestClient]:
    app = create_app(include_test_routes=True)
    app.dependency_overrides[get_database] = lambda: RecordingDatabase(broken=True)
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client
