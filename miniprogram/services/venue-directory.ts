import type { VenueMapEntry } from "../domain/venue-directory";

export interface VenueDirectoryDataSource {
  getVenueDirectory(): Promise<VenueMapEntry[]>;
  getVenueDetail(venueId: string): Promise<VenueMapEntry>;
}

let configuredVenueDirectorySource: VenueDirectoryDataSource | undefined;

export function registerVenueDirectoryDataSource(source: VenueDirectoryDataSource): void {
  configuredVenueDirectorySource = source;
}

export function getVenueDirectoryDataSource(): VenueDirectoryDataSource {
  if (!configuredVenueDirectorySource) throw new Error("VENUE_DIRECTORY_DATA_SOURCE_NOT_CONFIGURED");
  return configuredVenueDirectorySource;
}
