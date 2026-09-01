import uuid
from datetime import UTC, datetime
from enum import StrEnum
from typing import TypedDict

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    LargeBinary,
    PrimaryKeyConstraint,
    SmallInteger,
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
    CANCELLED = "CANCELLED"
    REFUND_PENDING = "REFUND_PENDING"
    REFUND_FAILED = "REFUND_FAILED"
    REFUNDED = "REFUNDED"
    COMPLETED = "COMPLETED"


class OpenGameStatus(StrEnum):
    DRAFT = "DRAFT"
    PUBLISHED = "PUBLISHED"
    CANCELLED = "CANCELLED"


class OpenGameCancellationSource(StrEnum):
    CAPTAIN = "CAPTAIN"
    PLATFORM_REPORT = "PLATFORM_REPORT"


class OpenGameReportCategory(StrEnum):
    FALSE_INFORMATION = "FALSE_INFORMATION"
    EXTRA_CHARGE = "EXTRA_CHARGE"
    DANGEROUS_BEHAVIOR = "DANGEROUS_BEHAVIOR"
    HARASSMENT = "HARASSMENT"
    ORGANIZER_NO_SHOW = "ORGANIZER_NO_SHOW"


class OpenGameReportResolutionOutcome(StrEnum):
    DISMISSED = "DISMISSED"
    CONFIRMED_RECORDED = "CONFIRMED_RECORDED"
    CONFIRMED_GAME_CANCELLED = "CONFIRMED_GAME_CANCELLED"


class OpenGameVisibility(StrEnum):
    PUBLIC = "PUBLIC"
    LINK_ONLY = "LINK_ONLY"


class OpenGameIntensity(StrEnum):
    BEGINNER_FRIENDLY = "BEGINNER_FRIENDLY"
    CASUAL = "CASUAL"
    COMPETITIVE = "COMPETITIVE"


class OpenGameRegistrationPosition(StrEnum):
    GOALKEEPER = "GOALKEEPER"
    DEFENDER = "DEFENDER"
    MIDFIELDER = "MIDFIELDER"
    FORWARD = "FORWARD"
    ANY = "ANY"


class OpenGameRegistrationStatus(StrEnum):
    APPLIED = "APPLIED"
    WAITLISTED = "WAITLISTED"
    JOINED = "JOINED"
    REJECTED = "REJECTED"
    WITHDRAWN = "WITHDRAWN"
    REMOVED = "REMOVED"


class OpenGameAttendanceStatus(StrEnum):
    UNMARKED = "UNMARKED"
    PRESENT = "PRESENT"
    NO_SHOW = "NO_SHOW"


class OpenGameRegistrationWithdrawalKind(StrEnum):
    APPLICATION_WITHDRAWAL = "APPLICATION_WITHDRAWAL"
    WAITLIST_WITHDRAWAL = "WAITLIST_WITHDRAWAL"
    GAME_EXIT = "GAME_EXIT"


class OpenGameNotificationEvent(StrEnum):
    WAITLIST_PROMOTED = "WAITLIST_PROMOTED"


class OpenGameNotificationStatus(StrEnum):
    PENDING = "PENDING"
    CLAIMED = "CLAIMED"
    SENT = "SENT"
    FAILED = "FAILED"
    SUPERSEDED = "SUPERSEDED"


class WaitlistPromotedNotificationPayload(TypedDict):
    game_name: str
    starts_at: str
    venue_name: str


class PaymentState(StrEnum):
    CREATING = "CREATING"
    PREPAY_CREATED = "PREPAY_CREATED"
    CONFIRMING = "CONFIRMING"
    SUCCESS = "SUCCESS"
    CLOSED = "CLOSED"
    UNKNOWN = "UNKNOWN"


class RefundCasePurpose(StrEnum):
    ORDER_CANCELLATION = "ORDER_CANCELLATION"
    DUPLICATE_CHARGE = "DUPLICATE_CHARGE"
    PAYMENT_INVENTORY_CONFLICT = "PAYMENT_INVENTORY_CONFLICT"


class RefundReason(StrEnum):
    USER_CANCELLED = "USER_CANCELLED"
    VENUE_CANCELLED = "VENUE_CANCELLED"
    AUTOMATIC_RECOVERY = "AUTOMATIC_RECOVERY"


class RefundAttemptStatus(StrEnum):
    CREATING = "CREATING"
    PROCESSING = "PROCESSING"
    SUCCESS = "SUCCESS"
    FAILED = "FAILED"
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


class VenueOnboardingKind(StrEnum):
    CLAIM = "CLAIM"
    CREATE = "CREATE"


class VenueOnboardingStatus(StrEnum):
    SUBMITTED = "SUBMITTED"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


class VenueOnboardingEvidenceKind(StrEnum):
    BUSINESS_LICENSE = "BUSINESS_LICENSE"
    MANAGEMENT_AUTHORIZATION = "MANAGEMENT_AUTHORIZATION"
    VENUE_EXTERIOR = "VENUE_EXTERIOR"
    VENUE_INTERIOR = "VENUE_INTERIOR"


