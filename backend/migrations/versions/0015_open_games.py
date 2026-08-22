"""persist captain open games

Revision ID: 0015
Revises: 0014
Create Date: 2026-08-22
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0015"
down_revision: str | Sequence[str] | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _create_types() -> None:
    op.execute(
        "CREATE TYPE open_game_status AS ENUM ('DRAFT', 'PUBLISHED', 'CANCELLED')"
    )
    op.execute(
        "CREATE TYPE open_game_visibility AS ENUM ('PUBLIC', 'LINK_ONLY')"
    )
    op.execute(
        "CREATE TYPE open_game_intensity AS ENUM "
        "('BEGINNER_FRIENDLY', 'CASUAL', 'COMPETITIVE')"
    )


def upgrade() -> None:
    _create_types()
    status = postgresql.ENUM(
        "DRAFT",
        "PUBLISHED",
        "CANCELLED",
        name="open_game_status",
        create_type=False,
    )
    visibility = postgresql.ENUM(
        "PUBLIC",
        "LINK_ONLY",
        name="open_game_visibility",
        create_type=False,
    )
    intensity = postgresql.ENUM(
        "BEGINNER_FRIENDLY",
        "CASUAL",
        "COMPETITIVE",
        name="open_game_intensity",
        create_type=False,
    )

    op.create_table(
        "teams",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("captain_user_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=24), nullable=False),
        sa.Column("name_key", sa.String(length=64), nullable=False),
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
            "length(name) BETWEEN 1 AND 24 AND name = trim(name)",
            name="ck_teams_name",
        ),
        sa.CheckConstraint(
            "length(name_key) BETWEEN 1 AND 64 AND name_key = trim(name_key)",
            name="ck_teams_name_key",
        ),
        sa.ForeignKeyConstraint(
            ["captain_user_id"],
            ["users.id"],
            name="fk_teams_captain_user_id_users",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_teams"),
        sa.UniqueConstraint(
            "captain_user_id",
            "name_key",
            name="uq_teams_captain_name_key",
        ),
    )
    op.create_table(
        "open_games",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("order_id", sa.UUID(), nullable=False),
        sa.Column("team_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=30), nullable=False),
        sa.Column("total_players", sa.Integer(), nullable=False),
        sa.Column("fixed_players", sa.Integer(), nullable=False),
        sa.Column("open_spots", sa.Integer(), nullable=False),
        sa.Column("intensity", intensity, nullable=False),
        sa.Column("minimum_experience", sa.String(length=60), nullable=True),
        sa.Column("position_mask", sa.SmallInteger(), nullable=False),
        sa.Column("aa_cents", sa.Integer(), nullable=False),
        sa.Column(
            "registration_deadline", sa.DateTime(timezone=True), nullable=False
        ),
        sa.Column(
            "equipment_and_arrival_notes", sa.String(length=200), nullable=True
        ),
        sa.Column("visibility", visibility, nullable=False),
        sa.Column("status", status, nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("share_token", sa.String(length=64), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
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
            "length(name) BETWEEN 1 AND 30 AND name = trim(name)",
            name="ck_open_games_name",
        ),
        sa.CheckConstraint(
            "total_players BETWEEN 4 AND 30",
            name="ck_open_games_total_players",
        ),
        sa.CheckConstraint(
            "fixed_players >= 1", name="ck_open_games_fixed_players"
        ),
        sa.CheckConstraint("open_spots >= 1", name="ck_open_games_open_spots"),
        sa.CheckConstraint(
            "fixed_players + open_spots <= total_players",
            name="ck_open_games_roster_capacity",
        ),
        sa.CheckConstraint(
            "minimum_experience IS NULL OR "
            "(length(minimum_experience) BETWEEN 1 AND 60 "
            "AND minimum_experience = trim(minimum_experience))",
            name="ck_open_games_minimum_experience",
        ),
        sa.CheckConstraint(
            "position_mask BETWEEN 0 AND 15",
            name="ck_open_games_position_mask",
        ),
        sa.CheckConstraint("aa_cents >= 0", name="ck_open_games_aa_cents"),
        sa.CheckConstraint(
            "equipment_and_arrival_notes IS NULL OR "
            "(length(equipment_and_arrival_notes) BETWEEN 1 AND 200 "
            "AND equipment_and_arrival_notes = trim(equipment_and_arrival_notes))",
            name="ck_open_games_equipment_and_arrival_notes",
        ),
        sa.CheckConstraint("version >= 1", name="ck_open_games_version"),
        sa.CheckConstraint(
            "length(share_token) BETWEEN 1 AND 64 "
            "AND share_token = trim(share_token)",
            name="ck_open_games_share_token",
        ),
        sa.CheckConstraint(
            "(status = 'DRAFT' AND published_at IS NULL AND cancelled_at IS NULL) OR "
            "(status = 'PUBLISHED' AND published_at IS NOT NULL "
            "AND cancelled_at IS NULL) OR "
            "(status = 'CANCELLED' AND cancelled_at IS NOT NULL AND "
            "(published_at IS NULL OR cancelled_at >= published_at))",
            name="ck_open_games_status_timestamps",
        ),
        sa.ForeignKeyConstraint(
            ["order_id"],
            ["orders.id"],
            name="fk_open_games_order_id_orders",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["team_id"],
            ["teams.id"],
            name="fk_open_games_team_id_teams",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_open_games"),
        sa.UniqueConstraint("share_token", name="uq_open_games_share_token"),
    )
    op.create_index(
        "uq_open_games_one_active_per_order",
        "open_games",
        ["order_id"],
        unique=True,
        postgresql_where=sa.text("status <> 'CANCELLED'"),
    )


def downgrade() -> None:
    op.drop_index("uq_open_games_one_active_per_order", table_name="open_games")
    op.drop_table("open_games")
    op.drop_table("teams")
    op.execute("DROP TYPE open_game_intensity")
    op.execute("DROP TYPE open_game_visibility")
    op.execute("DROP TYPE open_game_status")
