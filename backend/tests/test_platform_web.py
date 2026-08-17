from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from backend.app.main import create_app


def _write_console(root: Path) -> None:
    root.mkdir()
    (root / "index.html").write_text(
        "<!doctype html><title>平台工作人员登录</title>",
        encoding="utf-8",
    )
    (root / "styles.css").write_text("body { color: #10243e; }", encoding="utf-8")
    (root / "main.js").write_text("export {};", encoding="utf-8")


def test_platform_console_serves_only_known_assets_with_security_headers(tmp_path: Path) -> None:
    console = tmp_path / "dist"
    _write_console(console)
    client = TestClient(create_app(platform_admin_root=console))

    for path, content_type in (
        ("/platform-admin", "text/html"),
        ("/platform-admin/", "text/html"),
        ("/platform-admin/styles.css", "text/css"),
        ("/platform-admin/main.js", "text/javascript"),
    ):
        response = client.get(path)
        assert response.status_code == 200
        assert content_type in response.headers["content-type"]
        assert response.headers["cache-control"] == "no-store"
        assert response.headers["x-content-type-options"] == "nosniff"
        assert response.headers["referrer-policy"] == "no-referrer"
        assert "frame-ancestors 'none'" in response.headers["content-security-policy"]

    assert client.get("/platform-admin/fixture.js").status_code == 404
    assert client.get("/platform-admin/../backend/app/main.py").status_code == 404


def test_platform_api_remains_authenticated_and_no_store(tmp_path: Path) -> None:
    console = tmp_path / "dist"
    _write_console(console)
    client = TestClient(create_app(platform_admin_root=console))

    response = client.get("/platform-admin/api/v1/onboarding/applications")

    assert response.status_code == 401
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert "frame-ancestors 'none'" in response.headers["content-security-policy"]
