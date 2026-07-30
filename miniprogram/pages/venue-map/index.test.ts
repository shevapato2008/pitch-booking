/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any, prefer-spread -- dynamic Mini Program Page harness */

import { beforeEach, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";

import { createDevelopmentVenueDirectoryDataSource, VENUE_DIRECTORY_VISUAL_FIXTURE } from "../../dev/venue-directory-source";
import { createSimulatedLocationCapability } from "../../dev/venue-directory-scenarios";
import { registerLocationCapability } from "../../services/location";
import { registerVenueDirectoryDataSource } from "../../services/venue-directory";

type RuntimePage = Record<string, any> & { data: Record<string, any>; setData(patch: Record<string, unknown>): void };
let definition: Record<string, any> | undefined;

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
  registerVenueDirectoryDataSource(createDevelopmentVenueDirectoryDataSource("ready"));
  registerLocationCapability(createSimulatedLocationCapability("location-success"));
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

test("binds the map camera to the presentation viewport", () => {
  const template = readFileSync("miniprogram/pages/venue-map/index.wxml", "utf8");
  expect(template).toContain('latitude="{{viewport.latitude}}"');
  expect(template).toContain('longitude="{{viewport.longitude}}"');
  expect(template).toContain('scale="{{viewport.scale}}"');
});

test("keeps the selected venue card in view when markers or deep links change selection", () => {
  const template = readFileSync("miniprogram/components/venue-map-sheet/index.wxml", "utf8");
  expect(template).toContain('scroll-into-view="venue-{{selectedVenueId}}"');
  expect(template).toContain('id="venue-{{item.venueId}}"');
});

test("keeps every verified venue actionable in the map failure list", async () => {
  const template = readFileSync("miniprogram/pages/venue-map/index.wxml", "utf8");
  expect(template).toContain("列表仍可使用。重试会重新挂载地图，不影响场馆列表。");
  expect(template).toContain('data-venue-id="{{item.venueId}}"');

  const target = page();
  await call(target, "onLoad", {});
  await call(target, "onVenueAction", { currentTarget: { dataset: { venueId: VENUE_DIRECTORY_VISUAL_FIXTURE[1].id } } });
  expect((globalThis as any).wx.navigateTo).toHaveBeenCalledWith({
    url: `/pages/venue/index?venueId=${VENUE_DIRECTORY_VISUAL_FIXTURE[1].id}`,
  });
});

test("falls back after ten seconds and retry owns one new watchdog", async () => {
  const target = page();
  await call(target, "onLoad", {});
  expect(jest.getTimerCount()).toBe(1);

  jest.advanceTimersByTime(10_000);
  expect(target.data.mapFailed).toBe(true);
  call(target, "onRetryMap");

  expect(target.data.mapKey).toBe(1);
  expect(target.data.mapFailed).toBe(false);
  expect(jest.getTimerCount()).toBe(1);
  call(target, "onMapUpdated");
  expect(jest.getTimerCount()).toBe(0);
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
