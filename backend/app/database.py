from collections.abc import Iterator
from functools import lru_cache

from sqlalchemy import Engine, create_engine
from sqlalchemy.engine import Connection

from backend.app.config import Settings


@lru_cache
def get_engine() -> Engine:
    return create_engine(Settings().database_url, pool_pre_ping=True)


def get_database() -> Iterator[Connection]:
    with get_engine().connect() as connection:
        yield connection
