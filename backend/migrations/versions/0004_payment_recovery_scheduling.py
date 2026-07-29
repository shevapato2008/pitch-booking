"""separate payment recovery scheduling from worker claims

Revision ID: 0004
Revises: 0003
Create Date: 2026-07-29

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0004"
down_revision: str | Sequence[str] | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Persist worker ownership and first-expiry reconciliation independently."""
    op.add_column(
        "payments",
        sa.Column("reconcile_claim_token", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "payments",
        sa.Column("reconcile_lease_until", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "payments",
        sa.Column("expiry_reconciled_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "payments",
        sa.Column(
            "creation_recovery_pending",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )
    op.create_check_constraint(
        "ck_payments_reconcile_lease_pair",
        "payments",
        "(reconcile_claim_token IS NULL) = (reconcile_lease_until IS NULL)",
    )
    op.create_index(
        "ix_payments_reconcile_lease_until",
        "payments",
        ["reconcile_lease_until"],
        unique=False,
        postgresql_where=sa.text("reconcile_lease_until IS NOT NULL"),
    )


def downgrade() -> None:
    """Remove worker ownership state without rewriting payment authority."""
    op.drop_index("ix_payments_reconcile_lease_until", table_name="payments")
    op.drop_constraint(
        "ck_payments_reconcile_lease_pair",
        "payments",
        type_="check",
    )
    op.drop_column("payments", "creation_recovery_pending")
    op.drop_column("payments", "expiry_reconciled_at")
    op.drop_column("payments", "reconcile_lease_until")
    op.drop_column("payments", "reconcile_claim_token")
