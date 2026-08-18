import type { SessionStorage } from "./session-store";
import type { PitchConfigurationChange, SavePitchConfigurationAttempt } from "./pitch-configuration";
const KEY = "modelstella.pitch-booking.pitch-configuration-attempt.v1";
export interface PitchConfigurationAttemptStore { load(): SavePitchConfigurationAttempt | null; save(attempt: SavePitchConfigurationAttempt): void; clear(): void }
let configured: PitchConfigurationAttemptStore | undefined;
export function registerPitchConfigurationAttemptStore(store: PitchConfigurationAttemptStore): void { configured = store; }
export function getPitchConfigurationAttemptStore(): PitchConfigurationAttemptStore | undefined { return configured; }
export function resetPitchConfigurationAttemptStoreForTesting(): void { configured = undefined; }
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
function validChange(value: unknown): value is PitchConfigurationChange {
  if (!object(value)) return false;
  if (value.operation === "CREATE") return exact(value, ["operation", "clientRef", "customName", "playersPerSide"]) && typeof value.clientRef === "string" && (value.customName === null || typeof value.customName === "string") && Number.isInteger(value.playersPerSide) && (value.playersPerSide as number) >= 1 && (value.playersPerSide as number) <= 99;
  if (value.operation === "UPDATE") return exact(value, ["operation", "pitchId", "customName", "playersPerSide", "status"]) && typeof value.pitchId === "string" && (value.customName === null || typeof value.customName === "string") && Number.isInteger(value.playersPerSide) && (value.playersPerSide as number) >= 1 && (value.playersPerSide as number) <= 99 && (value.status === "ACTIVE" || value.status === "INACTIVE");
  return value.operation === "DELETE" && exact(value, ["operation", "pitchId"]) && typeof value.pitchId === "string";
}
function valid(value: unknown): value is SavePitchConfigurationAttempt { return object(value) && exact(value, ["venueId", "expectedVersion", "changes", "idempotencyKey"]) && typeof value.venueId === "string" && Number.isInteger(value.expectedVersion) && (value.expectedVersion as number) >= 1 && Array.isArray(value.changes) && value.changes.every(validChange) && typeof value.idempotencyKey === "string" && value.idempotencyKey.length >= 16 && value.idempotencyKey.length <= 128; }
export function createPitchConfigurationAttemptStore(storage: SessionStorage): PitchConfigurationAttemptStore {
  const clear = () => storage.remove(KEY);
  return { load() { const value = storage.get(KEY); if (!valid(value)) { if (value !== undefined && value !== null) clear(); return null; } return JSON.parse(JSON.stringify(value)) as SavePitchConfigurationAttempt; }, save(attempt) { storage.set(KEY, JSON.parse(JSON.stringify(attempt)) as SavePitchConfigurationAttempt); }, clear };
}
