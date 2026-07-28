import json
import subprocess
from collections.abc import Callable
from typing import Annotated, cast

from pydantic import Field, TypeAdapter, ValidationError

from backend.app.modules.orders import service as order_service

_MAX_UNICODE = 0x10FFFF
_NODE_HAN_INTERVAL_SCAN = r"""
const han = /^\p{Script=Han}$/u;
const intervals = [];
let start = null;
let previous = null;
let count = 0;
for (let codePoint = 0; codePoint <= 0x10FFFF; codePoint += 1) {
  if (!han.test(String.fromCodePoint(codePoint))) continue;
  count += 1;
  if (start === null) {
    start = codePoint;
  } else if (codePoint !== previous + 1) {
    intervals.push([start, previous]);
    start = codePoint;
  }
  previous = codePoint;
}
if (start !== null) intervals.push([start, previous]);
process.stdout.write(JSON.stringify({
  node_version: process.versions.node,
  unicode_version: process.versions.unicode,
  count,
  intervals,
}));
"""


def _node_han_scan() -> dict[str, object]:
    completed = subprocess.run(
        ["node", "--input-type=module", "-e", _NODE_HAN_INTERVAL_SCAN],
        check=True,
        capture_output=True,
        text=True,
        timeout=30,
    )
    result = json.loads(completed.stdout)
    assert isinstance(result, dict)
    return result


def _current_backend_han_predicate() -> Callable[[str], bool]:
    predicate = getattr(order_service, "_is_han_character", None)
    if callable(predicate):
        return cast(Callable[[str], bool], predicate)

    # Diagnostic fallback for the pre-fix pydantic-core implementation. Keeping
    # it here makes the regression quantify Unicode-version drift instead of
    # failing early merely because the interval predicate has not landed yet.
    adapter: TypeAdapter[str] = TypeAdapter(
        Annotated[str, Field(pattern=r"^\p{Script=Han}$")]
    )

    def core_regex_predicate(character: str) -> bool:
        try:
            adapter.validate_python(character)
        except ValidationError:
            return False
        return True

    return core_regex_predicate


def _expand_intervals(intervals: object) -> bytearray:
    assert isinstance(intervals, list)
    bitset = bytearray(_MAX_UNICODE + 1)
    for raw_interval in intervals:
        assert isinstance(raw_interval, list)
        assert len(raw_interval) == 2
        start, end = raw_interval
        assert isinstance(start, int)
        assert isinstance(end, int)
        assert 0 <= start <= end <= _MAX_UNICODE
        bitset[start : end + 1] = b"\x01" * (end - start + 1)
    return bitset


def _compact_intervals(codepoints: list[int]) -> list[tuple[int, int]]:
    if not codepoints:
        return []
    intervals: list[tuple[int, int]] = []
    start = previous = codepoints[0]
    for codepoint in codepoints[1:]:
        if codepoint != previous + 1:
            intervals.append((start, previous))
            start = codepoint
        previous = codepoint
    intervals.append((start, previous))
    return intervals


def test_backend_han_set_matches_node_unicode_runtime_for_every_codepoint() -> None:
    frontend = _node_han_scan()
    frontend_bitset = _expand_intervals(frontend["intervals"])
    backend_han = _current_backend_han_predicate()
    frontend_only: list[int] = []
    backend_only: list[int] = []

    for codepoint in range(_MAX_UNICODE + 1):
        frontend_accepts = frontend_bitset[codepoint] == 1
        backend_accepts = backend_han(chr(codepoint))
        if frontend_accepts and not backend_accepts:
            frontend_only.append(codepoint)
        elif backend_accepts and not frontend_accepts:
            backend_only.append(codepoint)

    assert not frontend_only and not backend_only, (
        f"Node {frontend['node_version']} Unicode {frontend['unicode_version']} Han drift: "
        f"frontend-only={len(frontend_only)} {_compact_intervals(frontend_only)!r}; "
        f"backend-only={len(backend_only)} {_compact_intervals(backend_only)!r}"
    )
