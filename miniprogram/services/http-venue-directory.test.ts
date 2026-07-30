import { expect, jest, test } from "@jest/globals";

import type { Transport } from "../runtime/interfaces";
import { createHttpVenueDirectoryDataSource } from "./http-venue-directory";

const venueMap = jest.requireActual<Record<string, unknown>>("../../contracts/examples/venue-map.json");
const directory = jest.requireActual<Record<string, unknown>>("../../contracts/examples/venue-directory-detail.json");
const notFound = jest.requireActual<Record<string, unknown>>("../../contracts/examples/error-venue-not-found.json");

test("uses stable map/detail paths without sending user location", async () => {
  const get = jest.fn(async (path: string) => path === "/api/v1/venues/map" ? venueMap : directory);
  const source = createHttpVenueDirectoryDataSource({ get } as unknown as Transport);
  await expect(source.getVenueDirectory()).resolves.toHaveLength(5);
  await expect(source.getVenueDetail(String(directory.id))).resolves.toMatchObject({ id: directory.id });
  expect(get.mock.calls).toEqual([
    ["/api/v1/venues/map"],
    [`/api/v1/venues/${directory.id}`],
  ]);
});

test("maps a declared detail 404 and preserves strict error decoding", async () => {
  const get = jest.fn(async () => { throw { code: "HTTP_ERROR", statusCode: 404, data: notFound }; });
  const source = createHttpVenueDirectoryDataSource({ get } as unknown as Transport);
  await expect(source.getVenueDetail(String(directory.id))).rejects.toMatchObject({ code: "VENUE_NOT_FOUND" });
});
