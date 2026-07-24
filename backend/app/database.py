from collections.abc import Iterator
from functools import lru_cache

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session

from backend.app.config import Settings


@lru_cache
def get_engine() -> Engine:
    return create_engine(Settings().database_url, pool_pre_ping=True)


def get_database() -> Iterator[Session]:
    with Session(get_engine()) as session:
        yield session
