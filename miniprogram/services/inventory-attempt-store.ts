import type { SessionStorage } from "./session-store";
import type { InventoryMutationAttempt } from "./inventory";

const KEY = "modelstella.pitch-booking.inventory-mutation-attempt.v1";

export interface InventoryMutationAttemptStore {
  load(): InventoryMutationAttempt | null;
  save(attempt: InventoryMutationAttempt): void;
  clear(): void;
}

let configured: InventoryMutationAttemptStore | undefined;
export function registerInventoryMutationAttemptStore(store: InventoryMutationAttemptStore): void { configured = store; }
export function getInventoryMutationAttemptStore(): InventoryMutationAttemptStore | undefined { return configured; }
export function resetInventoryMutationAttemptStoreForTesting(): void { configured = undefined; }

export function createInventoryMutationAttemptStore(storage: SessionStorage): InventoryMutationAttemptStore {
  const clear = () => storage.remove(KEY);
  return {
    load() {
      const value = storage.get(KEY);
      if (!isAttempt(value)) { if (value !== undefined && value !== null) clear(); return null; }
      return JSON.parse(JSON.stringify(value)) as InventoryMutationAttempt;
    },
    save(attempt) { storage.set(KEY, JSON.parse(JSON.stringify(attempt)) as InventoryMutationAttempt); },
    clear,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}
function validCommon(value: Record<string, unknown>): boolean {
  return typeof value.venueId === "string" && typeof value.idempotencyKey === "string"
    && value.idempotencyKey.length >= 16 && value.idempotencyKey.length <= 128 && isObject(value.body);
}
function isAttempt(value: unknown): value is InventoryMutationAttempt {
  if (!isObject(value) || !validCommon(value)) return false;
  const body = value.body as Record<string, unknown>;
  if (value.kind === "create") return exactKeys(value, ["kind", "venueId", "body", "idempotencyKey"])
    && exactKeys(body, ["pitchId", "localDate", "startTime", "endTime", "priceCents"])
    && typeof body.pitchId === "string" && typeof body.localDate === "string" && typeof body.startTime === "string"
    && typeof body.endTime === "string" && Number.isSafeInteger(body.priceCents) && (body.priceCents as number) >= 0;
  return value.kind === "update" && exactKeys(value, ["kind", "venueId", "slotId", "body", "idempotencyKey"])
    && typeof value.slotId === "string" && exactKeys(body, ["expectedCheckoutVersion", "priceCents", "status"])
    && Number.isSafeInteger(body.expectedCheckoutVersion) && (body.expectedCheckoutVersion as number) >= 1
    && Number.isSafeInteger(body.priceCents) && (body.priceCents as number) >= 0
    && (body.status === "AVAILABLE" || body.status === "CLOSED");
}
