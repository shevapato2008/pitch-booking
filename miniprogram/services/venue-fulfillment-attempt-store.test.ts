import { expect, jest, test } from "@jest/globals";

import { createVenueFulfillmentAttemptStore, VenueFulfillmentAttemptConflictError } from "./venue-fulfillment-attempt-store";

const checkIn = {
  kind: "checkIn" as const,
  venueId: "7e68d7d8-4b7e-4f04-a5c5-3fe263e69c6f",
  orderId: "00000000-0000-4000-8000-000000000040",
  idempotencyKey: "check-in-stable-key-0001",
};

function harness(initial?: unknown) {
  let stored = initial;
  const storage = {
    get: jest.fn(() => stored),
    set: jest.fn((_key: string, value: unknown) => { stored = value; }),
    remove: jest.fn(() => { stored = undefined; }),
  };
  return { store: createVenueFulfillmentAttemptStore(storage), storage, peek: () => stored };
}

test("persists and reuses the exact original mutation attempt", () => {
  const { store } = harness();
  const stable = store.begin(checkIn);
  expect(stable).toEqual(checkIn);
  expect(store.begin({ ...checkIn })).toEqual(checkIn);
  expect(store.load()).toEqual(checkIn);
  expect(store.load()).not.toBe(stable);
});

test("persists only normalized refund input and never contact or token data", () => {
  const { store, peek } = harness();
  store.begin({
    kind: "refund", venueId: checkIn.venueId, orderId: checkIn.orderId,
    reason: "场地临时检修", idempotencyKey: "refund-stable-key-00001",
  });
  const serialized = JSON.stringify(peek());
  expect(serialized).toContain("场地临时检修");
  expect(serialized).not.toMatch(/phone|contact|token|authorization/i);
});

test("rejects a different write while an uncertain attempt is pending", () => {
  const { store } = harness(checkIn);
  expect(() => store.begin({ ...checkIn, kind: "complete" })).toThrow(VenueFulfillmentAttemptConflictError);
});

test.each([
  { ...checkIn, extra: true },
  { ...checkIn, venueId: "not-a-uuid" },
  { ...checkIn, idempotencyKey: "short" },
  { kind: "refund", venueId: checkIn.venueId, orderId: checkIn.orderId, reason: " ", idempotencyKey: "refund-stable-key-00001" },
  { ...checkIn, token: "secret" },
])("clears corrupted or version-incompatible stored data %#", (value) => {
  const { store, storage } = harness(value);
  expect(store.load()).toBeNull();
  expect(storage.remove).toHaveBeenCalledTimes(1);
});
