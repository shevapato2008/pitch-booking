import { describe, expect, test } from "@jest/globals";

import type {
  ConfirmedOrderView,
  PaymentExceptionOrderView,
  PaymentPendingOrderView,
} from "../domain/payment";
import type { ExpiredOrderView } from "../domain/booking";
import { PAYMENT_SCENARIOS } from "../dev/payment-scenarios";
import {
  initialPaymentPageState,
  reducePayment,
  type PaymentPageState,
} from "./payment";

const pendingOrder = (): PaymentPendingOrderView => structuredClone(PAYMENT_SCENARIOS.pending);
const confirmedOrder = (): ConfirmedOrderView => structuredClone(PAYMENT_SCENARIOS.confirmed);
const exceptionOrder = (): PaymentExceptionOrderView => structuredClone(PAYMENT_SCENARIOS.exception);

function cashierOpenState(): PaymentPageState {
  return reducePayment(
    reducePayment(initialPaymentPageState(pendingOrder()), {
      type: "PAY_STARTED",
      idempotencyKey: "pay-key-1",
    }),
    {
      type: "PREPAY_CREATED",
      idempotencyKey: "pay-key-1",
      paymentId: "payment-current",
      launchParams: PAYMENT_SCENARIOS.launchParams,
    },
  );
}

describe("payment presentation state machine", () => {
  test.each([
    [PAYMENT_SCENARIOS.pending, "ready"],
    [PAYMENT_SCENARIOS.confirming, "payment-confirming"],
    [PAYMENT_SCENARIOS.exception, "payment-exception"],
    [PAYMENT_SCENARIOS.confirmed, "booking-confirmed"],
  ] as const)("initial authority projects to %s state", (order, status) => {
    expect(initialPaymentPageState(structuredClone(order)).status).toBe(status);
  });

  test("an initially confirming order ignores PAY_STARTED", () => {
    const confirming = initialPaymentPageState(structuredClone(PAYMENT_SCENARIOS.confirming));

    expect(reducePayment(confirming, {
      type: "PAY_STARTED",
      idempotencyKey: "must-not-start",
    })).toBe(confirming);
  });

  test("state variants reject authority and operation contradictions at compile time", () => {
    const ready: Extract<PaymentPageState, { status: "ready" }> = {
      status: "ready",
      order: pendingOrder(),
      paymentId: null,
      errorMessage: null,
    };

    // @ts-expect-error booking-confirmed requires an authoritative confirmed order
    const falseConfirmation: PaymentPageState = { ...ready, status: "booking-confirmed" };
    // @ts-expect-error cashier-open requires a pending order
    const confirmedCashier: PaymentPageState = {
      status: "cashier-open",
      order: confirmedOrder(),
      idempotencyKey: "key-1",
      paymentId: "payment-1",
      launchParams: PAYMENT_SCENARIOS.launchParams,
      errorMessage: null,
    };
    const keylessCreate: PaymentPageState = {
      status: "creating-prepay",
      order: pendingOrder(),
      // @ts-expect-error creating-prepay requires a non-null operation key
      idempotencyKey: null,
      paymentId: null,
      launchParams: null,
      errorMessage: null,
    };

    expect([falseConfirmation, confirmedCashier, keylessCreate]).toHaveLength(3);
  });

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

    const cancelled = reducePayment(open, { type: "CASHIER_CANCELLED" });

    expect(cancelled).toMatchObject({
      status: "payment-pending",
      paymentId: "payment-current",
    });
    expect("idempotencyKey" in cancelled).toBe(false);
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

  test("background refresh preserves cashier operation until its outcome", () => {
    const open = cashierOpenState();
    const loading = reducePayment(open, { type: "ORDER_LOADING" });
    const refreshed = reducePayment(loading, {
      type: "ORDER_RECEIVED",
      order: {
        ...pendingOrder(),
        paymentState: "PREPAY_CREATED",
      },
    });

    expect(refreshed).toMatchObject({
      status: "cashier-open",
      idempotencyKey: "pay-key-1",
      paymentId: "payment-current",
      launchParams: PAYMENT_SCENARIOS.launchParams,
      order: { paymentState: "PREPAY_CREATED" },
    });
    expect(reducePayment(refreshed, { type: "CASHIER_SUCCEEDED" })).toMatchObject({
      status: "payment-confirming",
      paymentId: "payment-current",
    });
  });

  test.each(["creating-prepay", "cashier-open"] as const)(
    "background load failure does not discard %s operation",
    (activeStatus) => {
      const creating = reducePayment(initialPaymentPageState(pendingOrder()), {
        type: "PAY_STARTED",
        idempotencyKey: "pay-key-1",
      });
      const active = activeStatus === "creating-prepay" ? creating : cashierOpenState();

      expect(reducePayment(active, {
        type: "ORDER_LOAD_FAILED",
        message: "后台刷新失败",
      })).toBe(active);
    },
  );

  test.each([
    [PAYMENT_SCENARIOS.confirming, "payment-confirming"],
    [PAYMENT_SCENARIOS.confirmed, "booking-confirmed"],
  ] as const)("active cashier yields to authoritative %s order", (order, status) => {
    expect(reducePayment(cashierOpenState(), {
      type: "ORDER_RECEIVED",
      order: structuredClone(order),
    }).status).toBe(status);
  });

  test("confirming + authoritative confirmed ORDER_RECEIVED enters booking-confirmed", () => {
    const confirming = initialPaymentPageState(structuredClone(PAYMENT_SCENARIOS.confirming));

    expect(reducePayment(confirming, {
      type: "ORDER_RECEIVED",
      order: structuredClone(PAYMENT_SCENARIOS.confirmed),
    })).toMatchObject({
      status: "booking-confirmed",
      order: { status: "CONFIRMED", paymentState: "SUCCESS" },
    });
  });

  test("confirming enters payment-exception only after an authoritative exception order", () => {
    const confirming = initialPaymentPageState(structuredClone(PAYMENT_SCENARIOS.confirming));

    expect(reducePayment(confirming, {
      type: "ORDER_RECEIVED",
      order: exceptionOrder(),
    })).toEqual({
      status: "payment-exception",
      order: PAYMENT_SCENARIOS.exception,
      paymentId: null,
    });
  });

  test("an expired terminal projection stays out of payment-pending while the order poller owns expiry rendering", () => {
    const confirming = initialPaymentPageState(structuredClone(PAYMENT_SCENARIOS.confirming));
    const expired: ExpiredOrderView = {
      ...PAYMENT_SCENARIOS.pending,
      status: "EXPIRED",
      expiredAt: "2026-07-27T12:10:01+08:00",
      paymentState: "CLOSED",
      paymentConfirming: false,
      paidAt: null,
    };

    expect(reducePayment(confirming, { type: "ORDER_RECEIVED", order: expired })).toBe(confirming);
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
