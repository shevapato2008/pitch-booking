import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID, ExcludeConstraint
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
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pitch_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("pitches.id", ondelete="RESTRICT")
    )
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[SlotStatus] = mapped_column(Enum(SlotStatus, name="slot_status"))
    price_cents: Mapped[int] = mapped_column(Integer)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    locked_by_order_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    pitch: Mapped[Pitch] = relationship(back_populates="slots")
