import type { LifecycleTerminalOrderStatus, OrderView } from "../../domain/booking";
import type { PaymentOrderView } from "../../domain/payment";
import {
  OrderDetailPoller,
  presentOrderDetailStatus,
  type OrderDetailPollState,
  type PollScheduler,
} from "../../presentation/order-detail";
import { formatPriceCents } from "../../presentation/availability";
import { isStrictUuid } from "../../presentation/lifecycle";
import {
  initialPaymentPageState,
  reducePayment,
  type PaymentPageState,
} from "../../presentation/payment";
import { formatShanghaiTimeRange } from "../../presentation/shanghai-time";
import { getBookingDataSource } from "../../services/booking";
import { getPaymentBindings } from "../../services/payment";

function requireUuid(value: string | undefined): string {
  if (!isStrictUuid(value)) throw new Error("INVALID_ORDER_ID");
  return value;
}

function paymentOrder(order: OrderView | PaymentOrderView): PaymentOrderView | null {
  if (order.status === "EXPIRED" || order.status === "CANCELLED"
    || order.status === "REFUND_PENDING" || order.status === "REFUND_FAILED"
    || order.status === "REFUNDED" || order.status === "COMPLETED") return null;
  if (order.status === "PENDING_PAYMENT" && !("paymentState" in order)) {
    return {
      ...order,
      paymentState: null,
      paymentConfirming: false,
      paidAt: null,
    };
  }
  return order;
}

function isActivePaymentOperation(state: PaymentPageState): boolean {
  return state.status === "creating-prepay" || state.status === "cashier-open";
}

function isUnknownPaymentResult(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "PAYMENT_RESULT_UNKNOWN";
}

function clearedPaymentUi() {
  return {
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
  };
}

function lifecycleHeroCopy(status: OrderDetailPollState["status"]): string {
  if (status === "cancelled") return "订单已取消，不会继续占用该时段。";
  if (status === "refund-pending") return "退款申请已受理，结果以服务端为准。";
  if (status === "refund-failed") return "退款尚未完成，请联系客服处理。";
  if (status === "refunded") return "退款已完成，请留意原支付账户。";
  if (status === "completed") return "本次场地服务已完成。";
  return "";
}

const scheduler: PollScheduler = {
  setTimeout(callback, delayMs) { return setTimeout(callback, delayMs); },
  clearTimeout(handle) { clearTimeout(handle as ReturnType<typeof setTimeout>); },
};

