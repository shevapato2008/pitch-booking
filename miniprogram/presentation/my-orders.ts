import type { OrderSummaryView } from "../domain/booking";
import { formatPriceCents } from "./availability";
import { formatShanghaiDateLabel, formatShanghaiTimeRange } from "./shanghai-time";

export type MyOrderStatus =
  | "pending"
  | "confirming"
  | "closing"
  | "confirmed"
  | "expired"
  | "exception"
  | "cancelled"
  | "refund-pending"
  | "refund-failed"
  | "refunded"
  | "completed";

export interface MyOrderCardViewModel {
  readonly orderId: string;
  readonly venue: string;
  readonly pitch: string;
  readonly schedule: string;
  readonly amount: string;
  readonly status: MyOrderStatus;
  readonly statusLabel: string;
  readonly statusDescription: string;
  readonly detailRoute: string;
}

function statusPresentation(order: OrderSummaryView): Pick<
  MyOrderCardViewModel,
  "status" | "statusLabel" | "statusDescription"
> {
  if (order.status === "PAYMENT_EXCEPTION") {
    return { status: "exception", statusLabel: "支付待确认", statusDescription: "请进入详情重新查询" };
  }
  if (order.closingPayment) {
    return { status: "closing", statusLabel: "正在关闭", statusDescription: "正在确认订单与场地状态" };
  }
  if (order.paymentConfirming) {
    return { status: "confirming", statusLabel: "支付确认中", statusDescription: "结果以服务端确认为准" };
  }
  if (order.status === "CONFIRMED") {
    return { status: "confirmed", statusLabel: "预订成功", statusDescription: "场地已为你预订" };
  }
  if (order.status === "EXPIRED") {
    return { status: "expired", statusLabel: "已过期", statusDescription: "该订单已关闭" };
  }
  if (order.status === "CANCELLED") {
    return { status: "cancelled", statusLabel: "已取消", statusDescription: "订单已取消" };
  }
  if (order.status === "REFUND_PENDING") {
    return { status: "refund-pending", statusLabel: "退款处理中", statusDescription: "结果以服务端为准" };
  }
  if (order.status === "REFUND_FAILED") {
    return { status: "refund-failed", statusLabel: "退款需处理", statusDescription: "请联系客服处理" };
  }
  if (order.status === "REFUNDED") {
    return { status: "refunded", statusLabel: "已退款", statusDescription: "请留意原支付账户" };
  }
  if (order.status === "COMPLETED") {
    return { status: "completed", statusLabel: "已完成", statusDescription: "场地服务已完成" };
  }
  return { status: "pending", statusLabel: "待支付", statusDescription: "请在订单关闭前完成支付" };
}

export function presentMyOrder(order: OrderSummaryView): MyOrderCardViewModel {
  return {
    orderId: order.orderId,
    venue: order.venue.name,
    pitch: order.pitch.name,
    schedule: `${formatShanghaiDateLabel(order.startsAt)} · ${formatShanghaiTimeRange(order.startsAt, order.endsAt)}`,
    amount: formatPriceCents(order.priceCents),
    ...statusPresentation(order),
    detailRoute: `/pages/order-detail/index?order_id=${encodeURIComponent(order.orderId)}`,
  };
}