class VenueOnboardingEvidenceState(StrEnum):
    UPLOADING = "UPLOADING"
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
            "description_item_version > 0",
            name="ck_venue_profile_revisions_description_item_version",
        ),
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
    description_item_version: Mapped[int] = mapped_column(
        BigInteger, default=1, server_default=text("1")
    )
    target_description: Mapped[str] = mapped_column(Text)
    target_facilities: Mapped[list[str]] = mapped_column(
        JSONB, default=list, server_default=text("'[]'::jsonb")
    )
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
            "content_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_content_moderation_jobs_content_sha256",
        ),
        CheckConstraint(
            "length(trim(policy_version)) > 0",
            name="ck_content_moderation_jobs_policy_version",
        ),
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
    content_sha256: Mapped[str] = mapped_column(String(64))
    policy_version: Mapped[str] = mapped_column(String(80))
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
    orders: Mapped[list["Order"]] = relationship(
        back_populates="user", foreign_keys="Order.user_id"
    )
    idempotency_records: Mapped[list["IdempotencyRecord"]] = relationship(
        back_populates="user"
    )
    venue_memberships: Mapped[list[VenueMembership]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    teams: Mapped[list["Team"]] = relationship(
        foreign_keys="Team.captain_user_id"
    )
    open_game_registrations: Mapped[list["OpenGameRegistration"]] = relationship(
        back_populates="applicant",
        foreign_keys="OpenGameRegistration.applicant_user_id",
    )
    decided_open_game_registrations: Mapped[
        list["OpenGameRegistration"]
    ] = relationship(
        back_populates="decided_by",
        foreign_keys="OpenGameRegistration.decided_by_user_id",
    )


class Team(Base):
    __tablename__ = "teams"
    __table_args__ = (
        CheckConstraint(
            "length(name) BETWEEN 1 AND 24 AND name = trim(name)",
            name="ck_teams_name",
        ),
        CheckConstraint(
            "length(name_key) BETWEEN 1 AND 64 AND name_key = trim(name_key)",
            name="ck_teams_name_key",
        ),
        UniqueConstraint(
            "captain_user_id",
            "name_key",
            name="uq_teams_captain_name_key",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    captain_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "users.id",
            name="fk_teams_captain_user_id_users",
            ondelete="RESTRICT",
        ),
    )
    name: Mapped[str] = mapped_column(String(24))
    name_key: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    open_games: Mapped[list["OpenGame"]] = relationship(back_populates="team")


class VenueOnboardingApplication(Base):
    __tablename__ = "venue_onboarding_applications"
    __table_args__ = (
        CheckConstraint(
            "(kind = 'CLAIM' AND target_venue_id IS NOT NULL "
            "AND proposed_name IS NULL AND proposed_address IS NULL "
            "AND proposed_district_code IS NULL AND proposed_district_name IS NULL "
            "AND proposed_latitude IS NULL AND proposed_longitude IS NULL "
            "AND normalized_proposed_name IS NULL "
            "AND normalized_proposed_address IS NULL) OR "
            "(kind = 'CREATE' AND target_venue_id IS NULL "
            "AND proposed_name IS NOT NULL AND proposed_address IS NOT NULL "
            "AND proposed_district_code IS NOT NULL "
            "AND proposed_district_name IS NOT NULL "
            "AND proposed_latitude IS NOT NULL AND proposed_longitude IS NOT NULL "
            "AND normalized_proposed_name IS NOT NULL "
            "AND normalized_proposed_address IS NOT NULL)",
            name="ck_onboarding_applications_kind_fields",
        ),
        CheckConstraint(
            "proposed_name IS NULL OR length(trim(proposed_name)) > 0",
            name="ck_onboarding_applications_proposed_name",
        ),
        CheckConstraint(
            "proposed_address IS NULL OR length(trim(proposed_address)) > 0",
            name="ck_onboarding_applications_proposed_address",
        ),
        CheckConstraint(
            "proposed_district_code IS NULL OR proposed_district_code ~ '^[0-9]{6}$'",
            name="ck_onboarding_applications_district_code",
        ),
        CheckConstraint(
            "proposed_district_name IS NULL OR length(trim(proposed_district_name)) > 0",
            name="ck_onboarding_applications_district_name",
        ),
        CheckConstraint(
            "proposed_latitude IS NULL OR proposed_latitude BETWEEN -90 AND 90",
            name="ck_onboarding_applications_latitude",
        ),
        CheckConstraint(
            "proposed_longitude IS NULL OR proposed_longitude BETWEEN -180 AND 180",
            name="ck_onboarding_applications_longitude",
        ),
        CheckConstraint(
            "normalized_proposed_name IS NULL OR length(trim(normalized_proposed_name)) > 0",
            name="ck_onboarding_applications_normalized_name",
        ),
        CheckConstraint(
            "normalized_proposed_address IS NULL OR length(trim(normalized_proposed_address)) > 0",
            name="ck_onboarding_applications_normalized_address",
        ),
        CheckConstraint(
            "length(trim(contact_name)) BETWEEN 1 AND 40",
            name="ck_onboarding_applications_contact_name",
        ),
        CheckConstraint(
            "contact_phone_key_version > 0",
            name="ck_onboarding_applications_phone_key_version",
        ),
        CheckConstraint(
            "octet_length(contact_phone_nonce) = 12",
            name="ck_onboarding_applications_phone_nonce_length",
        ),
        CheckConstraint(
            "octet_length(contact_phone_ciphertext) >= 16",
            name="ck_onboarding_applications_phone_ciphertext_length",
        ),
        CheckConstraint(
            "(status = 'SUBMITTED' AND reviewer_principal_id IS NULL "
            "AND reviewed_at IS NULL AND review_reason IS NULL "
            "AND approved_venue_id IS NULL) OR "
            "(status = 'APPROVED' AND reviewer_principal_id IS NOT NULL "
            "AND reviewed_at IS NOT NULL AND review_reason IS NOT NULL "
            "AND length(trim(review_reason)) > 0 AND approved_venue_id IS NOT NULL) OR "
            "(status = 'REJECTED' AND reviewer_principal_id IS NOT NULL "
            "AND reviewed_at IS NOT NULL AND review_reason IS NOT NULL "
            "AND length(trim(review_reason)) > 0 AND approved_venue_id IS NULL)",
            name="ck_onboarding_applications_review_state",
        ),
        CheckConstraint(
            "reviewer_principal_id IS NULL OR length(trim(reviewer_principal_id)) > 0",
            name="ck_onboarding_applications_reviewer_principal",
        ),
        CheckConstraint(
            "reviewed_at IS NULL OR reviewed_at >= submitted_at",
            name="ck_onboarding_applications_reviewed_at",
        ),
        CheckConstraint(
            "status <> 'APPROVED' OR kind <> 'CLAIM' OR approved_venue_id = target_venue_id",
            name="ck_onboarding_applications_claim_approval",
        ),
        Index(
            "uq_venue_onboarding_submitted_claim",
            "applicant_user_id",
            "target_venue_id",
            unique=True,
            postgresql_where=text("kind = 'CLAIM' AND status = 'SUBMITTED'"),
        ),
        Index(
            "uq_venue_onboarding_submitted_create",
            "applicant_user_id",
            "normalized_proposed_name",
            "normalized_proposed_address",
            unique=True,
            postgresql_where=text("kind = 'CREATE' AND status = 'SUBMITTED'"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    applicant_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "users.id",
            name="fk_onboarding_applications_applicant_user",
            ondelete="RESTRICT",
        ),
    )
    kind: Mapped[VenueOnboardingKind] = mapped_column(
        Enum(VenueOnboardingKind, name="venue_onboarding_kind")
    )
    target_venue_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "venues.id",
            name="fk_onboarding_applications_target_venue",
            ondelete="RESTRICT",
        ),
        nullable=True,
    )
    proposed_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    proposed_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    proposed_district_code: Mapped[str | None] = mapped_column(String(6), nullable=True)
    proposed_district_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    proposed_latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    proposed_longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    normalized_proposed_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    normalized_proposed_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    contact_phone_ciphertext: Mapped[bytes] = mapped_column(LargeBinary)
    contact_phone_nonce: Mapped[bytes] = mapped_column(LargeBinary)
    contact_phone_key_version: Mapped[int] = mapped_column(Integer)
    contact_name: Mapped[str] = mapped_column(String(40))
    status: Mapped[VenueOnboardingStatus] = mapped_column(
        Enum(VenueOnboardingStatus, name="venue_onboarding_status")
    )
    submitted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    reviewer_principal_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    review_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    approved_venue_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "venues.id",
            name="fk_onboarding_applications_approved_venue",
            ondelete="RESTRICT",
        ),
        nullable=True,
    )

    evidence: Mapped[list["VenueOnboardingEvidence"]] = relationship(back_populates="application")


