/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any -- Mini Program Page harness */
import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";

import { decodeVenueFulfillmentOrder, decodeVenueFulfillmentPage, type VenueFulfillmentPage } from "../../domain/venue-fulfillment";
import { VenueFulfillmentApiError } from "../../services/http-venue-fulfillment";
import type { VenueFulfillmentAttemptStore } from "../../services/venue-fulfillment-attempt-store";
import { registerVenueFulfillmentAttemptStore, resetVenueFulfillmentAttemptStoreForTesting, VenueFulfillmentAttemptConflictError } from "../../services/venue-fulfillment-attempt-store";
import type { VenueFulfillmentDataSource, VenueFulfillmentMutationAttempt } from "../../services/venue-fulfillment";
import { registerVenueFulfillmentDataSource, resetVenueFulfillmentBindingsForTesting } from "../../services/venue-fulfillment";

type RuntimePage = Record<string, any> & { data: Record<string, any>; setData(patch: Record<string, unknown>): void };
let definition: Record<string, any> | undefined;
let stored: VenueFulfillmentMutationAttempt | null = null;
const response = decodeVenueFulfillmentPage(JSON.parse(readFileSync("contracts/examples/venue-fulfillment-orders.json", "utf8")));
const checkedIn = decodeVenueFulfillmentOrder(JSON.parse(readFileSync("contracts/examples/venue-order-checked-in.json", "utf8")));
const completed = decodeVenueFulfillmentOrder(JSON.parse(readFileSync("contracts/examples/venue-order-completed.json", "utf8")));
const checkable = { ...response, orders: [{ ...response.orders[0], allowedActions: { ...response.orders[0].allowedActions, canCheckIn: true, canRefund: false, blockedReason: null } }] };
const persistedCheckIn = { kind: "checkIn", venueId: response.venue.id, orderId: response.orders[0].orderId, idempotencyKey: "persisted-checkin-key-001" } as const;

const store: VenueFulfillmentAttemptStore = {
  load: jest.fn(() => stored),
  begin: jest.fn((attempt: VenueFulfillmentMutationAttempt): VenueFulfillmentMutationAttempt => { stored ??= structuredClone(attempt); if (JSON.stringify(stored) !== JSON.stringify(attempt)) throw new Error("conflict"); return structuredClone(stored as VenueFulfillmentMutationAttempt); }),
  clear: jest.fn(() => { stored = null; }),
};

function source(initial: VenueFulfillmentPage = response): jest.Mocked<VenueFulfillmentDataSource> {
  return {
    login: jest.fn(async () => undefined),
    listOrders: jest.fn(async () => initial),
    checkIn: jest.fn(async () => checkedIn),
    complete: jest.fn(async () => completed),
    refund: jest.fn(async (attempt) => ({ orderId: attempt.orderId, status: "REFUND_PENDING" })),
  };
}

function loadPage(): RuntimePage {
  if (!definition) {
    (globalThis as any).Page = (value: Record<string, any>) => { definition = value; };
    jest.requireActual("./index");
  }
  return {
    ...definition,
    data: structuredClone(definition!.data),
    requestRevision: 0,
    alive: true,
    authorityOrders: [],
    setData(patch: Record<string, unknown>) { Object.assign(this.data, patch); },
  } as RuntimePage;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  return { promise: new Promise<T>((done, fail) => { resolve = done; reject = fail; }), resolve, reject };
}

beforeEach(() => {
  resetVenueFulfillmentBindingsForTesting(); resetVenueFulfillmentAttemptStoreForTesting(); stored = null; jest.clearAllMocks(); registerVenueFulfillmentAttemptStore(store);
  (globalThis as any).wx = {
    getWindowInfo: jest.fn(() => ({ windowWidth: 375, statusBarHeight: 44 })),
    getMenuButtonBoundingClientRect: jest.fn(() => ({ top: 48, bottom: 80, left: 278, right: 365, width: 87, height: 32 })),
    showModal: jest.fn(({ success }: any) => success({ confirm: true, cancel: false })),
    navigateBack: jest.fn(), reLaunch: jest.fn(), stopPullDownRefresh: jest.fn(),
  };
});
afterEach(() => { jest.useRealTimers(); });

