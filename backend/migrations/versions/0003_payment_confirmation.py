"""durable payment attempts and authority state

Revision ID: 0003
Revises: 0002
Create Date: 2026-07-29

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0003"
down_revision: str | Sequence[str] | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _upgrade_enums() -> None:
    # PostgreSQL cannot safely add and consume enum labels in the same transaction.
    # Replace each type after first removing expressions which depend on it.
    op.drop_index("ix_orders_pending_expiry_candidates", table_name="orders")
    op.drop_constraint("ck_orders_status_expired_at", "orders", type_="check")
    op.drop_constraint(
        "ck_idempotency_records_state_response",
        "idempotency_records",
        type_="check",
    )

    op.execute("ALTER TYPE order_status RENAME TO order_status_0002")
    op.execute(
        "CREATE TYPE order_status AS ENUM "
        "('PENDING_PAYMENT', 'CONFIRMED', 'EXPIRED', 'PAYMENT_EXCEPTION')"
    )
    op.execute(
        "ALTER TABLE orders ALTER COLUMN status TYPE order_status "
        "USING status::text::order_status"
    )
    op.execute("DROP TYPE order_status_0002")

    op.execute("ALTER TYPE idempotency_state RENAME TO idempotency_state_0002")
    op.execute(
        "CREATE TYPE idempotency_state AS ENUM ('CLAIMED', 'PROCESSING', 'COMPLETED')"
    )
    op.execute(
        "ALTER TABLE idempotency_records ALTER COLUMN state TYPE idempotency_state "
        "USING state::text::idempotency_state"
    )
    op.execute("DROP TYPE idempotency_state_0002")

    op.create_check_constraint(
        "ck_orders_status_expired_at",
        "orders",
        "(status <> 'EXPIRED' AND expired_at IS NULL) OR "
        "(status = 'EXPIRED' AND expired_at IS NOT NULL AND expired_at >= expires_at)",
    )
    op.create_index(
        "ix_orders_pending_expiry_candidates",
        "orders",
        ["expires_at", "id"],
        unique=False,
        postgresql_where=sa.text("status = 'PENDING_PAYMENT'"),
    )


def upgrade() -> None:
    """Persist payment attempts as the authority for safe expiry."""
    _upgrade_enums()
    op.execute(
        "CREATE TYPE payment_state AS ENUM "
        "('CREATING', 'PREPAY_CREATED', 'CONFIRMING', 'SUCCESS', 'CLOSED', 'UNKNOWN')"
    )
    op.create_table(
        "payments",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("order_id", sa.UUID(), nullable=False),
        sa.Column("provider", sa.String(length=40), nullable=False),
        sa.Column("merchant_order_no", sa.String(length=128), nullable=False),
        sa.Column("provider_transaction_no", sa.String(length=128), nullable=True),
        sa.Column("amount_cents", sa.Integer(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column(
            "status",
            postgresql.ENUM(
                "CREATING",
                "PREPAY_CREATED",
                "CONFIRMING",
                "SUCCESS",
                "CLOSED",
                "UNKNOWN",
                name="payment_state",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("provider_prepay_id", sa.String(length=128), nullable=True),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("authority_unknown_since", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "reconcile_attempts",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column("next_reconcile_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error_code", sa.String(length=80), nullable=True),
        sa.Column("last_error_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notification_result", sa.String(length=40), nullable=True),
        sa.Column("notification_code", sa.String(length=80), nullable=True),
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
            "length(trim(provider)) > 0", name="ck_payments_provider_nonempty"
        ),
        sa.CheckConstraint(
            "length(trim(merchant_order_no)) > 0",
            name="ck_payments_merchant_order_no_nonempty",
        ),
        sa.CheckConstraint("amount_cents >= 0", name="ck_payments_amount_cents"),
        sa.CheckConstraint(
            "length(trim(currency)) > 0", name="ck_payments_currency_nonempty"
        ),
        sa.CheckConstraint(
            "provider_transaction_no IS NULL OR "
            "length(trim(provider_transaction_no)) > 0",
            name="ck_payments_provider_transaction_no_nonempty",
        ),
        sa.CheckConstraint(
            "provider_prepay_id IS NULL OR length(trim(provider_prepay_id)) > 0",
            name="ck_payments_provider_prepay_id_nonempty",
        ),
        sa.CheckConstraint(
            "(status = 'SUCCESS' AND paid_at IS NOT NULL) OR "
            "(status <> 'SUCCESS' AND paid_at IS NULL)",
            name="ck_payments_success_paid_at",
        ),
        sa.CheckConstraint(
            "reconcile_attempts >= 0", name="ck_payments_reconcile_attempts"
        ),
        sa.CheckConstraint(
            "notification_result IS NULL OR length(trim(notification_result)) > 0",
            name="ck_payments_notification_result_nonempty",
        ),
        sa.CheckConstraint(
            "notification_code IS NULL OR length(trim(notification_code)) > 0",
            name="ck_payments_notification_code_nonempty",
        ),
        sa.CheckConstraint(
            "last_error_code IS NULL OR length(trim(last_error_code)) > 0",
            name="ck_payments_last_error_code_nonempty",
        ),
        sa.ForeignKeyConstraint(
            ["order_id"],
            ["orders.id"],
            name="fk_payments_order_id_orders",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "provider",
            "merchant_order_no",
            name="uq_payments_provider_merchant_order_no",
        ),
        sa.UniqueConstraint(
            "provider",
            "provider_transaction_no",
            name="uq_payments_provider_transaction_no",
        ),
    )
    op.create_index("ix_payments_order_id", "payments", ["order_id"], unique=False)
    op.create_index(
        "uq_payments_one_nonterminal_per_order",
        "payments",
        ["order_id"],
        unique=True,
        postgresql_where=sa.text(
            "status IN ('CREATING', 'PREPAY_CREATED', 'CONFIRMING', 'UNKNOWN')"
        ),
    )
    op.create_index(
        "ix_payments_reconciliation_due",
        "payments",
        ["next_reconcile_at", "id"],
        unique=False,
        postgresql_where=sa.text(
            "status IN ('CREATING', 'PREPAY_CREATED', 'CONFIRMING', 'UNKNOWN') "
            "AND next_reconcile_at IS NOT NULL"
        ),
    )

    op.add_column(
        "idempotency_records", sa.Column("payment_id", sa.UUID(), nullable=True)
    )
    op.create_foreign_key(
        "fk_idempotency_records_payment_id_payments",
        "idempotency_records",
        "payments",
        ["payment_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index(
        "ix_idempotency_records_payment_id",
        "idempotency_records",
        ["payment_id"],
        unique=False,
    )
    op.create_check_constraint(
        "ck_idempotency_records_state_response",
        "idempotency_records",
        "(state = 'CLAIMED' AND payment_id IS NULL "
        "AND response_status IS NULL AND response_body IS NULL) OR "
        "(state = 'PROCESSING' AND payment_id IS NOT NULL "
        "AND response_status IS NULL AND response_body IS NULL) OR "
        "(state = 'COMPLETED' AND response_status IS NOT NULL AND response_body IS NOT NULL)",
    )

    # Candidate scans remain an application concern because PostgreSQL partial-index
    # predicates cannot contain a payments anti-join. This trigger is the final
    # database boundary preventing an unsafe transition to EXPIRED.
    op.execute(
        """
        CREATE FUNCTION enforce_order_expiry_payment_authority()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            IF NEW.status = 'EXPIRED' AND OLD.status IS DISTINCT FROM NEW.status
               AND EXISTS (
                   SELECT 1 FROM payments
                   WHERE order_id = NEW.id
                     AND status IN (
                         'CREATING', 'PREPAY_CREATED', 'CONFIRMING',
                         'UNKNOWN', 'SUCCESS'
                     )
               )
            THEN
                RAISE EXCEPTION 'order has unresolved or successful payment authority'
                    USING ERRCODE = '23514',
                          CONSTRAINT = 'ck_orders_expiry_payment_authority';
            END IF;
            RETURN NEW;
        END;
        $$
        """
    )
    op.execute(
        "CREATE TRIGGER trg_orders_expiry_payment_authority "
        "BEFORE UPDATE OF status ON orders "
        "FOR EACH ROW EXECUTE FUNCTION enforce_order_expiry_payment_authority()"
    )
    op.execute(
        """
        CREATE FUNCTION enforce_payment_order_not_expired()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        DECLARE
            parent_order_status text;
        BEGIN
            IF NEW.status IN (
                'CREATING', 'PREPAY_CREATED', 'CONFIRMING', 'UNKNOWN', 'SUCCESS'
            )
            THEN
                SELECT status::text INTO parent_order_status
                FROM orders
                WHERE id = NEW.order_id
                FOR UPDATE;

                -- Let the named foreign key report a missing parent. For an
                -- existing parent, this row lock serializes payment authority
                -- with the order-side expiry transition.
                IF FOUND AND parent_order_status = 'EXPIRED'
                THEN
                    RAISE EXCEPTION 'authoritative payment cannot belong to expired order'
                        USING ERRCODE = '23514',
                              CONSTRAINT = 'ck_payments_order_not_expired';
                END IF;
            END IF;
            RETURN NEW;
        END;
        $$
        """
    )
    op.execute(
        "CREATE TRIGGER trg_payments_order_not_expired "
        "BEFORE INSERT OR UPDATE OF order_id, status ON payments "
        "FOR EACH ROW EXECUTE FUNCTION enforce_payment_order_not_expired()"
    )


def _downgrade_enums() -> None:
    op.drop_index("ix_orders_pending_expiry_candidates", table_name="orders")
    op.drop_constraint("ck_orders_status_expired_at", "orders", type_="check")
    op.execute("ALTER TYPE order_status RENAME TO order_status_0003")
    op.execute("CREATE TYPE order_status AS ENUM ('PENDING_PAYMENT', 'EXPIRED')")
    # Intentionally fails if newer statuses contain data; downgrade never rewrites them.
    op.execute(
        "ALTER TABLE orders ALTER COLUMN status TYPE order_status "
        "USING status::text::order_status"
    )
    op.execute("DROP TYPE order_status_0003")

    op.execute("ALTER TYPE idempotency_state RENAME TO idempotency_state_0003")
    op.execute("CREATE TYPE idempotency_state AS ENUM ('CLAIMED', 'COMPLETED')")
    # Intentionally fails if PROCESSING rows exist; downgrade never rewrites them.
    op.execute(
        "ALTER TABLE idempotency_records ALTER COLUMN state TYPE idempotency_state "
        "USING state::text::idempotency_state"
    )
    op.execute("DROP TYPE idempotency_state_0003")

    op.create_check_constraint(
        "ck_orders_status_expired_at",
        "orders",
        "(status = 'PENDING_PAYMENT' AND expired_at IS NULL) OR "
        "(status = 'EXPIRED' AND expired_at IS NOT NULL AND expired_at >= expires_at)",
    )
    op.create_index(
        "ix_orders_pending_expiry_candidates",
        "orders",
        ["expires_at", "id"],
        unique=False,
        postgresql_where=sa.text(
            "status = 'PENDING_PAYMENT' AND wechat_prepay_id IS NULL"
        ),
    )
    op.create_check_constraint(
        "ck_idempotency_records_state_response",
        "idempotency_records",
        "(state = 'CLAIMED' AND response_status IS NULL AND response_body IS NULL) OR "
        "(state = 'COMPLETED' AND response_status IS NOT NULL AND response_body IS NOT NULL)",
    )


def downgrade() -> None:
    """Remove payment authority without rewriting newer enum values."""
    op.execute("DROP TRIGGER trg_payments_order_not_expired ON payments")
    op.execute("DROP FUNCTION enforce_payment_order_not_expired()")
    op.execute("DROP TRIGGER trg_orders_expiry_payment_authority ON orders")
    op.execute("DROP FUNCTION enforce_order_expiry_payment_authority()")
    op.drop_constraint(
        "ck_idempotency_records_state_response",
        "idempotency_records",
        type_="check",
    )
    op.drop_index("ix_idempotency_records_payment_id", table_name="idempotency_records")
    op.drop_constraint(
        "fk_idempotency_records_payment_id_payments",
        "idempotency_records",
        type_="foreignkey",
    )
    op.drop_column("idempotency_records", "payment_id")
    op.drop_index("ix_payments_reconciliation_due", table_name="payments")
    op.drop_index("uq_payments_one_nonterminal_per_order", table_name="payments")
    op.drop_index("ix_payments_order_id", table_name="payments")
    op.drop_table("payments")
    op.execute("DROP TYPE payment_state")
    _downgrade_enums()
