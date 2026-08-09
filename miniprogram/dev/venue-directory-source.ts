import { decodeVenue, decodeVenueDetail, decodeVenueMap } from "../domain/decoders";
import type { VenueDirectoryDataSource } from "../services/venue-directory";
import { packagedFixtureLoader, type FixtureLoader } from "./fixture-transport";

export function createDevelopmentVenueDirectoryDataSource(
  loader: FixtureLoader = packagedFixtureLoader,
): VenueDirectoryDataSource {
  return {
    async getVenueDirectory() {
      return decodeVenueMap(loader.load("venue-map"));
    },
    async getVenueDetail(venueId) {
      const online = decodeVenueDetail(loader.load("venue-online-detail"));
      if (online.id === venueId && online.bookingMode === "ONLINE") {
        const bookingVenue = decodeVenue(loader.load("venue-ready"));
        return {
          ...online,
          coverImage: null,
          availabilityWindow: bookingVenue.availabilityWindow,
        };
      }
      const directory = decodeVenueDetail(loader.load("venue-directory-detail"));
      if (directory.id === venueId) return directory;
      const mapEntry = decodeVenueMap(loader.load("venue-map"))
        .find((venue) => venue.id === venueId);
      if (mapEntry?.bookingMode === "DIRECTORY_ONLY") {
        return {
          ...mapEntry,
          slug: mapEntry.slug ?? `venue-${mapEntry.id}`,
          description: "",
          navigation: mapEntry.navigation ?? {
            poiName: mapEntry.name,
            coordinate: mapEntry.marker,
          },
          businessHoursText: null,
          parkingText: null,
          images: [],
          facilities: [],
        };
      }
      throw new Error("VENUE_NOT_FOUND");
    },
  };
}
