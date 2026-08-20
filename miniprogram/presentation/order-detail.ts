import type { Clock } from "../runtime/interfaces";
import type { LifecycleTerminalOrderView, OrderView, PendingOrderView } from "../domain/booking";
import type { PaymentOrderView } from "../domain/payment";
import type { PaymentPageStatus } from "./payment";

type OrderDetailOrderView = OrderView | PaymentOrderView;

export type OrderDetailPollState =
  | { readonly status: "loading" }
  | { readonly status: "load-error"; readonly message: string; readonly retryable: true }
  | { readonly status: "pending-payment"; readonly order: PendingOrderView; readonly seconds: number }
  | { readonly status: "closing-payment"; readonly order: PendingOrderView }
  | { readonly status: "closing-error"; readonly message: string; readonly retryable: true }
  | { readonly status: "expired"; readonly order: Extract<OrderView, { status: "EXPIRED" }> }
  | { readonly status: "payment-confirming"; readonly order: Extract<PaymentOrderView, { status: "PENDING_PAYMENT" }>; readonly showManualReconcile: boolean }
  | { readonly status: "cancellation-confirming"; readonly order: PendingOrderView; readonly showManualRefresh: boolean }
  | { readonly status: "payment-exception"; readonly order: Extract<PaymentOrderView, { status: "PAYMENT_EXCEPTION" }> }
  | { readonly status: "booking-confirmed"; readonly order: Extract<PaymentOrderView, { status: "CONFIRMED" }> }
  | { readonly status: "cancelled"; readonly order: Extract<LifecycleTerminalOrderView, { status: "CANCELLED" }> }
  | { readonly status: "refund-pending"; readonly order: Extract<LifecycleTerminalOrderView, { status: "REFUND_PENDING" }>; readonly showManualRefresh: boolean }
  | { readonly status: "refund-failed"; readonly order: Extract<LifecycleTerminalOrderView, { status: "REFUND_FAILED" }> }
  | { readonly status: "refunded"; readonly order: Extract<LifecycleTerminalOrderView, { status: "REFUNDED" }> }
  | { readonly status: "completed"; readonly order: Extract<LifecycleTerminalOrderView, { status: "COMPLETED" }> };

export interface PollScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface OrderDetailStatusPresentation {
  readonly heroTitle: string;
  readonly showClosingMessage: boolean;
  readonly showClosingRetry: boolean;
  readonly showReselect: boolean;
  readonly showPaymentRetry?: boolean;
}

export interface OwnerCancellationActionPresentation {
  readonly label: "取消订单" | "取消并发起全额退款" | "重试退款";
  readonly title: string;
  readonly content: string;
}

export interface OwnerOrderLifecyclePresentation {
  readonly heroTitle: string;
  readonly showPayAction: boolean;
  readonly cancelAction: OwnerCancellationActionPresentation | null;
  readonly shouldPoll: boolean;
}

