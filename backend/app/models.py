import uuid
from datetime import UTC, datetime
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
    event,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID, ExcludeConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class ImageRole(StrEnum):
    COVER = "COVER"
    GALLERY = "GALLERY"


class FacilityCode(StrEnum):
    PARKING = "PARKING"
    TOILET = "TOILET"
    CHANGING_ROOM = "CHANGING_ROOM"
    SHOWER = "SHOWER"
    LOCKERS = "LOCKERS"
    DRINKING_WATER = "DRINKING_WATER"
    BEVERAGE_SALES = "BEVERAGE_SALES"
    EQUIPMENT_RENTAL = "EQUIPMENT_RENTAL"
    REST_AREA = "REST_AREA"
    FIRST_AID = "FIRST_AID"
    AED = "AED"
    INDOOR = "INDOOR"
    OUTDOOR = "OUTDOOR"
    COVERED = "COVERED"
    LIGHTING = "LIGHTING"
    ARTIFICIAL_TURF = "ARTIFICIAL_TURF"
    NATURAL_GRASS = "NATURAL_GRASS"


class PitchType(StrEnum):
    FIVE_A_SIDE = "FIVE_A_SIDE"
    SEVEN_A_SIDE = "SEVEN_A_SIDE"


class PitchStatus(StrEnum):
    ACTIVE = "ACTIVE"
    INACTIVE = "INACTIVE"


class BookingMode(StrEnum):
    ONLINE = "ONLINE"
    DIRECTORY_ONLY = "DIRECTORY_ONLY"


class TransitKind(StrEnum):
    SUBWAY = "SUBWAY"
    BUS = "BUS"


class TransitDistanceBasis(StrEnum):
    STRAIGHT_LINE = "STRAIGHT_LINE"
    MAP_VERIFIED = "MAP_VERIFIED"


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


class ModerationReasonCode(StrEnum):
    CONTACT_INFO = "CONTACT_INFO"
    QR_OR_PAYMENT_CODE = "QR_OR_PAYMENT_CODE"
    OFF_PLATFORM_TRADE = "OFF_PLATFORM_TRADE"
    EXTERNAL_LINK = "EXTERNAL_LINK"
    UNRELATED_CONTENT = "UNRELATED_CONTENT"
    IMAGE_NOT_VENUE = "IMAGE_NOT_VENUE"
    IMAGE_QUALITY = "IMAGE_QUALITY"
    PERSONAL_PRIVACY = "PERSONAL_PRIVACY"
    UNSAFE_CONTENT = "UNSAFE_CONTENT"


class VenueProfileItemStatus(StrEnum):
    UPLOADING = "UPLOADING"
    REVIEWING = "REVIEWING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    PENDING_MANUAL = "PENDING_MANUAL"


class VenueProfileRevisionStatus(StrEnum):
    READY = "READY"
    REVIEWING = "REVIEWING"
    REJECTED = "REJECTED"
    PENDING_MANUAL = "PENDING_MANUAL"
    PUBLISHED = "PUBLISHED"


class ModerationItemType(StrEnum):
    DESCRIPTION = "DESCRIPTION"
    IMAGE = "IMAGE"


class ModerationJobStatus(StrEnum):
    PENDING = "PENDING"
    CLAIMED = "CLAIMED"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class ModerationDecisionOutcome(StrEnum):
    PASS = "PASS"
    REJECT = "REJECT"
    UNCERTAIN = "UNCERTAIN"


class ModerationDecisionSource(StrEnum):
    PROVIDER = "PROVIDER"
    MANUAL = "MANUAL"


class ProfileMutationState(StrEnum):
    CLAIMED = "CLAIMED"
    COMPLETED = "COMPLETED"


class Base(DeclarativeBase):
    pass


