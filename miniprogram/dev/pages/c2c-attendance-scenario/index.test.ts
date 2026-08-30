/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */

import { existsSync, readFileSync } from "node:fs";
import { beforeEach, expect, jest, test } from "@jest/globals";

import {
  C2C_ATTENDANCE_SCENARIOS,
  c2cAttendanceStore,
} from "../../c2c-attendance-fixture";

interface ScenarioDefinition {
  readonly scenario: string;
  readonly title: string;
  readonly detail: string;
}

interface PageDefinition {
  data: {
    scenarios: readonly ScenarioDefinition[];
    previewNotice: string;
    headerTopPx: number;
    headerRowHeightPx: number;
  };
  onLoad(): void;
  onOpenScenario(event: { currentTarget?: { dataset?: { scenario?: unknown } } }): void;
  onHeaderBack(): void;
}

const inventoryPath = "miniprogram/dev/c2c-attendance-pages.json";
const sourcePath = "miniprogram/dev/pages/c2c-attendance-scenario/index.ts";
const configPath = sourcePath.replace(/\.ts$/, ".json");
const templatePath = sourcePath.replace(/\.ts$/, ".wxml");
const stylesPath = sourcePath.replace(/\.ts$/, ".wxss");

let captured: PageDefinition | undefined;

function readRequiredFile(path: string): string {
  expect(existsSync(path)).toBe(true);
  if (!existsSync(path)) throw new Error(`${path} is missing`);
  return readFileSync(path, "utf8");
}

function loadPage(): PageDefinition & { setData(patch: Record<string, unknown>): void } {
  if (!captured) {
    expect(existsSync(sourcePath)).toBe(true);
    if (!existsSync(sourcePath)) throw new Error(`${sourcePath} is missing`);
    (globalThis as any).Page = (definition: PageDefinition) => { captured = definition; };
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
  c2cAttendanceStore.reset("MIXED");
  (globalThis as any).wx = {
    getWindowInfo: jest.fn(() => ({ windowWidth: 375, statusBarHeight: 44 })),
    getMenuButtonBoundingClientRect: jest.fn(() => ({
      top: 48,
      bottom: 80,
      left: 278,
      right: 365,
      width: 87,
      height: 32,
    })),
    navigateTo: jest.fn(),
    navigateBack: jest.fn(),
    reLaunch: jest.fn(),
  };
  (globalThis as any).getCurrentPages = jest.fn(() => [{}]);
});

test("inventory declares exactly the two C2c development routes and custom navigation", () => {
  expect(JSON.parse(readRequiredFile(inventoryPath))).toEqual({
    token: "C2C_ATTENDANCE_FIXTURE",
    pages: [
      "dev/pages/c2c-attendance-scenario/index",
      "dev/pages/c2c-attendance/index",
    ],
  });
  expect(JSON.parse(readRequiredFile(configPath))).toEqual({ navigationStyle: "custom" });
});

test("launcher exposes six labelled scenarios and reads native header geometry", () => {
  const page = loadPage();
  page.onLoad();

  expect(page.data).toMatchObject({
    previewNotice: "C2c 开发预览 · 模拟数据",
    headerTopPx: 44,
    headerRowHeightPx: 44,
  });
  expect(page.data.scenarios.map(({ scenario }) => scenario)).toEqual(C2C_ATTENDANCE_SCENARIOS);
  expect(page.data.scenarios.map(({ title }) => title)).toEqual([
    "混合名单",
    "全部完成",
    "空名单",
    "加载失败",
    "状态冲突",
    "未知结果",
  ]);
});

test.each(C2C_ATTENDANCE_SCENARIOS)("%s resets the fixture before opening the real attendance route", (scenario) => {
  const reset = jest.spyOn(c2cAttendanceStore, "reset");
  const page = loadPage();

  page.onOpenScenario({ currentTarget: { dataset: { scenario } } });

  expect(reset).toHaveBeenCalledWith(scenario);
  expect(c2cAttendanceStore.current().scenario).toBe(scenario);
  expect(wx.navigateTo).toHaveBeenCalledWith({ url: "/dev/pages/c2c-attendance/index" });
  expect(reset.mock.invocationCallOrder[0]).toBeLessThan(
    (wx.navigateTo as unknown as jest.Mock).mock.invocationCallOrder[0],
  );
});

test("unknown scenarios are inert and back uses history or the real intent entry", () => {
  const reset = jest.spyOn(c2cAttendanceStore, "reset");
  const page = loadPage();

  page.onOpenScenario({ currentTarget: { dataset: { scenario: "UNKNOWN" } } });
  expect(reset).not.toHaveBeenCalled();
  expect(wx.navigateTo).not.toHaveBeenCalled();

  page.onHeaderBack();
  expect(wx.reLaunch).toHaveBeenCalledWith({ url: "/pages/intent-entry/index" });

  (getCurrentPages as unknown as jest.Mock).mockReturnValue([{}, {}]);
  page.onHeaderBack();
  expect(wx.navigateBack).toHaveBeenCalledWith({ delta: 1 });
});

test("all visible buttons have real handlers, press feedback, and explicit touch alignment", () => {
  const template = readRequiredFile(templatePath);
  const styles = readRequiredFile(stylesPath);
  const buttons = template.match(/<button\b[^>]*>/g) ?? [];

  expect(buttons).toHaveLength(2);
  buttons.forEach((button) => {
    expect(button).toMatch(/bindtap="on[A-Za-z]+"/);
    expect(button).toMatch(/hover-class="c2c-pressed"/);
  });
  expect(template).toMatch(/wx:for="\{\{scenarios\}\}"/);
  expect(`${template}\n${styles}`).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);

  const headerButton = styles.match(/\.c2c-header-back\s*\{[^}]*\}/s)?.[0] ?? "";
  const scenarioButton = styles.match(/\.c2c-scenario-card\s*\{[^}]*\}/s)?.[0] ?? "";
  for (const rule of [headerButton, scenarioButton]) {
    expect(rule).toMatch(/min-height:\s*(?:88|\d{3,})rpx/);
    expect(rule).toMatch(/display:\s*flex/);
    expect(rule).toMatch(/align-items:\s*center/);
    expect(rule).toMatch(/justify-content:\s*center/);
  }
  expect(styles).toMatch(/\.c2c-pressed\s*\{[^}]*opacity:\s*\.\d+/s);
});