test("logs in, loads the default server date, and renders server-authoritative actions", async () => {
  const api = source(); registerVenueFulfillmentDataSource(api); const page = loadPage();
  await page.onLoad({ venue_id: response.venue.id });
  expect(api.login).toHaveBeenCalledTimes(1); expect(api.listOrders).toHaveBeenCalledWith(response.venue.id, undefined, undefined);
  expect(page.data).toMatchObject({ mode: "ready", venueName: response.venue.name, serviceDate: response.serviceDate, nextCursor: null });
  expect(page.data.orders[0]).toMatchObject({ canRefund: true, canCheckIn: false, canComplete: false });
});

test("selects a date seven days away with one request and ignores a stale success", async () => {
  const api = source(); const old = deferred<VenueFulfillmentPage>(); const current = { ...response, serviceDate: "2026-08-04" };
  api.listOrders.mockResolvedValueOnce(response).mockImplementationOnce(() => old.promise).mockResolvedValueOnce(current);
  registerVenueFulfillmentDataSource(api); const page = loadPage(); await page.onLoad({ venue_id: response.venue.id });
  const stale = page.onSelectDate({ detail: { date: "2026-07-27" } });
  const latest = page.onSelectDate({ detail: { date: "2026-08-04" } }); await latest;
  old.resolve({ ...response, serviceDate: "2026-07-27" }); await stale;
  expect(page.data.serviceDate).toBe("2026-08-04");
  expect(api.listOrders).toHaveBeenNthCalledWith(2, response.venue.id, "2026-07-27", undefined);
  expect(api.listOrders).toHaveBeenNthCalledWith(3, response.venue.id, "2026-08-04", undefined);
  expect(api.listOrders).toHaveBeenCalledTimes(3);
});

test("a stale failed date request cannot replace a newer successful page with read-error", async () => {
  const api = source(); const old = deferred<VenueFulfillmentPage>(); const current = { ...response, serviceDate: "2026-08-04" };
  void old.promise.catch(() => undefined);
  api.listOrders.mockResolvedValueOnce(response).mockImplementationOnce(() => old.promise).mockResolvedValueOnce(current);
  registerVenueFulfillmentDataSource(api); const page = loadPage(); await page.onLoad({ venue_id: response.venue.id });
  const stale = page.onSelectDate({ detail: { date: "2026-07-27" } });
  await page.onSelectDate({ detail: { date: "2026-08-04" } });
  old.reject(new Error("stale read")); await stale;

  expect(page.data).toMatchObject({ mode: "ready", serviceDate: "2026-08-04" });
});

test("a failed date selection keeps authority unchanged and retry requests the same target", async () => {
  const target = "2026-08-04";
  const api = source();
  api.listOrders.mockResolvedValueOnce(response).mockRejectedValueOnce(new Error("read")).mockResolvedValueOnce({ ...response, serviceDate: target });
  registerVenueFulfillmentDataSource(api); const page = loadPage(); await page.onLoad({ venue_id: response.venue.id });

  await page.onSelectDate({ detail: { date: target } });
  expect(page.data).toMatchObject({ mode: "read-error", serviceDate: response.serviceDate });
  expect(page.requestedServiceDate).toBe(target);
  await page.onRetry();

  expect(api.listOrders).toHaveBeenNthCalledWith(2, response.venue.id, target, undefined);
  expect(api.listOrders).toHaveBeenNthCalledWith(3, response.venue.id, target, undefined);
  expect(page.data).toMatchObject({ mode: "ready", serviceDate: target });
  expect(page.requestedServiceDate).toBe(target);
});

