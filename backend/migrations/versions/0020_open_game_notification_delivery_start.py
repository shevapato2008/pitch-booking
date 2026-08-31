"""persist open game notification delivery start

Revision ID: 0020
Revises: 0019
Create Date: 2026-08-30
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0020"
down_revision: str | Sequence[str] | None = "0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "open_game_notification_outbox",
        sa.Column(
            "delivery_started_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    op.execute(
        "UPDATE open_game_notification_outbox "
        "SET delivery_started_at = completed_at WHERE status = 'SENT'"
    )
    op.create_check_constraint(
        "ck_open_game_notification_outbox_delivery_start",
        "open_game_notification_outbox",
        "(status != 'PENDING' OR delivery_started_at IS NULL) AND "
        "(status != 'SENT' OR delivery_started_at IS NOT NULL)",
    )


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(
        sa.text(
            "LOCK TABLE open_game_notification_outbox "
            "IN ACCESS EXCLUSIVE MODE"
        )
    )
    has_delivery_start_history = bind.execute(
        sa.text(
            "SELECT EXISTS (SELECT 1 FROM open_game_notification_outbox "
            "WHERE delivery_started_at IS NOT NULL)"
        )
    ).scalar_one()
    if has_delivery_start_history:
        raise RuntimeError(
            "cannot downgrade 0020 while delivery-start history exists"
        )

    op.drop_constraint(
        "ck_open_game_notification_outbox_delivery_start",
        "open_game_notification_outbox",
        type_="check",
    )
    op.drop_column(
        "open_game_notification_outbox",
        "delivery_started_at",
    )
