import type {
  ApiErrorCode,
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
  PublishedVenueProfile,
  PhoneVerificationView,
  SessionTokenView,
} from "./contracts";
import type { CheckoutView, OrderView, PaymentState } from "./booking";
import type { VenueDetail, VenueMapEntry, VenuePitchType as DirectoryPitchType } from "./venue-directory";
import type {
  PaymentLaunchParams,
  PaymentLaunchResult,
  PaymentPendingOrderView,
} from "./payment";
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
const DIRECTORY_PITCH_TYPES = ["FIVE_A_SIDE", "SEVEN_A_SIDE", "ELEVEN_A_SIDE"] as const;
const IMAGE_ROLES = ["COVER", "GALLERY"] as const;
const FACILITY_CODES = [
  "PARKING", "TOILET", "CHANGING_ROOM", "SHOWER", "LOCKERS", "DRINKING_WATER",
  "BEVERAGE_SALES", "EQUIPMENT_RENTAL", "REST_AREA", "FIRST_AID", "AED", "INDOOR",
  "OUTDOOR", "COVERED", "LIGHTING", "ARTIFICIAL_TURF", "NATURAL_GRASS",
] as const;
const SLOT_STATUSES = ["AVAILABLE", "TEMPORARILY_LOCKED", "BOOKED", "CLOSED", "EXPIRED"] as const;
const STATUS_REASONS: Record<SlotStatus, UnavailableReason | null> = {
  AVAILABLE: null,
  TEMPORARILY_LOCKED: "HELD_FOR_PAYMENT",
  BOOKED: "ALREADY_BOOKED",
  CLOSED: "VENUE_CLOSED",
  EXPIRED: "TIME_PASSED",
};

const API_ERROR_CODES = [
  "INVALID_ARGUMENT", "PITCH_TYPE_NOT_SUPPORTED", "DATE_OUT_OF_RANGE", "VENUE_NOT_FOUND",
  "SERVICE_UNAVAILABLE", "INTERNAL_ERROR", "PRIMARY_VENUE_MISCONFIGURED", "AUTH_REQUIRED",
  "WECHAT_LOGIN_FAILED", "PHONE_AUTH_REQUIRED", "PHONE_AUTH_UNAVAILABLE", "PHONE_AUTH_FAILED",
  "INVALID_CONTACT", "SLOT_NOT_AVAILABLE", "PRICE_CHANGED", "IDEMPOTENCY_KEY_REUSED",
  "ORDER_NOT_FOUND", "ORDER_EXPIRED", "PAYMENT_EXCEPTION", "PAYMENT_CREATE_FAILED",
  "VENUE_DIRECTORY_MISCONFIGURED",
] as const;
const PAYMENT_STATES = ["CREATING", "PREPAY_CREATED", "CONFIRMING", "SUCCESS", "CLOSED", "UNKNOWN"] as const;
const MASKED_PHONE = /^1[0-9]{2}\*{4}[0-9]{4}$/;

function nullableString(value: unknown, path: string, maxLength?: number): string | null {
  if (value === null) return null;
  const decoded = stringAt(value, path);
  if (maxLength !== undefined && [...decoded].length > maxLength) invalid(path);
  return decoded;
}

function boundedString(value: unknown, path: string, maxLength: number): string {
  const decoded = stringAt(value, path);
  if ([...decoded].length > maxLength) invalid(path);
  return decoded;
}

function maskedPhone(value: unknown, path: string): string {
  const decoded = stringAt(value, path);
  if (!MASKED_PHONE.test(decoded)) invalid(path);
  return decoded;
}

function booleanAt(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") invalid(path);
  return value;
}

export function decodeWeChatSession(value: unknown): SessionTokenView {
  const object = exactObject(value, ["session_token", "expires_at", "user"], "$");
  const user = exactObject(object.user, ["id", "masked_phone", "last_contact_name"], "$.user");
  const token = stringAt(object.session_token, "$.session_token");
  if (token.length < 43 || token.length > 256) invalid("$.session_token");
  nullableString(user.last_contact_name, "$.user.last_contact_name", 40);
  return {
    token,
    expiresAt: rfc3339At(object.expires_at, "$.expires_at"),
    user: {
      userId: uuidAt(user.id, "$.user.id"),
      maskedPhone: user.masked_phone === null ? null : maskedPhone(user.masked_phone, "$.user.masked_phone"),
    },
  };
}

