/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */

import { beforeEach, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";

let definition: Record<string, any> | undefined;

function component() {
  if (!definition) {
    (globalThis as any).Component = (value: Record<string, any>) => { definition = value; };
    jest.requireActual("./index");
  }
  return {
    ...definition,
    data: {
      snap: "half",
      onlineOnly: false,
      districtOptions: [
        { code: "", name: "全部行政区" },
        { code: "120111", name: "西青区" },
        { code: "120105", name: "河北区" },
      ],
    },
    triggerEvent: jest.fn(),
    setData(patch: Record<string, unknown>) { Object.assign(this.data, patch); },
  } as Record<string, any>;
}

beforeEach(() => { jest.clearAllMocks(); });

test("owns a vertical list without horizontal scrolling", () => {
  const template = readFileSync("miniprogram/components/venue-map-sheet/index.wxml", "utf8");
  expect(template).toContain("scroll-y");
  expect(template).not.toContain("scroll-x");
  expect(template).not.toContain("scroll-top");
  expect(template).not.toContain("bindscroll");
});

test("uses exactly collapsed, half, and expanded snap states", () => {
  const source = readFileSync("miniprogram/components/venue-map-sheet/index.ts", "utf8");
  const template = readFileSync("miniprogram/components/venue-map-sheet/index.wxml", "utf8");
  expect(`${source}\n${template}`).not.toMatch(/\bdefault\b/);
  for (const snap of ["collapsed", "half", "expanded"]) expect(`${source}\n${template}`).toContain(snap);
});

test("snap controls do not control the native list scroll position", () => {
  const target = component();
  target.methods.onToggle.call(target);
  expect(target.triggerEvent).toHaveBeenCalledWith("snap", { snap: "expanded" });
  expect(target.data).not.toHaveProperty("listScrollTop");
  expect(target.methods).not.toHaveProperty("onListScroll");
});

test("only the handle and title controls request a snap change", () => {
  const template = readFileSync("miniprogram/components/venue-map-sheet/index.wxml", "utf8");
  expect(template).toContain('class="handle" bindtap="onToggle"');
  expect(template).toContain('class="sheet-toggle" bindtap="onToggle"');
  expect(template).not.toMatch(/<scroll-view[^>]*bindtap="onToggle"/);
});

test("filter controls emit reset, online toggle, and selected district", () => {
  const target = component();

  target.methods.onResetFilters.call(target);
  target.methods.onOnlineTap.call(target);
  target.methods.onDistrictChange.call(target, { detail: { value: "2" } });

  expect(target.triggerEvent).toHaveBeenNthCalledWith(1, "resetfilters");
  expect(target.triggerEvent).toHaveBeenNthCalledWith(2, "onlinechange", { value: true });
  expect(target.triggerEvent).toHaveBeenNthCalledWith(3, "districtchange", { code: "120105" });
});

test("renders real filter controls with stateful active styles", () => {
  const template = readFileSync("miniprogram/components/venue-map-sheet/index.wxml", "utf8");
  expect(template).toContain('bindtap="onResetFilters"');
  expect(template).toContain('bindtap="onOnlineTap"');
  expect(template).toContain('bindchange="onDistrictChange"');
  expect(template).toContain("onlineOnly ? 'filter--active' : ''");
  expect(template).toContain("districtCode ? 'filter--active' : ''");
});
