import type { SessionStorage } from "./session-store";
import type { VenueFulfillmentMutationAttempt } from "./venue-fulfillment";

const KEY = "modelstella.pitch-booking.venue-fulfillment-mutation-attempt.v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface VenueFulfillmentAttemptStore {
  load(): VenueFulfillmentMutationAttempt | null;
  begin(attempt: VenueFulfillmentMutationAttempt): VenueFulfillmentMutationAttempt;
  clear(): void;
}

export class VenueFulfillmentAttemptConflictError extends Error {
  readonly code = "VENUE_FULFILLMENT_PENDING_ATTEMPT_CONFLICT";
  constructor() { super("VENUE_FULFILLMENT_PENDING_ATTEMPT_CONFLICT"); this.name = "VenueFulfillmentAttemptConflictError"; }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
function clone(value: VenueFulfillmentMutationAttempt): VenueFulfillmentMutationAttempt {
  return JSON.parse(canonical(value)) as VenueFulfillmentMutationAttempt;
}
function common(value: Record<string, unknown>): boolean {
  return UUID.test(String(value.venueId)) && UUID.test(String(value.orderId))
    && typeof value.idempotencyKey === "string" && value.idempotencyKey.length >= 16 && value.idempotencyKey.length <= 128;
}
function isAttempt(value: unknown): value is VenueFulfillmentMutationAttempt {
  if (!isObject(value) || !common(value)) return false;
  if ((value.kind === "checkIn" || value.kind === "complete")
    && exact(value, ["kind", "venueId", "orderId", "idempotencyKey"])) return true;
  return value.kind === "refund" && exact(value, ["kind", "venueId", "orderId", "reason", "idempotencyKey"])
    && typeof value.reason === "string" && value.reason === value.reason.trim()
    && Array.from(value.reason).length >= 1 && Array.from(value.reason).length <= 500;
}

export function createVenueFulfillmentAttemptStore(storage: SessionStorage): VenueFulfillmentAttemptStore {
  const clear = () => storage.remove(KEY);
  const load = (): VenueFulfillmentMutationAttempt | null => {
    const value = storage.get(KEY);
    if (value === undefined || value === null) return null;
    if (!isAttempt(value)) { clear(); return null; }
    return clone(value);
  };
  return {
    load,
    begin(attempt) {
      if (!isAttempt(attempt)) throw new Error("INVALID_VENUE_FULFILLMENT_ATTEMPT");
      const pending = load();
      if (pending) {
        if (canonical(pending) !== canonical(attempt)) throw new VenueFulfillmentAttemptConflictError();
        return pending;
      }
      const stored = clone(attempt); storage.set(KEY, stored); return stored;
    },
    clear,
  };
}

let configured: VenueFulfillmentAttemptStore | undefined;
export function registerVenueFulfillmentAttemptStore(store: VenueFulfillmentAttemptStore): void { configured = store; }
export function getVenueFulfillmentAttemptStore(): VenueFulfillmentAttemptStore | undefined { return configured; }
export function resetVenueFulfillmentAttemptStoreForTesting(): void { configured = undefined; }
