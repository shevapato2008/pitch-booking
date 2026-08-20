import { expect, test } from "@jest/globals";

import type { OrderSummaryView } from "../domain/booking";
import { presentMyOrder } from "./my-orders";

const base: OrderSummaryView = {
  orderId: "00000000-0000-4000-8000-000000000056",
  orderNumber: "PB202608180001",
  status: "PENDING_PAYMENT",
  venue: { id: "7e68d7d8-4b7e-4f04-a5c5-3fe263e69c6f", name: "天津奥体足球场" },
  pitch: { id: "59c91a73-b893-4c91-9084-4f43ab16d00a", name: "七人制 A 场" },
  startsAt: "2026-08-20T19:00:00+08:00",
  endsAt: "2026-08-20T20:00:00+08:00",
  priceCents: 36050,
  currency: "CNY",
  createdAt: "2026-08-18T09:30:00+08:00",
  expiresAt: "2026-08-18T09:40:00+08:00",
  paymentConfirming: false,
  closingPayment: false,
};

test("presents trusted Shanghai schedule, exact amount, and existing detail route", () => {
  expect(presentMyOrder(base)).toMatchObject({
    schedule: "8月20日 周四 · 19:00–20:00",
    amount: "¥360.50",
    status: "pending",
    statusLabel: "待支付",
    detailRoute: `/pages/order-detail/index?order_id=${base.orderId}`,
  });
});

test.each([
  [{ ...base, cancelRequestedAt: "2026-08-18T10:00:00+08:00" }, "cancelling", "正在确认取消"],
  [{ ...base, status: "PAYMENT_EXCEPTION" as const, closingPayment: true, paymentConfirming: true }, "exception", "支付待确认"],
  [{ ...base, closingPayment: true, paymentConfirming: true }, "closing", "正在关闭"],
  [{ ...base, paymentConfirming: true }, "confirming", "支付确认中"],
  [{ ...base, status: "CONFIRMED" as const }, "confirmed", "预订成功"],
  [{ ...base, status: "EXPIRED" as const }, "expired", "已过期"],
  [{ ...base, status: "CANCELLED" as const }, "cancelled", "已取消"],
  [{ ...base, status: "REFUND_PENDING" as const }, "refund-pending", "退款处理中"],
  [{ ...base, status: "REFUND_FAILED" as const }, "refund-failed", "退款失败"],
  [{ ...base, status: "REFUNDED" as const }, "refunded", "已退款"],
  [{ ...base, status: "COMPLETED" as const }, "completed", "已完成"],
  [base, "pending", "待支付"],
] as const)("projects authoritative status priority to %s", (order, status, statusLabel) => {
  expect(presentMyOrder(order)).toMatchObject({ status, statusLabel });
});