test("keeps loading, empty, read-error, refresh, pagination, and load-more-error distinct", async () => {
  const api = source({ ...response, orders: [], nextCursor: null }); registerVenueFulfillmentDataSource(api); const page = loadPage();
  const loading = page.onLoad({ venue_id: response.venue.id }); expect(page.data.mode).toBe("loading"); await loading; expect(page.data.mode).toBe("empty");
  api.listOrders.mockRejectedValueOnce(new Error("refresh")); await page.onPullDownRefresh(); expect(wx.stopPullDownRefresh).toHaveBeenCalledTimes(1); expect(page.data.refreshErrorText).toContain("刷新");
  api.listOrders.mockRejectedValueOnce(new Error("read")); await page.onRetry(); expect(page.data.mode).toBe("read-error");
  api.listOrders.mockResolvedValueOnce({ ...response, nextCursor: "next" }); await page.onRetry(); expect(page.data.mode).toBe("ready");
  api.listOrders.mockRejectedValueOnce(new Error("more")); await page.onLoadMore(); expect(page.data).toMatchObject({ mode: "ready", loadMoreError: true });
});

test("unload suppresses a late response", async () => {
  const api = source(); const pending = deferred<VenueFulfillmentPage>(); api.listOrders.mockImplementationOnce(() => pending.promise); registerVenueFulfillmentDataSource(api); const page = loadPage();
  const load = page.onLoad({ venue_id: response.venue.id }); page.onUnload(); pending.resolve(response); await load;
  expect(page.data.venueName).toBe("");
});

test("reload reconciles a persisted same-venue attempt and replays its original key only when unapplied", async () => {
  stored = structuredClone(persistedCheckIn); const api = source(checkable); registerVenueFulfillmentDataSource(api); const page = loadPage();
  await page.onLoad({ venue_id: response.venue.id });
  expect(page.data.unknownAttempt).toEqual(persistedCheckIn); expect(store.clear).not.toHaveBeenCalled();
  await page.onRetryUnknown(); expect(api.checkIn).toHaveBeenLastCalledWith(persistedCheckIn);

  stored = structuredClone(persistedCheckIn); jest.clearAllMocks(); const appliedApi = source({ ...response, orders: [checkedIn] }); registerVenueFulfillmentDataSource(appliedApi); const applied = loadPage();
  await applied.onLoad({ venue_id: response.venue.id });
  expect(applied.data.unknownAttempt).toBeNull(); expect(store.clear).toHaveBeenCalledTimes(1);
});

test("a persisted attempt for another venue is retained and blocks new writes", async () => {
  const foreign = { ...persistedCheckIn, venueId: "11111111-1111-4111-8111-111111111111" }; stored = structuredClone(foreign);
  const api = source(checkable); registerVenueFulfillmentDataSource(api); const page = loadPage(); await page.onLoad({ venue_id: response.venue.id });
  expect(page.data).toMatchObject({ foreignAttemptPending: true, unknownAttempt: null }); expect(store.clear).not.toHaveBeenCalled();
  await page.onCheckIn({ currentTarget: { dataset: { orderId: response.orders[0].orderId } } });
  expect(api.checkIn).not.toHaveBeenCalled(); expect(wx.showModal).not.toHaveBeenCalled(); expect(stored).toEqual(foreign);
});

test("an attempt-store begin conflict retains the older attempt", async () => {
  const old = structuredClone(persistedCheckIn); let loads = 0;
  const conflictStore: VenueFulfillmentAttemptStore = {
    load: jest.fn(() => (++loads === 1 ? null : old)),
    begin: jest.fn(() => { throw new VenueFulfillmentAttemptConflictError(); }),
    clear: jest.fn(),
  };
  registerVenueFulfillmentAttemptStore(conflictStore); const api = source(checkable); registerVenueFulfillmentDataSource(api); const page = loadPage(); await page.onLoad({ venue_id: response.venue.id });
  await page.onCheckIn({ currentTarget: { dataset: { orderId: response.orders[0].orderId } } });
  expect(conflictStore.clear).not.toHaveBeenCalled(); expect(page.data.unknownAttempt).toEqual(old); expect(api.checkIn).not.toHaveBeenCalled();
});

