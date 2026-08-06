/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any, prefer-spread -- dynamic Mini Program Page harness */

import { beforeEach, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";

import { decodeVenueDetail, decodeVenueMap } from "../../domain/decoders";
import { registerLocationCapability } from "../../services/location";
import { registerVenueDirectoryDataSource } from "../../services/venue-directory";

type RuntimePage = Record<string, any> & { data: Record<string, any>; setData(patch: Record<string, unknown>): void };
let definition: Record<string, any> | undefined;
const VENUE_DIRECTORY_VISUAL_FIXTURE = decodeVenueMap(
  jest.requireActual("../../../contracts/examples/venue-map.json"),
);
const DIRECTORY_DETAIL = decodeVenueDetail(
  jest.requireActual("../../../contracts/examples/venue-directory-detail.json"),
);
const ONLINE_DETAIL = decodeVenueDetail(
  jest.requireActual("../../../contracts/examples/venue-online-detail.json"),
);
const directorySource = {
  async getVenueDirectory() { return [...VENUE_DIRECTORY_VISUAL_FIXTURE]; },
  async getVenueDetail(venueId: string) {
    if (venueId === DIRECTORY_DETAIL.id) return DIRECTORY_DETAIL;
    if (venueId === ONLINE_DETAIL.id) return ONLINE_DETAIL;
    throw new Error("VENUE_NOT_FOUND");
  },
};

function page(): RuntimePage {
  if (!definition) {
    (globalThis as any).Page = (value: Record<string, any>) => { definition = value; };
    jest.requireActual("./index");
  }
  return { ...definition, data: { ...definition!.data }, setData(patch) { Object.assign(this.data, patch); } } as RuntimePage;
}

const call = (target: RuntimePage, method: string, ...args: unknown[]) => target[method].apply(target, args);

beforeEach(() => {
  jest.useFakeTimers();
  registerVenueDirectoryDataSource(directorySource);
  registerLocationCapability({
    async getLocation() { return { coordinateSystem: "GCJ02", latitude: 39.0842, longitude: 117.2009 }; },
    async openSetting() {},
  });
  (globalThis as any).wx = { navigateTo: jest.fn(), showToast: jest.fn() };
});

test("loads five venues without requesting location and focuses a valid deep link", async () => {
  const getLocation = jest.fn(async () => ({ coordinateSystem: "GCJ02" as const, latitude: 39.08, longitude: 117.2 }));
  registerLocationCapability({ getLocation, async openSetting() {} });
  const target = page();

  await call(target, "onLoad", { venueId: VENUE_DIRECTORY_VISUAL_FIXTURE[1].id });

  expect(getLocation).not.toHaveBeenCalled();
  expect(target.data.cards).toHaveLength(5);
  expect(target.data.selectedVenueId).toBe(VENUE_DIRECTORY_VISUAL_FIXTURE[1].id);
  expect(target.data.viewport.mode).toBe("FOCUSED");
});

test("shows all five markers on ordinary entry while keeping the recommended card selected", async () => {
  const target = page();

  await call(target, "onLoad", {});

  expect(target.data.selectedVenueId).toBe(VENUE_DIRECTORY_VISUAL_FIXTURE[0].id);
  expect(target.data.viewport.mode).toBe("ALL");
  expect(target.data.markers).toHaveLength(5);
});

test("synchronizes marker and card selection and never gives a directory venue a booking action", async () => {
  const target = page();
  await call(target, "onLoad", {});

  call(target, "onMarkerTap", { markerId: 2 });
  const selected = target.data.cards.find((card: any) => card.selected);

  expect(selected.venueId).toBe(VENUE_DIRECTORY_VISUAL_FIXTURE[1].id);
  expect(selected.action).toBe("VIEW_DETAIL");
  expect(target.data.markers.find((marker: any) => marker.selected).venueId).toBe(selected.venueId);
});

test("opens venue detail for both modes while directory cards expose no availability route", async () => {
  const target = page();
  await call(target, "onLoad", {});
  target.data.selectedVenueId = VENUE_DIRECTORY_VISUAL_FIXTURE[1].id;
  await call(target, "onVenueAction");

  expect((globalThis as any).wx.navigateTo).toHaveBeenCalledWith({
    url: `/pages/venue/index?venueId=${VENUE_DIRECTORY_VISUAL_FIXTURE[1].id}`,
  });
  expect(readFileSync("miniprogram/pages/venue-map/index.wxml", "utf8"))
    .not.toMatch(/VIEW_DETAIL[\s\S]*查看可订时段/);
});

test("requests location only from the explicit action and enables show-location after success", async () => {
  const target = page();
  await call(target, "onLoad", {});

  await call(target, "onLocateTap");

  expect(target.data.showLocation).toBe(true);
  expect(target.data.locationErrorText).toBe("");
  expect(target.data.cards.some((card: any) => card.distanceText)).toBe(true);
});

test("selects the nearest venue after the user explicitly shares location", async () => {
  const nearest = VENUE_DIRECTORY_VISUAL_FIXTURE[1];
  registerLocationCapability({
    async getLocation() { return nearest.marker; },
    async openSetting() {},
  });
  const target = page();
  await call(target, "onLoad", {});

  await call(target, "onLocateTap");

  expect(target.data.selectedVenueId).toBe(nearest.id);
  expect(target.data.viewport).toMatchObject({
    mode: "FOCUSED",
    latitude: nearest.marker.latitude,
    longitude: nearest.marker.longitude,
  });
  expect(target.data.cards.find((card: any) => card.venueId === nearest.id).distanceText)
    .toBe("距你不到 50 米");
});

test("filters the local directory by venue name and restores all venues when cleared", async () => {
  const target = page();
  await call(target, "onLoad", {});

  call(target, "onSearchInput", { detail: { value: "东丽" } });

  expect(target.data.searchQuery).toBe("东丽");
  expect(target.data.cards.map((card: any) => card.name)).toEqual(["东丽体育中心足球场"]);
  expect(target.data.markers).toHaveLength(1);
  expect(target.data.selectedVenueId).toBe(
    VENUE_DIRECTORY_VISUAL_FIXTURE.find(({ name }) => name === "东丽体育中心足球场")?.id,
  );

  call(target, "onSearchClear");
  expect(target.data.searchQuery).toBe("");
  expect(target.data.cards).toHaveLength(5);
});

test("offers system settings only after location permission is denied", async () => {
  const openSetting = jest.fn(async () => {});
  registerLocationCapability({
    async getLocation() { throw Object.assign(new Error("denied"), { code: "LOCATION_PERMISSION_DENIED" }); },
    openSetting,
  });
  const target = page();
  await call(target, "onLoad", {});

  await call(target, "onLocateTap");
  expect(target.data.locationPermissionDenied).toBe(true);
  expect(target.data.locationErrorText).toBe("");

  await call(target, "onOpenLocationSetting");
  expect(openSetting).toHaveBeenCalledTimes(1);
  call(target, "onDismissLocationDenied");
  expect(target.data.locationPermissionDenied).toBe(false);
});

test.each([
  ["LOCATION_PRIVACY_DENIED", "请先同意位置隐私授权后重试。"],
  ["LOCATION_SERVICES_DISABLED", "系统定位服务未开启，请开启后重试。"],
  ["LOCATION_TIMEOUT", "定位超时，请重试。"],
  ["LOCATION_FAILED", "暂时无法获取位置，请重试。"],
])("shows a distinct recovery message for %s", async (code, message) => {
  registerLocationCapability({
    async getLocation() { throw Object.assign(new Error(code), { code }); },
    async openSetting() {},
  });
  const target = page();
  await call(target, "onLoad", {});
  await call(target, "onLocateTap");
  expect(target.data.locationErrorText).toBe(message);
  expect(target.data.locationPermissionDenied).toBe(false);
});

test("binds the map camera to the presentation viewport", () => {
  const template = readFileSync("miniprogram/pages/venue-map/index.wxml", "utf8");
  const maps = template.match(/<map\b[^>]*\/>/g) ?? [];
  expect(maps).toHaveLength(2);
  expect(maps[0]).toContain("viewport.mode === 'ALL'");
  expect(maps[0]).toContain('include-points="{{viewport.includePoints}}"');
  expect(maps[1]).not.toContain("include-points");
  expect(maps[1]).toContain('latitude="{{viewport.latitude}}"');
  expect(maps[1]).toContain('longitude="{{viewport.longitude}}"');
  expect(maps[1]).toContain('scale="{{viewport.scale}}"');
});

test("uses a real search input and explains marker types with the marker assets", () => {
  const template = readFileSync("miniprogram/pages/venue-map/index.wxml", "utf8");

  expect(template).toContain("<input");
  expect(template).toContain('bindinput="onSearchInput"');
  expect(template).toContain('bindtap="onSearchClear"');
  expect(template).toContain('/assets/map-marker-online.png');
  expect(template).toContain('/assets/map-marker-directory.png');
  expect(template).toContain("可在线订场");
  expect(template).toContain("仅提供场馆信息");
});

test("keeps the selected venue card in view when markers or deep links change selection", () => {
  const template = readFileSync("miniprogram/components/venue-map-sheet/index.wxml", "utf8");
  expect(template).toContain('scroll-into-view="venue-{{selectedVenueId}}"');
  expect(template).toContain('id="venue-{{item.venueId}}"');
});

test("does not replace usable venue content with a speculative map failure list", async () => {
  const template = readFileSync("miniprogram/pages/venue-map/index.wxml", "utf8");
  expect(template).not.toContain("地图暂时无法加载");
  expect(template).not.toContain("重试地图");
});

test("does not infer map failure when the native updated event is absent", async () => {
  let resolve!: (venues: any[]) => void;
  registerVenueDirectoryDataSource({
    getVenueDirectory: () => new Promise((done) => { resolve = done; }),
    async getVenueDetail() { throw new Error("unused"); },
  });
  const target = page();
  const loading = call(target, "onLoad", {});

  expect(jest.getTimerCount()).toBe(0);
  resolve([...VENUE_DIRECTORY_VISUAL_FIXTURE]);
  await loading;
  expect(jest.getTimerCount()).toBe(0);
  jest.advanceTimersByTime(60_000);
  expect(target.data).not.toHaveProperty("mapFailed");
});

test("drops a late directory response after unload", async () => {
  let resolve!: (venues: any[]) => void;
  registerVenueDirectoryDataSource({
    getVenueDirectory: () => new Promise((done) => { resolve = done; }),
    async getVenueDetail() { throw new Error("unused"); },
  });
  const target = page();
  const loading = call(target, "onLoad", {});
  call(target, "onUnload");
  resolve([...VENUE_DIRECTORY_VISUAL_FIXTURE]);
  await loading;

  expect(target.data.cards).toEqual([]);
});

test("drops a late location response and clears page-memory coordinates after unload", async () => {
  let resolve!: (coordinate: { coordinateSystem: "GCJ02"; latitude: number; longitude: number }) => void;
  registerLocationCapability({
    getLocation: () => new Promise((done) => { resolve = done; }),
    async openSetting() {},
  });
  const target = page();
  await call(target, "onLoad", {});
  const locating = call(target, "onLocateTap");
  call(target, "onUnload");
  resolve({ coordinateSystem: "GCJ02", latitude: 39.08, longitude: 117.2 });
  await locating;
  expect(target.data.userLocation).toBeNull();
  expect(target.data.showLocation).toBe(false);
});
