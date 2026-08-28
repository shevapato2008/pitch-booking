/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */

import { readFileSync } from "node:fs";
import { beforeEach, expect, jest, test } from "@jest/globals";

import { c1cMyGameRegistrationsStore } from "../../c1c-my-game-registrations-fixture";

interface OutcomeEvent { currentTarget?: { dataset?: { outcome?: unknown } }; }
interface Definition {
  data: Record<string, any>;
  onLoad(): void;
  onShow(): void;
  onRetry(): void;
  onRefresh(event?: OutcomeEvent): void;
  onLoadMore(event?: OutcomeEvent): void;
  onOpenRegistration(event: { currentTarget?: { dataset?: { registrationId?: unknown } } }): void;
  onScroll(event: { detail?: { scrollTop?: unknown } }): void;
  onOpenDiscovery(): void;
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
  c1cMyGameRegistrationsStore.reset("READY");
  (globalThis as any).wx = {
    getWindowInfo: jest.fn(() => ({ windowWidth: 375, statusBarHeight: 44 })),
    getMenuButtonBoundingClientRect: jest.fn(() => ({ top: 48, bottom: 80, left: 278, right: 365, width: 87, height: 32 })),
    navigateTo: jest.fn(),
    navigateBack: jest.fn(),
    redirectTo: jest.fn(),
  };
  (globalThis as any).getCurrentPages = jest.fn(() => [{}]);
});

test("renders page one, appends page two once, and exposes all four effective statuses", () => {
  const page = loadPage();
  page.onLoad();
  page.onShow();
  expect(page.data).toMatchObject({
    headerTopPx: 44,
    headerRowHeightPx: 44,
    status: "READY",
    resultCount: 2,
    nextCursor: "c1c-page-2",
  });
  expect(page.data.items.map(({ effectiveStatus }: { effectiveStatus: string }) => effectiveStatus)).toEqual(["APPLIED", "JOINED"]);

  page.onLoadMore();
  expect(page.data.items.map(({ effectiveStatus }: { effectiveStatus: string }) => effectiveStatus)).toEqual([
    "APPLIED", "JOINED", "REJECTED", "CANCELLED",
  ]);
  expect(page.data).toMatchObject({ resultCount: 4, nextCursor: null, loadMoreError: false });
  page.onLoadMore();
  expect(page.data.items).toHaveLength(4);
});

test("first-load retry and empty state recover without inventing cards", () => {
  c1cMyGameRegistrationsStore.reset("LOAD_ERROR");
  const page = loadPage();
  page.onShow();
  expect(page.data).toMatchObject({ status: "LOAD_ERROR", items: [], resultCount: 0 });
  page.onRetry();
  expect(page.data).toMatchObject({ status: "READY", resultCount: 2, nextCursor: "c1c-page-2" });

  c1cMyGameRegistrationsStore.reset("EMPTY");
  page.onShow();
  expect(page.data).toMatchObject({ status: "READY", sourceEmpty: true, items: [], nextCursor: null });
  page.onRefresh();
  expect(page.data).toMatchObject({ sourceEmpty: true, items: [], nextCursor: null });
});

test("refresh and load-more errors remain inline while preserving displayed cards", () => {
  const page = loadPage();
  page.onShow();
  const pageOneIds = page.data.items.map(({ registrationId }: { registrationId: string }) => registrationId);

  page.onRefresh({ currentTarget: { dataset: { outcome: "ERROR" } } });
  expect(page.data.refreshError).toBe(true);
  expect(page.data.items.map(({ registrationId }: { registrationId: string }) => registrationId)).toEqual(pageOneIds);

  page.onRefresh();
  expect(page.data).toMatchObject({ refreshError: false, resultCount: 2 });
  page.onLoadMore({ currentTarget: { dataset: { outcome: "ERROR" } } });
  expect(page.data).toMatchObject({ loadMoreError: true, nextCursor: "c1c-page-2" });
  expect(page.data.items.map(({ registrationId }: { registrationId: string }) => registrationId)).toEqual(pageOneIds);

  page.onLoadMore();
  expect(page.data).toMatchObject({ loadMoreError: false, resultCount: 4, nextCursor: null });
});

test("page-two list and exact scroll survive opening detail and onShow", () => {
  const page = loadPage();
  page.onLoad();
  page.onLoadMore();
  page.onScroll({ detail: { scrollTop: 728.25 } });
  page.onOpenRegistration({ currentTarget: { dataset: { registrationId: "reg-cancelled" } } });

  expect(c1cMyGameRegistrationsStore.current()).toMatchObject({
    selectedRegistrationId: "reg-cancelled",
    nextCursor: null,
    listScrollTop: 728.25,
  });
  expect(wx.navigateTo).toHaveBeenCalledWith({
    url: "/dev/pages/c1c-registration-detail/index?registrationId=reg-cancelled",
  });

  page.data.items = [];
  page.data.listScrollTop = 0;
  page.onShow();
  expect(page.data.items.map(({ registrationId }: { registrationId: string }) => registrationId)).toEqual([
    "reg-applied", "reg-joined", "reg-rejected", "reg-cancelled",
  ]);
  expect(page.data).toMatchObject({ nextCursor: null, listScrollTop: 728.25 });
});

test("unknown cards do not navigate and back/deep-link discovery use real navigation", () => {
  const page = loadPage();
  page.onOpenRegistration({ currentTarget: { dataset: { registrationId: "unknown" } } });
  expect(wx.navigateTo).not.toHaveBeenCalled();

  page.onHeaderBack();
  expect(wx.redirectTo).toHaveBeenCalledWith({ url: "/dev/pages/c1c-discovery-entry/index" });
  page.onOpenDiscovery();
  expect(wx.redirectTo).toHaveBeenCalledWith({ url: "/dev/pages/c1c-discovery-entry/index" });

  (getCurrentPages as unknown as jest.Mock).mockReturnValue([{}, {}]);
  page.onHeaderBack();
  expect(wx.navigateBack).toHaveBeenCalledWith({ delta: 1 });
});

test("cards are the only detail targets and every button is bound without private fields", () => {
  const wxml = readFileSync("miniprogram/dev/pages/c1c-my-registrations/index.wxml", "utf8");
  const cards = wxml.match(/<button[^>]+class="c1c-registration-card[^>]*>[\s\S]*?<\/button>/g) ?? [];
  expect(cards).not.toHaveLength(0);
  cards.forEach((card) => {
    expect(card).toMatch(/bindtap="onOpenRegistration"/);
    expect(card).not.toMatch(/<button[^>]*>[\s\S]*<button/);
  });
  for (const button of wxml.match(/<button\b[^>]*>/g) ?? []) expect(button).toMatch(/bindtap="on[A-Za-z]+"/);
  expect(wxml).toMatch(/<scroll-view[^>]+scroll-y="true"[^>]+scroll-top="{{listScrollTop}}"[^>]+bindscroll="onScroll"/);
  expect(wxml).toMatch(/刷新失败[\s\S]*onRefresh/);
  expect(wxml).toMatch(/加载更多失败[\s\S]*onLoadMore/);
  expect(wxml).not.toMatch(/申请称呼|申请说明|审核人|其他申请人|手机号|微信号|订单|支付|成员名单/);
});