export function decodePhoneVerification(value: unknown): PhoneVerificationView {
  const object = exactObject(value, ["masked_phone", "verified_at"], "$");
  return {
    maskedPhone: maskedPhone(object.masked_phone, "$.masked_phone"),
    verifiedAt: rfc3339At(object.verified_at, "$.verified_at"),
  };
}

export function decodeCheckout(value: unknown): CheckoutView {
  const object = exactObject(value, [
    "slot_id", "venue", "pitch", "date", "starts_at", "ends_at", "duration_minutes",
    "price_cents", "currency", "available", "cancellation_summary", "lock_duration_seconds",
    "contact", "checkout_version",
  ], "$");
  const venue = exactObject(object.venue, ["id", "name"], "$.venue");
  const pitch = exactObject(object.pitch, ["id", "name"], "$.pitch");
  const contact = exactObject(object.contact, ["masked_phone", "last_contact_name"], "$.contact");
  const startsAt = rfc3339At(object.starts_at, "$.starts_at");
  const endsAt = rfc3339At(object.ends_at, "$.ends_at");
  if (!rfc3339Before(startsAt, endsAt)) invalid("$.ends_at");
  if (object.currency !== "CNY") invalid("$.currency");
  if (object.available !== true) invalid("$.available");
  return {
    venueId: uuidAt(venue.id, "$.venue.id"),
    venueName: stringAt(venue.name, "$.venue.name"),
    pitchId: uuidAt(pitch.id, "$.pitch.id"),
    pitchName: stringAt(pitch.name, "$.pitch.name"),
    slotId: uuidAt(object.slot_id, "$.slot_id"),
    startsAt,
    endsAt,
    priceCents: integerAt(object.price_cents, "$.price_cents"),
    date: dateAt(object.date, "$.date"),
    durationMinutes: integerAt(object.duration_minutes, "$.duration_minutes", 1),
    currency: "CNY",
    available: true,
    cancellationSummary: stringAt(object.cancellation_summary, "$.cancellation_summary"),
    lockDurationSeconds: integerAt(object.lock_duration_seconds, "$.lock_duration_seconds", 1),
    maskedPhone: contact.masked_phone === null ? null : maskedPhone(contact.masked_phone, "$.contact.masked_phone"),
    lastContactName: nullableString(contact.last_contact_name, "$.contact.last_contact_name", 40),
    version: integerAt(object.checkout_version, "$.checkout_version", 1),
  };
}

