import type { VenueDistrictSidecar } from "../presentation/venue-map-search";

export interface VenueMapPreviewMetadata {
  readonly districtByVenueId: VenueDistrictSidecar;
}

const EMPTY_DISTRICT_SIDECAR: VenueDistrictSidecar = Object.freeze({});
let metadata: VenueMapPreviewMetadata = Object.freeze({ districtByVenueId: EMPTY_DISTRICT_SIDECAR });

export function registerVenueMapPreviewMetadata(next: VenueMapPreviewMetadata): void {
  metadata = Object.freeze({ districtByVenueId: Object.freeze({ ...next.districtByVenueId }) });
}

export function getVenueMapPreviewMetadata(): VenueMapPreviewMetadata {
  return metadata;
}
