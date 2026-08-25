/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */

import { readFileSync } from "node:fs";
import { beforeEach, expect, jest, test } from "@jest/globals";

import { c1bGameDiscoveryStore } from "../../c1b-game-discovery-fixture";

interface Definition {
  data: Record<string, any>;
  onLoad(query?: { gameId?: unknown }): void;
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
  c1bGameDiscoveryStore.reset("READY");
  (globalThis as any).wx = {
    getWindowInfo: jest.fn(() => ({ windowWidth: 375, statusBarHeight: 44 })),
    getMenuButtonBoundingClientRect: jest.fn(() => ({ top: 48, bottom: 80, left: 278, right: 365, width: 87, height: 32 })),
    navigateBack: jest.fn(),
    redirectTo: jest.fn(),
  };
  (globalThis as any).getCurrentPages = jest.fn(() => [{}]);
});

test.each([
  ["harbor-five", "海河周六晨练局", "笼式五人制 2 号场"],
  ["olympic-seven", "奥体周日傍晚局", "七人制 A 场"],
  ["riverside-five", "水西公园夜场局", "五人制 1 号场"],
] as const)("query %s renders only its exact catalog record", (gameId, name, pitch) => {
  const page = loadPage();
  page.onLoad({ gameId: encodeURIComponent(gameId) });
  page.onShow();
  expect(page.data).toMatchObject({ headerTopPx: 44, headerRowHeightPx: 44, gameId, notFound: false });
  expect(page.data.game).toMatchObject({ id: gameId, name, pitch });
});

test("unknown or malformed IDs never fall back to the first game", () => {
  const unknown = loadPage();
  unknown.onLoad({ gameId: "unknown" });
  unknown.onShow();
  expect(unknown.data).toMatchObject({ gameId: "unknown", game: null, notFound: true });

  const malformed = loadPage();
  malformed.onLoad({ gameId: "%E0%A4%A" });
  malformed.onShow();
  expect(malformed.data).toMatchObject({ gameId: "", game: null, notFound: true });
});

test("onShow rereads the same record and returning from the directory preserves singleton filters", () => {
  c1bGameDiscoveryStore.reset("FILTERED_NONEMPTY");
  const page = loadPage();
  page.onLoad({ gameId: "harbor-five" });
  expect(page.data.game?.id).toBe("harbor-five");

  c1bGameDiscoveryStore.reset("SOURCE_EMPTY");
  page.onShow();
  expect(page.data).toMatchObject({ gameId: "harbor-five", game: null, notFound: true });

  c1bGameDiscoveryStore.reset("FILTERED_NONEMPTY");
  (getCurrentPages as unknown as jest.Mock).mockReturnValue([
    { route: "dev/pages/c1b-game-discovery/index" },
    { route: "dev/pages/c1b-game-detail/index" },
  ]);
  page.onHeaderBack();
  expect(wx.navigateBack).toHaveBeenCalledWith({ delta: 1 });
  expect(c1bGameDiscoveryStore.current().filters).toEqual({ date: "2026-08-29", format: "FIVE", availableOnly: true });
});

test.each([
  ["header", "onHeaderBack", [{ route: "dev/pages/c1b-scenario/index" }, { route: "dev/pages/c1b-game-detail/index" }]],
  ["not-found button", "onReturnList", [{ route: "pages/intent-entry/index" }, { route: "dev/pages/c1b-game-detail/index" }]],
  ["deep link", "onHeaderBack", [{ route: "dev/pages/c1b-game-detail/index" }]],
] as const)("%s redirects to the directory unless the previous route is the directory", (_label, action, stack) => {
  const page = loadPage();
  page.onLoad({ gameId: "unknown" });
  (getCurrentPages as unknown as jest.Mock).mockReturnValue(stack);

  page[action]();

  expect(wx.redirectTo).toHaveBeenCalledWith({ url: "/dev/pages/c1b-game-discovery/index" });
  expect(wx.navigateBack).not.toHaveBeenCalled();
});

test("not-found return is real and the read-only detail exposes no application or private field", () => {
  const page = loadPage();
  page.onLoad({ gameId: "unknown" });
  page.onReturnList();
  expect(wx.redirectTo).toHaveBeenCalledWith({ url: "/dev/pages/c1b-game-discovery/index" });

  const wxml = readFileSync("miniprogram/dev/pages/c1b-game-detail/index.wxml", "utf8");
  expect(wxml).toMatch(/C1b 开发预览仅验证发现与只读详情，不提供申请操作。/);
  expect(wxml).not.toMatch(/申请加入|我要报名|立即加入|手机号|微信号|订单号|成员名单|支付字段/);
  for (const button of wxml.match(/<button\b[^>]*>/g) ?? []) expect(button).toMatch(/bindtap="on(?:HeaderBack|ReturnList)"/);
});
