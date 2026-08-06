import type { SearchCenterPoi } from "../presentation/venue-map-search";

// The named capability result is intentionally structural-equivalent to the pure center POI.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface PoiSearchResult extends SearchCenterPoi {}

export interface PoiSearchCapability {
  suggest(query: string): Promise<readonly PoiSearchResult[]>;
}

const unavailableCapability: PoiSearchCapability = {
  async suggest() {
    throw new Error("POI_SEARCH_CAPABILITY_NOT_CONFIGURED");
  },
};
let configuredCapability: PoiSearchCapability = unavailableCapability;

export function registerPoiSearchCapability(capability: PoiSearchCapability): void {
  configuredCapability = capability;
}

export function getPoiSearchCapability(): PoiSearchCapability {
  return configuredCapability;
}
