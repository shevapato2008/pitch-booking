import type { LifecycleTerminalOrderStatus, OrderView } from "../../domain/booking";
import type { OpenGameEntry } from "../../domain/open-game";
import type { PaymentOrderView } from "../../domain/payment";
import {
  OrderDetailPoller,
  presentOwnerOrderLifecycle,
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
import { getBookingDataSource, type BookingDataSource } from "../../services/booking";
import { getOpenGameSource } from "../../services/open-game";
import { getPaymentBindings } from "../../services/payment";
import { ONLINE_BOOKING_ENABLED } from "../../config/runtime";

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

type CancellationCapableSource = BookingDataSource & {
  cancelOrder: NonNullable<BookingDataSource["cancelOrder"]>;
};

function getCancellationSource(): CancellationCapableSource | null {
  try {
    const source = getBookingDataSource();
    return typeof source.cancelOrder === "function" ? source as CancellationCapableSource : null;
  } catch {
    return null;
  }
}

function isUnknownCancellationResult(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "CANCELLATION_RESULT_UNKNOWN";
}

function isCancellationAcknowledgement(
  before: OrderView | PaymentOrderView,
  result: OrderView,
): boolean {
  if (result.orderId !== before.orderId) return false;
  if (before.status === "PENDING_PAYMENT") {
    return result.status === "CANCELLED"
      || (result.status === "PENDING_PAYMENT" && result.cancelRequestedAt != null);
  }
  return (before.status === "CONFIRMED" || before.status === "REFUND_FAILED")
    && result.status === "REFUND_PENDING";
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
    cancellationError: "",
    cancelActionLabel: "",
    cancelModalTitle: "",
    cancelModalContent: "",
    showCancelAction: false,
    showActionFooter: false,
    showLifecycleRefresh: false,
    cancellationUnknown: false,
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
    status: "loading" as OrderDetailPollState["status"] | "route-error" | "payment-pending" | "payment-unavailable" | "creating-prepay" | "cashier-open",
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
    cancellationError: "",
    cancellationUnknown: false,
    cancellationBusy: false,
    cancelActionLabel: "",
    cancelModalTitle: "",
    cancelModalContent: "",
    showCancelAction: false,
    showActionFooter: false,
    showLifecycleRefresh: false,
    openGameEntry: null as OpenGameEntry | null,
    showOpenGameEntry: false,
    showOpenGameEntryRetry: false,
    openGameActionLabel: "",
    openGameEntryError: "",
    onlineBookingEnabled: ONLINE_BOOKING_ENABLED,
  },
  poller: undefined as OrderDetailPoller | undefined,
  paymentState: initialPaymentPageState() as PaymentPageState,
  paymentOperationGeneration: 0,
  paymentClickSerial: 0,
  paymentCreateKey: null as string | null,
  orderProjectionRevision: 0,
  terminalOrderStatus: null as "CONFIRMED" | "EXPIRED" | LifecycleTerminalOrderStatus | null,
  manualReconcileInFlight: null as Promise<void> | null,
  cancellationOperationGeneration: 0,
  cancellationClickSerial: 0,
  cancellationKey: null as string | null,
  cancellationInFlight: false,
  cancellationRefreshInFlight: null as Promise<void> | null,
  openGameEntryGeneration: 0,
  visible: false,

  onLoad(options: Record<string, string | undefined>) {
    this.visible = true;
    this.paymentState = initialPaymentPageState();
    this.paymentCreateKey = null;
    this.orderProjectionRevision = 0;
    this.terminalOrderStatus = null;
    this.manualReconcileInFlight = null;
    this.cancellationOperationGeneration += 1;
    this.cancellationKey = null;
    this.cancellationInFlight = false;
    this.cancellationRefreshInFlight = null;
    this.paymentOperationGeneration += 1;
    this.openGameEntryGeneration += 1;
    try {
      const orderId = requireUuid(options.order_id);
      this.setData({
        orderId,
        openGameEntry: null,
        showOpenGameEntry: false,
        showOpenGameEntryRetry: false,
        openGameActionLabel: "",
        openGameEntryError: "",
      });
      this.ensurePoller().start(orderId);
      void this.loadOpenGameEntry(orderId);
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
    if (this.data.orderId) {
      this.ensurePoller().start(this.data.orderId);
      void this.loadOpenGameEntry(this.data.orderId);
    }
  },

  onHide() {
    this.visible = false;
    this.paymentOperationGeneration += 1;
    this.cancellationOperationGeneration += 1;
    this.openGameEntryGeneration += 1;
    this.poller?.cancel();
    this.manualReconcileInFlight = null;
    this.cancellationInFlight = false;
    this.cancellationRefreshInFlight = null;
    this.setData({ cancellationBusy: false });
  },

  onUnload() {
    this.visible = false;
    this.paymentOperationGeneration += 1;
    this.cancellationOperationGeneration += 1;
    this.openGameEntryGeneration += 1;
    this.poller?.cancel();
    this.paymentCreateKey = null;
    this.manualReconcileInFlight = null;
    this.cancellationKey = null;
    this.cancellationInFlight = false;
    this.cancellationRefreshInFlight = null;
  },

  ensurePoller(): OrderDetailPoller {
    if (!this.poller) {
      const bindings = getPaymentBindings();
      const cancellationSource = getCancellationSource();
      this.poller = new OrderDetailPoller({
        getOrder: cancellationSource
          ? (orderId) => cancellationSource.getOrder(orderId)
          : this.data.onlineBookingEnabled && bindings
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

  ownerActionUi(order: OrderView | PaymentOrderView, showPaymentFooter: boolean) {
    const lifecycle = presentOwnerOrderLifecycle(order);
    const cancelAction = getCancellationSource() && !isActivePaymentOperation(this.paymentState)
      ? lifecycle.cancelAction
      : null;
    return {
      heroTitle: lifecycle.heroTitle,
      showPaymentFooter,
      showCancelAction: cancelAction !== null,
      cancelActionLabel: cancelAction?.label ?? "",
      cancelModalTitle: cancelAction?.title ?? "",
      cancelModalContent: cancelAction?.content ?? "",
      showActionFooter: showPaymentFooter || cancelAction !== null,
      showLifecycleRefresh: false,
      cancellationUnknown: false,
    };
  },

  applyPollState(state: OrderDetailPollState) {
    if (this.terminalOrderStatus && !("order" in state)) return;
    if ("order" in state && !this.acceptOrderProjection(state.order)) return;
    const ownerLifecycle = "order" in state ? presentOwnerOrderLifecycle(state.order) : null;
    if (
      !this.data.onlineBookingEnabled
      && "order" in state
      && ["pending-payment", "payment-confirming", "payment-exception"].includes(state.status)
      && ownerLifecycle?.cancelAction === null
      && ownerLifecycle.shouldPoll === false
    ) {
      this.applyPaymentUnavailable(state.order);
      return;
    }
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
          const actionUi = this.ownerActionUi(state.order, false);
          this.setData({
            ...clearedPaymentUi(),
            ...presentOrderDetailStatus(state.status),
            ...actionUi,
            ...this.orderLabels(state.order),
            order: state.order,
            status: state.status,
            seconds: state.seconds,
            countdown: this.formatCountdown(state.seconds),
            errorText: "",
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
      case "cancellation-confirming":
        this.setData({
          ...clearedPaymentUi(),
          ...presentOrderDetailStatus(state.status),
          ...this.ownerActionUi(state.order, false),
          ...this.orderLabels(state.order),
          order: state.order,
          status: state.status,
          seconds: 0,
          countdown: "00:00",
          errorText: "",
          cancellationError: "",
          heroTitle: "正在确认取消",
          heroCopy: "服务端正在确认支付与取消结果，当前场次不会提前显示为已释放。",
          showLifecycleRefresh: state.showManualRefresh,
        });
        return;
      case "closing-payment":
      case "expired":
      case "cancelled":
      case "refund-pending":
      case "refund-failed":
      case "refunded":
      case "completed":
        {
        const manualRefresh = state.status === "refund-pending" ? state.showManualRefresh : false;
        this.setData({
          ...clearedPaymentUi(),
          ...presentOrderDetailStatus(state.status),
          ...this.ownerActionUi(state.order, false),
          ...this.orderLabels(state.order),
          order: state.order,
          status: state.status,
          seconds: 0,
          countdown: "00:00",
          errorText: "",
          heroCopy: lifecycleHeroCopy(state.status),
          showLifecycleRefresh: manualRefresh,
        });
        }
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
    const lifecycle = presentOwnerOrderLifecycle(state.order);
    const showPaymentFooter = exception || (
      (pending || creating || cashierOpen)
      && lifecycle.showPayAction
      && this.data.onlineBookingEnabled
      && getPaymentBindings() !== undefined
    );
    const actionUi = this.ownerActionUi(state.order, showPaymentFooter);

    this.setData({
      ...presentation,
      ...actionUi,
      ...this.orderLabels(state.order),
      order: state.order,
      status,
      eyebrow: pending || creating || cashierOpen ? "待支付" : "",
      heroTitle: pending || creating || cashierOpen
        ? "请在有效期内完成支付"
        : presentation.heroTitle,
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
              ? ""
              : "立即支付",
      primaryDisabled: creating || cashierOpen || confirming,
      showPaymentRetry: exception,
      showCashierMarker: cashierOpen,
      cashierNotice: getPaymentBindings()?.capability.cashierNotice ?? "",
      showProgressIcon: confirming || exception,
      showSuccessIcon: confirmed,
      paidLabel: confirmed && state.order.paymentState === "SUCCESS" ? "已支付" : "",
      paymentError,
      cancellationError: "",
      errorText: "",
      ...extra,
    });
  },

  applyPaymentUnavailable(order: OrderView | PaymentOrderView) {
    this.setData({
      ...clearedPaymentUi(),
      ...this.ownerActionUi(order, false),
      ...this.orderLabels(order),
      order,
      status: "payment-unavailable",
      eyebrow: "在线预订",
      heroTitle: "在线预订暂未开放",
      heroCopy: "你仍可查看订单信息，当前无法发起支付。",
      primaryDisabled: true,
      showPaymentFooter: false,
      showActionFooter: false,
      showCancelAction: false,
      errorText: "",
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
    if (!this.data.onlineBookingEnabled) return;
    const bindings = getPaymentBindings();
    if (!bindings
      || this.cancellationInFlight
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

  async onCancelOrder(): Promise<void> {
    if (this.cancellationInFlight || this.data.cancellationUnknown
      || isActivePaymentOperation(this.paymentState)) return;
    const source = getCancellationSource();
    const order = this.data.order;
    if (!source || !order) return;
    const action = presentOwnerOrderLifecycle(order).cancelAction;
    if (!action) return;

    this.cancellationInFlight = true;
    let operationGeneration = this.cancellationOperationGeneration;
    this.setData({ cancellationBusy: true, cancellationError: "" });
    try {
      const decision = await wx.showModal({
        title: action.title,
        content: action.content,
        confirmText: "确认",
        cancelText: "暂不",
      });
      if (!decision.confirm || !this.isCurrentCancellationOperation(operationGeneration)) return;
      this.poller?.cancel();
      const idempotencyKey = this.cancellationKey
        ?? `cancel-order-${Date.now()}-${++this.cancellationClickSerial}`;
      this.cancellationKey = idempotencyKey;
      const generation = ++this.cancellationOperationGeneration;
      operationGeneration = generation;
      try {
        const result = await source.cancelOrder({ orderId: order.orderId, idempotencyKey });
        if (!this.isCurrentCancellationOperation(generation)) return;
        if (!isCancellationAcknowledgement(order, result)) {
          this.setData({
            cancellationUnknown: true,
            cancellationError: "取消结果尚未确认，请查询服务端最新状态。",
            cancelActionLabel: "确认取消结果",
            showCancelAction: false,
            showPaymentFooter: false,
            showActionFooter: true,
          });
          return;
        }
        this.cancellationKey = null;
        this.applyReconciledOrder(result);
      } catch (error) {
        if (!this.isCurrentCancellationOperation(generation)) return;
        if (isUnknownCancellationResult(error)) {
          this.setData({
            cancellationUnknown: true,
            cancellationError: "取消结果尚未确认，请查询服务端最新状态。",
            cancelActionLabel: "确认取消结果",
            showCancelAction: false,
            showPaymentFooter: false,
            showActionFooter: true,
          });
        } else {
          this.cancellationKey = null;
          this.setData({
            cancellationUnknown: true,
            cancellationError: "订单状态已变化，请确认最新结果。",
            cancelActionLabel: "确认取消结果",
            showCancelAction: false,
            showPaymentFooter: false,
            showActionFooter: true,
          });
        }
      }
    } finally {
      if (this.isCurrentCancellationOperation(operationGeneration)) {
        this.cancellationInFlight = false;
        if (this.visible) this.setData({ cancellationBusy: false });
      }
    }
  },

  onConfirmCancellationResult(): Promise<void> {
    if (this.cancellationRefreshInFlight) return this.cancellationRefreshInFlight;
    if (!this.data.cancellationUnknown) return Promise.resolve();
    const operation = this.refreshCancellationAuthority();
    this.cancellationRefreshInFlight = operation;
    void operation.then(
      () => { if (this.cancellationRefreshInFlight === operation) this.cancellationRefreshInFlight = null; },
      () => { if (this.cancellationRefreshInFlight === operation) this.cancellationRefreshInFlight = null; },
    );
    return operation;
  },

  async refreshCancellationAuthority(): Promise<void> {
    const source = getCancellationSource();
    if (!source || !this.data.orderId) return;
    const generation = ++this.cancellationOperationGeneration;
    this.setData({ cancellationBusy: true, cancellationError: "" });
    try {
      const order = await source.getOrder(this.data.orderId);
      if (!this.isCurrentCancellationOperation(generation)) return;
      if (order.allowedActions?.canCancel !== true) this.cancellationKey = null;
      this.applyReconciledOrder(order);
    } catch {
      if (this.isCurrentCancellationOperation(generation)) {
        this.setData({
          cancellationUnknown: true,
          cancellationError: "暂时无法确认取消结果，请重试。",
          cancelActionLabel: "确认取消结果",
          showActionFooter: true,
        });
      }
    } finally {
      if (this.isCurrentCancellationOperation(generation)) this.setData({ cancellationBusy: false });
    }
  },

  onRefreshLifecycle() {
    if (!this.data.showLifecycleRefresh) return;
    this.setData({ showLifecycleRefresh: false });
    this.ensurePoller().reconcile();
  },

  isCurrentCancellationOperation(generation: number) {
    return this.visible && generation === this.cancellationOperationGeneration;
  },

  isCurrentPaymentOperation(generation: number) {
    return this.visible && generation === this.paymentOperationGeneration;
  },

  isCurrentOpenGameEntry(generation: number) {
    return this.visible && generation === this.openGameEntryGeneration;
  },

  async loadOpenGameEntry(orderId: string): Promise<void> {
    if (!this.visible || !orderId) return;
    const generation = ++this.openGameEntryGeneration;
    this.setData({
      openGameEntry: null,
      showOpenGameEntry: false,
      showOpenGameEntryRetry: false,
      openGameActionLabel: "",
      openGameEntryError: "",
    });
    try {
      const entry = await getOpenGameSource().getEntry(orderId);
      if (!this.isCurrentOpenGameEntry(generation)) return;
      this.setData({
        openGameEntry: entry,
        showOpenGameEntry: entry.entry !== "NONE",
        showOpenGameEntryRetry: false,
        openGameActionLabel: entry.entry === "CREATE"
          ? "创建球局"
          : entry.entry === "MANAGE"
            ? "管理球局"
            : "",
        openGameEntryError: "",
      });
    } catch {
      if (!this.isCurrentOpenGameEntry(generation)) return;
      this.setData({
        openGameEntry: null,
        showOpenGameEntry: false,
        showOpenGameEntryRetry: true,
        openGameActionLabel: "",
        openGameEntryError: "球局入口暂时无法加载，请重试。",
      });
    }
  },

  onRetryOpenGameEntry(): Promise<void> {
    if (!this.data.showOpenGameEntryRetry || !this.data.orderId) return Promise.resolve();
    return this.loadOpenGameEntry(this.data.orderId);
  },

  async onOpenGameEntry(): Promise<void> {
    if (!this.data.showOpenGameEntry || !this.data.openGameEntry) return;
    const entry = this.data.openGameEntry;
    const url = entry.entry === "CREATE"
      ? `/pages/captain-game-form/index?order_id=${encodeURIComponent(this.data.orderId)}`
      : entry.entry === "MANAGE"
        ? `/pages/captain-game-manage/index?game_id=${encodeURIComponent(entry.gameId)}`
        : null;
    if (!url) return;
    this.setData({ openGameEntryError: "" });
    try {
      await wx.navigateTo({ url });
    } catch {
      this.setData({ openGameEntryError: "页面打开失败，请重试。" });
    }
  },

  acceptOrderProjection(order: OrderView): boolean {
    if (this.terminalOrderStatus && order.status !== this.terminalOrderStatus) {
      const allowedForwardStatuses: Partial<Record<typeof this.terminalOrderStatus, readonly OrderView["status"][]>> = {
        CONFIRMED: ["REFUND_PENDING", "REFUND_FAILED", "REFUNDED", "COMPLETED"],
        REFUND_PENDING: ["REFUND_FAILED", "REFUNDED"],
        REFUND_FAILED: ["REFUND_PENDING", "REFUNDED"],
      };
      if (!allowedForwardStatuses[this.terminalOrderStatus]?.includes(order.status)) return false;
    }
    if (order.status === "CONFIRMED" || order.status === "EXPIRED"
      || order.status === "CANCELLED" || order.status === "REFUND_PENDING"
      || order.status === "REFUND_FAILED" || order.status === "REFUNDED"
      || order.status === "COMPLETED") {
      this.terminalOrderStatus = order.status;
    }
    if (order.allowedActions && order.allowedActions.canCancel !== true) {
      this.cancellationKey = null;
    }
    this.orderProjectionRevision += 1;
    return true;
  },

  applyReconciledOrder(order: OrderView, expectedRevision?: number) {
    if (expectedRevision !== undefined && expectedRevision !== this.orderProjectionRevision) return;
    const ownerLifecycle = presentOwnerOrderLifecycle(order);
    if (order.status === "PENDING_PAYMENT" && ownerLifecycle.shouldPoll) {
      this.applyPollState({ status: "cancellation-confirming", order, showManualRefresh: false });
      this.ensurePoller().followOwnerLifecycle(order);
      return;
    }
    if (order.status === "EXPIRED") {
      this.applyPollState({ status: "expired", order });
      return;
    }
    if (order.status === "CANCELLED") {
      this.applyPollState({ status: "cancelled", order });
      return;
    }
    if (order.status === "REFUND_PENDING") {
      this.applyPollState({ status: "refund-pending", order, showManualRefresh: false });
      this.ensurePoller().followOwnerLifecycle(order);
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
