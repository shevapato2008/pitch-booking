import { decodeApiError } from "../domain/decoders";
import { decodePublicGameDirectory } from "../domain/public-game-directory-decoder";
import type { PublicGameDirectoryFilters } from "../domain/public-game-directory";
import type { Transport, TransportError } from "../runtime/interfaces";
import type { PublicGameDirectorySource } from "./public-game-directory";

export type PublicGameDirectoryApiErrorCode = "INVALID_ARGUMENT" | "SERVICE_UNAVAILABLE";

export class PublicGameDirectoryApiError extends Error {
  constructor(readonly code: PublicGameDirectoryApiErrorCode) {
    super(code);
    this.name = "PublicGameDirectoryApiError";
  }
}

function directoryPath(filters: PublicGameDirectoryFilters): string {
  const query: string[] = [];
  if (filters.localDate !== undefined) {
    query.push(`local_date=${encodeURIComponent(filters.localDate)}`);
  }
  if (filters.format !== undefined) query.push(`format=${encodeURIComponent(filters.format)}`);
  if (filters.availableOnly === true) query.push("available_only=true");
  return `/api/v1/public-games${query.length > 0 ? `?${query.join("&")}` : ""}`;
}

export function createHttpPublicGameDirectorySource(transport: Transport): PublicGameDirectorySource {
  return {
    getDirectory: async (filters = {}) => {
      try {
        const response = await transport.get<unknown>(directoryPath(filters));
        return decodePublicGameDirectory(response);
      } catch (caught) {
        const error = caught as Partial<TransportError>;
        if (error.code === "HTTP_ERROR"
          && (error.statusCode === 422 || error.statusCode === 503)
          && "data" in error) {
          const code = decodeApiError(error.data).code;
          if (error.statusCode === 422 && code === "INVALID_ARGUMENT") {
            throw new PublicGameDirectoryApiError(code);
          }
          if (error.statusCode === 503 && code === "SERVICE_UNAVAILABLE") {
            throw new PublicGameDirectoryApiError(code);
          }
        }
        throw caught;
      }
    },
  };
}