export function presentOwnerOrderLifecycle(order: Pick<
  OrderView,
  "status" | "cancelRequestedAt" | "allowedActions"
>): OwnerOrderLifecyclePresentation {
  const cancelling = order.status === "PENDING_PAYMENT" && order.cancelRequestedAt != null;
  let heroTitle = order.status === "PENDING_PAYMENT" ? "待支付" : "预订成功";
  if (cancelling) heroTitle = "正在确认取消";
  if (order.status === "CANCELLED") heroTitle = "订单已取消";
  if (order.status === "REFUND_PENDING") heroTitle = "退款处理中";
  if (order.status === "REFUND_FAILED") heroTitle = "退款需要处理";
  if (order.status === "REFUNDED") heroTitle = "退款已完成";
  if (order.status === "COMPLETED") heroTitle = "订单已完成";
  if (order.status === "EXPIRED") heroTitle = "订单已过期";
  if (order.status === "PAYMENT_EXCEPTION") heroTitle = "支付状态待确认";

  const serverCanCancel = order.allowedActions?.canCancel === true;
  let cancelAction: OwnerCancellationActionPresentation | null = null;
  if (!cancelling && serverCanCancel && order.status === "PENDING_PAYMENT") {
    cancelAction = {
      label: "取消订单",
      title: "确认取消订单？",
      content: "若尚未付款，取消成功后将释放当前场次。",
    };
  } else if (serverCanCancel && order.status === "CONFIRMED") {
    cancelAction = {
      label: "取消并发起全额退款",
      title: "确认取消并发起退款？",
      content: "将提交一笔全额退款申请，结果以服务端为准。",
    };
  } else if (serverCanCancel && order.status === "REFUND_FAILED") {
    cancelAction = {
      label: "重试退款",
      title: "重试退款？",
      content: "将继续处理同一笔全额退款，不会重复扣款。",
    };
  }
  return {
    heroTitle,
    showPayAction: order.status === "PENDING_PAYMENT"
      && !cancelling
      && (order.allowedActions?.canPay ?? true),
    cancelAction,
    shouldPoll: cancelling || order.status === "REFUND_PENDING",
  };
}

export function presentOrderDetailStatus(
  status: OrderDetailPollState["status"] | PaymentPageStatus,
): OrderDetailStatusPresentation {
  if (status === "payment-pending" || status === "creating-prepay" || status === "cashier-open") {
    return {
      heroTitle: "待支付",
      showClosingMessage: false,
      showClosingRetry: false,
      showReselect: false,
      showPaymentRetry: false,
    };
  }
  if (status === "payment-confirming") {
    return {
      heroTitle: "正在确认支付",
      showClosingMessage: false,
      showClosingRetry: false,
      showReselect: false,
      showPaymentRetry: false,
    };
  }
  if (status === "cancellation-confirming") {
    return {
      heroTitle: "正在确认取消",
      showClosingMessage: false,
      showClosingRetry: false,
      showReselect: false,
      showPaymentRetry: false,
    };
  }
  if (status === "payment-exception") {
    return {
      heroTitle: "支付状态待确认",
      showClosingMessage: false,
      showClosingRetry: false,
      showReselect: false,
      showPaymentRetry: true,
    };
  }
  if (status === "booking-confirmed") {
    return {
      heroTitle: "预订成功",
      showClosingMessage: false,
      showClosingRetry: false,
      showReselect: false,
      showPaymentRetry: false,
    };
  }
  if (status === "closing-payment" || status === "closing-error") {
    return {
      heroTitle: "正在关闭支付",
      showClosingMessage: true,
      showClosingRetry: status === "closing-error",
      showReselect: false,
    };
  }
  if (status === "expired") {
    return {
      heroTitle: "订单已过期",
      showClosingMessage: false,
      showClosingRetry: false,
      showReselect: true,
    };
  }
  let terminalTitle: string | undefined;
  if (status === "cancelled") terminalTitle = "订单已取消";
  if (status === "refund-pending") terminalTitle = "退款处理中";
  if (status === "refund-failed") terminalTitle = "退款需要处理";
  if (status === "refunded") terminalTitle = "退款已完成";
  if (status === "completed") terminalTitle = "订单已完成";
  if (terminalTitle) {
    return {
      heroTitle: terminalTitle,
      showClosingMessage: false,
      showClosingRetry: false,
      showReselect: false,
      showPaymentRetry: false,
    };
  }
  return {
    heroTitle: "场次已为你保留",
    showClosingMessage: false,
    showClosingRetry: false,
    showReselect: false,
  };
}

interface OrderDetailPollerOptions {
  readonly getOrder: (orderId: string) => Promise<OrderDetailOrderView>;
  readonly clock: Clock;
  readonly scheduler: PollScheduler;
  readonly onState: (state: OrderDetailPollState) => void;
}

const POLL_INTERVAL_MS = 2_000;
const CLOSING_DEADLINE_MS = 30_000;
const CONFIRMING_HIGH_FREQUENCY_MS = 30_000;

