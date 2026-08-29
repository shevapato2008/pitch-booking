"""persist open game registration withdrawals

Revision ID: 0018
Revises: 0017
Create Date: 2026-08-30
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0018"
down_revision: str | Sequence[str] | None = "0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_DECISION_PAIR = (
    "(status = 'APPLIED' AND decided_at IS NULL "
    "AND decided_by_user_id IS NULL) OR "
    "(status IN ('JOINED', 'REJECTED') AND decided_at IS NOT NULL "
    "AND decided_by_user_id IS NOT NULL) OR "
    "(status = 'WITHDRAWN' AND withdrawal_kind = 'APPLICATION_WITHDRAWAL' "
    "AND decided_at IS NULL AND decided_by_user_id IS NULL) OR "
    "(status = 'WITHDRAWN' AND withdrawal_kind = 'GAME_EXIT' "
    "AND decided_at IS NOT NULL AND decided_by_user_id IS NOT NULL)"
)
_WITHDRAWAL_PAIR = (
    "(status IN ('APPLIED', 'JOINED', 'REJECTED') "
    "AND withdrawn_at IS NULL AND withdrawal_kind IS NULL "
    "AND late_exit_recorded = false) OR "
    "(status = 'WITHDRAWN' AND withdrawn_at IS NOT NULL "
    "AND withdrawal_kind IS NOT NULL "
    "AND (withdrawal_kind = 'GAME_EXIT' OR late_exit_recorded = false))"
)
_WITHDRAWAL_TIME = (
    "(withdrawn_at IS NULL OR withdrawn_at >= applied_at) AND "
    "(withdrawal_kind != 'GAME_EXIT' OR withdrawn_at >= decided_at)"
)
_OLD_DECISION_PAIR = (
    "(status = 'APPLIED' AND decided_at IS NULL "
    "AND decided_by_user_id IS NULL) OR "
    "(status IN ('JOINED', 'REJECTED') AND decided_at IS NOT NULL "
    "AND decided_by_user_id IS NOT NULL)"
)


def _drop_status_dependencies() -> None:
    op.drop_index(
        "ix_open_game_registrations_pending",
        table_name="open_game_registrations",
    )
    op.drop_constraint(
        "ck_open_game_registrations_decision_pair",
        "open_game_registrations",
        type_="check",
    )


def _create_pending_index() -> None:
    op.create_index(
        "ix_open_game_registrations_pending",
        "open_game_registrations",
        ["game_id", "status", "applied_at", "id"],
        unique=False,
        postgresql_where=sa.text("status = 'APPLIED'"),
    )


def upgrade() -> None:
    _drop_status_dependencies()
    op.execute(
        "ALTER TABLE open_game_registrations "
        "ALTER COLUMN status TYPE text USING status::text"
    )
    op.execute("DROP TYPE open_game_registration_status")
    op.execute(
        "CREATE TYPE open_game_registration_status AS ENUM "
        "('APPLIED', 'JOINED', 'REJECTED', 'WITHDRAWN')"
    )
    op.execute(
        "ALTER TABLE open_game_registrations ALTER COLUMN status "
        "TYPE open_game_registration_status "
        "USING status::open_game_registration_status"
    )

    op.execute(
        "CREATE TYPE open_game_registration_withdrawal_kind AS ENUM "
        "('APPLICATION_WITHDRAWAL', 'GAME_EXIT')"
    )
    withdrawal_kind = postgresql.ENUM(
        "APPLICATION_WITHDRAWAL",
        "GAME_EXIT",
        name="open_game_registration_withdrawal_kind",
        create_type=False,
    )
    op.add_column(
        "open_game_registrations",
        sa.Column("withdrawn_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "open_game_registrations",
        sa.Column("withdrawal_kind", withdrawal_kind, nullable=True),
    )
    op.add_column(
        "open_game_registrations",
        sa.Column(
            "late_exit_recorded",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )
    op.create_check_constraint(
        "ck_open_game_registrations_decision_pair",
        "open_game_registrations",
        _DECISION_PAIR,
    )
    op.create_check_constraint(
        "ck_open_game_registrations_withdrawal_pair",
        "open_game_registrations",
        _WITHDRAWAL_PAIR,
    )
    op.create_check_constraint(
        "ck_open_game_registrations_withdrawal_time",
        "open_game_registrations",
        _WITHDRAWAL_TIME,
    )
    _create_pending_index()


def downgrade() -> None:
    withdrawn_count = op.get_bind().execute(
        sa.text(
            "SELECT count(*) FROM open_game_registrations "
            "WHERE status = 'WITHDRAWN'"
        )
    ).scalar_one()
    if withdrawn_count:
        raise RuntimeError(
            "cannot downgrade 0018 while WITHDRAWN registrations exist"
        )

    op.drop_index(
        "ix_open_game_registrations_pending",
        table_name="open_game_registrations",
    )
    op.drop_constraint(
        "ck_open_game_registrations_withdrawal_time",
        "open_game_registrations",
        type_="check",
    )
    op.drop_constraint(
        "ck_open_game_registrations_withdrawal_pair",
        "open_game_registrations",
        type_="check",
    )
    op.drop_constraint(
        "ck_open_game_registrations_decision_pair",
        "open_game_registrations",
        type_="check",
    )
    op.execute(
        "ALTER TABLE open_game_registrations "
        "ALTER COLUMN status TYPE text USING status::text"
    )
    op.execute("DROP TYPE open_game_registration_status")
    op.execute(
        "CREATE TYPE open_game_registration_status AS ENUM "
        "('APPLIED', 'JOINED', 'REJECTED')"
    )
    op.execute(
        "ALTER TABLE open_game_registrations ALTER COLUMN status "
        "TYPE open_game_registration_status "
        "USING status::open_game_registration_status"
    )

    op.drop_column("open_game_registrations", "late_exit_recorded")
    op.drop_column("open_game_registrations", "withdrawal_kind")
    op.drop_column("open_game_registrations", "withdrawn_at")
    op.execute("DROP TYPE open_game_registration_withdrawal_kind")
    op.create_check_constraint(
        "ck_open_game_registrations_decision_pair",
        "open_game_registrations",
        _OLD_DECISION_PAIR,
    )
    _create_pending_index()