Page({
  data: {
    orderId: "",
    order: null as OrderView | PaymentOrderView | null,
    status: "loading" as OrderDetailPollState["status"] | "route-error" | "payment-pending" | "creating-prepay" | "cashier-open",
    seconds: 0,
    countdown: "10:00",
    errorText: "",
    paymentError: "",
    venuePitchLabel: "",
    dateLabel: "",
    timeLabel: "",
    durationLabel: "",
    priceText: "",
    eyebrow: "待支付",
    heroTitle: "请在有效期内完成支付",
    heroCopy: "",
    primaryText: "立即支付",
    primaryDisabled: false,
    showPaymentFooter: false,
    showPaymentRetry: false,
    showCashierMarker: false,
    cashierNotice: "",
    showProgressIcon: false,
    showSuccessIcon: false,
    paidLabel: "",
    showClosingMessage: false,
    showClosingRetry: false,
    showReselect: false,
    navigationError: "",
  },
  poller: undefined as OrderDetailPoller | undefined,
  paymentState: initialPaymentPageState() as PaymentPageState,
  paymentOperationGeneration: 0,
  paymentClickSerial: 0,
  paymentCreateKey: null as string | null,
  orderProjectionRevision: 0,
  terminalOrderStatus: null as "CONFIRMED" | "EXPIRED" | LifecycleTerminalOrderStatus | null,
  manualReconcileInFlight: null as Promise<void> | null,
  visible: false,

  onLoad(options: Record<string, string | undefined>) {
    this.visible = true;
    this.paymentState = initialPaymentPageState();
    this.paymentCreateKey = null;
    this.orderProjectionRevision = 0;
    this.terminalOrderStatus = null;
    this.manualReconcileInFlight = null;
    this.paymentOperationGeneration += 1;
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
    if (isActivePaymentOperation(this.paymentState)) {
      this.paymentState = initialPaymentPageState(this.paymentState.order);
    }
    if (this.data.orderId) this.ensurePoller().start(this.data.orderId);
  },

  onHide() {
    this.visible = false;
    this.paymentOperationGeneration += 1;
    this.poller?.cancel();
    this.manualReconcileInFlight = null;
  },

  onUnload() {
    this.visible = false;
    this.paymentOperationGeneration += 1;
    this.poller?.cancel();
    this.paymentCreateKey = null;
    this.manualReconcileInFlight = null;
  },

  ensurePoller(): OrderDetailPoller {
    if (!this.poller) {
      const bindings = getPaymentBindings();
      this.poller = new OrderDetailPoller({
        getOrder: bindings
          ? (orderId) => bindings.source.getOrder(orderId)
          : (orderId) => getBookingDataSource().getOrder(orderId),
        clock: bindings?.clock ?? { now: () => new Date() },
        scheduler,
        onState: (state) => {
          if (this.visible) this.applyPollState(state);
        },
      });
    }
    return this.poller;
  },

  applyPollState(state: OrderDetailPollState) {
    if (this.terminalOrderStatus && !("order" in state)) return;
    if ("order" in state && !this.acceptOrderProjection(state.order)) return;
    switch (state.status) {
      case "loading": {
        if (isActivePaymentOperation(this.paymentState)
          || this.paymentState.status === "payment-confirming"
          || this.paymentState.status === "payment-pending") return;
        this.paymentState = reducePayment(this.paymentState, { type: "ORDER_LOADING" });
        this.setData({
          ...presentOrderDetailStatus(state.status),
          status: "loading",
          errorText: "",
        });
        return;
      }
      case "load-error":
      case "closing-error":
        this.paymentState = reducePayment(this.paymentState, {
          type: "ORDER_LOAD_FAILED",
          message: state.message,
        });
        this.setData({
          ...clearedPaymentUi(),
          ...presentOrderDetailStatus(state.status),
          status: state.status,
          errorText: state.message,
        });
        return;
      case "pending-payment": {
        if (!getPaymentBindings()) {
          this.setData({
            ...clearedPaymentUi(),
            ...presentOrderDetailStatus(state.status),
            ...this.orderLabels(state.order),
            order: state.order,
            status: state.status,
            seconds: state.seconds,
            countdown: this.formatCountdown(state.seconds),
            errorText: "",
            showPaymentFooter: false,
          });
          return;
        }
        const order = paymentOrder(state.order);
        if (order) this.paymentState = reducePayment(this.paymentState, { type: "ORDER_RECEIVED", order });
        this.applyPaymentState(this.paymentState, {
          seconds: state.seconds,
          countdown: this.formatCountdown(state.seconds),
        });
        return;
      }
      case "payment-confirming":
        this.paymentState = reducePayment(this.paymentState, { type: "ORDER_RECEIVED", order: state.order });
        this.applyPaymentState(this.paymentState, { showPaymentRetry: state.showManualReconcile });
        return;
      case "payment-exception":
      case "booking-confirmed":
        this.paymentState = reducePayment(this.paymentState, { type: "ORDER_RECEIVED", order: state.order });
        this.applyPaymentState(this.paymentState);
        return;
      case "closing-payment":
      case "expired":
      case "cancelled":
      case "refund-pending":
      case "refund-failed":
      case "refunded":
      case "completed":
        this.setData({
          ...clearedPaymentUi(),
          ...presentOrderDetailStatus(state.status),
          ...this.orderLabels(state.order),
          order: state.order,
          status: state.status,
          seconds: 0,
          countdown: "00:00",
          errorText: "",
          heroCopy: lifecycleHeroCopy(state.status),
          showPaymentFooter: false,
        });
    }
  },

  applyPaymentState(state: PaymentPageState, extra: Record<string, unknown> = {}) {
    if (!state.order) return;
    const status = state.status === "ready" ? "payment-pending" : state.status;
    const presentation = presentOrderDetailStatus(status);
    const pending = status === "payment-pending";
    const creating = status === "creating-prepay";
    const cashierOpen = status === "cashier-open";
    const confirming = status === "payment-confirming";
    const exception = status === "payment-exception";
    const confirmed = status === "booking-confirmed";
    const paymentError = state.status === "payment-pending" ? state.errorMessage ?? "" : "";

    this.setData({
      ...presentation,
      ...this.orderLabels(state.order),
      order: state.order,
      status,
      eyebrow: pending || creating || cashierOpen ? "待支付" : "",
      heroTitle: pending || creating || cashierOpen ? "请在有效期内完成支付" : presentation.heroTitle,
      heroCopy: confirming
        ? "支付结果以服务端确认为准，请勿重复付款"
        : exception
          ? "暂未取得权威支付结果，场地仍保持锁定，请手动重新查询。"
          : confirmed
            ? "订单已确认，场地已为你预订"
            : "",
      primaryText: creating
        ? "正在发起支付…"
        : confirming
          ? "支付确认中…"
          : exception
            ? "重新查询"
            : confirmed
              ? "查看预订详情"
              : "立即支付",
      primaryDisabled: creating || cashierOpen || confirming,
      showPaymentFooter: true,
      showPaymentRetry: exception,
      showCashierMarker: cashierOpen,
      cashierNotice: getPaymentBindings()?.capability.cashierNotice ?? "",
      showProgressIcon: confirming || exception,
      showSuccessIcon: confirmed,
      paidLabel: confirmed ? "已支付" : "",
      paymentError,
      errorText: "",
      ...extra,
    });
  },

  orderLabels(order: OrderView | PaymentOrderView) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(order.startsAt);
    const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    const date = new Date(order.startsAt);
    const dateLabel = match
      ? `${Number(match[2])}月${Number(match[3])}日 ${weekdays[date.getUTCDay()]}`
      : "";
    return {
      venuePitchLabel: `${order.venue.name} · ${order.pitch.name}`,
      dateLabel,
      timeLabel: formatShanghaiTimeRange(order.startsAt, order.endsAt),
      durationLabel: order.durationMinutes % 60 === 0
        ? `${order.durationMinutes / 60} 小时`
        : `${order.durationMinutes} 分钟`,
      priceText: formatPriceCents(order.priceCents),
    };
  },

  async onPay() {
    const bindings = getPaymentBindings();
    if (!bindings
      || this.terminalOrderStatus
      || this.data.status !== "payment-pending"
      || !this.data.showPaymentFooter
      || (this.paymentState.status !== "ready" && this.paymentState.status !== "payment-pending")) return;
    const idempotencyKey = this.paymentCreateKey
      ?? `payment-${Date.now()}-${++this.paymentClickSerial}`;
    this.paymentCreateKey = idempotencyKey;
    const started = reducePayment(this.paymentState, { type: "PAY_STARTED", idempotencyKey });
    if (started === this.paymentState) return;
    this.paymentState = started;
    this.applyPaymentState(started);
    this.poller?.cancel();
    const generation = ++this.paymentOperationGeneration;

    try {
      const launch = await bindings.source.createPayment(this.data.orderId, idempotencyKey);
      if (!this.isCurrentPaymentOperation(generation)) return;
      if (launch.outcome === "ALREADY_CONFIRMED") {
        this.paymentCreateKey = null;
        this.paymentState = reducePayment(this.paymentState, { type: "ORDER_RECEIVED", order: launch.order });
        this.applyPaymentState(this.paymentState);
        return;
      }
      if (launch.outcome === "PAYMENT_CONFIRMING") {
        this.paymentCreateKey = null;
        this.paymentState = reducePayment(this.paymentState, {
          type: "PAYMENT_CONFIRMING",
          idempotencyKey,
          paymentId: launch.paymentId,
        });
        this.applyPaymentState(this.paymentState);
        this.ensurePoller().start(this.data.orderId);
        return;
      }

      this.paymentState = reducePayment(this.paymentState, {
        type: "PREPAY_CREATED",
        idempotencyKey,
        paymentId: launch.paymentId,
        launchParams: launch.launchParams,
      });
      this.paymentCreateKey = null;
      this.applyPaymentState(this.paymentState);
      const cashier = await bindings.capability.requestPayment(launch.launchParams);
      if (!this.isCurrentPaymentOperation(generation)) return;
      if (cashier.outcome === "user_cancelled") {
        this.paymentState = reducePayment(this.paymentState, { type: "CASHIER_CANCELLED" });
        this.applyPaymentState(this.paymentState);
        this.ensurePoller().start(this.data.orderId);
        return;
      }
      if (cashier.outcome === "launch_failed") {
        this.paymentState = reducePayment(this.paymentState, {
          type: "CASHIER_FAILED",
          message: cashier.message,
        });
        this.applyPaymentState(this.paymentState);
        this.ensurePoller().start(this.data.orderId);
        return;
      }

      this.paymentState = reducePayment(this.paymentState, { type: "CASHIER_SUCCEEDED" });
      this.applyPaymentState(this.paymentState);
      try {
        const reconciliation = await bindings.source.reconcilePayment(this.data.orderId, launch.paymentId);
        if (!this.isCurrentPaymentOperation(generation)) return;
        this.applyReconciledOrder(reconciliation.order);
        if (reconciliation.order.status !== "EXPIRED"
          && this.paymentState.status === "payment-confirming") this.ensurePoller().start(this.data.orderId);
      } catch {
        if (this.isCurrentPaymentOperation(generation)) this.ensurePoller().start(this.data.orderId);
      }
    } catch (error) {
      if (!this.isCurrentPaymentOperation(generation)) return;
      const unknown = isUnknownPaymentResult(error);
      if (!unknown) this.paymentCreateKey = null;
      this.paymentState = reducePayment(this.paymentState, {
        type: "PAY_CREATE_FAILED",
        idempotencyKey,
        message: unknown ? "支付结果待确认，请重试。" : "支付发起失败，请重试。",
      });
      this.applyPaymentState(this.paymentState);
      this.ensurePoller().start(this.data.orderId);
    }
  },

  isCurrentPaymentOperation(generation: number) {
    return this.visible && generation === this.paymentOperationGeneration;
  },

  acceptOrderProjection(order: OrderView): boolean {
    if (this.terminalOrderStatus && order.status !== this.terminalOrderStatus) return false;
    if (order.status === "CONFIRMED" || order.status === "EXPIRED"
      || order.status === "CANCELLED" || order.status === "REFUND_PENDING"
      || order.status === "REFUND_FAILED" || order.status === "REFUNDED"
      || order.status === "COMPLETED") {
      this.terminalOrderStatus = order.status;
    }
    this.orderProjectionRevision += 1;
    return true;
  },

  applyReconciledOrder(order: OrderView, expectedRevision?: number) {
    if (expectedRevision !== undefined && expectedRevision !== this.orderProjectionRevision) return;
    if (order.status === "EXPIRED") {
      this.applyPollState({ status: "expired", order });
      return;
    }
    if (order.status === "CANCELLED") {
      this.applyPollState({ status: "cancelled", order });
      return;
    }
    if (order.status === "REFUND_PENDING") {
      this.applyPollState({ status: "refund-pending", order });
      return;
    }
    if (order.status === "REFUND_FAILED") {
      this.applyPollState({ status: "refund-failed", order });
      return;
    }
    if (order.status === "REFUNDED") {
      this.applyPollState({ status: "refunded", order });
      return;
    }
    if (order.status === "COMPLETED") {
      this.applyPollState({ status: "completed", order });
      return;
    }
    if (!this.acceptOrderProjection(order)) return;
    this.paymentState = reducePayment(this.paymentState, { type: "ORDER_RECEIVED", order });
    this.applyPaymentState(this.paymentState);
  },

  onRetryLoad() {
    if (this.data.status === "load-error") this.ensurePoller().retry();
  },

  onRetryClosing() {
    if (this.data.status === "closing-error") this.ensurePoller().retry();
  },

  onReconcilePayment(): Promise<void> {
    if (this.manualReconcileInFlight) return this.manualReconcileInFlight;
    if (this.data.status !== "payment-confirming" && this.data.status !== "payment-exception") {
      return Promise.resolve();
    }
    const operation = this.performManualReconcile();
    this.manualReconcileInFlight = operation;
    void operation.then(
      () => { if (this.manualReconcileInFlight === operation) this.manualReconcileInFlight = null; },
      () => { if (this.manualReconcileInFlight === operation) this.manualReconcileInFlight = null; },
    );
    return operation;
  },

  async performManualReconcile(): Promise<void> {
    const bindings = getPaymentBindings();
    const paymentId = "paymentId" in this.paymentState ? this.paymentState.paymentId : null;
    if (!bindings || !paymentId) {
      this.ensurePoller().reconcile();
      return;
    }
    this.poller?.cancel();
    const generation = ++this.paymentOperationGeneration;
    const projectionRevision = this.orderProjectionRevision;
    try {
      const reconciliation = await bindings.source.reconcilePayment(this.data.orderId, paymentId);
      if (!this.isCurrentPaymentOperation(generation)
        || projectionRevision !== this.orderProjectionRevision) return;
      this.applyReconciledOrder(reconciliation.order, projectionRevision);
      if (reconciliation.order.status !== "EXPIRED"
        && this.paymentState.status === "payment-confirming") this.ensurePoller().start(this.data.orderId);
    } catch {
      if (this.isCurrentPaymentOperation(generation)
        && projectionRevision === this.orderProjectionRevision) this.ensurePoller().reconcile();
    }
  },

  async onViewBookingDetails() {
    try {
      await wx.pageScrollTo({ scrollTop: 0, duration: 200 });
    } catch {
      // The user is already on the stable booking detail page.
    }
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
