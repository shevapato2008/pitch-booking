/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */

import { existsSync, readFileSync } from "node:fs";
import { beforeEach, expect, jest, test } from "@jest/globals";

interface ReportPage {
  data: Record<string, any>;
  onLoad(query?: { scenario?: string }): void;
  onSelectCategory(event: { currentTarget?: { dataset?: { category?: unknown } } }): void;
  onFactsInput(event: { detail?: { value?: unknown } }): void;
  onPrepareSubmit(): void;
  onCancelSubmit(): void;
  onConfirmSubmit(): void;
  onRecoverUnknownResult(): void;
  onReload(): void;
  onHeaderBack(): void;
}

const sourcePath = "miniprogram/dev/pages/c2f-game-report/index.ts";
const templatePath = sourcePath.replace(/\.ts$/, ".wxml");
const stylesPath = sourcePath.replace(/\.ts$/, ".wxss");
let captured: ReportPage | undefined;

function readRequired(path: string): string {
  expect(existsSync(path)).toBe(true);
  if (!existsSync(path)) throw new Error(`${path} is missing`);
  return readFileSync(path, "utf8");
}

function loadPage(): ReportPage & { setData(patch: Record<string, unknown>): void } {
  if (!captured) {
    readRequired(sourcePath);
    (globalThis as any).Page = (definition: ReportPage) => { captured = definition; };
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
    navigateBack: jest.fn(),
    redirectTo: jest.fn(),
  };
  (globalThis as any).getCurrentPages = jest.fn(() => [{}, {}]);
});

test("form displays the authority context, five reasons and inline code-point state", () => {
  const page = loadPage();
  page.onLoad({ scenario: "form" });
  expect(wx.hideShareMenu).toHaveBeenCalledTimes(1);
  expect(page.data).toMatchObject({
    fixtureNotice: "C2f 开发预览 · 模拟数据，不会提交或修改生产数据",
    headerTopPx: 24,
    headerRowHeightPx: 44,
    gameName: "海河周日轻松局",
    teamName: "津门晨风队",
    targetLabel: "本场球局及组织者",
    submissionAllowed: true,
    report: null,
    factsCount: 0,
  });
  expect(page.data.categories).toHaveLength(5);

  page.onSelectCategory({ currentTarget: { dataset: { category: "EXTRA_CHARGE" } } });
  page.onFactsInput({ detail: { value: "现场要求额外支付未公开的费用。" } });
  expect(page.data).toMatchObject({
    selectedCategory: "EXTRA_CHARGE",
    facts: "现场要求额外支付未公开的费用。",
    factsCount: 15,
    factsError: "",
  });
});

test("privacy error stays inline and submit confirmation cancel never writes", () => {
  const page = loadPage();
  page.onLoad({ scenario: "form" });
  page.onSelectCategory({ currentTarget: { dataset: { category: "EXTRA_CHARGE" } } });
  page.onFactsInput({ detail: { value: "联系微信号：pitch_helper" } });
  expect(page.data.factsError).toBe("请删除手机号、微信号、邮箱、链接或其他联系方式");
  page.onPrepareSubmit();
  expect(page.data.confirmationOpen).toBe(false);

  page.onFactsInput({ detail: { value: "现场要求额外支付未公开的费用。" } });
  page.onPrepareSubmit();
  expect(page.data.confirmationOpen).toBe(true);
  expect(page.data.report).toBeNull();
  page.onCancelSubmit();
  expect(page.data.confirmationOpen).toBe(false);
  expect(page.data.report).toBeNull();

  page.onPrepareSubmit();
  page.onConfirmSubmit();
  expect(page.data.report).toMatchObject({ category: "EXTRA_CHARGE", status: "PENDING" });
  expect(page.data.feedback).toBe("举报已提交，等待平台处理");
});

test("resolved and expired states are truthful and have no dead submit action", () => {
  const resolved = loadPage();
  resolved.onLoad({ scenario: "resolved-cancelled" });
  expect(resolved.data).toMatchObject({
    submissionAllowed: false,
    report: {
      status: "RESOLVED",
      outcome: "CONFIRMED_GAME_CANCELLED",
      resultTitle: "举报成立，球局已取消",
    },
  });
  expect(JSON.stringify(resolved.data.report)).not.toMatch(/封禁|退款成功|resolutionNote|principal/);

  const expired = loadPage();
  expired.onLoad({ scenario: "expired" });
  expect(expired.data).toMatchObject({
    submissionAllowed: false,
    submissionBlocker: "REPORTING_WINDOW_CLOSED",
    report: null,
  });
});

