import re
import secrets
import time

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint

SAFE_REQUEST_ID = re.compile(r"^[A-Za-z0-9._:-]{1,64}$")
_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def _encode_timestamp(value: int) -> str:
    characters: list[str] = []
    for _ in range(10):
        characters.append(_CROCKFORD[value & 31])
        value >>= 5
    return "".join(reversed(characters))


def new_request_id() -> str:
    timestamp = _encode_timestamp(int(time.time() * 1000))
    randomness = "".join(secrets.choice(_CROCKFORD) for _ in range(16))
    return timestamp + randomness


class RequestIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        supplied = request.headers.get("X-Request-Id", "")
        request_id = supplied if SAFE_REQUEST_ID.fullmatch(supplied) else new_request_id()
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["X-Request-Id"] = request_id
        return response