class VenueOnboardingEvidence(Base):
    __tablename__ = "venue_onboarding_evidence"
    __table_args__ = (
        CheckConstraint(
            "length(trim(object_key)) > 0 "
            "AND object_key !~* '^[a-z][a-z0-9+.-]*://' "
            "AND left(object_key, 1) <> '/'",
            name="ck_onboarding_evidence_private_object_key",
        ),
        CheckConstraint(
            "length(trim(content_type)) > 0",
            name="ck_onboarding_evidence_content_type",
        ),
        CheckConstraint(
            "(state = 'UPLOADING' AND application_id IS NULL "
            "AND byte_size IS NULL AND content_sha256 IS NULL) OR "
            "(state = 'COMPLETED' AND byte_size IS NOT NULL AND byte_size > 0 "
            "AND content_sha256 IS NOT NULL "
            "AND content_sha256 ~ '^[0-9a-f]{64}$')",
            name="ck_onboarding_evidence_state_fields",
        ),
        UniqueConstraint("object_key", name="uq_onboarding_evidence_object_key"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "users.id",
            name="fk_onboarding_evidence_owner_user",
            ondelete="RESTRICT",
        ),
    )
    application_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "venue_onboarding_applications.id",
            name="fk_onboarding_evidence_application",
            ondelete="SET NULL",
        ),
        nullable=True,
    )
    kind: Mapped[VenueOnboardingEvidenceKind] = mapped_column(
        Enum(VenueOnboardingEvidenceKind, name="venue_onboarding_evidence_kind")
    )
    state: Mapped[VenueOnboardingEvidenceState] = mapped_column(
        Enum(VenueOnboardingEvidenceState, name="venue_onboarding_evidence_state")
    )
    object_key: Mapped[str] = mapped_column(Text)
    content_type: Mapped[str] = mapped_column(String(255))
    byte_size: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    content_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    application: Mapped[VenueOnboardingApplication | None] = relationship(back_populates="evidence")


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


class PlatformSession(Base):
    __tablename__ = "platform_sessions"
    __table_args__ = (
        CheckConstraint(
            "token_hash ~ '^[0-9a-f]{64}$'",
            name="ck_platform_sessions_token_hash",
        ),
        CheckConstraint(
            "length(trim(principal_id)) BETWEEN 1 AND 128",
            name="ck_platform_sessions_principal_id",
        ),
        CheckConstraint(
            "expires_at > issued_at",
            name="ck_platform_sessions_expiry",
        ),
        CheckConstraint(
            "revoked_at IS NULL OR revoked_at >= issued_at",
            name="ck_platform_sessions_revoked_at",
        ),
        UniqueConstraint(
            "token_hash",
            name="uq_platform_sessions_token_hash",
        ),
        Index("ix_platform_sessions_principal_id", "principal_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    token_hash: Mapped[str] = mapped_column(String(64))
    principal_id: Mapped[str] = mapped_column(String(128))
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


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
        CheckConstraint(
            "(status IN ('CANCELLED', 'REFUND_PENDING', 'REFUND_FAILED', 'REFUNDED') "
            "AND cancel_requested_at IS NOT NULL AND cancelled_at IS NOT NULL "
            "AND cancelled_at >= cancel_requested_at) OR "
            "(status NOT IN ('CANCELLED', 'REFUND_PENDING', 'REFUND_FAILED', 'REFUNDED') "
            "AND cancelled_at IS NULL)",
            name="ck_orders_cancellation_timestamps",
        ),
        CheckConstraint(
            "((checked_in_at IS NULL) = (checked_in_by_user_id IS NULL)) AND "
            "(checked_in_at IS NULL OR status IN ('CONFIRMED', 'COMPLETED'))",
            name="ck_orders_check_in_pair",
        ),
        CheckConstraint(
            "(status = 'COMPLETED' AND checked_in_at IS NOT NULL "
            "AND completed_at IS NOT NULL AND completed_by_user_id IS NOT NULL "
            "AND completed_at >= checked_in_at) OR "
            "(status <> 'COMPLETED' AND completed_at IS NULL "
            "AND completed_by_user_id IS NULL)",
            name="ck_orders_completion_pair",
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
    cancel_requested_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    cancelled_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    checked_in_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    checked_in_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "users.id",
            name="fk_orders_checked_in_by_user_id_users",
            ondelete="RESTRICT",
        ),
        nullable=True,
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    completed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "users.id",
            name="fk_orders_completed_by_user_id_users",
            ondelete="RESTRICT",
        ),
        nullable=True,
    )
    wechat_prepay_id: Mapped[str | None] = mapped_column(String(128), nullable=True)

    user: Mapped[User] = relationship(back_populates="orders", foreign_keys=[user_id])
    slot: Mapped[Slot] = relationship(
        back_populates="orders", foreign_keys=[slot_id]
    )
    payments: Mapped[list["Payment"]] = relationship(back_populates="order")
    refund_cases: Mapped[list["RefundCase"]] = relationship(back_populates="order")
    open_games: Mapped[list["OpenGame"]] = relationship(back_populates="order")


