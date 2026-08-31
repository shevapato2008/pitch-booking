import { describe, expect, jest, test } from "@jest/globals";

import { createSessionStore } from "./session-store";

const V1_SESSION_KEY = "modelstella.pitch-booking.session.v1";
const V2_SESSION_KEY = "modelstella.pitch-booking.session.v2";
const USER_ID = "11111111-2222-4333-8444-555555555555";

describe("SessionStore", () => {
  test("saves only the exact v2 owner-bound session and removes v1", () => {
    const storage = memoryStorage([
      [V1_SESSION_KEY, { token: "legacy-token", expiresAt: "2026-07-29T00:00:00Z" }],
    ]);
    const store = createSessionStore(storage, () => Date.parse("2026-07-28T00:00:00Z"));

    store.save({ token: "secret-token", expiresAt: "2026-07-29T00:00:00Z", userId: USER_ID });

    expect(storage.values.has(V1_SESSION_KEY)).toBe(false);
    expect(storage.values.get(V2_SESSION_KEY)).toEqual({
      token: "secret-token",
      expiresAt: "2026-07-29T00:00:00Z",
      userId: USER_ID,
    });
    expect(storage.set).toHaveBeenCalledTimes(1);
    expect(storage.remove).toHaveBeenCalledWith(V1_SESSION_KEY);
  });

  test("removes a v1 session instead of migrating an unknown account", () => {
    const storage = memoryStorage([
      [V1_SESSION_KEY, { token: "legacy-token", expiresAt: "2026-07-29T00:00:00Z" }],
    ]);
    const store = createSessionStore(storage, () => Date.parse("2026-07-28T00:00:00Z"));

    expect(store.load()).toBeNull();
    expect(storage.values.has(V1_SESSION_KEY)).toBe(false);
    expect(storage.values.has(V2_SESSION_KEY)).toBe(false);
    expect(storage.set).not.toHaveBeenCalled();
  });

  test.each([
    ["expired", { token: "token", expiresAt: "2026-07-28T00:00:00Z", userId: USER_ID }],
    ["malformed expiry", { token: "token", expiresAt: "not-a-date", userId: USER_ID }],
    ["unparseable RFC3339 instant", { token: "token", expiresAt: "2026-12-31T23:59:60Z", userId: USER_ID }],
    ["empty token", { token: "", expiresAt: "2026-07-29T00:00:00Z", userId: USER_ID }],
    ["invalid user ID", { token: "token", expiresAt: "2026-07-29T00:00:00Z", userId: "not-a-uuid" }],
    ["missing user ID", { token: "token", expiresAt: "2026-07-29T00:00:00Z" }],
    ["extra field", { token: "token", expiresAt: "2026-07-29T00:00:00Z", userId: USER_ID, extra: true }],
  ])("clears %s persisted v2 state", (_label, persisted) => {
    const storage = memoryStorage([[V2_SESSION_KEY, persisted]]);
    const store = createSessionStore(storage, () => Date.parse("2026-07-28T00:00:00Z"));

    expect(store.load()).toBeNull();
    expect(storage.values.has(V2_SESSION_KEY)).toBe(false);
    expect(storage.remove).toHaveBeenCalledWith(V1_SESSION_KEY);
    expect(storage.remove).toHaveBeenCalledWith(V2_SESSION_KEY);
  });

  test("defensively clones saved and loaded sessions", () => {
    const storage = memoryStorage();
    const store = createSessionStore(storage, () => Date.parse("2026-07-28T00:00:00Z"));
    const input = { token: "secret-token", expiresAt: "2026-07-29T00:00:00Z", userId: USER_ID };

    store.save(input);
    input.token = "mutated-input";
    const first = store.load();
    expect(first).toEqual({ token: "secret-token", expiresAt: "2026-07-29T00:00:00Z", userId: USER_ID });
    if (first) (first as { token: string }).token = "mutated-output";

    expect(store.load()).toEqual({ token: "secret-token", expiresAt: "2026-07-29T00:00:00Z", userId: USER_ID });
  });

  test("clear removes both session generations", () => {
    const storage = memoryStorage([
      [V1_SESSION_KEY, { token: "legacy" }],
      [V2_SESSION_KEY, { token: "current", expiresAt: "2026-07-29T00:00:00Z", userId: USER_ID }],
    ]);
    const store = createSessionStore(storage);

    store.clear();

    expect(storage.values.size).toBe(0);
    expect(storage.remove).toHaveBeenCalledWith(V1_SESSION_KEY);
    expect(storage.remove).toHaveBeenCalledWith(V2_SESSION_KEY);
  });
});

function memoryStorage(initial: ReadonlyArray<readonly [string, unknown]> = []) {
  const values = new Map<string, unknown>(initial);
  return {
    values,
    get: jest.fn((key: string) => values.get(key)),
    set: jest.fn((key: string, value: unknown) => { values.set(key, value); }),
    remove: jest.fn((key: string) => { values.delete(key); }),
  };
}