export class OrderDetailPoller {
  private generation = 0;
  private orderId = "";
  private pendingTimer: unknown;
  private pollTimer: unknown;
  private closingDeadlineTimer: unknown;
  private confirmingDeadlineTimer: unknown;
  private requestInFlight = false;
  private pollMode: "closing" | "confirming" | "owner-lifecycle" | null = null;
  private confirmingManual = false;
  private confirmingStartedAtMilliseconds: number | undefined;
  private ownerLifecycleManual = false;
  private ownerLifecycleStartedAtMilliseconds: number | undefined;
  private ownerLifecycleOrder: OrderView | undefined;

  constructor(private readonly options: OrderDetailPollerOptions) {}

  start(orderId: string): void {
    this.cancel();
    this.orderId = orderId;
    const generation = this.generation;
    this.options.onState({ status: "loading" });
    void this.loadInitial(generation);
  }

  retry(): void {
    if (this.orderId) this.start(this.orderId);
  }

  reconcile(): void {
    if (!this.orderId || this.requestInFlight) return;
    void this.refresh(this.generation);
  }

  followOwnerLifecycle(order: OrderView): void {
    this.cancel();
    this.orderId = order.orderId;
    this.ownerLifecycleOrder = order;
    this.enterOwnerLifecycle(order, this.generation);
  }

  cancel(): void {
    this.generation += 1;
    this.requestInFlight = false;
    this.confirmingManual = false;
    this.confirmingStartedAtMilliseconds = undefined;
    this.ownerLifecycleManual = false;
    this.ownerLifecycleStartedAtMilliseconds = undefined;
    this.ownerLifecycleOrder = undefined;
    this.pollMode = null;
    this.clearTimers();
  }

  private isCurrent(generation: number): boolean {
    return generation === this.generation;
  }

  private async loadInitial(generation: number): Promise<void> {
    this.requestInFlight = true;
    try {
      const order = await this.options.getOrder(this.orderId);
      if (!this.isCurrent(generation)) return;
      this.applyOrder(order, generation);
    } catch {
      if (!this.isCurrent(generation)) return;
      this.options.onState({
        status: "load-error",
        message: "订单加载失败，请重试。",
        retryable: true,
      });
    } finally {
      if (this.isCurrent(generation)) this.requestInFlight = false;
    }
  }

  private applyOrder(order: OrderDetailOrderView, generation: number): void {
    if (this.isStaleOwnerLifecycleProjection(order)) return;
    const ownerPresentation = presentOwnerOrderLifecycle(order);
    if (ownerPresentation.shouldPoll) {
      this.ownerLifecycleOrder = order;
      this.enterOwnerLifecycle(order, generation);
      return;
    }
    this.ownerLifecycleOrder = undefined;
    if (order.status === "CANCELLED") {
      this.clearTimers();
      this.options.onState({ status: "cancelled", order });
      return;
    }
    if (order.status === "REFUND_FAILED") {
      this.clearTimers();
      this.options.onState({ status: "refund-failed", order });
      return;
    }
    if (order.status === "REFUNDED") {
      this.clearTimers();
      this.options.onState({ status: "refunded", order });
      return;
    }
    if (order.status === "COMPLETED") {
      this.clearTimers();
      this.options.onState({ status: "completed", order });
      return;
    }
    if (order.status === "EXPIRED") {
      this.clearTimers();
      this.options.onState({ status: "expired", order });
      return;
    }
    if (order.status === "CONFIRMED") {
      this.confirmingStartedAtMilliseconds = undefined;
      this.clearTimers();
      this.options.onState({ status: "booking-confirmed", order });
      return;
    }
    if (order.status === "PAYMENT_EXCEPTION") {
      this.confirmingStartedAtMilliseconds = undefined;
      this.clearTimers();
      this.options.onState({ status: "payment-exception", order });
      return;
    }
    // REFUND_PENDING is handled by the owner lifecycle branch above. Keep the
    // discriminated union explicit for TypeScript before entering payment-only logic.
    if (order.status === "REFUND_PENDING") return;
    if ("paymentConfirming" in order && order.paymentConfirming) {
      this.enterConfirming(order, generation);
      return;
    }
    this.confirmingManual = false;
    this.confirmingStartedAtMilliseconds = undefined;
    this.pollMode = null;
    const milliseconds = new Date(order.expiresAt).getTime() - this.options.clock.now().getTime();
    if (order.closingPayment || milliseconds <= 0) {
      this.enterClosing(order, generation);
      return;
    }
    const seconds = Math.ceil(milliseconds / 1_000);
    this.options.onState({ status: "pending-payment", order, seconds });
    this.pendingTimer = this.options.scheduler.setTimeout(
      () => this.applyOrder(order, generation),
      Math.min(1_000, milliseconds),
    );
  }

