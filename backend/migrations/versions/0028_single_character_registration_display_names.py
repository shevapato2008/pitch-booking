"""allow single-character direct-signup display names

Revision ID: 0028
Revises: 0027
Create Date: 2026-09-02
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0028"
down_revision: str | Sequence[str] | None = "0027"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_CONSTRAINT_NAME = "ck_open_game_registrations_display_name"
_DIRECT_SIGNUP_ONE_TO_TWENTY_FOUR = (
    "length(display_name) BETWEEN 1 AND 24 "
    "AND display_name = trim(display_name) "
    "AND (status != 'APPLIED' OR length(display_name) >= 2)"
)
_TWO_TO_TWENTY_FOUR = (
    "length(display_name) BETWEEN 2 AND 24 "
    "AND display_name = trim(display_name)"
)


def _replace_display_name_constraint(expression: str) -> None:
    op.drop_constraint(
        _CONSTRAINT_NAME,
        "open_game_registrations",
        type_="check",
    )
    op.create_check_constraint(
        _CONSTRAINT_NAME,
        "open_game_registrations",
        expression,
    )


def upgrade() -> None:
    _replace_display_name_constraint(_DIRECT_SIGNUP_ONE_TO_TWENTY_FOUR)


def downgrade() -> None:
    bind = op.get_bind()
    has_single_character_name = bind.execute(
        sa.text(
            "SELECT EXISTS (SELECT 1 FROM open_game_registrations "
            "WHERE length(display_name) < 2)"
        )
    ).scalar_one()
    if has_single_character_name:
        raise RuntimeError(
            "cannot downgrade 0028 while single-character registration names exist"
        )
    _replace_display_name_constraint(_TWO_TO_TWENTY_FOUR)
