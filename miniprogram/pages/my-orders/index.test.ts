/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */

import { beforeEach, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";

import type { OrderListView, OrderSummaryView } from "../../domain/booking";
import { registerBookingDataSource, resetBookingDataSourceForTesting } from "../../services/booking";

type RuntimePage = Record<string, any> & {
  data: Record<string, any>;
  setData(patch: Record<string, unknown>): void;
};

let definition: Record<string, any> | undefined;

function page(): RuntimePage {
  if (!definition) {
    (globalThis as any).Page = (value: Record<string, any>) => { definition = value; };
    jest.requireActual("./index");
  }
  return {
    ...definition,
    data: { ...definition!.data, orders: [...definition!.data.orders] },
    requestRevision: 0,
    alive: true,
    setData(patch) { Object.assign(this.data, patch); },
  } as RuntimePage;
}

const firstOrder: OrderSummaryView = {
  orderId: "00000000-0000-4000-8000-000000000056",
  orderNumber: "PB202608180001",
  status: "PENDING_PAYMENT",
  venue: { id: "7e68d7d8-4b7e-4f04-a5c5-3fe263e69c6f", name: "天津奥体足球场" },
  pitch: { id: "59c91a73-b893-4c91-9084-4f43ab16d00a", name: "七人制 A 场" },
  startsAt: "2026-08-20T19:00:00+08:00",
  endsAt: "2026-08-20T20:00:00+08:00",
  priceCents: 36000,
  currency: "CNY",
  createdAt: "2026-08-18T09:30:00+08:00",
  expiresAt: "2026-08-18T09:40:00+08:00",
  paymentConfirming: false,
  closingPayment: false,
};
const secondOrder = { ...firstOrder, orderId: "00000000-0000-4000-8000-000000000057", orderNumber: "PB202608180002" };

const list = (orders: readonly OrderSummaryView[], nextCursor: string | null): OrderListView => ({ orders, nextCursor });
const call = (target: RuntimePage, method: string, ...args: unknown[]) => target[method].apply(target, args);

function registerListSource(listOrders: (cursor?: string, limit?: number) => Promise<OrderListView>) {
  registerBookingDataSource({ listOrders } as any);
}

beforeEach(() => {
  resetBookingDataSourceForTesting();
  (globalThis as any).wx = {
    navigateTo: jest.fn(), navigateBack: jest.fn(), reLaunch: jest.fn(), stopPullDownRefresh: jest.fn(),
  };
});

test("loads the first page and opens the matching existing order detail", async () => {
  registerListSource(async () => list([firstOrder], "next"));
  const target = page();

  await call(target, "onLoad");
  call(target, "onOpenOrder", { currentTarget: { dataset: { orderId: firstOrder.orderId } } });

  expect(target.data).toMatchObject({ loading: false, errorText: "", nextCursor: "next", end: false });
  expect(target.data.orders[0]).toMatchObject({ statusLabel: "待支付", amount: "¥360" });
  expect(wx.navigateTo).toHaveBeenCalledWith({
    url: `/pages/order-detail/index?order_id=${firstOrder.orderId}`,
  });
});

test("empty state returns to the map with a relaunch fallback", async () => {
  registerListSource(async () => list([], null));
  const target = page();
  await call(target, "onLoad");

  call(target, "onGoSelectVenue");

  expect(wx.navigateBack).toHaveBeenCalledWith(expect.objectContaining({ delta: 1 }));
  const options = (wx.navigateBack as jest.Mock).mock.calls[0][0] as { fail(): void };
  options.fail();
  expect(wx.reLaunch).toHaveBeenCalledWith({ url: "/pages/venue-map/index" });
});

test("first-page error stays retryable instead of becoming an empty list", async () => {
  let calls = 0;
  registerListSource(async () => {
    calls += 1;
    if (calls === 1) throw new Error("offline");
    return list([firstOrder], null);
  });
  const target = page();

  await call(target, "onLoad");
  expect(target.data).toMatchObject({ errorText: "订单暂时无法加载", orders: [] });
  await call(target, "onRetry");
  expect(target.data).toMatchObject({ errorText: "", end: true });
  expect(target.data.orders).toHaveLength(1);
});

test("a refresh invalidates an older load-more response and always ends native refresh", async () => {
  const older = deferred<OrderListView>();
  const refreshed = deferred<OrderListView>();
  let calls = 0;
  registerListSource(async (cursor) => {
    calls += 1;
    if (calls === 1) return list([firstOrder], "next");
    return cursor ? older.promise : refreshed.promise;
  });
  const target = page();
  await call(target, "onLoad");

  const loadingMore = call(target, "onLoadMore");
  const refreshing = call(target, "onPullDownRefresh");
  refreshed.resolve(list([secondOrder], null));
  await refreshing;
  older.resolve(list([firstOrder, secondOrder], null));
  await loadingMore;

  expect(target.data.orders.map(({ orderId }: any) => orderId)).toEqual([secondOrder.orderId]);
  expect(wx.stopPullDownRefresh).toHaveBeenCalledTimes(1);
});

test("load-more failure keeps cards and retries the same cursor without duplicates", async () => {
  let moreCalls = 0;
  const listOrders = jest.fn(async (cursor?: string) => {
    if (!cursor) return list([firstOrder], "next");
    moreCalls += 1;
    if (moreCalls === 1) throw new Error("offline");
    return list([firstOrder, secondOrder], null);
  });
  registerListSource(listOrders);
  const target = page();
  await call(target, "onLoad");

  await call(target, "onLoadMore");
  expect(target.data).toMatchObject({ loadMoreError: true, loadingMore: false });
  expect(target.data.orders).toHaveLength(1);
  await call(target, "onRetryLoadMore");

  expect(listOrders.mock.calls.filter(([cursor]) => cursor === "next")).toHaveLength(2);
  expect(target.data.orders.map(({ orderId }: any) => orderId)).toEqual([firstOrder.orderId, secondOrder.orderId]);
  expect(target.data.end).toBe(true);
});

test("unload prevents a late first response from mutating page data", async () => {
  const pending = deferred<OrderListView>();
  registerListSource(async () => pending.promise);
  const target = page();
  const setData = jest.fn(target.setData.bind(target));
  target.setData = setData;

  const loading = call(target, "onLoad");
  call(target, "onUnload");
  const callsAfterUnload = setData.mock.calls.length;
  pending.resolve(list([firstOrder], null));
  await loading;

  expect(setData).toHaveBeenCalledTimes(callsAfterUnload);
  expect(target.data.orders).toEqual([]);
});

test("binds every visible action and enables native pull refresh", () => {
  const target = page();
  const template = readFileSync("miniprogram/pages/my-orders/index.wxml", "utf8");
  const config = readFileSync("miniprogram/pages/my-orders/index.json", "utf8");

  for (const [, attributes] of template.matchAll(/<button\b([^>]*)>/g)) {
    const handler = attributes.match(/(?:bindtap|catchtap)="([^"]+)"/)?.[1];
    expect(handler).toBeDefined();
    expect(typeof target[handler!]).toBe("function");
  }
  expect(config).toContain('"enablePullDownRefresh":true');
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
