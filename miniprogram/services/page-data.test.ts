import { expect, jest, test } from "@jest/globals";

import type { Availability, Venue } from "../domain/contracts";
import {
  getPageDataSource,
  registerPageDataSource,
  type PageDataSource,
} from "./page-data";

type FixtureName = "venue-ready" | "slots-ready" | "slots-empty";
interface FixtureLoader { load(name: FixtureName): unknown }
const { createDevelopmentPageDataSource } = jest.requireActual<{
  createDevelopmentPageDataSource(loader: FixtureLoader): PageDataSource;
}>("../dev/page-data");

interface FixtureRecord {
  "venue-ready": unknown;
  "slots-ready": unknown;
  "slots-empty": unknown;
}

const fixtures: FixtureRecord = {
  "venue-ready": jest.requireActual("../../artifacts/ui/fixtures/venue-ready.json"),
  "slots-ready": jest.requireActual("../../artifacts/ui/fixtures/slots-ready.json"),
  "slots-empty": jest.requireActual("../../artifacts/ui/fixtures/slots-empty.json"),
};
const fixtureLoader: FixtureLoader = {
  load(name: FixtureName): unknown {
    return JSON.parse(JSON.stringify(fixtures[name])) as unknown;
  },
};

test("fails clearly before a page data source is configured", () => {
  expect(() => getPageDataSource()).toThrow("PAGE_DATA_SOURCE_NOT_CONFIGURED");
});

test("registers the page data source used by real pages", async () => {
  const venue = { id: "venue-id" } as Venue;
  const availability = { venueId: venue.id } as Availability;
  const source: PageDataSource = {
    getVenue: async () => venue,
    getAvailability: async () => availability,
    coverSource: () => "/cover.png",
  };

  registerPageDataSource(source);

  await expect(getPageDataSource().getVenue()).resolves.toBe(venue);
  await expect(getPageDataSource().getAvailability(venue.id, "FIVE_A_SIDE", "2026-07-22"))
    .resolves.toBe(availability);
  expect(getPageDataSource().coverSource(venue)).toBe("/cover.png");
});

test("development data source decodes the venue and uses its packaged cover", async () => {
  const source = createDevelopmentPageDataSource(fixtureLoader);
  const venue = await source.getVenue();

  expect(venue).toMatchObject({
    id: "7e68d7d8-4b7e-4f04-a5c5-3fe263e69c6f",
    name: "浦东星跃足球公园",
  });
  expect(source.coverSource(venue)).toBe("/dev/assets/venue-cover.png");
});

test("development data source returns ready slots only for the exact ready selection", async () => {
  const source = createDevelopmentPageDataSource(fixtureLoader);
  const availability = await source.getAvailability(
    "11111111-1111-4111-8111-111111111111",
    "FIVE_A_SIDE",
    "2026-07-22",
  );

  expect(availability).toMatchObject({
    venueId: "11111111-1111-4111-8111-111111111111",
    date: "2026-07-22",
    pitchType: "FIVE_A_SIDE",
  });
  expect(availability.pitchGroups[0].slots.length).toBeGreaterThan(0);
});

test("development data source returns the decoded exact empty selection", async () => {
  const source = createDevelopmentPageDataSource(fixtureLoader);
  const availability = await source.getAvailability(
    "22222222-2222-4222-8222-222222222222",
    "FIVE_A_SIDE",
    "2026-07-23",
  );

  expect(availability).toMatchObject({
    venueId: "22222222-2222-4222-8222-222222222222",
    date: "2026-07-23",
    pitchType: "FIVE_A_SIDE",
    pitchGroups: [],
  });
});

test.each([
  ["another in-window date", "FIVE_A_SIDE" as const, "2026-07-24"],
  ["seven-a-side selection", "SEVEN_A_SIDE" as const, "2026-07-22"],
])("development data source returns a typed empty result for %s", async (_case, pitchType, date) => {
  const source = createDevelopmentPageDataSource(fixtureLoader);
  const availability = await source.getAvailability(
    "33333333-3333-4333-8333-333333333333",
    pitchType,
    date,
  );

  expect(availability).toMatchObject({
    venueId: "33333333-3333-4333-8333-333333333333",
    date,
    pitchType,
    pitchGroups: [],
  });
});