class OpenGame(Base):
    __tablename__ = "open_games"
    __table_args__ = (
        CheckConstraint(
            "length(name) BETWEEN 1 AND 30 AND name = trim(name)",
            name="ck_open_games_name",
        ),
        CheckConstraint(
            "total_players BETWEEN 4 AND 30",
            name="ck_open_games_total_players",
        ),
        CheckConstraint(
            "fixed_players >= 1", name="ck_open_games_fixed_players"
        ),
        CheckConstraint("open_spots >= 1", name="ck_open_games_open_spots"),
        CheckConstraint(
            "fixed_players + open_spots <= total_players",
            name="ck_open_games_roster_capacity",
        ),
        CheckConstraint(
            "minimum_experience IS NULL OR "
            "(length(minimum_experience) BETWEEN 1 AND 60 "
            "AND minimum_experience = trim(minimum_experience))",
            name="ck_open_games_minimum_experience",
        ),
        CheckConstraint(
            "position_mask BETWEEN 0 AND 15",
            name="ck_open_games_position_mask",
        ),
        CheckConstraint("aa_cents >= 0", name="ck_open_games_aa_cents"),
        CheckConstraint(
            "equipment_and_arrival_notes IS NULL OR "
            "(length(equipment_and_arrival_notes) BETWEEN 1 AND 200 "
            "AND equipment_and_arrival_notes = trim(equipment_and_arrival_notes))",
            name="ck_open_games_equipment_and_arrival_notes",
        ),
        CheckConstraint("version >= 1", name="ck_open_games_version"),
        CheckConstraint(
            "length(share_token) BETWEEN 1 AND 64 "
            "AND share_token = trim(share_token)",
            name="ck_open_games_share_token",
        ),
        CheckConstraint(
            "(status = 'DRAFT' AND published_at IS NULL "
            "AND cancelled_at IS NULL AND cancellation_source IS NULL) OR "
            "(status = 'PUBLISHED' AND published_at IS NOT NULL "
            "AND cancelled_at IS NULL AND cancellation_source IS NULL) OR "
            "(status = 'CANCELLED' AND cancelled_at IS NOT NULL AND "
            "cancellation_source IS NOT NULL AND "
            "(published_at IS NULL OR cancelled_at >= published_at))",
            name="ck_open_games_status_timestamps",
        ),
        CheckConstraint(
            "(status = 'CANCELLED' AND cancelled_at IS NOT NULL "
            "AND cancellation_source IS NOT NULL) OR "
            "(status <> 'CANCELLED' AND cancelled_at IS NULL "
            "AND cancellation_source IS NULL)",
            name="ck_open_games_cancellation_source_status",
        ),
        UniqueConstraint("share_token", name="uq_open_games_share_token"),
        UniqueConstraint("id", "order_id", name="uq_open_games_id_order_id"),
        Index(
            "uq_open_games_one_active_per_order",
            "order_id",
            unique=True,
            postgresql_where=text("status <> 'CANCELLED'"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    order_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "orders.id",
            name="fk_open_games_order_id_orders",
            ondelete="RESTRICT",
        ),
    )
    team_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "teams.id",
            name="fk_open_games_team_id_teams",
            ondelete="RESTRICT",
        ),
    )
    name: Mapped[str] = mapped_column(String(30))
    total_players: Mapped[int] = mapped_column(Integer)
    fixed_players: Mapped[int] = mapped_column(Integer)
    open_spots: Mapped[int] = mapped_column(Integer)
    intensity: Mapped[OpenGameIntensity] = mapped_column(
        Enum(OpenGameIntensity, name="open_game_intensity")
    )
    minimum_experience: Mapped[str | None] = mapped_column(
        String(60), nullable=True
    )
    position_mask: Mapped[int] = mapped_column(SmallInteger)
    aa_cents: Mapped[int] = mapped_column(Integer)
    registration_deadline: Mapped[datetime] = mapped_column(
        DateTime(timezone=True)
    )
    equipment_and_arrival_notes: Mapped[str | None] = mapped_column(
        String(200), nullable=True
    )
    visibility: Mapped[OpenGameVisibility] = mapped_column(
        Enum(OpenGameVisibility, name="open_game_visibility")
    )
    status: Mapped[OpenGameStatus] = mapped_column(
        Enum(OpenGameStatus, name="open_game_status")
    )
    version: Mapped[int] = mapped_column(Integer)
    share_token: Mapped[str] = mapped_column(String(64))
    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    cancelled_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    cancellation_source: Mapped[OpenGameCancellationSource | None] = mapped_column(
        Enum(OpenGameCancellationSource, name="open_game_cancellation_source"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    order: Mapped[Order] = relationship(back_populates="open_games")
    team: Mapped[Team] = relationship(back_populates="open_games")
    registrations: Mapped[list["OpenGameRegistration"]] = relationship(
        back_populates="game",
        foreign_keys="OpenGameRegistration.game_id",
    )


class OpenGameRegistration(Base):
    __tablename__ = "open_game_registrations"
    __table_args__ = (
        CheckConstraint(
            "length(display_name) BETWEEN 2 AND 24 "
            "AND display_name = trim(display_name)",
            name="ck_open_game_registrations_display_name",
        ),
        CheckConstraint(
            "note IS NULL OR (length(note) BETWEEN 1 AND 120 "
            "AND note = trim(note))",
            name="ck_open_game_registrations_note",
        ),
        CheckConstraint(
            "version >= 1",
            name="ck_open_game_registrations_version",
        ),
        CheckConstraint(
            "length(consent_version) BETWEEN 1 AND 32 "
            "AND consent_version = trim(consent_version)",
            name="ck_open_game_registrations_consent_version",
        ),
        CheckConstraint(
            "(status = 'APPLIED' AND decided_at IS NULL "
            "AND decided_by_user_id IS NULL) OR "
            "(status IN ('WAITLISTED', 'JOINED', 'REJECTED', 'REMOVED') "
            "AND decided_at IS NOT NULL "
            "AND decided_by_user_id IS NOT NULL) OR "
            "(status = 'WITHDRAWN' AND withdrawal_kind = 'APPLICATION_WITHDRAWAL' "
            "AND decided_at IS NULL AND decided_by_user_id IS NULL) OR "
            "(status = 'WITHDRAWN' "
            "AND withdrawal_kind IN ('WAITLIST_WITHDRAWAL', 'GAME_EXIT') "
            "AND decided_at IS NOT NULL AND decided_by_user_id IS NOT NULL)",
            name="ck_open_game_registrations_decision_pair",
        ),
        CheckConstraint(
            "(status IN ('APPLIED', 'WAITLISTED', 'JOINED', 'REJECTED', 'REMOVED') "
            "AND withdrawn_at IS NULL AND withdrawal_kind IS NULL "
            "AND late_exit_recorded = false) OR "
            "(status = 'WITHDRAWN' AND withdrawn_at IS NOT NULL "
            "AND withdrawal_kind IS NOT NULL "
            "AND (withdrawal_kind = 'GAME_EXIT' OR late_exit_recorded = false))",
            name="ck_open_game_registrations_withdrawal_pair",
        ),
        CheckConstraint(
            "decided_at IS NULL OR decided_at >= applied_at",
            name="ck_open_game_registrations_decision_time",
        ),
        CheckConstraint(
            "waitlist_seq IS NULL OR waitlist_seq > 0",
            name="ck_open_game_registrations_waitlist_seq",
        ),
        CheckConstraint(
            "(status IN ('APPLIED', 'REJECTED') "
            "AND waitlist_seq IS NULL AND waitlisted_at IS NULL "
            "AND promoted_at IS NULL) OR "
            "(status = 'WAITLISTED' AND waitlist_seq IS NOT NULL "
            "AND waitlisted_at IS NOT NULL AND promoted_at IS NULL) OR "
            "(status IN ('JOINED', 'REMOVED') AND ((waitlist_seq IS NULL "
            "AND waitlisted_at IS NULL AND promoted_at IS NULL) OR "
            "(waitlist_seq IS NOT NULL AND waitlisted_at IS NOT NULL "
            "AND promoted_at IS NOT NULL))) OR "
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
            "AND promoted_at IS NOT NULL)))",
            name="ck_open_game_registrations_waitlist_history",
        ),
        CheckConstraint(
            "(waitlisted_at IS NULL OR "
            "(waitlisted_at = decided_at AND waitlisted_at >= applied_at)) AND "
            "(promoted_at IS NULL OR promoted_at >= waitlisted_at)",
            name="ck_open_game_registrations_waitlist_time",
        ),
        CheckConstraint(
            "withdrawn_at IS NULL OR "
            "(withdrawal_kind = 'APPLICATION_WITHDRAWAL' "
            "AND withdrawn_at >= applied_at) OR "
            "(withdrawal_kind = 'WAITLIST_WITHDRAWAL' "
            "AND withdrawn_at >= waitlisted_at) OR "
            "(withdrawal_kind = 'GAME_EXIT' AND withdrawn_at >= decided_at "
            "AND (promoted_at IS NULL OR withdrawn_at >= promoted_at))",
            name="ck_open_game_registrations_withdrawal_time",
        ),
        CheckConstraint(
            "(attendance_status = 'UNMARKED' "
            "AND attendance_recorded_at IS NULL "
            "AND attendance_recorded_by_user_id IS NULL) OR "
            "(attendance_status IN ('PRESENT', 'NO_SHOW') "
            "AND attendance_recorded_at IS NOT NULL "
            "AND attendance_recorded_by_user_id IS NOT NULL)",
            name="ck_open_game_registrations_attendance_audit",
        ),
        CheckConstraint(
            "attendance_status = 'UNMARKED' OR status = 'JOINED'",
            name="ck_open_game_registrations_attendance_joined",
        ),
        CheckConstraint(
            "(status = 'REMOVED' AND removed_at IS NOT NULL "
            "AND removed_by_user_id IS NOT NULL) OR "
            "(status != 'REMOVED' AND removed_at IS NULL "
            "AND removed_by_user_id IS NULL)",
            name="ck_open_game_registrations_removal_pair",
        ),
        CheckConstraint(
            "removed_at IS NULL OR (removed_at >= decided_at "
            "AND (promoted_at IS NULL OR removed_at >= promoted_at))",
            name="ck_open_game_registrations_removal_time",
        ),
        UniqueConstraint(
            "game_id",
            "applicant_user_id",
            name="uq_open_game_registrations_game_applicant",
        ),
        UniqueConstraint(
            "game_id",
            "waitlist_seq",
            name="uq_open_game_registrations_game_waitlist_seq",
        ),
        UniqueConstraint(
            "id",
            "game_id",
            "applicant_user_id",
            name="uq_open_game_registrations_outbox_identity",
        ),
        Index(
            "ix_open_game_registrations_pending",
            "game_id",
            "status",
            "applied_at",
            "id",
            postgresql_where=text("status = 'APPLIED'"),
        ),
        Index(
            "ix_open_game_registrations_applicant_applied",
            "applicant_user_id",
            "applied_at",
            "id",
        ),
        Index(
            "ix_open_game_registrations_active_waitlist",
            "game_id",
            "status",
            "waitlist_seq",
            postgresql_where=text("status = 'WAITLISTED'"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    game_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "open_games.id",
            name="fk_open_game_registrations_game_id_open_games",
            ondelete="RESTRICT",
        ),
    )
    applicant_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "users.id",
            name="fk_open_game_registrations_applicant_user_id_users",
            ondelete="RESTRICT",
        ),
    )
    display_name: Mapped[str] = mapped_column(String(24))
    position: Mapped[OpenGameRegistrationPosition] = mapped_column(
        Enum(
            OpenGameRegistrationPosition,
            name="open_game_registration_position",
        )
    )
    note: Mapped[str | None] = mapped_column(String(120), nullable=True)
    status: Mapped[OpenGameRegistrationStatus] = mapped_column(
        Enum(OpenGameRegistrationStatus, name="open_game_registration_status")
    )
    attendance_status: Mapped[OpenGameAttendanceStatus] = mapped_column(
        Enum(OpenGameAttendanceStatus, name="open_game_attendance_status"),
        nullable=False,
        default=OpenGameAttendanceStatus.UNMARKED,
        server_default=text("'UNMARKED'"),
    )
    attendance_recorded_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    attendance_recorded_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "users.id",
            name=(
                "fk_open_game_registrations_"
                "attendance_recorded_by_user_id_users"
            ),
            ondelete="RESTRICT",
        ),
        nullable=True,
    )
    version: Mapped[int] = mapped_column(Integer)
    consent_version: Mapped[str] = mapped_column(String(32))
    adult_confirmed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True)
    )
    risk_confirmed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    applied_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    decided_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    decided_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "users.id",
            name="fk_open_game_registrations_decided_by_user_id_users",
            ondelete="RESTRICT",
        ),
        nullable=True,
    )
    withdrawn_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    withdrawal_kind: Mapped[OpenGameRegistrationWithdrawalKind | None] = mapped_column(
        Enum(
            OpenGameRegistrationWithdrawalKind,
            name="open_game_registration_withdrawal_kind",
        ),
        nullable=True,
    )
    late_exit_recorded: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("false"),
    )
    waitlist_seq: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    waitlisted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    promoted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    removed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    removed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "users.id",
            name="fk_open_game_registrations_removed_by_user_id_users",
            ondelete="RESTRICT",
        ),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    game: Mapped[OpenGame] = relationship(
        back_populates="registrations", foreign_keys=[game_id]
    )
    applicant: Mapped[User] = relationship(
        back_populates="open_game_registrations",
        foreign_keys=[applicant_user_id],
    )
    decided_by: Mapped[User | None] = relationship(
        back_populates="decided_open_game_registrations",
        foreign_keys=[decided_by_user_id],
    )


