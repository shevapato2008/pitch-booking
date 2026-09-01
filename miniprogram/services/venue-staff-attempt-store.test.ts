import { describe, expect, jest, test } from "@jest/globals";
import type { SessionStorage } from "./session-store";
import {
  createVenueStaffAttemptStore,
} from "./venue-staff-attempt-store";
import type { VenueStaffMutationAttempt } from "./venue-staff";

const userId = "10000000-0000-4000-8000-000000000001";
const otherUserId = "10000000-0000-4000-8000-000000000002";
const venueId = "20000000-0000-4000-8000-000000000001";
const invitationId = "30000000-0000-4000-8000-000000000001";
const key = "venue-staff-key-00000001";

function setup(initial?: unknown) {
  let value = initial;
  const storage: SessionStorage = {
    get: jest.fn(() => value),
    set: jest.fn((_key: string, next: unknown) => { value = next; }),
    remove: jest.fn(() => { value = undefined; }),
  };
  return { store: createVenueStaffAttemptStore(storage), storage, value: () => value };
}

const accept: VenueStaffMutationAttempt = {
  kind: "acceptInvitation", originatingUserId: userId, invitationId, idempotencyKey: key,
};

describe("venue staff persistent attempt store", () => {
  test("persists and reuses the original idempotency key for the same mutation", () => {
    const { store } = setup();
    expect(store.begin(accept)).toEqual({ kind: "READY", attempt: accept });
    expect(store.begin({ ...accept, idempotencyKey: "venue-staff-key-00000002" })).toEqual({ kind: "READY", attempt: accept });
    expect(store.resolveForUser(userId)).toEqual({ kind: "READY", attempt: accept });
  });

  test("does not overwrite same-account or foreign-account pending work", () => {
    const { store } = setup();
    store.begin(accept);
    const otherMutation: VenueStaffMutationAttempt = {
      kind: "revokeInvitation", originatingUserId: userId, venueId, invitationId, idempotencyKey: key,
    };
    expect(store.begin(otherMutation)).toEqual({ kind: "SAME_ACCOUNT_PENDING", attempt: accept });
    expect(store.begin({ ...accept, originatingUserId: otherUserId })).toEqual({ kind: "FOREIGN_ACCOUNT_PENDING", attempt: accept });
    expect(store.resolveForUser(otherUserId)).toEqual({ kind: "FOREIGN_ACCOUNT_PENDING", attempt: accept });
  });

  test("never accepts or retains invitation secrets", () => {
    const leaked = { ...accept, invitationToken: "A".repeat(43) };
    const { store, storage } = setup(leaked);
    expect(store.load()).toBeNull();
    expect(storage.remove).toHaveBeenCalled();
    expect(() => store.begin(leaked as VenueStaffMutationAttempt)).toThrow("INVALID_VENUE_STAFF_ATTEMPT");
  });

  test("strictly validates each production mutation shape", () => {
    const attempts: VenueStaffMutationAttempt[] = [
      { kind: "createInvitation", originatingUserId: userId, venueId, contactLabel: "夜班员工", permissions: ["MANAGE_INVENTORY"], idempotencyKey: key },
      { kind: "updatePermissions", originatingUserId: userId, venueId, membershipId: invitationId, expectedVersion: 2, permissions: ["MANAGE_PROFILE", "MANAGE_PITCHES"], idempotencyKey: key },
      { kind: "removeMember", originatingUserId: userId, venueId, membershipId: invitationId, expectedVersion: 2, reason: "已离职", idempotencyKey: key },
      { kind: "revokeInvitation", originatingUserId: userId, venueId, invitationId, idempotencyKey: key },
      accept,
    ];
    for (const attempt of attempts) {
      const { store } = setup();
      expect(store.begin(attempt)).toEqual({ kind: "READY", attempt });
      expect(store.load()).toEqual(attempt);
    }
    expect(() => setup().store.begin({ ...attempts[0], permissions: [] } as VenueStaffMutationAttempt)).toThrow("INVALID_VENUE_STAFF_ATTEMPT");
    expect(() => setup().store.begin({ ...attempts[2], reason: " untrimmed " } as VenueStaffMutationAttempt)).toThrow("INVALID_VENUE_STAFF_ATTEMPT");
  });
});
