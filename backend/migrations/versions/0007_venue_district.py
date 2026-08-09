"""persist structured venue districts

Revision ID: 0007
Revises: 0006
Create Date: 2026-08-09

"""

from collections.abc import Sequence
from typing import Final

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: str | Sequence[str] | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

VENUE_DISTRICTS: Final[dict[str, tuple[str, str]]] = {
    "7e68d7d8-4b7e-4f04-a5c5-3fe263e69c6f": ("120111", "西青区"),
    "e03d801d-1254-5c62-9a16-9a8800280162": ("120104", "南开区"),
    "2a9640a5-f625-5ad8-9cb9-3440acb70967": ("120105", "河北区"),
    "80532433-8038-5ee5-9963-3e6282aa4abd": ("120101", "和平区"),
    "c0372328-6fa4-585a-b951-3324925763d6": ("120110", "东丽区"),
}


def upgrade() -> None:
    op.add_column("venues", sa.Column("district_code", sa.String(6), nullable=True))
    op.add_column("venues", sa.Column("district_name", sa.Text(), nullable=True))

    bind = op.get_bind()
    for venue_id, (district_code, district_name) in VENUE_DISTRICTS.items():
        bind.execute(
            sa.text(
                "UPDATE venues SET district_code=:district_code, district_name=:district_name "
                "WHERE id=CAST(:venue_id AS uuid)"
            ),
            {
                "venue_id": venue_id,
                "district_code": district_code,
                "district_name": district_name,
            },
        )

    unmapped = bind.execute(
        sa.text(
            "SELECT id::text FROM venues "
            "WHERE district_code IS NULL OR district_name IS NULL ORDER BY id"
        )
    ).scalars().all()
    if unmapped:
        raise RuntimeError(
            "district mapping missing for pre-existing venue IDs: "
            + ", ".join(unmapped)
        )

    op.alter_column(
        "venues", "district_code", existing_type=sa.String(6), nullable=False
    )
    op.alter_column(
        "venues", "district_name", existing_type=sa.Text(), nullable=False
    )
    op.create_check_constraint(
        "ck_venues_district_code", "venues", "district_code ~ '^[0-9]{6}$'"
    )
    op.create_check_constraint(
        "ck_venues_district_name_nonempty",
        "venues",
        "length(trim(district_name)) > 0",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_venues_district_name_nonempty", "venues", type_="check"
    )
    op.drop_constraint("ck_venues_district_code", "venues", type_="check")
    op.drop_column("venues", "district_name")
    op.drop_column("venues", "district_code")
