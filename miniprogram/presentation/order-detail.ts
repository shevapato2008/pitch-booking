import type { Clock } from "../runtime/interfaces";
import type { OrderView, PendingOrderView } from "../domain/booking";

export type OrderDetailPollState =
  | { readonly status: "loading" }
  | { readonly status: "load-error"; readonly message: string; readonly retryable: true }
  | { readonly status: "pending-payment"; readonly order: PendingOrderView; readonly seconds: number }
  | { readonly status: "closing-payment"; readonly order: PendingOrderView }
  | { readonly status: "closing-error"; readonly message: string; readonly retryable: true }
  | { readonly status: "expired"; readonly order: Extract<OrderView, { status: "EXPIRED" }> };

export interface PollScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface OrderDetailStatusPresentation {
  readonly heroTitle: string;
  readonly showClosingMessage: boolean;
  readonly showClosingRetry: boolean;
  readonly showReselect: boolean;
}

export function presentOrderDetailStatus(
  status: OrderDetailPollState["status"],
): OrderDetailStatusPresentation {
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
  return {
    heroTitle: "场次已为你保留",
    showClosingMessage: false,
    showClosingRetry: false,
    showReselect: false,
  };
}

interface OrderDetailPollerOptions {
  readonly getOrder: (orderId: string) => Promise<OrderView>;
  readonly clock: Clock;
  readonly scheduler: PollScheduler;
  readonly onState: (state: OrderDetailPollState) => void;
}

const POLL_INTERVAL_MS = 2_000;
const CLOSING_DEADLINE_MS = 30_000;

export class OrderDetailPoller {
  private generation = 0;
  private orderId = "";
  private pendingTimer: unknown;
  private pollTimer: unknown;
  private closingDeadlineTimer: unknown;
  private requestInFlight = false;

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

  cancel(): void {
    this.generation += 1;
    this.requestInFlight = false;
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

  private applyOrder(order: OrderView, generation: number): void {
    if (order.status === "EXPIRED") {
      this.clearTimers();
      this.options.onState({ status: "expired", order });
      return;
    }
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
    this.options.onState({ status: "closing-payment", order });
    this.closingDeadlineTimer = this.options.scheduler.setTimeout(
      () => this.failClosing(generation),
      CLOSING_DEADLINE_MS,
    );
    this.schedulePoll(generation);
  }

  private schedulePoll(generation: number): void {
    this.pollTimer = this.options.scheduler.setTimeout(
      () => { void this.poll(generation); },
      POLL_INTERVAL_MS,
    );
  }

  private async poll(generation: number): Promise<void> {
    if (!this.isCurrent(generation) || this.requestInFlight) return;
    this.requestInFlight = true;
    try {
      const order = await this.options.getOrder(this.orderId);
      if (!this.isCurrent(generation)) return;
      if (order.status === "EXPIRED") {
        this.clearTimers();
        this.options.onState({ status: "expired", order });
        return;
      }
      this.options.onState({ status: "closing-payment", order });
    } catch {
      // Closing is eventually consistent. Keep polling until the hard deadline.
    } finally {
      if (this.isCurrent(generation)) {
        this.requestInFlight = false;
        if (this.closingDeadlineTimer !== undefined) this.schedulePoll(generation);
      }
    }
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
    this.pendingTimer = undefined;
    this.pollTimer = undefined;
    this.closingDeadlineTimer = undefined;
  }
}
