import { describe, expect, test } from "@jest/globals";

import type { ExpiredOrderView, LifecycleTerminalOrderView, OrderView, PendingOrderView } from "../domain/booking";
import { PAYMENT_SCENARIOS } from "../dev/payment-scenarios";
import {
  OrderDetailPoller,
  presentOwnerOrderLifecycle,
  presentOrderDetailStatus,
  type OrderDetailPollState,
  type PollScheduler,
} from "./order-detail";

const ownerLifecycleOrder = (overrides: Record<string, unknown> = {}) => ({
  orderId: "00000000-0000-4000-8000-000000000040",
  status: "CONFIRMED",
  paymentState: "SUCCESS",
  cancelRequestedAt: null,
  allowedActions: {
    canPay: false,
    canCancel: true,
    canCheckIn: false,
    canComplete: false,
    canRefund: false,
    blockedReason: null,
  },
  ...overrides,
} as never);

describe("owner order lifecycle presentation", () => {
  test("keeps server-authorized pay and unpaid cancellation as separate actions", () => {
    expect(presentOwnerOrderLifecycle(ownerLifecycleOrder({
      status: "PENDING_PAYMENT",
      allowedActions: {
        canPay: true,
        canCancel: true,
        canCheckIn: false,
        canComplete: false,
        canRefund: false,
        blockedReason: null,
      },
    }))).toMatchObject({
      showPayAction: true,
      cancelAction: {
        label: "取消订单",
        title: "确认取消订单？",
        content: "若尚未付款，取消成功后将释放当前场次。",
      },
    });
  });

  test("does not infer payment permission when the server disables it", () => {
    expect(presentOwnerOrderLifecycle(ownerLifecycleOrder({
      status: "PENDING_PAYMENT",
      allowedActions: {
        canPay: false,
        canCancel: true,
        canCheckIn: false,
        canComplete: false,
        canRefund: false,
        blockedReason: null,
      },
    }))).toMatchObject({ showPayAction: false, cancelAction: { label: "取消订单" } });
  });

  test.each([
    ["CONFIRMED", "取消并发起全额退款", "确认取消并发起退款？", "将提交一笔全额退款申请，结果以服务端为准。"],
    ["REFUND_FAILED", "重试退款", "重试退款？", "将继续处理同一笔全额退款，不会重复扣款。"],
  ] as const)("presents the server-authorized %s destructive action", (status, label, title, content) => {
    expect(presentOwnerOrderLifecycle(ownerLifecycleOrder({ status }))).toMatchObject({
      cancelAction: { label, title, content },
    });
  });

  test("does not offer a refund action for a non-funding confirmed reservation", () => {
    expect(presentOwnerOrderLifecycle(ownerLifecycleOrder({ paymentState: null }))).toMatchObject({
      heroTitle: "预订成功",
      showPayAction: false,
      cancelAction: null,
    });
  });

  test.each([
    ["PENDING_PAYMENT", "2026-08-18T12:00:00+08:00", "正在确认取消", true],
    ["REFUND_PENDING", "2026-08-18T12:00:00+08:00", "退款处理中", true],
    ["CANCELLED", "2026-08-18T12:00:00+08:00", "订单已取消", false],
    ["REFUNDED", "2026-08-18T12:00:00+08:00", "退款已完成", false],
    ["COMPLETED", null, "订单已完成", false],
  ] as const)("renders %s honestly without a destructive action", (status, cancelRequestedAt, heroTitle, shouldPoll) => {
    expect(presentOwnerOrderLifecycle(ownerLifecycleOrder({
      status,
      cancelRequestedAt,
      allowedActions: {
        canPay: false,
        canCancel: status === "REFUND_PENDING",
        canCheckIn: false,
        canComplete: false,
        canRefund: false,
        blockedReason: "ORDER_TERMINAL",
      },
    }))).toMatchObject({ heroTitle, shouldPoll, cancelAction: null, showPayAction: false });
  });
});

describe("order detail status presentation", () => {
  test("keeps closing-error visibly in closing with an explicit retry", () => {
    expect(presentOrderDetailStatus("closing-error")).toEqual({
      heroTitle: "正在关闭支付",
      showClosingMessage: true,
      showClosingRetry: true,
      showReselect: false,
    });
  });

  test("uses the exact expired copy and exposes the reselect exit", () => {
    expect(presentOrderDetailStatus("expired")).toEqual({
      heroTitle: "订单已过期",
      showClosingMessage: false,
      showClosingRetry: false,
      showReselect: true,
    });
  });

  test.each([
    ["payment-pending", "待支付", false],
    ["creating-prepay", "待支付", false],
    ["cashier-open", "待支付", false],
    ["payment-confirming", "正在确认支付", false],
    ["payment-exception", "支付状态待确认", true],
    ["booking-confirmed", "预订成功", false],
  ] as const)("presents %s with exact payment copy", (status, heroTitle, showPaymentRetry) => {
    expect(presentOrderDetailStatus(status)).toMatchObject({ heroTitle, showPaymentRetry });
  });
});

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

