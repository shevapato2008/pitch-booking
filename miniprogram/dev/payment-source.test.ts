import { describe, expect, test } from "@jest/globals";

import { PAYMENT_SCENARIOS } from "./payment-scenarios";
import { createDevelopmentPaymentDataSource } from "./payment-source";

describe("development payment data source", () => {
  test("pending, confirming, and confirmed projections share one stable booking snapshot", () => {
    const authorityFields = ["status", "paymentState", "paymentConfirming", "paidAt"] as const;
    const withoutAuthority = (order: object) => Object.fromEntries(
      Object.entries(order).filter(([key]) => !authorityFields.includes(key as typeof authorityFields[number])),
    );

    expect(withoutAuthority(PAYMENT_SCENARIOS.pending)).toEqual(withoutAuthority(PAYMENT_SCENARIOS.confirming));
    expect(withoutAuthority(PAYMENT_SCENARIOS.pending)).toEqual(withoutAuthority(PAYMENT_SCENARIOS.confirmed));
    expect(PAYMENT_SCENARIOS.pending).toMatchObject({ status: "PENDING_PAYMENT", paymentConfirming: false, paidAt: null });
    expect(PAYMENT_SCENARIOS.confirming).toMatchObject({ status: "PENDING_PAYMENT", paymentState: "CONFIRMING", paymentConfirming: true, paidAt: null });
    expect(PAYMENT_SCENARIOS.confirmed).toMatchObject({ status: "CONFIRMED", paymentState: "SUCCESS", paymentConfirming: false });
  });

  test("a new client key reuses the server's current nonterminal payment", async () => {
    const source = createDevelopmentPaymentDataSource("pending");

    const first = await source.createPayment(PAYMENT_SCENARIOS.pending.orderId, "client-key-1");
    const second = await source.createPayment(PAYMENT_SCENARIOS.pending.orderId, "client-key-2");

    expect(first).toMatchObject({ outcome: "PREPAY_CREATED" });
    expect(second).toEqual(first);
    if (first.outcome === "PREPAY_CREATED" && second.outcome === "PREPAY_CREATED") {
      expect(second.paymentId).toBe(first.paymentId);
    }
  });

  test("reconciliation returns the deterministic confirming projection", async () => {
    const source = createDevelopmentPaymentDataSource("pending");
    const launch = await source.createPayment(PAYMENT_SCENARIOS.pending.orderId, "client-key-1");
    if (launch.outcome !== "PREPAY_CREATED") throw new Error("expected fixture prepay");

    const result = await source.reconcilePayment(PAYMENT_SCENARIOS.pending.orderId, launch.paymentId);

    expect(result).toEqual({
      outcome: "PAYMENT_CONFIRMING",
      order: PAYMENT_SCENARIOS.confirming,
    });
  });

  test.each(["pending", "confirming", "confirmed"] as const)(
    "%s source returns a defensive copy of its deterministic projection",
    async (scenario) => {
      const source = createDevelopmentPaymentDataSource(scenario);
      const order = await source.getOrder(PAYMENT_SCENARIOS.pending.orderId);

      expect(order).toEqual(PAYMENT_SCENARIOS[scenario]);
      expect(order).not.toBe(PAYMENT_SCENARIOS[scenario]);
      expect(order.venue).not.toBe(PAYMENT_SCENARIOS[scenario].venue);
    },
  );
});
