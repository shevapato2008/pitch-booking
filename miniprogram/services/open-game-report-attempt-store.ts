import { validateOpenGameReportFacts } from "../domain/open-game-report-decoder";
import {
  OPEN_GAME_REPORT_CATEGORIES,
  type OpenGameReportCategory,
} from "../domain/open-game-report";
import type { SessionStorage } from "./session-store";
import type {
  OpenGameReportAttempt,
  OpenGameReportAttemptAvailability,
  OpenGameReportAttemptStore,
} from "./open-game-report";

const KEY = "modelstella.pitch-booking.open-game-report-attempt.v1";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{15,127}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length
    && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isAttempt(value: unknown): value is OpenGameReportAttempt {
  if (!isObject(value) || !exactKeys(value, [
    "originatingUserId", "gameId", "body", "idempotencyKey", "replayed",
  ])) return false;
  if (!isUuid(value.originatingUserId)
    || !isUuid(value.gameId)
    || typeof value.idempotencyKey !== "string"
    || !IDEMPOTENCY_KEY_PATTERN.test(value.idempotencyKey)
    || typeof value.replayed !== "boolean"
    || !isObject(value.body)
    || !exactKeys(value.body, ["category", "facts"])
    || typeof value.body.category !== "string"
    || !OPEN_GAME_REPORT_CATEGORIES.includes(value.body.category as OpenGameReportCategory)) {
    return false;
  }
  const validation = validateOpenGameReportFacts(value.body.facts);
  return validation.valid && validation.facts === value.body.facts;
}

function cloneAttempt(attempt: OpenGameReportAttempt): OpenGameReportAttempt {
  return {
    originatingUserId: attempt.originatingUserId,
    gameId: attempt.gameId,
    body: { category: attempt.body.category, facts: attempt.body.facts },
    idempotencyKey: attempt.idempotencyKey,
    replayed: attempt.replayed,
  };
}

function sameMutation(left: OpenGameReportAttempt, right: OpenGameReportAttempt): boolean {
  return left.originatingUserId === right.originatingUserId
    && left.gameId === right.gameId
    && left.body.category === right.body.category
    && left.body.facts === right.body.facts
    && left.idempotencyKey === right.idempotencyKey;
}

export function createOpenGameReportAttemptStore(
  storage: SessionStorage,
): OpenGameReportAttemptStore {
  const clear = (): void => storage.remove(KEY);
  const load = (): OpenGameReportAttempt | null => {
    const value = storage.get(KEY);
    if (value === undefined || value === null) return null;
    if (!isAttempt(value)) {
      clear();
      return null;
    }
    return cloneAttempt(value);
  };
  return {
    load,
    begin(requested): OpenGameReportAttemptAvailability {
      if (!isAttempt(requested)) throw new Error("INVALID_OPEN_GAME_REPORT_ATTEMPT");
      const attempt = cloneAttempt(requested);
      const pending = load();
      if (pending !== null) {
        if (pending.originatingUserId !== attempt.originatingUserId) {
          return { kind: "FOREIGN_ACCOUNT_PENDING", attempt: pending };
        }
        if (!sameMutation(pending, attempt)) {
          return { kind: "SAME_ACCOUNT_PENDING", attempt: pending };
        }
        return { kind: "READY", attempt: pending };
      }
      storage.set(KEY, cloneAttempt(attempt));
      return { kind: "READY", attempt: cloneAttempt(attempt) };
    },
    resolveForUser(userId) {
      const pending = load();
      if (pending === null) return null;
      return pending.originatingUserId === userId
        ? { kind: "READY", attempt: pending }
        : { kind: "FOREIGN_ACCOUNT_PENDING", attempt: pending };
    },
    markReplayed(expected) {
      const pending = load();
      if (pending === null || pending.replayed || !sameMutation(pending, expected)) return null;
      const replayed = { ...pending, replayed: true };
      storage.set(KEY, cloneAttempt(replayed));
      return cloneAttempt(replayed);
    },
    clearIfCurrent(expected) {
      const pending = load();
      if (pending === null || !sameMutation(pending, expected)) return false;
      clear();
      return true;
    },
    clear,
  };
}

