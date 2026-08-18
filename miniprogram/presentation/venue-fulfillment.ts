import type {
  VenueFulfillmentBlockedReason,
  VenueFulfillmentOrder,
  VenueFulfillmentOrderStatus,
} from "../domain/venue-fulfillment";
import { formatShanghaiTimeRange } from "./shanghai-time";

export interface VenueServiceDateViewModel {
  readonly serviceDate: string;
  readonly weekday: string;
  readonly day: string;
  readonly selected: boolean;
}

export interface VenueFulfillmentOrderViewModel {
  readonly orderId: string;
  readonly number: string;
  readonly time: string;
  readonly pitch: string;
  readonly phone: string;
  readonly statusLabel: string;
  readonly statusTone: "ready" | "active" | "complete" | "warning" | "refund" | "muted";
  readonly blockedReason: string;
  readonly canCheckIn: boolean;
  readonly canComplete: boolean;
  readonly canRefund: boolean;
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;

export function shiftServiceDate(serviceDate: string, days: number): string {
  const [year, month, day] = serviceDate.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

function dateParts(serviceDate: string): { readonly weekday: string; readonly day: string } {
  const [year, month, day] = serviceDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return { weekday: WEEKDAYS[date.getUTCDay()], day: String(day) };
}

export function presentVenueServiceDates(serviceDate: string): readonly VenueServiceDateViewModel[] {
  return [-1, 0, 1].map((offset) => {
    const value = shiftServiceDate(serviceDate, offset);
    const parts = dateParts(value);
    return { serviceDate: value, weekday: offset === 0 ? "今天" : parts.weekday, day: parts.day, selected: offset === 0 };
  });
}

export function presentSelectedServiceDate(serviceDate: string): string {
  const [year, month, day] = serviceDate.split("-").map(Number);
  return `${month}月${day}日 ${WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]}`;
}

function status(value: VenueFulfillmentOrderStatus): Pick<VenueFulfillmentOrderViewModel, "statusLabel" | "statusTone"> {
  const values: Record<VenueFulfillmentOrderStatus, Pick<VenueFulfillmentOrderViewModel, "statusLabel" | "statusTone">> = {
    PENDING_PAYMENT: { statusLabel: "待支付", statusTone: "warning" },
    CONFIRMED: { statusLabel: "待履约", statusTone: "ready" },
    EXPIRED: { statusLabel: "已过期", statusTone: "muted" },
    PAYMENT_EXCEPTION: { statusLabel: "支付待确认", statusTone: "warning" },
    CANCELLED: { statusLabel: "已取消", statusTone: "muted" },
    REFUND_PENDING: { statusLabel: "退款处理中", statusTone: "refund" },
    REFUND_FAILED: { statusLabel: "退款待处理", statusTone: "warning" },
    REFUNDED: { statusLabel: "已退款", statusTone: "muted" },
    COMPLETED: { statusLabel: "已完成", statusTone: "complete" },
  };
  const result = values[value];
  if (!result) throw new Error("UNKNOWN_VENUE_FULFILLMENT_STATUS");
  return result;
}

function blocked(value: VenueFulfillmentBlockedReason | null): string {
  if (value === null) return "";
  return ({
    PAYMENT_RESULT_PENDING: "支付结果仍在确认",
    CANCELLATION_WINDOW_CLOSED: "取消时限已结束",
    REFUND_IN_PROGRESS: "退款正在处理中",
    CHECK_IN_TOO_EARLY: "距离签到时间尚早",
    CHECK_IN_REQUIRED: "请先完成签到",
    SESSION_NOT_ENDED: "服务时段尚未结束",
    ORDER_TERMINAL: "订单已结束",
    CANCELLATION_REQUIRES_SUPPORT: "请联系平台处理",
  } satisfies Record<VenueFulfillmentBlockedReason, string>)[value];
}

export function presentVenueFulfillmentOrder(order: VenueFulfillmentOrder): VenueFulfillmentOrderViewModel {
  return {
    orderId: order.orderId,
    number: order.orderNumber,
    time: formatShanghaiTimeRange(order.startsAt, order.endsAt),
    pitch: order.pitch.name,
    phone: order.maskedPhone,
    ...status(order.status),
    blockedReason: blocked(order.allowedActions.blockedReason),
    canCheckIn: order.allowedActions.canCheckIn,
    canComplete: order.allowedActions.canComplete,
    canRefund: order.allowedActions.canRefund,
  };
}
