"""persist append-only open game attendance corrections

Revision ID: 0022
Revises: 0021
Create Date: 2026-09-01
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0022"
down_revision: str | Sequence[str] | None = "0021"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    attendance_status = postgresql.ENUM(
        "UNMARKED",
        "PRESENT",
        "NO_SHOW",
        name="open_game_attendance_status",
        create_type=False,
    )
    op.create_table(
        "open_game_attendance_corrections",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "registration_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column("from_status", attendance_status, nullable=False),
        sa.Column("to_status", attendance_status, nullable=False),
        sa.Column("reason", sa.String(length=1000), nullable=False),
        sa.Column(
            "corrected_by_principal_id",
            sa.String(length=128),
            nullable=False,
        ),
        sa.Column(
            "corrected_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "registration_version_before",
            sa.Integer(),
            nullable=False,
        ),
        sa.Column(
            "registration_version_after",
            sa.Integer(),
            nullable=False,
        ),
        sa.Column(
            "idempotency_key",
            sa.String(length=128),
            nullable=False,
        ),
        sa.Column(
            "request_sha256",
            sa.String(length=64),
            nullable=False,
        ),
        sa.CheckConstraint(
            "from_status IN ('PRESENT', 'NO_SHOW') "
            "AND to_status IN ('PRESENT', 'NO_SHOW') "
            "AND from_status <> to_status",
            name="ck_open_game_attendance_corrections_status_transition",
        ),
        sa.CheckConstraint(
            "length(reason) BETWEEN 1 AND 1000 AND reason = trim(reason)",
            name="ck_open_game_attendance_corrections_reason",
        ),
        sa.CheckConstraint(
            "length(corrected_by_principal_id) BETWEEN 1 AND 128 "
            "AND corrected_by_principal_id = trim(corrected_by_principal_id)",
            name="ck_open_game_attendance_corrections_principal",
        ),
        sa.CheckConstraint(
            "registration_version_before >= 1 "
            "AND registration_version_after = registration_version_before + 1",
            name="ck_open_game_attendance_corrections_version",
        ),
        sa.CheckConstraint(
            "request_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_open_game_attendance_corrections_request_sha256",
        ),
        sa.ForeignKeyConstraint(
            ["registration_id"],
            ["open_game_registrations.id"],
            name="fk_attendance_corrections_registration",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint(
            "id",
            name="pk_open_game_attendance_corrections",
        ),
        sa.UniqueConstraint(
            "registration_id",
            "registration_version_after",
            name=(
                "uq_open_game_attendance_corrections_"
                "registration_version_after"
            ),
        ),
        sa.UniqueConstraint(
            "corrected_by_principal_id",
            "idempotency_key",
            name=(
                "uq_open_game_attendance_corrections_"
                "principal_idempotency_key"
            ),
        ),
    )
    op.execute(
        """
        CREATE FUNCTION enforce_open_game_attendance_corrections_append_only()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            RAISE EXCEPTION 'attendance correction history is append-only'
                USING ERRCODE = '23514',
                      CONSTRAINT = 'ck_open_game_attendance_corrections_append_only';
        END;
        $$
        """
    )
    op.execute(
        "CREATE TRIGGER trg_open_game_attendance_corrections_append_only "
        "BEFORE UPDATE OR DELETE ON open_game_attendance_corrections "
        "FOR EACH ROW EXECUTE FUNCTION "
        "enforce_open_game_attendance_corrections_append_only()"
    )


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(
        sa.text(
            "LOCK TABLE open_game_attendance_corrections "
            "IN ACCESS EXCLUSIVE MODE"
        )
    )
    has_correction_history = bind.execute(
        sa.text(
            "SELECT EXISTS ("
            "SELECT 1 FROM open_game_attendance_corrections)"
        )
    ).scalar_one()
    if has_correction_history:
        raise RuntimeError(
            "cannot downgrade 0022 while attendance correction history exists"
        )

    op.execute(
        "DROP TRIGGER trg_open_game_attendance_corrections_append_only "
        "ON open_game_attendance_corrections"
    )
    op.execute(
        "DROP FUNCTION enforce_open_game_attendance_corrections_append_only()"
    )
    op.drop_table("open_game_attendance_corrections")