export function decodeOrder(value: unknown): OrderView {
  const object = exactObject(value, [
    "id", "order_number", "status", "slot_id", "venue", "pitch", "starts_at", "ends_at",
    "duration_minutes", "price_cents", "currency", "contact", "created_at", "expires_at",
    "expired_at", "cancellation_summary", "payment_state", "payment_confirming",
    "closing_payment", "paid_at", "detail_path",
  ], "$");
  const venue = exactObject(object.venue, ["id", "name", "address", "latitude", "longitude"], "$.venue");
  const pitch = exactObject(object.pitch, ["id", "name"], "$.pitch");
  const contact = exactObject(object.contact, ["name", "masked_phone"], "$.contact");
  const orderId = uuidAt(object.id, "$.id");
  const status = enumAt(
    object.status,
    ["PENDING_PAYMENT", "CONFIRMED", "EXPIRED", "PAYMENT_EXCEPTION"] as const,
    "$.status",
  );
  const startsAt = rfc3339At(object.starts_at, "$.starts_at");
  const endsAt = rfc3339At(object.ends_at, "$.ends_at");
  if (!rfc3339Before(startsAt, endsAt)) invalid("$.ends_at");
  const expiredAt = object.expired_at === null ? null : rfc3339At(object.expired_at, "$.expired_at");
  const paymentState = object.payment_state === null
    ? null
    : enumAt<PaymentState>(object.payment_state, PAYMENT_STATES, "$.payment_state");
  const paymentConfirming = booleanAt(object.payment_confirming, "$.payment_confirming");
  const closingPayment = booleanAt(object.closing_payment, "$.closing_payment");
  const paidAt = object.paid_at === null ? null : rfc3339At(object.paid_at, "$.paid_at");
  if (object.currency !== "CNY") invalid("$.currency");
  const detailPath = stringAt(object.detail_path, "$.detail_path");
  if (detailPath !== `/api/v1/orders/${orderId}`) invalid("$.detail_path");
  const common = {
    orderId,
    orderNumber: stringAt(object.order_number, "$.order_number"),
    slotId: uuidAt(object.slot_id, "$.slot_id"),
    venue: {
      id: uuidAt(venue.id, "$.venue.id"), name: stringAt(venue.name, "$.venue.name"),
      address: stringAt(venue.address, "$.venue.address"),
      latitude: numberAt(venue.latitude, "$.venue.latitude", -90, 90),
      longitude: numberAt(venue.longitude, "$.venue.longitude", -180, 180),
    },
    pitch: { id: uuidAt(pitch.id, "$.pitch.id"), name: stringAt(pitch.name, "$.pitch.name") },
    contact: {
      name: boundedString(contact.name, "$.contact.name", 40),
      maskedPhone: maskedPhone(contact.masked_phone, "$.contact.masked_phone"),
    },
    priceCents: integerAt(object.price_cents, "$.price_cents"), startsAt, endsAt,
    durationMinutes: integerAt(object.duration_minutes, "$.duration_minutes", 1),
    currency: "CNY" as const,
    createdAt: rfc3339At(object.created_at, "$.created_at"),
    expiresAt: rfc3339At(object.expires_at, "$.expires_at"),
    cancellationSummary: stringAt(object.cancellation_summary, "$.cancellation_summary"),
    paymentState, paymentConfirming, closingPayment, paidAt, detailPath,
  };

  if (status === "PENDING_PAYMENT") {
    if (expiredAt !== null || paidAt !== null || paymentState === "SUCCESS") invalid("$.status");
    const unfinished = paymentState === "CREATING" || paymentState === "PREPAY_CREATED"
      || paymentState === "CONFIRMING" || paymentState === "UNKNOWN";
    const expectsConfirming = paymentState === "CONFIRMING" || paymentState === "UNKNOWN"
      || (closingPayment && unfinished);
    if (paymentConfirming !== expectsConfirming) invalid("$.payment_confirming");
    if (closingPayment && !unfinished) invalid("$.closing_payment");
    return { ...common, status, expiredAt: null } as PaymentPendingOrderView;
  }
  if (status === "CONFIRMED") {
    if (expiredAt !== null || paymentState !== "SUCCESS" || paymentConfirming || closingPayment || paidAt === null) {
      invalid("$.status");
    }
    return { ...common, status, expiredAt: null, paymentState: "SUCCESS", paymentConfirming: false, closingPayment: false, paidAt };
  }
  if (status === "EXPIRED") {
    if (expiredAt === null || (paymentState !== null && paymentState !== "CLOSED")
      || paymentConfirming || closingPayment || paidAt !== null) invalid("$.status");
    return { ...common, status, expiredAt, paymentState, paymentConfirming: false, closingPayment: false, paidAt: null };
  }
  if (expiredAt !== null || paymentConfirming || closingPayment
    || (paymentState === "UNKNOWN" && paidAt !== null)
    || (paymentState === "SUCCESS" && paidAt === null)
    || (paymentState !== "UNKNOWN" && paymentState !== "SUCCESS")) invalid("$.status");
  return { ...common, status, expiredAt: null, paymentState, paymentConfirming: false, closingPayment: false, paidAt } as Extract<OrderView, { status: "PAYMENT_EXCEPTION" }>;
}