class ManualTime implements PollScheduler {
  private milliseconds: number;
  private nextId = 1;
  private readonly tasks = new Map<number, { due: number; callback: () => void }>();

  constructor(iso: string) {
    this.milliseconds = new Date(iso).getTime();
  }

  now = () => new Date(this.milliseconds);

  setTimeout(callback: () => void, delayMs: number): number {
    const id = this.nextId++;
    this.tasks.set(id, { due: this.milliseconds + delayMs, callback });
    return id;
  }

  clearTimeout(id: unknown): void {
    this.tasks.delete(id as number);
  }

  async advance(milliseconds: number): Promise<void> {
    const target = this.milliseconds + milliseconds;
    for (;;) {
      const next = [...this.tasks.entries()]
        .filter(([, task]) => task.due <= target)
        .sort((left, right) => left[1].due - right[1].due || left[0] - right[0])[0];
      if (!next) break;
      const [id, task] = next;
      this.tasks.delete(id);
      this.milliseconds = task.due;
      task.callback();
      await flush();
    }
    this.milliseconds = target;
    await flush();
  }

  get pendingTaskCount(): number {
    return this.tasks.size;
  }
}

const pending: PendingOrderView = {
  orderId: "00000000-0000-4000-8000-000000000040",
  orderNumber: "PB202607280001",
  status: "PENDING_PAYMENT",
  slotId: "00000000-0000-4000-8000-000000000030",
  venue: {
    id: "venue-1",
    name: "星河体育中心",
    address: "上海市浦东新区",
    latitude: 31,
    longitude: 121,
  },
  pitch: { id: "pitch-1", name: "5号场" },
  contact: { name: "张三", maskedPhone: "138****0000" },
  priceCents: 32000,
  startsAt: "2026-07-28T19:00:00+08:00",
  endsAt: "2026-07-28T21:00:00+08:00",
  durationMinutes: 120,
  currency: "CNY",
  createdAt: "2026-07-28T18:00:00+08:00",
  expiresAt: "2026-07-28T18:10:00+08:00",
  expiredAt: null,
  cancellationSummary: "开场前 24 小时可取消",
  closingPayment: false,
  detailPath: "/api/v1/orders/00000000-0000-4000-8000-000000000040",
};

const expired: ExpiredOrderView = {
  ...pending,
  status: "EXPIRED",
  expiredAt: "2026-07-28T18:10:01+08:00",
};

