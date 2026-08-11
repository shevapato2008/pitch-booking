import { expect, jest, test } from "@jest/globals";

import type { MediaSourceResolver, Transport } from "../runtime/interfaces";
import { createHttpPageDataSource } from "./http-page-data";

interface VenuePayload {
  name: string;
  images: Array<{ url: string }>;
}
interface AvailabilityPayload { pitches: unknown[] }

const venuePayload = jest.requireActual<VenuePayload>(
  "../../contracts/examples/venue-primary.json",
);
const availabilityPayload = jest.requireActual<AvailabilityPayload>(
  "../../contracts/examples/availability-ready.json",
);

test("loads and decodes the primary venue and its availability over HTTP", async () => {
  const paths: string[] = [];
  const transport: Transport = {
    async get<T>(path: string): Promise<T> {
      paths.push(path);
      return (path === "/api/v1/venues/primary" ? venuePayload : availabilityPayload) as T;
    },
    async post<T>(): Promise<T> { throw new Error("unused"); },
    async put<T>(): Promise<T> { throw new Error("unused"); },
  };
  const media: MediaSourceResolver = {
    resolve: (role, source) => `${role}:${source}`,
  };
  const source = createHttpPageDataSource(transport, media);

  const venue = await source.getVenue();
  const availability = await source.getAvailability(
    venue.id,
    "FIVE_A_SIDE",
    "2026-07-22",
  );

  expect(paths).toStrictEqual([
    "/api/v1/venues/primary",
    `/api/v1/venues/${venue.id}/availability?date=2026-07-22&pitch_type=FIVE_A_SIDE`,
  ]);
  expect(venue.name).toBe(venuePayload.name);
  expect(availability.pitchGroups).toHaveLength(availabilityPayload.pitches.length);
  expect(source.coverSource(venue)).toBe(`COVER:${venuePayload.images[0].url}`);
});

test("rejects malformed API data at the HTTP boundary", async () => {
  const transport: Transport = {
    async get<T>(): Promise<T> {
      return { id: "not-a-venue" } as T;
    },
    async post<T>(): Promise<T> { throw new Error("unused"); },
    async put<T>(): Promise<T> { throw new Error("unused"); },
  };

  await expect(createHttpPageDataSource(transport).getVenue())
    .rejects.toThrow("INVALID_API_RESPONSE");
});
