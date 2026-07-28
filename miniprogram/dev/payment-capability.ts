import type {
  PaymentCapability,
  PaymentCapabilityResult,
} from "../domain/payment";

export type DevelopmentCashierScenario =
  | "success"
  | "user-cancel"
  | "launch-failure"
  | "delayed-confirmation";

export function createDevelopmentPaymentCapability(
  scenario: DevelopmentCashierScenario,
): PaymentCapability {
  return {
    async requestPayment(): Promise<PaymentCapabilityResult> {
      if (scenario === "user-cancel") return { outcome: "user_cancelled" };
      if (scenario === "launch-failure") {
        return { outcome: "launch_failed", message: "模拟收银台调起失败" };
      }
      return { outcome: "cashier_success" };
    },
  };
}
