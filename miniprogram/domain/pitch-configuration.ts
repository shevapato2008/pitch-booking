import { arrayAt, enumAt, exactObject, integerAt, invalid, stringAt, uuidAt } from "./decoder-primitives";

export type PitchConfigurationStatus = "ACTIVE" | "INACTIVE";
export type PitchCapabilityReason =
  | "PITCH_FORMAT_IMMUTABLE" | "PITCH_HAS_BUSINESS_HISTORY" | "PITCH_DEACTIVATE_BLOCKED"
  | "LAST_ACTIVE_PITCH_REQUIRED" | "PITCH_ALREADY_ACTIVE" | "PITCH_ALREADY_INACTIVE";
export interface PitchCapability { readonly allowed: boolean; readonly reason: PitchCapabilityReason | null }
export interface PitchCapabilities {
  readonly editFormat: PitchCapability; readonly delete: PitchCapability; readonly deactivate: PitchCapability;
  readonly reactivate: PitchCapability; readonly futureBlockers: Readonly<{ AVAILABLE: number; LOCKED: number; BOOKED: number }>;
}
export interface ConfiguredPitch {
  readonly id: string; readonly customName: string | null; readonly systemName: string; readonly displayName: string;
  readonly playersPerSide: number; readonly sequence: number; readonly status: PitchConfigurationStatus; readonly capabilities: PitchCapabilities;
}
export interface CreatedPitchMapping { readonly clientRef: string; readonly pitchId: string; readonly sequence: number; readonly systemName: string }
export interface PitchConfiguration {
  readonly venue: { readonly id: string; readonly name: string; readonly timezone: "Asia/Shanghai" };
  readonly configurationVersion: number; readonly pitches: readonly ConfiguredPitch[]; readonly createdPitchMappings: readonly CreatedPitchMapping[];
}
const REASONS = ["PITCH_FORMAT_IMMUTABLE", "PITCH_HAS_BUSINESS_HISTORY", "PITCH_DEACTIVATE_BLOCKED", "LAST_ACTIVE_PITCH_REQUIRED", "PITCH_ALREADY_ACTIVE", "PITCH_ALREADY_INACTIVE"] as const;
function capability(value: unknown, path: string): PitchCapability {
  const object = exactObject(value, ["allowed", "reason"], path);
  if (typeof object.allowed !== "boolean") invalid(`${path}.allowed`);
  const reason = object.reason === null ? null : enumAt(object.reason, REASONS, `${path}.reason`);
  if (object.allowed === (reason !== null)) invalid(path);
  return { allowed: object.allowed, reason };
}
export function decodePitchConfiguration(value: unknown): PitchConfiguration {
  const object = exactObject(value, ["venue", "configuration_version", "pitches", "created_pitch_mappings"], "$");
  const venue = exactObject(object.venue, ["id", "name", "timezone"], "$.venue");
  const pitches = arrayAt(object.pitches, "$.pitches").map((value, index): ConfiguredPitch => {
    const path = `$.pitches[${index}]`; const pitch = exactObject(value, ["id", "custom_name", "system_name", "display_name", "players_per_side", "sequence", "status", "capabilities"], path);
    const capabilities = exactObject(pitch.capabilities, ["edit_format", "delete", "deactivate", "reactivate", "future_blockers"], `${path}.capabilities`);
    const future = exactObject(capabilities.future_blockers, ["AVAILABLE", "LOCKED", "BOOKED"], `${path}.capabilities.future_blockers`);
    const playersPerSide = integerAt(pitch.players_per_side, `${path}.players_per_side`, 1);
    if (playersPerSide > 99) invalid(`${path}.players_per_side`);
    return {
      id: uuidAt(pitch.id, `${path}.id`), customName: pitch.custom_name === null ? null : stringAt(pitch.custom_name, `${path}.custom_name`),
      systemName: stringAt(pitch.system_name, `${path}.system_name`), displayName: stringAt(pitch.display_name, `${path}.display_name`),
      playersPerSide, sequence: integerAt(pitch.sequence, `${path}.sequence`, 1),
      status: enumAt(pitch.status, ["ACTIVE", "INACTIVE"] as const, `${path}.status`),
      capabilities: { editFormat: capability(capabilities.edit_format, `${path}.capabilities.edit_format`), delete: capability(capabilities.delete, `${path}.capabilities.delete`), deactivate: capability(capabilities.deactivate, `${path}.capabilities.deactivate`), reactivate: capability(capabilities.reactivate, `${path}.capabilities.reactivate`), futureBlockers: { AVAILABLE: integerAt(future.AVAILABLE, `${path}.capabilities.future_blockers.AVAILABLE`), LOCKED: integerAt(future.LOCKED, `${path}.capabilities.future_blockers.LOCKED`), BOOKED: integerAt(future.BOOKED, `${path}.capabilities.future_blockers.BOOKED`) } },
    };
  });
  const mappings = arrayAt(object.created_pitch_mappings, "$.created_pitch_mappings").map((value, index): CreatedPitchMapping => {
    const path = `$.created_pitch_mappings[${index}]`; const item = exactObject(value, ["client_ref", "pitch_id", "sequence", "system_name"], path);
    return { clientRef: stringAt(item.client_ref, `${path}.client_ref`), pitchId: uuidAt(item.pitch_id, `${path}.pitch_id`), sequence: integerAt(item.sequence, `${path}.sequence`, 1), systemName: stringAt(item.system_name, `${path}.system_name`) };
  });
  return { venue: { id: uuidAt(venue.id, "$.venue.id"), name: stringAt(venue.name, "$.venue.name"), timezone: enumAt(venue.timezone, ["Asia/Shanghai"] as const, "$.venue.timezone") }, configurationVersion: integerAt(object.configuration_version, "$.configuration_version", 1), pitches, createdPitchMappings: mappings };
}

export const PITCH_CONFIGURATION_ERROR_CODES = ["AUTH_REQUIRED", "INVENTORY_FORBIDDEN", "VENUE_NOT_FOUND", "PITCH_NOT_FOUND", "INVALID_ARGUMENT", "INVALID_CUSTOM_NAME", "INVALID_PLAYERS_PER_SIDE", "DUPLICATE_PITCH_CHANGE", "PITCH_NAME_CONFLICT", "PITCH_HAS_BUSINESS_HISTORY", "PITCH_FORMAT_IMMUTABLE", "PITCH_DEACTIVATE_BLOCKED", "LAST_ACTIVE_PITCH_REQUIRED", "CONFIGURATION_CHANGED", "IDEMPOTENCY_KEY_REUSED", "REQUEST_IN_PROGRESS", "SERVICE_UNAVAILABLE", "INTERNAL_ERROR"] as const;
export type PitchConfigurationErrorCode = typeof PITCH_CONFIGURATION_ERROR_CODES[number];
export function decodePitchConfigurationError(value: unknown): { readonly code: PitchConfigurationErrorCode; readonly details: Record<string, unknown> } {
  const envelope = exactObject(value, ["error"], "$"); const error = exactObject(envelope.error, ["code", "message", "request_id", "details"], "$.error");
  const code = enumAt(error.code, PITCH_CONFIGURATION_ERROR_CODES, "$.error.code"); stringAt(error.message, "$.error.message"); stringAt(error.request_id, "$.error.request_id");
  if (typeof error.details !== "object" || error.details === null || Array.isArray(error.details)) invalid("$.error.details");
  return { code, details: error.details as Record<string, unknown> };
}