test("an awaited mutation never updates an unloaded page", async () => {
  const pending = deferred<typeof checkedIn>(); const api = source(checkable); api.checkIn.mockImplementationOnce(() => pending.promise); registerVenueFulfillmentDataSource(api); const page = loadPage(); await page.onLoad({ venue_id: response.venue.id });
  const mutation = page.onCheckIn({ currentTarget: { dataset: { orderId: response.orders[0].orderId } } }); await Promise.resolve();
  const replaceOrder = jest.spyOn(page, "replaceOrder"); const setData = jest.spyOn(page, "setData"); setData.mockClear(); page.onUnload(); pending.resolve(checkedIn); await mutation;
  expect(replaceOrder).not.toHaveBeenCalled(); expect(setData).not.toHaveBeenCalled();
});

test("check-in and completion require confirmation, persist one key, replace one card, and suppress duplicate taps", async () => {
  const api = source(checkable); const pending = deferred<typeof checkedIn>(); api.checkIn.mockImplementationOnce(() => pending.promise); registerVenueFulfillmentDataSource(api); const page = loadPage(); await page.onLoad({ venue_id: response.venue.id });
  const first = page.onCheckIn({ currentTarget: { dataset: { orderId: response.orders[0].orderId } } }); await Promise.resolve();
  const key = stored?.idempotencyKey; expect(key).toBeTruthy(); expect(page.data.mutatingOrderId).toBe(response.orders[0].orderId);
  await page.onCheckIn({ currentTarget: { dataset: { orderId: response.orders[0].orderId } } }); expect(api.checkIn).toHaveBeenCalledTimes(1);
  pending.resolve(checkedIn); await first; expect(api.checkIn).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: key })); expect(page.data.orders[0]).toMatchObject({ statusLabel: "待履约", canCheckIn: false });
  const completable = { ...checkedIn, allowedActions: { ...checkedIn.allowedActions, canComplete: true, blockedReason: null } };
  page.authorityOrders = [completable]; page.setData({ orders: [{ ...page.data.orders[0], canComplete: true }] }); await page.onComplete({ currentTarget: { dataset: { orderId: checkedIn.orderId } } });
  expect(api.complete).toHaveBeenCalledTimes(1); expect(wx.showModal).toHaveBeenCalledTimes(2); expect(page.data.orders[0].statusLabel).toBe("已完成");
});

test("refund requires a trimmed reason, preserves uncertain input, and refreshes authority after acceptance", async () => {
  const refunded = { ...response, orders: [{ ...response.orders[0], status: "REFUND_PENDING" as const, allowedActions: { ...response.orders[0].allowedActions, canRefund: false, blockedReason: "REFUND_IN_PROGRESS" as const } }] };
  const api = source(); api.listOrders.mockResolvedValueOnce(response).mockResolvedValueOnce(refunded); registerVenueFulfillmentDataSource(api); const page = loadPage(); await page.onLoad({ venue_id: response.venue.id });
  page.onOpenRefund({ currentTarget: { dataset: { orderId: response.orders[0].orderId } } }); page.onRefundReasonInput({ detail: { value: "   " } }); await page.onConfirmRefund(); expect(api.refund).not.toHaveBeenCalled(); expect(page.data.refundError).toContain("原因");
  page.onRefundReasonInput({ detail: { value: "  场地临时检修  " } }); await page.onConfirmRefund();
  expect(api.refund).toHaveBeenCalledWith(expect.objectContaining({ reason: "场地临时检修" })); expect(api.listOrders).toHaveBeenCalledTimes(2); expect(page.data.orders[0]).toMatchObject({ statusLabel: "退款处理中", canRefund: false });
});