function decodePaymentLaunchParams(value: unknown, path: string): PaymentLaunchParams {
  const object = exactObject(value, ["timeStamp", "nonceStr", "package", "signType", "paySign"], path);
  const paymentPackage = stringAt(object.package, `${path}.package`);
  if (!paymentPackage.startsWith("prepay_id=") || paymentPackage.length === "prepay_id=".length) {
    invalid(`${path}.package`);
  }
  if (object.signType !== "RSA") invalid(`${path}.signType`);
  return {
    timeStamp: stringAt(object.timeStamp, `${path}.timeStamp`),
    nonceStr: stringAt(object.nonceStr, `${path}.nonceStr`),
    package: paymentPackage,
    signType: "RSA",
    paySign: stringAt(object.paySign, `${path}.paySign`),
  };
}

export function decodePaymentLaunch(value: unknown): PaymentLaunchResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid("$");
  const status = stringAt((value as Record<string, unknown>).status, "$.status");
  if (status === "PREPAY_CREATED") {
    const object = exactObject(value, ["order_id", "payment_id", "status", "launch_params"], "$");
    uuidAt(object.order_id, "$.order_id");
    return {
      outcome: "PREPAY_CREATED",
      paymentId: uuidAt(object.payment_id, "$.payment_id"),
      launchParams: decodePaymentLaunchParams(object.launch_params, "$.launch_params"),
    };
  }
  if (status === "PAYMENT_CONFIRMING") {
    const object = exactObject(value, ["order_id", "payment_id", "status", "order"], "$");
    const orderId = uuidAt(object.order_id, "$.order_id");
    const order = decodeOrder(object.order);
    if (order.orderId !== orderId || (order.status !== "PENDING_PAYMENT" && order.status !== "PAYMENT_EXCEPTION")) {
      invalid("$.order");
    }
    return {
      outcome: "PAYMENT_CONFIRMING",
      paymentId: uuidAt(object.payment_id, "$.payment_id"),
      order: order as PaymentPendingOrderView | Extract<OrderView, { status: "PAYMENT_EXCEPTION" }>,
    };
  }
  if (status === "ALREADY_CONFIRMED") {
    const object = exactObject(value, ["order_id", "status", "order"], "$");
    const orderId = uuidAt(object.order_id, "$.order_id");
    const order = decodeOrder(object.order);
    if (order.status !== "CONFIRMED" || order.orderId !== orderId) invalid("$.order");
    return { outcome: "ALREADY_CONFIRMED", order };
  }
  invalid("$.status");
}

export type DecodedPaymentReconciliation =
  | {
      readonly outcome: "PAYMENT_CONFIRMING";
      readonly order: PaymentPendingOrderView | Extract<OrderView, { status: "PAYMENT_EXCEPTION" }>;
    }
  | { readonly outcome: "TERMINAL"; readonly order: OrderView };

export function decodePaymentReconciliation(value: unknown): DecodedPaymentReconciliation {
  if (typeof value === "object" && value !== null && !Array.isArray(value)
    && (value as Record<string, unknown>).status === "PAYMENT_CONFIRMING") {
    const decoded = decodePaymentLaunch(value);
    if (decoded.outcome !== "PAYMENT_CONFIRMING" || !decoded.order) invalid("$");
    return { outcome: "PAYMENT_CONFIRMING", order: decoded.order };
  }
  const order = decodeOrder(value);
  return { outcome: "TERMINAL", order };
}

export interface DecodedApiError {
  readonly code: ApiErrorCode;
  readonly details?: { readonly checkout: CheckoutView };
}

export function decodeApiError(value: unknown): DecodedApiError {
  const envelope = exactObject(value, ["error"], "$");
  const error = exactObject(envelope.error, ["code", "message", "request_id", "details"], "$.error");
  const code = enumAt<ApiErrorCode>(error.code, API_ERROR_CODES, "$.error.code");
  stringAt(error.message, "$.error.message");
  stringAt(error.request_id, "$.error.request_id");
  const details = error.details;
  if (typeof details !== "object" || details === null || Array.isArray(details)) invalid("$.error.details");
  const keys = Object.keys(details);
  if (code === "PRICE_CHANGED") {
    const exact = exactObject(details, ["current_checkout"], "$.error.details");
    return { code, details: { checkout: decodeCheckout(exact.current_checkout) } };
  }
  const allowed = new Set(["field", "pitch_type", "start_date", "end_date"]);
  for (const key of keys) if (!allowed.has(key)) invalid(`$.error.details.${key}`);
  const detailObject = details as Record<string, unknown>;
  if (detailObject.field !== undefined) stringAt(detailObject.field, "$.error.details.field");
  if (detailObject.pitch_type !== undefined) stringAt(detailObject.pitch_type, "$.error.details.pitch_type");
  if (detailObject.start_date !== undefined) dateAt(detailObject.start_date, "$.error.details.start_date");
  if (detailObject.end_date !== undefined) dateAt(detailObject.end_date, "$.error.details.end_date");
  return { code };
}

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

