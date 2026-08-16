import {
  arrayAt,
  dateAt,
  enumAt,
  exactObject,
  integerAt,
  invalid,
  rfc3339At,
  stringAt,
  uuidAt,
} from "./decoder-primitives";

export type InventorySlotStatus = "AVAILABLE" | "LOCKED" | "BOOKED" | "CLOSED";
export type InventoryReadOnlyReason = "HELD_FOR_PAYMENT" | "ALREADY_BOOKED" | "TIME_PASSED";

export interface InventoryPitch {
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
  readonly pitchType: "FIVE_A_SIDE" | "SEVEN_A_SIDE" | null;
  readonly playersPerSide: number;
}

export interface InventorySlot {
  readonly id: string;
  readonly pitchId: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly priceCents: number;
  readonly status: InventorySlotStatus;
  readonly checkoutVersion: number;
  readonly editable: boolean;
  readonly readOnlyReason: InventoryReadOnlyReason | null;
}

export interface VenueInventory {
  readonly venue: { readonly id: string; readonly name: string; readonly timezone: "Asia/Shanghai" };
  readonly localDate: string;
  readonly availabilityWindow: { readonly startDate: string; readonly endDate: string };
  readonly pitches: readonly InventoryPitch[];
  readonly selectedPitchId: string;
  readonly slots: readonly InventorySlot[];
  readonly generatedAt: string;
}

const timeAt = (value: unknown, path: string): string => {
  const time = stringAt(value, path);
  if (!/^(?:[01]\d|2[0-3]):(?:00|30)$/.test(time)) invalid(path);
  return time;
};

export function decodeInventorySlot(value: unknown, path = "$" ): InventorySlot {
  const object = exactObject(value, [
    "id", "pitch_id", "starts_at", "ends_at", "start_time", "end_time", "price_cents", "status",
    "checkout_version", "editable", "read_only_reason",
  ], path);
  const status = enumAt<InventorySlotStatus>(object.status, ["AVAILABLE", "LOCKED", "BOOKED", "CLOSED"], `${path}.status`);
  const editable = object.editable;
  if (typeof editable !== "boolean") invalid(`${path}.editable`);
  const reason = object.read_only_reason === null ? null : enumAt<InventoryReadOnlyReason>(
    object.read_only_reason, ["HELD_FOR_PAYMENT", "ALREADY_BOOKED", "TIME_PASSED"], `${path}.read_only_reason`,
  );
  if ((editable && (!new Set(["AVAILABLE", "CLOSED"]).has(status) || reason !== null)) || (!editable && reason === null)) {
    invalid(`${path}.editable`);
  }
  const startsAt = rfc3339At(object.starts_at, `${path}.starts_at`);
  const endsAt = rfc3339At(object.ends_at, `${path}.ends_at`);
  const startTime = timeAt(object.start_time, `${path}.start_time`);
  const endTime = timeAt(object.end_time, `${path}.end_time`);
  if (startTime >= endTime || !startsAt.includes(`T${startTime}:`) || !endsAt.includes(`T${endTime}:`)) invalid(path);
  return {
    id: uuidAt(object.id, `${path}.id`), pitchId: uuidAt(object.pitch_id, `${path}.pitch_id`),
    startsAt, endsAt, startTime, endTime,
    priceCents: integerAt(object.price_cents, `${path}.price_cents`), status,
    checkoutVersion: integerAt(object.checkout_version, `${path}.checkout_version`, 1), editable,
    readOnlyReason: reason,
  };
}

export function decodeVenueInventory(value: unknown): VenueInventory {
  const object = exactObject(value, [
    "venue", "local_date", "availability_window", "pitches", "selected_pitch_id", "slots", "generated_at",
  ], "$" );
  const venue = exactObject(object.venue, ["id", "name", "timezone"], "$.venue");
  const timezone = enumAt(venue.timezone, ["Asia/Shanghai"] as const, "$.venue.timezone");
  const window = exactObject(object.availability_window, ["start_date", "end_date"], "$.availability_window");
  const startDate = dateAt(window.start_date, "$.availability_window.start_date");
  const endDate = dateAt(window.end_date, "$.availability_window.end_date");
  const localDate = dateAt(object.local_date, "$.local_date");
  if (startDate > endDate || localDate < startDate || localDate > endDate) invalid("$.local_date");
  const pitches = arrayAt(object.pitches, "$.pitches", 1).map((raw, index): InventoryPitch => {
    const path = `$.pitches[${index}]`;
    const pitch = exactObject(raw, ["id", "name", "display_name", "pitch_type", "players_per_side"], path);
    const pitchType = pitch.pitch_type === null ? null : enumAt(pitch.pitch_type, ["FIVE_A_SIDE", "SEVEN_A_SIDE"] as const, `${path}.pitch_type`);
    const playersPerSide = integerAt(pitch.players_per_side, `${path}.players_per_side`, 1);
    if (playersPerSide > 99) invalid(`${path}.players_per_side`);
    if ((pitchType === "FIVE_A_SIDE" && playersPerSide !== 5) || (pitchType === "SEVEN_A_SIDE" && playersPerSide !== 7)) invalid(path);
    return {
      id: uuidAt(pitch.id, `${path}.id`), name: stringAt(pitch.name, `${path}.name`),
      displayName: stringAt(pitch.display_name, `${path}.display_name`), pitchType,
      playersPerSide,
    };
  });
  const selectedPitchId = uuidAt(object.selected_pitch_id, "$.selected_pitch_id");
  if (!pitches.some(({ id }) => id === selectedPitchId)) invalid("$.selected_pitch_id");
  const slots = arrayAt(object.slots, "$.slots").map((raw, index) => decodeInventorySlot(raw, `$.slots[${index}]`));
  if (slots.some(({ pitchId }) => pitchId !== selectedPitchId)) invalid("$.slots");
  return {
    venue: { id: uuidAt(venue.id, "$.venue.id"), name: stringAt(venue.name, "$.venue.name"), timezone },
    localDate, availabilityWindow: { startDate, endDate }, pitches, selectedPitchId, slots,
    generatedAt: rfc3339At(object.generated_at, "$.generated_at"),
  };
}

export const INVENTORY_ERROR_CODES = [
  "AUTH_REQUIRED", "INVENTORY_FORBIDDEN", "VENUE_NOT_FOUND", "PITCH_NOT_FOUND", "SLOT_NOT_FOUND",
  "SLOT_TIME_CONFLICT", "INVENTORY_VERSION_CONFLICT", "INVENTORY_SLOT_READ_ONLY", "DATE_OUT_OF_RANGE",
  "INVALID_ARGUMENT", "IDEMPOTENCY_KEY_REUSED", "SERVICE_UNAVAILABLE",
] as const;
export type InventoryErrorCode = typeof INVENTORY_ERROR_CODES[number];

export function decodeInventoryError(value: unknown): { readonly code: InventoryErrorCode; readonly details: Record<string, unknown> } {
  const envelope = exactObject(value, ["error"], "$" );
  const error = exactObject(envelope.error, ["code", "message", "request_id", "details"], "$.error");
  const code = enumAt(error.code, INVENTORY_ERROR_CODES, "$.error.code");
  stringAt(error.message, "$.error.message");
  stringAt(error.request_id, "$.error.request_id");
  if (typeof error.details !== "object" || error.details === null || Array.isArray(error.details)) invalid("$.error.details");
  return { code, details: error.details as Record<string, unknown> };
}
