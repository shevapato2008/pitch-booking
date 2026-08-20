import type {
  AllowedOrderActions,
  OrderSummaryView,
  OrderView,
} from "../domain/booking";
import type {
  CancelOrderAttempt,
  OrderListBookingDataSource,
} from "../services/booking";

export type OrderCancellationFixtureScenario =
  | "pending-cancellable"
  | "confirmed-cancellable"
  | "refund-failed";

export interface OrderCancellationFixtureSource extends OrderListBookingDataSource {
  readonly previewOrderId: string;
  cancelOrder(attempt: CancelOrderAttempt): Promise<OrderView>;
}

const PREVIEW_NOW = "2026-08-20T12:00:00+08:00";
const PAID_AT = "2026-08-20T11:55:00+08:00";
const STARTS_AT = "2026-08-23T19:00:00+08:00";
const ENDS_AT = "2026-08-23T21:00:00+08:00";
const EXPIRES_AT = "2099-08-20T12:10:00+08:00";
const REQUESTED_AT = "2026-08-20T12:01:00+08:00";
const CANCELLED_AT = "2026-08-20T12:01:02+08:00";

function actions(
  canPay: boolean,
  canCancel: boolean,
  blockedReason: AllowedOrderActions["blockedReason"] = null,
): AllowedOrderActions {
  return {
    canPay,
    canCancel,
    canCheckIn: false,
    canComplete: false,
    canRefund: false,
    blockedReason,
  };
}

function baseOrder(orderId: string, orderNumber: string) {
  return {
    orderId,
    orderNumber,
    slotId: "00000000-0000-4000-8000-000000000030",
    venue: {
      id: "7e68d7d8-4b7e-4f04-a5c5-3fe263e69c6f",
      name: "浦东星跃足球公园",
      address: "上海市浦东新区锦绣东路 2777 弄 18 号",
      latitude: 31.245621,
      longitude: 121.623847,
    },
    pitch: {
      id: "59c91a73-b893-4c91-9084-4f43ab16d00a",
      name: "五人制 A 场",
    },
    contact: { name: "张三", maskedPhone: "138****5678" },
    priceCents: 32000,
    startsAt: STARTS_AT,
    endsAt: ENDS_AT,
    durationMinutes: 120,
    currency: "CNY" as const,
    createdAt: PREVIEW_NOW,
    expiresAt: EXPIRES_AT,
    expiredAt: null,
    cancellationSummary: "开场前至少 24 小时可自助取消并全额退款；不足 24 小时请联系客服。",
    paymentConfirming: false as const,
    closingPayment: false,
    cancelRequestedAt: null,
    cancelledAt: null,
    checkedInAt: null,
    completedAt: null,
    fundingAlerts: [] as const,
    detailPath: `/api/v1/orders/${orderId}`,
  };
}

function pendingCancellable(): Extract<OrderView, { status: "PENDING_PAYMENT" }> {
  return deepFreeze({
    ...baseOrder("00000000-0000-4000-8000-000000000041", "PB202608200041"),
    status: "PENDING_PAYMENT" as const,
    paymentState: null,
    paidAt: null,
    allowedActions: actions(true, true),
  });
}

function confirmedCancellable(
  orderId = "00000000-0000-4000-8000-000000000042",
): Extract<OrderView, { status: "CONFIRMED" }> {
  return deepFreeze({
    ...baseOrder(orderId, `PB20260820${orderId.slice(-4)}`),
    status: "CONFIRMED" as const,
    paymentState: "SUCCESS" as const,
    paidAt: PAID_AT,
    allowedActions: actions(false, true),
  });
}

function cancellingFrom(order: OrderView): OrderView {
  if (order.status !== "PENDING_PAYMENT") throw new Error("ORDER_STATE_CHANGED");
  return deepFreeze({
    ...order,
    cancelRequestedAt: REQUESTED_AT,
    allowedActions: actions(false, false, "PAYMENT_RESULT_PENDING"),
  });
}

function cancelledFrom(order: OrderView): OrderView {
  if (order.status !== "PENDING_PAYMENT") throw new Error("ORDER_STATE_CHANGED");
  return deepFreeze({
    ...order,
    status: "CANCELLED" as const,
    paymentState: "CLOSED" as const,
    paymentConfirming: false as const,
    paidAt: null,
    cancelRequestedAt: order.cancelRequestedAt ?? REQUESTED_AT,
    cancelledAt: CANCELLED_AT,
    allowedActions: actions(false, false, "ORDER_TERMINAL"),
  });
}

