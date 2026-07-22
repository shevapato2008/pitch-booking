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
  | "LIGHTING"
  | "CHANGING_ROOM"
  | "DRINKING_WATER"
  | "PARKING";
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

export interface Venue {
  id: string;
  name: string;
  description: string;
  priceAdvantageText: string;
  timezone: "Asia/Shanghai";
  businessHoursText: string;
  address: string;
  latitude: number;
  longitude: number;
  parkingText: string;
  phone: string;
  refundPolicySummary: string;
  images: VenueImage[];
  facilities: Facility[];
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
