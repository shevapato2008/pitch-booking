export class ApiResponseError extends Error {
  readonly code = "INVALID_API_RESPONSE";

  constructor(readonly path: string) {
    super(`INVALID_API_RESPONSE at ${path}`);
    this.name = "ApiResponseError";
  }
}

export type PitchType = "FIVE_A_SIDE" | "SEVEN_A_SIDE";
export type ImageRole = "COVER" | "GALLERY";
export type FacilityCode =
  | "PARKING"
  | "TOILET"
  | "CHANGING_ROOM"
  | "SHOWER"
  | "LOCKERS"
  | "DRINKING_WATER"
  | "BEVERAGE_SALES"
  | "EQUIPMENT_RENTAL"
  | "REST_AREA"
  | "FIRST_AID"
  | "AED"
  | "INDOOR"
  | "OUTDOOR"
  | "COVERED"
  | "LIGHTING"
  | "ARTIFICIAL_TURF"
  | "NATURAL_GRASS";
export type SlotStatus =
  | "AVAILABLE"
  | "TEMPORARILY_LOCKED"
  | "BOOKED"
  | "CLOSED"
  | "EXPIRED";
export type UnavailableReason =
  | "HELD_FOR_PAYMENT"
  | "ALREADY_BOOKED"
  | "VENUE_CLOSED"
  | "TIME_PASSED";

export interface AvailabilityWindow {
  startDate: string;
  endDate: string;
}

export interface VenueImage {
  url: string;
  alt: string;
  role: ImageRole;
  sortOrder: number;
}

export interface Facility {
  code: FacilityCode;
  name: string;
  sortOrder: number;
}

export interface VenuePitchType {
  code: PitchType;
  name: string;
  sortOrder: number;
}

export interface PublishedVenueProfile {
  publicationState: "PUBLISHED";
  publishedVersion: number;
  description: string;
  coverImage: string | null;
  images: readonly VenueImage[];
  facilities: readonly Facility[];
  pitchSizes: readonly (PitchType | "ELEVEN_A_SIDE")[];
  livePrice: {
    available: boolean;
    fromPriceCents: number | null;
    currency: "CNY";
    unit: "HOUR";
  };
  availabilityTarget: {
    enabled: boolean;
    label: "查看可订时段";
    path: string | null;
  };
}

export interface Venue {
  id: string;
  name: string;
  profile: PublishedVenueProfile;
  priceAdvantageText: string;
  timezone: "Asia/Shanghai";
  businessHoursText: string;
  address: string;
  latitude: number;
  longitude: number;
  parkingText: string;
  refundPolicySummary: string;
  pitchTypes: VenuePitchType[];
  availabilityWindow: AvailabilityWindow;
  generatedAt: string;
}

export interface Slot {
  id: string;
  startsAt: string;
  endsAt: string;
  priceCents: number;
  status: SlotStatus;
  unavailableReason: UnavailableReason | null;
}

export interface PitchGroup {
  id: string;
  name: string;
  pitchType: PitchType;
  sortOrder: number;
  slots: Slot[];
}

export interface Availability {
  venueId: string;
  timezone: "Asia/Shanghai";
  date: string;
  pitchType: PitchType;
  availabilityWindow: AvailabilityWindow;
  pitchGroups: PitchGroup[];
  generatedAt: string;
}

export interface SessionTokenView {
  readonly token: string;
  readonly expiresAt: string;
  readonly user: {
    readonly userId: string;
    readonly maskedPhone: string | null;
  };
}

export interface PhoneVerificationView {
  readonly maskedPhone: string;
  readonly verifiedAt: string;
}

export type ApiErrorCode =
  | "INVALID_ARGUMENT"
  | "PITCH_TYPE_NOT_SUPPORTED"
  | "DATE_OUT_OF_RANGE"
  | "VENUE_NOT_FOUND"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_ERROR"
  | "PRIMARY_VENUE_MISCONFIGURED"
  | "VENUE_DIRECTORY_MISCONFIGURED"
  | "AUTH_REQUIRED"
  | "WECHAT_LOGIN_FAILED"
  | "PHONE_AUTH_REQUIRED"
  | "PHONE_AUTH_UNAVAILABLE"
  | "PHONE_AUTH_FAILED"
  | "INVALID_CONTACT"
  | "SLOT_NOT_AVAILABLE"
  | "PRICE_CHANGED"
  | "IDEMPOTENCY_KEY_REUSED"
  | "ORDER_NOT_FOUND"
  | "ORDER_EXPIRED"
  | "PAYMENT_EXCEPTION"
  | "PAYMENT_CREATE_FAILED";