function decodePublishedProfile(value: unknown, path: string): PublishedVenueProfile {
  const object = exactObject(value, [
    "publication_state", "published_version", "description", "cover_image", "images", "facilities",
    "pitch_sizes", "live_price", "availability_target",
  ], path);
  if (object.publication_state !== "PUBLISHED") invalid(`${path}.publication_state`);
  const images = arrayAt(object.images, `${path}.images`)
    .map((image, index) => decodeImage(image, `${path}.images[${index}]`));
  const facilities = arrayAt(object.facilities, `${path}.facilities`)
    .map((facility, index) => decodeFacility(facility, `${path}.facilities[${index}]`));
  const livePrice = exactObject(object.live_price, ["available", "from_price_cents", "currency", "unit"], `${path}.live_price`);
  const available = booleanAt(livePrice.available, `${path}.live_price.available`);
  const fromPriceCents = livePrice.from_price_cents === null
    ? null
    : integerAt(livePrice.from_price_cents, `${path}.live_price.from_price_cents`, 0);
  if (livePrice.currency !== "CNY") invalid(`${path}.live_price.currency`);
  if (livePrice.unit !== "HOUR") invalid(`${path}.live_price.unit`);
  if (available !== (fromPriceCents !== null)) invalid(`${path}.live_price.from_price_cents`);
  const target = exactObject(object.availability_target, ["enabled", "label", "path"], `${path}.availability_target`);
  const enabled = booleanAt(target.enabled, `${path}.availability_target.enabled`);
  if (target.label !== "查看可订时段") invalid(`${path}.availability_target.label`);
  const targetPath = nullableString(target.path, `${path}.availability_target.path`);
  if (enabled !== (targetPath !== null)) invalid(`${path}.availability_target.path`);
  if (targetPath !== null && !/^\/api\/v1\/venues\/[0-9a-f-]+\/availability$/.test(targetPath)) {
    invalid(`${path}.availability_target.path`);
  }
  if (images.length > 8) invalid(`${path}.images`);
  if (images.filter((image) => image.role === "COVER").length > 1) invalid(`${path}.images`);
  assertSorted(images, (image) => image.sortOrder, `${path}.images`, "sort_order");
  assertSorted(facilities, (facility) => facility.sortOrder, `${path}.facilities`, "sort_order");
  const pitchSizes = arrayAt(object.pitch_sizes, `${path}.pitch_sizes`).map((pitchSize, index) =>
    enumAt(pitchSize, DIRECTORY_PITCH_TYPES, `${path}.pitch_sizes[${index}]`));
  return {
    publicationState: "PUBLISHED",
    publishedVersion: integerAt(object.published_version, `${path}.published_version`, 1),
    description: (() => {
      const description = stringAt(object.description, `${path}.description`, true);
      if ([...description].length > 300) invalid(`${path}.description`);
      return description;
    })(),
    coverImage: nullableHttps(object.cover_image, `${path}.cover_image`),
    images,
    facilities,
    pitchSizes,
    livePrice: { available, fromPriceCents, currency: "CNY", unit: "HOUR" },
    availabilityTarget: { enabled, label: "查看可订时段", path: targetPath },
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
    "id", "name", "profile", "price_advantage_text", "timezone",
    "business_hours_text", "address", "latitude", "longitude", "parking_text",
    "refund_policy_summary", "pitch_types",
    "availability_window", "generated_at",
  ], path);
  const decoded: Venue = {
    id: uuidAt(object.id, "$.id"),
    name: stringAt(object.name, "$.name"),
    profile: decodePublishedProfile(object.profile, "$.profile"),
    priceAdvantageText: stringAt(object.price_advantage_text, "$.price_advantage_text"),
    timezone: enumAt(object.timezone, ["Asia/Shanghai"] as const, "$.timezone"),
    businessHoursText: stringAt(object.business_hours_text, "$.business_hours_text"),
    address: stringAt(object.address, "$.address"),
    latitude: numberAt(object.latitude, "$.latitude", -90, 90),
    longitude: numberAt(object.longitude, "$.longitude", -180, 180),
    parkingText: stringAt(object.parking_text, "$.parking_text"),
    refundPolicySummary: stringAt(object.refund_policy_summary, "$.refund_policy_summary"),
    pitchTypes: arrayAt(object.pitch_types, "$.pitch_types", 1)
      .map((pitchType, index) => decodePitchType(pitchType, `$.pitch_types[${index}]`)),
    availabilityWindow: decodeWindow(object.availability_window, "$.availability_window"),
    generatedAt: rfc3339At(object.generated_at, "$.generated_at"),
  };
  assertSorted(decoded.pitchTypes, (pitchType) => pitchType.sortOrder, "$.pitch_types", "sort_order");
  return decoded;
}