class OpenGameMemberRemoval(Base):
    __tablename__ = "open_game_member_removals"
    __table_args__ = (
        CheckConstraint(
            "length(reason) BETWEEN 1 AND 120 AND reason = trim(reason)",
            name="ck_open_game_member_removals_reason",
        ),
        CheckConstraint(
            "registration_version_before >= 1 AND "
            "registration_version_after = registration_version_before + 1",
            name="ck_open_game_member_removals_registration_version",
        ),
        CheckConstraint(
            "(promoted_registration_id IS NULL "
            "AND promoted_applicant_user_id IS NULL "
            "AND promoted_registration_version_before IS NULL "
            "AND promoted_registration_version_after IS NULL) OR "
            "(promoted_registration_id IS NOT NULL "
            "AND promoted_applicant_user_id IS NOT NULL "
            "AND promoted_registration_id != registration_id "
            "AND promoted_registration_version_before IS NOT NULL "
            "AND promoted_registration_version_after IS NOT NULL "
            "AND promoted_registration_version_before >= 1 "
            "AND promoted_registration_version_after = "
            "promoted_registration_version_before + 1)",
            name="ck_open_game_member_removals_promotion_pair",
        ),
        CheckConstraint(
            "length(idempotency_key) BETWEEN 16 AND 128",
            name="ck_open_game_member_removals_idempotency_key",
        ),
        CheckConstraint(
            "request_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_open_game_member_removals_request_sha256",
        ),
        ForeignKeyConstraint(
            ["registration_id", "game_id", "applicant_user_id"],
            [
                "open_game_registrations.id",
                "open_game_registrations.game_id",
                "open_game_registrations.applicant_user_id",
            ],
            name="fk_member_removals_registration_identity",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["game_id", "order_id"],
            ["open_games.id", "open_games.order_id"],
            name="fk_member_removals_game_order",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            [
                "promoted_registration_id",
                "game_id",
                "promoted_applicant_user_id",
            ],
            [
                "open_game_registrations.id",
                "open_game_registrations.game_id",
                "open_game_registrations.applicant_user_id",
            ],
            name="fk_member_removals_promoted_registration_identity",
            ondelete="RESTRICT",
        ),
        PrimaryKeyConstraint("id", name="pk_open_game_member_removals"),
        UniqueConstraint(
            "registration_id", name="uq_open_game_member_removals_registration"
        ),
        UniqueConstraint(
            "removed_by_user_id",
            "idempotency_key",
            name="uq_open_game_member_removals_actor_idempotency_key",
        ),
        Index(
            "ix_open_game_member_removals_game_removed",
            "game_id",
            "removed_at",
            "id",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), default=uuid.uuid4)
    registration_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
    )
    applicant_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    game_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
    )
    order_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "orders.id",
            name="fk_member_removals_order",
            ondelete="RESTRICT",
        ),
    )
    removed_by_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "users.id",
            name="fk_member_removals_removed_by_user",
            ondelete="RESTRICT",
        ),
    )
    reason: Mapped[str] = mapped_column(String(120))
    removed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    registration_version_before: Mapped[int] = mapped_column(Integer)
    registration_version_after: Mapped[int] = mapped_column(Integer)
    promoted_registration_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        nullable=True,
    )
    promoted_applicant_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        nullable=True,
    )
    promoted_registration_version_before: Mapped[int | None] = mapped_column(
        Integer, nullable=True
    )
    promoted_registration_version_after: Mapped[int | None] = mapped_column(
        Integer, nullable=True
    )
    idempotency_key: Mapped[str] = mapped_column(String(128))
    request_sha256: Mapped[str] = mapped_column(String(64))


