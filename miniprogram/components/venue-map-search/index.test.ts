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
    data: { draftQuery: "", localMatches: [], venues, poiResults: [station], poiState: "ready" },
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