function decodeDirectoryTransit(value: unknown, path: string) {
  const object = exactObject(value, ["kind", "name", "lines", "distance_meters", "distance_basis"], path);
  return {
    kind: enumAt(object.kind, ["SUBWAY", "BUS"] as const, `${path}.kind`),
    name: stringAt(object.name, `${path}.name`),
    lines: arrayAt(object.lines, `${path}.lines`).map((line, index) => stringAt(line, `${path}.lines[${index}]`)),
    distanceMeters: integerAt(object.distance_meters, `${path}.distance_meters`),
    distanceBasis: enumAt(object.distance_basis, ["STRAIGHT_LINE", "MAP_VERIFIED"] as const, `${path}.distance_basis`),
  };
}

function nullableHttps(value: unknown, path: string): string | null {
  return value === null ? null : httpsUrlAt(value, path);
}

function decodeDirectoryPitchTypes(value: unknown, path: string): DirectoryPitchType[] {
  return arrayAt(value, path).map((pitchType, index) =>
    enumAt<DirectoryPitchType>(pitchType, DIRECTORY_PITCH_TYPES, `${path}[${index}]`));
}

function directoryEntryCore(object: Record<string, unknown>, coordinateSystem: "GCJ02", path: string) {
  return {
    id: uuidAt(object.id, `${path}.id`),
    name: stringAt(object.name, `${path}.name`),
    address: stringAt(object.address, `${path}.address`),
    bookingMode: enumAt(object.booking_mode, ["ONLINE", "DIRECTORY_ONLY"] as const, `${path}.booking_mode`),
    marker: {
      coordinateSystem,
      latitude: numberAt(object.latitude, `${path}.latitude`, -90, 90),
      longitude: numberAt(object.longitude, `${path}.longitude`, -180, 180),
    },
    pitchTypes: decodeDirectoryPitchTypes(object.pitch_types, `${path}.pitch_types`),
    coverImage: nullableHttps(object.cover_image, `${path}.cover_image`),
    nearestTransit: arrayAt(object.nearest_transit, `${path}.nearest_transit`)
      .map((stop, index) => decodeDirectoryTransit(stop, `${path}.nearest_transit[${index}]`)),
    contentVerifiedAt: rfc3339At(object.content_verified_at, `${path}.content_verified_at`),
  };
}

const DISTRICT_CODE = /^[0-9]{6}$/;

function districtCodeAt(value: unknown, path: string): string {
  const decoded = stringAt(value, path);
  if (!DISTRICT_CODE.test(decoded)) invalid(path);
  return decoded;
}