class OpenGameReport(Base):
    __tablename__ = "open_game_reports"
    __table_args__ = (
        CheckConstraint(
            "length(facts) BETWEEN 1 AND 500 AND facts = btrim(facts)",
            name="ck_open_game_reports_facts",
        ),
        CheckConstraint(
            "length(idempotency_key) BETWEEN 16 AND 128",
            name="ck_open_game_reports_idempotency_key",
        ),
        CheckConstraint(
            "request_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_open_game_reports_request_sha256",
        ),
        ForeignKeyConstraint(
            ["reporter_registration_id", "game_id", "reporter_user_id"],
            [
                "open_game_registrations.id",
                "open_game_registrations.game_id",
                "open_game_registrations.applicant_user_id",
            ],
            name="fk_open_game_reports_reporter_registration_identity",
            ondelete="RESTRICT",
        ),
        PrimaryKeyConstraint("id", name="pk_open_game_reports"),
        UniqueConstraint(
            "game_id",
            "reporter_user_id",
            name="uq_open_game_reports_game_reporter",
        ),
        UniqueConstraint(
            "reporter_user_id",
            "idempotency_key",
            name="uq_open_game_reports_reporter_idempotency_key",
        ),
        Index(
            "ix_open_game_reports_submitted",
            text("submitted_at DESC"),
            text("id DESC"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), default=uuid.uuid4
    )
    game_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "open_games.id",
            name="fk_open_game_reports_game",
            ondelete="RESTRICT",
        ),
    )
    reporter_registration_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    reporter_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    organizer_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "users.id",
            name="fk_open_game_reports_organizer_user",
            ondelete="RESTRICT",
        ),
    )
    category: Mapped[OpenGameReportCategory] = mapped_column(
        Enum(OpenGameReportCategory, name="open_game_report_category")
    )
    facts: Mapped[str] = mapped_column(String(500))
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    idempotency_key: Mapped[str] = mapped_column(String(128))
    request_sha256: Mapped[str] = mapped_column(String(64))


class OpenGameReportResolution(Base):
    __tablename__ = "open_game_report_resolutions"
    __table_args__ = (
        CheckConstraint(
            "length(resolution_note) BETWEEN 1 AND 500 "
            "AND resolution_note = btrim(resolution_note)",
            name="ck_open_game_report_resolutions_note",
        ),
        CheckConstraint(
            "length(resolved_by_principal_id) BETWEEN 1 AND 128 "
            "AND resolved_by_principal_id = trim(resolved_by_principal_id)",
            name="ck_open_game_report_resolutions_principal",
        ),
        CheckConstraint(
            "(outcome = 'CONFIRMED_GAME_CANCELLED' "
            "AND game_version_before IS NOT NULL "
            "AND game_version_after IS NOT NULL "
            "AND game_version_before >= 1 "
            "AND game_version_after = game_version_before + 1) OR "
            "(outcome IN ('DISMISSED', 'CONFIRMED_RECORDED') "
            "AND game_version_before IS NULL AND game_version_after IS NULL)",
            name="ck_open_game_report_resolutions_version_pair",
        ),
        CheckConstraint(
            "length(idempotency_key) BETWEEN 16 AND 128",
            name="ck_open_game_report_resolutions_idempotency_key",
        ),
        CheckConstraint(
            "request_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_open_game_report_resolutions_request_sha256",
        ),
        PrimaryKeyConstraint("id", name="pk_open_game_report_resolutions"),
        UniqueConstraint(
            "report_id", name="uq_open_game_report_resolutions_report"
        ),
        UniqueConstraint(
            "resolved_by_principal_id",
            "idempotency_key",
            name="uq_open_game_report_resolutions_principal_idempotency_key",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), default=uuid.uuid4
    )
    report_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "open_game_reports.id",
            name="fk_open_game_report_resolutions_report",
            ondelete="RESTRICT",
        ),
    )
    outcome: Mapped[OpenGameReportResolutionOutcome] = mapped_column(
        Enum(
            OpenGameReportResolutionOutcome,
            name="open_game_report_resolution_outcome",
        )
    )
    resolution_note: Mapped[str] = mapped_column(String(500))
    resolved_by_principal_id: Mapped[str] = mapped_column(String(128))
    resolved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    game_version_before: Mapped[int | None] = mapped_column(Integer, nullable=True)
    game_version_after: Mapped[int | None] = mapped_column(Integer, nullable=True)
    idempotency_key: Mapped[str] = mapped_column(String(128))
    request_sha256: Mapped[str] = mapped_column(String(64))


