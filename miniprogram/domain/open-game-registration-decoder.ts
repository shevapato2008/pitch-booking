import {
  arrayAt,
  enumAt,
  exactObject,
  invalid,
  rfc3339At,
  rfc3339Before,
  stringAt,
  uuidAt,
} from "./decoder-primitives";
import { decodeOpenGamePublic } from "./open-game-decoder";
import { supportedIanaTimeZoneAt } from "./zoned-time";
import {
  OPEN_GAME_ATTENDANCE_STATUSES,
  OPEN_GAME_REGISTRATION_EFFECTIVE_STATUSES,
} from "./open-game-registration";
import {
  OPEN_GAME_POSITIONS,
  OPEN_GAME_STATES,
  type OpenGamePosition,
} from "./open-game";
import type {
  CaptainOpenGameApplication,
  CaptainOpenGameWaitlistApplication,
  OpenGameApplicationDecisionResult,
  OpenGameApplicationDraft,
  OpenGameApplicationDraftValidation,
  OpenGameApplicationQueue,
  OpenGameApplicationItem,
  OpenGameApplicationPage,
  OpenGameApplicationSubmission,
  OpenGameApplyActions,
  OpenGameApplyBlockedReason,
  OpenGameAttendanceGameSummary,
  OpenGameAttendanceMarkResult,
  OpenGameAttendanceRoster,
  OpenGameAttendanceRosterItem,
  OpenGameAttendanceStatus,
  OpenGameMemberGameSummary,
  OpenGameMemberRemovalActions,
  OpenGameMemberRemovalBlockedReason,
  OpenGameMemberRemovalReasonValidation,
  OpenGameMemberRemovalResult,
  OpenGameMemberRoster,
  OpenGameMemberRosterItem,
  OpenGamePromotedMember,
  OpenGameRegistrationContext,
  OpenGameRegistrationAvailableWithdrawalAction,
  OpenGameReviewActions,
  OpenGameReviewBlockedReason,
  OpenGameWaitlistBlockedReason,
  OpenGameViewerRegistration,
  OpenGameRegistrationWithdrawalKind,
} from "./open-game-registration";

