"""persist open game waitlist storage and notification outbox

Revision ID: 0019
Revises: 0018
Create Date: 2026-08-30
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0019"
down_revision: str | Sequence[str] | None = "0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_DECISION_PAIR = (
    "(status = 'APPLIED' AND decided_at IS NULL "
    "AND decided_by_user_id IS NULL) OR "
    "(status IN ('WAITLISTED', 'JOINED', 'REJECTED') "
    "AND decided_at IS NOT NULL AND decided_by_user_id IS NOT NULL) OR "
    "(status = 'WITHDRAWN' "
    "AND withdrawal_kind = 'APPLICATION_WITHDRAWAL' "
    "AND decided_at IS NULL AND decided_by_user_id IS NULL) OR "
    "(status = 'WITHDRAWN' "
    "AND withdrawal_kind IN ('WAITLIST_WITHDRAWAL', 'GAME_EXIT') "
    "AND decided_at IS NOT NULL AND decided_by_user_id IS NOT NULL)"
)
_WITHDRAWAL_PAIR = (
    "(status IN ('APPLIED', 'WAITLISTED', 'JOINED', 'REJECTED') "
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
    "(status = 'JOINED' AND ((waitlist_seq IS NULL "
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
_WAITLIST_TIME = (
    "(waitlisted_at IS NULL OR "
    "(waitlisted_at = decided_at AND waitlisted_at >= applied_at)) AND "
    "(promoted_at IS NULL OR promoted_at >= waitlisted_at)"
)
_WITHDRAWAL_TIME = (
    "withdrawn_at IS NULL OR "
    "(withdrawal_kind = 'APPLICATION_WITHDRAWAL' "
    "AND withdrawn_at >= applied_at) OR "
    "(withdrawal_kind = 'WAITLIST_WITHDRAWAL' "
    "AND withdrawn_at >= waitlisted_at) OR "
    "(withdrawal_kind = 'GAME_EXIT' AND withdrawn_at >= decided_at "
    "AND (promoted_at IS NULL OR withdrawn_at >= promoted_at))"
)

_OLD_DECISION_PAIR = (
    "(status = 'APPLIED' AND decided_at IS NULL "
    "AND decided_by_user_id IS NULL) OR "
    "(status IN ('JOINED', 'REJECTED') AND decided_at IS NOT NULL "
    "AND decided_by_user_id IS NOT NULL) OR "
    "(status = 'WITHDRAWN' AND withdrawal_kind = 'APPLICATION_WITHDRAWAL' "
    "AND decided_at IS NULL AND decided_by_user_id IS NULL) OR "
    "(status = 'WITHDRAWN' AND withdrawal_kind = 'GAME_EXIT' "
    "AND decided_at IS NOT NULL AND decided_by_user_id IS NOT NULL)"
)
_OLD_WITHDRAWAL_PAIR = (
    "(status IN ('APPLIED', 'JOINED', 'REJECTED') "
    "AND withdrawn_at IS NULL AND withdrawal_kind IS NULL "
    "AND late_exit_recorded = false) OR "
    "(status = 'WITHDRAWN' AND withdrawn_at IS NOT NULL "
    "AND withdrawal_kind IS NOT NULL "
    "AND (withdrawal_kind = 'GAME_EXIT' OR late_exit_recorded = false))"
)
_OLD_WITHDRAWAL_TIME = (
    "(withdrawn_at IS NULL OR withdrawn_at >= applied_at) AND "
    "(withdrawal_kind != 'GAME_EXIT' OR withdrawn_at >= decided_at)"
)


def _drop_registration_dependencies() -> None:
    op.drop_index(
        "ix_open_game_registrations_pending",
        table_name="open_game_registrations",
    )
    for name in (
        "ck_open_game_registrations_withdrawal_time",
        "ck_open_game_registrations_withdrawal_pair",
        "ck_open_game_registrations_decision_pair",
    ):
        op.drop_constraint(
            name,
            "open_game_registrations",
            type_="check",
        )


def _create_registration_constraints() -> None:
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
        "ck_open_game_registrations_waitlist_seq",
        "open_game_registrations",
        "waitlist_seq IS NULL OR waitlist_seq > 0",
    )
    op.create_check_constraint(
        "ck_open_game_registrations_waitlist_history",
        "open_game_registrations",
        _WAITLIST_HISTORY,
    )
    op.create_check_constraint(
        "ck_open_game_registrations_waitlist_time",
        "open_game_registrations",
        _WAITLIST_TIME,
    )
    op.create_check_constraint(
        "ck_open_game_registrations_withdrawal_time",
        "open_game_registrations",
        _WITHDRAWAL_TIME,
    )
    op.create_unique_constraint(
        "uq_open_game_registrations_game_waitlist_seq",
        "open_game_registrations",
        ["game_id", "waitlist_seq"],
    )
    op.create_unique_constraint(
        "uq_open_game_registrations_outbox_identity",
        "open_game_registrations",
        ["id", "game_id", "applicant_user_id"],
    )
    op.create_index(
        "ix_open_game_registrations_pending",
        "open_game_registrations",
        ["game_id", "status", "applied_at", "id"],
        unique=False,
        postgresql_where=sa.text("status = 'APPLIED'"),
    )
    op.create_index(
        "ix_open_game_registrations_active_waitlist",
        "open_game_registrations",
        ["game_id", "status", "waitlist_seq"],
        unique=False,
        postgresql_where=sa.text("status = 'WAITLISTED'"),
    )


def _create_outbox() -> None:
    op.execute(
        "CREATE TYPE open_game_notification_event AS ENUM "
        "('WAITLIST_PROMOTED')"
    )
    op.execute(
        "CREATE TYPE open_game_notification_status AS ENUM "
        "('PENDING', 'CLAIMED', 'SENT', 'FAILED', 'SUPERSEDED')"
    )
    event_type = postgresql.ENUM(
        "WAITLIST_PROMOTED",
        name="open_game_notification_event",
        create_type=False,
    )
    status_type = postgresql.ENUM(
        "PENDING",
        "CLAIMED",
        "SENT",
        "FAILED",
        "SUPERSEDED",
        name="open_game_notification_status",
        create_type=False,
    )
    op.create_table(
        "open_game_notification_outbox",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("dedupe_key", sa.String(length=200), nullable=False),
        sa.Column("game_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "registration_id", postgresql.UUID(as_uuid=True), nullable=False
        ),
        sa.Column(
            "recipient_user_id", postgresql.UUID(as_uuid=True), nullable=False
        ),
        sa.Column("event", event_type, nullable=False),
        sa.Column("template_key", sa.String(length=64), nullable=False),
        sa.Column("status", status_type, nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("available_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("claim_token", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("lease_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_failure_code", sa.String(length=64), nullable=True),
        sa.CheckConstraint(
            "length(trim(dedupe_key)) > 0",
            name="ck_open_game_notification_outbox_dedupe_key",
        ),
        sa.CheckConstraint(
            "length(trim(template_key)) > 0",
            name="ck_open_game_notification_outbox_template_key",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(payload) = 'object'",
            name="ck_open_game_notification_outbox_payload_object",
        ),
        sa.CheckConstraint(
            "event = 'WAITLIST_PROMOTED' AND "
            "payload ?& ARRAY['game_name', 'starts_at', 'venue_name'] AND "
            "payload - ARRAY['game_name', 'starts_at', 'venue_name'] "
            "= '{}'::jsonb AND "
            "jsonb_typeof(payload -> 'game_name') = 'string' AND "
            "length(trim(payload ->> 'game_name')) > 0 AND "
            "jsonb_typeof(payload -> 'starts_at') = 'string' AND "
            "length(trim(payload ->> 'starts_at')) > 0 AND "
            "jsonb_typeof(payload -> 'venue_name') = 'string' AND "
            "length(trim(payload ->> 'venue_name')) > 0",
            name="ck_open_game_notification_outbox_payload_waitlist_promoted",
        ),
        sa.CheckConstraint(
            "attempt_count >= 0",
            name="ck_open_game_notification_outbox_attempt_count",
        ),
        sa.CheckConstraint(
            "((status = 'CLAIMED' AND claim_token IS NOT NULL "
            "AND lease_until IS NOT NULL) OR "
            "(status != 'CLAIMED' AND claim_token IS NULL "
            "AND lease_until IS NULL))",
            name="ck_open_game_notification_outbox_claim_lease",
        ),
        sa.CheckConstraint(
            "((status IN ('SENT', 'FAILED', 'SUPERSEDED') "
            "AND completed_at IS NOT NULL) OR "
            "(status IN ('PENDING', 'CLAIMED') AND completed_at IS NULL))",
            name="ck_open_game_notification_outbox_completion",
        ),
        sa.CheckConstraint(
            "(last_failure_code IS NULL OR "
            "length(trim(last_failure_code)) > 0) AND "
            "(status != 'FAILED' OR last_failure_code IS NOT NULL)",
            name="ck_open_game_notification_outbox_failure_code",
        ),
        sa.ForeignKeyConstraint(
            ["game_id"],
            ["open_games.id"],
            name="fk_open_game_notification_outbox_game_id_open_games",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["registration_id"],
            ["open_game_registrations.id"],
            name="fk_open_game_notification_outbox_registration",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["recipient_user_id"],
            ["users.id"],
            name="fk_open_game_notification_outbox_recipient_user_id_users",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["registration_id", "game_id", "recipient_user_id"],
            [
                "open_game_registrations.id",
                "open_game_registrations.game_id",
                "open_game_registrations.applicant_user_id",
            ],
            name="fk_open_game_notification_outbox_registration_identity",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_open_game_notification_outbox"),
        sa.UniqueConstraint(
            "dedupe_key",
            name="uq_open_game_notification_outbox_dedupe_key",
        ),
    )
    op.create_index(
        "ix_open_game_notification_outbox_due",
        "open_game_notification_outbox",
        ["available_at", "id"],
        unique=False,
        postgresql_where=sa.text("status = 'PENDING'"),
    )


def upgrade() -> None:
    _drop_registration_dependencies()
    op.execute(
        "ALTER TABLE open_game_registrations "
        "ALTER COLUMN status TYPE text USING status::text"
    )
    op.execute(
        "ALTER TABLE open_game_registrations "
        "ALTER COLUMN withdrawal_kind TYPE text USING withdrawal_kind::text"
    )
    op.execute("DROP TYPE open_game_registration_status")
    op.execute("DROP TYPE open_game_registration_withdrawal_kind")
    op.execute(
        "CREATE TYPE open_game_registration_status AS ENUM "
        "('APPLIED', 'WAITLISTED', 'JOINED', 'REJECTED', 'WITHDRAWN')"
    )
    op.execute(
        "CREATE TYPE open_game_registration_withdrawal_kind AS ENUM "
        "('APPLICATION_WITHDRAWAL', 'WAITLIST_WITHDRAWAL', 'GAME_EXIT')"
    )
    op.execute(
        "ALTER TABLE open_game_registrations ALTER COLUMN status "
        "TYPE open_game_registration_status "
        "USING status::open_game_registration_status"
    )
    op.execute(
        "ALTER TABLE open_game_registrations ALTER COLUMN withdrawal_kind "
        "TYPE open_game_registration_withdrawal_kind "
        "USING withdrawal_kind::open_game_registration_withdrawal_kind"
    )
    op.add_column(
        "open_game_registrations",
        sa.Column("waitlist_seq", sa.BigInteger(), nullable=True),
    )
    op.add_column(
        "open_game_registrations",
        sa.Column("waitlisted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "open_game_registrations",
        sa.Column("promoted_at", sa.DateTime(timezone=True), nullable=True),
    )
    _create_registration_constraints()
    _create_outbox()


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(
        sa.text(
            "LOCK TABLE open_game_registrations IN ACCESS EXCLUSIVE MODE"
        )
    )
    bind.execute(
        sa.text(
            "LOCK TABLE open_game_notification_outbox "
            "IN ACCESS EXCLUSIVE MODE"
        )
    )
    has_waitlist_history_or_outbox = bind.execute(
        sa.text(
            "SELECT EXISTS ("
            "SELECT 1 FROM open_game_registrations WHERE "
            "status = 'WAITLISTED' OR "
            "withdrawal_kind = 'WAITLIST_WITHDRAWAL' OR "
            "waitlist_seq IS NOT NULL OR waitlisted_at IS NOT NULL OR "
            "promoted_at IS NOT NULL "
            "UNION ALL "
            "SELECT 1 FROM open_game_notification_outbox"
            ")"
        )
    ).scalar_one()
    if has_waitlist_history_or_outbox:
        raise RuntimeError(
            "cannot downgrade 0019 while waitlist history or outbox rows exist"
        )

    op.drop_index(
        "ix_open_game_notification_outbox_due",
        table_name="open_game_notification_outbox",
    )
    op.drop_table("open_game_notification_outbox")
    op.execute("DROP TYPE open_game_notification_status")
    op.execute("DROP TYPE open_game_notification_event")

    op.drop_index(
        "ix_open_game_registrations_active_waitlist",
        table_name="open_game_registrations",
    )
    op.drop_index(
        "ix_open_game_registrations_pending",
        table_name="open_game_registrations",
    )
    op.drop_constraint(
        "uq_open_game_registrations_game_waitlist_seq",
        "open_game_registrations",
        type_="unique",
    )
    op.drop_constraint(
        "uq_open_game_registrations_outbox_identity",
        "open_game_registrations",
        type_="unique",
    )
    for name in (
        "ck_open_game_registrations_withdrawal_time",
        "ck_open_game_registrations_waitlist_time",
        "ck_open_game_registrations_waitlist_history",
        "ck_open_game_registrations_waitlist_seq",
        "ck_open_game_registrations_withdrawal_pair",
        "ck_open_game_registrations_decision_pair",
    ):
        op.drop_constraint(
            name,
            "open_game_registrations",
            type_="check",
        )

    op.drop_column("open_game_registrations", "promoted_at")
    op.drop_column("open_game_registrations", "waitlisted_at")
    op.drop_column("open_game_registrations", "waitlist_seq")
    op.execute(
        "ALTER TABLE open_game_registrations "
        "ALTER COLUMN status TYPE text USING status::text"
    )
    op.execute(
        "ALTER TABLE open_game_registrations "
        "ALTER COLUMN withdrawal_kind TYPE text USING withdrawal_kind::text"
    )
    op.execute("DROP TYPE open_game_registration_status")
    op.execute("DROP TYPE open_game_registration_withdrawal_kind")
    op.execute(
        "CREATE TYPE open_game_registration_status AS ENUM "
        "('APPLIED', 'JOINED', 'REJECTED', 'WITHDRAWN')"
    )
    op.execute(
        "CREATE TYPE open_game_registration_withdrawal_kind AS ENUM "
        "('APPLICATION_WITHDRAWAL', 'GAME_EXIT')"
    )
    op.execute(
        "ALTER TABLE open_game_registrations ALTER COLUMN status "
        "TYPE open_game_registration_status "
        "USING status::open_game_registration_status"
    )
    op.execute(
        "ALTER TABLE open_game_registrations ALTER COLUMN withdrawal_kind "
        "TYPE open_game_registration_withdrawal_kind "
        "USING withdrawal_kind::open_game_registration_withdrawal_kind"
    )
    op.create_check_constraint(
        "ck_open_game_registrations_decision_pair",
        "open_game_registrations",
        _OLD_DECISION_PAIR,
    )
    op.create_check_constraint(
        "ck_open_game_registrations_withdrawal_pair",
        "open_game_registrations",
        _OLD_WITHDRAWAL_PAIR,
    )
    op.create_check_constraint(
        "ck_open_game_registrations_withdrawal_time",
        "open_game_registrations",
        _OLD_WITHDRAWAL_TIME,
    )
    op.create_index(
        "ix_open_game_registrations_pending",
        "open_game_registrations",
        ["game_id", "status", "applied_at", "id"],
        unique=False,
        postgresql_where=sa.text("status = 'APPLIED'"),
    )
