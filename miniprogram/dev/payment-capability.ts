import type {
  PaymentCapability,
  PaymentCapabilityResult,
} from "../domain/payment";

export type DevelopmentCashierScenario =
  | "success"
  | "user-cancel"
  | "launch-failure"
  | "delayed-confirmation";

export type DevelopmentCashierPrompt = () => Promise<"success" | "cancel" | "failure">;

export const DEVELOPMENT_CASHIER_NOTICE = "模拟支付，不会扣款";

export const showDevelopmentCashier: DevelopmentCashierPrompt = () => new Promise((resolve) => {
  wx.showModal({
    title: "开发态模拟收银台",
    content: DEVELOPMENT_CASHIER_NOTICE,
    confirmText: "模拟成功",
    cancelText: "取消",
    success(result) { resolve(result.confirm ? "success" : "cancel"); },
    fail() { resolve("failure"); },
  });
});

export function createDevelopmentPaymentCapability(
  scenario: DevelopmentCashierScenario,
  prompt?: DevelopmentCashierPrompt,
): PaymentCapability {
  return {
    async requestPayment(): Promise<PaymentCapabilityResult> {
      if (scenario === "user-cancel") return { outcome: "user_cancelled" };
      if (scenario === "launch-failure") {
        return { outcome: "launch_failed", message: "模拟收银台调起失败" };
      }
      if (prompt) {
        const result = await prompt();
        if (result === "cancel") return { outcome: "user_cancelled" };
        if (result === "failure") {
          return { outcome: "launch_failed", message: "模拟收银台调起失败" };
        }
      }
      return { outcome: "cashier_success" };
    },
  };
}
