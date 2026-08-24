"""persist open game registrations

Revision ID: 0016
Revises: 0015
Create Date: 2026-08-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0016"
down_revision: str | Sequence[str] | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _create_types() -> None:
    op.execute(
        "CREATE TYPE open_game_registration_position AS ENUM "
        "('GOALKEEPER', 'DEFENDER', 'MIDFIELDER', 'FORWARD', 'ANY')"
    )
    op.execute(
        "CREATE TYPE open_game_registration_status AS ENUM "
        "('APPLIED', 'JOINED', 'REJECTED')"
    )


def upgrade() -> None:
    _create_types()
    position = postgresql.ENUM(
        "GOALKEEPER",
        "DEFENDER",
        "MIDFIELDER",
        "FORWARD",
        "ANY",
        name="open_game_registration_position",
        create_type=False,
    )
    status = postgresql.ENUM(
        "APPLIED",
        "JOINED",
        "REJECTED",
        name="open_game_registration_status",
        create_type=False,
    )

    op.create_table(
        "open_game_registrations",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("game_id", sa.UUID(), nullable=False),
        sa.Column("applicant_user_id", sa.UUID(), nullable=False),
        sa.Column("display_name", sa.String(length=24), nullable=False),
        sa.Column("position", position, nullable=False),
        sa.Column("note", sa.String(length=120), nullable=True),
        sa.Column("status", status, nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("consent_version", sa.String(length=32), nullable=False),
        sa.Column(
            "adult_confirmed_at", sa.DateTime(timezone=True), nullable=False
        ),
        sa.Column(
            "risk_confirmed_at", sa.DateTime(timezone=True), nullable=False
        ),
        sa.Column("applied_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decided_by_user_id", sa.UUID(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "length(display_name) BETWEEN 2 AND 24 "
            "AND display_name = trim(display_name)",
            name="ck_open_game_registrations_display_name",
        ),
        sa.CheckConstraint(
            "note IS NULL OR (length(note) BETWEEN 1 AND 120 "
            "AND note = trim(note))",
            name="ck_open_game_registrations_note",
        ),
        sa.CheckConstraint(
            "version >= 1",
            name="ck_open_game_registrations_version",
        ),
        sa.CheckConstraint(
            "length(consent_version) BETWEEN 1 AND 32 "
            "AND consent_version = trim(consent_version)",
            name="ck_open_game_registrations_consent_version",
        ),
        sa.CheckConstraint(
            "(status = 'APPLIED' AND decided_at IS NULL "
            "AND decided_by_user_id IS NULL) OR "
            "(status IN ('JOINED', 'REJECTED') AND decided_at IS NOT NULL "
            "AND decided_by_user_id IS NOT NULL)",
            name="ck_open_game_registrations_decision_pair",
        ),
        sa.CheckConstraint(
            "decided_at IS NULL OR decided_at >= applied_at",
            name="ck_open_game_registrations_decision_time",
        ),
        sa.ForeignKeyConstraint(
            ["game_id"],
            ["open_games.id"],
            name="fk_open_game_registrations_game_id_open_games",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["applicant_user_id"],
            ["users.id"],
            name="fk_open_game_registrations_applicant_user_id_users",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["decided_by_user_id"],
            ["users.id"],
            name="fk_open_game_registrations_decided_by_user_id_users",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_open_game_registrations"),
        sa.UniqueConstraint(
            "game_id",
            "applicant_user_id",
            name="uq_open_game_registrations_game_applicant",
        ),
    )
    op.create_index(
        "ix_open_game_registrations_pending",
        "open_game_registrations",
        ["game_id", "status", "applied_at", "id"],
        unique=False,
        postgresql_where=sa.text("status = 'APPLIED'"),
    )


def downgrade() -> None:
    op.drop_index(
        "ix_open_game_registrations_pending",
        table_name="open_game_registrations",
    )
    op.drop_table("open_game_registrations")
    op.execute("DROP TYPE open_game_registration_status")
    op.execute("DROP TYPE open_game_registration_position")
