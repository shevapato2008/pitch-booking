import type { VenueProfileMutationAttempt } from "./venue-profile";
import type { SessionStorage } from "./session-store";

const KEY = "modelstella.pitch-booking.venue-profile-mutation-attempt.v1";

export interface VenueProfileAttemptStore {
  load(): VenueProfileMutationAttempt | null;
  begin(attempt: VenueProfileMutationAttempt): VenueProfileMutationAttempt;
  clear(): void;
}

export class VenueProfileAttemptConflictError extends Error {
  readonly code = "VENUE_PROFILE_PENDING_ATTEMPT_CONFLICT";
  constructor() { super("VENUE_PROFILE_PENDING_ATTEMPT_CONFLICT"); this.name = "VenueProfileAttemptConflictError"; }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
function clone(value: VenueProfileMutationAttempt): VenueProfileMutationAttempt { return JSON.parse(canonical(value)) as VenueProfileMutationAttempt; }
function isObject(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key)); }
function positiveVersion(value: unknown): boolean { return Number.isSafeInteger(value) && (value as number) >= 1; }
function isAttempt(value: unknown): value is VenueProfileMutationAttempt {
  if (!isObject(value) || typeof value.kind !== "string" || typeof value.venueId !== "string"
    || typeof value.idempotencyKey !== "string" || value.idempotencyKey.length < 16 || value.idempotencyKey.length > 128) return false;
  if (value.kind === "save" && exact(value, ["kind", "venueId", "scope", "body", "idempotencyKey"]) && isObject(value.body)) {
    const body = value.body; return (value.scope === "description" || value.scope === "facilities") && exact(body, ["expectedFacilityVersion", "expectedRevisionVersion", "description", "facilities"])
      && positiveVersion(body.expectedFacilityVersion) && positiveVersion(body.expectedRevisionVersion) && typeof body.description === "string"
      && Array.from(body.description).length <= 300 && Array.isArray(body.facilities) && body.facilities.every((item) => typeof item === "string");
  }
  if (value.kind === "uploadIntent" && exact(value, ["kind", "venueId", "body", "idempotencyKey"]) && isObject(value.body)) {
    const body = value.body; return exact(body, ["expectedRevisionVersion", "filename", "mimeType", "byteSize"])
      && positiveVersion(body.expectedRevisionVersion) && typeof body.filename === "string" && body.filename.length > 0
      && (body.mimeType === "image/jpeg" || body.mimeType === "image/png" || body.mimeType === "image/webp")
      && Number.isSafeInteger(body.byteSize) && (body.byteSize as number) >= 1 && (body.byteSize as number) <= 10485760;
  }
  if (value.kind === "reorder") return exact(value, ["kind", "venueId", "imageIds", "expectedRevisionVersion", "idempotencyKey"])
    && Array.isArray(value.imageIds) && value.imageIds.length >= 1 && value.imageIds.length <= 8 && value.imageIds.every((item) => typeof item === "string") && positiveVersion(value.expectedRevisionVersion);
  if (value.kind === "retry") return exact(value, ["kind", "venueId", "itemId", "expectedRevisionVersion", "idempotencyKey"])
    && typeof value.itemId === "string" && positiveVersion(value.expectedRevisionVersion);
  return (value.kind === "complete" || value.kind === "delete" || value.kind === "cover")
    && exact(value, ["kind", "venueId", "imageId", "expectedRevisionVersion", "idempotencyKey"])
    && typeof value.imageId === "string" && positiveVersion(value.expectedRevisionVersion);
}

export function createVenueProfileAttemptStore(storage: SessionStorage): VenueProfileAttemptStore {
  const clear = () => storage.remove(KEY);
  const load = (): VenueProfileMutationAttempt | null => {
    const value = storage.get(KEY);
    if (value === undefined || value === null) return null;
    if (!isAttempt(value)) { clear(); return null; }
    return clone(value);
  };
  return {
    load,
    begin(attempt) {
      const pending = load();
      if (pending) {
        if (canonical(pending) !== canonical(attempt)) throw new VenueProfileAttemptConflictError();
        return pending;
      }
      const stored = clone(attempt); storage.set(KEY, stored); return stored;
    },
    clear,
  };
}

let configured: VenueProfileAttemptStore | undefined;
export function registerVenueProfileAttemptStore(store: VenueProfileAttemptStore): void { configured = store; }
export function getVenueProfileAttemptStore(): VenueProfileAttemptStore | undefined { return configured; }
export function resetVenueProfileAttemptStoreForTesting(): void { configured = undefined; }