class OpenGameAttendanceCorrection(Base):
    __tablename__ = "open_game_attendance_corrections"
    __table_args__ = (
        CheckConstraint(
            "from_status IN ('PRESENT', 'NO_SHOW') "
            "AND to_status IN ('PRESENT', 'NO_SHOW') "
            "AND from_status <> to_status",
            name="ck_open_game_attendance_corrections_status_transition",
        ),
        CheckConstraint(
            "length(reason) BETWEEN 1 AND 1000 AND reason = trim(reason)",
            name="ck_open_game_attendance_corrections_reason",
        ),
        CheckConstraint(
            "length(corrected_by_principal_id) BETWEEN 1 AND 128 "
            "AND corrected_by_principal_id = trim(corrected_by_principal_id)",
            name="ck_open_game_attendance_corrections_principal",
        ),
        CheckConstraint(
            "registration_version_before >= 1 "
            "AND registration_version_after = registration_version_before + 1",
            name="ck_open_game_attendance_corrections_version",
        ),
        CheckConstraint(
            "request_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_open_game_attendance_corrections_request_sha256",
        ),
        PrimaryKeyConstraint(
            "id",
            name="pk_open_game_attendance_corrections",
        ),
        UniqueConstraint(
            "registration_id",
            "registration_version_after",
            name=(
                "uq_open_game_attendance_corrections_"
                "registration_version_after"
            ),
        ),
        UniqueConstraint(
            "corrected_by_principal_id",
            "idempotency_key",
            name=(
                "uq_open_game_attendance_corrections_"
                "principal_idempotency_key"
            ),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), default=uuid.uuid4
    )
    registration_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "open_game_registrations.id",
            name="fk_attendance_corrections_registration",
            ondelete="RESTRICT",
        ),
    )
    from_status: Mapped[OpenGameAttendanceStatus] = mapped_column(
        Enum(OpenGameAttendanceStatus, name="open_game_attendance_status")
    )
    to_status: Mapped[OpenGameAttendanceStatus] = mapped_column(
        Enum(OpenGameAttendanceStatus, name="open_game_attendance_status")
    )
    reason: Mapped[str] = mapped_column(String(1000))
    corrected_by_principal_id: Mapped[str] = mapped_column(String(128))
    corrected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    registration_version_before: Mapped[int] = mapped_column(Integer)
    registration_version_after: Mapped[int] = mapped_column(Integer)
    idempotency_key: Mapped[str] = mapped_column(String(128))
    request_sha256: Mapped[str] = mapped_column(String(64))


class OpenGameNotificationOutbox(Base):
    __tablename__ = "open_game_notification_outbox"
    __table_args__ = (
        CheckConstraint(
            "length(trim(dedupe_key)) > 0",
            name="ck_open_game_notification_outbox_dedupe_key",
        ),
        CheckConstraint(
            "length(trim(template_key)) > 0",
            name="ck_open_game_notification_outbox_template_key",
        ),
        CheckConstraint(
            "jsonb_typeof(payload) = 'object'",
            name="ck_open_game_notification_outbox_payload_object",
        ),
        CheckConstraint(
            "event = 'WAITLIST_PROMOTED' AND "
            "payload ?& ARRAY['game_name', 'starts_at', 'venue_name'] AND "
            "payload - ARRAY['game_name', 'starts_at', 'venue_name'] "
            "= '{}'::jsonb AND "
            "jsonb_typeof(payload -> 'game_name') = 'string' AND "
            "length(trim(payload ->> 'game_name')) > 0 AND "
            "jsonb_typeof(payload -> 'starts_at') = 'string' AND "
            "length(trim(payload ->> 'starts_at')) > 0 AND "
            "jsonb_typeof(payload -> 'venue_name') = 'string' AND "
            "length(trim(payload ->> 'venue_name')) > 0",
            name="ck_open_game_notification_outbox_payload_waitlist_promoted",
        ),
        CheckConstraint(
            "attempt_count >= 0",
            name="ck_open_game_notification_outbox_attempt_count",
        ),
        CheckConstraint(
            "((status = 'CLAIMED' AND claim_token IS NOT NULL "
            "AND lease_until IS NOT NULL) OR "
            "(status != 'CLAIMED' AND claim_token IS NULL "
            "AND lease_until IS NULL))",
            name="ck_open_game_notification_outbox_claim_lease",
        ),
        CheckConstraint(
            "((status IN ('SENT', 'FAILED', 'SUPERSEDED') "
            "AND completed_at IS NOT NULL) OR "
            "(status IN ('PENDING', 'CLAIMED') AND completed_at IS NULL))",
            name="ck_open_game_notification_outbox_completion",
        ),
        CheckConstraint(
            "(last_failure_code IS NULL OR "
            "length(trim(last_failure_code)) > 0) AND "
            "(status != 'FAILED' OR last_failure_code IS NOT NULL)",
            name="ck_open_game_notification_outbox_failure_code",
        ),
        CheckConstraint(
            "(status != 'PENDING' OR delivery_started_at IS NULL) AND "
            "(status != 'SENT' OR delivery_started_at IS NOT NULL)",
            name="ck_open_game_notification_outbox_delivery_start",
        ),
        ForeignKeyConstraint(
            ["registration_id", "game_id", "recipient_user_id"],
            [
                "open_game_registrations.id",
                "open_game_registrations.game_id",
                "open_game_registrations.applicant_user_id",
            ],
            name="fk_open_game_notification_outbox_registration_identity",
            ondelete="RESTRICT",
        ),
        PrimaryKeyConstraint("id", name="pk_open_game_notification_outbox"),
        UniqueConstraint(
            "dedupe_key",
            name="uq_open_game_notification_outbox_dedupe_key",
        ),
        Index(
            "ix_open_game_notification_outbox_due",
            "available_at",
            "id",
            postgresql_where=text("status = 'PENDING'"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), default=uuid.uuid4
    )
    dedupe_key: Mapped[str] = mapped_column(String(200))
    game_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "open_games.id",
            name="fk_open_game_notification_outbox_game_id_open_games",
            ondelete="RESTRICT",
        ),
    )
    registration_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "open_game_registrations.id",
            name="fk_open_game_notification_outbox_registration",
            ondelete="RESTRICT",
        ),
    )
    recipient_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "users.id",
            name="fk_open_game_notification_outbox_recipient_user_id_users",
            ondelete="RESTRICT",
        ),
    )
    event: Mapped[OpenGameNotificationEvent] = mapped_column(
        Enum(OpenGameNotificationEvent, name="open_game_notification_event")
    )
    template_key: Mapped[str] = mapped_column(String(64))
    status: Mapped[OpenGameNotificationStatus] = mapped_column(
        Enum(OpenGameNotificationStatus, name="open_game_notification_status")
    )
    payload: Mapped[WaitlistPromotedNotificationPayload] = mapped_column(JSONB)
    attempt_count: Mapped[int] = mapped_column(Integer)
    available_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    claim_token: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    lease_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    delivery_started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_failure_code: Mapped[str | None] = mapped_column(
        String(64), nullable=True
    )


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
        CheckConstraint(
            "applied_to_order_at IS NULL OR status = 'SUCCESS'",
            name="ck_payments_applied_success",
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
            "uq_payments_one_applied_per_order",
            "order_id",
            unique=True,
            postgresql_where=text("applied_to_order_at IS NOT NULL"),
        ),
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
    applied_to_order_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
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
    refund_case: Mapped["RefundCase | None"] = relationship(back_populates="payment")