  private enterClosing(order: PendingOrderView, generation: number): void {
    this.clearTimers();
    this.confirmingStartedAtMilliseconds = undefined;
    this.pollMode = "closing";
    this.options.onState({ status: "closing-payment", order });
    this.closingDeadlineTimer = this.options.scheduler.setTimeout(
      () => this.failClosing(generation),
      CLOSING_DEADLINE_MS,
    );
    this.schedulePoll(generation);
  }

  private schedulePoll(generation: number): void {
    this.pollTimer = this.options.scheduler.setTimeout(
      () => {
        this.pollTimer = undefined;
        void this.poll(generation);
      },
      POLL_INTERVAL_MS,
    );
  }

  private enterConfirming(
    order: Extract<PaymentOrderView, { status: "PENDING_PAYMENT" }>,
    generation: number,
  ): void {
    this.clearTimers();
    this.pollMode = "confirming";
    this.confirmingStartedAtMilliseconds ??= this.options.clock.now().getTime();
    const elapsed = this.options.clock.now().getTime() - this.confirmingStartedAtMilliseconds;
    if (elapsed >= CONFIRMING_HIGH_FREQUENCY_MS) this.confirmingManual = true;
    this.options.onState({
      status: "payment-confirming",
      order,
      showManualReconcile: this.confirmingManual,
    });
    if (this.confirmingManual) return;
    this.confirmingDeadlineTimer = this.options.scheduler.setTimeout(
      () => this.stopHighFrequencyConfirmation(generation, order),
      CONFIRMING_HIGH_FREQUENCY_MS - elapsed,
    );
    this.schedulePoll(generation);
  }

  private enterOwnerLifecycle(order: OrderView, generation: number): void {
    this.clearTimers();
    this.pollMode = "owner-lifecycle";
    this.ownerLifecycleStartedAtMilliseconds ??= this.options.clock.now().getTime();
    const elapsed = this.options.clock.now().getTime() - this.ownerLifecycleStartedAtMilliseconds;
    if (elapsed >= CONFIRMING_HIGH_FREQUENCY_MS) this.ownerLifecycleManual = true;
    if (order.status === "PENDING_PAYMENT") {
      this.options.onState({
        status: "cancellation-confirming",
        order,
        showManualRefresh: this.ownerLifecycleManual,
      });
    } else if (order.status === "REFUND_PENDING") {
      this.options.onState({
        status: "refund-pending",
        order,
        showManualRefresh: this.ownerLifecycleManual,
      });
    }
    if (this.ownerLifecycleManual) return;
    this.confirmingDeadlineTimer = this.options.scheduler.setTimeout(
      () => this.stopOwnerLifecyclePolling(generation, order),
      CONFIRMING_HIGH_FREQUENCY_MS - elapsed,
    );
    this.schedulePoll(generation);
  }

