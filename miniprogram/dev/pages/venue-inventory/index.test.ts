/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */

import { beforeEach, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import type { VenueInventoryVisualState } from "../../venue-inventory-fixture";

interface Definition {
  data: Record<string, any>;
  onLoad(options?: { state?: unknown }): void;
  onOpenCreate(): void;
  onOpenPitchPicker(): void;
  onOpenCalendar(): void;
  onSelectPitch(event: any): void;
  onSelectDate(event: any): void;
  onConfirmDate(): void;
  onSlotTap(event: any): void;
  onCloseOverlay(): void;
  onRecovery(): void;
  onPreviewSave(): void;
}

let captured: Definition | undefined;
const loadPage = () => {
  if (!captured) {
    (globalThis as any).Page = (definition: Definition) => { captured = definition; };
    jest.requireActual("./index");
  }
  return {
    ...captured!, data: { ...captured!.data },
    setData(patch: Record<string, unknown>) { Object.assign(this.data, patch); },
  } as Definition & { setData(patch: Record<string, unknown>): void };
};

beforeEach(() => {
  (globalThis as any).wx = {
    getWindowInfo: jest.fn(() => ({ windowWidth: 375, statusBarHeight: 44 })),
    getMenuButtonBoundingClientRect: jest.fn(() => ({ top: 48, bottom: 80, left: 278, right: 365, width: 87, height: 32 })),
    showToast: jest.fn(),
  };
});

test.each([
  "initial-loading", "load-error", "day-empty", "day-ready", "pitch-picker-open",
  "pitch-refreshing", "pitch-load-error", "calendar-open", "date-refreshing",
  "date-load-error", "cross-week-ready", "long-list-end", "create-slot-open",
  "edit-slot-open", "save-in-progress", "save-result-unknown", "create-slot-overlap",
  "concurrent-change", "permission-expired",
] as VenueInventoryVisualState[])("loads approved state %s", (state) => {
  const page = loadPage();
  page.onLoad({ state });
  expect(page.data.visualState).toBe(state);
  expect(page.data.headerTopPx).toBe(44);
  expect(page.data.headerRightInsetPx).toBe(105);
  if (state === "day-ready") {
    expect(page.data.selectedPitch).toMatchObject({ id: "pitch-7-001", displayName: "A场", playersPerSide: 7 });
    expect(page.data.week).toHaveLength(7);
    expect(page.data.slotCount).toBe(5);
  }
});

test("opens pitch, calendar, create, and editable-slot overlays", () => {
  const page = loadPage();
  page.onLoad({ state: "day-ready" });
  page.onOpenPitchPicker();
  expect(page.data.visualState).toBe("pitch-picker-open");
  page.onCloseOverlay();
  page.onOpenCalendar();
  expect(page.data.visualState).toBe("calendar-open");
  page.onCloseOverlay();
  page.onOpenCreate();
  expect(page.data.visualState).toBe("create-slot-open");
  page.onCloseOverlay();
  page.onSlotTap({ currentTarget: { dataset: { slotId: "slot-1400" } } });
  expect(page.data.visualState).toBe("edit-slot-open");
});

test("pitch and date selections preserve their complementary context", () => {
  const page = loadPage();
  page.onLoad({ state: "pitch-picker-open" });
  page.onSelectPitch({ currentTarget: { dataset: { pitchId: "pitch-5-001" } } });
  expect(page.data).toMatchObject({ visualState: "pitch-refreshing", selectedDate: "2026-08-11" });
  page.onLoad({ state: "calendar-open" });
  page.onSelectDate({ currentTarget: { dataset: { date: "2026-08-23" } } });
  expect(page.data.pendingDate).toBe("2026-08-23");
  page.onConfirmDate();
  expect(page.data).toMatchObject({ visualState: "date-refreshing", selectedDate: "2026-08-23" });
  expect(page.data.selectedPitch.id).toBe("pitch-7-001");
});

test("recovery follows the current authority state and unknown saves stay locked", () => {
  const page = loadPage();
  page.onLoad({ state: "pitch-load-error" });
  page.onRecovery();
  expect(page.data.visualState).toBe("pitch-refreshing");
  page.onLoad({ state: "save-result-unknown" });
  page.onCloseOverlay();
  page.onPreviewSave();
  expect(page.data.visualState).toBe("save-result-unknown");
});

test("native source uses the approved v2 hierarchy", () => {
  const template = readFileSync("miniprogram/dev/pages/venue-inventory/index.wxml", "utf8");
  const styles = readFileSync("miniprogram/dev/pages/venue-inventory/index.wxss", "utf8");
  for (const copy of ["当前场地", "选择物理场地", "更多日期", "未来 14 天", "确认日期", "新增时段", "权限已失效，请重新进入"]) {
    expect(template).toContain(copy);
  }
  expect(template).not.toMatch(/class="venue-inventory__add/);
  expect(template).toMatch(/scroll-view[^>]*class="inventory-list"[^>]*scroll-y/);
  expect(template).toMatch(/class="inventory-footer"/);
  expect(template).toMatch(/wx:if="{{sheet}}"[\s\S]*role="dialog"/);
  expect(styles).toMatch(/\.inventory-footer\s*\{[^}]*position:\s*fixed;/s);
  expect(styles).toMatch(/env\(safe-area-inset-bottom(?:,\s*0px)?\)/);
  expect(styles).not.toMatch(/gradient|https?:\/\//);
});