describe("OrderDetailPoller", () => {
  test("keeps pending cancellation visible until a later authoritative read cancels it", async () => {
    const time = new ManualTime("2026-07-28T18:00:00+08:00");
    const cancelling = {
      ...pending,
      cancelRequestedAt: "2026-07-28T18:01:00+08:00",
      allowedActions: {
        canPay: false,
        canCancel: false,
        canCheckIn: false,
        canComplete: false,
        canRefund: false,
        blockedReason: "PAYMENT_RESULT_PENDING",
      },
    } as OrderView;
    const cancelled = {
      ...cancelling,
      status: "CANCELLED",
      paymentState: "CLOSED",
      paymentConfirming: false,
      paidAt: null,
      cancelledAt: "2026-07-28T18:01:02+08:00",
      allowedActions: {
        canPay: false,
        canCancel: false,
        canCheckIn: false,
        canComplete: false,
        canRefund: false,
        blockedReason: "ORDER_TERMINAL",
      },
    } as OrderView;
    const states: OrderDetailPollState[] = [];
    let calls = 0;
    const poller = new OrderDetailPoller({
      getOrder: async () => { calls += 1; return cancelled; },
      clock: { now: time.now },
      scheduler: time,
      onState: (state) => states.push(state),
    });

    poller.followOwnerLifecycle(cancelling);
    expect(states[states.length - 1]).toMatchObject({
      status: "cancellation-confirming",
      order: cancelling,
      showManualRefresh: false,
    });
    expect(calls).toBe(0);

    await time.advance(2_000);
    expect(calls).toBe(1);
    expect(states[states.length - 1]).toEqual({ status: "cancelled", order: cancelled });
  });

  test("bounds refund-pending polling and then exposes a real manual refresh", async () => {
    const time = new ManualTime("2026-07-28T18:00:00+08:00");
    const refundPending = {
      ...PAYMENT_SCENARIOS.confirmed,
      status: "REFUND_PENDING",
      cancelRequestedAt: "2026-07-28T18:01:00+08:00",
      cancelledAt: "2026-07-28T18:01:00+08:00",
      allowedActions: {
        canPay: false,
        canCancel: false,
        canCheckIn: false,
        canComplete: false,
        canRefund: false,
        blockedReason: "REFUND_IN_PROGRESS",
      },
    } as OrderView;
    const states: OrderDetailPollState[] = [];
    let calls = 0;
    const poller = new OrderDetailPoller({
      getOrder: async () => { calls += 1; return refundPending; },
      clock: { now: time.now },
      scheduler: time,
      onState: (state) => states.push(state),
    });

    poller.followOwnerLifecycle(refundPending);
    await time.advance(29_999);
    expect(calls).toBe(14);
    expect(states[states.length - 1]).toMatchObject({
      status: "refund-pending",
      showManualRefresh: false,
    });

    await time.advance(1);
    expect(states[states.length - 1]).toMatchObject({
      status: "refund-pending",
      showManualRefresh: true,
    });
    expect(time.pendingTaskCount).toBe(0);
  });

  test("keeps owner lifecycle manual refresh available after a failed authoritative read", async () => {
    const time = new ManualTime("2026-07-28T18:00:00+08:00");
    const refundPending = {
      ...PAYMENT_SCENARIOS.confirmed,
      status: "REFUND_PENDING",
      cancelRequestedAt: "2026-07-28T18:01:00+08:00",
      cancelledAt: "2026-07-28T18:01:00+08:00",
      allowedActions: {
        canPay: false,
        canCancel: false,
        canCheckIn: false,
        canComplete: false,
        canRefund: false,
        blockedReason: "REFUND_IN_PROGRESS",
      },
    } as OrderView;
    const states: OrderDetailPollState[] = [];
    const poller = new OrderDetailPoller({
      getOrder: async () => { throw new Error("offline"); },
      clock: { now: time.now },
      scheduler: time,
      onState: (state) => states.push(state),
    });

    poller.followOwnerLifecycle(refundPending);
    await time.advance(30_000);
    expect(states[states.length - 1]).toMatchObject({
      status: "refund-pending",
      showManualRefresh: true,
    });

    const statesBeforeRefresh = states.length;
    poller.reconcile();
    await flush();

    expect(states).toHaveLength(statesBeforeRefresh + 1);
    expect(states[states.length - 1]).toMatchObject({
      status: "refund-pending",
      showManualRefresh: true,
    });
  });

  test.each([
    ["CANCELLED", "cancelled"],
    ["REFUND_FAILED", "refund-failed"],
    ["REFUNDED", "refunded"],
    ["COMPLETED", "completed"],
  ] as const)("stops polling and presents lifecycle terminal status %s", async (orderStatus, stateStatus) => {
    const time = new ManualTime("2026-07-28T18:00:00+08:00");
    const states: OrderDetailPollState[] = [];
    const terminal = {
      ...pending,
      status: orderStatus,
      expiredAt: null,
      paymentState: orderStatus === "CANCELLED" ? "CLOSED" : "SUCCESS",
      paymentConfirming: false,
      closingPayment: false,
      paidAt: orderStatus === "CANCELLED" ? null : "2026-07-28T18:01:00+08:00",
    } as LifecycleTerminalOrderView;
    const poller = new OrderDetailPoller({
      getOrder: async () => terminal,
      clock: { now: time.now },
      scheduler: time,
      onState: (state) => states.push(state),
    });

    poller.start(pending.orderId);
    await flush();

    expect(states[states.length - 1]).toEqual({ status: stateStatus, order: terminal });
    expect(time.pendingTaskCount).toBe(0);
  });

  test("enters closing at the local deadline, polls every two seconds, and stops on EXPIRED", async () => {
    const time = new ManualTime("2026-07-28T18:09:50+08:00");
    const responses: OrderView[] = [pending, expired];
    const states: OrderDetailPollState[] = [];
    let calls = 0;
    const poller = new OrderDetailPoller({
      getOrder: async () => responses[calls++]!,
      clock: { now: time.now },
      scheduler: time,
      onState: (state) => states.push(state),
    });

    poller.start(pending.orderId);
    await flush();
    expect(states[states.length - 1]).toMatchObject({ status: "pending-payment", seconds: 10 });

    await time.advance(10_000);
    expect(states[states.length - 1]).toMatchObject({ status: "closing-payment" });
    expect(calls).toBe(1);

    await time.advance(1_999);
    expect(calls).toBe(1);
    await time.advance(1);
    expect(calls).toBe(2);
    expect(states[states.length - 1]).toEqual({ status: "expired", order: expired });
    expect(time.pendingTaskCount).toBe(0);
  });

  test("closingPayment from the server enters closing immediately even before expiresAt", async () => {
    const time = new ManualTime("2026-07-28T18:00:00+08:00");
    const states: OrderDetailPollState[] = [];
    const poller = new OrderDetailPoller({
      getOrder: async () => ({ ...pending, closingPayment: true }),
      clock: { now: time.now },
      scheduler: time,
      onState: (state) => states.push(state),
    });

    poller.start(pending.orderId);
    await flush();

    expect(states[states.length - 1]).toMatchObject({ status: "closing-payment" });
  });

  test("keeps retrying transient closing reads and exposes a retryable error at 30 seconds", async () => {
    const time = new ManualTime("2026-07-28T18:10:00+08:00");
    const states: OrderDetailPollState[] = [];
    let calls = 0;
    const poller = new OrderDetailPoller({
      getOrder: async () => {
        calls += 1;
        if (calls === 1) return { ...pending, expiresAt: time.now().toISOString() };
        throw new Error("temporary network failure");
      },
      clock: { now: time.now },
      scheduler: time,
      onState: (state) => states.push(state),
    });

    poller.start(pending.orderId);
    await flush();
    await time.advance(29_999);
    expect(states[states.length - 1]?.status).toBe("closing-payment");
    expect(calls).toBeGreaterThan(10);

    await time.advance(1);
    expect(states[states.length - 1]).toEqual({
      status: "closing-error",
      message: "订单关闭处理中，请稍后重试。",
      retryable: true,
    });
    expect(time.pendingTaskCount).toBe(0);
  });

  test("cancel invalidates a late request and clears every scheduled task", async () => {
    const time = new ManualTime("2026-07-28T18:00:00+08:00");
    let resolve!: (order: OrderView) => void;
    const response = new Promise<OrderView>((done) => { resolve = done; });
    const states: OrderDetailPollState[] = [];
    const poller = new OrderDetailPoller({
      getOrder: () => response,
      clock: { now: time.now },
      scheduler: time,
      onState: (state) => states.push(state),
    });

    poller.start(pending.orderId);
    poller.cancel();
    resolve(pending);
    await flush();

    expect(states).toEqual([{ status: "loading" }]);
    expect(time.pendingTaskCount).toBe(0);
  });

  test("polls confirming every two seconds for thirty seconds then keeps confirming with manual query", async () => {
    const time = new ManualTime(PAYMENT_SCENARIOS.pending.createdAt);
    const states: OrderDetailPollState[] = [];
    let calls = 0;
    const poller = new OrderDetailPoller({
      getOrder: async () => {
        calls += 1;
        return structuredClone(PAYMENT_SCENARIOS.confirming);
      },
      clock: { now: time.now },
      scheduler: time,
      onState: (state) => states.push(state),
    });

    poller.start(PAYMENT_SCENARIOS.pending.orderId);
    await flush();
    expect(states[states.length - 1]).toMatchObject({ status: "payment-confirming", showManualReconcile: false });

    await time.advance(29_999);
    expect(calls).toBe(15);
    expect(states[states.length - 1]).toMatchObject({ status: "payment-confirming", showManualReconcile: false });

    await time.advance(1);
    expect(calls).toBe(15);
    expect(states[states.length - 1]).toMatchObject({ status: "payment-confirming", showManualReconcile: true });
    expect(time.pendingTaskCount).toBe(0);
  });

  test("manual reconcile immediately refreshes a slow confirmation and accepts only authoritative success", async () => {
    const time = new ManualTime(PAYMENT_SCENARIOS.pending.createdAt);
    const states: OrderDetailPollState[] = [];
    let confirmed = false;
    const poller = new OrderDetailPoller({
      getOrder: async () => structuredClone(confirmed ? PAYMENT_SCENARIOS.confirmed : PAYMENT_SCENARIOS.confirming),
      clock: { now: time.now },
      scheduler: time,
      onState: (state) => states.push(state),
    });

    poller.start(PAYMENT_SCENARIOS.pending.orderId);
    await flush();
    await time.advance(30_000);
    confirmed = true;
    poller.reconcile();
    await flush();

    expect(states[states.length - 1]).toEqual({ status: "booking-confirmed", order: PAYMENT_SCENARIOS.confirmed });
    expect(time.pendingTaskCount).toBe(0);
  });

  test("renders payment exception only when the data source returns it explicitly", async () => {
    const time = new ManualTime(PAYMENT_SCENARIOS.pending.createdAt);
    const states: OrderDetailPollState[] = [];
    const poller = new OrderDetailPoller({
      getOrder: async () => structuredClone(PAYMENT_SCENARIOS.exception),
      clock: { now: time.now },
      scheduler: time,
      onState: (state) => states.push(state),
    });

    poller.start(PAYMENT_SCENARIOS.pending.orderId);
    await flush();

    expect(states[states.length - 1]).toEqual({ status: "payment-exception", order: PAYMENT_SCENARIOS.exception });
    expect(time.pendingTaskCount).toBe(0);
  });
});
