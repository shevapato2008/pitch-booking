/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */

import { existsSync, readFileSync } from "node:fs";
import { beforeEach, expect, jest, test } from "@jest/globals";

interface ScenarioPage {
  data: Record<string, any>;
  onLoad(): void;
  onOpenScenario(event: { currentTarget?: { dataset?: { scenario?: unknown } } }): void;
  onHeaderBack(): void;
}

const sourcePath = "miniprogram/dev/pages/c2f-game-report-scenario/index.ts";
const templatePath = sourcePath.replace(/\.ts$/, ".wxml");
const stylesPath = sourcePath.replace(/\.ts$/, ".wxss");
let captured: ScenarioPage | undefined;

function readRequired(path: string): string {
  expect(existsSync(path)).toBe(true);
  if (!existsSync(path)) throw new Error(`${path} is missing`);
  return readFileSync(path, "utf8");
}

function loadPage(): ScenarioPage & { setData(patch: Record<string, unknown>): void } {
  if (!captured) {
    readRequired(sourcePath);
    (globalThis as any).Page = (definition: ScenarioPage) => { captured = definition; };
    jest.requireActual("./index");
  }
  return {
    ...captured!,
    data: { ...captured!.data },
    setData(patch: Record<string, unknown>) { Object.assign(this.data, patch); },
  };
}

beforeEach(() => {
  jest.restoreAllMocks();
  (globalThis as any).wx = {
    getWindowInfo: jest.fn(() => ({ windowWidth: 390, statusBarHeight: 44 })),
    getMenuButtonBoundingClientRect: jest.fn(() => ({ top: 48, bottom: 80, left: 292, right: 378, width: 86, height: 32 })),
    hideShareMenu: jest.fn(),
    navigateTo: jest.fn(),
    navigateBack: jest.fn(),
    reLaunch: jest.fn(),
  };
  (globalThis as any).getCurrentPages = jest.fn(() => [{}]);
});

test("scenario truthfully labels and opens every supported local preview state", () => {
  const page = loadPage();
  page.onLoad();

  expect(wx.hideShareMenu).toHaveBeenCalledTimes(1);
  expect(page.data).toMatchObject({
    previewNotice: "C2f 开发预览 · 模拟数据，不会提交或修改生产数据",
    headerTopPx: 44,
    headerRowHeightPx: 44,
  });
  expect(page.data.screens.map((item: any) => item.scenario)).toEqual([
    "form",
    "pending",
    "resolved-dismissed",
    "resolved-recorded",
    "resolved-cancelled",
    "expired",
    "unknown",
  ]);

  page.onOpenScenario({ currentTarget: { dataset: { scenario: "form" } } });
  page.onOpenScenario({ currentTarget: { dataset: { scenario: "resolved-cancelled" } } });
  page.onOpenScenario({ currentTarget: { dataset: { scenario: "other" } } });
  expect(wx.navigateTo).toHaveBeenNthCalledWith(1, {
    url: "/dev/pages/c2f-game-report/index?scenario=form",
  });
  expect(wx.navigateTo).toHaveBeenNthCalledWith(2, {
    url: "/dev/pages/c2f-game-report/index?scenario=resolved-cancelled",
  });
  expect(wx.navigateTo).toHaveBeenCalledTimes(2);
});

test("scenario back uses history and otherwise returns to the real intent entry", () => {
  const page = loadPage();
  page.onHeaderBack();
  expect(wx.reLaunch).toHaveBeenCalledWith({ url: "/pages/intent-entry/index" });

  (getCurrentPages as unknown as jest.Mock).mockReturnValue([{}, {}]);
  page.onHeaderBack();
  expect(wx.navigateBack).toHaveBeenCalledWith({ delta: 1 });
});

test("scenario has custom navigation, scroll safe area and aligned cards", () => {
  expect(JSON.parse(readRequired(sourcePath.replace(/\.ts$/, ".json")))).toEqual({ navigationStyle: "custom" });
  const template = readRequired(templatePath);
  const styles = readRequired(stylesPath);
  expect(template).toContain("{{previewNotice}}");
  expect(template).toContain('wx:for="{{screens}}"');
  expect(template).toContain('bindtap="onOpenScenario"');
  expect(styles).toMatch(/\.c2f-scroll\s*\{[^}]*height:\s*0[^}]*min-height:\s*0/s);
  expect(styles).toMatch(/\.c2f-content\s*\{[^}]*env\(safe-area-inset-bottom,\s*0px\)/s);
  for (const selector of ["c2f-header-back", "c2f-scenario-card"]) {
    const rule = styles.match(new RegExp(`\\.${selector}\\s*\\{[^}]*\\}`, "s"))?.[0] ?? "";
    expect(rule).toMatch(/min-height:\s*(?:88|9\d|\d{3,})rpx/);
    expect(rule).toMatch(/display:\s*flex/);
    expect(rule).toMatch(/align-items:\s*center/);
    expect(rule).toMatch(/justify-content:\s*center/);
  }
});
