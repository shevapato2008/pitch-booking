"""add venue onboarding application and private evidence records

Revision ID: 0011
Revises: 0010
Create Date: 2026-08-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0011"
down_revision: str | Sequence[str] | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ENUMS = {
    "venue_onboarding_kind": ("CLAIM", "CREATE"),
    "venue_onboarding_status": ("SUBMITTED", "APPROVED", "REJECTED"),
    "venue_onboarding_evidence_kind": (
        "BUSINESS_LICENSE",
        "MANAGEMENT_AUTHORIZATION",
        "VENUE_EXTERIOR",
        "VENUE_INTERIOR",
    ),
    "venue_onboarding_evidence_state": ("UPLOADING", "COMPLETED"),
}


def _type(name: str) -> postgresql.ENUM:
    return postgresql.ENUM(*ENUMS[name], name=name, create_type=False)


def upgrade() -> None:
    for name, values in ENUMS.items():
        postgresql.ENUM(*values, name=name).create(op.get_bind())

    op.create_table(
        "venue_onboarding_applications",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("applicant_user_id", sa.UUID(), nullable=False),
        sa.Column("kind", _type("venue_onboarding_kind"), nullable=False),
        sa.Column("target_venue_id", sa.UUID(), nullable=True),
        sa.Column("proposed_name", sa.String(length=200), nullable=True),
        sa.Column("proposed_address", sa.Text(), nullable=True),
        sa.Column("proposed_district_code", sa.String(length=6), nullable=True),
        sa.Column("proposed_district_name", sa.Text(), nullable=True),
        sa.Column("proposed_latitude", sa.Float(), nullable=True),
        sa.Column("proposed_longitude", sa.Float(), nullable=True),
        sa.Column("normalized_proposed_name", sa.Text(), nullable=True),
        sa.Column("normalized_proposed_address", sa.Text(), nullable=True),
        sa.Column("contact_phone_ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column("contact_phone_nonce", sa.LargeBinary(), nullable=False),
        sa.Column("contact_phone_key_version", sa.Integer(), nullable=False),
        sa.Column("contact_name", sa.String(length=40), nullable=False),
        sa.Column("status", _type("venue_onboarding_status"), nullable=False),
        sa.Column(
            "submitted_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("reviewer_principal_id", sa.String(length=128), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("review_reason", sa.Text(), nullable=True),
        sa.Column("approved_venue_id", sa.UUID(), nullable=True),
        sa.CheckConstraint(
            "(kind = 'CLAIM' AND target_venue_id IS NOT NULL "
            "AND proposed_name IS NULL AND proposed_address IS NULL "
            "AND proposed_district_code IS NULL AND proposed_district_name IS NULL "
            "AND proposed_latitude IS NULL AND proposed_longitude IS NULL "
            "AND normalized_proposed_name IS NULL "
            "AND normalized_proposed_address IS NULL) OR "
            "(kind = 'CREATE' AND target_venue_id IS NULL "
            "AND proposed_name IS NOT NULL AND proposed_address IS NOT NULL "
            "AND proposed_district_code IS NOT NULL "
            "AND proposed_district_name IS NOT NULL "
            "AND proposed_latitude IS NOT NULL AND proposed_longitude IS NOT NULL "
            "AND normalized_proposed_name IS NOT NULL "
            "AND normalized_proposed_address IS NOT NULL)",
            name="ck_onboarding_applications_kind_fields",
        ),
        sa.CheckConstraint(
            "proposed_name IS NULL OR length(trim(proposed_name)) > 0",
            name="ck_onboarding_applications_proposed_name",
        ),
        sa.CheckConstraint(
            "proposed_address IS NULL OR length(trim(proposed_address)) > 0",
            name="ck_onboarding_applications_proposed_address",
        ),
        sa.CheckConstraint(
            "proposed_district_code IS NULL OR proposed_district_code ~ '^[0-9]{6}$'",
            name="ck_onboarding_applications_district_code",
        ),
        sa.CheckConstraint(
            "proposed_district_name IS NULL OR length(trim(proposed_district_name)) > 0",
            name="ck_onboarding_applications_district_name",
        ),
        sa.CheckConstraint(
            "proposed_latitude IS NULL OR proposed_latitude BETWEEN -90 AND 90",
            name="ck_onboarding_applications_latitude",
        ),
        sa.CheckConstraint(
            "proposed_longitude IS NULL OR proposed_longitude BETWEEN -180 AND 180",
            name="ck_onboarding_applications_longitude",
        ),
        sa.CheckConstraint(
            "normalized_proposed_name IS NULL OR length(trim(normalized_proposed_name)) > 0",
            name="ck_onboarding_applications_normalized_name",
        ),
        sa.CheckConstraint(
            "normalized_proposed_address IS NULL OR length(trim(normalized_proposed_address)) > 0",
            name="ck_onboarding_applications_normalized_address",
        ),
        sa.CheckConstraint(
            "length(trim(contact_name)) BETWEEN 1 AND 40",
            name="ck_onboarding_applications_contact_name",
        ),
        sa.CheckConstraint(
            "contact_phone_key_version > 0",
            name="ck_onboarding_applications_phone_key_version",
        ),
        sa.CheckConstraint(
            "octet_length(contact_phone_nonce) = 12",
            name="ck_onboarding_applications_phone_nonce_length",
        ),
        sa.CheckConstraint(
            "octet_length(contact_phone_ciphertext) >= 16",
            name="ck_onboarding_applications_phone_ciphertext_length",
        ),
        sa.CheckConstraint(
            "(status = 'SUBMITTED' AND reviewer_principal_id IS NULL "
            "AND reviewed_at IS NULL AND review_reason IS NULL "
            "AND approved_venue_id IS NULL) OR "
            "(status = 'APPROVED' AND reviewer_principal_id IS NOT NULL "
            "AND reviewed_at IS NOT NULL AND review_reason IS NOT NULL "
            "AND length(trim(review_reason)) > 0 AND approved_venue_id IS NOT NULL) OR "
            "(status = 'REJECTED' AND reviewer_principal_id IS NOT NULL "
            "AND reviewed_at IS NOT NULL AND review_reason IS NOT NULL "
            "AND length(trim(review_reason)) > 0 AND approved_venue_id IS NULL)",
            name="ck_onboarding_applications_review_state",
        ),
        sa.CheckConstraint(
            "reviewer_principal_id IS NULL OR length(trim(reviewer_principal_id)) > 0",
            name="ck_onboarding_applications_reviewer_principal",
        ),
        sa.CheckConstraint(
            "reviewed_at IS NULL OR reviewed_at >= submitted_at",
            name="ck_onboarding_applications_reviewed_at",
        ),
        sa.CheckConstraint(
            "status <> 'APPROVED' OR kind <> 'CLAIM' OR approved_venue_id = target_venue_id",
            name="ck_onboarding_applications_claim_approval",
        ),
        sa.ForeignKeyConstraint(
            ["applicant_user_id"],
            ["users.id"],
            name="fk_onboarding_applications_applicant_user",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["target_venue_id"],
            ["venues.id"],
            name="fk_onboarding_applications_target_venue",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["approved_venue_id"],
            ["venues.id"],
            name="fk_onboarding_applications_approved_venue",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_venue_onboarding_applications"),
    )
    op.create_index(
        "uq_venue_onboarding_submitted_claim",
        "venue_onboarding_applications",
        ["applicant_user_id", "target_venue_id"],
        unique=True,
        postgresql_where=sa.text("kind = 'CLAIM' AND status = 'SUBMITTED'"),
    )
    op.create_index(
        "uq_venue_onboarding_submitted_create",
        "venue_onboarding_applications",
        [
            "applicant_user_id",
            "normalized_proposed_name",
            "normalized_proposed_address",
        ],
        unique=True,
        postgresql_where=sa.text("kind = 'CREATE' AND status = 'SUBMITTED'"),
    )

    op.create_table(
        "venue_onboarding_evidence",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("owner_user_id", sa.UUID(), nullable=False),
        sa.Column("application_id", sa.UUID(), nullable=True),
        sa.Column("kind", _type("venue_onboarding_evidence_kind"), nullable=False),
        sa.Column("state", _type("venue_onboarding_evidence_state"), nullable=False),
        sa.Column("object_key", sa.Text(), nullable=False),
        sa.Column("content_type", sa.String(length=255), nullable=False),
        sa.Column("byte_size", sa.BigInteger(), nullable=True),
        sa.Column("content_sha256", sa.String(length=64), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "length(trim(object_key)) > 0 "
            "AND object_key !~* '^[a-z][a-z0-9+.-]*://' "
            "AND left(object_key, 1) <> '/'",
            name="ck_onboarding_evidence_private_object_key",
        ),
        sa.CheckConstraint(
            "length(trim(content_type)) > 0",
            name="ck_onboarding_evidence_content_type",
        ),
        sa.CheckConstraint(
            "(state = 'UPLOADING' AND application_id IS NULL "
            "AND byte_size IS NULL AND content_sha256 IS NULL) OR "
            "(state = 'COMPLETED' AND byte_size IS NOT NULL AND byte_size > 0 "
            "AND content_sha256 IS NOT NULL "
            "AND content_sha256 ~ '^[0-9a-f]{64}$')",
            name="ck_onboarding_evidence_state_fields",
        ),
        sa.ForeignKeyConstraint(
            ["owner_user_id"],
            ["users.id"],
            name="fk_onboarding_evidence_owner_user",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["application_id"],
            ["venue_onboarding_applications.id"],
            name="fk_onboarding_evidence_application",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_venue_onboarding_evidence"),
        sa.UniqueConstraint("object_key", name="uq_onboarding_evidence_object_key"),
    )


def downgrade() -> None:
    op.drop_table("venue_onboarding_evidence")
    op.drop_index(
        "uq_venue_onboarding_submitted_create",
        table_name="venue_onboarding_applications",
    )
    op.drop_index(
        "uq_venue_onboarding_submitted_claim",
        table_name="venue_onboarding_applications",
    )
    op.drop_table("venue_onboarding_applications")
    for name in reversed(ENUMS):
        postgresql.ENUM(name=name).drop(op.get_bind())
