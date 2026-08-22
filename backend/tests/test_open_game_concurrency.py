import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier

import pytest
from sqlalchemy import Engine, create_engine, func, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool

from backend.app.errors import AppError
from backend.app.models import OpenGame, Team
from backend.app.modules.open_games.repository import OpenGameRepository
from backend.app.modules.open_games.service import OpenGameService
from backend.app.modules.orders.repository import OrderRepository
from backend.tests.test_open_game_service import (
    CREATE_KEY,
    NOW,
    draft_request,
    seed_confirmed_order,
)

pytestmark = pytest.mark.integration


def _create_in_thread(
    engine: Engine,
    *,
    barrier: Barrier,
    user_id: uuid.UUID,
    order_id: uuid.UUID,
    key: str,
    request: object,
) -> tuple[str, uuid.UUID | None]:
    request_engine = create_engine(engine.url, poolclass=NullPool)
    try:
        with Session(request_engine) as session:
            barrier.wait(timeout=20)
            try:
                result = OpenGameService(
                    repository=OpenGameRepository(session),
                    order_repository=OrderRepository(session),
                    now=lambda: NOW,
                ).create_draft(
                    user_id=user_id,
                    order_id=order_id,
                    idempotency_key=key,
                    request=request,
                )
                return "CREATED", result.id
            except AppError as error:
                return error.code, None
    finally:
        request_engine.dispose()


def test_same_order_concurrent_create_yields_one_active_game(pg_engine: Engine) -> None:
    seeded = seed_confirmed_order(pg_engine)
    barrier = Barrier(2)
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [
            executor.submit(
                _create_in_thread,
                pg_engine,
                barrier=barrier,
                user_id=seeded.owner_id,
                order_id=seeded.order_id,
                key=f"{CREATE_KEY}-{index}",
                request=draft_request(seeded, team_name=f"并发队伍{index}"),
            )
            for index in range(2)
        ]
        outcomes = [future.result(timeout=30)[0] for future in futures]

    assert sorted(outcomes) == ["CREATED", "OPEN_GAME_ALREADY_EXISTS"]
    with Session(pg_engine) as session:
        assert session.scalar(
            select(func.count()).select_from(OpenGame).where(
                OpenGame.order_id == seeded.order_id
            )
        ) == 1


def test_same_captain_concurrent_orders_reuse_normalized_team(pg_engine: Engine) -> None:
    first = seed_confirmed_order(pg_engine)
    second = seed_confirmed_order(
        pg_engine,
        owner_id=first.owner_id,
        starts_at=NOW + timedelta(days=4),
    )
    barrier = Barrier(2)
    requests = (
        draft_request(first, team_name="Ａ队"),
        draft_request(second, team_name="A队"),
    )
    cases = (first, second)
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [
            executor.submit(
                _create_in_thread,
                pg_engine,
                barrier=barrier,
                user_id=case.owner_id,
                order_id=case.order_id,
                key=f"shared-team-create-key-{index:08d}",
                request=request,
            )
            for index, (case, request) in enumerate(zip(cases, requests, strict=True))
        ]
        outcomes = [future.result(timeout=30)[0] for future in futures]

    assert outcomes == ["CREATED", "CREATED"]
    with Session(pg_engine) as session:
        assert session.scalar(select(func.count()).select_from(OpenGame)) == 2
        assert session.scalar(
            select(func.count()).select_from(Team).where(
                Team.captain_user_id == first.owner_id
            )
        ) == 1
