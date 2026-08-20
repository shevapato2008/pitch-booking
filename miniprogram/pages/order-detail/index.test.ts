/// <reference types="node" />

import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";

import type { ExpiredOrderView, LifecycleTerminalOrderView, PendingOrderView } from "../../domain/booking";
import type {
  PaymentCapability,
  PaymentCapabilityResult,
  PaymentDataSource,
  PaymentLaunchResult,
} from "../../domain/payment";
import { PAYMENT_PREVIEW_NOW, PAYMENT_SCENARIOS } from "../../dev/payment-scenarios";
import { AsyncGenerationGate } from "../../presentation/lifecycle";
import { registerBookingDataSource, resetBookingDataSourceForTesting, type BookingDataSource } from "../../services/booking";
import {
  registerPaymentCapability,
  registerPaymentClock,
  registerPaymentDataSource,
  resetPaymentBindingsForTesting,
} from "../../services/payment";

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

const pending: PendingOrderView = { orderId: "00000000-0000-4000-8000-000000000040", orderNumber: "PB209907280001", status: "PENDING_PAYMENT", slotId: "00000000-0000-4000-8000-000000000030", venue: { id: "venue", name: "滨江足球公园", address: "地址", latitude: 31, longitude: 121 }, pitch: { id: "pitch", name: "五人制 A 场" }, contact: { name: "张三", maskedPhone: "138****0000" }, priceCents: 36000, startsAt: "2099-07-28T19:00:00+08:00", endsAt: "2099-07-28T20:30:00+08:00", durationMinutes: 90, currency: "CNY", createdAt: "2099-07-28T18:00:00+08:00", expiresAt: "2099-07-28T18:10:00+08:00", expiredAt: null, cancellationSummary: "开场前 24 小时可取消", closingPayment: false, detailPath: "/api/v1/orders/00000000-0000-4000-8000-000000000040" };
const expiredFrom = (order: PendingOrderView, expiredAt: string): ExpiredOrderView => ({ ...order, status: "EXPIRED", expiredAt });
const completedFrom = (order: PendingOrderView): LifecycleTerminalOrderView => ({
  ...order,
  status: "COMPLETED",
  expiredAt: null,
  paymentState: "SUCCESS",
  paymentConfirming: false,
  paidAt: "2099-07-28T18:05:00+08:00",
});
const baseSource = (getOrder: BookingDataSource["getOrder"]): BookingDataSource => ({ async login() { throw new Error("unused"); }, async getCheckout() { throw new Error("unused"); }, async authorizePhone() { throw new Error("unused"); }, async createOrder() { throw new Error("unused"); }, getOrder });

beforeEach(() => {
  resetBookingDataSourceForTesting();
  resetPaymentBindingsForTesting();
});

function registerPaymentRuntime(input: {
  getOrder?: PaymentDataSource["getOrder"];
  createPayment?: PaymentDataSource["createPayment"];
  reconcilePayment?: PaymentDataSource["reconcilePayment"];
  requestPayment?: PaymentCapability["requestPayment"];
  cashierNotice?: string;
}) {
  const source: PaymentDataSource = {
    getOrder: input.getOrder ?? (async () => structuredClone(PAYMENT_SCENARIOS.pending)),
    createPayment: input.createPayment ?? (async () => ({
      outcome: "PREPAY_CREATED",
      paymentId: "payment-current",
      launchParams: { ...PAYMENT_SCENARIOS.launchParams },
    })),
    reconcilePayment: input.reconcilePayment ?? (async () => ({
      outcome: "PAYMENT_CONFIRMING",
      order: structuredClone(PAYMENT_SCENARIOS.confirming),
    })),
  };
  const capability: PaymentCapability = {
    requestPayment: input.requestPayment ?? (async () => ({ outcome: "cashier_success" })),
    ...(input.cashierNotice === undefined ? {} : { cashierNotice: input.cashierNotice }),
  };
  registerPaymentDataSource(source);
  registerPaymentCapability(capability);
  registerPaymentClock({ now: () => new Date(PAYMENT_PREVIEW_NOW) });
  return { source, capability };
}