const APPLY_BLOCKED_REASONS = [
  "AUTH_REQUIRED",
  "OWNER_CANNOT_APPLY",
  "ALREADY_APPLIED",
  "GAME_NOT_PUBLISHED",
  "REGISTRATION_DEADLINE_PASSED",
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
const WAITLIST_BLOCKED_REASONS = [
  "APPLICATION_NOT_PENDING",
  "GAME_SUSPENDED",
  "GAME_CANCELLED",
  "GAME_COMPLETED",
  "GAME_STARTED",
  "GAME_NOT_FULL",
  "WAITLIST_NOT_ENABLED",
] as const;
const PERSISTED_STATUSES = [
  "APPLIED", "WAITLISTED", "JOINED", "REJECTED", "WITHDRAWN", "REMOVED",
] as const;
const EFFECTIVE_STATUSES = OPEN_GAME_REGISTRATION_EFFECTIVE_STATUSES;
const AVAILABLE_WITHDRAWAL_ACTIONS = [
  "WITHDRAW_APPLICATION", "WITHDRAW_WAITLIST", "LEAVE_GAME",
] as const;
const WITHDRAWAL_KINDS = [
  "APPLICATION_WITHDRAWAL", "WAITLIST_WITHDRAWAL", "GAME_EXIT",
] as const;

const CONTEXT_KEYS = [
  "game", "remaining_spots", "viewer_authenticated", "viewer_registration", "allowed_actions",
] as const;
const VIEWER_REGISTRATION_KEYS = [
  "id", "version", "display_name", "position", "note", "persisted_status", "effective_status",
  "applied_at", "decided_at", "withdrawn_at", "withdrawal_kind", "late_exit_recorded",
  "available_withdrawal_action", "late_exit_will_be_recorded", "waitlist_position",
  "waitlisted_at", "promoted_at", "attendance_status", "attendance_recorded_at",
  "attendance_corrected_at", "removed_at",
] as const;
const QUEUE_KEYS = [
  "remaining_spots", "pending_count", "applications", "waitlist_count", "waitlist",
] as const;
const CAPTAIN_APPLICATION_KEYS = [
  "id", "display_name", "position", "note", "applied_at", "version", "allowed_actions",
] as const;
const CAPTAIN_WAITLIST_APPLICATION_KEYS = [
  "id", "display_name", "position", "note", "applied_at", "waitlisted_at",
  "waitlist_position",
] as const;
const DECISION_RESULT_KEYS = [
  "application_id", "status", "version", "decided_at", "remaining_spots", "allowed_actions",
] as const;
const MY_APPLICATION_PAGE_KEYS = ["items", "next_cursor"] as const;
const MY_APPLICATION_ITEM_KEYS = [
  "id", "effective_status", "applied_at", "waitlist_position", "waitlisted_at", "promoted_at",
  "attendance_status", "attendance_recorded_at", "attendance_corrected_at", "detail_path",
  "game_name", "starts_at",
  "ends_at", "time_zone", "venue_name", "pitch_name", "pitch_specification",
] as const;
const ATTENDANCE_GAME_KEYS = [
  "id", "name", "venue_name", "pitch_name", "starts_at", "ends_at", "time_zone", "state",
] as const;
const ATTENDANCE_ROSTER_ITEM_KEYS = [
  "registration_id", "display_name", "position", "attendance_status",
  "attendance_recorded_at", "attendance_corrected_at", "version",
] as const;
const ATTENDANCE_ROSTER_KEYS = [
  "game", "recorded_count", "total_count", "attendance_complete", "registrations",
] as const;
const ATTENDANCE_MARK_RESULT_KEYS = [
  "registration_id", "attendance_status", "attendance_recorded_at", "version",
  "recorded_count", "total_count", "attendance_complete",
] as const;
const MEMBER_REMOVAL_BLOCKED_REASONS = [
  "GAME_NOT_PUBLISHED",
  "GAME_SUSPENDED",
  "GAME_CANCELLED",
  "GAME_COMPLETED",
  "GAME_STARTED",
  "ORDER_AUTHORITY_UNHEALTHY",
  "ATTENDANCE_RECORDED",
] as const;
const MEMBER_GAME_KEYS = [
  "id", "name", "venue_name", "pitch_name", "starts_at", "ends_at", "time_zone", "state",
] as const;
const MEMBER_ROSTER_ITEM_KEYS = [
  "registration_id", "display_name", "position", "joined_at", "promoted_from_waitlist",
  "version", "allowed_actions",
] as const;
const MEMBER_ROSTER_KEYS = [
  "game", "joined_count", "remaining_spots", "waitlist_count", "members",
] as const;
const PROMOTED_MEMBER_KEYS = [
  "registration_id", "display_name", "position", "version",
] as const;
const MEMBER_REMOVAL_RESULT_KEYS = [
  "removed_registration_id", "removed_display_name", "status", "version", "removed_at",
  "joined_count", "remaining_spots", "waitlist_count", "promoted_member",
] as const;
const TERMINAL_ATTENDANCE_STATUSES = ["PRESENT", "NO_SHOW"] as const;
const DETAIL_PATH_PATTERN = /^\/pages\/captain-game-public\/index\?token=[A-Za-z0-9_-]{32}$/;

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

function nullablePositiveIntegerAt(value: unknown, path: string): number | null {
  return value === null ? null : safeIntegerAt(value, path, 1);
}

interface DecodedSelfAttendance {
  readonly attendanceStatus: OpenGameAttendanceStatus | null;
  readonly attendanceRecordedAt: string | null;
  readonly attendanceCorrectedAt: string | null;
}

function decodeSelfAttendance(
  statusValue: unknown,
  recordedAtValue: unknown,
  correctedAtValue: unknown,
  path: string,
): DecodedSelfAttendance {
  const attendanceStatus = statusValue === null
    ? null
    : enumAt(statusValue, OPEN_GAME_ATTENDANCE_STATUSES, `${path}.attendance_status`);
  const attendanceRecordedAt = nullableRfc3339At(
    recordedAtValue,
    `${path}.attendance_recorded_at`,
  );
  const hasTerminalStatus = attendanceStatus === "PRESENT" || attendanceStatus === "NO_SHOW";
  if (hasTerminalStatus !== (attendanceRecordedAt !== null)) {
    invalid(`${path}.attendance_recorded_at`);
  }
  const attendanceCorrectedAt = nullableRfc3339At(
    correctedAtValue,
    `${path}.attendance_corrected_at`,
  );
  if (!hasTerminalStatus && attendanceCorrectedAt !== null) {
    invalid(`${path}.attendance_corrected_at`);
  }
  if (attendanceCorrectedAt !== null && attendanceRecordedAt !== null
    && rfc3339Before(attendanceCorrectedAt, attendanceRecordedAt)) {
    invalid(`${path}.attendance_corrected_at`);
  }
  return { attendanceStatus, attendanceRecordedAt, attendanceCorrectedAt };
}

function decodeAttendanceGameSummary(
  value: unknown,
  path: string,
): OpenGameAttendanceGameSummary {
  const object = exactObject(value, ATTENDANCE_GAME_KEYS, path);
  const startsAt = rfc3339At(object.starts_at, `${path}.starts_at`);
  const endsAt = rfc3339At(object.ends_at, `${path}.ends_at`);
  if (!rfc3339Before(startsAt, endsAt)) invalid(`${path}.ends_at`);
  return Object.freeze({
    id: uuidAt(object.id, `${path}.id`),
    name: boundedStringAt(object.name, `${path}.name`, 2, 30),
    venueName: stringAt(object.venue_name, `${path}.venue_name`),
    pitchName: stringAt(object.pitch_name, `${path}.pitch_name`),
    startsAt,
    endsAt,
    timeZone: supportedIanaTimeZoneAt(object.time_zone, `${path}.time_zone`),
    state: enumAt(object.state, ["COMPLETED"] as const, `${path}.state`),
  });
}

function decodeAttendanceRosterItem(
  value: unknown,
  path: string,
): OpenGameAttendanceRosterItem {
  const object = exactObject(value, ATTENDANCE_ROSTER_ITEM_KEYS, path);
  const attendanceStatus = enumAt(
    object.attendance_status,
    OPEN_GAME_ATTENDANCE_STATUSES,
    `${path}.attendance_status`,
  );
  const attendanceRecordedAt = nullableRfc3339At(
    object.attendance_recorded_at,
    `${path}.attendance_recorded_at`,
  );
  const terminal = attendanceStatus === "PRESENT" || attendanceStatus === "NO_SHOW";
  if (terminal !== (attendanceRecordedAt !== null)) invalid(`${path}.attendance_recorded_at`);
  const attendanceCorrectedAt = nullableRfc3339At(
    object.attendance_corrected_at,
    `${path}.attendance_corrected_at`,
  );
  if (!terminal && attendanceCorrectedAt !== null) invalid(`${path}.attendance_corrected_at`);
  if (attendanceCorrectedAt !== null && attendanceRecordedAt !== null
    && rfc3339Before(attendanceCorrectedAt, attendanceRecordedAt)) {
    invalid(`${path}.attendance_corrected_at`);
  }
  return Object.freeze({
    registrationId: uuidAt(object.registration_id, `${path}.registration_id`),
    displayName: boundedStringAt(object.display_name, `${path}.display_name`, 2, 24),
    position: enumAt(object.position, OPEN_GAME_POSITIONS, `${path}.position`),
    attendanceStatus,
    attendanceRecordedAt,
    attendanceCorrectedAt,
    version: safeIntegerAt(object.version, `${path}.version`, 1),
  });
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
    [
      "can_accept", "accept_blocked_reason", "can_waitlist", "waitlist_blocked_reason",
      "can_reject", "reject_blocked_reason",
    ],
    path,
  );
  const canAccept = booleanAt(object.can_accept, `${path}.can_accept`);
  const acceptBlockedReason: OpenGameReviewBlockedReason | null = object.accept_blocked_reason === null
    ? null
    : enumAt(object.accept_blocked_reason, REVIEW_BLOCKED_REASONS, `${path}.accept_blocked_reason`);
  const canWaitlist = booleanAt(object.can_waitlist, `${path}.can_waitlist`);
  const waitlistBlockedReason: OpenGameWaitlistBlockedReason | null =
    object.waitlist_blocked_reason === null
      ? null
      : enumAt(
        object.waitlist_blocked_reason,
        WAITLIST_BLOCKED_REASONS,
        `${path}.waitlist_blocked_reason`,
      );
  const canReject = booleanAt(object.can_reject, `${path}.can_reject`);
  const rejectBlockedReason: OpenGameReviewBlockedReason | null = object.reject_blocked_reason === null
    ? null
    : enumAt(object.reject_blocked_reason, REVIEW_BLOCKED_REASONS, `${path}.reject_blocked_reason`);
  const capacityAvailable = canAccept
    && !canWaitlist
    && waitlistBlockedReason === "GAME_NOT_FULL"
    && canReject;
  const fullCapacity = !canAccept
    && acceptBlockedReason === "GAME_FULL"
    && canReject
    && (canWaitlist || waitlistBlockedReason === "WAITLIST_NOT_ENABLED");
  const commonBlocked = !canAccept
    && !canWaitlist
    && !canReject
    && acceptBlockedReason !== null
    && acceptBlockedReason !== "GAME_FULL"
    && rejectBlockedReason === acceptBlockedReason
    && waitlistBlockedReason === acceptBlockedReason;
  if (canAccept !== (acceptBlockedReason === null)
    || canWaitlist !== (waitlistBlockedReason === null)
    || canReject !== (rejectBlockedReason === null)
    || rejectBlockedReason === "GAME_FULL"
    || (canAccept && canWaitlist)
    || (!capacityAvailable && !fullCapacity && !commonBlocked)) invalid(path);
  return Object.freeze({
    canAccept,
    acceptBlockedReason,
    canWaitlist,
    waitlistBlockedReason,
    canReject,
    rejectBlockedReason,
  });
}

