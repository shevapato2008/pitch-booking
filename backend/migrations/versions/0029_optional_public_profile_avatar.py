"""allow confirmed public profiles without avatars

Revision ID: 0029
Revises: 0028
Create Date: 2026-09-02
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0029"
down_revision: str | Sequence[str] | None = "0028"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_CONSTRAINT_NAME = "ck_users_public_profile_pair"
_OPTIONAL_AVATAR_PROFILE = (
    "(public_nickname IS NULL AND public_avatar_object_key IS NULL "
    "AND public_profile_updated_at IS NULL AND public_profile_version = 0) OR "
    "(public_nickname IS NOT NULL AND public_profile_updated_at IS NOT NULL "
    "AND public_profile_version >= 1)"
)
_REQUIRED_AVATAR_PROFILE = (
    "(public_nickname IS NULL AND public_avatar_object_key IS NULL "
    "AND public_profile_updated_at IS NULL AND public_profile_version = 0) OR "
    "(public_nickname IS NOT NULL AND public_avatar_object_key IS NOT NULL "
    "AND public_profile_updated_at IS NOT NULL AND public_profile_version >= 1)"
)


def _replace_profile_constraint(expression: str) -> None:
    op.drop_constraint(_CONSTRAINT_NAME, "users", type_="check")
    op.create_check_constraint(_CONSTRAINT_NAME, "users", expression)


def upgrade() -> None:
    _replace_profile_constraint(_OPTIONAL_AVATAR_PROFILE)


def downgrade() -> None:
    bind = op.get_bind()
    has_avatarless_confirmed_profile = bind.execute(
        sa.text(
            "SELECT EXISTS (SELECT 1 FROM users "
            "WHERE public_profile_version >= 1 "
            "AND public_avatar_object_key IS NULL)"
        )
    ).scalar_one()
    if has_avatarless_confirmed_profile:
        raise RuntimeError(
            "cannot downgrade 0029 while avatarless confirmed public profiles exist"
        )
    _replace_profile_constraint(_REQUIRED_AVATAR_PROFILE)
