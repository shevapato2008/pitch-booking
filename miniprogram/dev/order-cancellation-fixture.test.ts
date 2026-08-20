import { expect, test } from "@jest/globals";

import { createOrderCancellationFixture } from "./order-cancellation-fixture";

test("keeps a maybe-paid pending cancellation non-terminal until an authoritative read", async () => {
  const source = createOrderCancellationFixture("pending-cancellable");
  const result = await source.cancelOrder({
    orderId: source.previewOrderId,
    idempotencyKey: "cancel-fixture-000000000001",
  });

  expect(result).toMatchObject({
    status: "PENDING_PAYMENT",
    cancelRequestedAt: expect.any(String),
    allowedActions: {
      canPay: false,
      canCancel: false,
      blockedReason: "PAYMENT_RESULT_PENDING",
    },
  });
  expect(Object.isFrozen(result)).toBe(true);

  const authoritative = await source.getOrder(source.previewOrderId);
  expect(authoritative.status).toBe("CANCELLED");
});

test.each([
  ["confirmed-cancellable", "REFUND_PENDING"],
  ["refund-failed", "REFUND_PENDING"],
] as const)("executes the immutable %s cancellation transition", async (scenario, expectedStatus) => {
  const source = createOrderCancellationFixture(scenario);
  const before = await source.getOrder(source.previewOrderId);
  const result = await source.cancelOrder({
    orderId: source.previewOrderId,
    idempotencyKey: "cancel-fixture-000000000001",
  });

  expect(result.status).toBe(expectedStatus);
  expect(before.status).not.toBe(result.status);
  expect(Object.isFrozen(result)).toBe(true);
  expect(await source.getOrder(source.previewOrderId)).toEqual(result);
});

test("replays the first response and never invents provider completion", async () => {
  const source = createOrderCancellationFixture("confirmed-cancellable");
  const attempt = {
    orderId: source.previewOrderId,
    idempotencyKey: "cancel-fixture-000000000001",
  };
  const first = await source.cancelOrder(attempt);
  const replay = await source.cancelOrder(attempt);

  expect(replay).toEqual(first);
  expect(replay.status).toBe("REFUND_PENDING");
  expect((await source.listOrders()).orders.map(({ status }) => status)).toEqual([
    "REFUND_PENDING",
    "REFUNDED",
    "REFUND_FAILED",
  ]);
});