describe("order detail lifecycle orchestration", () => {
  test("renders a completed order as read-only without payment actions", async () => {
    const completed = completedFrom(pending);
    registerBookingDataSource(baseSource(async () => completed));
    const page = loadPage();

    call(page, "onLoad", { order_id: pending.orderId });
    await flush();

    expect(page.data).toMatchObject({
      status: "completed",
      heroTitle: "订单已完成",
      heroCopy: "本次场地服务已完成。",
      showPaymentFooter: false,
      primaryDisabled: true,
    });
    call(page, "onUnload");
  });

  test("a terminal projection blocks a stale payment click", async () => {
    let createCalls = 0;
    registerPaymentRuntime({
      getOrder: async () => ({ ...pending, paymentState: null, paymentConfirming: false, paidAt: null }),
      createPayment: async () => {
        createCalls += 1;
        throw new Error("must not be called");
      },
    });
    const page = loadPage();
    call(page, "onLoad", { order_id: pending.orderId });
    await flush();
    expect(page.data.status).toBe("payment-pending");

    call(page, "applyPollState", { status: "completed", order: completedFrom(pending) });
    await call(page, "onPay");

    expect(page.data.status).toBe("completed");
    expect(createCalls).toBe(0);
    call(page, "onUnload");
  });

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

describe("order detail payment orchestration", () => {
  test("confirmed order detail does not expose a redundant footer action", async () => {
    registerPaymentRuntime({
      getOrder: async () => structuredClone(PAYMENT_SCENARIOS.confirmed),
    });
    const page = loadPage();

    call(page, "onLoad", { order_id: PAYMENT_SCENARIOS.confirmed.orderId });
    await flush();

    expect(page.data).toMatchObject({
      status: "booking-confirmed",
      primaryText: "",
      showPaymentFooter: false,
    });
    expect(readFileSync("miniprogram/pages/order-detail/index.wxml", "utf8")).not.toContain(
      "onViewBookingDetails",
    );
    call(page, "onUnload");
  });

  test("disabled online booking shows an honest unavailable state without a payment action", async () => {
    registerPaymentRuntime({});
    registerBookingDataSource(baseSource(async () => structuredClone(pending)));
    const page = loadPage();
    page.data.onlineBookingEnabled = false;

    call(page, "onLoad", { order_id: PAYMENT_SCENARIOS.pending.orderId });
    await flush();

    expect(page.data).toMatchObject({
      status: "payment-unavailable",
      heroTitle: "在线预订暂未开放",
      showPaymentFooter: false,
      primaryDisabled: true,
    });
    expect(readFileSync("miniprogram/pages/order-detail/index.wxml", "utf8")).toContain(
      "showPaymentFooter && onlineBookingEnabled",
    );
    call(page, "onUnload");
  });

  test("native template exposes the approved payment semantics without fake actions or branding", () => {
    const wxml = readFileSync("miniprogram/pages/order-detail/index.wxml", "utf8");
    const wxss = readFileSync("miniprogram/pages/order-detail/index.wxss", "utf8");

    for (const copy of [
      "待支付",
      "立即支付",
      "正在发起支付…",
      "正在确认支付",
      "支付结果以服务端确认为准，请勿重复付款",
      "支付确认中…",
      "重新查询",
      "预订成功",
      "已支付",
    ]) expect(wxml).toContain(copy);
    expect(wxml).not.toContain("查看预订详情");
    expect(wxml).toMatch(/disabled="\{\{primaryDisabled\}\}"/);
    expect(wxml).toMatch(/aria-label="支付成功"/);
    expect(wxml).not.toMatch(/客服.*电话|customerServicePhone/);
    expect(wxml).toContain("{{cashierNotice}}");
    expect(wxml).not.toContain("模拟支付，不会扣款");
    expect(wxml).not.toMatch(/取消订单|创建球局|微信支付/);
    expect(wxss).toMatch(/env\(safe-area-inset-bottom/);
    expect(wxss).toMatch(/padding-bottom:\s*calc\(/);
    expect(wxss).toMatch(/min-height:\s*88rpx/);
  });

  test("renders the simulated cashier notice only when the injected capability declares it", async () => {
    registerPaymentRuntime({ cashierNotice: "模拟支付，不会扣款" });
    const page = loadPage();
    call(page, "onLoad", { order_id: PAYMENT_SCENARIOS.pending.orderId });
    await flush();

    expect(page.data.cashierNotice).toBe("模拟支付，不会扣款");
    call(page, "onUnload");
  });

  test("renders the fixed ten-minute pending preview and exact payable CTA semantics", async () => {
    registerPaymentRuntime({});
    const page = loadPage();

    call(page, "onLoad", { order_id: PAYMENT_SCENARIOS.pending.orderId });
    await flush();

    expect(page.data).toMatchObject({
      status: "payment-pending",
      eyebrow: "待支付",
      heroTitle: "请在有效期内完成支付",
      countdown: "10:00",
      primaryText: "立即支付",
      primaryDisabled: false,
      showPaymentFooter: true,
    });
    call(page, "onUnload");
  });

  test("disables creating state synchronously and ignores duplicate pay taps", async () => {
    const pendingCreate = deferred<PaymentLaunchResult>();
    const createPayment = jest.fn<PaymentDataSource["createPayment"]>(() => pendingCreate.promise);
    registerPaymentRuntime({ createPayment });
    const page = loadPage();
    call(page, "onLoad", { order_id: PAYMENT_SCENARIOS.pending.orderId });
    await flush();

    const first = call(page, "onPay");
    const duplicate = call(page, "onPay");

    expect(page.data).toMatchObject({ status: "creating-prepay", primaryText: "正在发起支付…", primaryDisabled: true });
    expect(createPayment).toHaveBeenCalledTimes(1);
    pendingCreate.resolve({ outcome: "PAYMENT_CONFIRMING", paymentId: "payment-current" });
    await Promise.all([first, duplicate]);
    call(page, "onUnload");
  });

  test.each([
    [{ outcome: "user_cancelled" }, "", "payment-pending"],
    [{ outcome: "launch_failed", message: "模拟收银台调起失败" }, "模拟收银台调起失败", "payment-pending"],
  ] as const)("cashier result %s restores an honest retryable pending state", async (cashierResult, errorText, status) => {
    const requestPayment = jest.fn<PaymentCapability["requestPayment"]>(async () => cashierResult as PaymentCapabilityResult);
    const createPayment = jest.fn<PaymentDataSource["createPayment"]>(async () => ({
      outcome: "PREPAY_CREATED",
      paymentId: "payment-current",
      launchParams: { ...PAYMENT_SCENARIOS.launchParams },
    }));
    registerPaymentRuntime({ requestPayment, createPayment });
    const page = loadPage();
    call(page, "onLoad", { order_id: PAYMENT_SCENARIOS.pending.orderId });
    await flush();

    await call(page, "onPay");

    expect(page.data).toMatchObject({ status, primaryText: "立即支付", primaryDisabled: false, paymentError: errorText });
    await call(page, "onPay");
    expect(createPayment).toHaveBeenCalledTimes(2);
    const keys = createPayment.mock.calls.map((values) => values[1]);
    expect(keys[0]).not.toBe(keys[1]);
    call(page, "onUnload");
  });

  test("cashier success remains confirming until the data source returns authoritative confirmation", async () => {
    let reads = 0;
    registerPaymentRuntime({
      getOrder: async () => structuredClone(reads++ === 0 ? PAYMENT_SCENARIOS.pending : PAYMENT_SCENARIOS.confirming),
    });
    const page = loadPage();
    call(page, "onLoad", { order_id: PAYMENT_SCENARIOS.pending.orderId });
    await flush();

    await call(page, "onPay");
    await flush();

    expect(page.data).toMatchObject({
      status: "payment-confirming",
      heroTitle: "正在确认支付",
      primaryText: "支付确认中…",
      primaryDisabled: true,
    });
    expect((page.data.order as { status: string }).status).toBe("PENDING_PAYMENT");
    call(page, "onUnload");
  });

  test("runs pending through prepay, simulated cashier, 202 reconciliation, HTTP polling, and authoritative success", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(PAYMENT_PREVIEW_NOW));
    let reads = 0;
    const createPayment = jest.fn<PaymentDataSource["createPayment"]>(async () => ({
      outcome: "PREPAY_CREATED",
      paymentId: "payment-current",
      launchParams: { ...PAYMENT_SCENARIOS.launchParams },
    }));
    const reconcilePayment = jest.fn<PaymentDataSource["reconcilePayment"]>(async () => ({
      outcome: "PAYMENT_CONFIRMING",
      order: structuredClone(PAYMENT_SCENARIOS.confirming),
    }));
    registerPaymentRuntime({
      getOrder: async () => structuredClone(
        reads++ === 0
          ? PAYMENT_SCENARIOS.pending
          : reads === 2
            ? PAYMENT_SCENARIOS.confirming
            : PAYMENT_SCENARIOS.confirmed,
      ),
      createPayment,
      reconcilePayment,
    });
    const page = loadPage();
    call(page, "onLoad", { order_id: PAYMENT_SCENARIOS.pending.orderId });
    await flush();

    await call(page, "onPay");
    await flush();
    expect(page.data.status).toBe("payment-confirming");
    expect(reconcilePayment).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(2_000);
    await flush();
    expect(page.data).toMatchObject({ status: "booking-confirmed", heroTitle: "预订成功" });
    expect(createPayment.mock.calls[0]?.[1]).toMatch(/^payment-/);
    call(page, "onUnload");
    jest.useRealTimers();
  });

  test("reuses an idempotency key after an unknown create result but rotates it after a definitive cancellation", async () => {
    let creates = 0;
    const createPayment = jest.fn<PaymentDataSource["createPayment"]>(async () => {
      creates += 1;
      if (creates === 1) throw Object.assign(new Error("response lost"), { code: "PAYMENT_RESULT_UNKNOWN" });
      return {
        outcome: "PREPAY_CREATED",
        paymentId: "payment-current",
        launchParams: { ...PAYMENT_SCENARIOS.launchParams },
      };
    });
    registerPaymentRuntime({
      getOrder: async () => structuredClone(PAYMENT_SCENARIOS.pending),
      createPayment,
      requestPayment: async () => ({ outcome: "user_cancelled" }),
    });
    const page = loadPage();
    call(page, "onLoad", { order_id: PAYMENT_SCENARIOS.pending.orderId });
    await flush();

    await call(page, "onPay");
    expect(page.data).toMatchObject({ status: "payment-pending", primaryDisabled: false });
    await call(page, "onPay");
    await call(page, "onPay");

    const keys = createPayment.mock.calls.map((values) => values[1]);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[1]);
    call(page, "onUnload");
  });

  test("projects EXPIRED returned by reconciliation immediately instead of leaving payment confirming", async () => {
    const expired = expiredFrom(PAYMENT_SCENARIOS.pending, PAYMENT_SCENARIOS.pending.expiresAt);
    registerPaymentRuntime({
      reconcilePayment: async () => ({ outcome: "TERMINAL", order: expired }),
    });
    const page = loadPage();
    call(page, "onLoad", { order_id: PAYMENT_SCENARIOS.pending.orderId });
    await flush();

    await call(page, "onPay");

    expect(page.data).toMatchObject({ status: "expired", heroTitle: "订单已过期", showReselect: true });
    call(page, "onUnload");
  });

  test("manual query from payment exception reconciles the known payment before accepting success", async () => {
    const reconcilePayment = jest.fn<PaymentDataSource["reconcilePayment"]>()
      .mockResolvedValueOnce({ outcome: "TERMINAL", order: structuredClone(PAYMENT_SCENARIOS.exception) })
      .mockResolvedValueOnce({ outcome: "TERMINAL", order: structuredClone(PAYMENT_SCENARIOS.confirmed) });
    registerPaymentRuntime({
      getOrder: async () => structuredClone(PAYMENT_SCENARIOS.pending),
      reconcilePayment,
    });
    const page = loadPage();
    call(page, "onLoad", { order_id: PAYMENT_SCENARIOS.pending.orderId });
    await flush();
    await call(page, "onPay");
    expect(page.data.status).toBe("payment-exception");

    await call(page, "onReconcilePayment");

    expect(reconcilePayment).toHaveBeenCalledTimes(2);
    expect(page.data.status).toBe("booking-confirmed");
    call(page, "onUnload");
  });

  test("ignores a stale manual 202 after a newer authoritative CONFIRMED projection", async () => {
    const stale = deferred<Awaited<ReturnType<PaymentDataSource["reconcilePayment"]>>>();
    const reconcilePayment = jest.fn<PaymentDataSource["reconcilePayment"]>()
      .mockResolvedValueOnce({ outcome: "TERMINAL", order: structuredClone(PAYMENT_SCENARIOS.exception) })
      .mockImplementationOnce(() => stale.promise);
    registerPaymentRuntime({
      getOrder: async () => structuredClone(PAYMENT_SCENARIOS.pending),
      reconcilePayment,
    });
    const page = loadPage();
    call(page, "onLoad", { order_id: PAYMENT_SCENARIOS.pending.orderId });
    await flush();
    await call(page, "onPay");

    const manual = call(page, "onReconcilePayment") as Promise<void>;
    await flush();
    call(page, "applyPollState", {
      status: "booking-confirmed",
      order: structuredClone(PAYMENT_SCENARIOS.confirmed),
    });
    call(page, "applyPollState", { status: "loading" });
    stale.resolve({ outcome: "PAYMENT_CONFIRMING", order: structuredClone(PAYMENT_SCENARIOS.confirming) });
    await manual;

    expect(page.data.status).toBe("booking-confirmed");
    expect((page.data.order as { status: string }).status).toBe("CONFIRMED");
    call(page, "onUnload");
  });

  test("serializes double manual taps into one reconciliation request", async () => {
    const manualResult = deferred<Awaited<ReturnType<PaymentDataSource["reconcilePayment"]>>>();
    const reconcilePayment = jest.fn<PaymentDataSource["reconcilePayment"]>()
      .mockResolvedValueOnce({ outcome: "TERMINAL", order: structuredClone(PAYMENT_SCENARIOS.exception) })
      .mockImplementation(() => manualResult.promise);
    registerPaymentRuntime({
      getOrder: async () => structuredClone(PAYMENT_SCENARIOS.pending),
      reconcilePayment,
    });
    const page = loadPage();
    call(page, "onLoad", { order_id: PAYMENT_SCENARIOS.pending.orderId });
    await flush();
    await call(page, "onPay");

    const first = call(page, "onReconcilePayment") as Promise<void>;
    const second = call(page, "onReconcilePayment") as Promise<void>;
    await flush();
    expect(reconcilePayment).toHaveBeenCalledTimes(2);
    manualResult.resolve({ outcome: "TERMINAL", order: structuredClone(PAYMENT_SCENARIOS.confirmed) });
    await Promise.all([first, second]);

    expect(page.data.status).toBe("booking-confirmed");
    call(page, "onUnload");
  });

  test("cancels an older poll read before manual reconciliation projects CONFIRMED", async () => {
    const stalePoll = deferred<typeof PAYMENT_SCENARIOS.confirming>();
    let reads = 0;
    const reconcilePayment = jest.fn<PaymentDataSource["reconcilePayment"]>()
      .mockResolvedValueOnce({ outcome: "TERMINAL", order: structuredClone(PAYMENT_SCENARIOS.exception) })
      .mockResolvedValueOnce({ outcome: "TERMINAL", order: structuredClone(PAYMENT_SCENARIOS.confirmed) });
    registerPaymentRuntime({
      getOrder: async () => {
        reads += 1;
        if (reads === 1) return structuredClone(PAYMENT_SCENARIOS.pending);
        return stalePoll.promise;
      },
      reconcilePayment,
    });
    const page = loadPage();
    call(page, "onLoad", { order_id: PAYMENT_SCENARIOS.pending.orderId });
    await flush();
    await call(page, "onPay");
    (call(page, "ensurePoller") as { reconcile(): void }).reconcile();
    await flush();

    await call(page, "onReconcilePayment");
    stalePoll.resolve(structuredClone(PAYMENT_SCENARIOS.confirming));
    await flush();

    expect(page.data.status).toBe("booking-confirmed");
    expect((page.data.order as { status: string }).status).toBe("CONFIRMED");
    call(page, "onUnload");
  });

  test.each([
    ["expired", {
      status: "expired",
      order: expiredFrom(PAYMENT_SCENARIOS.pending, PAYMENT_SCENARIOS.pending.expiresAt),
    }],
    ["closing-payment", { status: "closing-payment", order: { ...PAYMENT_SCENARIOS.pending, closingPayment: true } }],
  ] as const)("clears every payment-only field when confirming becomes %s", async (status, nextState) => {
    registerPaymentRuntime({
      getOrder: async () => structuredClone(PAYMENT_SCENARIOS.confirming),
    });
    const page = loadPage();
    call(page, "onLoad", { order_id: PAYMENT_SCENARIOS.pending.orderId });
    await flush();
    expect(page.data.showProgressIcon).toBe(true);
    page.setData({
      eyebrow: "待支付",
      showCashierMarker: true,
      cashierNotice: "旧提示",
      paidLabel: "已支付",
      paymentError: "旧错误",
    });

    call(page, "applyPollState", structuredClone(nextState));

    expect(page.data).toMatchObject({
      status,
      eyebrow: "",
      heroCopy: "",
      primaryText: "",
      primaryDisabled: true,
      showPaymentFooter: false,
      showPaymentRetry: false,
      showCashierMarker: false,
      cashierNotice: "",
      showProgressIcon: false,
      showSuccessIcon: false,
      paidLabel: "",
      paymentError: "",
    });
    call(page, "onUnload");
  });

  test("a pending countdown callback cannot regress cashier success while reconciliation is in flight", async () => {
    jest.useFakeTimers();
    const reconciliation = deferred<Awaited<ReturnType<PaymentDataSource["reconcilePayment"]>>>();
    registerPaymentRuntime({
      getOrder: async () => structuredClone(PAYMENT_SCENARIOS.pending),
      reconcilePayment: () => reconciliation.promise,
    });
    const page = loadPage();
    call(page, "onLoad", { order_id: PAYMENT_SCENARIOS.pending.orderId });
    await flush();

    const payment = call(page, "onPay") as Promise<void>;
    await flush();
    expect(page.data.status).toBe("payment-confirming");

    jest.advanceTimersByTime(1_000);
    await flush();
    const statusAfterOldPendingTick = page.data.status;

    reconciliation.resolve({
      outcome: "PAYMENT_CONFIRMING",
      order: structuredClone(PAYMENT_SCENARIOS.confirming),
    });
    await payment;
    expect(statusAfterOldPendingTick).toBe("payment-confirming");
    call(page, "onUnload");
    jest.useRealTimers();
  });

  test.each([
    [PAYMENT_SCENARIOS.confirmed, "booking-confirmed", "预订成功"],
    [PAYMENT_SCENARIOS.exception, "payment-exception", "支付状态待确认"],
  ] as const)("renders %s only from an authoritative terminal reconciliation", async (order, status, heroTitle) => {
    registerPaymentRuntime({
      reconcilePayment: async () => ({ outcome: "TERMINAL", order: structuredClone(order) }),
    });
    const page = loadPage();
    call(page, "onLoad", { order_id: PAYMENT_SCENARIOS.pending.orderId });
    await flush();

    await call(page, "onPay");

    expect(page.data).toMatchObject({ status, heroTitle });
    if (status === "booking-confirmed") {
      expect(page.data).toMatchObject({
        paidLabel: "已支付",
        primaryText: "",
        primaryDisabled: false,
        showPaymentFooter: false,
      });
    } else {
      expect(page.data).toMatchObject({ primaryText: "重新查询", primaryDisabled: false });
    }
    call(page, "onUnload");
  });

  test("hide invalidates a late create result, clears timers, and show immediately refreshes", async () => {
    jest.useFakeTimers();
    const pendingCreate = deferred<PaymentLaunchResult>();
    let reads = 0;
    const requestPayment = jest.fn<PaymentCapability["requestPayment"]>(async () => ({ outcome: "cashier_success" }));
    registerPaymentRuntime({
      getOrder: async () => { reads += 1; return structuredClone(PAYMENT_SCENARIOS.pending); },
      createPayment: () => pendingCreate.promise,
      requestPayment,
    });
    const page = loadPage();
    call(page, "onLoad", { order_id: PAYMENT_SCENARIOS.pending.orderId });
    await flush();
    void call(page, "onPay");
    call(page, "onHide");
    expect(jest.getTimerCount()).toBe(0);

    pendingCreate.resolve({
      outcome: "PREPAY_CREATED",
      paymentId: "payment-current",
      launchParams: { ...PAYMENT_SCENARIOS.launchParams },
    });
    await flush();
    expect(requestPayment).not.toHaveBeenCalled();

    call(page, "onShow");
    await flush();
    expect(reads).toBe(2);
    expect(page.data.status).toBe("payment-pending");
    call(page, "onUnload");
    jest.useRealTimers();
  });
});
