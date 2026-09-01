import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "backend/migrations/versions/0026_venue_staff_authorization.py"


def test_0026_extends_0025_with_authority_constraints_and_immutable_audit() -> None:
    assert MIGRATION.exists()
    spec = importlib.util.spec_from_file_location("migration_0026", MIGRATION)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    assert module.revision == "0026"
    assert module.down_revision == "0025"

    source = MIGRATION.read_text(encoding="utf-8")
    for fragment in (
        "uq_venue_memberships_active_owner",
        "ck_venue_memberships_role_permissions",
        "venue_staff_invitations",
        "venue_membership_audit_events",
        "prevent_venue_membership_audit_mutation",
        "RAISE EXCEPTION",
    ):
        assert fragment in source