test("unknown result blocks duplicate submit and reads authority before recovery", () => {
  const page = loadPage();
  page.onLoad({ scenario: "unknown" });
  page.onSelectCategory({ currentTarget: { dataset: { category: "ORGANIZER_NO_SHOW" } } });
  page.onFactsInput({ detail: { value: "开场后组织者仍未到场，也没有其他人负责现场接待。" } });
  page.onPrepareSubmit();
  page.onConfirmSubmit();
  expect(page.data).toMatchObject({
    resultUnknown: true,
    report: null,
    feedback: "提交结果未知，请先确认原提交结果",
  });
  page.onPrepareSubmit();
  expect(page.data.resultUnknown).toBe(true);
  page.onRecoverUnknownResult();
  expect(page.data).toMatchObject({
    resultUnknown: false,
    report: { category: "ORGANIZER_NO_SHOW", status: "PENDING" },
    feedback: "已确认原举报提交成功",
  });
});

test("reload, back and every visible action call real page handlers", () => {
  const page = loadPage();
  page.onLoad({ scenario: "pending" });
  page.onReload();
  expect(page.data.feedback).toBe("已重新读取模拟权威状态");
  page.onHeaderBack();
  expect(wx.navigateBack).toHaveBeenCalledWith({ delta: 1 });

  (getCurrentPages as unknown as jest.Mock).mockReturnValue([{}]);
  page.onHeaderBack();
  expect(wx.redirectTo).toHaveBeenCalledWith({
    url: "/dev/pages/c2f-game-report-scenario/index",
  });
  expect(page as unknown as Record<string, unknown>).not.toHaveProperty("onShareAppMessage");

  const template = readRequired(templatePath);
  for (const handler of [
    "onHeaderBack",
    "onSelectCategory",
    "onFactsInput",
    "onPrepareSubmit",
    "onCancelSubmit",
    "onConfirmSubmit",
    "onRecoverUnknownResult",
    "onReload",
  ]) expect(template).toContain(`bindtap="${handler}"`.replace("bindtap", handler === "onFactsInput" ? "bindinput" : "bindtap"));
});

test("markup supports scrolling, safe fixed footer, aligned controls and intact dialog", () => {
  expect(JSON.parse(readRequired(sourcePath.replace(/\.ts$/, ".json")))).toEqual({ navigationStyle: "custom" });
  const template = readRequired(templatePath);
  const styles = readRequired(stylesPath);
  expect(template).toContain('<scroll-view class="c2f-scroll" scroll-y="true">');
  expect(template).toContain("举报对象 · {{targetLabel}}");
  expect(template).toContain("举报对象为本场球局及组织者，不是单个成员");
  expect(template).toContain("{{factsCount}}/500");
  expect(template).toContain('maxlength="-1"');
  expect(template).toContain("不要填写手机号、微信号、邮箱、链接或其他可识别个人的信息");
  expect(template).toContain('wx:if="{{confirmationOpen}}"');
  expect(template).toContain('aria-role="dialog"');
  expect(template).toContain("提交后不可修改");
  expect(template).toContain("不会自动产生处罚、封禁或退款");
  expect(styles).toMatch(/\.c2f-scroll\s*\{[^}]*height:\s*0[^}]*min-height:\s*0/s);
  expect(styles).toMatch(/\.c2f-content--with-footer\s*\{[^}]*env\(safe-area-inset-bottom,\s*0px\)/s);
  expect(styles).toMatch(/\.c2f-footer\s*\{[^}]*env\(safe-area-inset-bottom,\s*0px\)/s);
  for (const selector of ["c2f-header-back", "c2f-category", "c2f-submit", "c2f-dialog-button"]) {
    const rule = styles.match(new RegExp(`\\.${selector}\\s*\\{[^}]*\\}`, "s"))?.[0] ?? "";
    expect(rule).toMatch(/min-height:\s*(?:88|9\d|\d{3,})rpx/);
    expect(rule).toMatch(/display:\s*flex/);
    expect(rule).toMatch(/align-items:\s*center/);
    expect(rule).toMatch(/justify-content:\s*center/);
  }
});
