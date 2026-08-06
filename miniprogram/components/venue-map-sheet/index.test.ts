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
    data: { snap: "half", listScrollTop: 144 },
    triggerEvent: jest.fn(),
    setData(patch: Record<string, unknown>) { Object.assign(this.data, patch); },
  } as Record<string, any>;
}

beforeEach(() => { jest.clearAllMocks(); });

test("owns a vertical list without horizontal scrolling", () => {
  const template = readFileSync("miniprogram/components/venue-map-sheet/index.wxml", "utf8");
  expect(template).toContain("scroll-y");
  expect(template).not.toContain("scroll-x");
  expect(template).toContain('scroll-top="{{listScrollTop}}"');
});

test("uses exactly collapsed, half, and expanded snap states", () => {
  const source = readFileSync("miniprogram/components/venue-map-sheet/index.ts", "utf8");
  const template = readFileSync("miniprogram/components/venue-map-sheet/index.wxml", "utf8");
  expect(`${source}\n${template}`).not.toMatch(/\bdefault\b/);
  for (const snap of ["collapsed", "half", "expanded"]) expect(`${source}\n${template}`).toContain(snap);
});

test("snap controls preserve list scroll while list scroll emits no snap", () => {
  const target = component();
  target.methods.onToggle.call(target);
  expect(target.data.listScrollTop).toBe(144);
  expect(target.triggerEvent).toHaveBeenCalledWith("snap", { snap: "expanded" });

  target.triggerEvent.mockClear();
  target.methods.onListScroll.call(target, { detail: { scrollTop: 288 } });
  expect(target.data.listScrollTop).toBe(288);
  expect(target.triggerEvent).not.toHaveBeenCalled();
});

test("only the handle and title controls request a snap change", () => {
  const template = readFileSync("miniprogram/components/venue-map-sheet/index.wxml", "utf8");
  expect(template).toContain('class="handle" bindtap="onToggle"');
  expect(template).toContain('class="sheet-toggle" bindtap="onToggle"');
  expect(template).toContain('bindscroll="onListScroll"');
  expect(template).not.toMatch(/<scroll-view[^>]*bindtap="onToggle"/);
});
