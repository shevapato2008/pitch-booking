/// <reference types="node" />

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";

import {
  VENUE_DIRECTORY_VISUAL_FIXTURE,
  createDevelopmentVenueDirectoryDataSource,
} from "./venue-directory-source";
import {
  DEVELOPMENT_VENUE_DIRECTORY_SCENARIOS,
  createSimulatedLocationCapability,
} from "./venue-directory-scenarios";

describe("development venue directory source", () => {
  test("matches authoritative manifest identity, mode, coordinates, and transit field for field", () => {
    const manifest = JSON.parse(readFileSync("deploy/venue-directory.json", "utf8"));
    const expected = manifest.venues.map((venue: any) => ({
      id: venue.id,
      slug: venue.slug,
      sortOrder: venue.sort_order,
      name: venue.name,
      address: venue.address,
      bookingMode: venue.booking_mode,
      marker: {
        coordinateSystem: venue.marker.coordinate_system,
        latitude: venue.marker.latitude,
        longitude: venue.marker.longitude,
      },
      navigation: {
        poiName: venue.navigation.poi_name,
        coordinate: {
          coordinateSystem: venue.navigation.coordinate.coordinate_system,
          latitude: venue.navigation.coordinate.latitude,
          longitude: venue.navigation.coordinate.longitude,
        },
      },
      pitchTypes: venue.pitch_types,
      coverImage: venue.cover_image,
      nearestTransit: venue.nearest_transit.map((stop: any) => ({
        id: stop.id,
        kind: stop.kind,
        name: stop.name,
        coordinate: {
          coordinateSystem: stop.coordinate.coordinate_system,
          latitude: stop.coordinate.latitude,
          longitude: stop.coordinate.longitude,
        },
        lines: stop.lines,
        distanceMeters: stop.distance_meters,
        distanceBasis: stop.distance_basis,
      })),
      contentVerifiedAt: venue.content_verified_at,
    }));

    expect(VENUE_DIRECTORY_VISUAL_FIXTURE).toEqual(expected);
  });

  test("returns defensive fixture copies and rejects the deterministic load-error scenario", async () => {
    const ready = createDevelopmentVenueDirectoryDataSource("ready");
    const first = await ready.getVenueDirectory();
    (first[0] as { name: string }).name = "污染名称";

    expect((await ready.getVenueDirectory())[0].name).toBe("渤海元丰足球场");
    await expect(createDevelopmentVenueDirectoryDataSource("load-error").getVenueDirectory())
      .rejects.toThrow("VENUE_DIRECTORY_LOAD_FAILED");
  });

  test("loads arbitrary known details and rejects unknown venue ids", async () => {
    const source = createDevelopmentVenueDirectoryDataSource("ready");
    const venue = VENUE_DIRECTORY_VISUAL_FIXTURE[4];

    await expect(source.getVenueDetail(venue.id)).resolves.toEqual(venue);
    await expect(source.getVenueDetail("missing")).rejects.toThrow("VENUE_NOT_FOUND");
  });
});

test("scenario inventory is closed and simulated location failures are deterministic", async () => {
  expect(DEVELOPMENT_VENUE_DIRECTORY_SCENARIOS).toEqual([
    "ready",
    "load-error",
    "map-render-failure",
    "location-success",
    "privacy-denied",
    "permission-denied",
    "services-disabled",
    "timeout",
  ]);
  await expect(createSimulatedLocationCapability("location-success").getLocation())
    .resolves.toEqual({ coordinateSystem: "GCJ02", latitude: 39.0842, longitude: 117.2009 });
  await expect(createSimulatedLocationCapability("permission-denied").getLocation())
    .rejects.toMatchObject({ code: "LOCATION_PERMISSION_DENIED" });
});
