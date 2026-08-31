import {
  validateOpenGameApplicationDraft,
  validateOpenGameMemberRemovalReason,
} from "../domain/open-game-registration-decoder";
import type { OpenGameApplicationSubmission } from "../domain/open-game-registration";
import type { OpenGamePosition } from "../domain/open-game";
import type { SessionStorage } from "./session-store";
import type {
  OpenGameRegistrationAttempt,
  OpenGameRegistrationAttemptAvailability,
  OpenGameRegistrationAttemptStore,
} from "./open-game-registration";

const KEY = "modelstella.pitch-booking.open-game-registration-attempt.v1";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{15,127}$/;
const POSITIONS = ["GOALKEEPER", "DEFENDER", "MIDFIELDER", "FORWARD", "ANY"] as const;

export function createOpenGameRegistrationAttemptStore(
  storage: SessionStorage,
): OpenGameRegistrationAttemptStore {
  const clear = (): void => storage.remove(KEY);
  const load = (): OpenGameRegistrationAttempt | null => {
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
    begin(requested): OpenGameRegistrationAttemptAvailability {
      if (!isAttempt(requested)) throw new Error("INVALID_OPEN_GAME_REGISTRATION_ATTEMPT");
      const stable = cloneAttempt(requested);
      const pending = load();
      if (pending !== null) {
        if (pending.originatingUserId !== stable.originatingUserId) {
          return { kind: "FOREIGN_ACCOUNT_PENDING", attempt: pending };
        }
        if (!sameMutation(pending, stable)) {
          return { kind: "SAME_ACCOUNT_PENDING", attempt: pending };
        }
        return { kind: "READY", attempt: pending };
      }
      storage.set(KEY, cloneAttempt(stable));
      return { kind: "READY", attempt: cloneAttempt(stable) };
    },
    resolveForUser(userId) {
      const pending = load();
      if (pending === null) return null;
      return pending.originatingUserId === userId
        ? { kind: "READY", attempt: pending }
        : { kind: "FOREIGN_ACCOUNT_PENDING", attempt: pending };
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

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && IDEMPOTENCY_KEY_PATTERN.test(value);
}

function isSubmission(value: unknown): value is OpenGameApplicationSubmission {
  if (!isObject(value) || !exactKeys(value, [
    "displayName", "position", "note", "adultConfirmed", "riskConfirmed",
  ])) return false;
  if (typeof value.displayName !== "string"
    || typeof value.position !== "string"
    || !POSITIONS.includes(value.position as OpenGamePosition)
    || (value.note !== null && typeof value.note !== "string")
    || value.adultConfirmed !== true
    || value.riskConfirmed !== true) return false;
  const validation = validateOpenGameApplicationDraft({
    displayName: value.displayName,
    position: value.position as OpenGamePosition,
    note: value.note ?? "",
    adultConfirmed: true,
    riskConfirmed: true,
  });
  return validation.valid
    && validation.submission.displayName === value.displayName
    && validation.submission.position === value.position
    && validation.submission.note === value.note;
}

function isAttempt(value: unknown): value is OpenGameRegistrationAttempt {
  if (!isObject(value)
    || !isUuid(value.originatingUserId)
    || !isIdempotencyKey(value.idempotencyKey)) return false;
  if (value.kind === "apply") {
    return exactKeys(value, ["kind", "originatingUserId", "shareToken", "body", "idempotencyKey"])
      && typeof value.shareToken === "string"
      && SHARE_TOKEN_PATTERN.test(value.shareToken)
      && isSubmission(value.body);
  }
  if (value.kind === "decision") {
    return exactKeys(value, [
      "kind", "originatingUserId", "gameId", "applicationId", "decision",
      "expectedVersion", "idempotencyKey",
    ])
      && isUuid(value.gameId)
      && isUuid(value.applicationId)
      && (value.decision === "ACCEPT"
        || value.decision === "REJECT"
        || value.decision === "WAITLIST")
      && Number.isSafeInteger(value.expectedVersion)
      && (value.expectedVersion as number) >= 1;
  }
  if (value.kind === "withdraw") {
    return exactKeys(value, [
      "kind", "originatingUserId", "shareToken", "applicationId", "action",
      "expectedVersion", "idempotencyKey",
    ])
      && typeof value.shareToken === "string"
      && SHARE_TOKEN_PATTERN.test(value.shareToken)
      && isUuid(value.applicationId)
      && (value.action === "WITHDRAW_APPLICATION"
        || value.action === "WITHDRAW_WAITLIST"
        || value.action === "LEAVE_GAME")
      && Number.isSafeInteger(value.expectedVersion)
      && (value.expectedVersion as number) >= 1;
  }
  if (value.kind === "attendance") {
    return exactKeys(value, [
      "kind", "originatingUserId", "gameId", "registrationId", "attendanceStatus",
      "expectedVersion", "idempotencyKey",
    ])
      && isUuid(value.gameId)
      && isUuid(value.registrationId)
      && (value.attendanceStatus === "PRESENT" || value.attendanceStatus === "NO_SHOW")
      && Number.isSafeInteger(value.expectedVersion)
      && (value.expectedVersion as number) >= 1;
  }
  if (value.kind === "remove-member") {
    if (!exactKeys(value, [
      "kind", "originatingUserId", "gameId", "registrationId", "expectedVersion", "reason",
      "idempotencyKey",
    ])
      || !isUuid(value.gameId)
      || !isUuid(value.registrationId)
      || !Number.isSafeInteger(value.expectedVersion)
      || (value.expectedVersion as number) < 1) return false;
    const validation = validateOpenGameMemberRemovalReason(value.reason);
    return validation.valid && validation.reason === value.reason;
  }
  return false;
}

function cloneSubmission(submission: OpenGameApplicationSubmission): OpenGameApplicationSubmission {
  return {
    displayName: submission.displayName,
    position: submission.position,
    note: submission.note,
    adultConfirmed: true,
    riskConfirmed: true,
  };
}

function cloneAttempt(attempt: OpenGameRegistrationAttempt): OpenGameRegistrationAttempt {
  if (attempt.kind === "apply") {
    return {
      kind: "apply",
      originatingUserId: attempt.originatingUserId,
      shareToken: attempt.shareToken,
      body: cloneSubmission(attempt.body),
      idempotencyKey: attempt.idempotencyKey,
    };
  }
  if (attempt.kind === "decision") return {
    kind: "decision",
    originatingUserId: attempt.originatingUserId,
    gameId: attempt.gameId,
    applicationId: attempt.applicationId,
    decision: attempt.decision,
    expectedVersion: attempt.expectedVersion,
    idempotencyKey: attempt.idempotencyKey,
  };
  if (attempt.kind === "withdraw") return {
    kind: "withdraw",
    originatingUserId: attempt.originatingUserId,
    shareToken: attempt.shareToken,
    applicationId: attempt.applicationId,
    action: attempt.action,
    expectedVersion: attempt.expectedVersion,
    idempotencyKey: attempt.idempotencyKey,
  };
  if (attempt.kind === "attendance") return {
    kind: "attendance",
    originatingUserId: attempt.originatingUserId,
    gameId: attempt.gameId,
    registrationId: attempt.registrationId,
    attendanceStatus: attempt.attendanceStatus,
    expectedVersion: attempt.expectedVersion,
    idempotencyKey: attempt.idempotencyKey,
  };
  return {
    kind: "remove-member",
    originatingUserId: attempt.originatingUserId,
    gameId: attempt.gameId,
    registrationId: attempt.registrationId,
    expectedVersion: attempt.expectedVersion,
    reason: attempt.reason,
    idempotencyKey: attempt.idempotencyKey,
  };
}

function sameSubmission(
  left: OpenGameApplicationSubmission,
  right: OpenGameApplicationSubmission,
): boolean {
  return left.displayName === right.displayName
    && left.position === right.position
    && left.note === right.note
    && left.adultConfirmed === right.adultConfirmed
    && left.riskConfirmed === right.riskConfirmed;
}

function sameMutation(left: OpenGameRegistrationAttempt, right: OpenGameRegistrationAttempt): boolean {
  if (left.kind !== right.kind || left.originatingUserId !== right.originatingUserId) return false;
  if (left.kind === "apply" && right.kind === "apply") {
    return left.shareToken === right.shareToken && sameSubmission(left.body, right.body);
  }
  if (left.kind === "decision" && right.kind === "decision") {
    return left.gameId === right.gameId
      && left.applicationId === right.applicationId
      && left.decision === right.decision
      && left.expectedVersion === right.expectedVersion;
  }
  if (left.kind === "withdraw" && right.kind === "withdraw") {
    return left.shareToken === right.shareToken
      && left.applicationId === right.applicationId
      && left.action === right.action
      && left.expectedVersion === right.expectedVersion;
  }
  if (left.kind === "attendance" && right.kind === "attendance") {
    return left.gameId === right.gameId
      && left.registrationId === right.registrationId
      && left.attendanceStatus === right.attendanceStatus
      && left.expectedVersion === right.expectedVersion;
  }
  if (left.kind === "remove-member" && right.kind === "remove-member") {
    return left.gameId === right.gameId
      && left.registrationId === right.registrationId
      && left.expectedVersion === right.expectedVersion
      && left.reason === right.reason;
  }
  return false;
}
