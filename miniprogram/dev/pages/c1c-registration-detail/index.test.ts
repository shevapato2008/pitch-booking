/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */

import { readFileSync } from "node:fs";
import { beforeEach, expect, jest, test } from "@jest/globals";

import { c1cMyGameRegistrationsStore } from "../../c1c-my-game-registrations-fixture";

interface Definition {
  data: Record<string, any>;
  onLoad(query?: { registrationId?: unknown }): void;
  onShow(): void;
  onHeaderBack(): void;
  onReturnList(): void;
}

let captured: Definition | undefined;

const loadPage = () => {
  if (!captured) {
    (globalThis as any).Page = (definition: Definition) => { captured = definition; };
    jest.requireActual("./index");
  }
  return {
    ...captured!,
    data: { ...captured!.data },
    setData(patch: Record<string, unknown>) { Object.assign(this.data, patch); },
  } as Definition & { setData(patch: Record<string, unknown>): void };
};

beforeEach(() => {
  c1cMyGameRegistrationsStore.reset("READY");
  (globalThis as any).wx = {
    getWindowInfo: jest.fn(() => ({ windowWidth: 375, statusBarHeight: 44 })),
    getMenuButtonBoundingClientRect: jest.fn(() => ({ top: 48, bottom: 80, left: 278, right: 365, width: 87, height: 32 })),
    navigateBack: jest.fn(),
    redirectTo: jest.fn(),
  };
  (globalThis as any).getCurrentPages = jest.fn(() => [{}]);
});

test.each([
  ["reg-applied", "待队长审核", "海河周六轻松局"],
  ["reg-joined", "已加入", "奥体周日傍晚局"],
  ["reg-rejected", "未通过", "水西公园夜场局"],
  ["reg-cancelled", "球局已取消", "津南周末友谊局"],
] as const)("query %s renders only its exact registration", (registrationId, statusLabel, gameName) => {
  const page = loadPage();
  page.onLoad({ registrationId: encodeURIComponent(registrationId) });
  page.onShow();

  expect(page.data).toMatchObject({
    headerTopPx: 44,
    headerRowHeightPx: 44,
    registrationId,
    notFound: false,
    registration: { registrationId, statusLabel, gameName },
  });
});

test("unknown and malformed IDs never fall back to the first registration", () => {
  const unknown = loadPage();
  unknown.onLoad({ registrationId: "unknown" });
  unknown.onShow();
  expect(unknown.data).toMatchObject({ registrationId: "unknown", registration: null, notFound: true });

  const malformed = loadPage();
  malformed.onLoad({ registrationId: "%E0%A4%A" });
  malformed.onShow();
  expect(malformed.data).toMatchObject({ registrationId: "", registration: null, notFound: true });
});

test("normal list history navigates back while every deep link returns to the C1c discovery entry", () => {
  const page = loadPage();
  page.onLoad({ registrationId: "reg-applied" });
  (getCurrentPages as unknown as jest.Mock).mockReturnValue([
    { route: "dev/pages/c1c-my-registrations/index" },
    { route: "dev/pages/c1c-registration-detail/index" },
  ]);
  page.onHeaderBack();
  expect(wx.navigateBack).toHaveBeenCalledWith({ delta: 1 });

  (getCurrentPages as unknown as jest.Mock).mockReturnValue([
    { route: "dev/pages/c1c-registration-detail/index" },
  ]);
  page.onReturnList();
  expect(wx.redirectTo).toHaveBeenCalledWith({ url: "/dev/pages/c1c-discovery-entry/index" });
});

test("detail is read-only, private-field free, and all buttons return for real", () => {
  const wxml = readFileSync("miniprogram/dev/pages/c1c-registration-detail/index.wxml", "utf8");
  expect(wxml).toMatch(/{{registration.statusLabel}}/);
  expect(wxml).toMatch(/{{registration.gameName}}/);
  expect(wxml).toMatch(/{{registration.dateLabel}} · {{registration.timeLabel}}/);
  expect(wxml).toMatch(/{{registration.venue}}/);
  expect(wxml).toMatch(/{{registration.pitch}}/);
  expect(wxml).toMatch(/{{registration.formatLabel}}/);
  expect(wxml).not.toMatch(/申请称呼|申请说明|审核人|其他申请人|手机号|微信号|订单|支付|成员名单|visibility|appliedAt/);
  for (const button of wxml.match(/<button\b[^>]*>/g) ?? []) {
    expect(button).toMatch(/bindtap="on(?:HeaderBack|ReturnList)"/);
  }
});
