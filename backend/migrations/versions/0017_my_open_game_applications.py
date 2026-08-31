"""index registrations for the authenticated applicant list

Revision ID: 0017
Revises: 0016
Create Date: 2026-08-30
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0017"
down_revision: str | Sequence[str] | None = "0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index(
        "ix_open_game_registrations_applicant_applied",
        "open_game_registrations",
        ["applicant_user_id", "applied_at", "id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_open_game_registrations_applicant_applied",
        table_name="open_game_registrations",
    )
