/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any -- dynamic Mini Program Page harness */
import { beforeEach, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";

import { decodeVenueDetail, decodeVenueMap } from "../../domain/decoders";
import { registerVenueDirectoryDataSource } from "../../services/venue-directory";

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
function page() {
  if (!definition) {
    (globalThis as any).Page = (value: Record<string, any>) => { definition = value; };
    jest.requireActual("./index");
  }
  return { ...definition, data: { ...definition!.data }, setData(patch: Record<string, unknown>) { Object.assign(this.data, patch); } } as any;
}

beforeEach(() => {
  registerVenueDirectoryDataSource({
    async getVenueDirectory() { return [...VENUE_DIRECTORY_VISUAL_FIXTURE]; },
    async getVenueDetail() { return DIRECTORY_DETAIL; },
  });
  (globalThis as any).wx = { navigateTo: jest.fn() };
});

test("renders a known directory detail without an availability action", async () => {
  const target = page();
  await target.onLoad({ venueId: VENUE_DIRECTORY_VISUAL_FIXTURE[1].id });

  expect(target.data.venue).toMatchObject({ bookingMode: "DIRECTORY_ONLY", bookingStatusText: "暂未接入在线预订" });
  expect(target.data.canBook).toBe(false);
});

test("renders the online detail API as authority without falling back to primary", async () => {
  registerVenueDirectoryDataSource({
    async getVenueDirectory() { return []; },
    async getVenueDetail() { return ONLINE_DETAIL; },
  });
  const target = page();
  await target.onLoad({ venueId: ONLINE_DETAIL.id });

  expect(target.data.venue).toMatchObject({
    bookingMode: "ONLINE",
    description: ONLINE_DETAIL.profile.description,
    priceAdvantageText: "在线价格透明，以可订时段显示为准。",
    parkingText: "停车安排以场馆现场指引为准。",
  });
  expect(target.data.canBook).toBe(true);
});

test("opens the map focused on the current venue", async () => {
  const target = page();
  target.data.venue = { id: VENUE_DIRECTORY_VISUAL_FIXTURE[4].id };
  target.onViewOnMap();

  expect((globalThis as any).wx.navigateTo).toHaveBeenCalledWith({
    url: `/pages/venue-map/index?venueId=${VENUE_DIRECTORY_VISUAL_FIXTURE[4].id}`,
  });
});

test("public venue template exposes published facilities and no contact shortcut", () => {
  const card = readFileSync("miniprogram/components/venue-card/index.wxml", "utf8");
  expect(card).toContain('wx:for="{{venue.facilities}}"');
  expect(card).toContain("venue.livePriceText");
  expect(card).not.toMatch(/联系电话|venue\.phone|拨打|客服/);
});
