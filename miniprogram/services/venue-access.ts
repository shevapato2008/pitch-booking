import type { ManagedVenue } from "../domain/venue-access";

export interface VenueAccessDataSource {
  login(): Promise<void>;
  listManagedVenues(): Promise<readonly ManagedVenue[]>;
}

let configured: VenueAccessDataSource | undefined;

export function registerVenueAccessDataSource(source: VenueAccessDataSource): void {
  configured = source;
}

export function getVenueAccessDataSource(): VenueAccessDataSource {
  if (!configured) throw new Error("VENUE_ACCESS_DATA_SOURCE_NOT_CONFIGURED");
  return configured;
}

export function resetVenueAccessBindingsForTesting(): void {
  configured = undefined;
}
