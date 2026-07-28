import type {
  PaymentDataSource,
  PaymentLaunchResult,
  PaymentOrderView,
} from "../domain/payment";
import {
  PAYMENT_SCENARIOS,
  type DevelopmentPaymentProjection,
} from "./payment-scenarios";

const CURRENT_PAYMENT_ID = "00000000-0000-4000-8000-000000000050";

export interface DevelopmentPaymentSequence {
  readonly initial: DevelopmentPaymentProjection;
  readonly reconciliation: "confirming" | "confirmed" | "payment-exception";
  readonly confirmingReadsBeforeTerminal?: number;
}

function cloneOrder<T extends PaymentOrderView>(order: T): T {
  return {
    ...order,
    venue: { ...order.venue },
    pitch: { ...order.pitch },
    contact: { ...order.contact },
  };
}

function cloneLaunchResult(result: PaymentLaunchResult): PaymentLaunchResult {
  if (result.outcome === "PREPAY_CREATED") {
    return { ...result, launchParams: { ...result.launchParams } };
  }
  if (result.outcome === "ALREADY_CONFIRMED") {
    return { ...result, order: cloneOrder(result.order) };
  }
  return { ...result };
}

export function createDevelopmentPaymentDataSource(
  selection: DevelopmentPaymentProjection | DevelopmentPaymentSequence = "pending",
): PaymentDataSource {
  let projection = typeof selection === "string" ? selection : selection.initial;
  const reconciliation = typeof selection === "string" ? selection : selection.reconciliation;
  let nextProjection: DevelopmentPaymentProjection | null = null;
  let confirmingReadsBeforeTerminal = typeof selection === "string"
    ? 0
    : selection.confirmingReadsBeforeTerminal ?? 0;
  const resultsByKey = new Map<string, PaymentLaunchResult>();
  const currentOrder = (): PaymentOrderView => {
    if (nextProjection !== null) {
      if (confirmingReadsBeforeTerminal > 0) {
        confirmingReadsBeforeTerminal -= 1;
      } else {
        projection = nextProjection;
        nextProjection = null;
      }
    }
    if (projection === "payment-exception") return cloneOrder(PAYMENT_SCENARIOS.exception);
    return cloneOrder(PAYMENT_SCENARIOS[projection]);
  };
  const assertOrder = (orderId: string): void => {
    if (orderId !== PAYMENT_SCENARIOS.pending.orderId) throw new Error("ORDER_NOT_FOUND");
  };

  return {
    async createPayment(orderId: string, idempotencyKey: string): Promise<PaymentLaunchResult> {
      assertOrder(orderId);
      if (idempotencyKey.length === 0) throw new Error("IDEMPOTENCY_KEY_REQUIRED");
      const replay = resultsByKey.get(idempotencyKey);
      if (replay) return cloneLaunchResult(replay);

      let result: PaymentLaunchResult;
      if (projection === "confirmed") {
        result = { outcome: "ALREADY_CONFIRMED", order: cloneOrder(PAYMENT_SCENARIOS.confirmed) };
      } else if (projection === "confirming" || projection === "payment-exception") {
        result = { outcome: "PAYMENT_CONFIRMING", paymentId: CURRENT_PAYMENT_ID };
      } else {
        result = {
          outcome: "PREPAY_CREATED",
          paymentId: CURRENT_PAYMENT_ID,
          launchParams: { ...PAYMENT_SCENARIOS.launchParams },
        };
      }
      resultsByKey.set(idempotencyKey, cloneLaunchResult(result));
      return cloneLaunchResult(result);
    },
    async reconcilePayment(orderId: string, paymentId: string) {
      assertOrder(orderId);
      if (paymentId !== CURRENT_PAYMENT_ID) throw new Error("PAYMENT_NOT_FOUND");
      if (projection === "confirmed" || reconciliation === "confirmed" && typeof selection === "string") {
        return { outcome: "TERMINAL", order: cloneOrder(PAYMENT_SCENARIOS.confirmed) };
      }
      if (reconciliation === "payment-exception") {
        projection = "payment-exception";
        return { outcome: "TERMINAL", order: cloneOrder(PAYMENT_SCENARIOS.exception) };
      }
      if (reconciliation === "confirmed") nextProjection = "confirmed";
      projection = "confirming";
      return {
        outcome: "PAYMENT_CONFIRMING",
        order: cloneOrder(PAYMENT_SCENARIOS.confirming),
      };
    },
    async getOrder(orderId: string) {
      assertOrder(orderId);
      return currentOrder();
    },
  };
}
