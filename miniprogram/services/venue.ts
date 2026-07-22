import type { Venue } from "../domain/contracts";

export interface VenueService {
  getPrimary(): Promise<Venue>;
}
