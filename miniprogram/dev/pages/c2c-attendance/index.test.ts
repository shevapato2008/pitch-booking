/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */

import { existsSync, readFileSync } from "node:fs";
import { beforeEach, expect, jest, test } from "@jest/globals";

import {
  c2cAttendanceStore,
  type C2cAttendanceScenario,
} from "../../c2c-attendance-fixture";

interface AttendanceEvent {
  currentTarget?: { dataset?: { registrationId?: unknown } };
}

interface AttendancePageDefinition {
  data: Record<string, any>;
  onLoad(): void;
  onShow(): void;
  onMarkPresent(event: AttendanceEvent): void;
  onMarkNoShow(event: AttendanceEvent): void;
  onCloseDecision(): void;
  onConfirmDecision(): void;
  onRetryLoad(): void;
  onResolveConflict(): void;
  onConfirmUnknownResult(): void;
  onHeaderBack(): void;
  onReturnScenario(): void;
}

const sourcePath = "miniprogram/dev/pages/c2c-attendance/index.ts";
const configPath = sourcePath.replace(/\.ts$/, ".json");
const templatePath = sourcePath.replace(/\.ts$/, ".wxml");
const stylesPath = sourcePath.replace(/\.ts$/, ".wxss");
const scenarioRoute = "/dev/pages/c2c-attendance-scenario/index";

let captured: AttendancePageDefinition | undefined;

function readRequiredFile(path: string): string {
  expect(existsSync(path)).toBe(true);
  if (!existsSync(path)) throw new Error(`${path} is missing`);
  return readFileSync(path, "utf8");
}

function loadPage(): AttendancePageDefinition & {
  setData(patch: Record<string, unknown>): void;
} {
  if (!captured) {
    expect(existsSync(sourcePath)).toBe(true);
    if (!existsSync(sourcePath)) throw new Error(`${sourcePath} is missing`);
    (globalThis as any).Page = (definition: AttendancePageDefinition) => { captured = definition; };
    jest.requireActual("./index");
  }
  return {
    ...captured!,
    data: { ...captured!.data },
    setData(patch: Record<string, unknown>) { Object.assign(this.data, patch); },
  };
}

function registrationEvent(registrationId: unknown): AttendanceEvent {
  return { currentTarget: { dataset: { registrationId } } };
}

function resetAndLoad(scenario: C2cAttendanceScenario = "MIXED") {
  c2cAttendanceStore.reset(scenario);
  const page = loadPage();
  page.onLoad();
  return page;
}

function cssRule(styles: string, selector: string): string {
  return styles.match(new RegExp(`${selector}\\s*\\{[^}]*\\}`, "s"))?.[0] ?? "";
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
    hideShareMenu: jest.fn(),
    navigateBack: jest.fn(),
    redirectTo: jest.fn(),
  };
  (globalThis as any).getCurrentPages = jest.fn(() => [
    { route: "dev/pages/c2c-attendance-scenario/index" },
    { route: "dev/pages/c2c-attendance/index" },
  ]);
});

test("onLoad hides sharing, reads native header geometry, and projects the stable roster", () => {
  const page = resetAndLoad();

  expect(wx.hideShareMenu).toHaveBeenCalledTimes(1);
  expect(page.data).toMatchObject({
    fixtureNotice: "C2c 开发预览 · 模拟数据",
    headerTopPx: 44,
    headerRowHeightPx: 44,
    previewState: "READY",
    progressLabel: "已记录 2 / 3",
    isEmpty: false,
    isComplete: false,
    game: {
      gameName: "奥体周日傍晚局",
      venue: "天津奥体足球场",
      pitch: "七人制 A 场",
      state: "COMPLETED",
      dateLabel: "8月30日 周日",
      timeLabel: "18:30–20:30",
    },
  });
  expect(page.data.roster.map((player: any) => player.registrationId)).toEqual([
    "c2c-reg-unmarked",
    "c2c-reg-present",
    "c2c-reg-no-show",
  ]);
  expect(page.data.roster.map((player: any) => player.resultLabel)).toEqual([
    "待记录",
    "已到场",
    "未到场",
  ]);
  expect(page.data.roster.map((player: any) => player.recordedTimeLabel)).toEqual([
    "",
    "8月30日 20:32 记录",
    "8月30日 20:34 记录",
  ]);
});

