import { decodeApiError, decodeVenueDetail, decodeVenueMap } from "../domain/decoders";
import type { Transport, TransportError } from "../runtime/interfaces";
import type { VenueDirectoryDataSource } from "./venue-directory";

export class VenueDirectoryApiError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "VenueDirectoryApiError";
  }
}

export function createHttpVenueDirectoryDataSource(transport: Transport): VenueDirectoryDataSource {
  const read = async <T>(perform: () => Promise<unknown>, decode: (value: unknown) => T): Promise<T> => {
    try {
      return decode(await perform());
    } catch (caught) {
      const error = caught as Partial<TransportError>;
      if (error.code === "HTTP_ERROR" && "data" in error) {
        throw new VenueDirectoryApiError(decodeApiError(error.data).code);
      }
      throw caught;
    }
  };
  return {
    getVenueDirectory: () => read(() => transport.get("/api/v1/venues/map"), decodeVenueMap),
    getVenueDetail: (venueId) => read(
      () => transport.get(`/api/v1/venues/${encodeURIComponent(venueId)}`),
      decodeVenueDetail,
    ),
  };
}
