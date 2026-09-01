from __future__ import annotations

from pathlib import Path
from typing import Final

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

PLATFORM_ADMIN_ASSETS: Final = frozenset(
    {
        "styles.css",
        "main.js",
        "api.js",
        "auth.js",
        "review.js",
        "attendance-correction.js",
        "game-report-resolution.js",
        "recruitment-invitations.js",
    }
)
PLATFORM_CSP: Final = (
    "default-src 'self'; base-uri 'none'; object-src 'none'; "
    "frame-ancestors 'none'; form-action 'self'; connect-src 'self'; "
    "img-src 'self' data:; style-src 'self'; script-src 'self'"
)


def default_platform_admin_root() -> Path:
    return Path(__file__).resolve().parents[3] / "platform-admin" / "dist"


class PlatformAdminSecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(
        self,
        scope: Scope,
        receive: Receive,
        send: Send,
    ) -> None:
        path = scope.get("path", "")
        if scope["type"] != "http" or not (
            path == "/platform-admin" or path.startswith("/platform-admin/")
        ):
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers["Cache-Control"] = "no-store"
                headers["Content-Security-Policy"] = PLATFORM_CSP
                headers["X-Content-Type-Options"] = "nosniff"
                headers["Referrer-Policy"] = "no-referrer"
            await send(message)

        await self.app(scope, receive, send_with_headers)


def create_platform_web_router(static_root: Path) -> APIRouter:
    router = APIRouter(include_in_schema=False)

    def serve_file(filename: str) -> FileResponse:
        target = static_root / filename
        if not target.is_file():
            raise HTTPException(status_code=404)
        return FileResponse(target)

    @router.get("/platform-admin")
    @router.get("/platform-admin/")
    def platform_admin_index() -> FileResponse:
        return serve_file("index.html")

    @router.get("/platform-admin/{asset_name}")
    def platform_admin_asset(asset_name: str) -> FileResponse:
        if asset_name not in PLATFORM_ADMIN_ASSETS:
            raise HTTPException(status_code=404)
        return serve_file(asset_name)

    return router