test("onShow reprojects the current authoritative Fixture snapshot", () => {
  const page = resetAndLoad("MIXED");
  c2cAttendanceStore.reset("COMPLETE");

  page.onShow();

  expect(page.data).toMatchObject({
    progressLabel: "已记录 3 / 3",
    isComplete: true,
    completionMessage: "本场散客到场记录已完成",
  });
  expect(page.data.roster.every((player: any) => !player.isUnmarked)).toBe(true);
});

test.each([
  ["onMarkPresent", "PRESENT", "确认已到场？", "确认到场"],
  ["onMarkNoShow", "NO_SHOW", "确认未到场？", "确认未到场"],
] as const)("%s opens the matching decision for the selected registration", (
  method,
  attendanceResult,
  decisionTitle,
  confirmButtonLabel,
) => {
  const page = resetAndLoad();
  const target = c2cAttendanceStore.current().roster[0];

  page[method](registrationEvent(target.registrationId));

  expect(c2cAttendanceStore.current().decisionPanel).toEqual({
    registrationId: target.registrationId,
    attendanceResult,
  });
  expect(page.data).toMatchObject({
    decisionTitle,
    decisionPlayerName: "天津周末左边锋小王",
    decisionWarning: "确认后本页不能自行修改。",
    confirmButtonLabel,
  });
});

test("close X and 返回名单 both close the sheet without writing", () => {
  const page = resetAndLoad();
  const target = c2cAttendanceStore.current().roster[0];
  const initialRoster = c2cAttendanceStore.current().roster;

  page.onMarkPresent(registrationEvent(target.registrationId));
  page.onCloseDecision();
  expect(c2cAttendanceStore.current()).toMatchObject({
    decisionPanel: null,
    roster: initialRoster,
    recorded: 2,
  });

  page.onMarkNoShow(registrationEvent(target.registrationId));
  page.onCloseDecision();
  expect(c2cAttendanceStore.current()).toMatchObject({
    decisionPanel: null,
    roster: initialRoster,
    recorded: 2,
  });
});

test("confirm performs the real transition once and replaces row actions with result and time", () => {
  const confirm = jest.spyOn(c2cAttendanceStore, "confirmDecision");
  const page = resetAndLoad();
  const target = c2cAttendanceStore.current().roster[0];

  page.onMarkPresent(registrationEvent(target.registrationId));
  page.onConfirmDecision();

  const recorded = c2cAttendanceStore.current();
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(recorded).toMatchObject({ recorded: 3, total: 3, attendanceComplete: true, decisionPanel: null });
  expect(recorded.roster[0]).toMatchObject({
    registrationId: target.registrationId,
    attendanceResult: "PRESENT",
    recordedAt: "2026-08-30T20:30:00+08:00",
  });
  expect(page.data.roster[0]).toMatchObject({
    isUnmarked: false,
    resultLabel: "已到场",
    recordedTimeLabel: "8月30日 20:30 记录",
  });
  expect(page.data).toMatchObject({
    progressLabel: "已记录 3 / 3",
    isComplete: true,
    completionMessage: "本场散客到场记录已完成",
  });

  page.onConfirmDecision();
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(c2cAttendanceStore.current()).toEqual(recorded);
});

test("invalid or already-recorded row actions are inert", () => {
  const page = resetAndLoad();
  const alreadyRecorded = c2cAttendanceStore.current().roster[1];

  page.onMarkPresent(registrationEvent(alreadyRecorded.registrationId));
  page.onMarkNoShow(registrationEvent("missing-registration"));

  expect(c2cAttendanceStore.current().decisionPanel).toBeNull();
  expect(page.data.decisionPanel).toBeNull();
});

test.each(["CONFLICT", "UNKNOWN_RESULT"] as const)(
  "%s hides unmarked row actions until authority recovery",
  (scenario) => {
    const page = resetAndLoad(scenario);
    const unmarked = page.data.roster.find((player: any) => player.isUnmarked);
    const template = readRequiredFile(templatePath);

    expect(unmarked).toMatchObject({ isUnmarked: true, canMark: false });
    expect(template).toContain('wx:if="{{item.canMark}}" class="c2c-row-actions"');
  },
);