class RefundCase(Base):
    __tablename__ = "refund_cases"
    __table_args__ = (
        CheckConstraint("amount_cents >= 0", name="ck_refund_cases_amount_cents"),
        CheckConstraint(
            "length(trim(currency)) > 0",
            name="ck_refund_cases_currency_nonempty",
        ),
        CheckConstraint(
            "(reason = 'VENUE_CANCELLED' AND reason_note IS NOT NULL "
            "AND length(trim(reason_note)) BETWEEN 1 AND 500 "
            "AND reason_note = trim(reason_note)) OR "
            "(reason <> 'VENUE_CANCELLED' AND reason_note IS NULL)",
            name="ck_refund_cases_reason_note",
        ),
        UniqueConstraint("payment_id", name="uq_refund_cases_payment_id"),
        Index("ix_refund_cases_order_id", "order_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    order_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("orders.id", name="fk_refund_cases_order_id_orders", ondelete="RESTRICT"),
    )
    payment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "payments.id",
            name="fk_refund_cases_payment_id_payments",
            ondelete="RESTRICT",
        ),
    )
    purpose: Mapped[RefundCasePurpose] = mapped_column(
        Enum(RefundCasePurpose, name="refund_case_purpose")
    )
    reason: Mapped[RefundReason] = mapped_column(
        Enum(RefundReason, name="refund_reason")
    )
    reason_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    requested_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "users.id",
            name="fk_refund_cases_requested_by_user_id_users",
            ondelete="RESTRICT",
        ),
        nullable=True,
    )
    amount_cents: Mapped[int] = mapped_column(Integer)
    currency: Mapped[str] = mapped_column(String(3))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    order: Mapped[Order] = relationship(back_populates="refund_cases")
    payment: Mapped[Payment] = relationship(back_populates="refund_case")
    attempts: Mapped[list["RefundAttempt"]] = relationship(back_populates="refund_case")


class RefundAttempt(Base):
    __tablename__ = "refund_attempts"
    __table_args__ = (
        CheckConstraint(
            "length(trim(provider)) > 0",
            name="ck_refund_attempts_provider_nonempty",
        ),
        CheckConstraint(
            "length(trim(merchant_refund_no)) BETWEEN 1 AND 32",
            name="ck_refund_attempts_merchant_refund_no",
        ),
        CheckConstraint(
            "provider_refund_no IS NULL OR length(trim(provider_refund_no)) > 0",
            name="ck_refund_attempts_provider_refund_no",
        ),
        CheckConstraint("attempt_no >= 1", name="ck_refund_attempts_attempt_no"),
        CheckConstraint(
            "failure_code IS NULL OR length(trim(failure_code)) > 0",
            name="ck_refund_attempts_failure_code",
        ),
        CheckConstraint(
            "status <> 'SUCCESS' OR refunded_at IS NOT NULL",
            name="ck_refund_attempts_success_refunded_at",
        ),
        CheckConstraint(
            "(reconcile_claim_token IS NULL) = (reconcile_lease_until IS NULL)",
            name="ck_refund_attempts_reconcile_lease_pair",
        ),
        UniqueConstraint(
            "provider",
            "merchant_refund_no",
            name="uq_refund_attempts_provider_merchant_refund_no",
        ),
        UniqueConstraint(
            "refund_case_id",
            "attempt_no",
            name="uq_refund_attempts_case_attempt_no",
        ),
        Index("ix_refund_attempts_case_id", "refund_case_id"),
        Index(
            "uq_refund_attempts_provider_refund_no",
            "provider",
            "provider_refund_no",
            unique=True,
            postgresql_where=text("provider_refund_no IS NOT NULL"),
        ),
        Index(
            "uq_refund_attempts_one_active_per_case",
            "refund_case_id",
            unique=True,
            postgresql_where=text(
                "status IN ('CREATING', 'PROCESSING', 'UNKNOWN')"
            ),
        ),
        Index(
            "ix_refund_attempts_reconciliation_due",
            "next_reconcile_at",
            "id",
            postgresql_where=text(
                "status IN ('CREATING', 'PROCESSING', 'UNKNOWN') "
                "AND next_reconcile_at IS NOT NULL"
            ),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    refund_case_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "refund_cases.id",
            name="fk_refund_attempts_case_id_refund_cases",
            ondelete="RESTRICT",
        ),
    )
    provider: Mapped[str] = mapped_column(String(40))
    merchant_refund_no: Mapped[str] = mapped_column(String(32))
    provider_refund_no: Mapped[str | None] = mapped_column(String(128), nullable=True)
    status: Mapped[RefundAttemptStatus] = mapped_column(
        Enum(RefundAttemptStatus, name="refund_attempt_status")
    )
    attempt_no: Mapped[int] = mapped_column(Integer)
    failure_code: Mapped[str | None] = mapped_column(String(80), nullable=True)
    next_reconcile_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    reconcile_claim_token: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    reconcile_lease_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    refunded_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    refund_case: Mapped[RefundCase] = relationship(back_populates="attempts")


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
