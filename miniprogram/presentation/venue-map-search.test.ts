import { describe, expect, test } from "@jest/globals";

import type { VenueMapEntry } from "../domain/venue-directory";
import {
  calculateSearchCenterViewport,
  presentVenueSearch,
  type SearchCenterPoi,
} from "./venue-map-search";

const venue = (
  id: string,
  name: string,
  bookingMode: VenueMapEntry["bookingMode"],
  latitude: number,
  longitude: number,
  address = "天津市河西区测试路",
): VenueMapEntry => ({
  id,
  name,
  address,
  districtCode: bookingMode === "ONLINE" ? "120111" : "120104",
  districtName: bookingMode === "ONLINE" ? "西青区" : "南开区",
  bookingMode,
  marker: { coordinateSystem: "GCJ02", latitude, longitude },
  pitchTypes: [],
  coverImage: null,
  nearestTransit: [],
  contentVerifiedAt: "2026-08-06T00:00:00+08:00",
});

const zulu = venue("zulu", "乙球场", "DIRECTORY_ONLY", 39.10, 117.20);
const alpha = venue("alpha", "甲球场", "ONLINE", 39.00, 117.20);
const station: SearchCenterPoi = {
  id: "tianjin-station",
  name: "天津站",
  address: "天津市河北区新纬路1号",
  city: "天津市",
  district: "河北区",
  adcode: "120105",
  latitude: 39.1365,
  longitude: 117.2109,
  coordinateSystem: "GCJ02",
};

describe("venue search presentation", () => {
  test("CITY preserves API order and emits no distance", () => {
    const view = presentVenueSearch({
      venues: [zulu, alpha],
      center: { kind: "CITY" },
      filters: { onlineOnly: false, districtCode: null },
      selectedVenueId: zulu.id,
      districtByVenueId: {},
    });

    expect(view.visibleVenues.map(({ id }) => id)).toEqual(["zulu", "alpha"]);
    expect(view.distanceMetersByVenueId).toEqual({});
    expect(view.distanceLabelBasis).toBeNull();
    expect(view.searchCenterMarker).toBeNull();
    expect(view).toMatchObject({
      selectedVenueId: "zulu",
      title: "全部球场",
      subtitle: "2 个已收录球场",
      sortLabel: "综合排序",
      hasNearbyVenue: true,
    });
  });

  test("USER_LOCATION sorts by distance with ID as the final tie-breaker", () => {
    const samePlaceA = venue("a", "远字母球场", "ONLINE", 39.01, 117.20);
    const samePlaceB = venue("b", "近字母球场", "ONLINE", 39.01, 117.20);
    const view = presentVenueSearch({
      venues: [samePlaceB, alpha, samePlaceA],
      center: { kind: "USER_LOCATION", coordinate: alpha.marker },
      filters: { onlineOnly: false, districtCode: null },
      selectedVenueId: samePlaceB.id,
      districtByVenueId: {},
    });

    expect(view.visibleVenues.map(({ id }) => id)).toEqual(["alpha", "a", "b"]);
    expect(view.distanceMetersByVenueId.alpha).toBe(0);
    expect(view.distanceLabelBasis).toEqual({ kind: "USER" });
    expect(view).toMatchObject({
      selectedVenueId: "b",
      title: "附近球场",
      subtitle: "全部平台场馆",
      sortLabel: "距离最近",
      hasNearbyVenue: true,
    });
  });

  test("POI sorts by distance and keeps the flat POI label as distance basis", () => {
    const view = presentVenueSearch({
      venues: [alpha, zulu],
      center: { kind: "POI", poi: station },
      filters: { onlineOnly: false, districtCode: null },
      selectedVenueId: null,
      districtByVenueId: {},
    });

    expect(view.visibleVenues.map(({ id }) => id)).toEqual(["zulu", "alpha"]);
    expect(view.distanceLabelBasis).toEqual({ kind: "POI", label: "天津站" });
    expect(view.searchCenterMarker).toEqual({
      latitude: station.latitude,
      longitude: station.longitude,
      iconPath: "/assets/map-search-center.png",
      joinCluster: false,
    });
    expect(view).toMatchObject({ title: "天津站附近", subtitle: "仅平台已收录球场" });
  });

  test.each([
    [{ kind: "USER_LOCATION", coordinate: { coordinateSystem: "GCJ02", latitude: 0, longitude: 0 } }, "离你最近的已收录球场"],
    [{ kind: "POI", poi: { ...station, latitude: 0, longitude: 0 } }, "离天津站最近的已收录球场"],
  ] as const)("uses honest zero-nearby copy for %s", (center, title) => {
    const view = presentVenueSearch({
      venues: [alpha],
      center,
      filters: { onlineOnly: false, districtCode: null },
      selectedVenueId: null,
      districtByVenueId: {},
      nearbyThresholdMeters: 20_000,
    });

    expect(view.hasNearbyVenue).toBe(false);
    expect(view.title).toBe(title);
    expect(view.subtitle).toBe("附近暂无平台场馆");
    expect(view.visibleVenues).toEqual([alpha]);
  });

  test("filters only from booking mode and supplied district sidecar", () => {
    const misleadingAddress = venue("address-only", "地址球场", "ONLINE", 39, 117, "天津市和平区测试路");
    const view = presentVenueSearch({
      venues: [misleadingAddress, alpha, zulu],
      center: { kind: "CITY" },
      filters: { onlineOnly: true, districtCode: "120103" },
      selectedVenueId: zulu.id,
      districtByVenueId: {
        alpha: { code: "120103", name: "河西区" },
        zulu: { code: "120103", name: "河西区" },
      },
    });

    expect(view.visibleVenues.map(({ id }) => id)).toEqual(["alpha"]);
    expect(view.selectedVenueId).toBeNull();
  });
});

describe("search-center viewport", () => {
  test("CITY delegates viewport selection to the venue projection", () => {
    expect(calculateSearchCenterViewport({ kind: "CITY" }, "half")).toBeNull();
  });

  test.each([
    ["collapsed", 0.002],
    ["half", 0.006],
    ["expanded", 0.012],
  ] as const)("uses the %s sheet offset without moving the POI marker", (snap, offset) => {
    const center = { kind: "POI", poi: station } as const;
    const viewport = calculateSearchCenterViewport(center, snap);
    expect(viewport).toMatchObject({
      mode: "FOCUSED",
      longitude: station.longitude,
      scale: 14,
    });
    expect(viewport?.mode === "FOCUSED" ? station.latitude - viewport.latitude : null).toBeCloseTo(offset, 10);
    expect(presentVenueSearch({
      venues: [],
      center,
      filters: { onlineOnly: false, districtCode: null },
      selectedVenueId: null,
      districtByVenueId: {},
    }).searchCenterMarker).toMatchObject({ latitude: station.latitude, longitude: station.longitude, joinCluster: false });
  });
});
