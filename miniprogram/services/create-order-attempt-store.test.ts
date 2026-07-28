import { describe, expect, jest, test } from "@jest/globals";

import { createCreateOrderAttemptStore } from "./create-order-attempt-store";

const attempt = {
  request: {
    slotId: "00000000-0000-4000-8000-000000000030",
    checkoutVersion: 12,
    contactName: "张三",
  },
  idempotencyKey: "booking-1000-100000000",
};

describe("CreateOrderAttemptStore", () => {
  test("stores the exact request and idempotency key under one namespaced key", () => {
    const storage = memoryStorage();
    const store = createCreateOrderAttemptStore(storage);

    store.save(attempt);

    expect(storage.set).toHaveBeenCalledWith(
      "modelstella.pitch-booking.create-order-attempt.v1",
      attempt,
    );
    expect(store.load()).toEqual(attempt);
  });

  test.each([
    ["extra field", { ...attempt, extra: true }],
    ["malformed request", { ...attempt, request: { ...attempt.request, checkoutVersion: 0 } }],
    ["empty idempotency key", { ...attempt, idempotencyKey: "" }],
  ])("clears %s persisted state", (_label, persisted) => {
    const storage = memoryStorage(persisted);
    const store = createCreateOrderAttemptStore(storage);

    expect(store.load()).toBeNull();
    expect(storage.remove).toHaveBeenCalledWith(
      "modelstella.pitch-booking.create-order-attempt.v1",
    );
  });
});

function memoryStorage(initial?: unknown) {
  let value = initial;
  return {
    get: jest.fn(() => value),
    set: jest.fn((_key: string, next: unknown) => { value = next; }),
    remove: jest.fn((key: string) => { void key; value = undefined; }),
  };
}
