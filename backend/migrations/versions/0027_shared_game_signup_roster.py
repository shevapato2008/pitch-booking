"""add public profiles and shared signup reapply authority

Revision ID: 0027
Revises: 0026
Create Date: 2026-09-01
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0027"
down_revision: str | Sequence[str] | None = "0026"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_PUBLIC_PROFILE_PAIR = (
    "(public_nickname IS NULL AND public_avatar_object_key IS NULL "
    "AND public_profile_updated_at IS NULL AND public_profile_version = 0) OR "
    "(public_nickname IS NOT NULL AND public_avatar_object_key IS NOT NULL "
    "AND public_profile_updated_at IS NOT NULL AND public_profile_version >= 1)"
)
_PUBLIC_NICKNAME = (
    "public_nickname IS NULL OR (length(public_nickname) BETWEEN 1 AND 24 "
    "AND public_nickname = trim(public_nickname))"
)
_PUBLIC_AVATAR_KEY = (
    "public_avatar_object_key IS NULL OR "
    "public_avatar_object_key LIKE 'published/avatars/%'"
)
_REAPPLY_BLOCK = "status = 'REMOVED' OR reapply_blocked = false"
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
    "(status = 'REMOVED' AND ((waitlist_seq IS NULL "
    "AND waitlisted_at IS NULL AND promoted_at IS NULL) OR "
    "(waitlist_seq IS NOT NULL AND waitlisted_at IS NOT NULL))) OR "
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


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("public_nickname", sa.String(length=24), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column(
            "public_avatar_object_key",
            sa.String(length=256),
            nullable=True,
        ),
    )
    op.add_column(
        "users",
        sa.Column(
            "public_profile_updated_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    op.add_column(
        "users",
        sa.Column(
            "public_profile_version",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
    )
    op.create_check_constraint(
        "ck_users_public_profile_pair",
        "users",
        _PUBLIC_PROFILE_PAIR,
    )
    op.create_check_constraint(
        "ck_users_public_nickname",
        "users",
        _PUBLIC_NICKNAME,
    )
    op.create_check_constraint(
        "ck_users_public_avatar_object_key",
        "users",
        _PUBLIC_AVATAR_KEY,
    )

    op.add_column(
        "open_game_registrations",
        sa.Column(
            "reapply_blocked",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )
    op.execute("UPDATE open_game_registrations SET reapply_blocked = true WHERE status = 'REMOVED'")
    op.create_check_constraint(
        "ck_open_game_registrations_reapply_blocked_status",
        "open_game_registrations",
        _REAPPLY_BLOCK,
    )
    op.execute(
        "WITH eligible_games AS ("
        "SELECT game.id, game.open_spots "
        "FROM open_games AS game "
        "JOIN orders AS booking_order ON booking_order.id = game.order_id "
        "JOIN slots AS slot ON slot.id = booking_order.slot_id "
        "WHERE game.status = 'PUBLISHED' "
        "AND game.published_at IS NOT NULL "
        "AND game.registration_deadline > CURRENT_TIMESTAMP "
        "AND slot.starts_at > CURRENT_TIMESTAMP "
        "AND booking_order.status = 'CONFIRMED' "
        "AND booking_order.cancel_requested_at IS NULL "
        "AND NOT EXISTS (SELECT 1 FROM refund_cases AS refund_case "
        "WHERE refund_case.order_id = booking_order.id "
        "AND refund_case.purpose IN ("
        "'ORDER_CANCELLATION', 'PAYMENT_INVENTORY_CONFLICT'))"
        "), game_capacity AS ("
        "SELECT game.id AS game_id, "
        "GREATEST(game.open_spots - count(registration.id) FILTER ("
        "WHERE registration.status = 'JOINED'), 0)::bigint AS vacancies "
        "FROM eligible_games AS game "
        "LEFT JOIN open_game_registrations AS registration "
        "ON registration.game_id = game.id "
        "GROUP BY game.id, game.open_spots"
        "), ranked_waitlist AS ("
        "SELECT registration.id, capacity.vacancies, "
        "row_number() OVER (PARTITION BY registration.game_id "
        "ORDER BY registration.waitlist_seq, registration.waitlisted_at, "
        "registration.id) AS fifo_rank "
        "FROM open_game_registrations AS registration "
        "JOIN game_capacity AS capacity ON capacity.game_id = registration.game_id "
        "WHERE registration.status = 'WAITLISTED'"
        ") "
        "UPDATE open_game_registrations AS registration SET "
        "status = 'JOINED'::open_game_registration_status, "
        "version = registration.version + 1, "
        "promoted_at = CURRENT_TIMESTAMP "
        "FROM ranked_waitlist AS ranked "
        "WHERE registration.id = ranked.id AND ranked.fifo_rank <= ranked.vacancies"
    )
    op.execute(
        "WITH eligible_games AS ("
        "SELECT game.id, game.open_spots "
        "FROM open_games AS game "
        "JOIN orders AS booking_order ON booking_order.id = game.order_id "
        "JOIN slots AS slot ON slot.id = booking_order.slot_id "
        "WHERE game.status = 'PUBLISHED' "
        "AND game.published_at IS NOT NULL "
        "AND game.registration_deadline > CURRENT_TIMESTAMP "
        "AND slot.starts_at > CURRENT_TIMESTAMP "
        "AND booking_order.status = 'CONFIRMED' "
        "AND booking_order.cancel_requested_at IS NULL "
        "AND NOT EXISTS (SELECT 1 FROM refund_cases AS refund_case "
        "WHERE refund_case.order_id = booking_order.id "
        "AND refund_case.purpose IN ("
        "'ORDER_CANCELLATION', 'PAYMENT_INVENTORY_CONFLICT'))"
        "), game_capacity AS ("
        "SELECT game.id AS game_id, "
        "GREATEST(game.open_spots - count(registration.id) FILTER ("
        "WHERE registration.status = 'JOINED'), 0)::bigint AS vacancies, "
        "COALESCE(max(registration.waitlist_seq), 0)::bigint AS max_waitlist_seq "
        "FROM eligible_games AS game "
        "LEFT JOIN open_game_registrations AS registration "
        "ON registration.game_id = game.id "
        "GROUP BY game.id, game.open_spots"
        "), ranked_applied AS ("
        "SELECT registration.id, registration.applicant_user_id, "
        "registration.applied_at, capacity.vacancies, capacity.max_waitlist_seq, "
        "row_number() OVER (PARTITION BY registration.game_id "
        "ORDER BY registration.applied_at, registration.id) AS fifo_rank "
        "FROM open_game_registrations AS registration "
        "JOIN game_capacity AS capacity ON capacity.game_id = registration.game_id "
        "WHERE registration.status = 'APPLIED'"
        ") "
        "UPDATE open_game_registrations AS registration SET "
        "status = CASE WHEN ranked.fifo_rank <= ranked.vacancies "
        "THEN 'JOINED'::open_game_registration_status "
        "ELSE 'WAITLISTED'::open_game_registration_status END, "
        "version = registration.version + 1, "
        "decided_at = registration.applied_at, "
        "decided_by_user_id = registration.applicant_user_id, "
        "waitlist_seq = CASE WHEN ranked.fifo_rank <= ranked.vacancies THEN NULL "
        "ELSE ranked.max_waitlist_seq + ranked.fifo_rank - ranked.vacancies END, "
        "waitlisted_at = CASE WHEN ranked.fifo_rank <= ranked.vacancies THEN NULL "
        "ELSE registration.applied_at END, "
        "promoted_at = NULL "
        "FROM ranked_applied AS ranked WHERE registration.id = ranked.id"
    )
    op.drop_constraint(
        "ck_open_game_registrations_waitlist_history",
        "open_game_registrations",
        type_="check",
    )
    op.create_check_constraint(
        "ck_open_game_registrations_waitlist_history",
        "open_game_registrations",
        _WAITLIST_HISTORY,
    )

    op.drop_constraint(
        "uq_open_game_member_removals_registration",
        "open_game_member_removals",
        type_="unique",
    )
    op.create_unique_constraint(
        "uq_open_game_member_removals_registration_version",
        "open_game_member_removals",
        ["registration_id", "registration_version_after"],
    )


def downgrade() -> None:
    bind = op.get_bind()
    has_new_data = bind.execute(
        sa.text(
            "SELECT EXISTS (SELECT 1 FROM users WHERE public_profile_version > 0) "
            "OR EXISTS (SELECT 1 FROM open_game_member_removals "
            "GROUP BY registration_id HAVING count(*) > 1)"
        )
    ).scalar_one()
    if has_new_data:
        raise RuntimeError("cannot downgrade 0027 while public profiles or repeated removals exist")

    op.drop_constraint(
        "uq_open_game_member_removals_registration_version",
        "open_game_member_removals",
        type_="unique",
    )
    op.create_unique_constraint(
        "uq_open_game_member_removals_registration",
        "open_game_member_removals",
        ["registration_id"],
    )

    op.drop_constraint(
        "ck_open_game_registrations_waitlist_history",
        "open_game_registrations",
        type_="check",
    )
    op.execute(
        "ALTER TABLE open_game_registrations ADD CONSTRAINT "
        "ck_open_game_registrations_waitlist_history CHECK ("
        "(status IN ('APPLIED', 'REJECTED') AND waitlist_seq IS NULL "
        "AND waitlisted_at IS NULL AND promoted_at IS NULL) OR "
        "(status = 'WAITLISTED' AND waitlist_seq IS NOT NULL "
        "AND waitlisted_at IS NOT NULL AND promoted_at IS NULL) OR "
        "(status IN ('JOINED', 'REMOVED') AND ((waitlist_seq IS NULL "
        "AND waitlisted_at IS NULL AND promoted_at IS NULL) OR "
        "(waitlist_seq IS NOT NULL AND waitlisted_at IS NOT NULL "
        "AND promoted_at IS NOT NULL))) OR "
        "(status = 'WITHDRAWN' AND withdrawal_kind = 'APPLICATION_WITHDRAWAL' "
        "AND waitlist_seq IS NULL AND waitlisted_at IS NULL "
        "AND promoted_at IS NULL) OR "
        "(status = 'WITHDRAWN' AND withdrawal_kind = 'WAITLIST_WITHDRAWAL' "
        "AND waitlist_seq IS NOT NULL AND waitlisted_at IS NOT NULL "
        "AND promoted_at IS NULL) OR "
        "(status = 'WITHDRAWN' AND withdrawal_kind = 'GAME_EXIT' AND "
        "((waitlist_seq IS NULL AND waitlisted_at IS NULL "
        "AND promoted_at IS NULL) OR (waitlist_seq IS NOT NULL "
        "AND waitlisted_at IS NOT NULL AND promoted_at IS NOT NULL))))"
    )
    op.drop_constraint(
        "ck_open_game_registrations_reapply_blocked_status",
        "open_game_registrations",
        type_="check",
    )
    op.drop_column("open_game_registrations", "reapply_blocked")

    op.drop_constraint("ck_users_public_avatar_object_key", "users", type_="check")
    op.drop_constraint("ck_users_public_nickname", "users", type_="check")
    op.drop_constraint("ck_users_public_profile_pair", "users", type_="check")
    op.drop_column("users", "public_profile_version")
    op.drop_column("users", "public_profile_updated_at")
    op.drop_column("users", "public_avatar_object_key")
    op.drop_column("users", "public_nickname")