test("unknown writes refresh authority first and replay the original attempt only when still unapplied", async () => {
  const api = source(checkable); api.checkIn.mockRejectedValueOnce(new VenueFulfillmentApiError("FULFILLMENT_RESULT_UNKNOWN")).mockResolvedValueOnce(checkedIn); api.listOrders.mockResolvedValueOnce(checkable).mockResolvedValueOnce(checkable);
  registerVenueFulfillmentDataSource(api); const page = loadPage(); await page.onLoad({ venue_id: response.venue.id }); await page.onCheckIn({ currentTarget: { dataset: { orderId: response.orders[0].orderId } } });
  const original = structuredClone(stored as Extract<VenueFulfillmentMutationAttempt, { kind: "checkIn" }>); expect(page.data.unknownAttempt).toMatchObject({ kind: "checkIn" });
  await page.onRetryUnknown(); expect(api.checkIn).toHaveBeenLastCalledWith(original); expect(page.data.unknownAttempt).toBeNull();

  stored = null; const appliedApi = source(checkable); appliedApi.checkIn.mockRejectedValueOnce(new VenueFulfillmentApiError("FULFILLMENT_RESULT_UNKNOWN")); appliedApi.listOrders.mockResolvedValueOnce(checkable).mockResolvedValueOnce({ ...checkable, orders: [checkedIn] }); registerVenueFulfillmentDataSource(appliedApi);
  const applied = loadPage(); await applied.onLoad({ venue_id: response.venue.id }); await applied.onCheckIn({ currentTarget: { dataset: { orderId: response.orders[0].orderId } } });
  expect(applied.data.unknownAttempt).toBeNull(); expect(store.clear).toHaveBeenCalled();
});

test("production markup exposes only allowed action buttons and every visible enabled control is bound", () => {
  const markup = readFileSync("miniprogram/pages/venue-fulfillment/index.wxml", "utf8");
  const styles = readFileSync("miniprogram/pages/venue-fulfillment/index.wxss", "utf8");
  const config = JSON.parse(readFileSync("miniprogram/pages/venue-fulfillment/index.json", "utf8"));
  expect(config.usingComponents).toEqual({ "date-strip": "/components/date-strip/index" });
  expect(markup).toMatch(/<date-strip\s+dates="\{\{dates\}\}"\s+selectedDate="\{\{serviceDate\}\}"\s+bind:select="onSelectDate"\s*\/>/);
  expect(markup).not.toMatch(/date-tabs|data-service-date/);
  expect(styles).not.toMatch(/\.date-tabs|\.date-tab/);
  expect(markup).toMatch(/wx:if="\{\{item\.canCheckIn\}\}"[^>]*bindtap="onCheckIn"/);
  expect(markup).toMatch(/wx:if="\{\{item\.canComplete\}\}"[^>]*bindtap="onComplete"/);
  expect(markup).toMatch(/wx:if="\{\{item\.canRefund\}\}"[^>]*bindtap="onOpenRefund"/);
  for (const handler of ["onBack", "onSelectDate", "onRetry", "onLoadMore", "onRetryLoadMore", "onCheckIn", "onComplete", "onOpenRefund", "onRefundReasonInput", "onCancelRefund", "onConfirmRefund", "onRetryUnknown"]) expect(markup).toContain(handler);
  expect(markup).not.toMatch(/disabled[^>]+bindtap="onBlocked|onFake|模拟成功/);
});

test("production route keeps real HTTP composition after preview cleanup", () => {
  const manifest = JSON.parse(readFileSync("miniprogram/app.json", "utf8"));
  const build = readFileSync("scripts/build-miniprogram.mjs", "utf8");
  const sourceText = readFileSync("miniprogram/pages/venue-fulfillment/index.ts", "utf8");

  expect(manifest.pages).toContain("pages/venue-fulfillment/index");
  for (const symbol of ["createHttpVenueFulfillmentDataSource", "registerVenueFulfillmentDataSource", "createVenueFulfillmentAttemptStore", "registerVenueFulfillmentAttemptStore"]) {
    expect(build).toMatch(new RegExp(`\\b${symbol}\\b`));
  }
  expect(sourceText).not.toMatch(/\/dev\/|VENUE_FULFILLMENT_FIXTURE/);
});
