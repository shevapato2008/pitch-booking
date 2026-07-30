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
from backend.app.modules.venues.loader import VenueDirectoryLoader  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, default=Path("deploy/venue-directory.json"))
    parser.add_argument("--schema", type=Path, default=Path("deploy/venue-directory.schema.json"))
    parser.add_argument("--environment", choices=("development", "production"), required=True)
    parser.add_argument("--app-revision")
    parser.add_argument("--approval-file", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--unload-directory", action="store_true")
    args = parser.parse_args()

    engine = create_engine(Settings().database_url)
    try:
        with Session(engine) as session:
            loader = VenueDirectoryLoader(session)
            if args.unload_directory:
                result = loader.unload(dry_run=args.dry_run)
            else:
                result = loader.load(
                    manifest_path=args.manifest,
                    schema_path=args.schema,
                    environment=args.environment,
                    app_revision=args.app_revision,
                    approval_path=args.approval_file,
                    dry_run=args.dry_run,
                )
        print(json.dumps(asdict(result), ensure_ascii=False, sort_keys=True))
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
