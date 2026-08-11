import { expect, jest, test } from "@jest/globals";

import { createInventoryMutationAttemptStore } from "./inventory-attempt-store";

const attempt = {
  kind: "create" as const,
  venueId: "00000000-0000-4000-8000-000000000010",
  body: {
    pitchId: "00000000-0000-4000-8000-000000000020",
    localDate: "2026-08-11",
    startTime: "09:30",
    endTime: "11:00",
    priceCents: 20000,
  },
  idempotencyKey: "inventory-20260811-stable-key",
};

test("persists and restores the exact inventory mutation attempt", () => {
  let stored: unknown;
  const storage = {
    get: jest.fn(() => stored),
    set: jest.fn((_key: string, value: unknown) => { stored = value; }),
    remove: jest.fn(() => { stored = undefined; }),
  };
  const store = createInventoryMutationAttemptStore(storage);
  store.save(attempt);
  expect(store.load()).toEqual(attempt);
  expect(store.load()).not.toBe(attempt);
  store.clear();
  expect(store.load()).toBeNull();
});

test("clears malformed persisted attempts", () => {
  const storage = { get: jest.fn(() => ({ ...attempt, idempotencyKey: "short" })), set: jest.fn(), remove: jest.fn() };
  expect(createInventoryMutationAttemptStore(storage).load()).toBeNull();
  expect(storage.remove).toHaveBeenCalledTimes(1);
});