function decodeViewerRegistration(value: unknown, path: string): OpenGameViewerRegistration {
  const object = exactObject(value, VIEWER_REGISTRATION_KEYS, path);
  const persistedStatus = enumAt(
    object.persisted_status,
    PERSISTED_STATUSES,
    `${path}.persisted_status`,
  );
  const effectiveStatus = enumAt(
    object.effective_status,
    EFFECTIVE_STATUSES,
    `${path}.effective_status`,
  );
  const appliedAt = rfc3339At(object.applied_at, `${path}.applied_at`);
  const decidedAt = nullableRfc3339At(object.decided_at, `${path}.decided_at`);
  const withdrawnAt = nullableRfc3339At(object.withdrawn_at, `${path}.withdrawn_at`);
  const withdrawalKind: OpenGameRegistrationWithdrawalKind | null = object.withdrawal_kind === null
    ? null
    : enumAt(object.withdrawal_kind, WITHDRAWAL_KINDS, `${path}.withdrawal_kind`);
  const lateExitRecorded = booleanAt(object.late_exit_recorded, `${path}.late_exit_recorded`);
  const availableWithdrawalAction: OpenGameRegistrationAvailableWithdrawalAction | null =
    object.available_withdrawal_action === null
      ? null
      : enumAt(
        object.available_withdrawal_action,
        AVAILABLE_WITHDRAWAL_ACTIONS,
        `${path}.available_withdrawal_action`,
      );
  const lateExitWillBeRecorded = booleanAt(
    object.late_exit_will_be_recorded,
    `${path}.late_exit_will_be_recorded`,
  );
  const waitlistPosition = nullablePositiveIntegerAt(
    object.waitlist_position,
    `${path}.waitlist_position`,
  );
  const waitlistedAt = nullableRfc3339At(object.waitlisted_at, `${path}.waitlisted_at`);
  const promotedAt = nullableRfc3339At(object.promoted_at, `${path}.promoted_at`);
  const removedAt = nullableRfc3339At(object.removed_at, `${path}.removed_at`);
  const attendance = decodeSelfAttendance(
    object.attendance_status,
    object.attendance_recorded_at,
    object.attendance_corrected_at,
    path,
  );
  if (effectiveStatus !== "JOINED" && attendance.attendanceStatus !== null) {
    invalid(`${path}.attendance_status`);
  }

  if (effectiveStatus !== persistedStatus && effectiveStatus !== "CANCELLED") invalid(path);
  for (const [field, value] of [
    ["decided_at", decidedAt],
    ["withdrawn_at", withdrawnAt],
    ["waitlisted_at", waitlistedAt],
    ["promoted_at", promotedAt],
    ["removed_at", removedAt],
  ] as const) {
    if (value !== null && rfc3339Before(value, appliedAt)) invalid(`${path}.${field}`);
  }
  if (decidedAt !== null && waitlistedAt !== null && rfc3339Before(waitlistedAt, decidedAt)) {
    invalid(`${path}.waitlisted_at`);
  }
  if (promotedAt !== null
    && (waitlistedAt === null || rfc3339Before(promotedAt, waitlistedAt))) {
    invalid(`${path}.promoted_at`);
  }
  if (withdrawnAt !== null) {
    for (const [field, value] of [
      ["decided_at", decidedAt],
      ["waitlisted_at", waitlistedAt],
      ["promoted_at", promotedAt],
    ] as const) {
      if (value !== null && rfc3339Before(withdrawnAt, value)) invalid(`${path}.${field}`);
    }
  }

  const noWaitlistHistory = waitlistPosition === null
    && waitlistedAt === null
    && promotedAt === null;
  const promotedHistory = waitlistPosition === null
    && waitlistedAt !== null
    && promotedAt !== null;
  if (persistedStatus === "APPLIED") {
    if (decidedAt !== null || !noWaitlistHistory) invalid(path);
  } else if (persistedStatus === "WAITLISTED") {
    if (decidedAt === null || waitlistPosition === null
      || waitlistedAt === null || promotedAt !== null) invalid(path);
  } else if (persistedStatus === "JOINED") {
    if (decidedAt === null || (!noWaitlistHistory && !promotedHistory)) invalid(path);
  } else if (persistedStatus === "REJECTED") {
    if (decidedAt === null || !noWaitlistHistory) invalid(path);
  } else if (persistedStatus === "REMOVED") {
    if (decidedAt === null || removedAt === null
      || (!noWaitlistHistory && !promotedHistory)) invalid(path);
    if (effectiveStatus !== "REMOVED") invalid(`${path}.effective_status`);
    if (rfc3339Before(removedAt, decidedAt)
      || (promotedAt !== null && rfc3339Before(removedAt, promotedAt))) {
      invalid(`${path}.removed_at`);
    }
  }

  if (persistedStatus !== "REMOVED" && removedAt !== null) invalid(`${path}.removed_at`);

  if (persistedStatus !== "WITHDRAWN") {
    if (withdrawnAt !== null || withdrawalKind !== null || lateExitRecorded) invalid(path);
  } else {
    if (withdrawnAt === null || withdrawalKind === null) invalid(path);
    if (withdrawalKind === "APPLICATION_WITHDRAWAL") {
      if (decidedAt !== null || !noWaitlistHistory || lateExitRecorded) invalid(path);
    } else if (withdrawalKind === "WAITLIST_WITHDRAWAL") {
      if (decidedAt === null || waitlistPosition !== null || waitlistedAt === null
        || promotedAt !== null || lateExitRecorded) invalid(path);
    } else if (decidedAt === null || (!noWaitlistHistory && !promotedHistory)) {
      invalid(path);
    }
  }
  if (availableWithdrawalAction !== null) {
    if (effectiveStatus === "CANCELLED"
      || (availableWithdrawalAction === "WITHDRAW_APPLICATION" && persistedStatus !== "APPLIED")
      || (availableWithdrawalAction === "WITHDRAW_WAITLIST" && persistedStatus !== "WAITLISTED")
      || (availableWithdrawalAction === "LEAVE_GAME" && persistedStatus !== "JOINED")) invalid(path);
  }
  if (lateExitWillBeRecorded && availableWithdrawalAction !== "LEAVE_GAME") invalid(path);
  if (availableWithdrawalAction === "WITHDRAW_APPLICATION" && lateExitWillBeRecorded) invalid(path);
  if (persistedStatus === "WITHDRAWN"
    && (availableWithdrawalAction !== null || lateExitWillBeRecorded)) invalid(path);

  return Object.freeze({
    id: uuidAt(object.id, `${path}.id`),
    version: safeIntegerAt(object.version, `${path}.version`, 1),
    displayName: boundedStringAt(object.display_name, `${path}.display_name`, 2, 24),
    position: enumAt(object.position, OPEN_GAME_POSITIONS, `${path}.position`),
    note: nullableBoundedStringAt(object.note, `${path}.note`, 120),
    persistedStatus,
    effectiveStatus,
    appliedAt,
    decidedAt,
    withdrawnAt,
    withdrawalKind,
    lateExitRecorded,
    availableWithdrawalAction,
    lateExitWillBeRecorded,
    waitlistPosition,
    waitlistedAt,
    promotedAt,
    ...attendance,
    removedAt,
  });
}

