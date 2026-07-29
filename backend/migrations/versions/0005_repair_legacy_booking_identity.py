"""repair legacy booking identity schema

Revision ID: 0005
Revises: 0004
Create Date: 2026-07-29

"""

import os
from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0005"
down_revision: str | Sequence[str] | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_DEVELOPMENT_APP_ID = "development"
_SAFE_MISSING_IDENTITY_ERROR = (
    "legacy user identity migration requires configured application identity"
)


def _backfill_app_id() -> str:
    configured = os.environ.get("WECHAT_APP_ID", "").strip()
    if configured:
        if len(configured) > 128:
            raise RuntimeError(_SAFE_MISSING_IDENTITY_ERROR)
        return configured
    app_env = os.environ.get("APP_ENV", "").strip().lower()
    if app_env in {"development", "test"}:
        return _DEVELOPMENT_APP_ID
    raise RuntimeError(_SAFE_MISSING_IDENTITY_ERROR)


def _column_catalog(bind: sa.Connection) -> dict[str, Any]:
    return {
        str(column["name"]): column
        for column in sa.inspect(bind).get_columns("users")
    }


def _unique_constraint_names(bind: sa.Connection) -> set[str]:
    return {
        str(constraint["name"])
        for constraint in sa.inspect(bind).get_unique_constraints("users")
        if constraint["name"] is not None
    }


def upgrade() -> None:
    """Forward-repair databases whose already-applied 0002 lacked app scoping."""
    bind = op.get_bind()
    columns = _column_catalog(bind)
    if "wechat_app_id" not in columns:
        op.add_column(
            "users",
            sa.Column("wechat_app_id", sa.String(length=128), nullable=True),
        )
        columns = _column_catalog(bind)

    null_app_id_count = bind.scalar(
        sa.text("SELECT count(*) FROM users WHERE wechat_app_id IS NULL")
    )
    if null_app_id_count:
        bind.execute(
            sa.text(
                "UPDATE users SET wechat_app_id = :app_id "
                "WHERE wechat_app_id IS NULL"
            ),
            {"app_id": _backfill_app_id()},
        )

    if bool(columns["wechat_app_id"]["nullable"]):
        op.alter_column(
            "users",
            "wechat_app_id",
            existing_type=sa.String(length=128),
            nullable=False,
        )

    constraints = _unique_constraint_names(bind)
    if "uq_users_wechat_openid" in constraints:
        op.drop_constraint("uq_users_wechat_openid", "users", type_="unique")
        constraints.remove("uq_users_wechat_openid")
    if "uq_users_wechat_app_openid" not in constraints:
        op.create_unique_constraint(
            "uq_users_wechat_app_openid",
            "users",
            ["wechat_app_id", "wechat_openid"],
        )


def downgrade() -> None:
    """Keep the repaired identity contract required by the current 0004 runtime."""
    # This is a corrective migration for drift caused by rewritten history. The
    # repository's 0004 contract already includes this column and constraint, so
    # removing them would recreate the production-breaking legacy schema.
    pass
