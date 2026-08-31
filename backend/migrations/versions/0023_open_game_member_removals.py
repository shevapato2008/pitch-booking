"""persist captain member removals

Revision ID: 0023
Revises: 0022
Create Date: 2026-09-01
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0023"
down_revision: str | Sequence[str] | None = "0022"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_DECISION_PAIR = (
    "(status = 'APPLIED' AND decided_at IS NULL "
    "AND decided_by_user_id IS NULL) OR "
    "(status IN ('WAITLISTED', 'JOINED', 'REJECTED', 'REMOVED') "
    "AND decided_at IS NOT NULL AND decided_by_user_id IS NOT NULL) OR "
    "(status = 'WITHDRAWN' AND withdrawal_kind = 'APPLICATION_WITHDRAWAL' "
    "AND decided_at IS NULL AND decided_by_user_id IS NULL) OR "
    "(status = 'WITHDRAWN' "
    "AND withdrawal_kind IN ('WAITLIST_WITHDRAWAL', 'GAME_EXIT') "
    "AND decided_at IS NOT NULL AND decided_by_user_id IS NOT NULL)"
)
_WITHDRAWAL_PAIR = (
    "(status IN ('APPLIED', 'WAITLISTED', 'JOINED', 'REJECTED', 'REMOVED') "
    "AND withdrawn_at IS NULL AND withdrawal_kind IS NULL "
    "AND late_exit_recorded = false) OR "
    "(status = 'WITHDRAWN' AND withdrawn_at IS NOT NULL "
    "AND withdrawal_kind IS NOT NULL "
    "AND (withdrawal_kind = 'GAME_EXIT' OR late_exit_recorded = false))"
)
_WAITLIST_HISTORY = (
    "(status IN ('APPLIED', 'REJECTED') "
    "AND waitlist_seq IS NULL AND waitlisted_at IS NULL "
    "AND promoted_at IS NULL) OR "
    "(status = 'WAITLISTED' AND waitlist_seq IS NOT NULL "
    "AND waitlisted_at IS NOT NULL AND promoted_at IS NULL) OR "
    "(status IN ('JOINED', 'REMOVED') AND ((waitlist_seq IS NULL "
    "AND waitlisted_at IS NULL AND promoted_at IS NULL) OR "
    "(waitlist_seq IS NOT NULL AND waitlisted_at IS NOT NULL "
    "AND promoted_at IS NOT NULL))) OR "
    "(status = 'WITHDRAWN' "
    "AND withdrawal_kind = 'APPLICATION_WITHDRAWAL' "
    "AND waitlist_seq IS NULL AND waitlisted_at IS NULL "
    "AND promoted_at IS NULL) OR "
    "(status = 'WITHDRAWN' "
    "AND withdrawal_kind = 'WAITLIST_WITHDRAWAL' "
    "AND waitlist_seq IS NOT NULL AND waitlisted_at IS NOT NULL "
    "AND promoted_at IS NULL) OR "
    "(status = 'WITHDRAWN' AND withdrawal_kind = 'GAME_EXIT' AND "
    "((waitlist_seq IS NULL AND waitlisted_at IS NULL "
    "AND promoted_at IS NULL) OR "
    "(waitlist_seq IS NOT NULL AND waitlisted_at IS NOT NULL "
    "AND promoted_at IS NOT NULL)))"
)
_REMOVAL_PAIR = (
    "(status = 'REMOVED' AND removed_at IS NOT NULL "
    "AND removed_by_user_id IS NOT NULL) OR "
    "(status != 'REMOVED' AND removed_at IS NULL "
    "AND removed_by_user_id IS NULL)"
)
_REMOVAL_TIME = (
    "removed_at IS NULL OR (removed_at >= decided_at "
    "AND (promoted_at IS NULL OR removed_at >= promoted_at))"
)

_OLD_DECISION_PAIR = _DECISION_PAIR.replace(
    "'WAITLISTED', 'JOINED', 'REJECTED', 'REMOVED'",
    "'WAITLISTED', 'JOINED', 'REJECTED'",
)
_OLD_WITHDRAWAL_PAIR = _WITHDRAWAL_PAIR.replace(
    "'APPLIED', 'WAITLISTED', 'JOINED', 'REJECTED', 'REMOVED'",
    "'APPLIED', 'WAITLISTED', 'JOINED', 'REJECTED'",
)
_OLD_WAITLIST_HISTORY = _WAITLIST_HISTORY.replace(
    "status IN ('JOINED', 'REMOVED')", "status = 'JOINED'"
)
_ATTENDANCE_JOINED = "attendance_status = 'UNMARKED' OR status = 'JOINED'"


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(
            "ALTER TYPE open_game_registration_status "
            "ADD VALUE IF NOT EXISTS 'REMOVED'"
        )

    op.add_column(
        "open_game_registrations",
        sa.Column("removed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "open_game_registrations",
        sa.Column(
            "removed_by_user_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )
    op.create_foreign_key(
        "fk_open_game_registrations_removed_by_user_id_users",
        "open_game_registrations",
        "users",
        ["removed_by_user_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    for name in (
        "ck_open_game_registrations_decision_pair",
        "ck_open_game_registrations_withdrawal_pair",
        "ck_open_game_registrations_waitlist_history",
    ):
        op.drop_constraint(name, "open_game_registrations", type_="check")
    for name, condition in (
        ("ck_open_game_registrations_decision_pair", _DECISION_PAIR),
        ("ck_open_game_registrations_withdrawal_pair", _WITHDRAWAL_PAIR),
        ("ck_open_game_registrations_waitlist_history", _WAITLIST_HISTORY),
        ("ck_open_game_registrations_removal_pair", _REMOVAL_PAIR),
        ("ck_open_game_registrations_removal_time", _REMOVAL_TIME),
    ):
        op.create_check_constraint(name, "open_game_registrations", condition)

    op.create_table(
        "open_game_member_removals",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("registration_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("game_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("order_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("removed_by_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("reason", sa.String(length=120), nullable=False),
        sa.Column("removed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("registration_version_before", sa.Integer(), nullable=False),
        sa.Column("registration_version_after", sa.Integer(), nullable=False),
        sa.Column(
            "promoted_registration_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column(
            "promoted_registration_version_before", sa.Integer(), nullable=True
        ),
        sa.Column(
            "promoted_registration_version_after", sa.Integer(), nullable=True
        ),
        sa.Column("idempotency_key", sa.String(length=128), nullable=False),
        sa.Column("request_sha256", sa.String(length=64), nullable=False),
        sa.CheckConstraint(
            "length(reason) BETWEEN 1 AND 120 AND reason = trim(reason)",
            name="ck_open_game_member_removals_reason",
        ),
        sa.CheckConstraint(
            "registration_version_before >= 1 AND "
            "registration_version_after = registration_version_before + 1",
            name="ck_open_game_member_removals_registration_version",
        ),
        sa.CheckConstraint(
            "(promoted_registration_id IS NULL "
            "AND promoted_registration_version_before IS NULL "
            "AND promoted_registration_version_after IS NULL) OR "
            "(promoted_registration_id IS NOT NULL "
            "AND promoted_registration_id != registration_id "
            "AND promoted_registration_version_before IS NOT NULL "
            "AND promoted_registration_version_after IS NOT NULL "
            "AND promoted_registration_version_before >= 1 "
            "AND promoted_registration_version_after = "
            "promoted_registration_version_before + 1)",
            name="ck_open_game_member_removals_promotion_pair",
        ),
        sa.CheckConstraint(
            "length(idempotency_key) BETWEEN 16 AND 128",
            name="ck_open_game_member_removals_idempotency_key",
        ),
        sa.CheckConstraint(
            "request_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_open_game_member_removals_request_sha256",
        ),
        sa.ForeignKeyConstraint(
            ["registration_id"],
            ["open_game_registrations.id"],
            name="fk_member_removals_registration",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["game_id"],
            ["open_games.id"],
            name="fk_member_removals_game",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["order_id"],
            ["orders.id"],
            name="fk_member_removals_order",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["removed_by_user_id"],
            ["users.id"],
            name="fk_member_removals_removed_by_user",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["promoted_registration_id"],
            ["open_game_registrations.id"],
            name="fk_member_removals_promoted_registration",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_open_game_member_removals"),
        sa.UniqueConstraint(
            "registration_id", name="uq_open_game_member_removals_registration"
        ),
        sa.UniqueConstraint(
            "removed_by_user_id",
            "idempotency_key",
            name="uq_open_game_member_removals_actor_idempotency_key",
        ),
    )
    op.create_index(
        "ix_open_game_member_removals_game_removed",
        "open_game_member_removals",
        ["game_id", "removed_at", "id"],
    )
    op.execute(
        """
        CREATE FUNCTION enforce_open_game_member_removals_append_only()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            RAISE EXCEPTION 'member removal history is append-only'
                USING ERRCODE = '23514',
                      CONSTRAINT = 'ck_open_game_member_removals_append_only';
        END;
        $$
        """
    )
    op.execute(
        "CREATE TRIGGER trg_open_game_member_removals_append_only "
        "BEFORE UPDATE OR DELETE ON open_game_member_removals "
        "FOR EACH ROW EXECUTE FUNCTION "
        "enforce_open_game_member_removals_append_only()"
    )


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(
        sa.text(
            "LOCK TABLE open_game_member_removals, open_game_registrations "
            "IN ACCESS EXCLUSIVE MODE"
        )
    )
    has_history = bind.execute(
        sa.text(
            "SELECT EXISTS (SELECT 1 FROM open_game_member_removals) OR "
            "EXISTS (SELECT 1 FROM open_game_registrations "
            "WHERE status = 'REMOVED' OR removed_at IS NOT NULL "
            "OR removed_by_user_id IS NOT NULL)"
        )
    ).scalar_one()
    if has_history:
        raise RuntimeError("cannot downgrade 0023 while member removal history exists")

    op.execute(
        "DROP TRIGGER trg_open_game_member_removals_append_only "
        "ON open_game_member_removals"
    )
    op.execute("DROP FUNCTION enforce_open_game_member_removals_append_only()")
    op.drop_index(
        "ix_open_game_member_removals_game_removed",
        table_name="open_game_member_removals",
    )
    op.drop_table("open_game_member_removals")

    for name in (
        "ck_open_game_registrations_removal_time",
        "ck_open_game_registrations_removal_pair",
        "ck_open_game_registrations_waitlist_history",
        "ck_open_game_registrations_withdrawal_pair",
        "ck_open_game_registrations_decision_pair",
        "ck_open_game_registrations_attendance_joined",
    ):
        op.drop_constraint(name, "open_game_registrations", type_="check")
    op.drop_constraint(
        "fk_open_game_registrations_removed_by_user_id_users",
        "open_game_registrations",
        type_="foreignkey",
    )
    op.drop_column("open_game_registrations", "removed_by_user_id")
    op.drop_column("open_game_registrations", "removed_at")
    op.drop_index(
        "ix_open_game_registrations_pending",
        table_name="open_game_registrations",
    )
    op.drop_index(
        "ix_open_game_registrations_active_waitlist",
        table_name="open_game_registrations",
    )
    op.execute(
        "ALTER TYPE open_game_registration_status "
        "RENAME TO open_game_registration_status_0023_old"
    )
    op.execute(
        "CREATE TYPE open_game_registration_status AS ENUM "
        "('APPLIED', 'WAITLISTED', 'JOINED', 'REJECTED', 'WITHDRAWN')"
    )
    op.execute(
        "ALTER TABLE open_game_registrations ALTER COLUMN status TYPE "
        "open_game_registration_status USING "
        "status::text::open_game_registration_status"
    )
    op.execute("DROP TYPE open_game_registration_status_0023_old")
    for name, condition in (
        ("ck_open_game_registrations_decision_pair", _OLD_DECISION_PAIR),
        ("ck_open_game_registrations_withdrawal_pair", _OLD_WITHDRAWAL_PAIR),
        ("ck_open_game_registrations_waitlist_history", _OLD_WAITLIST_HISTORY),
        ("ck_open_game_registrations_attendance_joined", _ATTENDANCE_JOINED),
    ):
        op.create_check_constraint(name, "open_game_registrations", condition)
    op.create_index(
        "ix_open_game_registrations_pending",
        "open_game_registrations",
        ["game_id", "status", "applied_at", "id"],
        postgresql_where=sa.text("status = 'APPLIED'"),
    )
    op.create_index(
        "ix_open_game_registrations_active_waitlist",
        "open_game_registrations",
        ["game_id", "status", "waitlist_seq"],
        postgresql_where=sa.text("status = 'WAITLISTED'"),
    )
