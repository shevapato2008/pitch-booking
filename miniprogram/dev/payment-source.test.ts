import { describe, expect, test } from "@jest/globals";

import {
  PAYMENT_PREVIEW_NOW,
  PAYMENT_SCENARIOS,
} from "./payment-scenarios";
import { createDevelopmentPaymentDataSource } from "./payment-source";

describe("development payment data source", () => {
  test("pending projections have an active ten-minute hold at the fixed preview clock", () => {
    const previewNow = new Date(PAYMENT_PREVIEW_NOW).getTime();

    expect(new Date(PAYMENT_SCENARIOS.pending.expiresAt).getTime() - previewNow).toBe(10 * 60_000);
    expect(new Date(PAYMENT_SCENARIOS.confirming.expiresAt).getTime() - previewNow).toBe(10 * 60_000);
    expect(new Date(PAYMENT_SCENARIOS.pending.expiresAt).getTime()).toBeGreaterThan(previewNow);
  });

  test("canonical projections are independently deep frozen", () => {
    expect(PAYMENT_SCENARIOS.pending.venue).not.toBe(PAYMENT_SCENARIOS.confirming.venue);
    expect(PAYMENT_SCENARIOS.confirming.contact).not.toBe(PAYMENT_SCENARIOS.confirmed.contact);
    expect(Object.isFrozen(PAYMENT_SCENARIOS.pending)).toBe(true);
    expect(Object.isFrozen(PAYMENT_SCENARIOS.pending.venue)).toBe(true);
    expect(Object.isFrozen(PAYMENT_SCENARIOS.pending.pitch)).toBe(true);
    expect(Object.isFrozen(PAYMENT_SCENARIOS.pending.contact)).toBe(true);
  });

  test("mutating one source read cannot affect another projection or later read", async () => {
    const pendingSource = createDevelopmentPaymentDataSource("pending");
    const confirmingSource = createDevelopmentPaymentDataSource("confirming");
    const first = await pendingSource.getOrder(PAYMENT_SCENARIOS.pending.orderId);
    const originalVenueName = PAYMENT_SCENARIOS.pending.venue.name;

    (first.venue as { name: string }).name = "被污染的场馆";
    (first.contact as { name: string }).name = "被污染的联系人";

    const reread = await pendingSource.getOrder(PAYMENT_SCENARIOS.pending.orderId);
    const otherProjection = await confirmingSource.getOrder(PAYMENT_SCENARIOS.pending.orderId);
    expect(reread.venue.name).toBe(originalVenueName);
    expect(reread.contact.name).toBe(PAYMENT_SCENARIOS.pending.contact.name);
    expect(otherProjection.venue.name).toBe(originalVenueName);
  });

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
    const replay = await source.createPayment(PAYMENT_SCENARIOS.pending.orderId, "client-key-1");
    const newClientAttempt = await source.createPayment(PAYMENT_SCENARIOS.pending.orderId, "client-key-2");

    expect(first).toMatchObject({ outcome: "PREPAY_CREATED" });
    expect(replay).toEqual(first);
    expect(newClientAttempt).toEqual(first);
    if (first.outcome === "PREPAY_CREATED" && newClientAttempt.outcome === "PREPAY_CREATED") {
      expect(newClientAttempt.paymentId).toBe(first.paymentId);
    }
  });

  test("createPayment rejects an empty idempotency key", async () => {
    const source = createDevelopmentPaymentDataSource("pending");

    await expect(source.createPayment(PAYMENT_SCENARIOS.pending.orderId, ""))
      .rejects.toThrow("IDEMPOTENCY_KEY_REQUIRED");
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
