"""persist open game attendance

Revision ID: 0021
Revises: 0020
Create Date: 2026-08-31
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0021"
down_revision: str | Sequence[str] | None = "0020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_ATTENDANCE_AUDIT = (
    "(attendance_status = 'UNMARKED' "
    "AND attendance_recorded_at IS NULL "
    "AND attendance_recorded_by_user_id IS NULL) OR "
    "(attendance_status IN ('PRESENT', 'NO_SHOW') "
    "AND attendance_recorded_at IS NOT NULL "
    "AND attendance_recorded_by_user_id IS NOT NULL)"
)
_ATTENDANCE_JOINED = (
    "attendance_status = 'UNMARKED' OR status = 'JOINED'"
)


def upgrade() -> None:
    op.execute(
        "CREATE TYPE open_game_attendance_status AS ENUM "
        "('UNMARKED', 'PRESENT', 'NO_SHOW')"
    )
    attendance_status = postgresql.ENUM(
        "UNMARKED",
        "PRESENT",
        "NO_SHOW",
        name="open_game_attendance_status",
        create_type=False,
    )
    op.add_column(
        "open_game_registrations",
        sa.Column(
            "attendance_status",
            attendance_status,
            server_default=sa.text("'UNMARKED'"),
            nullable=False,
        ),
    )
    op.add_column(
        "open_game_registrations",
        sa.Column(
            "attendance_recorded_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    op.add_column(
        "open_game_registrations",
        sa.Column(
            "attendance_recorded_by_user_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )
    op.create_foreign_key(
        "fk_open_game_registrations_attendance_recorded_by_user_id_users",
        "open_game_registrations",
        "users",
        ["attendance_recorded_by_user_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_check_constraint(
        "ck_open_game_registrations_attendance_audit",
        "open_game_registrations",
        _ATTENDANCE_AUDIT,
    )
    op.create_check_constraint(
        "ck_open_game_registrations_attendance_joined",
        "open_game_registrations",
        _ATTENDANCE_JOINED,
    )


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(
        sa.text(
            "LOCK TABLE open_game_registrations IN ACCESS EXCLUSIVE MODE"
        )
    )
    has_attendance_history = bind.execute(
        sa.text(
            "SELECT EXISTS (SELECT 1 FROM open_game_registrations "
            "WHERE attendance_status != 'UNMARKED' "
            "OR attendance_recorded_at IS NOT NULL "
            "OR attendance_recorded_by_user_id IS NOT NULL)"
        )
    ).scalar_one()
    if has_attendance_history:
        raise RuntimeError(
            "cannot downgrade 0021 while attendance history exists"
        )

    op.drop_constraint(
        "ck_open_game_registrations_attendance_joined",
        "open_game_registrations",
        type_="check",
    )
    op.drop_constraint(
        "ck_open_game_registrations_attendance_audit",
        "open_game_registrations",
        type_="check",
    )
    op.drop_constraint(
        "fk_open_game_registrations_attendance_recorded_by_user_id_users",
        "open_game_registrations",
        type_="foreignkey",
    )
    op.drop_column(
        "open_game_registrations",
        "attendance_recorded_by_user_id",
    )
    op.drop_column(
        "open_game_registrations",
        "attendance_recorded_at",
    )
    op.drop_column("open_game_registrations", "attendance_status")
    op.execute("DROP TYPE open_game_attendance_status")
