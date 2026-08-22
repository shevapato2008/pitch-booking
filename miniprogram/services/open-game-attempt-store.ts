import type { OpenGameDraftInput, OpenGamePosition } from "../domain/open-game";
import { rfc3339At } from "../domain/decoder-primitives";
import type { SessionStorage } from "./session-store";
import type {
  OpenGameMutationAttempt,
  OpenGameMutationAttemptResolution,
  OpenGameMutationAttemptStore,
} from "./open-game";

const KEY = "modelstella.pitch-booking.open-game-mutation-attempt.v1";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{15,127}$/;
const POSITIONS = ["GOALKEEPER", "DEFENDER", "MIDFIELDER", "FORWARD", "ANY"] as const;

export function createOpenGameMutationAttemptStore(storage: SessionStorage): OpenGameMutationAttemptStore {
  const clear = () => storage.remove(KEY);
  const load = (): OpenGameMutationAttempt | null => {
    const value = storage.get(KEY);
    if (value === undefined || value === null) return null;
    if (!isAttempt(value)) {
      clear();
      return null;
    }
    return canonicalClone(value);
  };
  return {
    load,
    begin(requested): OpenGameMutationAttemptResolution {
      if (!isAttempt(requested)) throw new Error("INVALID_OPEN_GAME_MUTATION_ATTEMPT");
      const stable = canonicalClone(requested);
      const pending = load();
      if (pending) {
        return sameMutation(pending, stable)
          ? { kind: "READY", attempt: pending }
          : { kind: "FOREIGN_PENDING", attempt: pending };
      }
      storage.set(KEY, stable);
      return { kind: "READY", attempt: canonicalClone(stable) };
    },
    clear,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length
    && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isSafeInteger(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

function isBoundedString(value: unknown, minimum: number, maximum: number): value is string {
  return typeof value === "string" && [...value].length >= minimum && [...value].length <= maximum;
}

function isNullableBoundedString(value: unknown, maximum: number): value is string | null {
  return value === null || isBoundedString(value, 0, maximum);
}

function isPositions(value: unknown): value is readonly OpenGamePosition[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4
    || !value.every((position) => typeof position === "string" && POSITIONS.includes(position as OpenGamePosition))
    || new Set(value).size !== value.length) return false;
  return !value.includes("ANY") || value.length === 1;
}

function isRfc3339(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    rfc3339At(value, "$.registrationDeadline");
    return true;
  } catch {
    return false;
  }
}

function isDraftBody(value: unknown, update: boolean): value is OpenGameDraftInput & { readonly expectedVersion?: number } {
  if (!isObject(value)) return false;
  const keys = [
    "name", "teamName", "totalPlayers", "fixedPlayers", "openSpots", "intensity",
    "minimumExperience", "positions", "aaCents", "registrationDeadline",
    "equipmentAndArrivalNotes", "visibility", ...(update ? ["expectedVersion"] : []),
  ];
  return exactKeys(value, keys)
    && isBoundedString(value.name, 2, 30)
    && isBoundedString(value.teamName, 2, 24)
    && isSafeInteger(value.totalPlayers, 4, 30)
    && isSafeInteger(value.fixedPlayers, 1, 30)
    && isSafeInteger(value.openSpots, 1, 29)
    && (value.fixedPlayers as number) + (value.openSpots as number) <= (value.totalPlayers as number)
    && (value.intensity === "BEGINNER_FRIENDLY" || value.intensity === "CASUAL" || value.intensity === "COMPETITIVE")
    && isNullableBoundedString(value.minimumExperience, 60)
    && isPositions(value.positions)
    && isSafeInteger(value.aaCents, 0)
    && isRfc3339(value.registrationDeadline)
    && isNullableBoundedString(value.equipmentAndArrivalNotes, 200)
    && (value.visibility === "PUBLIC" || value.visibility === "LINK_ONLY")
    && (!update || isSafeInteger(value.expectedVersion, 1));
}

function validCommon(value: Record<string, unknown>): boolean {
  return typeof value.idempotencyKey === "string" && IDEMPOTENCY_KEY_PATTERN.test(value.idempotencyKey);
}

function isAttempt(value: unknown): value is OpenGameMutationAttempt {
  if (!isObject(value) || !validCommon(value)) return false;
  if (value.kind === "create") {
    return exactKeys(value, ["kind", "orderId", "body", "idempotencyKey"])
      && typeof value.orderId === "string" && UUID_PATTERN.test(value.orderId)
      && isDraftBody(value.body, false);
  }
  if (value.kind === "update") {
    return exactKeys(value, ["kind", "gameId", "body", "idempotencyKey"])
      && typeof value.gameId === "string" && UUID_PATTERN.test(value.gameId)
      && isDraftBody(value.body, true);
  }
  if (value.kind === "publish" || value.kind === "cancel") {
    return exactKeys(value, ["kind", "gameId", "expectedVersion", "idempotencyKey"])
      && typeof value.gameId === "string" && UUID_PATTERN.test(value.gameId)
      && isSafeInteger(value.expectedVersion, 1);
  }
  return false;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]),
  );
}

function canonicalClone<T>(value: T): T {
  return canonicalValue(value) as T;
}

function sameMutation(left: OpenGameMutationAttempt, right: OpenGameMutationAttempt): boolean {
  const withoutKey = (attempt: OpenGameMutationAttempt): Record<string, unknown> => {
    const object = canonicalClone(attempt) as unknown as Record<string, unknown>;
    delete object.idempotencyKey;
    return object;
  };
  return JSON.stringify(withoutKey(left)) === JSON.stringify(withoutKey(right));
}
