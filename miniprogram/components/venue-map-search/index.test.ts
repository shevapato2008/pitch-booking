/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */

import { beforeEach, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";

let definition: Record<string, any> | undefined;
const venues = [
  { id: "a", name: "东丽体育中心足球场", address: "天津市东丽区先锋东路3号" },
  { id: "b", name: "渤海元丰足球场", address: "天津市西青区利达路" },
];
const station = { id: "station", name: "天津站", address: "天津市河北区新纬路1号", city: "天津市", district: "河北区" };

function component() {
  if (!definition) {
    (globalThis as any).Component = (value: Record<string, any>) => { definition = value; };
    jest.requireActual("./index");
  }
  return {
    ...definition,
    data: { draftQuery: "", committedQuery: "", localMatches: [], venues, poiResults: [station], poiState: "ready" },
    triggerEvent: jest.fn(),
    setData(patch: Record<string, unknown>) { Object.assign(this.data, patch); },
  } as Record<string, any>;
}

beforeEach(() => { jest.clearAllMocks(); });

test("input updates only draft suggestions and never commits a search center", () => {
  const target = component();
  target.methods.onInput.call(target, { detail: { value: "东丽" } });
  expect(target.data.draftQuery).toBe("东丽");
  expect(target.data.localMatches.map(({ id }: { id: string }) => id)).toEqual(["a"]);
  expect(target.triggerEvent).toHaveBeenCalledWith("querychange", { query: "东丽" });
  expect(target.triggerEvent).not.toHaveBeenCalledWith("selectpoi", expect.anything());
});

test("renders distinct platform and map-place groups with isolated async states", () => {
  const template = readFileSync("miniprogram/components/venue-map-search/index.wxml", "utf8");
  expect(template).toContain("平台球场");
  expect(template).toContain("地图地点");
  expect(template).toContain("正在搜索地图地点…");
  expect(template).toContain("没有匹配的地图地点");
  expect(template).toContain("地图地点暂时无法搜索");
  expect(template).toContain("{{item.city}} · {{item.district}}");
  expect(template).not.toMatch(/<[^>]+\bwx:else\b[^>]+\bwx:for\b|<[^>]+\bwx:for\b[^>]+\bwx:else\b/);
  expect(template).toMatch(/<block wx:else>\s*<button wx:for=/);
});

test("clear, cancel, venue, and POI selection emit narrow intents", () => {
  const target = component();
  target.data.draftQuery = "天津站";
  target.methods.onClear.call(target);
  expect(target.data.draftQuery).toBe("");
  expect(target.triggerEvent).toHaveBeenCalledWith("clear");
  target.methods.onCancel.call(target);
  expect(target.triggerEvent).toHaveBeenCalledWith("cancel", { restorePreEdit: true });
  target.methods.onVenueSelect.call(target, { currentTarget: { dataset: { venueId: "a" } } });
  expect(target.triggerEvent).toHaveBeenCalledWith("selectvenue", { venueId: "a" });
  target.methods.onPoiSelect.call(target, { currentTarget: { dataset: { index: 0 } } });
  expect(target.triggerEvent).toHaveBeenCalledWith("selectpoi", { poi: station });
});

test("keyboard submit without an explicitly selected suggestion does not commit", () => {
  const target = component();
  target.methods.onConfirm.call(target);
  expect(target.triggerEvent).not.toHaveBeenCalledWith("selectvenue", expect.anything());
  expect(target.triggerEvent).not.toHaveBeenCalledWith("selectpoi", expect.anything());
});

test("shows a committed POI name without reopening suggestions and restores it on reset", () => {
  const target = component();
  target.data.committedQuery = "天津站";
  target.properties.committedQuery.observer.call(target, "天津站");
  expect(target.data.draftQuery).toBe("天津站");
  const template = readFileSync("miniprogram/components/venue-map-search/index.wxml", "utf8");
  expect(template).toContain("draftQuery !== committedQuery");
});

test("draws the magnifier in WXSS without a font glyph", () => {
  const template = readFileSync("miniprogram/components/venue-map-search/index.wxml", "utf8");
  const styles = readFileSync("miniprogram/components/venue-map-search/index.wxss", "utf8");
  expect(template).not.toContain("⌕");
  expect(template).toContain('class="venue-search-icon"');
  expect(styles).toMatch(/\.venue-search-icon\s*\{[^}]*border:/s);
  expect(styles).toMatch(/\.venue-search-icon::after\s*\{/);
});

test("fills its grid cell at the approved control height and radius", () => {
  const styles = readFileSync("miniprogram/components/venue-map-search/index.wxss", "utf8");
  expect(styles).toMatch(/\.venue-search\s*\{[^}]*width:100%;[^}]*min-width:0/s);
  expect(styles).toMatch(/\.venue-search-bar\s*\{[^}]*height:96rpx;[^}]*border-radius:32rpx/s);
});
