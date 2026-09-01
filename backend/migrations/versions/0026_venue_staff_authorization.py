"""add venue staff roles, invitations, and immutable audit events

Revision ID: 0026
Revises: 0025
Create Date: 2026-09-01
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0026"
down_revision: str | Sequence[str] | None = "0025"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ROLE_NAME = "venue_membership_role"
ROLE_VALUES = ("OWNER", "STAFF")
INVITATION_STATUS_NAME = "venue_staff_invitation_status"
INVITATION_STATUS_VALUES = ("ACTIVE", "ACCEPTED", "REVOKED", "EXPIRED")
AUDIT_ACTION_NAME = "venue_membership_audit_action"
AUDIT_ACTION_VALUES = (
    "INVITATION_CREATED",
    "INVITATION_ACCEPTED",
    "INVITATION_REVOKED",
    "PERMISSIONS_UPDATED",
    "MEMBER_REMOVED",
    "OWNER_TRANSFERRED",
)
AUDIT_ACTOR_KIND_NAME = "venue_membership_audit_actor_kind"
AUDIT_ACTOR_KIND_VALUES = ("USER", "PLATFORM")


def _enum(name: str, values: tuple[str, ...]) -> postgresql.ENUM:
    return postgresql.ENUM(*values, name=name, create_type=False)


def upgrade() -> None:
    bind = op.get_bind()
    postgresql.ENUM(*ROLE_VALUES, name=ROLE_NAME).create(bind)
    postgresql.ENUM(
        *INVITATION_STATUS_VALUES, name=INVITATION_STATUS_NAME
    ).create(bind)
    postgresql.ENUM(*AUDIT_ACTION_VALUES, name=AUDIT_ACTION_NAME).create(bind)
    postgresql.ENUM(
        *AUDIT_ACTOR_KIND_VALUES, name=AUDIT_ACTOR_KIND_NAME
    ).create(bind)

    op.add_column(
        "venue_memberships",
        sa.Column(
            "role",
            _enum(ROLE_NAME, ROLE_VALUES),
            server_default=sa.text("'STAFF'"),
            nullable=False,
        ),
    )
    op.add_column(
        "venue_memberships",
        sa.Column(
            "can_manage_profile",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )
    op.add_column(
        "venue_memberships",
        sa.Column(
            "can_manage_pitches",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )
    op.add_column(
        "venue_memberships",
        sa.Column(
            "can_fulfill_orders",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )
    op.add_column(
        "venue_memberships",
        sa.Column(
            "version",
            sa.BigInteger(),
            server_default=sa.text("1"),
            nullable=False,
        ),
    )
    op.add_column(
        "venue_memberships",
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute(
        sa.text(
            "UPDATE venue_memberships SET revoked_at = now() "
            "WHERE is_active IS FALSE AND revoked_at IS NULL"
        )
    )
    op.execute(
        sa.text(
            "UPDATE venue_memberships "
            "SET is_active = false, revoked_at = now() "
            "WHERE is_active IS TRUE AND can_manage_inventory IS FALSE"
        )
    )
    op.create_index(
        "uq_venue_memberships_active_owner",
        "venue_memberships",
        ["venue_id"],
        unique=True,
        postgresql_where=sa.text("role = 'OWNER' AND is_active"),
    )
    op.create_check_constraint(
        "ck_venue_memberships_version",
        "venue_memberships",
        "version > 0",
    )
    op.create_check_constraint(
        "ck_venue_memberships_active_revoked",
        "venue_memberships",
        "(is_active AND revoked_at IS NULL) OR "
        "(NOT is_active AND revoked_at IS NOT NULL)",
    )
    op.create_check_constraint(
        "ck_venue_memberships_role_permissions",
        "venue_memberships",
        "(role = 'OWNER' AND can_manage_profile AND can_manage_pitches "
        "AND can_manage_inventory AND can_fulfill_orders) OR "
        "(role = 'STAFF' AND (NOT is_active OR can_manage_profile "
        "OR can_manage_pitches OR can_manage_inventory OR can_fulfill_orders))",
    )

    op.create_table(
        "venue_staff_invitations",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("venue_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("contact_label", sa.String(length=40), nullable=False),
        sa.Column(
            "status",
            _enum(INVITATION_STATUS_NAME, INVITATION_STATUS_VALUES),
            nullable=False,
        ),
        sa.Column("can_manage_profile", sa.Boolean(), nullable=False),
        sa.Column("can_manage_pitches", sa.Boolean(), nullable=False),
        sa.Column("can_manage_inventory", sa.Boolean(), nullable=False),
        sa.Column("can_fulfill_orders", sa.Boolean(), nullable=False),
        sa.Column(
            "created_by_membership_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "accepted_by_membership_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column(
            "revoked_by_membership_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column(
            "version",
            sa.BigInteger(),
            server_default=sa.text("1"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "token_hash ~ '^[0-9a-f]{64}$'",
            name="ck_venue_staff_invitations_token_hash",
        ),
        sa.CheckConstraint(
            "length(contact_label) BETWEEN 1 AND 40 "
            "AND contact_label = trim(contact_label)",
            name="ck_venue_staff_invitations_contact_label",
        ),
        sa.CheckConstraint(
            "can_manage_profile OR can_manage_pitches OR can_manage_inventory "
            "OR can_fulfill_orders",
            name="ck_venue_staff_invitations_permissions",
        ),
        sa.CheckConstraint(
            "version > 0",
            name="ck_venue_staff_invitations_version",
        ),
        sa.CheckConstraint(
            "expires_at > created_at",
            name="ck_venue_staff_invitations_expiry",
        ),
        sa.CheckConstraint(
            "(status = 'ACTIVE' AND accepted_at IS NULL "
            "AND accepted_by_membership_id IS NULL AND revoked_at IS NULL "
            "AND revoked_by_membership_id IS NULL) OR "
            "(status = 'ACCEPTED' AND accepted_at IS NOT NULL "
            "AND accepted_by_membership_id IS NOT NULL AND revoked_at IS NULL "
            "AND revoked_by_membership_id IS NULL) OR "
            "(status = 'REVOKED' AND accepted_at IS NULL "
            "AND accepted_by_membership_id IS NULL AND revoked_at IS NOT NULL "
            "AND revoked_by_membership_id IS NOT NULL) OR "
            "(status = 'EXPIRED' AND accepted_at IS NULL "
            "AND accepted_by_membership_id IS NULL AND revoked_at IS NULL "
            "AND revoked_by_membership_id IS NULL)",
            name="ck_venue_staff_invitations_status_fields",
        ),
        sa.ForeignKeyConstraint(
            ["venue_id"],
            ["venues.id"],
            name="fk_venue_staff_invitations_venue",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_membership_id"],
            ["venue_memberships.id"],
            name="fk_venue_staff_invitations_creator_membership",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["accepted_by_membership_id"],
            ["venue_memberships.id"],
            name="fk_venue_staff_invitations_accepted_membership",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["revoked_by_membership_id"],
            ["venue_memberships.id"],
            name="fk_venue_staff_invitations_revoked_membership",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_venue_staff_invitations"),
        sa.UniqueConstraint(
            "token_hash",
            name="uq_venue_staff_invitations_token_hash",
        ),
    )
    op.create_index(
        "ix_venue_staff_invitations_active_venue",
        "venue_staff_invitations",
        ["venue_id", "expires_at"],
        postgresql_where=sa.text("status = 'ACTIVE'"),
    )

    op.create_table(
        "venue_membership_audit_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("venue_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "actor_kind",
            _enum(AUDIT_ACTOR_KIND_NAME, AUDIT_ACTOR_KIND_VALUES),
            nullable=False,
        ),
        sa.Column("actor_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("actor_principal_id", sa.String(length=128), nullable=True),
        sa.Column(
            "target_membership_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column("invitation_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "action",
            _enum(AUDIT_ACTION_NAME, AUDIT_ACTION_VALUES),
            nullable=False,
        ),
        sa.Column("operation", sa.String(length=80), nullable=False),
        sa.Column("idempotency_key", sa.String(length=128), nullable=False),
        sa.Column("request_sha256", sa.String(length=64), nullable=False),
        sa.Column(
            "permissions_before",
            postgresql.JSONB(),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "permissions_after",
            postgresql.JSONB(),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column("target_display_name", sa.String(length=40), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("response_status", sa.SmallInteger(), nullable=False),
        sa.Column("response_body", postgresql.JSONB(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "(actor_kind = 'USER' AND actor_user_id IS NOT NULL "
            "AND actor_principal_id IS NULL) OR "
            "(actor_kind = 'PLATFORM' AND actor_user_id IS NULL "
            "AND actor_principal_id IS NOT NULL)",
            name="ck_venue_membership_audit_events_actor",
        ),
        sa.CheckConstraint(
            "actor_principal_id IS NULL OR "
            "(length(actor_principal_id) BETWEEN 1 AND 128 "
            "AND actor_principal_id = trim(actor_principal_id))",
            name="ck_venue_membership_audit_events_principal",
        ),
        sa.CheckConstraint(
            "length(operation) BETWEEN 1 AND 80 AND operation = trim(operation)",
            name="ck_venue_membership_audit_events_operation",
        ),
        sa.CheckConstraint(
            "length(idempotency_key) BETWEEN 16 AND 128",
            name="ck_venue_membership_audit_events_idempotency_key",
        ),
        sa.CheckConstraint(
            "request_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_venue_membership_audit_events_request_sha256",
        ),
        sa.CheckConstraint(
            "response_status BETWEEN 200 AND 299",
            name="ck_venue_membership_audit_events_response_status",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(permissions_before) = 'array' "
            "AND jsonb_typeof(permissions_after) = 'array' "
            "AND permissions_before <@ "
            "'[\"MANAGE_PROFILE\",\"MANAGE_PITCHES\",\"MANAGE_INVENTORY\","
            "\"FULFILL_ORDERS\"]'::jsonb "
            "AND permissions_after <@ "
            "'[\"MANAGE_PROFILE\",\"MANAGE_PITCHES\",\"MANAGE_INVENTORY\","
            "\"FULFILL_ORDERS\"]'::jsonb",
            name="ck_venue_membership_audit_events_permissions",
        ),
        sa.CheckConstraint(
            "length(target_display_name) BETWEEN 1 AND 40 "
            "AND target_display_name = trim(target_display_name)",
            name="ck_venue_membership_audit_events_target_display_name",
        ),
        sa.CheckConstraint(
            "reason IS NULL OR (length(reason) BETWEEN 1 AND 200 "
            "AND reason = trim(reason))",
            name="ck_venue_membership_audit_events_reason",
        ),
        sa.ForeignKeyConstraint(
            ["venue_id"],
            ["venues.id"],
            name="fk_venue_membership_audit_events_venue",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["actor_user_id"],
            ["users.id"],
            name="fk_venue_membership_audit_events_actor_user",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["target_membership_id"],
            ["venue_memberships.id"],
            name="fk_venue_membership_audit_events_target_membership",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["invitation_id"],
            ["venue_staff_invitations.id"],
            name="fk_venue_membership_audit_events_invitation",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_venue_membership_audit_events"),
    )
    op.create_index(
        "ix_venue_membership_audit_events_venue",
        "venue_membership_audit_events",
        ["venue_id", sa.text("created_at DESC"), sa.text("id DESC")],
    )
    op.create_index(
        "uq_venue_membership_audit_events_user_idempotency",
        "venue_membership_audit_events",
        ["actor_user_id", "operation", "idempotency_key"],
        unique=True,
        postgresql_where=sa.text("actor_user_id IS NOT NULL"),
    )
    op.create_index(
        "uq_venue_membership_audit_events_platform_idempotency",
        "venue_membership_audit_events",
        ["actor_principal_id", "operation", "idempotency_key"],
        unique=True,
        postgresql_where=sa.text("actor_principal_id IS NOT NULL"),
    )
    op.execute(
        sa.text(
            """
            CREATE FUNCTION prevent_venue_membership_audit_mutation()
            RETURNS trigger
            LANGUAGE plpgsql
            AS $$
            BEGIN
                RAISE EXCEPTION 'venue membership audit events are immutable'
                    USING ERRCODE = '55000';
            END;
            $$
            """
        )
    )
    op.execute(
        sa.text(
            """
            CREATE TRIGGER trg_venue_membership_audit_events_immutable
            BEFORE UPDATE OR DELETE ON venue_membership_audit_events
            FOR EACH ROW
            EXECUTE FUNCTION prevent_venue_membership_audit_mutation()
            """
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            "DROP TRIGGER trg_venue_membership_audit_events_immutable "
            "ON venue_membership_audit_events"
        )
    )
    op.execute(sa.text("DROP FUNCTION prevent_venue_membership_audit_mutation()"))
    op.drop_index(
        "uq_venue_membership_audit_events_platform_idempotency",
        table_name="venue_membership_audit_events",
    )
    op.drop_index(
        "uq_venue_membership_audit_events_user_idempotency",
        table_name="venue_membership_audit_events",
    )
    op.drop_index(
        "ix_venue_membership_audit_events_venue",
        table_name="venue_membership_audit_events",
    )
    op.drop_table("venue_membership_audit_events")
    op.drop_index(
        "ix_venue_staff_invitations_active_venue",
        table_name="venue_staff_invitations",
    )
    op.drop_table("venue_staff_invitations")

    op.drop_constraint(
        "ck_venue_memberships_role_permissions",
        "venue_memberships",
        type_="check",
    )
    op.drop_constraint(
        "ck_venue_memberships_active_revoked",
        "venue_memberships",
        type_="check",
    )
    op.drop_constraint(
        "ck_venue_memberships_version",
        "venue_memberships",
        type_="check",
    )
    op.drop_index(
        "uq_venue_memberships_active_owner",
        table_name="venue_memberships",
    )
    op.drop_column("venue_memberships", "revoked_at")
    op.drop_column("venue_memberships", "version")
    op.drop_column("venue_memberships", "can_fulfill_orders")
    op.drop_column("venue_memberships", "can_manage_pitches")
    op.drop_column("venue_memberships", "can_manage_profile")
    op.drop_column("venue_memberships", "role")

    bind = op.get_bind()
    postgresql.ENUM(name=AUDIT_ACTOR_KIND_NAME).drop(bind)
    postgresql.ENUM(name=AUDIT_ACTION_NAME).drop(bind)
    postgresql.ENUM(name=INVITATION_STATUS_NAME).drop(bind)
    postgresql.ENUM(name=ROLE_NAME).drop(bind)
