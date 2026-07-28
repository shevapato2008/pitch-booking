import { describe, expect, test } from "@jest/globals";

import type { PaymentOrderView } from "../domain/payment";
import { PAYMENT_SCENARIOS } from "../dev/payment-scenarios";
import {
  initialPaymentPageState,
  reducePayment,
} from "./payment";

const pendingOrder = (): PaymentOrderView => structuredClone(PAYMENT_SCENARIOS.pending);

describe("payment presentation state machine", () => {
  test("ready + PAY_STARTED enters creating-prepay with the supplied key", () => {
    const state = initialPaymentPageState(pendingOrder());

    expect(reducePayment(state, { type: "PAY_STARTED", idempotencyKey: "pay-key-1" })).toMatchObject({
      status: "creating-prepay",
      idempotencyKey: "pay-key-1",
    });
  });

  test("cashier-open + CASHIER_CANCELLED returns to payment-pending", () => {
    const open = reducePayment(
      reducePayment(initialPaymentPageState(pendingOrder()), { type: "PAY_STARTED", idempotencyKey: "pay-key-1" }),
      {
        type: "PREPAY_CREATED",
        idempotencyKey: "pay-key-1",
        paymentId: "payment-current",
        launchParams: PAYMENT_SCENARIOS.launchParams,
      },
    );

    expect(reducePayment(open, { type: "CASHIER_CANCELLED" })).toMatchObject({
      status: "payment-pending",
      idempotencyKey: null,
      paymentId: "payment-current",
    });
  });

  test("cashier-open + CASHIER_SUCCEEDED enters payment-confirming", () => {
    const open = reducePayment(
      reducePayment(initialPaymentPageState(pendingOrder()), { type: "PAY_STARTED", idempotencyKey: "pay-key-1" }),
      {
        type: "PREPAY_CREATED",
        idempotencyKey: "pay-key-1",
        paymentId: "payment-current",
        launchParams: PAYMENT_SCENARIOS.launchParams,
      },
    );

    const confirming = reducePayment(open, { type: "CASHIER_SUCCEEDED" });

    expect(confirming.status).toBe("payment-confirming");
    expect(confirming.order).toEqual(PAYMENT_SCENARIOS.pending);
    expect(confirming.order?.status).not.toBe("CONFIRMED");
  });

  test("confirming + authoritative confirmed ORDER_RECEIVED enters booking-confirmed", () => {
    const confirming = {
      ...initialPaymentPageState(pendingOrder()),
      status: "payment-confirming" as const,
      paymentId: "payment-current",
    };

    expect(reducePayment(confirming, {
      type: "ORDER_RECEIVED",
      order: structuredClone(PAYMENT_SCENARIOS.confirmed),
    })).toMatchObject({
      status: "booking-confirmed",
      order: { status: "CONFIRMED", paymentState: "SUCCESS" },
    });
  });

  test.each(["PAY_CREATE_UNKNOWN", "PAY_CREATE_RETRY"] as const)(
    "%s retains the idempotency key for the same create operation",
    (type) => {
      const creating = reducePayment(initialPaymentPageState(pendingOrder()), {
        type: "PAY_STARTED",
        idempotencyKey: "stable-key",
      });

      expect(reducePayment(creating, { type, idempotencyKey: "stable-key" })).toMatchObject({
        status: "creating-prepay",
        idempotencyKey: "stable-key",
      });
    },
  );

  test.each(["CASHIER_CANCELLED", "CASHIER_FAILED"] as const)(
    "%s ends the old operation so a new click can use a new key",
    (type) => {
      const open = reducePayment(
        reducePayment(initialPaymentPageState(pendingOrder()), { type: "PAY_STARTED", idempotencyKey: "old-key" }),
        {
          type: "PREPAY_CREATED",
          idempotencyKey: "old-key",
          paymentId: "payment-current",
          launchParams: PAYMENT_SCENARIOS.launchParams,
        },
      );
      const pending = reducePayment(open, type === "CASHIER_FAILED"
        ? { type, message: "收银台调起失败" }
        : { type });

      const next = reducePayment(pending, { type: "PAY_STARTED", idempotencyKey: "new-key" });

      expect(next).toMatchObject({ status: "creating-prepay", idempotencyKey: "new-key" });
    },
  );

  test("loading and error retain the last real order", () => {
    const ready = initialPaymentPageState(pendingOrder());
    const loading = reducePayment(ready, { type: "ORDER_LOADING" });
    const failed = reducePayment(loading, { type: "ORDER_FAILED", message: "网络异常" });

    expect(loading.order).toEqual(PAYMENT_SCENARIOS.pending);
    expect(failed).toMatchObject({
      status: "load-error",
      order: PAYMENT_SCENARIOS.pending,
      errorMessage: "网络异常",
    });
  });
});
