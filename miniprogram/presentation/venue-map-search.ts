import type { Gcj02Coordinate, VenueMapEntry } from "../domain/venue-directory";
import {
  calculateDistanceMeters,
  type DistanceLabelBasis,
  type VenueMapViewport,
} from "./venue-map";

export type SearchCenter =
  | { readonly kind: "CITY" }
  | { readonly kind: "USER_LOCATION"; readonly coordinate: Gcj02Coordinate }
  | { readonly kind: "POI"; readonly poi: SearchCenterPoi };

export interface SearchCenterPoi {
  readonly id: string;
  readonly name: string;
  readonly address: string;
  readonly city: string;
  readonly district: string;
  readonly adcode: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly coordinateSystem: "GCJ02";
}

export interface VenueMapFilters {
  readonly onlineOnly: boolean;
  readonly districtCode: string | null;
}

export interface VenueSearchInput {
  readonly venues: readonly VenueMapEntry[];
  readonly center: SearchCenter;
  readonly filters: VenueMapFilters;
  readonly selectedVenueId: string | null;
  readonly nearbyThresholdMeters?: number;
}

export interface VenueSearchPresentation {
  readonly visibleVenues: readonly VenueMapEntry[];
  readonly distanceMetersByVenueId: Readonly<Record<string, number>>;
  readonly distanceLabelBasis: DistanceLabelBasis;
  readonly searchCenterMarker: null | {
    readonly latitude: number;
    readonly longitude: number;
    readonly iconPath: "/assets/map-search-center.png";
    readonly joinCluster: false;
  };
  readonly selectedVenueId: string | null;
  readonly title: string;
  readonly subtitle: string;
  readonly sortLabel: "综合排序" | "距离最近";
  readonly hasNearbyVenue: boolean;
}

const DEFAULT_NEARBY_THRESHOLD_METERS = 20_000;

function coordinateFor(center: Exclude<SearchCenter, { readonly kind: "CITY" }>): Gcj02Coordinate {
  if (center.kind === "USER_LOCATION") return center.coordinate;
  return {
    coordinateSystem: center.poi.coordinateSystem,
    latitude: center.poi.latitude,
    longitude: center.poi.longitude,
  };
}

export function presentVenueSearch(input: VenueSearchInput): VenueSearchPresentation {
  const filtered = input.venues.filter((venue) => (
    (!input.filters.onlineOnly || venue.bookingMode === "ONLINE")
    && (input.filters.districtCode === null
      || venue.districtCode === input.filters.districtCode)
  ));

  if (input.center.kind === "CITY") {
    return {
      visibleVenues: filtered,
      distanceMetersByVenueId: {},
      distanceLabelBasis: null,
      searchCenterMarker: null,
      selectedVenueId: filtered.some(({ id }) => id === input.selectedVenueId) ? input.selectedVenueId : null,
      title: "全部球场",
      subtitle: `${filtered.length} 个已收录球场`,
      sortLabel: "综合排序",
      hasNearbyVenue: filtered.length > 0,
    };
  }

  const centerCoordinate = coordinateFor(input.center);
  const distanceMetersByVenueId = Object.fromEntries(filtered.map((venue) => [
    venue.id,
    calculateDistanceMeters(centerCoordinate, venue.marker),
  ]));
  const visibleVenues = [...filtered].sort((left, right) => (
    distanceMetersByVenueId[left.id] - distanceMetersByVenueId[right.id]
    || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
  ));
  const hasNearbyVenue = visibleVenues.some(({ id }) => (
    distanceMetersByVenueId[id] <= (input.nearbyThresholdMeters ?? DEFAULT_NEARBY_THRESHOLD_METERS)
  ));
  const distanceLabelBasis: Exclude<DistanceLabelBasis, null> = input.center.kind === "USER_LOCATION"
    ? { kind: "USER" }
    : { kind: "POI", label: input.center.poi.name };
  const isUser = distanceLabelBasis.kind === "USER";
  const label = distanceLabelBasis.kind === "POI" ? distanceLabelBasis.label : null;

  return {
    visibleVenues,
    distanceMetersByVenueId,
    distanceLabelBasis,
    searchCenterMarker: {
      latitude: centerCoordinate.latitude,
      longitude: centerCoordinate.longitude,
      iconPath: "/assets/map-search-center.png",
      joinCluster: false,
    },
    selectedVenueId: visibleVenues.some(({ id }) => id === input.selectedVenueId) ? input.selectedVenueId : null,
    title: hasNearbyVenue
      ? (isUser ? "附近球场" : `${label}附近`)
      : (isUser ? "离你最近的已收录球场" : `离${label}最近的已收录球场`),
    subtitle: hasNearbyVenue
      ? (isUser ? "全部平台场馆" : "仅平台已收录球场")
      : "附近暂无平台场馆",
    sortLabel: "距离最近",
    hasNearbyVenue,
  };
}

const LATITUDE_OFFSET_BY_SNAP = {
  collapsed: 0.002,
  half: 0.006,
  expanded: 0.012,
} as const;

export function calculateSearchCenterViewport(
  center: SearchCenter,
  snap: "collapsed" | "half" | "expanded",
): VenueMapViewport | null {
  if (center.kind === "CITY") return null;
  const coordinate = coordinateFor(center);
  return {
    mode: "FOCUSED",
    latitude: coordinate.latitude - LATITUDE_OFFSET_BY_SNAP[snap],
    longitude: coordinate.longitude,
    scale: 14,
  };
}
