"""booking users and orders

Revision ID: 0002
Revises: 0001
Create Date: 2026-07-27

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0002"
down_revision: str | Sequence[str] | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the booking identity, order, and idempotency schema."""
    op.create_table(
        "users",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("wechat_app_id", sa.String(length=128), nullable=False),
        sa.Column("wechat_openid", sa.String(length=128), nullable=False),
        sa.Column("wechat_unionid", sa.String(length=128), nullable=True),
        sa.Column("phone_ciphertext", sa.LargeBinary(), nullable=True),
        sa.Column("phone_nonce", sa.LargeBinary(), nullable=True),
        sa.Column("phone_key_version", sa.Integer(), nullable=True),
        sa.Column("phone_verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_contact_name", sa.String(length=40), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "(phone_ciphertext IS NULL AND phone_nonce IS NULL "
            "AND phone_key_version IS NULL AND phone_verified_at IS NULL) OR "
            "(phone_ciphertext IS NOT NULL AND phone_nonce IS NOT NULL "
            "AND phone_key_version IS NOT NULL AND phone_verified_at IS NOT NULL)",
            name="ck_users_phone_encrypted_fields",
        ),
        sa.CheckConstraint(
            "phone_key_version IS NULL OR phone_key_version > 0",
            name="ck_users_phone_key_version",
        ),
        sa.CheckConstraint(
            "phone_nonce IS NULL OR octet_length(phone_nonce) = 12",
            name="ck_users_phone_nonce_length",
        ),
        sa.CheckConstraint(
            "phone_ciphertext IS NULL OR octet_length(phone_ciphertext) >= 16",
            name="ck_users_phone_ciphertext_length",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "wechat_app_id", "wechat_openid", name="uq_users_wechat_app_openid"
        ),
        sa.UniqueConstraint("wechat_unionid", name="uq_users_wechat_unionid"),
    )
    op.create_table(
        "user_sessions",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column(
            "issued_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "token_hash ~ '^[0-9a-f]{64}$'", name="ck_user_sessions_token_hash"
        ),
        sa.CheckConstraint("expires_at > issued_at", name="ck_user_sessions_expiry"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_user_sessions_user_id_users",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash", name="uq_user_sessions_token_hash"),
    )
    op.create_index("ix_user_sessions_user_id", "user_sessions", ["user_id"], unique=False)

    op.create_table(
        "orders",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("order_number", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("slot_id", sa.UUID(), nullable=False),
        sa.Column(
            "status",
            sa.Enum("PENDING_PAYMENT", "EXPIRED", name="order_status"),
            nullable=False,
        ),
        sa.Column("price_cents", sa.Integer(), nullable=False),
        sa.Column("contact_name", sa.String(length=40), nullable=False),
        sa.Column("contact_phone_ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column("contact_phone_nonce", sa.LargeBinary(), nullable=False),
        sa.Column("contact_phone_key_version", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expired_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("wechat_prepay_id", sa.String(length=128), nullable=True),
        sa.CheckConstraint(
            "length(trim(contact_name)) BETWEEN 1 AND 40", name="ck_orders_contact_name"
        ),
        sa.CheckConstraint(
            "contact_phone_ciphertext IS NOT NULL AND contact_phone_nonce IS NOT NULL "
            "AND contact_phone_key_version > 0",
            name="ck_orders_contact_phone_encrypted_fields",
        ),
        sa.CheckConstraint(
            "octet_length(contact_phone_nonce) = 12",
            name="ck_orders_contact_phone_nonce_length",
        ),
        sa.CheckConstraint(
            "octet_length(contact_phone_ciphertext) >= 16",
            name="ck_orders_contact_phone_ciphertext_length",
        ),
        sa.CheckConstraint("expires_at > created_at", name="ck_orders_expiry"),
        sa.CheckConstraint(
            "(status = 'PENDING_PAYMENT' AND expired_at IS NULL) OR "
            "(status = 'EXPIRED' AND expired_at IS NOT NULL AND expired_at >= expires_at)",
            name="ck_orders_status_expired_at",
        ),
        sa.CheckConstraint("price_cents >= 0", name="ck_orders_price_cents"),
        sa.ForeignKeyConstraint(
            ["slot_id"],
            ["slots.id"],
            name="fk_orders_slot_id_slots",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_orders_user_id_users",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("order_number", name="uq_orders_order_number"),
    )
    op.create_index("ix_orders_slot_id", "orders", ["slot_id"], unique=False)
    op.create_index("ix_orders_user_id", "orders", ["user_id"], unique=False)
    op.create_index(
        "ix_orders_pending_expiry_candidates",
        "orders",
        ["expires_at", "id"],
        unique=False,
        postgresql_where=sa.text(
            "status = 'PENDING_PAYMENT' AND wechat_prepay_id IS NULL"
        ),
    )

    op.create_table(
        "idempotency_records",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("operation", sa.String(length=80), nullable=False),
        sa.Column("key", sa.String(length=255), nullable=False),
        sa.Column("request_sha256", sa.String(length=64), nullable=False),
        sa.Column(
            "state",
            sa.Enum("CLAIMED", "COMPLETED", name="idempotency_state"),
            nullable=False,
        ),
        sa.Column("response_status", sa.Integer(), nullable=True),
        sa.Column("response_body", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
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
            "length(trim(operation)) > 0", name="ck_idempotency_records_operation"
        ),
        sa.CheckConstraint("length(key) > 0", name="ck_idempotency_records_key"),
        sa.CheckConstraint(
            "request_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_idempotency_records_request_sha256",
        ),
        sa.CheckConstraint(
            "response_status IS NULL OR response_status BETWEEN 100 AND 599",
            name="ck_idempotency_records_response_status",
        ),
        sa.CheckConstraint(
            "(state = 'CLAIMED' AND response_status IS NULL AND response_body IS NULL) OR "
            "(state = 'COMPLETED' AND response_status IS NOT NULL AND response_body IS NOT NULL)",
            name="ck_idempotency_records_state_response",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_idempotency_records_user_id_users",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id",
            "operation",
            "key",
            name="uq_idempotency_records_user_operation_key",
        ),
    )
    op.create_index(
        "ix_idempotency_records_user_id", "idempotency_records", ["user_id"], unique=False
    )

    op.add_column(
        "slots",
        sa.Column(
            "checkout_version", sa.BigInteger(), server_default=sa.text("1"), nullable=True
        ),
    )
    op.execute("UPDATE slots SET checkout_version = 1 WHERE checkout_version IS NULL")
    op.alter_column(
        "slots",
        "checkout_version",
        existing_type=sa.BigInteger(),
        existing_server_default=sa.text("1"),
        nullable=False,
    )
    # Revision 0001 had no orders table, so a legacy LOCKED slot cannot be
    # linked to a real order. Release those stale holds atomically before the
    # new foreign key is validated; the existing lock-fields check remains true.
    op.execute(
        "UPDATE slots SET status = 'AVAILABLE', locked_until = NULL, "
        "locked_by_order_id = NULL WHERE status = 'LOCKED'"
    )
    op.create_foreign_key(
        "fk_slots_locked_by_order_id_orders",
        "slots",
        "orders",
        ["locked_by_order_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index(
        "ix_slots_locked_by_order_id", "slots", ["locked_by_order_id"], unique=False
    )


def downgrade() -> None:
    """Remove booking tables without violating circular dependencies."""
    op.drop_index("ix_slots_locked_by_order_id", table_name="slots")
    op.drop_constraint(
        "fk_slots_locked_by_order_id_orders", "slots", type_="foreignkey"
    )
    op.drop_column("slots", "checkout_version")

    op.drop_index("ix_idempotency_records_user_id", table_name="idempotency_records")
    op.drop_table("idempotency_records")
    op.drop_index("ix_orders_user_id", table_name="orders")
    op.drop_index("ix_orders_slot_id", table_name="orders")
    op.drop_table("orders")
    op.drop_index("ix_user_sessions_user_id", table_name="user_sessions")
    op.drop_table("user_sessions")
    op.drop_table("users")
    op.execute("DROP TYPE IF EXISTS idempotency_state")
    op.execute("DROP TYPE IF EXISTS order_status")