test("EMPTY stays truthful and its button returns to the scenario route", () => {
  (getCurrentPages as unknown as jest.Mock).mockReturnValue([{}]);
  const page = resetAndLoad("EMPTY");

  expect(page.data).toMatchObject({
    progressLabel: "已记录 0 / 0",
    isEmpty: true,
    isComplete: false,
    emptyMessage: "本场没有需要记录的散客",
    roster: [],
  });
  page.onReturnScenario();
  expect(wx.redirectTo).toHaveBeenCalledWith({ url: scenarioRoute });
});

test.each([
  ["LOAD_ERROR", "onRetryLoad", "retryLoad", "MIXED", false],
  ["CONFLICT", "onResolveConflict", "resolveConflict", "MIXED", false],
  ["UNKNOWN_RESULT", "onConfirmUnknownResult", "confirmUnknownResult", "COMPLETE", true],
] as const)("%s recovery calls its real Fixture transition and syncs authority", (
  scenario,
  handler,
  storeMethod,
  nextScenario,
  isComplete,
) => {
  const transition = jest.spyOn(c2cAttendanceStore, storeMethod);
  const page = resetAndLoad(scenario);

  page[handler]();

  expect(transition).toHaveBeenCalledTimes(1);
  expect(c2cAttendanceStore.current()).toMatchObject({
    scenario: nextScenario,
    previewState: "READY",
    attendanceComplete: isComplete,
  });
  expect(page.data).toMatchObject({
    scenario: nextScenario,
    previewState: "READY",
    isComplete,
  });
});

test("header back uses history, otherwise redirects to the same scenario route", () => {
  const page = resetAndLoad();

  page.onHeaderBack();
  expect(wx.navigateBack).toHaveBeenCalledWith({ delta: 1 });

  (getCurrentPages as unknown as jest.Mock).mockReturnValue([{}]);
  page.onHeaderBack();
  expect(wx.redirectTo).toHaveBeenCalledWith({ url: scenarioRoute });
});

test("template exposes exact copy, real button handlers, and no forbidden claims", () => {
  const config = JSON.parse(readRequiredFile(configPath));
  const template = readRequiredFile(templatePath);
  const styles = readRequiredFile(stylesPath);
  const page = loadPage() as unknown as Record<string, unknown>;
  const buttons = template.match(/<button\b[^>]*>/gs) ?? [];

  expect(config).toEqual({ navigationStyle: "custom" });
  expect(template).toContain("{{fixtureNotice}}");
  expect(template).toContain("本场已结束");
  expect(template).toMatch(/>\s*到场\s*<\/button>/);
  expect(template).toMatch(/>\s*未到场\s*<\/button>/);
  expect(template).toContain("返回名单");
  expect(template).toContain("本场没有需要记录的散客");
  expect(template).toContain("重新加载");
  expect(template).toContain("确认最新名单");
  expect(template).toContain("确认记录结果");
  expect(template.match(/bindtap="onCloseDecision"/g)).toHaveLength(2);

  expect(buttons.length).toBeGreaterThanOrEqual(10);
  buttons.forEach((button) => {
    expect(button).toMatch(/bindtap="on[A-Za-z]+"/);
    expect(button).toMatch(/hover-class="c2c-pressed"/);
    const handler = button.match(/bindtap="([^"]+)"/)?.[1] ?? "";
    expect(typeof page[handler]).toBe("function");
  });

  expect(`${template}\n${styles}`).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  expect(template).not.toMatch(/微信昵称|实名|信用分|已通知|showToast|假成功/);
  expect(template).not.toMatch(/c2c-footer/);
});

