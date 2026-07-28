import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID, ExcludeConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class ImageRole(StrEnum):
    COVER = "COVER"
    GALLERY = "GALLERY"


class FacilityCode(StrEnum):
    LIGHTING = "LIGHTING"
    CHANGING_ROOM = "CHANGING_ROOM"
    DRINKING_WATER = "DRINKING_WATER"
    PARKING = "PARKING"


class PitchType(StrEnum):
    FIVE_A_SIDE = "FIVE_A_SIDE"
    SEVEN_A_SIDE = "SEVEN_A_SIDE"


class SlotStatus(StrEnum):
    AVAILABLE = "AVAILABLE"
    LOCKED = "LOCKED"
    BOOKED = "BOOKED"
    CLOSED = "CLOSED"


class OrderStatus(StrEnum):
    PENDING_PAYMENT = "PENDING_PAYMENT"
    CONFIRMED = "CONFIRMED"
    EXPIRED = "EXPIRED"
    PAYMENT_EXCEPTION = "PAYMENT_EXCEPTION"


class PaymentState(StrEnum):
    CREATING = "CREATING"
    PREPAY_CREATED = "PREPAY_CREATED"
    CONFIRMING = "CONFIRMING"
    SUCCESS = "SUCCESS"
    CLOSED = "CLOSED"
    UNKNOWN = "UNKNOWN"


class IdempotencyState(StrEnum):
    CLAIMED = "CLAIMED"
    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"


class Base(DeclarativeBase):
    pass