function directoryMapEntry(
  object: Record<string, unknown>,
  coordinateSystem: "GCJ02",
  path: string,
): VenueMapEntry {
  const core = directoryEntryCore(object, coordinateSystem, path);
  return {
    ...core,
    bookingMode: core.bookingMode,
    districtCode: districtCodeAt(object.district_code, `${path}.district_code`),
    districtName: stringAt(object.district_name, `${path}.district_name`),
  };
}

const MAP_ITEM_KEYS = [
  "id", "name", "address", "district_code", "district_name", "latitude", "longitude",
  "booking_mode", "pitch_types", "cover_image", "nearest_transit", "content_verified_at",
] as const;

export function decodeVenueMap(value: unknown): VenueMapEntry[] {
  const object = exactObject(value, ["coordinate_system", "venues"], "$");
  const coordinateSystem = enumAt(object.coordinate_system, ["GCJ02"] as const, "$.coordinate_system");
  return arrayAt(object.venues, "$.venues", 1).map((venue, index) => {
    const path = `$.venues[${index}]`;
    return directoryMapEntry(exactObject(venue, MAP_ITEM_KEYS, path), coordinateSystem, path);
  });
}

const DETAIL_COMMON_KEYS = [
  "id", "slug", "name", "profile", "address", "latitude", "longitude", "coordinate_system",
  "navigation_poi_name", "navigation_latitude", "navigation_longitude", "booking_mode", "pitch_types",
  "nearest_transit", "content_verified_at",
] as const;

export function decodeVenueDetail(value: unknown): VenueDetail {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid("$");
  const mode = enumAt((value as Record<string, unknown>).booking_mode, ["ONLINE", "DIRECTORY_ONLY"] as const, "$.booking_mode");
  const variantKeys = mode === "ONLINE"
    ? ["price_advantage_text", "timezone", "business_hours_text", "parking_text", "refund_policy_summary", "availability_window"]
    : ["business_hours_text", "parking_text"];
  const object = exactObject(value, [...DETAIL_COMMON_KEYS, ...variantKeys], "$");
  const coordinateSystem = enumAt(object.coordinate_system, ["GCJ02"] as const, "$.coordinate_system");
  const profile = decodePublishedProfile(object.profile, "$.profile");
  const { coverImage: _coverImage, ...base } = directoryEntryCore(
    { ...object, cover_image: profile.coverImage }, coordinateSystem, "$",
  );
  void _coverImage;
  const detail = {
    ...base,
    slug: stringAt(object.slug, "$.slug"),
    profile,
    navigation: {
      poiName: stringAt(object.navigation_poi_name, "$.navigation_poi_name"),
      coordinate: {
        coordinateSystem,
        latitude: numberAt(object.navigation_latitude, "$.navigation_latitude", -90, 90),
        longitude: numberAt(object.navigation_longitude, "$.navigation_longitude", -180, 180),
      },
    },
  };
  if (mode === "ONLINE") {
    if (detail.bookingMode !== "ONLINE") invalid("$.booking_mode");
    return {
      ...detail,
      bookingMode: "ONLINE",
      priceAdvantageText: stringAt(object.price_advantage_text, "$.price_advantage_text"),
      timezone: enumAt(object.timezone, ["Asia/Shanghai"] as const, "$.timezone"),
      businessHoursText: stringAt(object.business_hours_text, "$.business_hours_text"),
      parkingText: stringAt(object.parking_text, "$.parking_text"),
      refundPolicySummary: stringAt(object.refund_policy_summary, "$.refund_policy_summary"),
      availabilityWindow: decodeWindow(object.availability_window, "$.availability_window"),
    };
  }
  if (detail.bookingMode !== "DIRECTORY_ONLY") invalid("$.booking_mode");
  return {
    ...detail,
    bookingMode: "DIRECTORY_ONLY",
    businessHoursText: nullableString(object.business_hours_text, "$.business_hours_text"),
    parkingText: nullableString(object.parking_text, "$.parking_text"),
  };
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
    for (let slotIndex = 1; slotIndex < pitch.slots.length; slotIndex += 1) {
      if (rfc3339Before(pitch.slots[slotIndex].startsAt, pitch.slots[slotIndex - 1].startsAt)) {
        invalid(`${pitchPath}.slots[${slotIndex}].starts_at`);
      }
    }
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
