import type { Availability, PitchType, Venue } from "../domain/contracts";
import { decodeAvailability, decodeVenue } from "../domain/decoders";
import type { PageDataSource } from "../services/page-data";
import { packagedFixtureLoader, type FixtureLoader } from "./fixture-transport";

const WINDOW_START = "2026-07-22";
const WINDOW_END = "2026-08-04";

export function createDevelopmentPageDataSource(
  fixtureLoader: FixtureLoader = packagedFixtureLoader,
): PageDataSource {
  return {
    async getVenue(): Promise<Venue> {
      return decodeVenue(fixtureLoader.load("venue-ready"));
    },

    async getAvailability(
      venueId: string,
      pitchType: PitchType,
      date: string,
    ): Promise<Availability> {
      const decodedReady = decodeAvailability(fixtureLoader.load("slots-ready"));
      if (venueId === decodedReady.venueId
        && date === decodedReady.date
        && pitchType === decodedReady.pitchType) {
        return decodedReady;
      }

      const decodedEmpty = decodeAvailability(fixtureLoader.load("slots-empty"));
      if (date === "2026-07-23" && pitchType === "FIVE_A_SIDE") {
        return { ...decodedEmpty, venueId };
      }
      if (date >= WINDOW_START && date <= WINDOW_END) {
        const emptyAvailability: Availability = {
          ...decodedEmpty,
          venueId,
          date,
          pitchType,
          pitchGroups: [],
        };
        return emptyAvailability;
      }
      throw new Error("DATE_OUTSIDE_AVAILABILITY_WINDOW");
    },

    coverSource(): string {
      return "/dev/assets/venue-cover.png";
    },
  };
}

export const developmentPageDataSource = createDevelopmentPageDataSource();
