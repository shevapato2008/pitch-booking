import type { VenueMapEntry } from "../domain/venue-directory";
import type { VenueDistrictSidecar } from "../presentation/venue-map-search";
import { decodeVenueMap } from "../domain/decoders";
import { packagedFixtureLoader } from "./fixture-transport";

export const DEV_ONLY_VENUE_MAP_PREVIEW_FIXTURE = "DEV_ONLY_VENUE_MAP_PREVIEW_FIXTURE";

const DISTRICTS = [
  { code: "120111", name: "西青区" },
  { code: "120104", name: "南开区" },
  { code: "120105", name: "河北区" },
  { code: "120101", name: "和平区" },
  { code: "120110", name: "东丽区" },
] as const;
const LONGEST_CHECKED_IN_ADDRESS = "天津市河北区中山北路增1号";

function previewId(index: number): string {
  const tail = index.toString(16).padStart(12, "0");
  return `a11ce000-0000-5000-8000-${tail}`;
}

export function createVenueMapPreviewFixture(count = 100): {
  readonly venues: readonly VenueMapEntry[];
  readonly districtByVenueId: VenueDistrictSidecar;
} {
  const canonical = decodeVenueMap(packagedFixtureLoader.load("venue-map"));
  const venues = Array.from({ length: Math.max(0, count) }, (_, offset): VenueMapEntry => {
    const index = offset + 1;
    const source = canonical[offset % canonical.length];
    const isExtreme = index === 100;
    return {
      ...source,
      id: previewId(index),
      slug: `preview-${source.slug ?? "venue"}-${index}`,
      sortOrder: offset,
      name: isExtreme ? "天津奥林匹克中心五人制足球场" : `${source.name} ${index.toString().padStart(3, "0")}`,
      address: isExtreme ? LONGEST_CHECKED_IN_ADDRESS : source.address,
      marker: {
        coordinateSystem: "GCJ02",
        latitude: source.marker.latitude + ((offset % 10) - 4.5) * 0.00065,
        longitude: source.marker.longitude + ((Math.floor(offset / 10) % 10) - 4.5) * 0.00065,
      },
    };
  });
  const districtByVenueId = Object.fromEntries(venues.map((venue, offset) => [
    venue.id,
    DISTRICTS[offset % DISTRICTS.length],
  ]));
  return { venues, districtByVenueId };
}
