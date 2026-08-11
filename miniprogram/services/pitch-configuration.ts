import type { PitchConfiguration, PitchConfigurationStatus } from "../domain/pitch-configuration";

export type PitchConfigurationChange =
  | Readonly<{ operation: "CREATE"; clientRef: string; customName: string | null; playersPerSide: number }>
  | Readonly<{ operation: "UPDATE"; pitchId: string; customName: string | null; playersPerSide: number; status: PitchConfigurationStatus }>
  | Readonly<{ operation: "DELETE"; pitchId: string }>;
export interface SavePitchConfigurationAttempt { readonly venueId: string; readonly expectedVersion: number; readonly changes: readonly PitchConfigurationChange[]; readonly idempotencyKey: string }
export interface PitchConfigurationDataSource { login(): Promise<void>; get(venueId: string): Promise<PitchConfiguration>; save(attempt: SavePitchConfigurationAttempt): Promise<PitchConfiguration> }
let configured: PitchConfigurationDataSource | undefined;
export function registerPitchConfigurationDataSource(source: PitchConfigurationDataSource): void { configured = source; }
export function getPitchConfigurationDataSource(): PitchConfigurationDataSource { if (!configured) throw new Error("PITCH_CONFIGURATION_DATA_SOURCE_NOT_CONFIGURED"); return configured; }
export function resetPitchConfigurationDataSourceForTesting(): void { configured = undefined; }
