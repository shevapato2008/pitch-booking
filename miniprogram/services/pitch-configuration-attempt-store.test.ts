import { expect, jest, test } from "@jest/globals";
import { createPitchConfigurationAttemptStore } from "./pitch-configuration-attempt-store";

test("persists and restores only a valid same-key save attempt", () => {
  let value: unknown;
  const storage = { get: jest.fn(() => value), set: jest.fn((_key: string, next: unknown) => { value = next; }), remove: jest.fn(() => { value = undefined; }) };
  const store = createPitchConfigurationAttemptStore(storage);
  const attempt = { venueId: "00000000-0000-4000-8000-000000000010", expectedVersion: 3, changes: [{ operation: "CREATE" as const, clientRef: "draft-1", customName: null, playersPerSide: 6 }], idempotencyKey: "pitch-configuration-key-3" };
  store.save(attempt); expect(store.load()).toEqual(attempt); expect(store.load()).not.toBe(attempt);
  value = { ...attempt, extra: true }; expect(store.load()).toBeNull(); expect(storage.remove).toHaveBeenCalled();
});
