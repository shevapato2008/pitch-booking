import type { AvailabilityWindow, Facility, VenueImage } from "./contracts";

export type VenueBookingMode = "ONLINE" | "DIRECTORY_ONLY";
export type VenuePitchType = "FIVE_A_SIDE" | "SEVEN_A_SIDE" | "ELEVEN_A_SIDE";

export interface Gcj02Coordinate {
  readonly coordinateSystem: "GCJ02";
  readonly latitude: number;
  readonly longitude: number;
}

export interface VenueNavigation {
  readonly poiName: string;
  readonly coordinate: Gcj02Coordinate;
}

export interface VenueTransitStop {
  readonly id?: string;
  readonly kind: "SUBWAY" | "BUS";
  readonly name: string;
  readonly coordinate?: Gcj02Coordinate;
  readonly lines: readonly string[];
  readonly distanceMeters: number;
  readonly distanceBasis: "STRAIGHT_LINE" | "MAP_VERIFIED";
}

interface VenueMapEntryBase {
  readonly id: string;
  readonly slug?: string;
  readonly sortOrder?: number;
  readonly name: string;
  readonly address: string;
  readonly marker: Gcj02Coordinate;
  readonly navigation?: VenueNavigation;
  readonly pitchTypes: readonly VenuePitchType[];
  readonly coverImage: string | null;
  readonly nearestTransit: readonly VenueTransitStop[];
  readonly contentVerifiedAt: string;
}

export interface OnlineVenueMapEntry extends VenueMapEntryBase {
  readonly bookingMode: "ONLINE";
}

export interface DirectoryVenueMapEntry extends VenueMapEntryBase {
  readonly bookingMode: "DIRECTORY_ONLY";
}

export type VenueMapEntry = OnlineVenueMapEntry | DirectoryVenueMapEntry;

interface VenueDetailFields {
  readonly slug: string;
  readonly description: string;
  readonly navigation: VenueNavigation;
}

export type OnlineVenueDetail = Omit<OnlineVenueMapEntry, "slug" | "navigation"> & VenueDetailFields & {
  readonly priceAdvantageText: string;
  readonly timezone: "Asia/Shanghai";
  readonly businessHoursText: string;
  readonly parkingText: string;
  readonly phone: string;
  readonly refundPolicySummary: string;
  readonly images: readonly VenueImage[];
  readonly facilities: readonly Facility[];
  readonly availabilityWindow: AvailabilityWindow;
};

export type DirectoryVenueDetail = Omit<DirectoryVenueMapEntry, "slug" | "navigation"> & VenueDetailFields & {
  readonly businessHoursText: string | null;
  readonly parkingText: string | null;
  readonly images: readonly string[];
  readonly facilities: readonly string[];
};

export type VenueDetail = OnlineVenueDetail | DirectoryVenueDetail;
