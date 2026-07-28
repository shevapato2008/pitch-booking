import { beforeEach, describe, expect, test } from "@jest/globals";

import type { PaymentCapability, PaymentDataSource } from "../domain/payment";
import { PAYMENT_SCENARIOS } from "../dev/payment-scenarios";
import { createDevelopmentPaymentCapability } from "../dev/payment-capability";
import { createDevelopmentPaymentDataSource } from "../dev/payment-source";
import {
  getPaymentBindings,
  registerPaymentCapability,
  registerPaymentDataSource,
  resetPaymentBindingsForTesting,
} from "./payment";

beforeEach(() => resetPaymentBindingsForTesting());

describe("payment runtime registry", () => {
  test("starts unconfigured and exposes only explicitly registered narrow bindings", () => {
    expect(getPaymentBindings()).toBeUndefined();

    const source: PaymentDataSource = createDevelopmentPaymentDataSource("pending");
    const capability: PaymentCapability = createDevelopmentPaymentCapability("success");
    registerPaymentDataSource(source);
    expect(getPaymentBindings()).toBeUndefined();
    registerPaymentCapability(capability);

    expect(getPaymentBindings()).toEqual({ source, capability });
  });

  test("development source follows pending, confirming, confirmed with one payment id and fresh reads", async () => {
    const source = createDevelopmentPaymentDataSource({
      initial: "pending",
      reconciliation: "confirmed",
    });
    const first = await source.getOrder(PAYMENT_SCENARIOS.pending.orderId);
    const launch = await source.createPayment(PAYMENT_SCENARIOS.pending.orderId, "key-1");
    if (launch.outcome !== "PREPAY_CREATED") throw new Error("expected prepay");
    const reused = await source.createPayment(PAYMENT_SCENARIOS.pending.orderId, "key-2");
    const reconciling = await source.reconcilePayment(PAYMENT_SCENARIOS.pending.orderId, launch.paymentId);
    const confirmed = await source.getOrder(PAYMENT_SCENARIOS.pending.orderId);

    expect(first).toEqual(PAYMENT_SCENARIOS.pending);
    expect(first).not.toBe(PAYMENT_SCENARIOS.pending);
    expect(reused).toMatchObject({ paymentId: launch.paymentId });
    expect(reconciling).toMatchObject({ outcome: "PAYMENT_CONFIRMING", order: PAYMENT_SCENARIOS.confirming });
    expect(confirmed).toEqual(PAYMENT_SCENARIOS.confirmed);
    expect(confirmed).not.toBe(PAYMENT_SCENARIOS.confirmed);
  });

  test("development source exposes exception only through an explicit authoritative sequence", async () => {
    const source = createDevelopmentPaymentDataSource({
      initial: "confirming",
      reconciliation: "payment-exception",
    });

    expect(await source.getOrder(PAYMENT_SCENARIOS.pending.orderId)).toEqual(PAYMENT_SCENARIOS.confirming);
    const result = await source.reconcilePayment(
      PAYMENT_SCENARIOS.pending.orderId,
      "00000000-0000-4000-8000-000000000050",
    );

    expect(result).toEqual({ outcome: "TERMINAL", order: PAYMENT_SCENARIOS.exception });
  });

  test("development source can delay authoritative confirmation without manufacturing client success", async () => {
    const source = createDevelopmentPaymentDataSource({
      initial: "pending",
      reconciliation: "confirmed",
      confirmingReadsBeforeTerminal: 2,
    });
    const launch = await source.createPayment(PAYMENT_SCENARIOS.pending.orderId, "key-1");
    if (launch.outcome !== "PREPAY_CREATED") throw new Error("expected prepay");

    await source.reconcilePayment(PAYMENT_SCENARIOS.pending.orderId, launch.paymentId);
    expect(await source.getOrder(PAYMENT_SCENARIOS.pending.orderId)).toEqual(PAYMENT_SCENARIOS.confirming);
    expect(await source.getOrder(PAYMENT_SCENARIOS.pending.orderId)).toEqual(PAYMENT_SCENARIOS.confirming);
    expect(await source.getOrder(PAYMENT_SCENARIOS.pending.orderId)).toEqual(PAYMENT_SCENARIOS.confirmed);
  });
});
