/// <reference types="node" />

import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";

import type { VenueInventoryVisualState } from "../../venue-inventory-fixture";

interface PageData {
  visualState: VenueInventoryVisualState;
  headerTopPx: number;
  headerRowHeightPx: number;
  headerRightInsetPx: number;
  isPanelOpen: boolean;
  isCreatePanel: boolean;
  isEditPanel: boolean;
  isSavingUnknown: boolean;
  isOverlap: boolean;
}

interface PageDefinition {
  data: PageData & Record<string, unknown>;
  onLoad(options?: { state?: unknown }): void;
  onOpenCreate(): void;
  onSlotTap(event: { currentTarget?: { dataset?: { slotId?: unknown } } }): void;
  onClosePanel(): void;
  onCancelPanel(): void;
  onPreviewSave(): void;
  onPreviewFieldTap(): void;
}

interface RuntimePage extends PageDefinition {
  setData(patch: Partial<PageData> & Record<string, unknown>): void;
}

let capturedDefinition: PageDefinition | undefined;

function loadPage(): RuntimePage {
  if (!capturedDefinition) {
    (globalThis as unknown as { Page(value: PageDefinition): void }).Page = (value) => {
      capturedDefinition = value;
    };
    jest.requireActual("./index");
  }

  return {
    ...capturedDefinition!,
    data: { ...capturedDefinition!.data },
    setData(patch) { Object.assign(this.data, patch); },
  };
}

function tapSlot(page: RuntimePage, slotId: unknown) {
  page.onSlotTap({ currentTarget: { dataset: { slotId } } });
}

beforeEach(() => {
  (globalThis as unknown as { wx: unknown }).wx = {
    getWindowInfo: jest.fn(() => ({ windowWidth: 375, statusBarHeight: 44 })),
    getMenuButtonBoundingClientRect: jest.fn(() => ({
      top: 48,
      bottom: 80,
      left: 278,
      right: 365,
      width: 87,
      height: 32,
    })),
    showToast: jest.fn(),
  };
});

describe.each([
  ["day-ready", false, false, false, false, false],
  ["create-slot-open", true, true, false, false, false],
  ["edit-slot-open", true, false, true, false, false],
  ["save-result-unknown", true, true, false, true, false],
  ["create-slot-overlap", true, true, false, false, true],
] as const)("state %s", (state, isPanelOpen, isCreatePanel, isEditPanel, isSavingUnknown, isOverlap) => {
  test("maps the exact query state and capsule-safe header", () => {
    const page = loadPage();

    page.onLoad({ state });

    expect(page.data.visualState).toBe(state);
    expect(page.data.headerTopPx).toBe(44);
    expect(page.data.headerRowHeightPx).toBe(44);
    expect(page.data.headerRightInsetPx).toBe(105);
    expect(page.data).toMatchObject({ isPanelOpen, isCreatePanel, isEditPanel, isSavingUnknown, isOverlap });
  });
});

test("invalid or missing query state falls back to the ready workbench", () => {
  const page = loadPage();

  page.onLoad({ state: "saving" });
  expect(page.data).toMatchObject({ visualState: "day-ready", isPanelOpen: false });
  page.onLoad();
  expect(page.data).toMatchObject({ visualState: "day-ready", isPanelOpen: false });
});

test("opens create and editable slot panels but ignores read-only and unknown slots", () => {
  const page = loadPage();

  page.onOpenCreate();
  expect(page.data.visualState).toBe("create-slot-open");
  page.onClosePanel();
  tapSlot(page, "slot-1600");
  expect(page.data.visualState).toBe("edit-slot-open");
  page.onClosePanel();
  tapSlot(page, "slot-1800");
  expect(page.data.visualState).toBe("day-ready");
  tapSlot(page, "slot-missing");
  expect(page.data.visualState).toBe("day-ready");
});

test("close and cancel restore ready while an unknown save cannot be dismissed or submitted twice", () => {
  const page = loadPage();

  page.onOpenCreate();
  page.onCancelPanel();
  expect(page.data.visualState).toBe("day-ready");
  page.onOpenCreate();
  page.onPreviewSave();
  expect(page.data).toMatchObject({ visualState: "save-result-unknown", isSavingUnknown: true });
  page.onPreviewSave();
  page.onClosePanel();
  expect(page.data.visualState).toBe("save-result-unknown");
});

test("non-integrated field controls are explicit preview-only interactions", () => {
  const page = loadPage();
  const wx = (globalThis as unknown as { wx: { showToast: jest.Mock } }).wx;

  page.onPreviewFieldTap();

  expect(wx.showToast).toHaveBeenCalledWith({ title: "仅视觉预览，未写入库存", icon: "none" });
});

test("native markup and styles preserve the approved hierarchy and accessible states", () => {
  const template = readFileSync("miniprogram/dev/pages/venue-inventory/index.wxml", "utf8");
  const styles = readFileSync("miniprogram/dev/pages/venue-inventory/index.wxss", "utf8");
  const config = JSON.parse(readFileSync("miniprogram/dev/pages/venue-inventory/index.json", "utf8"));

  expect(config).toEqual({ navigationStyle: "custom" });
  for (const copy of [
    "渤海元丰足球场",
    "库存工作台 · 仅授权工作人员",
    "更多日期",
    "新增时段",
    "新增并开放",
    "编辑时段",
    "已有时段不修改时间",
    "正在确认保存结果",
    "与已有时段冲突，请调整时间",
    "临时关闭",
    "保存价格",
  ]) expect(template).toContain(copy);
  for (const state of ["create-slot-open", "edit-slot-open", "save-result-unknown", "create-slot-overlap"]) {
    expect(template).toContain(state);
  }
  expect(template).toMatch(/disabled="{{!item\.editable}}"/);
  expect(template).toMatch(/visualState === 'save-result-unknown'[\s\S]*disabled/);
  expect(template).toMatch(/role="dialog"[^>]*aria-modal="true"/);
  expect(template).toMatch(/role="alert"/);
  expect(template).toMatch(/aria-busy="true"/);
  expect(styles).toMatch(/\.venue-inventory__touch\s*\{[^}]*min-height:\s*88rpx;/s);
  expect(styles).toMatch(/env\(safe-area-inset-bottom(?:,\s*0px)?\)/);
  for (const color of ["#F8FAFC", "#FFFFFF", "#10243E", "#0284C7", "#059669"]) {
    expect(styles.toUpperCase()).toContain(color);
  }
  expect(template).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  expect(template).not.toMatch(/https?:\/\//);
  expect(styles.match(/\banimation\s*:/g)).toHaveLength(1);
  expect(styles).toMatch(/@keyframes venue-inventory-spin/);
});
