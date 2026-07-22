import type {
  Availability,
  AvailabilityWindow,
  Facility,
  FacilityCode,
  ImageRole,
  PitchGroup,
  PitchType,
  Slot,
  SlotStatus,
  UnavailableReason,
  Venue,
  VenueImage,
  VenuePitchType,
} from "./contracts";
import {
  arrayAt,
  dateAt,
  enumAt,
  exactObject,
  httpsUrlAt,
  integerAt,
  invalid,
  numberAt,
  rfc3339At,
  rfc3339Before,
  stringAt,
  uuidAt,
} from "./decoder-primitives";

const PITCH_TYPES = ["FIVE_A_SIDE", "SEVEN_A_SIDE"] as const;
const IMAGE_ROLES = ["COVER", "GALLERY"] as const;
const FACILITY_CODES = ["LIGHTING", "CHANGING_ROOM", "DRINKING_WATER", "PARKING"] as const;
const SLOT_STATUSES = ["AVAILABLE", "TEMPORARILY_LOCKED", "BOOKED", "CLOSED", "EXPIRED"] as const;
const STATUS_REASONS: Record<SlotStatus, UnavailableReason | null> = {
  AVAILABLE: null,
  TEMPORARILY_LOCKED: "HELD_FOR_PAYMENT",
  BOOKED: "ALREADY_BOOKED",
  CLOSED: "VENUE_CLOSED",
  EXPIRED: "TIME_PASSED",
};

function decodeWindow(value: unknown, path: string): AvailabilityWindow {
  const object = exactObject(value, ["start_date", "end_date"], path);
  const startDate = dateAt(object.start_date, `${path}.start_date`);
  const endDate = dateAt(object.end_date, `${path}.end_date`);
  if (startDate > endDate) invalid(path);
  return { startDate, endDate };
}

function decodeImage(value: unknown, path: string): VenueImage {
  const object = exactObject(value, ["url", "alt", "role", "sort_order"], path);
  return {
    url: httpsUrlAt(object.url, `${path}.url`),
    alt: stringAt(object.alt, `${path}.alt`),
    role: enumAt<ImageRole>(object.role, IMAGE_ROLES, `${path}.role`),
    sortOrder: integerAt(object.sort_order, `${path}.sort_order`),
  };
}

function decodeFacility(value: unknown, path: string): Facility {
  const object = exactObject(value, ["code", "name", "sort_order"], path);
  return {
    code: enumAt<FacilityCode>(object.code, FACILITY_CODES, `${path}.code`),
    name: stringAt(object.name, `${path}.name`),
    sortOrder: integerAt(object.sort_order, `${path}.sort_order`),
  };
}

function decodePitchType(value: unknown, path: string): VenuePitchType {
  const object = exactObject(value, ["code", "name", "sort_order"], path);
  return {
    code: enumAt<PitchType>(object.code, PITCH_TYPES, `${path}.code`),
    name: stringAt(object.name, `${path}.name`),
    sortOrder: integerAt(object.sort_order, `${path}.sort_order`),
  };
}

function assertSorted<T>(
  items: T[],
  select: (item: T) => number | string,
  path: string,
  field: string,
): void {
  for (let index = 1; index < items.length; index += 1) {
    if (select(items[index - 1]) > select(items[index])) invalid(`${path}[${index}].${field}`);
  }
}

export function decodeVenue(value: unknown): Venue {
  const path = "$";
  const object = exactObject(value, [
    "id", "name", "description", "price_advantage_text", "timezone",
    "business_hours_text", "address", "latitude", "longitude", "parking_text",
    "phone", "refund_policy_summary", "images", "facilities", "pitch_types",
    "availability_window", "generated_at",
  ], path);
  const images = arrayAt(object.images, "$.images", 1)
    .map((image, index) => decodeImage(image, `$.images[${index}]`));
  const decoded: Venue = {
    id: uuidAt(object.id, "$.id"),
    name: stringAt(object.name, "$.name"),
    description: stringAt(object.description, "$.description", true),
    priceAdvantageText: stringAt(object.price_advantage_text, "$.price_advantage_text"),
    timezone: enumAt(object.timezone, ["Asia/Shanghai"] as const, "$.timezone"),
    businessHoursText: stringAt(object.business_hours_text, "$.business_hours_text"),
    address: stringAt(object.address, "$.address"),
    latitude: numberAt(object.latitude, "$.latitude", -90, 90),
    longitude: numberAt(object.longitude, "$.longitude", -180, 180),
    parkingText: stringAt(object.parking_text, "$.parking_text"),
    phone: stringAt(object.phone, "$.phone"),
    refundPolicySummary: stringAt(object.refund_policy_summary, "$.refund_policy_summary"),
    images,
    facilities: arrayAt(object.facilities, "$.facilities", 1)
      .map((facility, index) => decodeFacility(facility, `$.facilities[${index}]`)),
    pitchTypes: arrayAt(object.pitch_types, "$.pitch_types", 1)
      .map((pitchType, index) => decodePitchType(pitchType, `$.pitch_types[${index}]`)),
    availabilityWindow: decodeWindow(object.availability_window, "$.availability_window"),
    generatedAt: rfc3339At(object.generated_at, "$.generated_at"),
  };
  if (decoded.images.filter((image) => image.role === "COVER").length !== 1) invalid("$.images");
  assertSorted(decoded.images, (image) => image.sortOrder, "$.images", "sort_order");
  assertSorted(decoded.facilities, (facility) => facility.sortOrder, "$.facilities", "sort_order");
  assertSorted(decoded.pitchTypes, (pitchType) => pitchType.sortOrder, "$.pitch_types", "sort_order");
  return decoded;
}

