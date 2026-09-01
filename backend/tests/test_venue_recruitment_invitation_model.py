from __future__ import annotations

import importlib.util
from pathlib import Path

from sqlalchemy import Enum as SAEnum


def test_recruitment_invitation_model_freezes_lifecycle_and_storage_shape() -> None:
    from backend.app.models import (
        VenueRecruitmentInvitation,
        VenueRecruitmentInvitationStatus,
    )

    assert [status.value for status in VenueRecruitmentInvitationStatus] == [
        "ACTIVE",
        "CLAIMED",
        "SUBMITTED",
        "REVOKED",
        "EXPIRED",
    ]
    table = VenueRecruitmentInvitation.__table__
    assert list(table.columns.keys()) == [
        "id",
        "venue_id",
        "token_sha256",
        "status",
        "contact_label",
        "expires_at",
        "created_at",
        "created_by_principal_id",
        "create_idempotency_key",
        "create_request_sha256",
        "claimed_by_user_id",
        "claimed_at",
        "application_id",
        "revoked_at",
        "revoked_by_principal_id",
        "revocation_reason",
        "revoke_idempotency_key",
        "revoke_request_sha256",
        "version",
    ]
    assert isinstance(table.c.status.type, SAEnum)
    assert table.c.status.type.name == "venue_recruitment_invitation_status"
    assert table.c.token_sha256.unique is True
    assert table.c.application_id.unique is True
    assert {constraint.name for constraint in table.constraints} >= {
        "ck_recruitment_invitations_state_fields",
        "ck_recruitment_invitations_contact_label",
        "ck_recruitment_invitations_expiry",
        "ck_recruitment_invitations_version",
        "uq_recruitment_invitations_creator_create_key",
        "uq_recruitment_invitations_revoker_revoke_key",
    }
    assert {index.name for index in table.indexes} >= {
        "uq_recruitment_invitations_live_venue",
        "ix_recruitment_invitations_created_page",
        "ix_recruitment_invitations_status_created_page",
    }


def test_0025_migration_is_reserved_after_c2f_0024() -> None:
    path = (
        Path(__file__).resolve().parents[1]
        / "migrations"
        / "versions"
        / "0025_venue_recruitment_invitations.py"
    )
    spec = importlib.util.spec_from_file_location("migration_0025", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.revision == "0025"
    assert module.down_revision == "0024"