  private async poll(generation: number): Promise<void> {
    if (!this.isCurrent(generation) || this.requestInFlight) return;
    this.requestInFlight = true;
    try {
      const order = await this.options.getOrder(this.orderId);
      if (!this.isCurrent(generation)) return;
      this.applyOrder(order, generation);
    } catch {
      // Closing is eventually consistent. Keep polling until the hard deadline.
    } finally {
      if (this.isCurrent(generation)) {
        this.requestInFlight = false;
        const activeDeadline = this.pollMode === "closing"
          ? this.closingDeadlineTimer
          : this.confirmingDeadlineTimer;
        if (activeDeadline !== undefined && this.pollTimer === undefined) this.schedulePoll(generation);
      }
    }
  }

  private async refresh(generation: number): Promise<void> {
    this.requestInFlight = true;
    try {
      const order = await this.options.getOrder(this.orderId);
      if (this.isCurrent(generation)) this.applyOrder(order, generation);
    } catch {
      if (this.isCurrent(generation) && this.pollMode === "confirming") {
        this.confirmingManual = true;
      }
      if (this.isCurrent(generation) && this.pollMode === "owner-lifecycle") {
        this.ownerLifecycleManual = true;
      }
    } finally {
      if (this.isCurrent(generation)) this.requestInFlight = false;
    }
  }

  private stopHighFrequencyConfirmation(
    generation: number,
    order: Extract<PaymentOrderView, { status: "PENDING_PAYMENT" }>,
  ): void {
    if (!this.isCurrent(generation) || this.pollMode !== "confirming") return;
    this.confirmingManual = true;
    if (this.pollTimer !== undefined) this.options.scheduler.clearTimeout(this.pollTimer);
    this.pollTimer = undefined;
    this.confirmingDeadlineTimer = undefined;
    this.options.onState({ status: "payment-confirming", order, showManualReconcile: true });
  }

  private stopOwnerLifecyclePolling(generation: number, order: OrderView): void {
    if (!this.isCurrent(generation) || this.pollMode !== "owner-lifecycle") return;
    this.ownerLifecycleManual = true;
    if (this.pollTimer !== undefined) this.options.scheduler.clearTimeout(this.pollTimer);
    this.pollTimer = undefined;
    this.confirmingDeadlineTimer = undefined;
    if (order.status === "PENDING_PAYMENT") {
      this.options.onState({ status: "cancellation-confirming", order, showManualRefresh: true });
    } else if (order.status === "REFUND_PENDING") {
      this.options.onState({ status: "refund-pending", order, showManualRefresh: true });
    }
  }

  private isStaleOwnerLifecycleProjection(order: OrderDetailOrderView): boolean {
    const current = this.ownerLifecycleOrder;
    if (!current) return false;
    if (current.status === "PENDING_PAYMENT" && current.cancelRequestedAt != null) {
      return order.status === "PENDING_PAYMENT" && order.cancelRequestedAt == null;
    }
    return current.status === "REFUND_PENDING" && order.status === "CONFIRMED";
  }

  private failClosing(generation: number): void {
    if (!this.isCurrent(generation)) return;
    this.generation += 1;
    this.requestInFlight = false;
    this.clearTimers();
    this.options.onState({
      status: "closing-error",
      message: "订单关闭处理中，请稍后重试。",
      retryable: true,
    });
  }

  private clearTimers(): void {
    if (this.pendingTimer !== undefined) this.options.scheduler.clearTimeout(this.pendingTimer);
    if (this.pollTimer !== undefined) this.options.scheduler.clearTimeout(this.pollTimer);
    if (this.closingDeadlineTimer !== undefined) this.options.scheduler.clearTimeout(this.closingDeadlineTimer);
    if (this.confirmingDeadlineTimer !== undefined) this.options.scheduler.clearTimeout(this.confirmingDeadlineTimer);
    this.pendingTimer = undefined;
    this.pollTimer = undefined;
    this.closingDeadlineTimer = undefined;
    this.confirmingDeadlineTimer = undefined;
  }
}