function decodeMemberRemovalActions(
  value: unknown,
  path: string,
): OpenGameMemberRemovalActions {
  const object = exactObject(value, ["can_remove", "remove_blocked_reason"], path);
  const canRemove = booleanAt(object.can_remove, `${path}.can_remove`);
  const removeBlockedReason: OpenGameMemberRemovalBlockedReason | null =
    object.remove_blocked_reason === null
      ? null
      : enumAt(
        object.remove_blocked_reason,
        MEMBER_REMOVAL_BLOCKED_REASONS,
        `${path}.remove_blocked_reason`,
      );
  if (canRemove !== (removeBlockedReason === null)) invalid(path);
  return Object.freeze({ canRemove, removeBlockedReason });
}

function decodeMemberGameSummary(value: unknown, path: string): OpenGameMemberGameSummary {
  const object = exactObject(value, MEMBER_GAME_KEYS, path);
  const startsAt = rfc3339At(object.starts_at, `${path}.starts_at`);
  const endsAt = rfc3339At(object.ends_at, `${path}.ends_at`);
  if (!rfc3339Before(startsAt, endsAt)) invalid(`${path}.ends_at`);
  return Object.freeze({
    id: uuidAt(object.id, `${path}.id`),
    name: boundedStringAt(object.name, `${path}.name`, 2, 30),
    venueName: stringAt(object.venue_name, `${path}.venue_name`),
    pitchName: stringAt(object.pitch_name, `${path}.pitch_name`),
    startsAt,
    endsAt,
    timeZone: supportedIanaTimeZoneAt(object.time_zone, `${path}.time_zone`),
    state: enumAt(object.state, OPEN_GAME_STATES, `${path}.state`),
  });
}

