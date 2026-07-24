import type { Availability, PitchType, Venue } from "../domain/contracts";
import { decodeAvailability, decodeVenue } from "../domain/decoders";
import type { MediaSourceResolver, Transport } from "../runtime/interfaces";
import type { PageDataSource } from "./page-data";

const identityMedia: MediaSourceResolver = {
  resolve: (_role, source) => source,
};

export function createHttpPageDataSource(
  transport: Transport,
  media: MediaSourceResolver = identityMedia,
): PageDataSource {
  return {
    async getVenue(): Promise<Venue> {
      return decodeVenue(await transport.get<unknown>("/api/v1/venues/primary"));
    },

    async getAvailability(
      venueId: string,
      pitchType: PitchType,
      date: string,
    ): Promise<Availability> {
      const path = `/api/v1/venues/${encodeURIComponent(venueId)}/availability`
        + `?date=${encodeURIComponent(date)}&pitch_type=${encodeURIComponent(pitchType)}`;
      return decodeAvailability(await transport.get<unknown>(path));
    },

    coverSource(venue: Venue): string {
      const cover = venue.images.find((image) => image.role === "COVER");
      return cover ? media.resolve("COVER", cover.url) : "";
    },
  };
}
