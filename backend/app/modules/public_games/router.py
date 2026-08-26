"""Anonymous HTTP route for authoritative public-game discovery."""

from datetime import UTC, date, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from backend.app.database import get_database
from backend.app.errors import ErrorEnvelope
from backend.app.modules.public_games.dto import (
    PublicGameDirectoryResponse,
    PublicGameFormat,
)
from backend.app.modules.public_games.repository import PublicGameDirectoryRepository
from backend.app.modules.public_games.service import PublicGameDirectoryService

router = APIRouter(tags=["public-games"])


def get_public_game_directory_clock() -> datetime:
    return datetime.now(UTC)


def align_public_game_directory_openapi(schema: dict[str, Any]) -> None:
    error_envelope = {"$ref": "#/components/schemas/ErrorEnvelope"}

    def error_response(
        description: str,
        *,
        code: str,
        example_name: str,
        example_file: str,
    ) -> dict[str, Any]:
        return {
            "description": description,
            "content": {
                "application/json": {
                    "schema": {
                        "allOf": [
                            error_envelope,
                            {
                                "type": "object",
                                "properties": {
                                    "error": {
                                        "type": "object",
                                        "properties": {"code": {"const": code}},
                                    }
                                },
                            },
                        ]
                    },
                    "examples": {example_name: {"externalValue": f"./examples/{example_file}"}},
                }
            },
        }

    schema["paths"]["/api/v1/public-games"]["get"] = {
        "operationId": "listPublicGames",
        "security": [],
        "parameters": [
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
        ],
        "responses": {
            "200": {
                "description": "Discoverable public games at one authoritative server time.",
                "content": {
                    "application/json": {
                        "schema": {"$ref": "#/components/schemas/PublicGameDirectoryResponse"},
                        "examples": {
                            "Ready": {"externalValue": "./examples/public-games-ready.json"},
                            "Empty": {"externalValue": "./examples/public-games-empty.json"},
                        },
                    }
                },
            },
            "422": error_response(
                "A public game directory filter is invalid.",
                code="INVALID_ARGUMENT",
                example_name="InvalidArgument",
                example_file="error-invalid-argument.json",
            ),
            "503": error_response(
                "Public game directory service is unavailable.",
                code="SERVICE_UNAVAILABLE",
                example_name="ServiceUnavailable",
                example_file="error-service-unavailable.json",
            ),
        },
    }
    schema["components"]["schemas"].update(
        {
            "PublicGameFormat": {
                "type": "string",
                "enum": ["FIVE", "SEVEN"],
            },
            "PublicGameDirectoryItem": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "detail_path",
                    "local_date",
                    "format",
                    "current_players",
                    "remaining_spots",
                    "game",
                ],
                "properties": {
                    "detail_path": {
                        "type": "string",
                        "pattern": "^/pages/captain-game-public/index\\?token=[A-Za-z0-9_-]{32}$",
                    },
                    "local_date": {"type": "string", "format": "date"},
                    "format": {"$ref": "#/components/schemas/PublicGameFormat"},
                    "current_players": {"type": "integer", "minimum": 1},
                    "remaining_spots": {"type": "integer", "minimum": 0},
                    "game": {"$ref": "#/components/schemas/OpenGamePublic"},
                },
            },
            "PublicGameDirectoryResponse": {
                "type": "object",
                "additionalProperties": False,
                "required": ["authoritative_now", "available_dates", "items"],
                "properties": {
                    "authoritative_now": {
                        "type": "string",
                        "format": "date-time",
                    },
                    "available_dates": {
                        "type": "array",
                        "uniqueItems": True,
                        "items": {"type": "string", "format": "date"},
                    },
                    "items": {
                        "type": "array",
                        "items": {"$ref": "#/components/schemas/PublicGameDirectoryItem"},
                    },
                },
            },
        }
    )


@router.get(
    "/api/v1/public-games",
    operation_id="listPublicGames",
    response_model=PublicGameDirectoryResponse,
    responses={
        422: {"model": ErrorEnvelope},
        503: {"model": ErrorEnvelope},
    },
    openapi_extra={"security": []},
)
def list_public_games(
    database: Annotated[Session, Depends(get_database)],
    now: Annotated[datetime, Depends(get_public_game_directory_clock)],
    local_date: Annotated[date | None, Query()] = None,
    game_format: Annotated[
        PublicGameFormat | None,
        Query(alias="format"),
    ] = None,
    available_only: Annotated[bool, Query()] = False,
) -> PublicGameDirectoryResponse:
    return PublicGameDirectoryService(
        repository=PublicGameDirectoryRepository(database),
        now=lambda: now,
    ).list_games(
        local_date=local_date,
        game_format=game_format,
        available_only=available_only,
    )