function decodeMemberRosterItem(value: unknown, path: string): OpenGameMemberRosterItem {
  const object = exactObject(value, MEMBER_ROSTER_ITEM_KEYS, path);
  return Object.freeze({
    registrationId: uuidAt(object.registration_id, `${path}.registration_id`),
    displayName: boundedStringAt(object.display_name, `${path}.display_name`, 2, 24),
    position: enumAt(object.position, OPEN_GAME_POSITIONS, `${path}.position`),
    joinedAt: rfc3339At(object.joined_at, `${path}.joined_at`),
    promotedFromWaitlist: booleanAt(
      object.promoted_from_waitlist,
      `${path}.promoted_from_waitlist`,
    ),
    version: safeIntegerAt(object.version, `${path}.version`, 1),
    allowedActions: decodeMemberRemovalActions(object.allowed_actions, `${path}.allowed_actions`),
  });
}

function decodePromotedMember(value: unknown, path: string): OpenGamePromotedMember {
  const object = exactObject(value, PROMOTED_MEMBER_KEYS, path);
  return Object.freeze({
    registrationId: uuidAt(object.registration_id, `${path}.registration_id`),
    displayName: boundedStringAt(object.display_name, `${path}.display_name`, 2, 24),
    position: enumAt(object.position, OPEN_GAME_POSITIONS, `${path}.position`),
    version: safeIntegerAt(object.version, `${path}.version`, 2),
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

function decodeCaptainWaitlistApplication(
  value: unknown,
  path: string,
): CaptainOpenGameWaitlistApplication {
  const object = exactObject(value, CAPTAIN_WAITLIST_APPLICATION_KEYS, path);
  const appliedAt = rfc3339At(object.applied_at, `${path}.applied_at`);
  const waitlistedAt = rfc3339At(object.waitlisted_at, `${path}.waitlisted_at`);
  if (rfc3339Before(waitlistedAt, appliedAt)) invalid(`${path}.waitlisted_at`);
  return Object.freeze({
    id: uuidAt(object.id, `${path}.id`),
    displayName: boundedStringAt(object.display_name, `${path}.display_name`, 2, 24),
    position: enumAt(object.position, OPEN_GAME_POSITIONS, `${path}.position`),
    note: nullableBoundedStringAt(object.note, `${path}.note`, 120),
    appliedAt,
    waitlistedAt,
    waitlistPosition: safeIntegerAt(object.waitlist_position, `${path}.waitlist_position`, 1),
  });
}

function decodeMyApplicationItem(value: unknown, path: string): OpenGameApplicationItem {
  const object = exactObject(value, MY_APPLICATION_ITEM_KEYS, path);
  const id = uuidAt(object.id, `${path}.id`);
  if (id !== id.toLowerCase()) invalid(`${path}.id`);
  const detailPath = stringAt(object.detail_path, `${path}.detail_path`);
  if (!DETAIL_PATH_PATTERN.test(detailPath)) invalid(`${path}.detail_path`);
  const startsAt = rfc3339At(object.starts_at, `${path}.starts_at`);
  const endsAt = rfc3339At(object.ends_at, `${path}.ends_at`);
  if (!rfc3339Before(startsAt, endsAt)) invalid(`${path}.ends_at`);
  const effectiveStatus = enumAt(
    object.effective_status,
    EFFECTIVE_STATUSES,
    `${path}.effective_status`,
  );
  const appliedAt = rfc3339At(object.applied_at, `${path}.applied_at`);
  const waitlistPosition = nullablePositiveIntegerAt(
    object.waitlist_position,
    `${path}.waitlist_position`,
  );
  const waitlistedAt = nullableRfc3339At(object.waitlisted_at, `${path}.waitlisted_at`);
  const promotedAt = nullableRfc3339At(object.promoted_at, `${path}.promoted_at`);
  const attendance = decodeSelfAttendance(
    object.attendance_status,
    object.attendance_recorded_at,
    object.attendance_corrected_at,
    path,
  );
  if (effectiveStatus !== "JOINED" && attendance.attendanceStatus !== null) {
    invalid(`${path}.attendance_status`);
  }
  if (waitlistedAt !== null && rfc3339Before(waitlistedAt, appliedAt)) {
    invalid(`${path}.waitlisted_at`);
  }
  if (promotedAt !== null
    && (waitlistedAt === null || rfc3339Before(promotedAt, waitlistedAt))) {
    invalid(`${path}.promoted_at`);
  }
  const noHistory = waitlistPosition === null && waitlistedAt === null && promotedAt === null;
  const currentWaitlist = waitlistPosition !== null
    && waitlistedAt !== null
    && promotedAt === null;
  const withdrawnWaitlist = waitlistPosition === null
    && waitlistedAt !== null
    && promotedAt === null;
  const promotedHistory = waitlistPosition === null
    && waitlistedAt !== null
    && promotedAt !== null;
  if ((effectiveStatus === "WAITLISTED" && !currentWaitlist)
    || (effectiveStatus === "JOINED" && !noHistory && !promotedHistory)
    || ((effectiveStatus === "APPLIED" || effectiveStatus === "REJECTED") && !noHistory)
    || (effectiveStatus === "WITHDRAWN"
      && !noHistory && !withdrawnWaitlist && !promotedHistory)
    || (effectiveStatus === "CANCELLED"
      && !noHistory && !currentWaitlist && !withdrawnWaitlist && !promotedHistory)) invalid(path);
  return Object.freeze({
    id,
    effectiveStatus,
    appliedAt,
    waitlistPosition,
    waitlistedAt,
    promotedAt,
    ...attendance,
    detailPath,
    gameName: stringAt(object.game_name, `${path}.game_name`),
    startsAt,
    endsAt,
    timeZone: supportedIanaTimeZoneAt(object.time_zone, `${path}.time_zone`),
    venueName: stringAt(object.venue_name, `${path}.venue_name`),
    pitchName: stringAt(object.pitch_name, `${path}.pitch_name`),
    pitchSpecification: stringAt(object.pitch_specification, `${path}.pitch_specification`),
  });
}

export function decodeOpenGameAttendanceRoster(value: unknown): OpenGameAttendanceRoster {
  const object = exactObject(value, ATTENDANCE_ROSTER_KEYS, "$" );
  const registrations = Object.freeze(arrayAt(object.registrations, "$.registrations").map(
    (registration, index) => decodeAttendanceRosterItem(
      registration,
      `$.registrations[${index}]`,
    ),
  ));
  const recordedCount = safeIntegerAt(object.recorded_count, "$.recorded_count");
  const totalCount = safeIntegerAt(object.total_count, "$.total_count");
  const attendanceComplete = booleanAt(object.attendance_complete, "$.attendance_complete");
  const terminalCount = registrations.filter(
    (registration) => registration.attendanceStatus !== "UNMARKED",
  ).length;
  if (totalCount !== registrations.length) invalid("$.total_count");
  if (recordedCount !== terminalCount) invalid("$.recorded_count");
  if (attendanceComplete !== (recordedCount === totalCount)) {
    invalid("$.attendance_complete");
  }
  return Object.freeze({
    game: decodeAttendanceGameSummary(object.game, "$.game"),
    recordedCount,
    totalCount,
    attendanceComplete,
    registrations,
  });
}

export function decodeOpenGameAttendanceMarkResult(
  value: unknown,
): OpenGameAttendanceMarkResult {
  const object = exactObject(value, ATTENDANCE_MARK_RESULT_KEYS, "$" );
  const recordedCount = safeIntegerAt(object.recorded_count, "$.recorded_count", 1);
  const totalCount = safeIntegerAt(object.total_count, "$.total_count", 1);
  const attendanceComplete = booleanAt(object.attendance_complete, "$.attendance_complete");
  if (recordedCount > totalCount) invalid("$.recorded_count");
  if (attendanceComplete !== (recordedCount === totalCount)) {
    invalid("$.attendance_complete");
  }
  return Object.freeze({
    registrationId: uuidAt(object.registration_id, "$.registration_id"),
    attendanceStatus: enumAt(
      object.attendance_status,
      TERMINAL_ATTENDANCE_STATUSES,
      "$.attendance_status",
    ),
    attendanceRecordedAt: rfc3339At(
      object.attendance_recorded_at,
      "$.attendance_recorded_at",
    ),
    version: safeIntegerAt(object.version, "$.version", 2),
    recordedCount,
    totalCount,
    attendanceComplete,
  });
}

export function decodeOpenGameMemberRoster(value: unknown): OpenGameMemberRoster {
  const object = exactObject(value, MEMBER_ROSTER_KEYS, "$" );
  const members = Object.freeze(arrayAt(object.members, "$.members").map(
    (member, index) => decodeMemberRosterItem(member, `$.members[${index}]`),
  ));
  const joinedCount = safeIntegerAt(object.joined_count, "$.joined_count");
  if (joinedCount !== members.length) invalid("$.joined_count");
  const identities = new Set<string>();
  members.forEach((member, index) => {
    if (identities.has(member.registrationId)) invalid(`$.members[${index}].registration_id`);
    identities.add(member.registrationId);
  });
  return Object.freeze({
    game: decodeMemberGameSummary(object.game, "$.game"),
    joinedCount,
    remainingSpots: safeIntegerAt(object.remaining_spots, "$.remaining_spots"),
    waitlistCount: safeIntegerAt(object.waitlist_count, "$.waitlist_count"),
    members,
  });
}

export function decodeOpenGameMemberRemovalResult(
  value: unknown,
): OpenGameMemberRemovalResult {
  const object = exactObject(value, MEMBER_REMOVAL_RESULT_KEYS, "$" );
  const remainingSpots = safeIntegerAt(object.remaining_spots, "$.remaining_spots");
  const promotedMember = object.promoted_member === null
    ? null
    : decodePromotedMember(object.promoted_member, "$.promoted_member");
  if (promotedMember !== null && remainingSpots !== 0) invalid("$.remaining_spots");
  return Object.freeze({
    removedRegistrationId: uuidAt(
      object.removed_registration_id,
      "$.removed_registration_id",
    ),
    removedDisplayName: boundedStringAt(
      object.removed_display_name,
      "$.removed_display_name",
      2,
      24,
    ),
    status: enumAt(object.status, ["REMOVED"] as const, "$.status"),
    version: safeIntegerAt(object.version, "$.version", 2),
    removedAt: rfc3339At(object.removed_at, "$.removed_at"),
    joinedCount: safeIntegerAt(object.joined_count, "$.joined_count"),
    remainingSpots,
    waitlistCount: safeIntegerAt(object.waitlist_count, "$.waitlist_count"),
    promotedMember,
  });
}

export function decodeOpenGameRegistrationContext(value: unknown): OpenGameRegistrationContext {
  const object = exactObject(value, CONTEXT_KEYS, "$" );
  const game = decodeOpenGamePublic(object.game, "$.game");
  const viewerAuthenticated = booleanAt(object.viewer_authenticated, "$.viewer_authenticated");
  const viewerRegistration = object.viewer_registration === null
    ? null
    : decodeViewerRegistration(object.viewer_registration, "$.viewer_registration");
  if (!viewerAuthenticated && viewerRegistration !== null) invalid("$.viewer_registration");
  if (viewerRegistration !== null) {
    const shouldExposeAttendance = game.state === "COMPLETED"
      && viewerRegistration.effectiveStatus === "JOINED";
    if (shouldExposeAttendance !== (viewerRegistration.attendanceStatus !== null)) {
      invalid("$.viewer_registration.attendance_status");
    }
  }
  return Object.freeze({
    game,
    remainingSpots: safeIntegerAt(object.remaining_spots, "$.remaining_spots"),
    viewerAuthenticated,
    viewerRegistration,
    allowedActions: decodeApplyActions(object.allowed_actions, "$.allowed_actions"),
  });
}

export function decodeOpenGameApplicationQueue(value: unknown): OpenGameApplicationQueue {
  const object = exactObject(value, QUEUE_KEYS, "$" );
  const applications = Object.freeze(arrayAt(object.applications, "$.applications").map(
    (application, index) => decodeCaptainApplication(application, `$.applications[${index}]`),
  ));
  const waitlist = Object.freeze(arrayAt(object.waitlist, "$.waitlist").map(
    (application, index) => decodeCaptainWaitlistApplication(
      application,
      `$.waitlist[${index}]`,
    ),
  ));
  const pendingCount = safeIntegerAt(object.pending_count, "$.pending_count");
  const waitlistCount = safeIntegerAt(object.waitlist_count, "$.waitlist_count");
  if (pendingCount !== applications.length) invalid("$.pending_count");
  if (waitlistCount !== waitlist.length) invalid("$.waitlist_count");
  waitlist.forEach((application, index) => {
    if (application.waitlistPosition !== index + 1) {
      invalid(`$.waitlist[${index}].waitlist_position`);
    }
  });
  return Object.freeze({
    remainingSpots: safeIntegerAt(object.remaining_spots, "$.remaining_spots"),
    pendingCount,
    applications,
    waitlistCount,
    waitlist,
  });
}

export function decodeMyOpenGameApplications(value: unknown): OpenGameApplicationPage {
  const object = exactObject(value, MY_APPLICATION_PAGE_KEYS, "$");
  const items = Object.freeze(arrayAt(object.items, "$.items").map(
    (item, index) => decodeMyApplicationItem(item, `$.items[${index}]`),
  ));
  const ids = new Set<string>();
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (ids.has(item.id)) invalid(`$.items[${index}].id`);
    ids.add(item.id);
    if (index === 0) continue;
    const previous = items[index - 1];
    if (rfc3339Before(previous.appliedAt, item.appliedAt)) {
      invalid(`$.items[${index}].applied_at`);
    }
    if (!rfc3339Before(item.appliedAt, previous.appliedAt) && previous.id <= item.id) {
      invalid(`$.items[${index}].id`);
    }
  }
  const nextCursor = object.next_cursor === null
    ? null
    : stringAt(object.next_cursor, "$.next_cursor");
  return Object.freeze({ items, nextCursor });
}

export function decodeOpenGameApplicationDecisionResult(
  value: unknown,
): OpenGameApplicationDecisionResult {
  const object = exactObject(value, DECISION_RESULT_KEYS, "$" );
  const allowedActions = decodeReviewActions(object.allowed_actions, "$.allowed_actions");
  if (allowedActions.canAccept || allowedActions.canWaitlist || allowedActions.canReject
    || allowedActions.acceptBlockedReason !== "APPLICATION_NOT_PENDING"
    || allowedActions.waitlistBlockedReason !== "APPLICATION_NOT_PENDING"
    || allowedActions.rejectBlockedReason !== "APPLICATION_NOT_PENDING") {
    invalid("$.allowed_actions");
  }
  return Object.freeze({
    applicationId: uuidAt(object.application_id, "$.application_id"),
    status: enumAt(object.status, ["WAITLISTED", "JOINED", "REJECTED"] as const, "$.status"),
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

export function validateOpenGameMemberRemovalReason(
  value: unknown,
): OpenGameMemberRemovalReasonValidation {
  const reason = typeof value === "string" ? value.trim() : "";
  const length = Array.from(reason).length;
  const error = length < 1
    ? "请填写移除原因"
    : length > 120
      ? "移除原因最多 120 个字符"
      : containsPrivateText(reason)
        ? "请勿填写联系方式或证件号码"
        : null;
  return error === null
    ? Object.freeze({ valid: true, reason, error: null })
    : Object.freeze({ valid: false, reason: null, error });
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