class Venue(Base):
    __tablename__ = "venues"
    __table_args__ = (
        CheckConstraint("length(trim(slug)) > 0", name="ck_venues_slug_nonempty"),
        CheckConstraint("length(trim(name)) > 0", name="ck_venues_name_nonempty"),
        CheckConstraint(
            "district_code ~ '^[0-9]{6}$'", name="ck_venues_district_code"
        ),
        CheckConstraint(
            "length(trim(district_name)) > 0",
            name="ck_venues_district_name_nonempty",
        ),
        CheckConstraint("latitude BETWEEN -90 AND 90", name="ck_venues_latitude"),
        CheckConstraint("longitude BETWEEN -180 AND 180", name="ck_venues_longitude"),
        CheckConstraint(
            "navigation_latitude BETWEEN -90 AND 90",
            name="ck_venues_navigation_latitude",
        ),
        CheckConstraint(
            "navigation_longitude BETWEEN -180 AND 180",
            name="ck_venues_navigation_longitude",
        ),
        CheckConstraint("sort_order >= 0", name="ck_venues_sort_order"),
        CheckConstraint("profile_version > 0", name="ck_venues_profile_version"),
        CheckConstraint("facility_version > 0", name="ck_venues_facility_version"),
        CheckConstraint(
            "jsonb_typeof(public_pitch_types) = 'array'",
            name="ck_venues_public_pitch_types_array",
        ),
        CheckConstraint(
            "NOT is_primary OR booking_mode = 'ONLINE'",
            name="ck_venues_primary_online",
        ),
        CheckConstraint(
            "booking_mode <> 'ONLINE' OR ("
            "price_advantage_text IS NOT NULL AND timezone IS NOT NULL AND "
            "business_hours_text IS NOT NULL AND parking_text IS NOT NULL AND "
            "phone IS NOT NULL AND refund_policy_text IS NOT NULL)",
            name="ck_venues_booking_content",
        ),
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
    price_advantage_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    timezone: Mapped[str | None] = mapped_column(String(80), nullable=True)
    business_hours_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    address: Mapped[str] = mapped_column(Text)
    district_code: Mapped[str] = mapped_column(String(6))
    district_name: Mapped[str] = mapped_column(Text)
    parking_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    refund_policy_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    booking_mode: Mapped[BookingMode] = mapped_column(
        Enum(BookingMode, name="booking_mode"), default=BookingMode.ONLINE
    )
    navigation_poi_name: Mapped[str] = mapped_column(
        Text, default="legacy navigation"
    )
    navigation_latitude: Mapped[float] = mapped_column(Float, default=0.0)
    navigation_longitude: Mapped[float] = mapped_column(Float, default=0.0)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    content_verified_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
    is_listed: Mapped[bool] = mapped_column(Boolean, default=True)
    public_pitch_types: Mapped[list[str]] = mapped_column(JSONB, default=list)
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    configuration_version: Mapped[int] = mapped_column(
        BigInteger, default=1, server_default=text("1")
    )
    profile_version: Mapped[int] = mapped_column(
        BigInteger, default=1, server_default=text("1")
    )
    facility_version: Mapped[int] = mapped_column(
        BigInteger, default=1, server_default=text("1")
    )

    images: Mapped[list["VenueImage"]] = relationship(
        back_populates="venue", cascade="all, delete-orphan"
    )
    facilities: Mapped[list["VenueFacility"]] = relationship(
        back_populates="venue", cascade="all, delete-orphan"
    )
    pitches: Mapped[list["Pitch"]] = relationship(back_populates="venue")
    transit_stops: Mapped[list["VenueTransitStop"]] = relationship(
        back_populates="venue", cascade="all, delete-orphan"
    )
    memberships: Mapped[list["VenueMembership"]] = relationship(
        back_populates="venue", cascade="all, delete-orphan"
    )


class VenueMembership(Base):
    __tablename__ = "venue_memberships"
    __table_args__ = (
        UniqueConstraint("venue_id", "user_id", name="uq_venue_memberships_venue_user"),
        Index("ix_venue_memberships_user_id", "user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    venue_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("venues.id", ondelete="CASCADE")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE")
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    can_manage_inventory: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false")
    )

    venue: Mapped[Venue] = relationship(back_populates="memberships")
    user: Mapped["User"] = relationship(back_populates="venue_memberships")


class VenueTransitStop(Base):
    __tablename__ = "venue_transit_stops"
    __table_args__ = (
        CheckConstraint(
            "length(trim(name)) > 0",
            name="ck_venue_transit_stops_name_nonempty",
        ),
        CheckConstraint(
            "jsonb_typeof(lines) = 'array'",
            name="ck_venue_transit_stops_lines_array",
        ),
        CheckConstraint(
            "latitude BETWEEN -90 AND 90",
            name="ck_venue_transit_stops_latitude",
        ),
        CheckConstraint(
            "longitude BETWEEN -180 AND 180",
            name="ck_venue_transit_stops_longitude",
        ),
        CheckConstraint(
            "distance_meters >= 0",
            name="ck_venue_transit_stops_distance_meters",
        ),
        CheckConstraint(
            "length(trim(source_name)) > 0",
            name="ck_venue_transit_stops_source_name_nonempty",
        ),
        CheckConstraint(
            "sort_order >= 0",
            name="ck_venue_transit_stops_sort_order",
        ),
        UniqueConstraint(
            "venue_id",
            "kind",
            "name",
            name="uq_venue_transit_stops_venue_kind_name",
        ),
        Index("ix_venue_transit_stops_venue_id", "venue_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    venue_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("venues.id", ondelete="CASCADE")
    )
    kind: Mapped[TransitKind] = mapped_column(
        Enum(TransitKind, name="transit_kind")
    )
    name: Mapped[str] = mapped_column(String(200))
    lines: Mapped[list[str]] = mapped_column(JSONB)
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    distance_meters: Mapped[int] = mapped_column(Integer)
    distance_basis: Mapped[TransitDistanceBasis] = mapped_column(
        Enum(TransitDistanceBasis, name="transit_distance_basis")
    )
    source_name: Mapped[str] = mapped_column(Text)
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    verified_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    sort_order: Mapped[int] = mapped_column(Integer)

    venue: Mapped[Venue] = relationship(back_populates="transit_stops")


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


class VenueProfileRevision(Base):
    __tablename__ = "venue_profile_revisions"
    __table_args__ = (
        CheckConstraint(
            "base_published_version > 0", name="ck_venue_profile_revisions_base_version"
        ),
        CheckConstraint("revision_version > 0", name="ck_venue_profile_revisions_revision_version"),
        CheckConstraint(
            "char_length(target_description) <= 300",
            name="ck_venue_profile_revisions_description_length",
        ),
        CheckConstraint(
            "(description_status = 'REJECTED' AND description_reason_code IS NOT NULL) OR "
            "(description_status <> 'REJECTED' AND description_reason_code IS NULL)",
            name="ck_venue_profile_revisions_description_reason",
        ),
        UniqueConstraint(
            "venue_id", "revision_version", name="uq_venue_profile_revisions_venue_version"
        ),
        Index(
            "uq_venue_profile_revisions_current_editable",
            "venue_id",
            unique=True,
            postgresql_where=text("is_current_editable"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    venue_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("venues.id", ondelete="CASCADE")
    )
    base_published_version: Mapped[int] = mapped_column(BigInteger)
    revision_version: Mapped[int] = mapped_column(BigInteger)
    target_description: Mapped[str] = mapped_column(Text)
    status: Mapped[VenueProfileRevisionStatus] = mapped_column(
        Enum(VenueProfileRevisionStatus, name="venue_profile_revision_status")
    )
    description_status: Mapped[VenueProfileItemStatus] = mapped_column(
        Enum(VenueProfileItemStatus, name="venue_profile_item_status")
    )
    description_reason_code: Mapped[ModerationReasonCode | None] = mapped_column(
        Enum(ModerationReasonCode, name="moderation_reason_code"), nullable=True
    )
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT")
    )
    is_current_editable: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("true")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    venue: Mapped[Venue] = relationship()
    created_by: Mapped["User"] = relationship(foreign_keys=[created_by_user_id])


class VenueProfileImageDraft(Base):
    __tablename__ = "venue_profile_image_drafts"
    __table_args__ = (
        CheckConstraint(
            "(published_image_id IS NOT NULL) <> (original_object_key IS NOT NULL)",
            name="ck_venue_profile_image_drafts_exactly_one_source",
        ),
        CheckConstraint("sort_order >= 0", name="ck_venue_profile_image_drafts_sort_order"),
        CheckConstraint("item_version > 0", name="ck_venue_profile_image_drafts_item_version"),
        CheckConstraint(
            "byte_size IS NULL OR byte_size > 0", name="ck_venue_profile_image_drafts_byte_size"
        ),
        CheckConstraint(
            "content_sha256 IS NULL OR content_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_venue_profile_image_drafts_sha256",
        ),
        CheckConstraint(
            "(moderation_status = 'REJECTED' AND moderation_reason_code IS NOT NULL) OR "
            "(moderation_status <> 'REJECTED' AND moderation_reason_code IS NULL)",
            name="ck_venue_profile_image_drafts_reason",
        ),
        UniqueConstraint(
            "revision_id", "sort_order", name="uq_venue_profile_image_drafts_revision_sort"
        ),
        Index("ix_venue_profile_image_drafts_revision_id", "revision_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    revision_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("venue_profile_revisions.id", ondelete="CASCADE")
    )
    published_image_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("venue_images.id", ondelete="RESTRICT"), nullable=True
    )
    original_object_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    review_object_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    role: Mapped[ImageRole] = mapped_column(Enum(ImageRole, name="image_role"))
    sort_order: Mapped[int] = mapped_column(Integer)
    content_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    actual_mime_type: Mapped[str | None] = mapped_column(
        Enum("image/jpeg", "image/png", "image/webp", name="venue_profile_mime_type"),
        nullable=True,
    )
    byte_size: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    moderation_status: Mapped[VenueProfileItemStatus] = mapped_column(
        Enum(VenueProfileItemStatus, name="venue_profile_item_status")
    )
    moderation_reason_code: Mapped[ModerationReasonCode | None] = mapped_column(
        Enum(ModerationReasonCode, name="moderation_reason_code"), nullable=True
    )
    item_version: Mapped[int] = mapped_column(BigInteger, default=1, server_default=text("1"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    revision: Mapped[VenueProfileRevision] = relationship()


class ContentModerationJob(Base):
    __tablename__ = "content_moderation_jobs"
    __table_args__ = (
        CheckConstraint("item_version > 0", name="ck_content_moderation_jobs_item_version"),
        CheckConstraint("attempt_count >= 0", name="ck_content_moderation_jobs_attempt_count"),
        CheckConstraint(
            "(item_type = 'DESCRIPTION' AND image_draft_id IS NULL) OR "
            "(item_type = 'IMAGE' AND image_draft_id IS NOT NULL)",
            name="ck_content_moderation_jobs_item_target",
        ),
        CheckConstraint(
            "(claim_token IS NULL) = (lease_until IS NULL)",
            name="ck_content_moderation_jobs_lease_pair",
        ),
        Index("ix_content_moderation_jobs_due", "status", "next_run_at", "lease_until", "id"),
        Index("ix_content_moderation_jobs_revision_id", "revision_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    revision_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("venue_profile_revisions.id", ondelete="CASCADE")
    )
    image_draft_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("venue_profile_image_drafts.id", ondelete="CASCADE"),
        nullable=True,
    )
    item_type: Mapped[ModerationItemType] = mapped_column(
        Enum(ModerationItemType, name="moderation_item_type")
    )
    item_version: Mapped[int] = mapped_column(BigInteger)
    status: Mapped[ModerationJobStatus] = mapped_column(
        Enum(ModerationJobStatus, name="moderation_job_status")
    )
    attempt_count: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    next_run_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    claim_token: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    fixed_reason_code: Mapped[ModerationReasonCode | None] = mapped_column(
        Enum(ModerationReasonCode, name="moderation_reason_code"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    revision: Mapped[VenueProfileRevision] = relationship()
    image_draft: Mapped[VenueProfileImageDraft | None] = relationship()


class ContentModerationDecision(Base):
    __tablename__ = "content_moderation_decisions"
    __table_args__ = (
        CheckConstraint("item_version > 0", name="ck_content_moderation_decisions_item_version"),
        CheckConstraint(
            "(outcome = 'REJECT' AND reason_code IS NOT NULL) OR "
            "(outcome <> 'REJECT' AND reason_code IS NULL)",
            name="ck_content_moderation_decisions_reason",
        ),
        CheckConstraint(
            "(source = 'PROVIDER' AND reviewer_user_id IS NULL AND provider IS NOT NULL "
            "AND provider_model IS NOT NULL) OR "
            "(source = 'MANUAL' AND reviewer_user_id IS NOT NULL)",
            name="ck_content_moderation_decisions_source",
        ),
        CheckConstraint(
            "provider_confidence IS NULL OR provider_confidence BETWEEN 0 AND 1",
            name="ck_content_moderation_decisions_confidence",
        ),
        UniqueConstraint(
            "job_id", "idempotency_key", name="uq_content_moderation_decisions_job_key"
        ),
        Index("ix_content_moderation_decisions_job_id", "job_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("content_moderation_jobs.id", ondelete="CASCADE")
    )
    item_type: Mapped[ModerationItemType] = mapped_column(
        Enum(ModerationItemType, name="moderation_item_type")
    )
    item_version: Mapped[int] = mapped_column(BigInteger)
    source: Mapped[ModerationDecisionSource] = mapped_column(
        Enum(ModerationDecisionSource, name="moderation_decision_source")
    )
    outcome: Mapped[ModerationDecisionOutcome] = mapped_column(
        Enum(ModerationDecisionOutcome, name="moderation_decision_outcome")
    )
    reason_code: Mapped[ModerationReasonCode | None] = mapped_column(
        Enum(ModerationReasonCode, name="moderation_reason_code"), nullable=True
    )
    provider: Mapped[str | None] = mapped_column(String(80), nullable=True)
    provider_model: Mapped[str | None] = mapped_column(String(120), nullable=True)
    provider_request_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    provider_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    raw_response_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    reviewer_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )
    idempotency_key: Mapped[str] = mapped_column(String(255))
    decided_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

class ProfileMutationIdempotencyRecord(Base):
    __tablename__ = "profile_mutation_idempotency_records"
    __table_args__ = (
        CheckConstraint("length(trim(scope)) > 0", name="ck_profile_mutations_scope"),
        CheckConstraint("length(key) > 0", name="ck_profile_mutations_key"),
        CheckConstraint(
            "request_sha256 ~ '^[0-9a-f]{64}$'", name="ck_profile_mutations_request_sha256"
        ),
        CheckConstraint(
            "(state = 'CLAIMED' AND response_status IS NULL AND response_body IS NULL) OR "
            "(state = 'COMPLETED' AND response_status IS NOT NULL AND response_body IS NOT NULL)",
            name="ck_profile_mutations_state_response",
        ),
        CheckConstraint(
            "response_status IS NULL OR response_status BETWEEN 100 AND 599",
            name="ck_profile_mutations_response_status",
        ),
        UniqueConstraint(
            "venue_id", "actor_user_id", "scope", "key", name="uq_profile_mutations_scope_key",
        ),
        Index("ix_profile_mutations_venue_id", "venue_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    venue_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("venues.id", ondelete="CASCADE")
    )
    actor_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE")
    )
    scope: Mapped[str] = mapped_column(String(255))
    key: Mapped[str] = mapped_column(String(255))
    request_sha256: Mapped[str] = mapped_column(String(64))
    state: Mapped[ProfileMutationState] = mapped_column(
        Enum(ProfileMutationState, name="profile_mutation_state")
    )
    response_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    response_body: Mapped[dict[str, object] | None] = mapped_column(
        JSONB(none_as_null=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    venue: Mapped[Venue] = relationship()
    actor: Mapped["User"] = relationship(foreign_keys=[actor_user_id])


class Pitch(Base):
    __tablename__ = "pitches"
    __table_args__ = (
        CheckConstraint("length(trim(code)) > 0", name="ck_pitches_code_nonempty"),
        CheckConstraint("length(trim(name)) > 0", name="ck_pitches_name_nonempty"),
        CheckConstraint("sort_order >= 0", name="ck_pitches_sort_order"),
        CheckConstraint(
            "players_per_side BETWEEN 1 AND 99", name="ck_pitches_players_per_side"
        ),
        CheckConstraint("sequence > 0", name="ck_pitches_sequence"),
        UniqueConstraint("venue_id", "code", name="uq_pitches_venue_code"),
        UniqueConstraint(
            "venue_id",
            "players_per_side",
            "sequence",
            name="uq_pitches_venue_format_sequence",
        ),
        Index("ix_pitches_venue_id", "venue_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    venue_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("venues.id", ondelete="RESTRICT")
    )
    code: Mapped[str] = mapped_column(String(80))
    name: Mapped[str] = mapped_column(String(120))
    pitch_type: Mapped[PitchType | None] = mapped_column(
        Enum(PitchType, name="pitch_type"), nullable=True
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    players_per_side: Mapped[int] = mapped_column(Integer)
    system_name: Mapped[str] = mapped_column(String(120))
    custom_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    sequence: Mapped[int] = mapped_column(Integer)
    status: Mapped[PitchStatus] = mapped_column(
        Enum(PitchStatus, name="pitch_status"), default=PitchStatus.ACTIVE
    )

    venue: Mapped[Venue] = relationship(back_populates="pitches")
    slots: Mapped[list["Slot"]] = relationship(back_populates="pitch")


class VenuePitchSequenceCounter(Base):
    __tablename__ = "venue_pitch_sequence_counters"
    __table_args__ = (
        CheckConstraint(
            "players_per_side BETWEEN 1 AND 99",
            name="ck_venue_pitch_sequence_counters_players",
        ),
        CheckConstraint(
            "last_sequence >= 0", name="ck_venue_pitch_sequence_counters_last_sequence"
        ),
    )

    venue_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("venues.id", ondelete="CASCADE"), primary_key=True
    )
    players_per_side: Mapped[int] = mapped_column(Integer, primary_key=True)
    last_sequence: Mapped[int] = mapped_column(Integer, default=0)


@event.listens_for(Pitch, "before_insert")
def _populate_legacy_pitch_configuration(
    _mapper: object, _connection: object, pitch: Pitch
) -> None:
    """Keep legacy seed/load paths compatible during the numeric-format migration."""
    if pitch.players_per_side is None:
        pitch.players_per_side = 5 if pitch.pitch_type is PitchType.FIVE_A_SIDE else 7
    if pitch.system_name is None:
        pitch.system_name = pitch.name
    if pitch.sequence is None:
        pitch.sequence = pitch.sort_order + 1
    if pitch.status is None:
        pitch.status = PitchStatus.ACTIVE


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
    venue_memberships: Mapped[list[VenueMembership]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
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
        CheckConstraint(
            "(reconcile_claim_token IS NULL) = (reconcile_lease_until IS NULL)",
            name="ck_payments_reconcile_lease_pair",
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
        Index(
            "ix_payments_reconcile_lease_until",
            "reconcile_lease_until",
            postgresql_where=text("reconcile_lease_until IS NOT NULL"),
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
    reconcile_claim_token: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    reconcile_lease_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    expiry_reconciled_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    creation_recovery_pending: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false")
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