class Venue(Base):
    __tablename__ = "venues"
    __table_args__ = (
        CheckConstraint("length(trim(slug)) > 0", name="ck_venues_slug_nonempty"),
        CheckConstraint("length(trim(name)) > 0", name="ck_venues_name_nonempty"),
        CheckConstraint("latitude BETWEEN -90 AND 90", name="ck_venues_latitude"),
        CheckConstraint("longitude BETWEEN -180 AND 180", name="ck_venues_longitude"),
        Index(
            "uq_one_active_primary_venue",
            text("(true)"),
            unique=True,
            postgresql_where=text("is_primary AND is_active"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String(120), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text)
    price_advantage_text: Mapped[str] = mapped_column(Text)
    timezone: Mapped[str] = mapped_column(String(80))
    business_hours_text: Mapped[str] = mapped_column(Text)
    address: Mapped[str] = mapped_column(Text)
    parking_text: Mapped[str] = mapped_column(Text)
    phone: Mapped[str] = mapped_column(String(40))
    refund_policy_text: Mapped[str] = mapped_column(Text)
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    images: Mapped[list["VenueImage"]] = relationship(
        back_populates="venue", cascade="all, delete-orphan"
    )
    facilities: Mapped[list["VenueFacility"]] = relationship(
        back_populates="venue", cascade="all, delete-orphan"
    )
    pitches: Mapped[list["Pitch"]] = relationship(back_populates="venue")


class VenueImage(Base):
    __tablename__ = "venue_images"
    __table_args__ = (
        CheckConstraint("url ~ '^https://'", name="ck_venue_images_https_url"),
        CheckConstraint("length(trim(alt)) > 0", name="ck_venue_images_alt_nonempty"),
        CheckConstraint("sort_order >= 0", name="ck_venue_images_sort_order"),
        Index(
            "uq_one_cover_per_venue",
            "venue_id",
            unique=True,
            postgresql_where=text("role = 'COVER'"),
        ),
        Index("ix_venue_images_venue_id", "venue_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    venue_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("venues.id", ondelete="CASCADE")
    )
    url: Mapped[str] = mapped_column(Text)
    alt: Mapped[str] = mapped_column(Text)
    role: Mapped[ImageRole] = mapped_column(Enum(ImageRole, name="image_role"))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    venue: Mapped[Venue] = relationship(back_populates="images")


class VenueFacility(Base):
    __tablename__ = "venue_facilities"
    __table_args__ = (
        CheckConstraint("length(trim(name)) > 0", name="ck_venue_facilities_name_nonempty"),
        CheckConstraint("sort_order >= 0", name="ck_venue_facilities_sort_order"),
        UniqueConstraint("venue_id", "code", name="uq_venue_facilities_venue_code"),
        Index("ix_venue_facilities_venue_id", "venue_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    venue_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("venues.id", ondelete="CASCADE")
    )
    code: Mapped[FacilityCode] = mapped_column(Enum(FacilityCode, name="facility_code"))
    name: Mapped[str] = mapped_column(String(120))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    venue: Mapped[Venue] = relationship(back_populates="facilities")


class Pitch(Base):
    __tablename__ = "pitches"
    __table_args__ = (
        CheckConstraint("length(trim(code)) > 0", name="ck_pitches_code_nonempty"),
        CheckConstraint("length(trim(name)) > 0", name="ck_pitches_name_nonempty"),
        CheckConstraint("sort_order >= 0", name="ck_pitches_sort_order"),
        UniqueConstraint("venue_id", "code", name="uq_pitches_venue_code"),
        Index("ix_pitches_venue_id", "venue_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    venue_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("venues.id", ondelete="RESTRICT")
    )
    code: Mapped[str] = mapped_column(String(80))
    name: Mapped[str] = mapped_column(String(120))
    pitch_type: Mapped[PitchType] = mapped_column(Enum(PitchType, name="pitch_type"))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    venue: Mapped[Venue] = relationship(back_populates="pitches")
    slots: Mapped[list["Slot"]] = relationship(back_populates="pitch")


class Slot(Base):
    __tablename__ = "slots"
    __table_args__ = (
        CheckConstraint("price_cents >= 0", name="ck_slots_price_cents"),
        CheckConstraint("starts_at < ends_at", name="ck_slots_time_order"),
        CheckConstraint(
            "date(starts_at AT TIME ZONE 'Asia/Shanghai') = "
            "date((ends_at - INTERVAL '1 microsecond') AT TIME ZONE 'Asia/Shanghai')",
            name="ck_slots_same_local_day",
        ),
        CheckConstraint(
            "(status = 'LOCKED' AND locked_until IS NOT NULL AND locked_by_order_id IS NOT NULL) "
            "OR (status <> 'LOCKED' AND locked_until IS NULL AND locked_by_order_id IS NULL)",
            name="ck_slots_lock_fields",
        ),
        UniqueConstraint("pitch_id", "starts_at", "ends_at", name="uq_slots_pitch_time"),
        ExcludeConstraint(
            ("pitch_id", "="),
            (func.tstzrange(text("starts_at"), text("ends_at"), "[)"), "&&"),
            using="gist",
            name="ex_slots_no_overlap",
        ),
        Index("ix_slots_pitch_id", "pitch_id"),
        Index("ix_slots_locked_by_order_id", "locked_by_order_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pitch_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("pitches.id", ondelete="RESTRICT")
    )
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[SlotStatus] = mapped_column(Enum(SlotStatus, name="slot_status"))
    price_cents: Mapped[int] = mapped_column(Integer)
    checkout_version: Mapped[int] = mapped_column(
        BigInteger, default=1, server_default=text("1")
    )
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    locked_by_order_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "orders.id",
            name="fk_slots_locked_by_order_id_orders",
            ondelete="RESTRICT",
        ),
        nullable=True,
    )

    pitch: Mapped[Pitch] = relationship(back_populates="slots")
    orders: Mapped[list["Order"]] = relationship(
        back_populates="slot", foreign_keys="Order.slot_id"
    )
    locked_order: Mapped["Order | None"] = relationship(
        foreign_keys=[locked_by_order_id], post_update=True
    )


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(
            "(phone_ciphertext IS NULL AND phone_nonce IS NULL "
            "AND phone_key_version IS NULL AND phone_verified_at IS NULL) OR "
            "(phone_ciphertext IS NOT NULL AND phone_nonce IS NOT NULL "
            "AND phone_key_version IS NOT NULL AND phone_verified_at IS NOT NULL)",
            name="ck_users_phone_encrypted_fields",
        ),
        CheckConstraint(
            "phone_key_version IS NULL OR phone_key_version > 0",
            name="ck_users_phone_key_version",
        ),
        CheckConstraint(
            "phone_nonce IS NULL OR octet_length(phone_nonce) = 12",
            name="ck_users_phone_nonce_length",
        ),
        CheckConstraint(
            "phone_ciphertext IS NULL OR octet_length(phone_ciphertext) >= 16",
            name="ck_users_phone_ciphertext_length",
        ),
        UniqueConstraint(
            "wechat_app_id", "wechat_openid", name="uq_users_wechat_app_openid"
        ),
        UniqueConstraint("wechat_unionid", name="uq_users_wechat_unionid"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    wechat_app_id: Mapped[str] = mapped_column(String(128))
    wechat_openid: Mapped[str] = mapped_column(String(128))
    wechat_unionid: Mapped[str | None] = mapped_column(String(128), nullable=True)
    phone_ciphertext: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    phone_nonce: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    phone_key_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    phone_verified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_contact_name: Mapped[str | None] = mapped_column(String(40), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    sessions: Mapped[list["UserSession"]] = relationship(back_populates="user")
    orders: Mapped[list["Order"]] = relationship(back_populates="user")
    idempotency_records: Mapped[list["IdempotencyRecord"]] = relationship(
        back_populates="user"
    )


class UserSession(Base):
    __tablename__ = "user_sessions"
    __table_args__ = (
        CheckConstraint(
            "token_hash ~ '^[0-9a-f]{64}$'", name="ck_user_sessions_token_hash"
        ),
        CheckConstraint("expires_at > issued_at", name="ck_user_sessions_expiry"),
        UniqueConstraint("token_hash", name="uq_user_sessions_token_hash"),
        Index("ix_user_sessions_user_id", "user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", name="fk_user_sessions_user_id_users", ondelete="CASCADE"),
    )
    token_hash: Mapped[str] = mapped_column(String(64))
    issued_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped[User] = relationship(back_populates="sessions")


class Order(Base):
    __tablename__ = "orders"
    __table_args__ = (
        CheckConstraint("price_cents >= 0", name="ck_orders_price_cents"),
        CheckConstraint(
            "length(trim(contact_name)) BETWEEN 1 AND 40",
            name="ck_orders_contact_name",
        ),
        CheckConstraint(
            "contact_phone_ciphertext IS NOT NULL AND contact_phone_nonce IS NOT NULL "
            "AND contact_phone_key_version > 0",
            name="ck_orders_contact_phone_encrypted_fields",
        ),
        CheckConstraint(
            "octet_length(contact_phone_nonce) = 12",
            name="ck_orders_contact_phone_nonce_length",
        ),
        CheckConstraint(
            "octet_length(contact_phone_ciphertext) >= 16",
            name="ck_orders_contact_phone_ciphertext_length",
        ),
        CheckConstraint("expires_at > created_at", name="ck_orders_expiry"),
        CheckConstraint(
            "(status <> 'EXPIRED' AND expired_at IS NULL) OR "
            "(status = 'EXPIRED' AND expired_at IS NOT NULL AND expired_at >= expires_at)",
            name="ck_orders_status_expired_at",
        ),
        UniqueConstraint("order_number", name="uq_orders_order_number"),
        Index("ix_orders_user_id", "user_id"),
        Index("ix_orders_slot_id", "slot_id"),
        Index(
            "ix_orders_pending_expiry_candidates",
            "expires_at",
            "id",
            postgresql_where=text("status = 'PENDING_PAYMENT'"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_number: Mapped[str] = mapped_column(String(64))
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", name="fk_orders_user_id_users", ondelete="RESTRICT"),
    )
    slot_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("slots.id", name="fk_orders_slot_id_slots", ondelete="RESTRICT"),
    )
    status: Mapped[OrderStatus] = mapped_column(Enum(OrderStatus, name="order_status"))
    price_cents: Mapped[int] = mapped_column(Integer)
    contact_name: Mapped[str] = mapped_column(String(40))
    contact_phone_ciphertext: Mapped[bytes] = mapped_column(LargeBinary)
    contact_phone_nonce: Mapped[bytes] = mapped_column(LargeBinary)
    contact_phone_key_version: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expired_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    wechat_prepay_id: Mapped[str | None] = mapped_column(String(128), nullable=True)

    user: Mapped[User] = relationship(back_populates="orders")
    slot: Mapped[Slot] = relationship(
        back_populates="orders", foreign_keys=[slot_id]
    )
    payments: Mapped[list["Payment"]] = relationship(back_populates="order")


class Payment(Base):
    __tablename__ = "payments"
    __table_args__ = (
        CheckConstraint("length(trim(provider)) > 0", name="ck_payments_provider_nonempty"),
        CheckConstraint(
            "length(trim(merchant_order_no)) > 0",
            name="ck_payments_merchant_order_no_nonempty",
        ),
        CheckConstraint("amount_cents >= 0", name="ck_payments_amount_cents"),
        CheckConstraint("length(trim(currency)) > 0", name="ck_payments_currency_nonempty"),
        CheckConstraint(
            "provider_transaction_no IS NULL OR length(trim(provider_transaction_no)) > 0",
            name="ck_payments_provider_transaction_no_nonempty",
        ),
        CheckConstraint(
            "provider_prepay_id IS NULL OR length(trim(provider_prepay_id)) > 0",
            name="ck_payments_provider_prepay_id_nonempty",
        ),
        CheckConstraint(
            "(status = 'SUCCESS' AND paid_at IS NOT NULL) OR "
            "(status <> 'SUCCESS' AND paid_at IS NULL)",
            name="ck_payments_success_paid_at",
        ),
        CheckConstraint(
            "reconcile_attempts >= 0", name="ck_payments_reconcile_attempts"
        ),
        CheckConstraint(
            "notification_result IS NULL OR length(trim(notification_result)) > 0",
            name="ck_payments_notification_result_nonempty",
        ),
        CheckConstraint(
            "notification_code IS NULL OR length(trim(notification_code)) > 0",
            name="ck_payments_notification_code_nonempty",
        ),
        CheckConstraint(
            "last_error_code IS NULL OR length(trim(last_error_code)) > 0",
            name="ck_payments_last_error_code_nonempty",
        ),
        UniqueConstraint(
            "provider",
            "merchant_order_no",
            name="uq_payments_provider_merchant_order_no",
        ),
        UniqueConstraint(
            "provider",
            "provider_transaction_no",
            name="uq_payments_provider_transaction_no",
        ),
        Index("ix_payments_order_id", "order_id"),
        Index(
            "uq_payments_one_nonterminal_per_order",
            "order_id",
            unique=True,
            postgresql_where=text(
                "status IN ('CREATING', 'PREPAY_CREATED', 'CONFIRMING', 'UNKNOWN')"
            ),
        ),
        Index(
            "ix_payments_reconciliation_due",
            "next_reconcile_at",
            "id",
            postgresql_where=text(
                "status IN ('CREATING', 'PREPAY_CREATED', 'CONFIRMING', 'UNKNOWN') "
                "AND next_reconcile_at IS NOT NULL"
            ),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("orders.id", name="fk_payments_order_id_orders", ondelete="RESTRICT"),
    )
    provider: Mapped[str] = mapped_column(String(40))
    merchant_order_no: Mapped[str] = mapped_column(String(128))
    provider_transaction_no: Mapped[str | None] = mapped_column(
        String(128), nullable=True
    )
    amount_cents: Mapped[int] = mapped_column(Integer)
    currency: Mapped[str] = mapped_column(String(3))
    status: Mapped[PaymentState] = mapped_column(Enum(PaymentState, name="payment_state"))
    provider_prepay_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    authority_unknown_since: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    reconcile_attempts: Mapped[int] = mapped_column(
        Integer, default=0, server_default=text("0")
    )
    next_reconcile_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_error_code: Mapped[str | None] = mapped_column(String(80), nullable=True)
    last_error_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    notification_result: Mapped[str | None] = mapped_column(String(40), nullable=True)
    notification_code: Mapped[str | None] = mapped_column(String(80), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    order: Mapped[Order] = relationship(back_populates="payments")
    idempotency_records: Mapped[list["IdempotencyRecord"]] = relationship(
        back_populates="payment"
    )


class IdempotencyRecord(Base):
    __tablename__ = "idempotency_records"
    __table_args__ = (
        CheckConstraint(
            "length(trim(operation)) > 0", name="ck_idempotency_records_operation"
        ),
        CheckConstraint("length(key) > 0", name="ck_idempotency_records_key"),
        CheckConstraint(
            "request_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_idempotency_records_request_sha256",
        ),
        CheckConstraint(
            "(state = 'CLAIMED' AND payment_id IS NULL "
            "AND response_status IS NULL AND response_body IS NULL) OR "
            "(state = 'PROCESSING' AND payment_id IS NOT NULL "
            "AND response_status IS NULL AND response_body IS NULL) OR "
            "(state = 'COMPLETED' AND response_status IS NOT NULL AND response_body IS NOT NULL)",
            name="ck_idempotency_records_state_response",
        ),
        CheckConstraint(
            "response_status IS NULL OR response_status BETWEEN 100 AND 599",
            name="ck_idempotency_records_response_status",
        ),
        UniqueConstraint(
            "user_id",
            "operation",
            "key",
            name="uq_idempotency_records_user_operation_key",
        ),
        Index("ix_idempotency_records_user_id", "user_id"),
        Index("ix_idempotency_records_payment_id", "payment_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "users.id",
            name="fk_idempotency_records_user_id_users",
            ondelete="CASCADE",
        ),
    )
    operation: Mapped[str] = mapped_column(String(80))
    key: Mapped[str] = mapped_column(String(255))
    request_sha256: Mapped[str] = mapped_column(String(64))
    state: Mapped[IdempotencyState] = mapped_column(
        Enum(IdempotencyState, name="idempotency_state")
    )
    payment_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "payments.id",
            name="fk_idempotency_records_payment_id_payments",
            ondelete="RESTRICT",
        ),
        nullable=True,
    )
    response_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    response_body: Mapped[dict[str, object] | None] = mapped_column(
        JSONB(none_as_null=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    user: Mapped[User] = relationship(back_populates="idempotency_records")
    payment: Mapped[Payment | None] = relationship(back_populates="idempotency_records")
