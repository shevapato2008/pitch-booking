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

export function createDevelopmentPaymentDataSource(
  projection: DevelopmentPaymentProjection = "pending",
): PaymentDataSource {
  const currentOrder = (): PaymentOrderView => cloneOrder(PAYMENT_SCENARIOS[projection]);
  const assertOrder = (orderId: string): void => {
    if (orderId !== PAYMENT_SCENARIOS.pending.orderId) throw new Error("ORDER_NOT_FOUND");
  };

  return {
    async createPayment(orderId: string): Promise<PaymentLaunchResult> {
      assertOrder(orderId);
      if (projection === "confirmed") {
        return { outcome: "ALREADY_CONFIRMED", order: cloneOrder(PAYMENT_SCENARIOS.confirmed) };
      }
      if (projection === "confirming") {
        return { outcome: "PAYMENT_CONFIRMING", paymentId: CURRENT_PAYMENT_ID };
      }
      return {
        outcome: "PREPAY_CREATED",
        paymentId: CURRENT_PAYMENT_ID,
        launchParams: { ...PAYMENT_SCENARIOS.launchParams },
      };
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
