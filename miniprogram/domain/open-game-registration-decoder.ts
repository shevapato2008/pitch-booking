import {
  arrayAt,
  enumAt,
  exactObject,
  invalid,
  rfc3339At,
  stringAt,
  uuidAt,
} from "./decoder-primitives";
import { decodeOpenGamePublic } from "./open-game-decoder";
import { OPEN_GAME_POSITIONS, type OpenGamePosition } from "./open-game";
import type {
  CaptainOpenGameApplication,
  OpenGameApplicationDecisionResult,
  OpenGameApplicationDraft,
  OpenGameApplicationDraftValidation,
  OpenGameApplicationQueue,
  OpenGameApplicationSubmission,
  OpenGameApplyActions,
  OpenGameApplyBlockedReason,
  OpenGameRegistrationContext,
  OpenGameReviewActions,
  OpenGameReviewBlockedReason,
  OpenGameViewerRegistration,
} from "./open-game-registration";

const APPLY_BLOCKED_REASONS = [
  "AUTH_REQUIRED",
  "OWNER_CANNOT_APPLY",
  "ALREADY_APPLIED",
  "GAME_NOT_PUBLISHED",
  "REGISTRATION_DEADLINE_PASSED",
  "GAME_FULL",
  "GAME_SUSPENDED",
  "GAME_CANCELLED",
  "GAME_COMPLETED",
  "GAME_STARTED",
] as const;
const REVIEW_BLOCKED_REASONS = [
  "APPLICATION_NOT_PENDING",
  "GAME_SUSPENDED",
  "GAME_CANCELLED",
  "GAME_COMPLETED",
  "GAME_STARTED",
  "GAME_FULL",
] as const;
const PERSISTED_STATUSES = ["APPLIED", "JOINED", "REJECTED"] as const;
const EFFECTIVE_STATUSES = ["APPLIED", "JOINED", "REJECTED", "CANCELLED"] as const;

const CONTEXT_KEYS = [
  "game", "remaining_spots", "viewer_authenticated", "viewer_registration", "allowed_actions",
] as const;
const VIEWER_REGISTRATION_KEYS = [
  "display_name", "position", "note", "persisted_status", "effective_status", "applied_at", "decided_at",
] as const;
const QUEUE_KEYS = ["remaining_spots", "pending_count", "applications"] as const;
const CAPTAIN_APPLICATION_KEYS = [
  "id", "display_name", "position", "note", "applied_at", "version", "allowed_actions",
] as const;
const DECISION_RESULT_KEYS = [
  "application_id", "status", "version", "decided_at", "remaining_spots", "allowed_actions",
] as const;

const MAINLAND_MOBILE_PATTERN =
  /(?:^|[^0-9])(?:\+?86[\s-]?)?1[3-9](?:[\s-]?[0-9]){9}(?:$|[^0-9])/;
const WECHAT_PATTERN =
  /微信(?:号)?|微\s*信|(?:^|[\s,:：])(?:vx|wx|wechat)(?:[\s,:：]|$)/i;
const URL_PATTERN =
  /https?:\/\/|www\.|(?:^|\s)[a-z0-9-]+\.(?:com|cn|net|org)(?:\/|\s|$)/i;
const MAINLAND_ID_PATTERN =
  /(?:^|[^0-9])(?:[0-9]{17}[0-9Xx]|[0-9]{15})(?:$|[^0-9])/;

function booleanAt(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") invalid(path);
  return value;
}

function safeIntegerAt(value: unknown, path: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) invalid(path);
  return value as number;
}

function boundedStringAt(value: unknown, path: string, minimum: number, maximum: number): string {
  const decoded = stringAt(value, path, minimum === 0);
  const length = Array.from(decoded).length;
  if (length < minimum || length > maximum) invalid(path);
  return decoded;
}

function nullableBoundedStringAt(value: unknown, path: string, maximum: number): string | null {
  return value === null ? null : boundedStringAt(value, path, 0, maximum);
}