test("template uses Mini Program ARIA semantics and isolates content behind the decision dialog", () => {
  const template = readRequiredFile(templatePath);

  expect(template).not.toMatch(/\srole="/);
  expect(template).toMatch(/class="c2c-header"[^>]*aria-hidden="\{\{decisionPanel \? true : false\}\}"/);
  expect(template).toMatch(/class="c2c-scroll"[^>]*aria-hidden="\{\{decisionPanel \? true : false\}\}"/);
  expect(template).toMatch(
    /class="c2c-scrim"[^>]*aria-role="dialog"[^>]*aria-modal="true"[^>]*aria-label="\{\{decisionTitle\}\}"/,
  );
  expect(template).toMatch(/aria-role="alert"/);
  expect(template.match(/aria-role="status"/g)).toHaveLength(4);
});

test("styles lock scroll, touch, badge, ellipsis, scrim, close-X, and safe-area rules", () => {
  const styles = readRequiredFile(stylesPath);
  const root = cssRule(styles, "\\.c2c-page");
  const scroll = cssRule(styles, "\\.c2c-scroll");
  const actionGrid = cssRule(styles, "\\.c2c-row-actions");
  const rowAction = cssRule(styles, "\\.c2c-row-action");
  const playerName = cssRule(styles, "\\.c2c-player-name");
  const playerIdentity = cssRule(styles, "\\.c2c-player-identity");
  const statusColumn = cssRule(styles, "\\.c2c-status-column");
  const statusBadge = cssRule(styles, "\\.c2c-status-badge");
  const scrim = cssRule(styles, "\\.c2c-scrim");
  const sheetClose = cssRule(styles, "\\.c2c-sheet-close");
  const statePrimary = cssRule(styles, "\\.c2c-state-action--primary");
  const sheetPrimary = cssRule(styles, "\\.c2c-sheet-action--primary");

  expect(root).toMatch(/height:\s*100vh/);
  expect(root).toMatch(/display:\s*flex/);
  expect(root).toMatch(/flex-direction:\s*column/);
  expect(root).toMatch(/overflow:\s*hidden/);
  expect(scroll).toMatch(/flex:\s*1 1 auto/);
  expect(scroll).toMatch(/height:\s*0/);
  expect(scroll).toMatch(/min-height:\s*0/);
  expect(styles).toMatch(/env\(safe-area-inset-bottom/);

  expect(actionGrid).toMatch(/display:\s*grid/);
  expect(actionGrid).toMatch(/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  expect(actionGrid).toMatch(/gap:\s*(?:1[6-9]|[2-9]\d|\d{3,})rpx/);
  expect(rowAction).toMatch(/width:\s*100%/);
  expect(rowAction).toMatch(/min-height:\s*(?:88|\d{3,})rpx/);
  expect(rowAction).toMatch(/display:\s*flex/);
  expect(rowAction).toMatch(/align-items:\s*center/);
  expect(rowAction).toMatch(/justify-content:\s*center/);

  expect(playerIdentity).toMatch(/min-width:\s*0/);
  expect(playerName).toMatch(/overflow:\s*hidden/);
  expect(playerName).toMatch(/text-overflow:\s*ellipsis/);
  expect(playerName).toMatch(/white-space:\s*nowrap/);
  expect(statusColumn).toMatch(/grid-template-columns:\s*\d+rpx/);
  expect(statusColumn).toMatch(/justify-items:\s*stretch/);
  expect(statusBadge).toMatch(/width:\s*100%/);
  expect(statusBadge).toMatch(/min-height:\s*\d+rpx/);
  expect(statusBadge).toMatch(/display:\s*flex/);
  expect(statusBadge).toMatch(/align-items:\s*center/);
  expect(statusBadge).toMatch(/justify-content:\s*center/);

  expect(scrim).toMatch(/position:\s*fixed/);
  expect(scrim).toMatch(/rgba\(16,\s*36,\s*62,\s*\.48\)/);
  expect(sheetClose).toMatch(/min-width:\s*(?:88|\d{3,})rpx/);
  expect(sheetClose).toMatch(/min-height:\s*(?:88|\d{3,})rpx/);
  expect(styles).toMatch(/\.c2c-close-icon::before,\s*\.c2c-close-icon::after\s*\{/);
  expect(styles).toMatch(/\.c2c-close-icon::before\s*\{[^}]*rotate\(45deg\)/s);
  expect(styles).toMatch(/\.c2c-close-icon::after\s*\{[^}]*rotate\(-45deg\)/s);
  expect(styles).toMatch(/\.c2c-pressed\s*\{[^}]*opacity:\s*\.\d+/s);
  expect(styles).not.toMatch(/\.c2c-footer\s*\{/);
  for (const primary of [statePrimary, sheetPrimary]) {
    expect(primary).toMatch(/border:\s*1rpx solid #0369A1/);
    expect(primary).toMatch(/background:\s*#0369A1/);
    expect(primary).toMatch(/color:\s*#FFFFFF/);
    expect(primary).not.toMatch(/#0284C7/);
  }
});
