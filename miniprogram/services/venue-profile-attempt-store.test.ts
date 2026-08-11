import { expect, test } from "@jest/globals";
import { createVenueProfileAttemptStore, VenueProfileAttemptConflictError } from "./venue-profile-attempt-store";

test("persists the exact unresolved key and canonical payload until cleared", () => {
  let value: unknown; const store = createVenueProfileAttemptStore({ get: () => value, set: (_key, next) => { value = next; }, remove: () => { value = undefined; } });
  const attempt = { kind: "save" as const, venueId: "venue", body: { expectedFacilityVersion: 1, expectedRevisionVersion: 2, description: "介绍", facilities: ["PARKING" as const] }, idempotencyKey: "1234567890abcdef" };
  expect(store.begin(attempt)).toEqual(attempt); expect(store.begin(attempt).idempotencyKey).toBe("1234567890abcdef");
  expect(() => store.begin({ ...attempt, body: { ...attempt.body, description: "不同内容" } })).toThrow(VenueProfileAttemptConflictError);
  store.clear(); expect(store.load()).toBeNull();
});

test("clears malformed persisted attempts", () => {
  let removed = false; const store = createVenueProfileAttemptStore({ get: () => ({ kind: "save", idempotencyKey: "short" }), set: () => undefined, remove: () => { removed = true; } });
  expect(store.load()).toBeNull(); expect(removed).toBe(true);
});