function nullableRfc3339At(value: unknown, path: string): string | null {
  return value === null ? null : rfc3339At(value, path);
}

function decodeApplyActions(value: unknown, path: string): OpenGameApplyActions {
  const object = exactObject(value, ["can_apply", "apply_blocked_reason"], path);
  const canApply = booleanAt(object.can_apply, `${path}.can_apply`);
  const applyBlockedReason: OpenGameApplyBlockedReason | null = object.apply_blocked_reason === null
    ? null
    : enumAt(object.apply_blocked_reason, APPLY_BLOCKED_REASONS, `${path}.apply_blocked_reason`);
  if (canApply !== (applyBlockedReason === null)) invalid(path);
  return Object.freeze({ canApply, applyBlockedReason });
}

function decodeReviewActions(value: unknown, path: string): OpenGameReviewActions {
  const object = exactObject(
    value,
    ["can_accept", "accept_blocked_reason", "can_reject", "reject_blocked_reason"],
    path,
  );
  const canAccept = booleanAt(object.can_accept, `${path}.can_accept`);
  const acceptBlockedReason: OpenGameReviewBlockedReason | null = object.accept_blocked_reason === null
    ? null
    : enumAt(object.accept_blocked_reason, REVIEW_BLOCKED_REASONS, `${path}.accept_blocked_reason`);
  const canReject = booleanAt(object.can_reject, `${path}.can_reject`);
  const rejectBlockedReason: OpenGameReviewBlockedReason | null = object.reject_blocked_reason === null
    ? null
    : enumAt(object.reject_blocked_reason, REVIEW_BLOCKED_REASONS, `${path}.reject_blocked_reason`);
  if (canAccept !== (acceptBlockedReason === null)
    || canReject !== (rejectBlockedReason === null)
    || rejectBlockedReason === "GAME_FULL") invalid(path);
  return Object.freeze({ canAccept, acceptBlockedReason, canReject, rejectBlockedReason });
}

function decodeViewerRegistration(value: unknown, path: string): OpenGameViewerRegistration {
  const object = exactObject(value, VIEWER_REGISTRATION_KEYS, path);
  return Object.freeze({
    displayName: boundedStringAt(object.display_name, `${path}.display_name`, 2, 24),
    position: enumAt(object.position, OPEN_GAME_POSITIONS, `${path}.position`),
    note: nullableBoundedStringAt(object.note, `${path}.note`, 120),
    persistedStatus: enumAt(object.persisted_status, PERSISTED_STATUSES, `${path}.persisted_status`),
    effectiveStatus: enumAt(object.effective_status, EFFECTIVE_STATUSES, `${path}.effective_status`),
    appliedAt: rfc3339At(object.applied_at, `${path}.applied_at`),
    decidedAt: nullableRfc3339At(object.decided_at, `${path}.decided_at`),
  });
}

function decodeCaptainApplication(value: unknown, path: string): CaptainOpenGameApplication {
  const object = exactObject(value, CAPTAIN_APPLICATION_KEYS, path);
  return Object.freeze({
    id: uuidAt(object.id, `${path}.id`),
    displayName: boundedStringAt(object.display_name, `${path}.display_name`, 2, 24),
    position: enumAt(object.position, OPEN_GAME_POSITIONS, `${path}.position`),
    note: nullableBoundedStringAt(object.note, `${path}.note`, 120),
    appliedAt: rfc3339At(object.applied_at, `${path}.applied_at`),
    version: safeIntegerAt(object.version, `${path}.version`, 1),
    allowedActions: decodeReviewActions(object.allowed_actions, `${path}.allowed_actions`),
  });
}

