"""persist immutable open game reports and platform resolutions

Revision ID: 0024
Revises: 0023
Create Date: 2026-09-01
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0024"
down_revision: str | Sequence[str] | None = "0023"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _create_types() -> None:
    op.execute(
        "CREATE TYPE open_game_report_category AS ENUM "
        "('FALSE_INFORMATION', 'EXTRA_CHARGE', 'DANGEROUS_BEHAVIOR', "
        "'HARASSMENT', 'ORGANIZER_NO_SHOW')"
    )
    op.execute(
        "CREATE TYPE open_game_report_resolution_outcome AS ENUM "
        "('DISMISSED', 'CONFIRMED_RECORDED', 'CONFIRMED_GAME_CANCELLED')"
    )
    op.execute("CREATE TYPE open_game_cancellation_source AS ENUM ('CAPTAIN', 'PLATFORM_REPORT')")


def _append_only_trigger(table: str, constraint: str) -> None:
    function = f"enforce_{table}_append_only"
    op.execute(
        f"""
        CREATE FUNCTION {function}()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            RAISE EXCEPTION '{table} is append-only'
                USING ERRCODE = '23514', CONSTRAINT = '{constraint}';
        END;
        $$
        """
    )
    op.execute(
        f"CREATE TRIGGER trg_{table}_append_only "
        f"BEFORE UPDATE OR DELETE ON {table} "
        f"FOR EACH ROW EXECUTE FUNCTION {function}()"
    )


def upgrade() -> None:
    _create_types()
    category = postgresql.ENUM(
        "FALSE_INFORMATION",
        "EXTRA_CHARGE",
        "DANGEROUS_BEHAVIOR",
        "HARASSMENT",
        "ORGANIZER_NO_SHOW",
        name="open_game_report_category",
        create_type=False,
    )
    outcome = postgresql.ENUM(
        "DISMISSED",
        "CONFIRMED_RECORDED",
        "CONFIRMED_GAME_CANCELLED",
        name="open_game_report_resolution_outcome",
        create_type=False,
    )
    cancellation_source = postgresql.ENUM(
        "CAPTAIN",
        "PLATFORM_REPORT",
        name="open_game_cancellation_source",
        create_type=False,
    )

    op.add_column(
        "open_games",
        sa.Column("cancellation_source", cancellation_source, nullable=True),
    )
    op.execute("UPDATE open_games SET cancellation_source = 'CAPTAIN' WHERE status = 'CANCELLED'")
    op.drop_constraint("ck_open_games_status_timestamps", "open_games", type_="check")
    op.create_check_constraint(
        "ck_open_games_status_timestamps",
        "open_games",
        "(status = 'DRAFT' AND published_at IS NULL "
        "AND cancelled_at IS NULL AND cancellation_source IS NULL) OR "
        "(status = 'PUBLISHED' AND published_at IS NOT NULL "
        "AND cancelled_at IS NULL AND cancellation_source IS NULL) OR "
        "(status = 'CANCELLED' AND cancelled_at IS NOT NULL "
        "AND cancellation_source IS NOT NULL "
        "AND (published_at IS NULL OR cancelled_at >= published_at))",
    )
    op.create_check_constraint(
        "ck_open_games_cancellation_source_status",
        "open_games",
        "(status = 'CANCELLED' AND cancelled_at IS NOT NULL "
        "AND cancellation_source IS NOT NULL) OR "
        "(status <> 'CANCELLED' AND cancelled_at IS NULL "
        "AND cancellation_source IS NULL)",
    )

    op.create_table(
        "open_game_reports",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("game_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("reporter_registration_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("reporter_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("organizer_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("category", category, nullable=False),
        sa.Column("facts", sa.String(length=500), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("idempotency_key", sa.String(length=128), nullable=False),
        sa.Column("request_sha256", sa.String(length=64), nullable=False),
        sa.CheckConstraint(
            "length(facts) BETWEEN 1 AND 500 AND facts = btrim(facts)",
            name="ck_open_game_reports_facts",
        ),
        sa.CheckConstraint(
            "length(idempotency_key) BETWEEN 16 AND 128",
            name="ck_open_game_reports_idempotency_key",
        ),
        sa.CheckConstraint(
            "request_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_open_game_reports_request_sha256",
        ),
        sa.ForeignKeyConstraint(
            ["game_id"],
            ["open_games.id"],
            name="fk_open_game_reports_game",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["reporter_registration_id", "game_id", "reporter_user_id"],
            [
                "open_game_registrations.id",
                "open_game_registrations.game_id",
                "open_game_registrations.applicant_user_id",
            ],
            name="fk_open_game_reports_reporter_registration_identity",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organizer_user_id"],
            ["users.id"],
            name="fk_open_game_reports_organizer_user",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_open_game_reports"),
        sa.UniqueConstraint(
            "game_id", "reporter_user_id", name="uq_open_game_reports_game_reporter"
        ),
        sa.UniqueConstraint(
            "reporter_user_id",
            "idempotency_key",
            name="uq_open_game_reports_reporter_idempotency_key",
        ),
    )
    op.create_index(
        "ix_open_game_reports_submitted",
        "open_game_reports",
        [sa.text("submitted_at DESC"), sa.text("id DESC")],
    )

    op.create_table(
        "open_game_report_resolutions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("report_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("outcome", outcome, nullable=False),
        sa.Column("resolution_note", sa.String(length=500), nullable=False),
        sa.Column("resolved_by_principal_id", sa.String(length=128), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("game_version_before", sa.Integer(), nullable=True),
        sa.Column("game_version_after", sa.Integer(), nullable=True),
        sa.Column("idempotency_key", sa.String(length=128), nullable=False),
        sa.Column("request_sha256", sa.String(length=64), nullable=False),
        sa.CheckConstraint(
            "length(resolution_note) BETWEEN 1 AND 500 "
            "AND resolution_note = btrim(resolution_note)",
            name="ck_open_game_report_resolutions_note",
        ),
        sa.CheckConstraint(
            "length(resolved_by_principal_id) BETWEEN 1 AND 128 "
            "AND resolved_by_principal_id = trim(resolved_by_principal_id)",
            name="ck_open_game_report_resolutions_principal",
        ),
        sa.CheckConstraint(
            "(outcome = 'CONFIRMED_GAME_CANCELLED' "
            "AND game_version_before IS NOT NULL "
            "AND game_version_after IS NOT NULL "
            "AND game_version_before >= 1 "
            "AND game_version_after = game_version_before + 1) OR "
            "(outcome IN ('DISMISSED', 'CONFIRMED_RECORDED') "
            "AND game_version_before IS NULL AND game_version_after IS NULL)",
            name="ck_open_game_report_resolutions_version_pair",
        ),
        sa.CheckConstraint(
            "length(idempotency_key) BETWEEN 16 AND 128",
            name="ck_open_game_report_resolutions_idempotency_key",
        ),
        sa.CheckConstraint(
            "request_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_open_game_report_resolutions_request_sha256",
        ),
        sa.ForeignKeyConstraint(
            ["report_id"],
            ["open_game_reports.id"],
            name="fk_open_game_report_resolutions_report",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_open_game_report_resolutions"),
        sa.UniqueConstraint("report_id", name="uq_open_game_report_resolutions_report"),
        sa.UniqueConstraint(
            "resolved_by_principal_id",
            "idempotency_key",
            name="uq_open_game_report_resolutions_principal_idempotency_key",
        ),
    )

    _append_only_trigger("open_game_reports", "ck_open_game_reports_append_only")
    _append_only_trigger(
        "open_game_report_resolutions",
        "ck_open_game_report_resolutions_append_only",
    )


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(
        sa.text(
            "LOCK TABLE open_game_report_resolutions, open_game_reports, open_games "
            "IN ACCESS EXCLUSIVE MODE"
        )
    )
    has_history = bind.execute(
        sa.text(
            "SELECT EXISTS (SELECT 1 FROM open_game_reports) OR "
            "EXISTS (SELECT 1 FROM open_game_report_resolutions) OR "
            "EXISTS (SELECT 1 FROM open_games "
            "WHERE cancellation_source = 'PLATFORM_REPORT')"
        )
    ).scalar_one()
    if has_history:
        raise RuntimeError("cannot downgrade 0024 while game report audit history exists")

    for table in ("open_game_report_resolutions", "open_game_reports"):
        op.execute(f"DROP TRIGGER trg_{table}_append_only ON {table}")
        op.execute(f"DROP FUNCTION enforce_{table}_append_only()")
    op.drop_table("open_game_report_resolutions")
    op.drop_index("ix_open_game_reports_submitted", table_name="open_game_reports")
    op.drop_table("open_game_reports")

    op.drop_constraint("ck_open_games_cancellation_source_status", "open_games", type_="check")
    op.drop_constraint("ck_open_games_status_timestamps", "open_games", type_="check")
    op.execute(
        "UPDATE open_games SET cancellation_source = NULL WHERE cancellation_source = 'CAPTAIN'"
    )
    op.drop_column("open_games", "cancellation_source")
    op.create_check_constraint(
        "ck_open_games_status_timestamps",
        "open_games",
        "(status = 'DRAFT' AND published_at IS NULL AND cancelled_at IS NULL) OR "
        "(status = 'PUBLISHED' AND published_at IS NOT NULL "
        "AND cancelled_at IS NULL) OR "
        "(status = 'CANCELLED' AND cancelled_at IS NOT NULL AND "
        "(published_at IS NULL OR cancelled_at >= published_at))",
    )
    op.execute("DROP TYPE open_game_cancellation_source")
    op.execute("DROP TYPE open_game_report_resolution_outcome")
    op.execute("DROP TYPE open_game_report_category")
