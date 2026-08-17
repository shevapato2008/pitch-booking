"""add independent platform staff sessions

Revision ID: 0012
Revises: 0011
Create Date: 2026-08-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012"
down_revision: str | Sequence[str] | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "platform_sessions",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("principal_id", sa.String(length=128), nullable=False),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "token_hash ~ '^[0-9a-f]{64}$'",
            name="ck_platform_sessions_token_hash",
        ),
        sa.CheckConstraint(
            "length(trim(principal_id)) BETWEEN 1 AND 128",
            name="ck_platform_sessions_principal_id",
        ),
        sa.CheckConstraint(
            "expires_at > issued_at",
            name="ck_platform_sessions_expiry",
        ),
        sa.CheckConstraint(
            "revoked_at IS NULL OR revoked_at >= issued_at",
            name="ck_platform_sessions_revoked_at",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_platform_sessions"),
        sa.UniqueConstraint(
            "token_hash",
            name="uq_platform_sessions_token_hash",
        ),
    )
    op.create_index(
        "ix_platform_sessions_principal_id",
        "platform_sessions",
        ["principal_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_platform_sessions_principal_id",
        table_name="platform_sessions",
    )
    op.drop_table("platform_sessions")
