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
  projection: DevelopmentPaymentProjection = "pending",
): PaymentDataSource {
  const resultsByKey = new Map<string, PaymentLaunchResult>();
  const currentOrder = (): PaymentOrderView => cloneOrder(PAYMENT_SCENARIOS[projection]);
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
      } else if (projection === "confirming") {
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
      if (projection === "confirmed") {
        return { outcome: "TERMINAL", order: cloneOrder(PAYMENT_SCENARIOS.confirmed) };
      }
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
