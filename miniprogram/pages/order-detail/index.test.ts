import { beforeEach, describe, expect, jest, test } from "@jest/globals";

import type { ExpiredOrderView, PendingOrderView } from "../../domain/booking";
import { AsyncGenerationGate } from "../../presentation/lifecycle";
import { registerBookingDataSource, resetBookingDataSourceForTesting, type BookingDataSource } from "../../services/booking";

type PageDefinition = Record<string, unknown> & { data: Record<string, unknown> };
type RuntimePage = PageDefinition & { setData(patch: Record<string, unknown>): void };
const deferred = <T>() => { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
const call = (page: RuntimePage, method: string, ...args: unknown[]) => (page[method] as (...values: unknown[]) => unknown).apply(page, args);

let capturedDefinition: PageDefinition | undefined;
function loadPage(): RuntimePage {
  let definition = capturedDefinition;
  if (!definition) { (globalThis as unknown as { Page(value: PageDefinition): void }).Page = (value) => { capturedDefinition = value; }; jest.requireActual("./index"); definition = capturedDefinition; }
  if (!definition) throw new Error("PAGE_NOT_CAPTURED");
  const page = { ...definition, loadGate: new AsyncGenerationGate(), closingGate: new AsyncGenerationGate(), poller: undefined, data: { ...definition.data }, setData(patch: Record<string, unknown>) { Object.assign(this.data, patch); } } as RuntimePage;
  return page;
}

const pending: PendingOrderView = { orderId: "00000000-0000-4000-8000-000000000040", orderNumber: "PB209907280001", status: "PENDING_PAYMENT", slotId: "00000000-0000-4000-8000-000000000030", venue: { id: "venue", name: "滨江足球公园", address: "地址", latitude: 31, longitude: 121, customerServicePhone: "021-12345678" }, pitch: { id: "pitch", name: "五人制 A 场" }, contact: { name: "张三", maskedPhone: "138****0000" }, priceCents: 36000, startsAt: "2099-07-28T19:00:00+08:00", endsAt: "2099-07-28T20:30:00+08:00", durationMinutes: 90, currency: "CNY", createdAt: "2099-07-28T18:00:00+08:00", expiresAt: "2099-07-28T18:10:00+08:00", expiredAt: null, cancellationSummary: "开场前 24 小时可取消", closingPayment: false, detailPath: "/api/v1/orders/00000000-0000-4000-8000-000000000040" };
const expiredFrom = (order: PendingOrderView, expiredAt: string): ExpiredOrderView => ({ ...order, status: "EXPIRED", expiredAt });
const baseSource = (getOrder: BookingDataSource["getOrder"]): BookingDataSource => ({ async login() { throw new Error("unused"); }, async getCheckout() { throw new Error("unused"); }, async authorizePhone() { throw new Error("unused"); }, async createOrder() { throw new Error("unused"); }, getOrder });

beforeEach(() => { resetBookingDataSourceForTesting(); });

describe("order detail lifecycle orchestration", () => {
  test("onShow replaces a hidden initial request and stale pending cannot overwrite newer expired", async () => {
    const first = deferred<PendingOrderView>();
    const expired = expiredFrom(pending, "2026-07-27T10:00:00.000Z");
    const second = deferred<typeof expired>();
    let calls = 0;
    registerBookingDataSource(baseSource(() => (++calls === 1 ? first.promise : second.promise)));
    const page = loadPage();
    call(page, "onLoad", { order_id: pending.orderId });
    call(page, "onHide");
    call(page, "onShow");
    expect(calls).toBe(2);
    second.resolve(expired); await flush();
    first.resolve(pending); await flush();
    expect(page.data.status).toBe("expired");
    expect(page.data.order).toEqual(expired);
    call(page, "onUnload");
  });

  test("invalid route never calls the source or exposes a retry path", () => {
    let calls = 0;
    registerBookingDataSource(baseSource(async () => { calls += 1; return pending; }));
    const page = loadPage();
    call(page, "onLoad", { order_id: "not-a-uuid" });
    call(page, "onRetryLoad");
    expect(page.data.status).toBe("route-error");
    expect(calls).toBe(0);
  });

  test("initial load error retries through loadOrder and restores pending countdown", async () => {
    let calls = 0;
    registerBookingDataSource(baseSource(async () => { calls += 1; if (calls === 1) throw new Error("offline"); return pending; }));
    const page = loadPage();
    call(page, "onLoad", { order_id: pending.orderId }); await flush();
    expect(page.data.status).toBe("load-error");
    call(page, "onRetryLoad"); await flush();
    expect(page.data.status).toBe("pending-payment");
    expect(page.data.venuePitchLabel).toBe("滨江足球公园 · 五人制 A 场");
    expect(page.data.timeLabel).toBe("19:00–20:30");
    expect(page.data).not.toHaveProperty("checkout");
    expect(calls).toBe(2);
    call(page, "onUnload");
  });

  test("server closingPayment enters closing immediately before the local deadline", async () => {
    registerBookingDataSource(baseSource(async () => ({ ...pending, closingPayment: true })));
    const page = loadPage();

    call(page, "onLoad", { order_id: pending.orderId });
    await flush();

    expect(page.data.status).toBe("closing-payment");
    call(page, "onUnload");
  });

  test.each(["pending", "expired"] as const)("hard deadline invalidates a hanging closing request with late %s", async (lateKind) => {
    jest.useFakeTimers(); jest.setSystemTime(new Date("2026-07-27T10:00:00.000Z"));
    const hanging = deferred<PendingOrderView | ExpiredOrderView>();
    const closing = { ...pending, expiresAt: "2026-07-27T09:59:59.000Z" };
    let calls = 0;
    registerBookingDataSource(baseSource(() => { calls += 1; return calls === 1 ? Promise.resolve(closing) : hanging.promise; }));
    const page = loadPage(); call(page, "onLoad", { order_id: pending.orderId }); await flush();
    jest.advanceTimersByTime(29_000); await flush();
    expect(calls).toBe(2);
    expect(page.data.status).toBe("closing-payment");
    jest.advanceTimersByTime(1_000); await flush();
    expect(page.data.status).toBe("closing-error");
    expect(page.data.heroTitle).toBe("正在关闭支付");
    expect(page.data.showClosingMessage).toBe(true);
    expect(page.data.showClosingRetry).toBe(true);
    const late = lateKind === "pending" ? pending : expiredFrom(pending, "2026-07-27T10:00:00.000Z");
    hanging.resolve(late); await flush();
    expect(page.data.status).toBe("closing-error");
    call(page, "onUnload"); jest.useRealTimers();
  });

  test("expired order uses exact copy and reselects availability without fake business data", async () => {
    const expired = expiredFrom(pending, "2026-07-27T10:00:00.000Z");
    registerBookingDataSource(baseSource(async () => expired));
    const urls: string[] = [];
    (globalThis as unknown as { wx: { redirectTo(input: { url: string }): Promise<void> } }).wx = {
      async redirectTo({ url }) { urls.push(url); },
    };
    const page = loadPage();
    call(page, "onLoad", { order_id: pending.orderId }); await flush();

    expect(page.data.heroTitle).toBe("订单已过期");
    expect(page.data.showReselect).toBe(true);
    await call(page, "onReselectSlot");

    expect(urls).toEqual(["/pages/availability/index"]);
    call(page, "onUnload");
  });

  test("reselect navigation rejection is handled and keeps the expired exit retryable", async () => {
    const expired = expiredFrom(pending, "2026-07-27T10:00:00.000Z");
    registerBookingDataSource(baseSource(async () => expired));
    (globalThis as unknown as { wx: { redirectTo(): Promise<void> } }).wx = {
      async redirectTo() { throw new Error("navigation failed"); },
    };
    const page = loadPage();
    call(page, "onLoad", { order_id: pending.orderId }); await flush();

    await expect(call(page, "onReselectSlot")).resolves.toBeUndefined();

    expect(page.data.showReselect).toBe(true);
    expect(page.data.navigationError).toBe("页面打开失败，请重试。");
    call(page, "onUnload");
  });
});