export function decodeOpenGameRegistrationContext(value: unknown): OpenGameRegistrationContext {
  const object = exactObject(value, CONTEXT_KEYS, "$" );
  return Object.freeze({
    game: decodeOpenGamePublic(object.game, "$.game"),
    remainingSpots: safeIntegerAt(object.remaining_spots, "$.remaining_spots"),
    viewerAuthenticated: booleanAt(object.viewer_authenticated, "$.viewer_authenticated"),
    viewerRegistration: object.viewer_registration === null
      ? null
      : decodeViewerRegistration(object.viewer_registration, "$.viewer_registration"),
    allowedActions: decodeApplyActions(object.allowed_actions, "$.allowed_actions"),
  });
}

export function decodeOpenGameApplicationQueue(value: unknown): OpenGameApplicationQueue {
  const object = exactObject(value, QUEUE_KEYS, "$" );
  const applications = Object.freeze(arrayAt(object.applications, "$.applications").map(
    (application, index) => decodeCaptainApplication(application, `$.applications[${index}]`),
  ));
  return Object.freeze({
    remainingSpots: safeIntegerAt(object.remaining_spots, "$.remaining_spots"),
    pendingCount: safeIntegerAt(object.pending_count, "$.pending_count"),
    applications,
  });
}

export function decodeOpenGameApplicationDecisionResult(
  value: unknown,
): OpenGameApplicationDecisionResult {
  const object = exactObject(value, DECISION_RESULT_KEYS, "$" );
  const allowedActions = decodeReviewActions(object.allowed_actions, "$.allowed_actions");
  if (allowedActions.canAccept || allowedActions.canReject
    || allowedActions.acceptBlockedReason !== "APPLICATION_NOT_PENDING"
    || allowedActions.rejectBlockedReason !== "APPLICATION_NOT_PENDING") {
    invalid("$.allowed_actions");
  }
  return Object.freeze({
    applicationId: uuidAt(object.application_id, "$.application_id"),
    status: enumAt(object.status, ["JOINED", "REJECTED"] as const, "$.status"),
    version: safeIntegerAt(object.version, "$.version", 1),
    decidedAt: nullableRfc3339At(object.decided_at, "$.decided_at"),
    remainingSpots: safeIntegerAt(object.remaining_spots, "$.remaining_spots"),
    allowedActions,
  });
}

function containsPrivateText(value: string): boolean {
  const detectionValue = value.normalize("NFKC");
  return MAINLAND_MOBILE_PATTERN.test(detectionValue)
    || WECHAT_PATTERN.test(detectionValue)
    || URL_PATTERN.test(detectionValue)
    || MAINLAND_ID_PATTERN.test(detectionValue);
}

export function validateOpenGameApplicationDraft(
  draft: OpenGameApplicationDraft,
): OpenGameApplicationDraftValidation {
  const displayName = typeof draft.displayName === "string" ? draft.displayName.trim() : "";
  const note = typeof draft.note === "string" ? draft.note.trim() : "";
  const displayNameLength = Array.from(displayName).length;
  const noteLength = Array.from(note).length;
  const position = OPEN_GAME_POSITIONS.includes(draft.position as OpenGamePosition)
    ? draft.position as OpenGamePosition
    : null;
  const errors = Object.freeze({
    displayName: displayNameLength < 2 || displayNameLength > 24
      ? "本场称呼需为 2–24 个字符"
      : containsPrivateText(displayName) ? "请勿在本场称呼中填写联系方式或证件号码" : null,
    position: position === null ? "请选择意向位置" : null,
    note: noteLength > 120
      ? "给队长的话最多 120 个字符"
      : containsPrivateText(note) ? "请勿填写联系方式或证件号码" : null,
    adultConfirmed: draft.adultConfirmed === true ? null : "请确认已满 18 周岁",
    riskConfirmed: draft.riskConfirmed === true ? null : "请确认了解运动风险并自愿参与",
  });
  if (Object.values(errors).some((error) => error !== null) || position === null) {
    return Object.freeze({ valid: false, errors });
  }
  const submission: OpenGameApplicationSubmission = Object.freeze({
    displayName,
    position,
    note: note || null,
    adultConfirmed: true,
    riskConfirmed: true,
  });
  return Object.freeze({ valid: true, errors, submission });
}
