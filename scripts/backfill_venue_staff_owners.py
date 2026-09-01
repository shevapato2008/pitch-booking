import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
if str(REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT))

from backend.app.config import Settings  # noqa: E402
from backend.app.modules.venue_staff.owner_mapping import (  # noqa: E402
    OwnerMappingError,
    backfill_venue_staff_owners,
    load_owner_mapping,
)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Validate or apply the explicit D1b venue owner mapping"
    )
    parser.add_argument("--mapping", type=Path, required=True)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="commit the validated mapping; default is validation-only rollback",
    )
    args = parser.parse_args()

    engine = create_engine(Settings().database_url, pool_pre_ping=True)
    try:
        with Session(engine) as session:
            entries = load_owner_mapping(args.mapping)
            report = backfill_venue_staff_owners(
                session,
                entries,
                apply=args.apply,
            )
    except OwnerMappingError as error:
        print(
            json.dumps(
                {"ok": False, "code": error.code, "message": error.message},
                ensure_ascii=False,
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        raise SystemExit(2) from error
    finally:
        engine.dispose()

    print(
        json.dumps(
            {"ok": True, **asdict(report)},
            ensure_ascii=False,
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
