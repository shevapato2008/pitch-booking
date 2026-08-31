"""add targeted venue recruitment invitations

Revision ID: 0025
Revises: 0024
Create Date: 2026-09-01
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0025"
down_revision: str | Sequence[str] | None = "0024"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

STATUS_NAME = "venue_recruitment_invitation_status"
STATUS_VALUES = ("ACTIVE", "CLAIMED", "SUBMITTED", "REVOKED", "EXPIRED")


def _status_type() -> postgresql.ENUM:
    return postgresql.ENUM(*STATUS_VALUES, name=STATUS_NAME, create_type=False)


def upgrade() -> None:
    postgresql.ENUM(*STATUS_VALUES, name=STATUS_NAME).create(op.get_bind())
    op.create_table(
        "venue_recruitment_invitations",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("venue_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("token_sha256", sa.String(length=64), nullable=False),
        sa.Column("status", _status_type(), nullable=False),
        sa.Column("contact_label", sa.String(length=40), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("created_by_principal_id", sa.String(length=128), nullable=False),
        sa.Column("create_idempotency_key", sa.String(length=128), nullable=False),
        sa.Column("create_request_sha256", sa.String(length=64), nullable=False),
        sa.Column("claimed_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("application_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_by_principal_id", sa.String(length=128), nullable=True),
        sa.Column("revocation_reason", sa.String(length=120), nullable=True),
        sa.Column("revoke_idempotency_key", sa.String(length=128), nullable=True),
        sa.Column("revoke_request_sha256", sa.String(length=64), nullable=True),
        sa.Column("version", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.CheckConstraint(
            "token_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_recruitment_invitations_token_sha256",
        ),
        sa.CheckConstraint(
            "length(contact_label) BETWEEN 1 AND 40 AND contact_label = trim(contact_label)",
            name="ck_recruitment_invitations_contact_label",
        ),
        sa.CheckConstraint(
            "length(created_by_principal_id) BETWEEN 1 AND 128 "
            "AND created_by_principal_id = trim(created_by_principal_id)",
            name="ck_recruitment_invitations_creator",
        ),
        sa.CheckConstraint(
            "length(create_idempotency_key) BETWEEN 16 AND 128",
            name="ck_recruitment_invitations_create_key",
        ),
        sa.CheckConstraint(
            "create_request_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_recruitment_invitations_create_request_sha256",
        ),
        sa.CheckConstraint(
            "expires_at > created_at",
            name="ck_recruitment_invitations_expiry",
        ),
        sa.CheckConstraint(
            "version >= 1",
            name="ck_recruitment_invitations_version",
        ),
        sa.CheckConstraint(
            "(claimed_by_user_id IS NULL) = (claimed_at IS NULL)",
            name="ck_recruitment_invitations_claim_pair",
        ),
        sa.CheckConstraint(
            "(status = 'ACTIVE' AND claimed_by_user_id IS NULL "
            "AND application_id IS NULL AND revoked_at IS NULL "
            "AND revoked_by_principal_id IS NULL AND revocation_reason IS NULL "
            "AND revoke_idempotency_key IS NULL AND revoke_request_sha256 IS NULL) OR "
            "(status = 'CLAIMED' AND claimed_by_user_id IS NOT NULL "
            "AND application_id IS NULL AND revoked_at IS NULL "
            "AND revoked_by_principal_id IS NULL AND revocation_reason IS NULL "
            "AND revoke_idempotency_key IS NULL AND revoke_request_sha256 IS NULL) OR "
            "(status = 'SUBMITTED' AND claimed_by_user_id IS NOT NULL "
            "AND application_id IS NOT NULL AND revoked_at IS NULL "
            "AND revoked_by_principal_id IS NULL AND revocation_reason IS NULL "
            "AND revoke_idempotency_key IS NULL AND revoke_request_sha256 IS NULL) OR "
            "(status = 'REVOKED' AND application_id IS NULL "
            "AND revoked_at IS NOT NULL AND revoked_by_principal_id IS NOT NULL "
            "AND revocation_reason IS NOT NULL AND revoke_idempotency_key IS NOT NULL "
            "AND revoke_request_sha256 IS NOT NULL) OR "
            "(status = 'EXPIRED' AND application_id IS NULL "
            "AND revoked_at IS NULL AND revoked_by_principal_id IS NULL "
            "AND revocation_reason IS NULL AND revoke_idempotency_key IS NULL "
            "AND revoke_request_sha256 IS NULL)",
            name="ck_recruitment_invitations_state_fields",
        ),
        sa.CheckConstraint(
            "revoked_by_principal_id IS NULL OR "
            "(length(revoked_by_principal_id) BETWEEN 1 AND 128 "
            "AND revoked_by_principal_id = trim(revoked_by_principal_id))",
            name="ck_recruitment_invitations_revoker",
        ),
        sa.CheckConstraint(
            "revocation_reason IS NULL OR "
            "(length(revocation_reason) BETWEEN 1 AND 120 "
            "AND revocation_reason = trim(revocation_reason))",
            name="ck_recruitment_invitations_revocation_reason",
        ),
        sa.CheckConstraint(
            "revoke_idempotency_key IS NULL OR length(revoke_idempotency_key) BETWEEN 16 AND 128",
            name="ck_recruitment_invitations_revoke_key",
        ),
        sa.CheckConstraint(
            "revoke_request_sha256 IS NULL OR revoke_request_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_recruitment_invitations_revoke_request_sha256",
        ),
        sa.ForeignKeyConstraint(
            ["venue_id"],
            ["venues.id"],
            name="fk_recruitment_invitations_venue",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["claimed_by_user_id"],
            ["users.id"],
            name="fk_recruitment_invitations_claimed_user",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["application_id"],
            ["venue_onboarding_applications.id"],
            name="fk_recruitment_invitations_application",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_venue_recruitment_invitations"),
        sa.UniqueConstraint(
            "token_sha256",
            name="uq_recruitment_invitations_token_sha256",
        ),
        sa.UniqueConstraint(
            "application_id",
            name="uq_recruitment_invitations_application_id",
        ),
        sa.UniqueConstraint(
            "created_by_principal_id",
            "create_idempotency_key",
            name="uq_recruitment_invitations_creator_create_key",
        ),
        sa.UniqueConstraint(
            "revoked_by_principal_id",
            "revoke_idempotency_key",
            name="uq_recruitment_invitations_revoker_revoke_key",
        ),
    )
    op.create_index(
        "uq_recruitment_invitations_live_venue",
        "venue_recruitment_invitations",
        ["venue_id"],
        unique=True,
        postgresql_where=sa.text("status IN ('ACTIVE', 'CLAIMED')"),
    )
    op.create_index(
        "ix_recruitment_invitations_created_page",
        "venue_recruitment_invitations",
        [sa.text("created_at DESC"), sa.text("id DESC")],
    )
    op.create_index(
        "ix_recruitment_invitations_status_created_page",
        "venue_recruitment_invitations",
        ["status", sa.text("created_at DESC"), sa.text("id DESC")],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_recruitment_invitations_status_created_page",
        table_name="venue_recruitment_invitations",
    )
    op.drop_index(
        "ix_recruitment_invitations_created_page",
        table_name="venue_recruitment_invitations",
    )
    op.drop_index(
        "uq_recruitment_invitations_live_venue",
        table_name="venue_recruitment_invitations",
    )
    op.drop_table("venue_recruitment_invitations")
    postgresql.ENUM(name=STATUS_NAME).drop(op.get_bind())
