"""add venue profile revision and moderation schema

Revision ID: 0010
Revises: 0009
Create Date: 2026-08-11
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0010"
down_revision: str | Sequence[str] | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

FACILITY_CODES = (
    "PARKING",
    "TOILET",
    "CHANGING_ROOM",
    "SHOWER",
    "LOCKERS",
    "DRINKING_WATER",
    "BEVERAGE_SALES",
    "EQUIPMENT_RENTAL",
    "REST_AREA",
    "FIRST_AID",
    "AED",
    "INDOOR",
    "OUTDOOR",
    "COVERED",
    "LIGHTING",
    "ARTIFICIAL_TURF",
    "NATURAL_GRASS",
)
LEGACY_FACILITY_CODES = ("LIGHTING", "CHANGING_ROOM", "DRINKING_WATER", "PARKING")
ENUMS = {
    "moderation_reason_code": (
        "CONTACT_INFO",
        "QR_OR_PAYMENT_CODE",
        "OFF_PLATFORM_TRADE",
        "EXTERNAL_LINK",
        "UNRELATED_CONTENT",
        "IMAGE_NOT_VENUE",
        "IMAGE_QUALITY",
        "PERSONAL_PRIVACY",
        "UNSAFE_CONTENT",
    ),
    "venue_profile_item_status": (
        "UPLOADING",
        "REVIEWING",
        "APPROVED",
        "REJECTED",
        "PENDING_MANUAL",
    ),
    "venue_profile_revision_status": (
        "READY",
        "REVIEWING",
        "REJECTED",
        "PENDING_MANUAL",
        "PUBLISHED",
    ),
    "venue_profile_mime_type": ("image/jpeg", "image/png", "image/webp"),
    "moderation_item_type": ("DESCRIPTION", "IMAGE"),
    "moderation_job_status": ("PENDING", "CLAIMED", "COMPLETED", "FAILED"),
    "moderation_decision_outcome": ("PASS", "REJECT", "UNCERTAIN"),
    "moderation_decision_source": ("PROVIDER", "MANUAL"),
    "profile_mutation_state": ("CLAIMED", "COMPLETED"),
}


def _type(name: str) -> postgresql.ENUM:
    return postgresql.ENUM(*ENUMS[name], name=name, create_type=False)


def _replace_facility_enum(values: tuple[str, ...], old_suffix: str) -> None:
    old_name = f"facility_code_{old_suffix}"
    op.execute(f"ALTER TYPE facility_code RENAME TO {old_name}")
    new_type = postgresql.ENUM(*values, name="facility_code")
    new_type.create(op.get_bind())
    op.alter_column(
        "venue_facilities",
        "code",
        existing_type=postgresql.ENUM(name=old_name, create_type=False),
        type_=postgresql.ENUM(*values, name="facility_code", create_type=False),
        postgresql_using="code::text::facility_code",
    )
    postgresql.ENUM(name=old_name).drop(op.get_bind())


def upgrade() -> None:
    _replace_facility_enum(FACILITY_CODES, "0009")
    for name, values in ENUMS.items():
        postgresql.ENUM(*values, name=name).create(op.get_bind())

    op.add_column(
        "venues", sa.Column("profile_version", sa.BigInteger(), server_default="1", nullable=False)
    )
    op.add_column(
        "venues", sa.Column("facility_version", sa.BigInteger(), server_default="1", nullable=False)
    )
    op.create_check_constraint("ck_venues_profile_version", "venues", "profile_version > 0")
    op.create_check_constraint("ck_venues_facility_version", "venues", "facility_version > 0")

    op.create_table(
        "venue_profile_revisions",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("venue_id", sa.UUID(), nullable=False),
        sa.Column("base_published_version", sa.BigInteger(), nullable=False),
        sa.Column("revision_version", sa.BigInteger(), nullable=False),
        sa.Column("target_description", sa.Text(), nullable=False),
        sa.Column("status", _type("venue_profile_revision_status"), nullable=False),
        sa.Column("description_status", _type("venue_profile_item_status"), nullable=False),
        sa.Column("description_reason_code", _type("moderation_reason_code"), nullable=True),
        sa.Column("created_by_user_id", sa.UUID(), nullable=False),
        sa.Column("is_current_editable", sa.Boolean(), server_default="true", nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "base_published_version > 0", name="ck_venue_profile_revisions_base_version"
        ),
        sa.CheckConstraint(
            "revision_version > 0", name="ck_venue_profile_revisions_revision_version"
        ),
        sa.CheckConstraint(
            "char_length(target_description) <= 300",
            name="ck_venue_profile_revisions_description_length",
        ),
        sa.CheckConstraint(
            "(description_status = 'REJECTED' AND description_reason_code IS NOT NULL) OR "
            "(description_status <> 'REJECTED' AND description_reason_code IS NULL)",
            name="ck_venue_profile_revisions_description_reason",
        ),
        sa.ForeignKeyConstraint(["venue_id"], ["venues.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "venue_id", "revision_version", name="uq_venue_profile_revisions_venue_version"
        ),
    )
    op.create_index(
        "uq_venue_profile_revisions_current_editable",
        "venue_profile_revisions",
        ["venue_id"],
        unique=True,
        postgresql_where=sa.text("is_current_editable"),
    )

    op.create_table(
        "venue_profile_image_drafts",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("revision_id", sa.UUID(), nullable=False),
        sa.Column("published_image_id", sa.UUID(), nullable=True),
        sa.Column("original_object_key", sa.Text(), nullable=True),
        sa.Column("review_object_key", sa.Text(), nullable=True),
        sa.Column("role", postgresql.ENUM(name="image_role", create_type=False), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("content_sha256", sa.String(length=64), nullable=True),
        sa.Column("actual_mime_type", _type("venue_profile_mime_type"), nullable=True),
        sa.Column("byte_size", sa.BigInteger(), nullable=True),
        sa.Column("moderation_status", _type("venue_profile_item_status"), nullable=False),
        sa.Column("moderation_reason_code", _type("moderation_reason_code"), nullable=True),
        sa.Column("item_version", sa.BigInteger(), server_default="1", nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint(
            "(published_image_id IS NOT NULL) <> (original_object_key IS NOT NULL)",
            name="ck_venue_profile_image_drafts_exactly_one_source",
        ),
        sa.CheckConstraint("sort_order >= 0", name="ck_venue_profile_image_drafts_sort_order"),
        sa.CheckConstraint("item_version > 0", name="ck_venue_profile_image_drafts_item_version"),
        sa.CheckConstraint(
            "byte_size IS NULL OR byte_size > 0", name="ck_venue_profile_image_drafts_byte_size"
        ),
        sa.CheckConstraint(
            "content_sha256 IS NULL OR content_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_venue_profile_image_drafts_sha256",
        ),
        sa.CheckConstraint(
            "(moderation_status = 'REJECTED' AND moderation_reason_code IS NOT NULL) OR "
            "(moderation_status <> 'REJECTED' AND moderation_reason_code IS NULL)",
            name="ck_venue_profile_image_drafts_reason",
        ),
        sa.ForeignKeyConstraint(
            ["revision_id"], ["venue_profile_revisions.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["published_image_id"], ["venue_images.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "revision_id", "sort_order", name="uq_venue_profile_image_drafts_revision_sort"
        ),
    )
    op.create_index(
        "ix_venue_profile_image_drafts_revision_id", "venue_profile_image_drafts", ["revision_id"]
    )

    op.create_table(
        "content_moderation_jobs",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("revision_id", sa.UUID(), nullable=False),
        sa.Column("image_draft_id", sa.UUID(), nullable=True),
        sa.Column("item_type", _type("moderation_item_type"), nullable=False),
        sa.Column("item_version", sa.BigInteger(), nullable=False),
        sa.Column("status", _type("moderation_job_status"), nullable=False),
        sa.Column("attempt_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("claim_token", sa.UUID(), nullable=True),
        sa.Column("lease_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("fixed_reason_code", _type("moderation_reason_code"), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("item_version > 0", name="ck_content_moderation_jobs_item_version"),
        sa.CheckConstraint("attempt_count >= 0", name="ck_content_moderation_jobs_attempt_count"),
        sa.CheckConstraint(
            "(item_type = 'DESCRIPTION' AND image_draft_id IS NULL) OR "
            "(item_type = 'IMAGE' AND image_draft_id IS NOT NULL)",
            name="ck_content_moderation_jobs_item_target",
        ),
        sa.CheckConstraint(
            "(claim_token IS NULL) = (lease_until IS NULL)",
            name="ck_content_moderation_jobs_lease_pair",
        ),
        sa.ForeignKeyConstraint(
            ["revision_id"], ["venue_profile_revisions.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["image_draft_id"], ["venue_profile_image_drafts.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_content_moderation_jobs_due",
        "content_moderation_jobs",
        ["status", "next_run_at", "lease_until", "id"],
    )
    op.create_index(
        "ix_content_moderation_jobs_revision_id", "content_moderation_jobs", ["revision_id"]
    )

    op.create_table(
        "content_moderation_decisions",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("job_id", sa.UUID(), nullable=False),
        sa.Column("item_type", _type("moderation_item_type"), nullable=False),
        sa.Column("item_version", sa.BigInteger(), nullable=False),
        sa.Column("source", _type("moderation_decision_source"), nullable=False),
        sa.Column("outcome", _type("moderation_decision_outcome"), nullable=False),
        sa.Column("reason_code", _type("moderation_reason_code"), nullable=True),
        sa.Column("provider", sa.String(length=80), nullable=True),
        sa.Column("provider_model", sa.String(length=120), nullable=True),
        sa.Column("provider_request_id", sa.String(length=255), nullable=True),
        sa.Column("provider_confidence", sa.Float(), nullable=True),
        sa.Column("raw_response_sha256", sa.String(length=64), nullable=True),
        sa.Column("reviewer_user_id", sa.UUID(), nullable=True),
        sa.Column("idempotency_key", sa.String(length=255), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("item_version > 0", name="ck_content_moderation_decisions_item_version"),
        sa.CheckConstraint(
            "(outcome = 'REJECT' AND reason_code IS NOT NULL) OR "
            "(outcome <> 'REJECT' AND reason_code IS NULL)",
            name="ck_content_moderation_decisions_reason",
        ),
        sa.CheckConstraint(
            "(source = 'PROVIDER' AND reviewer_user_id IS NULL AND provider IS NOT NULL "
            "AND provider_model IS NOT NULL) OR "
            "(source = 'MANUAL' AND reviewer_user_id IS NOT NULL)",
            name="ck_content_moderation_decisions_source",
        ),
        sa.CheckConstraint(
            "provider_confidence IS NULL OR provider_confidence BETWEEN 0 AND 1",
            name="ck_content_moderation_decisions_confidence",
        ),
        sa.ForeignKeyConstraint(["job_id"], ["content_moderation_jobs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reviewer_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "job_id", "idempotency_key", name="uq_content_moderation_decisions_job_key"
        ),
    )
    op.create_index(
        "ix_content_moderation_decisions_job_id", "content_moderation_decisions", ["job_id"]
    )

    op.create_table(
        "profile_mutation_idempotency_records",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("venue_id", sa.UUID(), nullable=False),
        sa.Column("actor_user_id", sa.UUID(), nullable=False),
        sa.Column("scope", sa.String(length=255), nullable=False),
        sa.Column("key", sa.String(length=255), nullable=False),
        sa.Column("request_sha256", sa.String(length=64), nullable=False),
        sa.Column("state", _type("profile_mutation_state"), nullable=False),
        sa.Column("response_status", sa.Integer(), nullable=True),
        sa.Column("response_body", postgresql.JSONB(none_as_null=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("length(trim(scope)) > 0", name="ck_profile_mutations_scope"),
        sa.CheckConstraint("length(key) > 0", name="ck_profile_mutations_key"),
        sa.CheckConstraint(
            "request_sha256 ~ '^[0-9a-f]{64}$'", name="ck_profile_mutations_request_sha256"
        ),
        sa.CheckConstraint(
            "(state = 'CLAIMED' AND response_status IS NULL AND response_body IS NULL) OR "
            "(state = 'COMPLETED' AND response_status IS NOT NULL AND response_body IS NOT NULL)",
            name="ck_profile_mutations_state_response",
        ),
        sa.CheckConstraint(
            "response_status IS NULL OR response_status BETWEEN 100 AND 599",
            name="ck_profile_mutations_response_status",
        ),
        sa.ForeignKeyConstraint(["venue_id"], ["venues.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("scope", "key", name="uq_profile_mutations_scope_key"),
    )
    op.create_index(
        "ix_profile_mutations_venue_id", "profile_mutation_idempotency_records", ["venue_id"]
    )


def downgrade() -> None:
    op.drop_table("profile_mutation_idempotency_records")
    op.drop_table("content_moderation_decisions")
    op.drop_table("content_moderation_jobs")
    op.drop_table("venue_profile_image_drafts")
    op.drop_table("venue_profile_revisions")
    op.drop_constraint("ck_venues_facility_version", "venues", type_="check")
    op.drop_constraint("ck_venues_profile_version", "venues", type_="check")
    op.drop_column("venues", "facility_version")
    op.drop_column("venues", "profile_version")
    for name in reversed(ENUMS):
        postgresql.ENUM(name=name).drop(op.get_bind())
    _replace_facility_enum(LEGACY_FACILITY_CODES, "0010")
