/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */

import { existsSync, readFileSync } from "node:fs";
import { beforeEach, expect, jest, test } from "@jest/globals";

interface CaptainPage {
  data: Record<string, any>;
  onLoad(): void;
  onCopyRegistrationId(event: { currentTarget?: { dataset?: { registrationId?: unknown } } }): void;
  onHeaderBack(): void;
}

const sourcePath = "miniprogram/dev/pages/c2d-captain-roster/index.ts";
const templatePath = sourcePath.replace(/\.ts$/, ".wxml");
const stylesPath = sourcePath.replace(/\.ts$/, ".wxss");
let captured: CaptainPage | undefined;

function readRequired(path: string): string {
  expect(existsSync(path)).toBe(true);
  if (!existsSync(path)) throw new Error(`${path} is missing`);
  return readFileSync(path, "utf8");
}

function loadPage(): CaptainPage & { setData(patch: Record<string, unknown>): void } {
  if (!captured) {
    readRequired(sourcePath);
    (globalThis as any).Page = (definition: CaptainPage) => { captured = definition; };
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
    setClipboardData: jest.fn(),
    navigateBack: jest.fn(),
    redirectTo: jest.fn(),
  };
  (globalThis as any).getCurrentPages = jest.fn(() => [{}, {}]);
});

test("captain page projects aligned roster rows and the corrected authoritative result", () => {
  const page = loadPage();
  page.onLoad();

  expect(wx.hideShareMenu).toHaveBeenCalledTimes(1);
  expect(page.data).toMatchObject({
    fixtureNotice: "C2d 开发预览 · 模拟数据",
    headerTopPx: 44,
    headerRowHeightPx: 44,
  });
  expect(page.data.roster).toHaveLength(1);
  expect(page.data.roster[0]).toMatchObject({
    perGameName: "林知远（右边锋，也可以客串中场）",
    currentAttendanceLabel: "未到场",
    originalAttendanceLabel: "已到场",
    originalRecordedAtLabel: "8月31日 10:06",
    correctedAtLabel: "8月31日 14:18",
    registrationId: "8ed324a4-56cb-4d73-9a77-0b4605ac3b17",
  });
});

test("copy calls real wx.setClipboardData and shows success or retryable failure inline", () => {
  const page = loadPage();
  page.onLoad();
  const targetId = page.data.roster[0].registrationId;

  (wx.setClipboardData as any).mockImplementationOnce((options: any) => options.success());
  page.onCopyRegistrationId({ currentTarget: { dataset: { registrationId: targetId } } });
  expect(wx.setClipboardData).toHaveBeenCalledWith(expect.objectContaining({ data: targetId }));
  expect(page.data).toMatchObject({
    copyFeedbackRegistrationId: targetId,
    copyFeedbackKind: "success",
    copyFeedback: "报名编号已复制",
  });

  (wx.setClipboardData as any).mockImplementationOnce((options: any) => options.fail());
  page.onCopyRegistrationId({ currentTarget: { dataset: { registrationId: targetId } } });
  expect(page.data).toMatchObject({
    copyFeedbackRegistrationId: targetId,
    copyFeedbackKind: "error",
    copyFeedback: "复制失败，请重试",
  });

  page.onCopyRegistrationId({ currentTarget: { dataset: { registrationId: "unknown" } } });
  expect(wx.setClipboardData).toHaveBeenCalledTimes(2);
});

test("captain back uses history or the C2d scenario fallback and sharing stays disabled", () => {
  const page = loadPage();
  page.onHeaderBack();
  expect(wx.navigateBack).toHaveBeenCalledWith({ delta: 1 });

  (getCurrentPages as unknown as jest.Mock).mockReturnValue([{}]);
  page.onHeaderBack();
  expect(wx.redirectTo).toHaveBeenCalledWith({
    url: "/dev/pages/c2d-attendance-correction-scenario/index",
  });
  expect(page as unknown as Record<string, unknown>).not.toHaveProperty("onShareAppMessage");
});

test("captain markup keeps long names from pushing a fixed aligned status column", () => {
  const template = readRequired(templatePath);
  const styles = readRequired(stylesPath);
  const combined = `${template}\n${styles}`;

  expect(template).toContain('<scroll-view class="c2d-scroll" scroll-y="true">');
  expect(template).toContain("<text>到场结果</text><text>3 / 3 人</text>");
  expect(template).toContain("<text>已记录 1 人</text>");
  expect(template).toContain("{{item.currentAttendanceLabel}}");
  expect(template).toContain("原记录：{{item.originalAttendanceLabel}} · {{item.originalRecordedAtLabel}}");
  expect(template).toContain("平台已纠正 · {{item.correctedAtLabel}}");
  expect(template).toContain("{{item.registrationId}}");
  expect(template).toContain('bindtap="onCopyRegistrationId"');
  expect(template).toContain('aria-role="status"');
  for (const forbidden of [/纠正原因/, /平台账号/, /完整历史/, /手机号/, /OpenID/, /用户 ID/, /支付/, /退款/]) {
    expect(combined).not.toMatch(forbidden);
  }
  expect(styles).toMatch(/\.c2d-player-main\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+\d+rpx/s);
  expect(styles).toMatch(/\.c2d-player-identity\s*\{[^}]*min-width:\s*0/s);
  expect(styles).toMatch(/\.c2d-player-name\s*\{[^}]*overflow-wrap:\s*anywhere/s);
  expect(styles).toMatch(/\.c2d-status-column\s*\{[^}]*width:\s*\d+rpx/s);
  expect(styles).toMatch(/\.c2d-content\s*\{[^}]*env\(safe-area-inset-bottom,\s*0px\)/s);
  const copyRule = styles.match(/\.c2d-copy-button\s*\{[^}]*\}/s)?.[0] ?? "";
  expect(copyRule).toMatch(/min-height:\s*(?:88|9\d|\d{3,})rpx/);
  expect(copyRule).toMatch(/display:\s*flex/);
  expect(copyRule).toMatch(/align-items:\s*center/);
  expect(copyRule).toMatch(/justify-content:\s*center/);
});
