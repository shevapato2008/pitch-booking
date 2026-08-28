/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */

import { readFileSync } from "node:fs";
import { beforeEach, expect, jest, test } from "@jest/globals";

import { c1bGameDiscoveryStore } from "../../c1b-game-discovery-fixture";
import { c1cMyGameRegistrationsStore } from "../../c1c-my-game-registrations-fixture";

interface Definition {
  data: Record<string, any>;
  onLoad(query?: { gameId?: unknown }): void;
  onShow(): void;
  onSelectDate(event: { currentTarget?: { dataset?: { value?: unknown } } }): void;
  onFormatChange(event: { detail?: { value?: unknown } }): void;
  onToggleAvailable(): void;
  onClearFilters(): void;
  onRetry(): void;
  onOpenGame(event: { currentTarget?: { dataset?: { gameId?: unknown } } }): void;
  onOpenMyRegistrations(): void;
  onScroll(event: { detail?: { scrollTop?: unknown } }): void;
  onReturnEntry(): void;
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
  c1cMyGameRegistrationsStore.reset("READY");
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

test("filters the existing C1b store through public methods and clears the exact projection", () => {
  const page = loadPage();
  page.onLoad();
  page.onShow();
  expect(page.data).toMatchObject({ headerTopPx: 44, headerRowHeightPx: 44, status: "READY", resultCount: 3 });

  page.onSelectDate({ currentTarget: { dataset: { value: "2026-08-29" } } });
  page.onFormatChange({ detail: { value: "1" } });
  page.onToggleAvailable();
  expect(page.data).toMatchObject({
    resultCount: 1,
    selectedFormatIndex: 1,
    filters: { date: "2026-08-29", format: "FIVE", availableOnly: true },
  });
  expect(page.data.games.map(({ id }: { id: string }) => id)).toEqual(["harbor-five"]);

  page.onClearFilters();
  expect(page.data).toMatchObject({
    resultCount: 3,
    selectedFormatIndex: 0,
    filters: { date: "ALL", format: "ALL", availableOnly: false },
  });
});

test("opening My Registrations and returning preserves entry filters and exact scroll position", () => {
  const page = loadPage();
  page.onLoad();
  page.onSelectDate({ currentTarget: { dataset: { value: "2026-08-30" } } });
  page.onScroll({ detail: { scrollTop: 314.5 } });
  page.onOpenMyRegistrations();

  expect(c1cMyGameRegistrationsStore.current().entryScrollTop).toBe(314.5);
  expect(wx.navigateTo).toHaveBeenCalledWith({ url: "/dev/pages/c1c-my-registrations/index" });

  page.data.entryScrollTop = 0;
  page.onShow();
  expect(page.data).toMatchObject({
    entryScrollTop: 314.5,
    filters: { date: "2026-08-30", format: "ALL", availableOnly: false },
  });
  expect(page.data.games.map(({ id }: { id: string }) => id)).toEqual(["olympic-seven"]);
});

test("retry, empty return, and each public-game card have a C1c-owned destination", () => {
  c1bGameDiscoveryStore.reset("LOAD_ERROR");
  const page = loadPage();
  page.onShow();
  expect(page.data).toMatchObject({ status: "LOAD_ERROR", resultCount: 0 });
  page.onRetry();
  expect(page.data).toMatchObject({ status: "READY", resultCount: 3 });

  page.onOpenGame({ currentTarget: { dataset: { gameId: "olympic-seven" } } });
  expect(c1bGameDiscoveryStore.current().selectedGameId).toBe("olympic-seven");
  expect(wx.navigateTo).toHaveBeenCalledWith({
    url: "/dev/pages/c1c-discovery-entry/index?gameId=olympic-seven",
  });

  page.onOpenGame({ currentTarget: { dataset: { gameId: "unknown" } } });
  expect(wx.navigateTo).toHaveBeenCalledTimes(1);

  c1bGameDiscoveryStore.reset("SOURCE_EMPTY");
  page.onShow();
  page.onReturnIntent();
  expect(wx.reLaunch).toHaveBeenCalledWith({ url: "/pages/intent-entry/index" });
});

test("entry card to exact detail and visible return preserve C1c filters and scroll", () => {
  const entry = loadPage();
  entry.onLoad();
  entry.onSelectDate({ currentTarget: { dataset: { value: "2026-08-30" } } });
  entry.onFormatChange({ detail: { value: "2" } });
  entry.onToggleAvailable();
  entry.onScroll({ detail: { scrollTop: 466.25 } });
  entry.onOpenGame({ currentTarget: { dataset: { gameId: "olympic-seven" } } });

  const detail = loadPage();
  detail.onLoad({ gameId: "olympic-seven" });
  detail.onShow();
  expect(detail.data).toMatchObject({
    detailMode: true,
    detailGameId: "olympic-seven",
    detailNotFound: false,
    detailGame: { id: "olympic-seven", name: "奥体周日傍晚局", pitch: "七人制 A 场" },
  });

  (getCurrentPages as unknown as jest.Mock).mockReturnValue([
    { route: "dev/pages/c1c-discovery-entry/index" },
    { route: "dev/pages/c1c-discovery-entry/index" },
  ]);
  detail.onReturnEntry();
  expect(wx.navigateBack).toHaveBeenCalledWith({ delta: 1 });

  entry.onShow();
  expect(entry.data).toMatchObject({
    entryScrollTop: 466.25,
    filters: { date: "2026-08-30", format: "SEVEN", availableOnly: true },
  });
  expect(entry.data.games.map(({ id }: { id: string }) => id)).toEqual(["olympic-seven"]);
});

test("unknown detail never falls back and a deep-link return redirects to C1c entry mode", () => {
  const detail = loadPage();
  detail.onLoad({ gameId: "unknown" });
  detail.onShow();
  expect(detail.data).toMatchObject({
    detailMode: true,
    detailGameId: "unknown",
    detailGame: null,
    detailNotFound: true,
  });

  (getCurrentPages as unknown as jest.Mock).mockReturnValue([
    { route: "dev/pages/c1c-discovery-entry/index" },
  ]);
  detail.onHeaderBack();
  expect(wx.redirectTo).toHaveBeenCalledWith({ url: "/dev/pages/c1c-discovery-entry/index" });

  const malformed = loadPage();
  malformed.onLoad({ gameId: "%E0%A4%A" });
  expect(malformed.data).toMatchObject({ detailMode: true, detailGameId: "", detailGame: null, detailNotFound: true });
});

test("header back returns to history or the C1c launcher", () => {
  const page = loadPage();
  page.onHeaderBack();
  expect(wx.redirectTo).toHaveBeenCalledWith({ url: "/dev/pages/c1c-scenario/index" });

  (getCurrentPages as unknown as jest.Mock).mockReturnValue([{}, {}]);
  page.onHeaderBack();
  expect(wx.navigateBack).toHaveBeenCalledWith({ delta: 1 });
});

test("every visible entry control binds behavior and scroll restoration is wired", () => {
  const wxml = readFileSync("miniprogram/dev/pages/c1c-discovery-entry/index.wxml", "utf8");
  const cards = wxml.match(/<button[^>]+class="c1c-game-card[^>]*>[\s\S]*?<\/button>/g) ?? [];
  expect(cards).not.toHaveLength(0);
  cards.forEach((card) => {
    expect(card).toMatch(/bindtap="onOpenGame"/);
    expect(card).not.toMatch(/<button[^>]*>[\s\S]*<button/);
  });
  for (const button of wxml.match(/<button\b[^>]*>/g) ?? []) {
    expect(button).toMatch(/bindtap="on[A-Za-z]+"/);
  }
  expect(wxml).toMatch(/<picker[^>]+bindchange="onFormatChange"/);
  expect(wxml).toMatch(/<scroll-view[^>]+scroll-y="true"[^>]+scroll-top="{{entryScrollTop}}"[^>]+bindscroll="onScroll"/);
  expect(wxml).toMatch(/bindtap="onOpenMyRegistrations"/);
  expect(wxml).toMatch(/{{detailGame.name}}/);
  expect(wxml).toMatch(/{{detailGame.dateLabel}} · {{detailGame.timeLabel}}/);
  expect(wxml).toMatch(/{{detailGame.venue}} · {{detailGame.pitch}}/);
  expect(wxml).toMatch(/bindtap="onReturnEntry"/);
  expect(wxml).not.toMatch(/申请加入|我要报名|立即加入|手机号|微信号|订单号|成员名单|支付字段/);
});

test("capacity copy explicitly describes public-registration availability", () => {
  const wxml = readFileSync("miniprogram/dev/pages/c1c-discovery-entry/index.wxml", "utf8");
  expect(wxml).toMatch(/公开报名已满/);
  expect(wxml).toMatch(/公开报名剩 ['"] \+ item\.remainingSpots \+ ['"] 名/);
  expect(wxml).not.toMatch(/'已满'|'剩 ' \+ item\.remainingSpots \+ ' 个名额'/);
});
