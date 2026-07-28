import type { OrderView } from "../../domain/booking";
import {
  OrderDetailPoller,
  presentOrderDetailStatus,
  type OrderDetailPollState,
  type PollScheduler,
} from "../../presentation/order-detail";
import { formatPriceCents } from "../../presentation/availability";
import { isStrictUuid } from "../../presentation/lifecycle";
import { formatShanghaiTimeRange } from "../../presentation/shanghai-time";
import { getBookingDataSource } from "../../services/booking";

function requireUuid(value: string | undefined): string {
  if (!isStrictUuid(value)) throw new Error("INVALID_ORDER_ID");
  return value;
}

const scheduler: PollScheduler = {
  setTimeout(callback, delayMs) { return setTimeout(callback, delayMs); },
  clearTimeout(handle) { clearTimeout(handle as ReturnType<typeof setTimeout>); },
};

Page({
  data: {
    orderId: "",
    order: null as OrderView | null,
    status: "loading" as "loading" | "route-error" | "load-error" | "pending-payment" | "closing-payment" | "closing-error" | "expired",
    seconds: 0,
    countdown: "10:00",
    errorText: "",
    venuePitchLabel: "",
    timeLabel: "",
    durationLabel: "",
    priceText: "",
    heroTitle: "场次已为你保留",
    showClosingMessage: false,
    showClosingRetry: false,
    showReselect: false,
    navigationError: "",
  },
  poller: undefined as OrderDetailPoller | undefined,
  visible: false,

  onLoad(options: Record<string, string | undefined>) {
    this.visible = true;
    try {
      const orderId = requireUuid(options.order_id);
      this.setData({ orderId });
      this.ensurePoller().start(orderId);
    } catch {
      this.setData({ status: "route-error", errorText: "订单编号无效。" });
    }
  },

  onShow() {
    if (this.visible) return;
    this.visible = true;
    if (this.data.orderId) this.ensurePoller().start(this.data.orderId);
  },

  onHide() {
    this.visible = false;
    this.poller?.cancel();
  },

  onUnload() {
    this.visible = false;
    this.poller?.cancel();
  },

  ensurePoller(): OrderDetailPoller {
    if (!this.poller) {
      this.poller = new OrderDetailPoller({
        getOrder: (orderId) => getBookingDataSource().getOrder(orderId),
        clock: { now: () => new Date() },
        scheduler,
        onState: (state) => {
          if (this.visible) this.applyPollState(state);
        },
      });
    }
    return this.poller;
  },

  applyPollState(state: OrderDetailPollState) {
    switch (state.status) {
      case "loading":
        this.setData({
          ...presentOrderDetailStatus(state.status),
          status: "loading",
          errorText: "",
        });
        return;
      case "load-error":
      case "closing-error":
        this.setData({
          ...presentOrderDetailStatus(state.status),
          status: state.status,
          errorText: state.message,
        });
        return;
      case "pending-payment":
        this.setData({
          ...presentOrderDetailStatus(state.status),
          ...this.orderLabels(state.order),
          order: state.order,
          status: state.status,
          seconds: state.seconds,
          countdown: this.formatCountdown(state.seconds),
          errorText: "",
        });
        return;
      case "closing-payment":
        this.setData({
          ...presentOrderDetailStatus(state.status),
          ...this.orderLabels(state.order),
          order: state.order,
          status: state.status,
          seconds: 0,
          countdown: "00:00",
          errorText: "",
        });
        return;
      case "expired":
        this.setData({
          ...presentOrderDetailStatus(state.status),
          ...this.orderLabels(state.order),
          order: state.order,
          status: state.status,
          seconds: 0,
          countdown: "00:00",
          errorText: "",
        });
    }
  },

  orderLabels(order: OrderView) {
    return {
      venuePitchLabel: `${order.venue.name} · ${order.pitch.name}`,
      timeLabel: formatShanghaiTimeRange(order.startsAt, order.endsAt),
      durationLabel: order.durationMinutes % 60 === 0 ? `${order.durationMinutes / 60}小时` : `${order.durationMinutes}分钟`,
      priceText: formatPriceCents(order.priceCents),
    };
  },

  onRetryLoad() {
    if (this.data.status === "load-error") this.ensurePoller().retry();
  },

  onRetryClosing() {
    if (this.data.status === "closing-error") this.ensurePoller().retry();
  },

  async onReselectSlot() {
    if (!this.data.showReselect) return;
    this.setData({ navigationError: "" });
    try {
      await wx.redirectTo({ url: "/pages/availability/index" });
    } catch {
      this.setData({ navigationError: "页面打开失败，请重试。" });
    }
  },

  formatCountdown(seconds: number) {
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  },
});
