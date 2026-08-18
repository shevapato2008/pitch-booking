"""add physical pitch configuration

Revision ID: 0009
Revises: 0008
Create Date: 2026-08-11
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: str | Sequence[str] | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pitch_status = sa.Enum("ACTIVE", "INACTIVE", name="pitch_status")
    pitch_status.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "venues",
        sa.Column("configuration_version", sa.BigInteger(), server_default="1", nullable=False),
    )
    op.add_column("pitches", sa.Column("players_per_side", sa.Integer(), nullable=True))
    op.add_column("pitches", sa.Column("system_name", sa.String(length=120), nullable=True))
    op.add_column("pitches", sa.Column("custom_name", sa.String(length=120), nullable=True))
    op.add_column("pitches", sa.Column("sequence", sa.Integer(), nullable=True))
    op.add_column(
        "pitches",
        sa.Column("status", pitch_status, server_default="ACTIVE", nullable=False),
    )
    op.execute(
        "UPDATE pitches SET players_per_side = CASE pitch_type::text "
        "WHEN 'FIVE_A_SIDE' THEN 5 WHEN 'SEVEN_A_SIDE' THEN 7 END, system_name = name"
    )
    op.execute(
        "WITH numbered AS (SELECT id, row_number() OVER ("
        "PARTITION BY venue_id, players_per_side ORDER BY sort_order, id)::integer AS value "
        "FROM pitches) UPDATE pitches SET sequence = numbered.value "
        "FROM numbered WHERE pitches.id = numbered.id"
    )
    op.alter_column("pitches", "players_per_side", nullable=False)
    op.alter_column("pitches", "system_name", nullable=False)
    op.alter_column("pitches", "sequence", nullable=False)
    op.alter_column(
        "pitches", "pitch_type", existing_type=sa.Enum(name="pitch_type"), nullable=True
    )
    op.create_check_constraint(
        "ck_pitches_players_per_side", "pitches", "players_per_side BETWEEN 1 AND 99"
    )
    op.create_check_constraint("ck_pitches_sequence", "pitches", "sequence > 0")
    op.create_unique_constraint(
        "uq_pitches_venue_format_sequence",
        "pitches",
        ["venue_id", "players_per_side", "sequence"],
    )
    op.create_table(
        "venue_pitch_sequence_counters",
        sa.Column("venue_id", sa.UUID(), nullable=False),
        sa.Column("players_per_side", sa.Integer(), nullable=False),
        sa.Column("last_sequence", sa.Integer(), nullable=False),
        sa.CheckConstraint(
            "players_per_side BETWEEN 1 AND 99",
            name="ck_venue_pitch_sequence_counters_players",
        ),
        sa.CheckConstraint(
            "last_sequence >= 0", name="ck_venue_pitch_sequence_counters_last_sequence"
        ),
        sa.ForeignKeyConstraint(["venue_id"], ["venues.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("venue_id", "players_per_side"),
    )
    op.execute(
        "INSERT INTO venue_pitch_sequence_counters (venue_id, players_per_side, last_sequence) "
        "SELECT venue_id, players_per_side, max(sequence) FROM pitches "
        "GROUP BY venue_id, players_per_side"
    )


def downgrade() -> None:
    op.drop_table("venue_pitch_sequence_counters")
    op.drop_constraint("uq_pitches_venue_format_sequence", "pitches", type_="unique")
    op.drop_constraint("ck_pitches_sequence", "pitches", type_="check")
    op.drop_constraint("ck_pitches_players_per_side", "pitches", type_="check")
    op.execute("DELETE FROM pitches WHERE pitch_type IS NULL")
    op.alter_column(
        "pitches", "pitch_type", existing_type=sa.Enum(name="pitch_type"), nullable=False
    )
    op.drop_column("pitches", "status")
    op.drop_column("pitches", "sequence")
    op.drop_column("pitches", "custom_name")
    op.drop_column("pitches", "system_name")
    op.drop_column("pitches", "players_per_side")
    op.drop_column("venues", "configuration_version")
    sa.Enum(name="pitch_status").drop(op.get_bind(), checkfirst=True)
