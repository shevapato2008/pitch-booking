import { describe, expect, jest, test } from "@jest/globals";

import { createSessionStore } from "./session-store";

describe("SessionStore", () => {
  test("stores only token and expiresAt under one namespaced key", () => {
    const storage = memoryStorage();
    const store = createSessionStore(storage, () => Date.parse("2026-07-28T00:00:00Z"));

    store.save({ token: "secret-token", expiresAt: "2026-07-29T00:00:00Z" });

    expect(storage.set).toHaveBeenCalledTimes(1);
    expect(storage.set).toHaveBeenCalledWith(
      "modelstella.pitch-booking.session.v1",
      { token: "secret-token", expiresAt: "2026-07-29T00:00:00Z" },
    );
    expect(store.load()).toEqual({ token: "secret-token", expiresAt: "2026-07-29T00:00:00Z" });
  });

  test.each([
    ["expired", { token: "token", expiresAt: "2026-07-27T23:59:59Z" }],
    ["malformed", { token: "token", expiresAt: "not-a-date" }],
    ["extra field", { token: "token", expiresAt: "2026-07-29T00:00:00Z", user: "must-not-live-here" }],
    ["unparseable RFC3339 instant", { token: "token", expiresAt: "2026-12-31T23:59:60Z" }],
  ])("clears %s persisted state", (_label, persisted) => {
    const storage = memoryStorage(persisted);
    const store = createSessionStore(storage, () => Date.parse("2026-07-28T00:00:00Z"));

    expect(store.load()).toBeNull();
    expect(storage.remove).toHaveBeenCalledWith("modelstella.pitch-booking.session.v1");
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
