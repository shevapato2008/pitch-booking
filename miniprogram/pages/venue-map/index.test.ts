/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any, prefer-spread */

import { beforeEach, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";

import { decodeVenueMap } from "../../domain/decoders";
import { calculateSearchCenterViewport, type SearchCenterPoi } from "../../presentation/venue-map-search";
import { registerLocationCapability } from "../../services/location";
import { registerPoiSearchCapability } from "../../services/poi-search";
import { registerVenueDirectoryDataSource } from "../../services/venue-directory";
import { registerVenueMapPreviewMetadata } from "../../services/venue-map-preview";

type RuntimePage = Record<string, any> & { data: Record<string, any>; setData(patch: Record<string, unknown>): void };
let definition: Record<string, any> | undefined;
const venues = decodeVenueMap(jest.requireActual("../../../contracts/examples/venue-map.json"));
const station: SearchCenterPoi = {
  id: "preview-tianjin-station", name: "天津站", address: "天津市河北区新纬路1号",
  city: "天津市", district: "河北区", adcode: "120105", latitude: 39.1365,
  longitude: 117.2109, coordinateSystem: "GCJ02",
};
const source = {
  async getVenueDirectory() { return [...venues]; },
  async getVenueDetail() { throw new Error("unused"); },
};

function page(): RuntimePage {
  if (!definition) {
    (globalThis as any).Page = (value: Record<string, any>) => { definition = value; };
    jest.requireActual("./index");
  }
  return {
    ...definition,
    data: { ...definition!.data, filters: { ...definition!.data.filters }, searchCenter: { kind: "CITY" } },
    markerVenueIdByRuntimeId: {},
    setData(patch) { Object.assign(this.data, patch); },
  } as RuntimePage;
}

const call = (target: RuntimePage, method: string, ...args: unknown[]) => target[method].apply(target, args);

beforeEach(() => {
  registerVenueDirectoryDataSource(source);
  registerVenueMapPreviewMetadata({ districtByVenueId: {
    [venues[0].id]: { code: "120111", name: "西青区" },
    [venues[1].id]: { code: "120104", name: "南开区" },
  } });
  registerLocationCapability({
    async getLocation() { return { coordinateSystem: "GCJ02", latitude: 39.0842, longitude: 117.2009 }; },
    async openSetting() {},
  });
  registerPoiSearchCapability({ async suggest(query) { return query.includes("天津站") ? [station] : []; } });
  (globalThis as any).wx = { navigateTo: jest.fn(), showToast: jest.fn() };
});

test("ordinary load commits CITY, preserves platform order, and emits no distance", async () => {
  const target = page();
  await call(target, "onLoad", {});
  expect(target.data.searchCenter).toEqual({ kind: "CITY" });
  expect(target.data.cards.map(({ venueId }: any) => venueId)).toEqual(venues.map(({ id }) => id));
  expect(target.data.title).toBe("全部球场");
  expect(target.data.cards.every(({ distanceText }: any) => distanceText === null)).toBe(true);
  expect(target.data.viewport.mode).toBe("ALL");
});

test("successful locate commits USER_LOCATION and clears POI editing state", async () => {
  const target = page();
  await call(target, "onLoad", {});
  target.data.draftQuery = "天津站";
  target.data.poiResults = [station];
  await call(target, "onLocateTap");
  expect(target.data.searchCenter.kind).toBe("USER_LOCATION");
  expect(target.data.draftQuery).toBe("");
  expect(target.data.poiResults).toEqual([]);
  expect(target.data.locationActive).toBe(true);
  expect(target.data.showLocation).toBe(true);
  expect(target.data.viewport).toEqual(calculateSearchCenterViewport(target.data.searchCenter, "half"));
  expect(target.data.cards[0].distanceText).toMatch(/^距你/);
  expect(target.data.markers.every(({ iconPath }: any) => iconPath !== "/assets/map-search-center.png")).toBe(true);
});

test("selecting 天津站 commits POI while retaining user location only as a reference", async () => {
  const target = page();
  await call(target, "onLoad", {});
  await call(target, "onLocateTap");
  const retainedUserLocation = target.data.userLocation;
  call(target, "onSearchPoiSelect", { detail: { poi: station } });
  expect(target.data.searchCenter).toEqual({ kind: "POI", poi: station });
  expect(target.data.userLocation).toEqual(retainedUserLocation);
  expect(target.data.locationActive).toBe(false);
  expect(target.data.draftQuery).toBe("");
  expect(target.data.viewport).toEqual(calculateSearchCenterViewport({ kind: "POI", poi: station }, "half"));
  expect(target.data.cards[0].distanceText).toMatch(/^距天津站/);
});

test("platform suggestion changes selection and focus without changing committed center", async () => {
  const target = page();
  await call(target, "onLoad", {});
  call(target, "onSearchPoiSelect", { detail: { poi: station } });
  const center = target.data.searchCenter;
  call(target, "onSearchVenueSelect", { detail: { venueId: venues[1].id } });
  expect(target.data.searchCenter).toEqual(center);
  expect(target.data.selectedVenueId).toBe(venues[1].id);
});

test("online and district filters use the sidecar and never auto-select the first result", async () => {
  const target = page();
  await call(target, "onLoad", { venueId: venues[1].id });
  call(target, "onOnlineOnlyChange", { detail: { value: true } });
  expect(target.data.visibleVenues.every(({ bookingMode }: any) => bookingMode === "ONLINE")).toBe(true);
  expect(target.data.selectedVenueId).toBeNull();
  call(target, "onOnlineOnlyChange", { detail: { value: false } });
  call(target, "onDistrictFilter", { detail: { code: "120104" } });
  expect(target.data.visibleVenues.map(({ id }: any) => id)).toEqual([venues[1].id]);
  expect(target.data.selectedVenueId).toBeNull();
});

test("location failure restores the complete pre-request presentation snapshot", async () => {
  registerLocationCapability({
    async getLocation() { throw Object.assign(new Error("failed"), { code: "LOCATION_TIMEOUT" }); },
    async openSetting() {},
  });
  const target = page();
  await call(target, "onLoad", { venueId: venues[1].id });
  call(target, "onDistrictFilter", { detail: { code: "120104" } });
  const before = JSON.parse(JSON.stringify({
    searchCenter: target.data.searchCenter, filters: target.data.filters,
    selectedVenueId: target.data.selectedVenueId, viewport: target.data.viewport,
  }));
  await call(target, "onLocateTap");
  expect({ searchCenter: target.data.searchCenter, filters: target.data.filters,
    selectedVenueId: target.data.selectedVenueId, viewport: target.data.viewport }).toEqual(before);
  expect(target.data.locationErrorText).toBe("定位超时，请重试。");
});

test("POI appends one independent non-cluster marker that marker taps cannot resolve", async () => {
  const target = page();
  await call(target, "onLoad", {});
  call(target, "onSearchPoiSelect", { detail: { poi: station } });
  const centerMarkers = target.data.markers.filter(({ iconPath }: any) => iconPath === "/assets/map-search-center.png");
  expect(centerMarkers).toEqual([expect.objectContaining({ id: 2_147_483_647, joinCluster: false })]);
  const before = target.data.selectedVenueId;
  call(target, "onMarkerTap", { markerId: 2_147_483_647 });
  expect(target.data.selectedVenueId).toBe(before);
});

test("search suggestions isolate loading, empty, and capability errors", async () => {
  const target = page();
  await call(target, "onLoad", {});
  await call(target, "onSearchQueryChange", { detail: { query: "天津站" } });
  expect(target.data.poiState).toBe("ready");
  expect(target.data.poiResults).toEqual([station]);
  await call(target, "onSearchQueryChange", { detail: { query: "不存在" } });
  expect(target.data.poiState).toBe("empty");
  registerPoiSearchCapability({ async suggest() { throw new Error("unavailable"); } });
  await call(target, "onSearchQueryChange", { detail: { query: "天津站" } });
  expect(target.data.poiState).toBe("error");
  expect(target.data.cards).toHaveLength(5);
});

test("sheet snap uses exactly collapsed, half, and expanded", async () => {
  const target = page();
  await call(target, "onLoad", {});
  call(target, "onSheetSnap", { detail: { snap: "expanded" } });
  expect(target.data.sheetSnap).toBe("expanded");
  expect(readFileSync("miniprogram/pages/venue-map/index.ts", "utf8")).not.toMatch(/\bdefault\b/);
});

test("uses the search component, accessible crosshair, vertical sheet copy, and no permanent legend", () => {
  const template = readFileSync("miniprogram/pages/venue-map/index.wxml", "utf8");
  expect(template).toContain("<venue-map-search");
  expect(template).toContain('aria-label="定位到我"');
  expect(template).not.toMatch(/>附近<\/button>/);
  expect(template).not.toContain('class="legend"');
  expect(template).toContain('title="{{title}}"');
  expect(template).toContain('subtitle="{{subtitle}}"');
});

test("page delegates all search projection to the pure presentation boundary", () => {
  const sourceText = readFileSync("miniprogram/pages/venue-map/index.ts", "utf8");
  expect(sourceText).toMatch(/applySearchPresentation\(center[^)]*filters[^)]*selectedVenueId/);
  expect(sourceText).toContain("presentVenueSearch({");
  expect(sourceText).toContain("toVenueMapPresentation(");
});

test("drops late directory and location results and clears page-memory location on unload", async () => {
  let resolveDirectory!: (value: any[]) => void;
  registerVenueDirectoryDataSource({ getVenueDirectory: () => new Promise((done) => { resolveDirectory = done; }), async getVenueDetail() { throw new Error("unused"); } });
  const target = page();
  const loading = call(target, "onLoad", {});
  call(target, "onUnload");
  resolveDirectory([...venues]);
  await loading;
  expect(target.data.cards).toEqual([]);

  let resolveLocation!: (value: any) => void;
  registerVenueDirectoryDataSource(source);
  registerLocationCapability({ getLocation: () => new Promise((done) => { resolveLocation = done; }), async openSetting() {} });
  const second = page();
  await call(second, "onLoad", {});
  const locating = call(second, "onLocateTap");
  call(second, "onUnload");
  resolveLocation(venues[0].marker);
  await locating;
  expect(second.data.userLocation).toBeNull();
  expect(second.data.showLocation).toBe(false);
});
