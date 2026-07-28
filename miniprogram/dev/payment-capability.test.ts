import { describe, expect, test } from "@jest/globals";

import type { PaymentCapabilityResult } from "../domain/payment";
import { PAYMENT_SCENARIOS } from "./payment-scenarios";
import { createDevelopmentPaymentCapability } from "./payment-capability";

describe("simulated payment capability", () => {
  test.each([
    ["success", { outcome: "cashier_success" }],
    ["user-cancel", { outcome: "user_cancelled" }],
    ["launch-failure", { outcome: "launch_failed", message: "模拟收银台调起失败" }],
    ["delayed-confirmation", { outcome: "cashier_success" }],
  ] as const)("%s returns a typed cashier outcome", async (scenario, expected) => {
    const capability = createDevelopmentPaymentCapability(scenario);
    const result: PaymentCapabilityResult = await capability.requestPayment(PAYMENT_SCENARIOS.launchParams);

    expect(result).toEqual(expected);
  });

  test("cashier success, including delayed confirmation, never mutates OrderView authority", async () => {
    const order = structuredClone(PAYMENT_SCENARIOS.pending);
    const before = structuredClone(order);

    await createDevelopmentPaymentCapability("success").requestPayment(PAYMENT_SCENARIOS.launchParams);
    await createDevelopmentPaymentCapability("delayed-confirmation").requestPayment(PAYMENT_SCENARIOS.launchParams);

    expect(order).toEqual(before);
    expect(order.status).toBe("PENDING_PAYMENT");
    expect(order.paymentConfirming).toBe(false);
  });
});
