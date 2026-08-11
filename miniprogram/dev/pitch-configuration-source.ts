import type { ConfiguredPitch, PitchConfiguration } from "../domain/pitch-configuration";
import type { PitchConfigurationDataSource, SavePitchConfigurationAttempt } from "../services/pitch-configuration";

const venue = { id: "00000000-0000-4000-8000-000000000010", name: "渤海元丰足球场", timezone: "Asia/Shanghai" as const };
const capabilities = () => ({ editFormat: { allowed: true, reason: null }, delete: { allowed: true, reason: null }, deactivate: { allowed: true, reason: null }, reactivate: { allowed: false, reason: "PITCH_ALREADY_ACTIVE" as const }, futureBlockers: { AVAILABLE: 0, LOCKED: 0, BOOKED: 0 } });
const initial: ConfiguredPitch[] = [
  { id: "00000000-0000-4000-8000-000000000021", customName: "滨河场", systemName: "5人场 · 1号场", displayName: "滨河场", playersPerSide: 5, sequence: 1, status: "ACTIVE", capabilities: capabilities() },
  { id: "00000000-0000-4000-8000-000000000022", customName: "A场", systemName: "7人场 · 1号场", displayName: "A场", playersPerSide: 7, sequence: 1, status: "ACTIVE", capabilities: capabilities() },
];
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export function createDevelopmentPitchConfigurationDataSource(): PitchConfigurationDataSource {
  let version = 1; let pitches = clone(initial); const completed = new Map<string, PitchConfiguration>();
  const response = (createdPitchMappings: PitchConfiguration["createdPitchMappings"] = []): PitchConfiguration => clone({ venue, configurationVersion: version, pitches, createdPitchMappings });
  return {
    async login() {}, async get() { return response(); },
    async save(attempt: SavePitchConfigurationAttempt) {
      const replay = completed.get(attempt.idempotencyKey); if (replay) return clone(replay);
      if (attempt.expectedVersion !== version) throw Object.assign(new Error("CONFIGURATION_CHANGED"), { code: "CONFIGURATION_CHANGED" });
      const mappings: Array<{ clientRef: string; pitchId: string; sequence: number; systemName: string }> = [];
      for (const change of attempt.changes) {
        if (change.operation === "DELETE") { pitches = pitches.filter(({ id }) => id !== change.pitchId); continue; }
        if (change.operation === "UPDATE") { pitches = pitches.map((pitch) => pitch.id === change.pitchId ? { ...pitch, customName: change.customName, displayName: change.customName || pitch.systemName, playersPerSide: change.playersPerSide, status: change.status } : pitch); continue; }
        const pitchId = `00000000-0000-4000-8000-${String(100 + pitches.length).padStart(12, "0")}`; const sequence = pitches.filter(({ playersPerSide }) => playersPerSide === change.playersPerSide).length + 1; const systemName = `${change.playersPerSide}人场 · ${sequence}号场`;
        pitches.push({ id: pitchId, customName: change.customName, systemName, displayName: change.customName || systemName, playersPerSide: change.playersPerSide, sequence, status: "ACTIVE", capabilities: capabilities() }); mappings.push({ clientRef: change.clientRef, pitchId, sequence, systemName });
      }
      if (attempt.changes.length) version += 1; const saved = response(mappings); completed.set(attempt.idempotencyKey, saved); return clone(saved);
    },
  };
}
