import { VENUE_STAFF_PERMISSIONS, type VenueStaffPermission } from "../domain/venue-staff";
import type { SessionStorage } from "./session-store";
import type {
  VenueStaffAttemptStore,
  VenueStaffMutationAttempt,
} from "./venue-staff";

const KEY = "modelstella.pitch-booking.venue-staff-mutation-attempt.v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{15,127}$/;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}
function uuid(value: unknown): value is string { return typeof value === "string" && UUID.test(value); }
function positiveVersion(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 1; }
function trimmed(value: unknown, minimum: number, maximum: number): value is string {
  return typeof value === "string" && value === value.trim() && [...value].length >= minimum && [...value].length <= maximum;
}
function permissions(value: unknown): value is readonly VenueStaffPermission[] {
  return Array.isArray(value) && value.length >= 1 && value.length <= 4
    && value.every((item) => typeof item === "string" && VENUE_STAFF_PERMISSIONS.includes(item as VenueStaffPermission))
    && new Set(value).size === value.length;
}

function isAttempt(value: unknown): value is VenueStaffMutationAttempt {
  if (!object(value) || !uuid(value.originatingUserId)
    || typeof value.idempotencyKey !== "string" || !IDEMPOTENCY_KEY.test(value.idempotencyKey)) return false;
  if (value.kind === "createInvitation") {
    return exact(value, ["kind", "originatingUserId", "venueId", "contactLabel", "permissions", "idempotencyKey"])
      && uuid(value.venueId) && trimmed(value.contactLabel, 1, 40) && permissions(value.permissions);
  }
  if (value.kind === "updatePermissions") {
    return exact(value, ["kind", "originatingUserId", "venueId", "membershipId", "expectedVersion", "permissions", "idempotencyKey"])
      && uuid(value.venueId) && uuid(value.membershipId) && positiveVersion(value.expectedVersion) && permissions(value.permissions);
  }
  if (value.kind === "removeMember") {
    return exact(value, ["kind", "originatingUserId", "venueId", "membershipId", "expectedVersion", "reason", "idempotencyKey"])
      && uuid(value.venueId) && uuid(value.membershipId) && positiveVersion(value.expectedVersion) && trimmed(value.reason, 1, 200);
  }
  if (value.kind === "revokeInvitation") {
    return exact(value, ["kind", "originatingUserId", "venueId", "invitationId", "idempotencyKey"])
      && uuid(value.venueId) && uuid(value.invitationId);
  }
  return value.kind === "acceptInvitation"
    && exact(value, ["kind", "originatingUserId", "invitationId", "venueId", "permissions", "idempotencyKey"])
    && uuid(value.invitationId) && uuid(value.venueId) && permissions(value.permissions);
}

function clone(attempt: VenueStaffMutationAttempt): VenueStaffMutationAttempt {
  return JSON.parse(JSON.stringify(attempt)) as VenueStaffMutationAttempt;
}

function sameMutation(left: VenueStaffMutationAttempt, right: VenueStaffMutationAttempt): boolean {
  const withoutKey = (attempt: VenueStaffMutationAttempt): Record<string, unknown> => {
    const copy = clone(attempt) as unknown as Record<string, unknown>;
    delete copy.idempotencyKey;
    return copy;
  };
  return JSON.stringify(withoutKey(left)) === JSON.stringify(withoutKey(right));
}

export function createVenueStaffAttemptStore(storage: SessionStorage): VenueStaffAttemptStore {
  const clear = () => storage.remove(KEY);
  const load = (): VenueStaffMutationAttempt | null => {
    const value = storage.get(KEY);
    if (value === undefined || value === null) return null;
    if (!isAttempt(value)) { clear(); return null; }
    return clone(value);
  };
  return {
    load,
    begin(requested) {
      if (!isAttempt(requested)) throw new Error("INVALID_VENUE_STAFF_ATTEMPT");
      const stable = clone(requested);
      const pending = load();
      if (pending) {
        if (pending.originatingUserId !== stable.originatingUserId) return { kind: "FOREIGN_ACCOUNT_PENDING", attempt: pending };
        if (!sameMutation(pending, stable)) return { kind: "SAME_ACCOUNT_PENDING", attempt: pending };
        return { kind: "READY", attempt: pending };
      }
      storage.set(KEY, clone(stable));
      return { kind: "READY", attempt: clone(stable) };
    },
    resolveForUser(userId) {
      const pending = load();
      if (!pending) return null;
      return pending.originatingUserId === userId
        ? { kind: "READY", attempt: pending }
        : { kind: "FOREIGN_ACCOUNT_PENDING", attempt: pending };
    },
    clear,
  };
}
