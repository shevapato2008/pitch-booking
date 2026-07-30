import type { Gcj02Coordinate, VenueMapEntry, VenueTransitStop } from "../domain/venue-directory";

export type VenueMapViewport =
  | { readonly mode: "ALL"; readonly includePoints: readonly Gcj02Coordinate[] }
  | { readonly mode: "FOCUSED"; readonly latitude: number; readonly longitude: number; readonly scale: 16 };

export interface VenueMapMarkerViewModel {
  readonly venueId: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly label: "可订" | "场馆";
  readonly iconPath: string;
  readonly selected: boolean;
}

export interface VenueMapCardViewModel {
  readonly venueId: string;
  readonly name: string;
  readonly address: string;
  readonly selected: boolean;
  readonly statusText: "可预订" | "暂未接入在线预订";
  readonly action: "VIEW_AVAILABILITY" | "VIEW_DETAIL";
  readonly transitText: string;
  readonly distanceText: string | null;
}

const markerPath = (venue: VenueMapEntry, selected: boolean): string => {
  const mode = venue.bookingMode === "ONLINE" ? "online" : "directory";
  return `/assets/map-marker-${mode}${selected ? "-selected" : ""}.png`;
};

const stableVenues = (venues: readonly VenueMapEntry[]): VenueMapEntry[] => [...venues].sort((left, right) => (
  (left.sortOrder ?? 0) - (right.sortOrder ?? 0)
  || left.name.localeCompare(right.name, "zh-CN")
  || left.id.localeCompare(right.id)
));

function formatTransit(stop: VenueTransitStop | undefined): string {
  if (!stop) return "交通信息待核验";
  const kind = stop.kind === "SUBWAY" ? "地铁" : "公交";
  const lines = stop.lines.length > 0 ? `${stop.lines.join("/")} · ` : "";
  return `${kind} ${lines}${stop.name} · 约 ${stop.distanceMeters} 米`;
}

export function calculateMapViewport(
  venues: readonly VenueMapEntry[],
  focusedVenueId: string | null,
): VenueMapViewport {
  const focused = focusedVenueId === null ? undefined : venues.find(({ id }) => id === focusedVenueId);
  if (focused) {
    return {
      mode: "FOCUSED",
      latitude: focused.marker.latitude,
      longitude: focused.marker.longitude,
      scale: 16,
    };
  }
  return { mode: "ALL", includePoints: stableVenues(venues).map(({ marker }) => marker) };
}

export function formatDistanceFromUser(
  user: Gcj02Coordinate | null,
  venue: Gcj02Coordinate,
): string | null {
  if (!user) return null;
  const radians = (value: number): number => value * Math.PI / 180;
  const latitudeDelta = radians(venue.latitude - user.latitude);
  const longitudeDelta = radians(venue.longitude - user.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(user.latitude)) * Math.cos(radians(venue.latitude))
    * Math.sin(longitudeDelta / 2) ** 2;
  const meters = 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  if (meters < 50) return "距你不到 50 米";
  if (meters < 1000) return `距你 ${Math.round(meters)} 米`;
  return `距你 ${(meters / 1000).toFixed(1)} 公里`;
}

export function toVenueMapPresentation(
  venues: readonly VenueMapEntry[],
  requestedVenueId: string | null,
  userLocation: Gcj02Coordinate | null,
) {
  const sorted = stableVenues(venues);
  const selectedVenueId = sorted.some(({ id }) => id === requestedVenueId) ? requestedVenueId : null;
  return {
    selectedVenueId,
    viewport: calculateMapViewport(sorted, selectedVenueId),
    markers: sorted.map((venue): VenueMapMarkerViewModel => {
      const selected = venue.id === selectedVenueId;
      return {
        venueId: venue.id,
        latitude: venue.marker.latitude,
        longitude: venue.marker.longitude,
        label: venue.bookingMode === "ONLINE" ? "可订" : "场馆",
        iconPath: markerPath(venue, selected),
        selected,
      };
    }),
    cards: sorted.map((venue): VenueMapCardViewModel => ({
      venueId: venue.id,
      name: venue.name,
      address: venue.address,
      selected: venue.id === selectedVenueId,
      statusText: venue.bookingMode === "ONLINE" ? "可预订" : "暂未接入在线预订",
      action: venue.bookingMode === "ONLINE" ? "VIEW_AVAILABILITY" : "VIEW_DETAIL",
      transitText: formatTransit(venue.nearestTransit[0]),
      distanceText: formatDistanceFromUser(userLocation, venue.marker),
    })),
  };
}

export function createRequestGenerationGuard() {
  let generation = 0;
  let alive = true;
  return {
    begin(): number {
      alive = true;
      generation += 1;
      return generation;
    },
    isCurrent(candidate: number): boolean {
      return alive && candidate === generation;
    },
    invalidate(): void {
      alive = false;
      generation += 1;
    },
  };
}
