"""normalize managed venue timezone

Revision ID: 0014
Revises: 0013
Create Date: 2026-08-19
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0014"
down_revision: str | Sequence[str] | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE venues AS venue
        SET timezone = 'Asia/Shanghai'
        WHERE venue.timezone IS DISTINCT FROM 'Asia/Shanghai'
          AND EXISTS (
              SELECT 1
              FROM venue_memberships AS membership
              WHERE membership.venue_id = venue.id
                AND membership.is_active IS TRUE
                AND membership.can_manage_inventory IS TRUE
          )
        """
    )


def downgrade() -> None:
    # Original unsupported values cannot be recovered safely.
    pass
