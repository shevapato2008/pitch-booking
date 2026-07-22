import type { Availability, PitchType } from "../domain/contracts";

export interface AvailabilityService {
  get(venueId: string, pitchType: PitchType, date: string): Promise<Availability>;
}
