from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

REQUIRED_KEYS = (
    "APP_ENV",
    "APP_REVISION",
    "DATABASE_URL",
    "POSTGRES_DB",
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
    "PUBLIC_API_BASE_URL",
    "PUBLIC_IMAGE_HOSTS",
)
COMMIT_SHA = re.compile(r"^[0-9a-fA-F]{40}$")
LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})


@dataclass(frozen=True)
class PreflightResult:
    failures: tuple[str, ...]

    @property
    def ok(self) -> bool:
        return not self.failures


def read_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line_number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            raise ValueError(f"invalid env line {line_number}")
        key, value = line.split("=", 1)
        key = key.strip()
        if not key or key in values:
            raise ValueError(f"invalid env key on line {line_number}")
        values[key] = value.strip()
    return values


def preflight(env_file: str | Path) -> PreflightResult:
    try:
        values = read_env_file(Path(env_file))
    except (OSError, UnicodeError, ValueError) as error:
        return PreflightResult((f"environment file is invalid: {error}",))

    failures = [f"{key} is required" for key in REQUIRED_KEYS if not values.get(key)]
    if values.get("POSTGRES_PASSWORD") == "change-before-deploy":
        failures.append("POSTGRES_PASSWORD uses validation sentinel")
    if not COMMIT_SHA.fullmatch(values.get("APP_REVISION", "")):
        failures.append("APP_REVISION is not a 40-character commit SHA")

    public_url = values.get("PUBLIC_API_BASE_URL", "")
    parsed = urlsplit(public_url)
    if parsed.hostname and parsed.hostname.endswith(".invalid"):
        failures.append("PUBLIC_API_BASE_URL uses validation sentinel")
    elif parsed.scheme not in {"http", "https"} or not parsed.hostname:
        failures.append("PUBLIC_API_BASE_URL must be an absolute HTTP(S) URL")
    elif parsed.scheme == "http" and parsed.hostname not in LOOPBACK_HOSTS:
        failures.append("PUBLIC_API_BASE_URL must use HTTPS unless it targets loopback")

    return PreflightResult(tuple(failures))


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate local staging deployment inputs")
    parser.add_argument("--env-file", type=Path, required=True)
    args = parser.parse_args()
    result = preflight(args.env_file)
    print(json.dumps({"ok": result.ok, "failures": result.failures}, ensure_ascii=False))
    return 0 if result.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
