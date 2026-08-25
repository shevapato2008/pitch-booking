/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */

import { readFileSync } from "node:fs";
import { beforeEach, expect, jest, test } from "@jest/globals";

import { c1bGameDiscoveryStore } from "../../c1b-game-discovery-fixture";

interface Definition {
  data: Record<string, any>;
  onLoad(): void;
  onShow(): void;
  onSelectDate(event: { currentTarget?: { dataset?: { value?: unknown } } }): void;
  onFormatChange(event: { detail?: { value?: unknown } }): void;
  onToggleAvailable(): void;
  onClearFilters(): void;
  onRetry(): void;
  onOpenGame(event: { currentTarget?: { dataset?: { gameId?: unknown } } }): void;
  onReturnIntent(): void;
  onHeaderBack(): void;
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
    navigateTo: jest.fn(),
    navigateBack: jest.fn(),
    redirectTo: jest.fn(),
    reLaunch: jest.fn(),
  };
  (globalThis as any).getCurrentPages = jest.fn(() => [{}]);
});

test("onShow always reprojects the singleton and all three filters combine immediately", () => {
  const page = loadPage();
  page.onLoad();
  page.onShow();
  expect(page.data).toMatchObject({ headerTopPx: 44, headerRowHeightPx: 44, status: "READY", resultCount: 3 });
  expect(page.data.games.map(({ id }: { id: string }) => id)).toEqual(["harbor-five", "olympic-seven", "riverside-five"]);

  page.onSelectDate({ currentTarget: { dataset: { value: "2026-08-29" } } });
  page.onFormatChange({ detail: { value: "1" } });
  page.onToggleAvailable();
  expect(page.data).toMatchObject({
    resultCount: 1,
    selectedFormatIndex: 1,
    selectedFormatLabel: "五人制",
    filters: { date: "2026-08-29", format: "FIVE", availableOnly: true },
  });
  expect(page.data.games[0].id).toBe("harbor-five");

  page.onClearFilters();
  expect(page.data).toMatchObject({
    resultCount: 3,
    selectedFormatIndex: 0,
    filters: { date: "ALL", format: "ALL", availableOnly: false },
  });
});

test("invalid date and picker values do not mutate filters", () => {
  const page = loadPage();
  page.onShow();
  page.onSelectDate({ currentTarget: { dataset: { value: "2099-01-01" } } });
  page.onFormatChange({ detail: { value: "99" } });
  expect(page.data.filters).toEqual({ date: "ALL", format: "ALL", availableOnly: false });
});

test("load error retry restores the catalog and natural empty returns to the real intent entry", () => {
  c1bGameDiscoveryStore.reset("LOAD_ERROR");
  const page = loadPage();
  page.onShow();
  expect(page.data).toMatchObject({ status: "LOAD_ERROR", resultCount: 0 });
  page.onRetry();
  expect(page.data).toMatchObject({ status: "READY", resultCount: 3 });

  c1bGameDiscoveryStore.reset("SOURCE_EMPTY");
  page.onShow();
  expect(page.data).toMatchObject({ sourceEmpty: true, filterNoMatch: false });
  page.onReturnIntent();
  expect(wx.reLaunch).toHaveBeenCalledWith({ url: "/pages/intent-entry/index" });
});

test.each(["harbor-five", "olympic-seven", "riverside-five"])("card %s selects and opens its exact encoded detail", (gameId) => {
  const page = loadPage();
  page.onShow();
  page.onOpenGame({ currentTarget: { dataset: { gameId } } });
  expect(c1bGameDiscoveryStore.current().selectedGameId).toBe(gameId);
  expect(wx.navigateTo).toHaveBeenCalledWith({
    url: `/dev/pages/c1b-game-detail/index?gameId=${encodeURIComponent(gameId)}`,
  });
});

test("unknown cards do not navigate and back deep-links to the slice launcher", () => {
  const page = loadPage();
  page.onOpenGame({ currentTarget: { dataset: { gameId: "unknown" } } });
  expect(wx.navigateTo).not.toHaveBeenCalled();

  page.onHeaderBack();
  expect(wx.redirectTo).toHaveBeenCalledWith({ url: "/dev/pages/c1b-scenario/index" });

  (getCurrentPages as unknown as jest.Mock).mockReturnValue([{}, {}]);
  page.onHeaderBack();
  expect(wx.navigateBack).toHaveBeenCalledWith({ delta: 1 });
});

test("the whole card is the only card action and every visible button has a real handler", () => {
  const wxml = readFileSync("miniprogram/dev/pages/c1b-game-discovery/index.wxml", "utf8");
  const card = wxml.match(/<button[^>]+class="c1b-game-card"[\s\S]*?<\/button>/)?.[0] ?? "";
  expect(card).toMatch(/bindtap="onOpenGame"/);
  expect(card).not.toMatch(/<button[^>]*>[\s\S]*<button/);
  for (const button of wxml.match(/<button\b[^>]*>/g) ?? []) expect(button).toMatch(/bindtap="on[A-Za-z]+"/);
  expect(wxml).not.toMatch(/申请加入|我要报名|立即加入/);
});