function decodeSlot(value: unknown, path: string): Slot {
  const object = exactObject(
    value,
    ["id", "starts_at", "ends_at", "price_cents", "status", "unavailable_reason"],
    path,
  );
  const startsAt = rfc3339At(object.starts_at, `${path}.starts_at`);
  const endsAt = rfc3339At(object.ends_at, `${path}.ends_at`);
  if (!rfc3339Before(startsAt, endsAt)) invalid(`${path}.ends_at`);
  const status = enumAt<SlotStatus>(object.status, SLOT_STATUSES, `${path}.status`);
  const expectedReason = STATUS_REASONS[status];
  if (object.unavailable_reason !== expectedReason) invalid(`${path}.unavailable_reason`);
  return {
    id: uuidAt(object.id, `${path}.id`),
    startsAt,
    endsAt,
    priceCents: integerAt(object.price_cents, `${path}.price_cents`),
    status,
    unavailableReason: expectedReason,
  };
}

function decodePitchGroup(value: unknown, path: string): PitchGroup {
  const object = exactObject(value, ["id", "name", "pitch_type", "sort_order", "slots"], path);
  return {
    id: uuidAt(object.id, `${path}.id`),
    name: stringAt(object.name, `${path}.name`),
    pitchType: enumAt<PitchType>(object.pitch_type, PITCH_TYPES, `${path}.pitch_type`),
    sortOrder: integerAt(object.sort_order, `${path}.sort_order`),
    slots: arrayAt(object.slots, `${path}.slots`)
      .map((slot, index) => decodeSlot(slot, `${path}.slots[${index}]`)),
  };
}

export function decodeAvailability(value: unknown): Availability {
  const object = exactObject(value, [
    "venue_id", "timezone", "date", "pitch_type", "availability_window", "pitches", "generated_at",
  ], "$");
  const decoded: Availability = {
    venueId: uuidAt(object.venue_id, "$.venue_id"),
    timezone: enumAt(object.timezone, ["Asia/Shanghai"] as const, "$.timezone"),
    date: dateAt(object.date, "$.date"),
    pitchType: enumAt<PitchType>(object.pitch_type, PITCH_TYPES, "$.pitch_type"),
    availabilityWindow: decodeWindow(object.availability_window, "$.availability_window"),
    pitchGroups: arrayAt(object.pitches, "$.pitches")
      .map((pitch, index) => decodePitchGroup(pitch, `$.pitches[${index}]`)),
    generatedAt: rfc3339At(object.generated_at, "$.generated_at"),
  };
  if (decoded.date < decoded.availabilityWindow.startDate
    || decoded.date > decoded.availabilityWindow.endDate) {
    invalid("$.date");
  }
  assertSorted(decoded.pitchGroups, (pitch) => pitch.sortOrder, "$.pitches", "sort_order");
  decoded.pitchGroups.forEach((pitch, pitchIndex) => {
    const pitchPath = `$.pitches[${pitchIndex}]`;
    if (pitch.pitchType !== decoded.pitchType) invalid(`${pitchPath}.pitch_type`);
    assertSorted(pitch.slots, (slot) => slot.startsAt, `${pitchPath}.slots`, "starts_at");
    pitch.slots.forEach((slot, slotIndex) => {
      const slotPath = `${pitchPath}.slots[${slotIndex}]`;
      if (slot.startsAt.slice(0, 10) !== decoded.date) invalid(`${slotPath}.starts_at`);
      if (slot.endsAt.slice(0, 10) !== decoded.date) invalid(`${slotPath}.ends_at`);
      if (slotIndex > 0 && rfc3339Before(slot.startsAt, pitch.slots[slotIndex - 1].endsAt)) {
        invalid(`${slotPath}.starts_at`);
      }
    });
  });
  return decoded;
}
