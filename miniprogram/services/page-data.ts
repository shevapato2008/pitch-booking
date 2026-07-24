import type { Availability, PitchType, Venue } from "../domain/contracts";

export interface PageDataSource {
  getVenue(): Promise<Venue>;
  getAvailability(venueId: string, pitchType: PitchType, date: string): Promise<Availability>;
  coverSource(venue: Venue): string;
}

let configuredSource: PageDataSource | undefined;

export function registerPageDataSource(source: PageDataSource): void {
  configuredSource = source;
}

export function getPageDataSource(): PageDataSource {
  if (!configuredSource) throw new Error("PAGE_DATA_SOURCE_NOT_CONFIGURED");
  return configuredSource;
}
