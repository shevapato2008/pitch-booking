"""persist order lifecycle and refund authority

Revision ID: 0013
Revises: 0012
Create Date: 2026-08-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0013"
down_revision: str | Sequence[str] | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_CANCELLATION_STATES = "'CANCELLED', 'REFUND_PENDING', 'REFUND_FAILED', 'REFUNDED'"


def _drop_order_expiry_payment_authority() -> None:
    op.execute("DROP TRIGGER trg_orders_expiry_payment_authority ON orders")
    op.execute("DROP FUNCTION enforce_order_expiry_payment_authority()")


def _create_order_expiry_payment_authority() -> None:
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


def _upgrade_order_status() -> None:
    op.drop_index("ix_orders_pending_expiry_candidates", table_name="orders")
    op.drop_constraint("ck_orders_status_expired_at", "orders", type_="check")
    op.execute("ALTER TYPE order_status RENAME TO order_status_0012")
    op.execute(
        "CREATE TYPE order_status AS ENUM ("
        "'PENDING_PAYMENT', 'CONFIRMED', 'EXPIRED', 'PAYMENT_EXCEPTION', "
        "'CANCELLED', 'REFUND_PENDING', 'REFUND_FAILED', 'REFUNDED', 'COMPLETED')"
    )
    op.execute(
        "ALTER TABLE orders ALTER COLUMN status TYPE order_status "
        "USING status::text::order_status"
    )
    op.execute("DROP TYPE order_status_0012")


def _create_order_constraints() -> None:
    op.create_check_constraint(
        "ck_orders_status_expired_at",
        "orders",
        "(status <> 'EXPIRED' AND expired_at IS NULL) OR "
        "(status = 'EXPIRED' AND expired_at IS NOT NULL AND expired_at >= expires_at)",
    )
    op.create_check_constraint(
        "ck_orders_cancellation_timestamps",
        "orders",
        f"(status IN ({_CANCELLATION_STATES}) "
        "AND cancel_requested_at IS NOT NULL AND cancelled_at IS NOT NULL "
        "AND cancelled_at >= cancel_requested_at) OR "
        f"(status NOT IN ({_CANCELLATION_STATES}) AND cancelled_at IS NULL)",
    )
    op.create_check_constraint(
        "ck_orders_check_in_pair",
        "orders",
        "((checked_in_at IS NULL) = (checked_in_by_user_id IS NULL)) AND "
        "(checked_in_at IS NULL OR status IN ('CONFIRMED', 'COMPLETED'))",
    )
    op.create_check_constraint(
        "ck_orders_completion_pair",
        "orders",
        "(status = 'COMPLETED' AND checked_in_at IS NOT NULL "
        "AND completed_at IS NOT NULL AND completed_by_user_id IS NOT NULL "
        "AND completed_at >= checked_in_at) OR "
        "(status <> 'COMPLETED' AND completed_at IS NULL "
        "AND completed_by_user_id IS NULL)",
    )
    op.create_index(
        "ix_orders_pending_expiry_candidates",
        "orders",
        ["expires_at", "id"],
        unique=False,
        postgresql_where=sa.text("status = 'PENDING_PAYMENT'"),
    )


def _create_payment_applied_authority() -> None:
    op.add_column(
        "payments",
        sa.Column("applied_to_order_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute(
        """
        DO $$
        DECLARE
            ambiguous_order_id uuid;
        BEGIN
            SELECT o.id INTO ambiguous_order_id
            FROM orders o
            LEFT JOIN payments p
              ON p.order_id = o.id AND p.status = 'SUCCESS'
            WHERE o.status = 'CONFIRMED'
            GROUP BY o.id
            HAVING count(p.id) <> 1
            LIMIT 1;

            IF ambiguous_order_id IS NOT NULL THEN
                RAISE EXCEPTION 'confirmed order has ambiguous successful payment authority'
                    USING ERRCODE = '23514',
                          CONSTRAINT = 'ck_orders_confirmed_payment_authority';
            END IF;
        END;
        $$
        """
    )
    op.execute(
        "UPDATE payments p SET applied_to_order_at = p.paid_at "
        "FROM orders o WHERE o.id = p.order_id "
        "AND o.status = 'CONFIRMED' AND p.status = 'SUCCESS'"
    )
    op.create_check_constraint(
        "ck_payments_applied_success",
        "payments",
        "applied_to_order_at IS NULL OR status = 'SUCCESS'",
    )
    op.create_index(
        "uq_payments_one_applied_per_order",
        "payments",
        ["order_id"],
        unique=True,
        postgresql_where=sa.text("applied_to_order_at IS NOT NULL"),
    )
    op.execute(
        """
        CREATE FUNCTION enforce_payment_applied_to_order_immutable()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            IF OLD.applied_to_order_at IS NOT NULL
               AND NEW.applied_to_order_at IS DISTINCT FROM OLD.applied_to_order_at
            THEN
                RAISE EXCEPTION 'applied payment authority is immutable'
                    USING ERRCODE = '23514',
                          CONSTRAINT = 'ck_payments_applied_to_order_immutable';
            END IF;
            RETURN NEW;
        END;
        $$
        """
    )
    op.execute(
        "CREATE TRIGGER trg_payments_applied_to_order_immutable "
        "BEFORE UPDATE OF applied_to_order_at ON payments "
        "FOR EACH ROW EXECUTE FUNCTION enforce_payment_applied_to_order_immutable()"
    )


def _create_refund_types() -> None:
    op.execute(
        "CREATE TYPE refund_case_purpose AS ENUM ("
        "'ORDER_CANCELLATION', 'DUPLICATE_CHARGE', 'PAYMENT_INVENTORY_CONFLICT')"
    )
    op.execute(
        "CREATE TYPE refund_reason AS ENUM ("
        "'USER_CANCELLED', 'VENUE_CANCELLED', 'AUTOMATIC_RECOVERY')"
    )
    op.execute(
        "CREATE TYPE refund_attempt_status AS ENUM ("
        "'CREATING', 'PROCESSING', 'SUCCESS', 'FAILED', 'UNKNOWN')"
    )


def _create_refund_tables() -> None:
    purpose = postgresql.ENUM(
        "ORDER_CANCELLATION",
        "DUPLICATE_CHARGE",
        "PAYMENT_INVENTORY_CONFLICT",
        name="refund_case_purpose",
        create_type=False,
    )
    reason = postgresql.ENUM(
        "USER_CANCELLED",
        "VENUE_CANCELLED",
        "AUTOMATIC_RECOVERY",
        name="refund_reason",
        create_type=False,
    )
    attempt_status = postgresql.ENUM(
        "CREATING",
        "PROCESSING",
        "SUCCESS",
        "FAILED",
        "UNKNOWN",
        name="refund_attempt_status",
        create_type=False,
    )
    op.create_table(
        "refund_cases",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("order_id", sa.UUID(), nullable=False),
        sa.Column("payment_id", sa.UUID(), nullable=False),
        sa.Column("purpose", purpose, nullable=False),
        sa.Column("reason", reason, nullable=False),
        sa.Column("reason_note", sa.Text(), nullable=True),
        sa.Column("requested_by_user_id", sa.UUID(), nullable=True),
        sa.Column("amount_cents", sa.Integer(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
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
        sa.CheckConstraint("amount_cents >= 0", name="ck_refund_cases_amount_cents"),
        sa.CheckConstraint(
            "length(trim(currency)) > 0",
            name="ck_refund_cases_currency_nonempty",
        ),
        sa.CheckConstraint(
            "(reason = 'VENUE_CANCELLED' AND reason_note IS NOT NULL "
            "AND length(trim(reason_note)) BETWEEN 1 AND 500 "
            "AND reason_note = trim(reason_note)) OR "
            "(reason <> 'VENUE_CANCELLED' AND reason_note IS NULL)",
            name="ck_refund_cases_reason_note",
        ),
        sa.ForeignKeyConstraint(
            ["order_id"],
            ["orders.id"],
            name="fk_refund_cases_order_id_orders",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["payment_id"],
            ["payments.id"],
            name="fk_refund_cases_payment_id_payments",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["requested_by_user_id"],
            ["users.id"],
            name="fk_refund_cases_requested_by_user_id_users",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_refund_cases"),
        sa.UniqueConstraint("payment_id", name="uq_refund_cases_payment_id"),
    )
    op.create_index("ix_refund_cases_order_id", "refund_cases", ["order_id"])
    op.create_table(
        "refund_attempts",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("refund_case_id", sa.UUID(), nullable=False),
        sa.Column("provider", sa.String(length=40), nullable=False),
        sa.Column("merchant_refund_no", sa.String(length=32), nullable=False),
        sa.Column("provider_refund_no", sa.String(length=128), nullable=True),
        sa.Column("status", attempt_status, nullable=False),
        sa.Column("attempt_no", sa.Integer(), nullable=False),
        sa.Column("failure_code", sa.String(length=80), nullable=True),
        sa.Column("next_reconcile_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reconcile_claim_token", sa.UUID(), nullable=True),
        sa.Column("reconcile_lease_until", sa.DateTime(timezone=True), nullable=True),
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
        sa.Column("refunded_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "length(trim(provider)) > 0",
            name="ck_refund_attempts_provider_nonempty",
        ),
        sa.CheckConstraint(
            "length(trim(merchant_refund_no)) BETWEEN 1 AND 32",
            name="ck_refund_attempts_merchant_refund_no",
        ),
        sa.CheckConstraint(
            "provider_refund_no IS NULL OR length(trim(provider_refund_no)) > 0",
            name="ck_refund_attempts_provider_refund_no",
        ),
        sa.CheckConstraint("attempt_no >= 1", name="ck_refund_attempts_attempt_no"),
        sa.CheckConstraint(
            "failure_code IS NULL OR length(trim(failure_code)) > 0",
            name="ck_refund_attempts_failure_code",
        ),
        sa.CheckConstraint(
            "status <> 'SUCCESS' OR refunded_at IS NOT NULL",
            name="ck_refund_attempts_success_refunded_at",
        ),
        sa.CheckConstraint(
            "(reconcile_claim_token IS NULL) = (reconcile_lease_until IS NULL)",
            name="ck_refund_attempts_reconcile_lease_pair",
        ),
        sa.ForeignKeyConstraint(
            ["refund_case_id"],
            ["refund_cases.id"],
            name="fk_refund_attempts_case_id_refund_cases",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_refund_attempts"),
        sa.UniqueConstraint(
            "provider",
            "merchant_refund_no",
            name="uq_refund_attempts_provider_merchant_refund_no",
        ),
        sa.UniqueConstraint(
            "refund_case_id",
            "attempt_no",
            name="uq_refund_attempts_case_attempt_no",
        ),
    )
    op.create_index(
        "ix_refund_attempts_case_id", "refund_attempts", ["refund_case_id"]
    )
    op.create_index(
        "uq_refund_attempts_one_active_per_case",
        "refund_attempts",
        ["refund_case_id"],
        unique=True,
        postgresql_where=sa.text("status IN ('CREATING', 'PROCESSING', 'UNKNOWN')"),
    )
    op.create_index(
        "ix_refund_attempts_reconciliation_due",
        "refund_attempts",
        ["next_reconcile_at", "id"],
        postgresql_where=sa.text(
            "status IN ('CREATING', 'PROCESSING', 'UNKNOWN') "
            "AND next_reconcile_at IS NOT NULL"
        ),
    )


def _create_refund_payment_boundary() -> None:
    op.execute(
        """
        CREATE FUNCTION enforce_refund_case_payment_authority()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        DECLARE
            payment_order_id uuid;
            payment_amount_cents integer;
            payment_currency text;
            payment_status text;
        BEGIN
            SELECT order_id, amount_cents, currency, status::text
              INTO payment_order_id, payment_amount_cents,
                   payment_currency, payment_status
            FROM payments
            WHERE id = NEW.payment_id;

            IF NOT FOUND OR payment_status <> 'SUCCESS'
               OR payment_order_id IS DISTINCT FROM NEW.order_id
               OR payment_amount_cents IS DISTINCT FROM NEW.amount_cents
               OR payment_currency IS DISTINCT FROM NEW.currency
            THEN
                RAISE EXCEPTION 'refund case does not match successful payment authority'
                    USING ERRCODE = '23514',
                          CONSTRAINT = 'ck_refund_cases_payment_authority';
            END IF;
            RETURN NEW;
        END;
        $$
        """
    )
    op.execute(
        "CREATE TRIGGER trg_refund_cases_payment_authority "
        "BEFORE INSERT OR UPDATE OF order_id, payment_id, amount_cents, currency "
        "ON refund_cases FOR EACH ROW "
        "EXECUTE FUNCTION enforce_refund_case_payment_authority()"
    )


def upgrade() -> None:
    _drop_order_expiry_payment_authority()
    _upgrade_order_status()
    _create_order_expiry_payment_authority()
    op.add_column(
        "orders", sa.Column("cancel_requested_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "orders", sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "orders", sa.Column("checked_in_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("orders", sa.Column("checked_in_by_user_id", sa.UUID(), nullable=True))
    op.add_column(
        "orders", sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("orders", sa.Column("completed_by_user_id", sa.UUID(), nullable=True))
    op.create_foreign_key(
        "fk_orders_checked_in_by_user_id_users",
        "orders",
        "users",
        ["checked_in_by_user_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        "fk_orders_completed_by_user_id_users",
        "orders",
        "users",
        ["completed_by_user_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    _create_order_constraints()
    _create_payment_applied_authority()
    _create_refund_types()
    _create_refund_tables()
    _create_refund_payment_boundary()


def _downgrade_order_status() -> None:
    op.drop_index("ix_orders_pending_expiry_candidates", table_name="orders")
    op.drop_constraint("ck_orders_status_expired_at", "orders", type_="check")
    op.execute("ALTER TYPE order_status RENAME TO order_status_0013")
    op.execute(
        "CREATE TYPE order_status AS ENUM ("
        "'PENDING_PAYMENT', 'CONFIRMED', 'EXPIRED', 'PAYMENT_EXCEPTION')"
    )
    # Intentionally fails if a new lifecycle state is present; no state is coerced.
    op.execute(
        "ALTER TABLE orders ALTER COLUMN status TYPE order_status "
        "USING status::text::order_status"
    )
    op.execute("DROP TYPE order_status_0013")
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


def downgrade() -> None:
    op.execute("DROP TRIGGER trg_refund_cases_payment_authority ON refund_cases")
    op.execute("DROP FUNCTION enforce_refund_case_payment_authority()")
    op.drop_index("ix_refund_attempts_reconciliation_due", table_name="refund_attempts")
    op.drop_index("uq_refund_attempts_one_active_per_case", table_name="refund_attempts")
    op.drop_index("ix_refund_attempts_case_id", table_name="refund_attempts")
    op.drop_table("refund_attempts")
    op.drop_index("ix_refund_cases_order_id", table_name="refund_cases")
    op.drop_table("refund_cases")
    op.execute("DROP TYPE refund_attempt_status")
    op.execute("DROP TYPE refund_reason")
    op.execute("DROP TYPE refund_case_purpose")

    op.execute("DROP TRIGGER trg_payments_applied_to_order_immutable ON payments")
    op.execute("DROP FUNCTION enforce_payment_applied_to_order_immutable()")
    op.drop_index("uq_payments_one_applied_per_order", table_name="payments")
    op.drop_constraint("ck_payments_applied_success", "payments", type_="check")
    op.drop_column("payments", "applied_to_order_at")

    op.drop_constraint("ck_orders_completion_pair", "orders", type_="check")
    op.drop_constraint("ck_orders_check_in_pair", "orders", type_="check")
    op.drop_constraint("ck_orders_cancellation_timestamps", "orders", type_="check")
    op.drop_constraint(
        "fk_orders_completed_by_user_id_users", "orders", type_="foreignkey"
    )
    op.drop_constraint(
        "fk_orders_checked_in_by_user_id_users", "orders", type_="foreignkey"
    )
    op.drop_column("orders", "completed_by_user_id")
    op.drop_column("orders", "completed_at")
    op.drop_column("orders", "checked_in_by_user_id")
    op.drop_column("orders", "checked_in_at")
    op.drop_column("orders", "cancelled_at")
    op.drop_column("orders", "cancel_requested_at")
    _drop_order_expiry_payment_authority()
    _downgrade_order_status()
    _create_order_expiry_payment_authority()