function refundPendingFrom(order: OrderView): OrderView {
  if (order.status !== "CONFIRMED" && order.status !== "REFUND_FAILED") {
    throw new Error("ORDER_STATE_CHANGED");
  }
  return deepFreeze({
    ...order,
    status: "REFUND_PENDING" as const,
    paymentState: "SUCCESS" as const,
    paymentConfirming: false as const,
    paidAt: order.paidAt,
    cancelRequestedAt: order.cancelRequestedAt ?? REQUESTED_AT,
    cancelledAt: order.cancelledAt ?? REQUESTED_AT,
    allowedActions: actions(false, false, "REFUND_IN_PROGRESS"),
  });
}

function refundFailed(orderId = "00000000-0000-4000-8000-000000000045"): OrderView {
  const confirmed = confirmedCancellable(orderId);
  return deepFreeze({
    ...confirmed,
    status: "REFUND_FAILED" as const,
    cancelRequestedAt: REQUESTED_AT,
    cancelledAt: REQUESTED_AT,
    allowedActions: actions(false, true),
  });
}

function refunded(orderId = "00000000-0000-4000-8000-000000000044"): OrderView {
  const confirmed = confirmedCancellable(orderId);
  return deepFreeze({
    ...confirmed,
    status: "REFUNDED" as const,
    cancelRequestedAt: REQUESTED_AT,
    cancelledAt: REQUESTED_AT,
    allowedActions: actions(false, false, "ORDER_TERMINAL"),
  });
}

function summary(order: OrderView): OrderSummaryView {
  return deepFreeze({
    orderId: order.orderId,
    orderNumber: order.orderNumber,
    status: order.status,
    venue: { id: order.venue.id, name: order.venue.name },
    pitch: { id: order.pitch.id, name: order.pitch.name },
    startsAt: order.startsAt,
    endsAt: order.endsAt,
    priceCents: order.priceCents,
    currency: order.currency,
    createdAt: order.createdAt,
    expiresAt: order.expiresAt,
    paymentConfirming: order.paymentConfirming ?? false,
    closingPayment: order.closingPayment,
    cancelRequestedAt: order.cancelRequestedAt ?? null,
    cancelledAt: order.cancelledAt ?? null,
    checkedInAt: order.checkedInAt ?? null,
    completedAt: order.completedAt ?? null,
    allowedActions: order.allowedActions,
    fundingAlerts: order.fundingAlerts ?? [],
  });
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function outOfScope(): never {
  throw new Error("ORDER_CANCELLATION_PREVIEW_ONLY");
}

export function createOrderCancellationFixture(
  scenario: OrderCancellationFixtureScenario,
): OrderCancellationFixtureSource {
  let current = scenario === "pending-cancellable"
    ? pendingCancellable()
    : scenario === "confirmed-cancellable"
      ? confirmedCancellable()
      : refundFailed();
  let settlePendingOnRead = false;
  const responsesByKey = new Map<string, OrderView>();
  const mixedOrders = [
    refundPendingFrom(confirmedCancellable("00000000-0000-4000-8000-000000000043")),
    refunded(),
    refundFailed(),
  ];

  return {
    previewOrderId: current.orderId,
    async login() { return { userId: "00000000-0000-4000-8000-000000000001", maskedPhone: "138****5678" }; },
    async getCheckout() { return outOfScope(); },
    async authorizePhone() { return outOfScope(); },
    async createOrder() { return outOfScope(); },
    async getOrder(orderId) {
      if (orderId !== current.orderId) throw new Error("ORDER_NOT_FOUND");
      if (settlePendingOnRead) {
        settlePendingOnRead = false;
        current = cancelledFrom(current);
      }
      return current;
    },
    async listOrders() {
      return { orders: mixedOrders.map(summary), nextCursor: null };
    },
    async cancelOrder(attempt) {
      const replay = responsesByKey.get(attempt.idempotencyKey);
      if (replay) return replay;
      if (attempt.orderId !== current.orderId) throw new Error("ORDER_NOT_FOUND");
      if (!attempt.idempotencyKey) throw new Error("IDEMPOTENCY_KEY_REQUIRED");
      if (current.allowedActions?.canCancel !== true) throw new Error("ORDER_STATE_CHANGED");
      if (current.status === "PENDING_PAYMENT") {
        current = cancellingFrom(current);
        settlePendingOnRead = true;
      } else {
        current = refundPendingFrom(current);
      }
      responsesByKey.set(attempt.idempotencyKey, current);
      return current;
    },
  };
}
