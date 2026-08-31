/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */

import { existsSync, readFileSync } from "node:fs";
import { beforeEach, expect, jest, test } from "@jest/globals";

interface PlayerPage {
  data: Record<string, any>;
  onLoad(): void;
  onCopyRegistrationId(): void;
  onHeaderBack(): void;
}

const sourcePath = "miniprogram/dev/pages/c2d-player-result/index.ts";
const templatePath = sourcePath.replace(/\.ts$/, ".wxml");
const stylesPath = sourcePath.replace(/\.ts$/, ".wxss");
let captured: PlayerPage | undefined;

function readRequired(path: string): string {
  expect(existsSync(path)).toBe(true);
  if (!existsSync(path)) throw new Error(`${path} is missing`);
  return readFileSync(path, "utf8");
}

function loadPage(): PlayerPage & { setData(patch: Record<string, unknown>): void } {
  if (!captured) {
    readRequired(sourcePath);
    (globalThis as any).Page = (definition: PlayerPage) => { captured = definition; };
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
    getWindowInfo: jest.fn(() => ({ windowWidth: 411, statusBarHeight: 24 })),
    getMenuButtonBoundingClientRect: jest.fn(() => ({ top: 28, bottom: 60, left: 313, right: 399, width: 86, height: 32 })),
    hideShareMenu: jest.fn(),
    setClipboardData: jest.fn(),
    navigateBack: jest.fn(),
    redirectTo: jest.fn(),
  };
  (globalThis as any).getCurrentPages = jest.fn(() => [{}, {}]);
});

test("player page reads back only the authoritative self result and relevant timestamps", () => {
  const page = loadPage();
  page.onLoad();

  expect(wx.hideShareMenu).toHaveBeenCalledTimes(1);
  expect(page.data).toMatchObject({
    fixtureNotice: "C2d 开发预览 · 模拟数据",
    headerTopPx: 24,
    headerRowHeightPx: 44,
    registration: {
      currentAttendanceStatus: "NO_SHOW",
      currentAttendanceLabel: "未到场",
      originalAttendanceLabel: "已到场",
      originalRecordedAtLabel: "8月31日 10:06",
      correctedAtLabel: "8月31日 14:18",
      registrationId: "8ed324a4-56cb-4d73-9a77-0b4605ac3b17",
    },
  });
});

test("player copy uses true clipboard callbacks and keeps failure visible for retry", () => {
  const page = loadPage();
  page.onLoad();
  const targetId = page.data.registration.registrationId;

  (wx.setClipboardData as any).mockImplementationOnce((options: any) => options.fail());
  page.onCopyRegistrationId();
  expect(wx.setClipboardData).toHaveBeenCalledWith(expect.objectContaining({ data: targetId }));
  expect(page.data).toMatchObject({ copyFeedbackKind: "error", copyFeedback: "复制失败，请重试" });

  (wx.setClipboardData as any).mockImplementationOnce((options: any) => options.success());
  page.onCopyRegistrationId();
  expect(wx.setClipboardData).toHaveBeenCalledTimes(2);
  expect(page.data).toMatchObject({ copyFeedbackKind: "success", copyFeedback: "报名编号已复制" });
});

test("player back uses history and falls back to the scenario route", () => {
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

test("player markup has custom scrolling safe area, aligned actions, and no private correction data", () => {
  const template = readRequired(templatePath);
  const styles = readRequired(stylesPath);
  const combined = `${template}\n${styles}`;

  expect(template).toContain('<scroll-view class="c2d-scroll" scroll-y="true">');
  expect(template).toContain("{{registration.currentAttendanceLabel}}");
  expect(template).toContain("平台已纠正于 {{registration.correctedAtLabel}}");
  expect(template).toContain("{{registration.originalAttendanceLabel}}");
  expect(template).toContain("{{registration.originalRecordedAtLabel}}");
  expect(template).toContain("{{registration.registrationId}}");
  expect(template).toContain('bindtap="onCopyRegistrationId"');
  expect(template).toContain('aria-role="status"');
  for (const forbidden of [/纠正原因/, /平台账号/, /完整历史/, /手机号/, /OpenID/, /用户 ID/, /支付/, /退款/]) {
    expect(combined).not.toMatch(forbidden);
  }
  expect(styles).toMatch(/\.c2d-scroll\s*\{[^}]*height:\s*0[^}]*min-height:\s*0/s);
  expect(styles).toMatch(/\.c2d-content\s*\{[^}]*env\(safe-area-inset-bottom,\s*0px\)/s);
  const copyRule = styles.match(/\.c2d-copy-button\s*\{[^}]*\}/s)?.[0] ?? "";
  expect(copyRule).toMatch(/min-height:\s*(?:88|9\d|\d{3,})rpx/);
  expect(copyRule).toMatch(/display:\s*flex/);
  expect(copyRule).toMatch(/align-items:\s*center/);
  expect(copyRule).toMatch(/justify-content:\s*center/);
});
