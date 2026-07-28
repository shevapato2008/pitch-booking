import type {
  ConfirmedOrderView,
  PaymentLaunchParams,
  PaymentPendingOrderView,
} from "../domain/payment";

export const PAYMENT_PREVIEW_NOW = "2026-07-27T12:00:00+08:00";
const HOLD_DURATION_MS = 10 * 60_000;
const PAYMENT_EXPIRES_AT = new Date(
  new Date(PAYMENT_PREVIEW_NOW).getTime() + HOLD_DURATION_MS,
).toISOString();

const bookingSnapshot = () => ({
  orderId: "00000000-0000-4000-8000-000000000040",
  orderNumber: "PB202607270001",
  slotId: "00000000-0000-4000-8000-000000000030",
  venue: {
    id: "7e68d7d8-4b7e-4f04-a5c5-3fe263e69c6f",
    name: "浦东星跃足球公园",
    address: "上海市浦东新区锦绣东路 2777 弄 18 号",
    latitude: 31.245621,
    longitude: 121.623847,
    customerServicePhone: "+86-21-5899-2608",
  },
  pitch: {
    id: "59c91a73-b893-4c91-9084-4f43ab16d00a",
    name: "五人制 A 场",
  },
  contact: { name: "张三", maskedPhone: "138****5678" },
  priceCents: 32000,
  startsAt: "2026-07-28T19:00:00+08:00",
  endsAt: "2026-07-28T21:00:00+08:00",
  durationMinutes: 120,
  currency: "CNY" as const,
  createdAt: PAYMENT_PREVIEW_NOW,
  expiresAt: PAYMENT_EXPIRES_AT,
  expiredAt: null,
  cancellationSummary: "开场前 24 小时可免费取消；不足 24 小时取消将收取订单金额的 50%。",
  closingPayment: false,
  detailPath: "/api/v1/orders/00000000-0000-4000-8000-000000000040",
});

function deepFreezeOrder<T extends PaymentPendingOrderView | ConfirmedOrderView>(order: T): T {
  Object.freeze(order.venue);
  Object.freeze(order.pitch);
  Object.freeze(order.contact);
  return Object.freeze(order);
}

const launchParams: PaymentLaunchParams = Object.freeze({
  timeStamp: "1785146640",
  nonceStr: "payment-fixture-nonce",
  package: "prepay_id=payment-fixture-prepay",
  signType: "RSA",
  paySign: "payment-fixture-signature",
});

const pending: PaymentPendingOrderView = deepFreezeOrder({
  ...bookingSnapshot(),
  status: "PENDING_PAYMENT",
  paymentState: null,
  paymentConfirming: false,
  paidAt: null,
});

const confirming: PaymentPendingOrderView = deepFreezeOrder({
  ...bookingSnapshot(),
  status: "PENDING_PAYMENT",
  paymentState: "CONFIRMING",
  paymentConfirming: true,
  paidAt: null,
});

const confirmed: ConfirmedOrderView = deepFreezeOrder({
  ...bookingSnapshot(),
  status: "CONFIRMED",
  paymentState: "SUCCESS",
  paymentConfirming: false,
  paidAt: "2026-07-27T12:04:00+08:00",
});

export const PAYMENT_SCENARIOS = Object.freeze({ pending, confirming, confirmed, launchParams });

export type DevelopmentPaymentProjection = "pending" | "confirming" | "confirmed";
