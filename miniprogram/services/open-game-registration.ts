import type {
  OpenGameApplicationDecisionResult,
  OpenGameApplicationQueue,
  OpenGameApplicationPage,
  OpenGameApplicationSubmission,
  OpenGameAttendanceMarkResult,
  OpenGameAttendanceMarkStatus,
  OpenGameAttendanceRoster,
  OpenGameMemberRemovalResult,
  OpenGameMemberRoster,
  OpenGameRegistrationContext,
  OpenGameRegistrationWithdrawalAction,
} from "../domain/open-game-registration";

export type OpenGameRegistrationAttempt =
  | {
    readonly kind: "apply";
    readonly originatingUserId: string;
    readonly shareToken: string;
    readonly body: OpenGameApplicationSubmission;
    readonly idempotencyKey: string;
  }
  | {
    readonly kind: "decision";
    readonly originatingUserId: string;
    readonly gameId: string;
    readonly applicationId: string;
    readonly decision: "ACCEPT" | "REJECT" | "WAITLIST";
    readonly expectedVersion: number;
    readonly idempotencyKey: string;
  }
  | {
    readonly kind: "withdraw";
    readonly originatingUserId: string;
    readonly shareToken: string;
    readonly applicationId: string;
    readonly action: OpenGameRegistrationWithdrawalAction;
    readonly expectedVersion: number;
    readonly idempotencyKey: string;
  }
  | {
    readonly kind: "attendance";
    readonly originatingUserId: string;
    readonly gameId: string;
    readonly registrationId: string;
    readonly attendanceStatus: OpenGameAttendanceMarkStatus;
    readonly expectedVersion: number;
    readonly idempotencyKey: string;
  }
  | {
    readonly kind: "remove-member";
    readonly originatingUserId: string;
    readonly gameId: string;
    readonly registrationId: string;
    readonly expectedVersion: number;
    readonly reason: string;
    readonly idempotencyKey: string;
  };

export type OpenGameRegistrationApplyAttempt = Extract<
  OpenGameRegistrationAttempt,
  { readonly kind: "apply" }
>;
export type OpenGameRegistrationDecisionAttempt = Extract<
  OpenGameRegistrationAttempt,
  { readonly kind: "decision" }
>;
export type OpenGameRegistrationWithdrawAttempt = Extract<
  OpenGameRegistrationAttempt,
  { readonly kind: "withdraw" }
>;
export type OpenGameAttendanceMarkAttempt = Extract<
  OpenGameRegistrationAttempt,
  { readonly kind: "attendance" }
>;
export type OpenGameMemberRemoveAttempt = Extract<
  OpenGameRegistrationAttempt,
  { readonly kind: "remove-member" }
>;

export type OpenGameRegistrationAttemptAvailability =
  | { readonly kind: "READY"; readonly attempt: OpenGameRegistrationAttempt }
  | { readonly kind: "SAME_ACCOUNT_PENDING"; readonly attempt: OpenGameRegistrationAttempt }
  | { readonly kind: "FOREIGN_ACCOUNT_PENDING"; readonly attempt: OpenGameRegistrationAttempt };

export type OpenGameRegistrationAttemptResolution =
  | Extract<OpenGameRegistrationAttemptAvailability, { readonly kind: "READY" }>
  | Extract<OpenGameRegistrationAttemptAvailability, { readonly kind: "FOREIGN_ACCOUNT_PENDING" }>;

export interface OpenGameRegistrationAttemptStore {
  load(): OpenGameRegistrationAttempt | null;
  begin(attempt: OpenGameRegistrationAttempt): OpenGameRegistrationAttemptAvailability;
  resolveForUser(userId: string): OpenGameRegistrationAttemptResolution | null;
  clear(): void;
}

export interface OpenGameRegistrationSource {
  login(): Promise<string>;
  currentUserId(): string | null;
  listMine(cursor?: string, limit?: number): Promise<OpenGameApplicationPage>;
  getContext(shareToken: string): Promise<OpenGameRegistrationContext>;
  apply(attempt: OpenGameRegistrationApplyAttempt): Promise<OpenGameRegistrationContext>;
  getPending(gameId: string): Promise<OpenGameApplicationQueue>;
  decide(attempt: OpenGameRegistrationDecisionAttempt): Promise<OpenGameApplicationDecisionResult>;
  withdraw(attempt: OpenGameRegistrationWithdrawAttempt): Promise<OpenGameRegistrationContext>;
  getAttendanceRoster(gameId: string): Promise<OpenGameAttendanceRoster>;
  markAttendance(attempt: OpenGameAttendanceMarkAttempt): Promise<OpenGameAttendanceMarkResult>;
  getMembers(gameId: string): Promise<OpenGameMemberRoster>;
  removeMember(attempt: OpenGameMemberRemoveAttempt): Promise<OpenGameMemberRemovalResult>;
}

export type OpenGameRegistrationApiErrorCode =
  | "AUTH_REQUIRED"
  | "LOGIN_FAILED"
  | "OPEN_GAME_NOT_FOUND"
  | "APPLICATION_NOT_FOUND"
  | "APPLICATION_ALREADY_EXISTS"
  | "APPLICATION_NOT_ALLOWED"
  | "APPLICATION_STATE_CHANGED"
  | "APPLICATION_CAPACITY_CHANGED"
  | "ATTENDANCE_STATE_CHANGED"
  | "IDEMPOTENCY_KEY_REUSED"
  | "INVALID_ARGUMENT"
  | "SERVICE_UNAVAILABLE"
  | "APPLICATION_RESULT_UNKNOWN";

export type OpenGameRegistrationMutationRecoveryDecision =
  | { readonly kind: "ACCEPT_AUTHORITY_AND_CLEAR"; readonly clearAttempt: true }
  | { readonly kind: "PRESERVE_LOGIN_COMPARE_ACCOUNT"; readonly clearAttempt: false }
  | { readonly kind: "PRESERVE_APPLICATION_RESULT_UNKNOWN"; readonly clearAttempt: false }
  | { readonly kind: "PRESERVE_READ_CONTEXT_THEN_CLEAR"; readonly clearAttempt: false }
  | { readonly kind: "CLEAR_AND_REFRESH_CONTEXT"; readonly clearAttempt: true }
  | { readonly kind: "CLEAR_AND_REFRESH_QUEUE"; readonly clearAttempt: true }
  | { readonly kind: "CLEAR_AND_REFRESH_ROSTER"; readonly clearAttempt: true }
  | { readonly kind: "CLEAR_AND_SHOW_CONFLICT"; readonly clearAttempt: true }
  | { readonly kind: "CLEAR_AND_CORRECT_OR_REFRESH"; readonly clearAttempt: true }
  | { readonly kind: "CLEAR_AND_RETURN"; readonly clearAttempt: true }
  | { readonly kind: "RETRY_READ"; readonly clearAttempt: false };

export function classifyOpenGameRegistrationMutationResult(
  result: "SUCCESS" | OpenGameRegistrationApiErrorCode,
): OpenGameRegistrationMutationRecoveryDecision {
  if (result === "SUCCESS") return { kind: "ACCEPT_AUTHORITY_AND_CLEAR", clearAttempt: true };
  if (result === "AUTH_REQUIRED" || result === "LOGIN_FAILED") {
    return { kind: "PRESERVE_LOGIN_COMPARE_ACCOUNT", clearAttempt: false };
  }
  if (result === "APPLICATION_RESULT_UNKNOWN") {
    return { kind: "PRESERVE_APPLICATION_RESULT_UNKNOWN", clearAttempt: false };
  }
  if (result === "APPLICATION_ALREADY_EXISTS") {
    return { kind: "PRESERVE_READ_CONTEXT_THEN_CLEAR", clearAttempt: false };
  }
  if (result === "APPLICATION_NOT_ALLOWED") {
    return { kind: "CLEAR_AND_REFRESH_CONTEXT", clearAttempt: true };
  }
  if (result === "APPLICATION_STATE_CHANGED" || result === "APPLICATION_CAPACITY_CHANGED") {
    return { kind: "CLEAR_AND_REFRESH_QUEUE", clearAttempt: true };
  }
  if (result === "ATTENDANCE_STATE_CHANGED") {
    return { kind: "CLEAR_AND_REFRESH_ROSTER", clearAttempt: true };
  }
  if (result === "IDEMPOTENCY_KEY_REUSED") {
    return { kind: "CLEAR_AND_SHOW_CONFLICT", clearAttempt: true };
  }
  if (result === "INVALID_ARGUMENT") {
    return { kind: "CLEAR_AND_CORRECT_OR_REFRESH", clearAttempt: true };
  }
  if (result === "OPEN_GAME_NOT_FOUND" || result === "APPLICATION_NOT_FOUND") {
    return { kind: "CLEAR_AND_RETURN", clearAttempt: true };
  }
  return { kind: "RETRY_READ", clearAttempt: false };
}

export type OpenGameRegistrationUnknownRecoveryDecision =
  | {
    readonly kind: "ACCEPT_AUTHORITY_AND_CLEAR";
    readonly authority: OpenGameRegistrationContext;
    readonly clearAttempt: true;
  }
  | {
    readonly kind: "REPLAY_SAME_ATTEMPT";
    readonly attempt: OpenGameRegistrationAttempt;
    readonly clearAttempt: false;
  };

export type OpenGameAttendanceUnknownRecoveryDecision =
  | {
    readonly kind: "ACCEPT_AUTHORITY_AND_CLEAR";
    readonly authority: OpenGameAttendanceRoster;
    readonly clearAttempt: true;
  }
  | {
    readonly kind: "REPLAY_SAME_ATTEMPT";
    readonly attempt: OpenGameAttendanceMarkAttempt;
    readonly clearAttempt: false;
  };

export type OpenGameMemberRemovalUnknownRecoveryDecision =
  | {
    readonly kind: "ACCEPT_AUTHORITY_AND_CLEAR";
    readonly authority: OpenGameMemberRoster;
    readonly clearAttempt: true;
  }
  | {
    readonly kind: "REPLAY_SAME_ATTEMPT";
    readonly attempt: OpenGameMemberRemoveAttempt;
    readonly clearAttempt: false;
  };

export function classifyOpenGameMemberRemovalUnknownResult(
  attempt: OpenGameMemberRemoveAttempt,
  authority: OpenGameMemberRoster,
): OpenGameMemberRemovalUnknownRecoveryDecision {
  const member = authority.game.id === attempt.gameId
    ? authority.members.find((item) => item.registrationId === attempt.registrationId)
    : undefined;
  const unchanged = member?.version === attempt.expectedVersion
    && member.allowedActions.canRemove
    && member.allowedActions.removeBlockedReason === null;
  if (unchanged) return { kind: "REPLAY_SAME_ATTEMPT", attempt, clearAttempt: false };
  return { kind: "ACCEPT_AUTHORITY_AND_CLEAR", authority, clearAttempt: true };
}

export function classifyOpenGameAttendanceUnknownResult(
  attempt: OpenGameAttendanceMarkAttempt,
  authority: OpenGameAttendanceRoster,
): OpenGameAttendanceUnknownRecoveryDecision {
  const registration = authority.game.id === attempt.gameId
    ? authority.registrations.find((item) => item.registrationId === attempt.registrationId)
    : undefined;
  const expectedTerminalVersion = attempt.expectedVersion + 1;
  const matchingTerminal = Number.isSafeInteger(expectedTerminalVersion)
    && registration?.version === expectedTerminalVersion
    && registration.attendanceStatus === attempt.attendanceStatus;
  if (matchingTerminal) {
    return { kind: "ACCEPT_AUTHORITY_AND_CLEAR", authority, clearAttempt: true };
  }
  const unchanged = registration?.version === attempt.expectedVersion
    && registration.attendanceStatus === "UNMARKED";
  if (unchanged) return { kind: "REPLAY_SAME_ATTEMPT", attempt, clearAttempt: false };
  return { kind: "ACCEPT_AUTHORITY_AND_CLEAR", authority, clearAttempt: true };
}

function withdrawalAuthorityForAction(value: unknown): {
  readonly persistedStatus: "APPLIED" | "WAITLISTED" | "JOINED";
  readonly withdrawalKind: "APPLICATION_WITHDRAWAL" | "WAITLIST_WITHDRAWAL" | "GAME_EXIT";
} {
  if (value === "WITHDRAW_APPLICATION") {
    return { persistedStatus: "APPLIED", withdrawalKind: "APPLICATION_WITHDRAWAL" };
  }
  if (value === "LEAVE_GAME") {
    return { persistedStatus: "JOINED", withdrawalKind: "GAME_EXIT" };
  }
  if (value === "WITHDRAW_WAITLIST") {
    return { persistedStatus: "WAITLISTED", withdrawalKind: "WAITLIST_WITHDRAWAL" };
  }
  throw new Error("INVALID_OPEN_GAME_REGISTRATION_WITHDRAWAL_ACTION");
}

export function classifyOpenGameRegistrationUnknownResult(
  attempt: OpenGameRegistrationApplyAttempt,
  context: OpenGameRegistrationContext,
): OpenGameRegistrationUnknownRecoveryDecision;
export function classifyOpenGameRegistrationUnknownResult(
  attempt: OpenGameRegistrationDecisionAttempt,
): OpenGameRegistrationUnknownRecoveryDecision;
export function classifyOpenGameRegistrationUnknownResult(
  attempt: OpenGameRegistrationWithdrawAttempt,
  context: OpenGameRegistrationContext,
): OpenGameRegistrationUnknownRecoveryDecision;
export function classifyOpenGameRegistrationUnknownResult(
  attempt: OpenGameRegistrationAttempt,
  context?: OpenGameRegistrationContext,
): OpenGameRegistrationUnknownRecoveryDecision {
  if (attempt.kind === "apply") {
    if (context === undefined) throw new Error("OPEN_GAME_REGISTRATION_CONTEXT_REQUIRED");
    if (context.viewerRegistration !== null) {
      return { kind: "ACCEPT_AUTHORITY_AND_CLEAR", authority: context, clearAttempt: true };
    }
  }
  if (attempt.kind === "withdraw") {
    if (context === undefined) throw new Error("OPEN_GAME_REGISTRATION_CONTEXT_REQUIRED");
    const registration = context.viewerRegistration;
    const authority = withdrawalAuthorityForAction(attempt.action);
    const expectedTerminalVersion = attempt.expectedVersion + 1;
    const exactTerminal = Number.isSafeInteger(expectedTerminalVersion)
      && registration !== null
      && registration.id === attempt.applicationId
      && registration.persistedStatus === "WITHDRAWN"
      && registration.version === expectedTerminalVersion
      && registration.withdrawalKind === authority.withdrawalKind;
    if (exactTerminal) {
      return { kind: "ACCEPT_AUTHORITY_AND_CLEAR", authority: context, clearAttempt: true };
    }
    const unchanged = registration !== null
      && registration.id === attempt.applicationId
      && registration.persistedStatus === authority.persistedStatus
      && registration.effectiveStatus === authority.persistedStatus
      && registration.version === attempt.expectedVersion
      && registration.availableWithdrawalAction === attempt.action;
    if (!unchanged) {
      return { kind: "ACCEPT_AUTHORITY_AND_CLEAR", authority: context, clearAttempt: true };
    }
  }
  return { kind: "REPLAY_SAME_ATTEMPT", attempt, clearAttempt: false };
}

export type OpenGameRegistrationAttemptTarget =
  | { readonly kind: "apply"; readonly shareToken: string }
  | { readonly kind: "decision"; readonly gameId: string }
  | { readonly kind: "withdraw"; readonly shareToken: string }
  | { readonly kind: "attendance"; readonly gameId: string }
  | { readonly kind: "remove-member"; readonly gameId: string };

export type OpenGameRegistrationPendingAttemptDecision =
  | {
    readonly kind: "READY";
    readonly attempt: OpenGameRegistrationAttempt;
    readonly clearAttempt: false;
  }
  | { readonly kind: "PRESERVE_LOGIN_COMPARE_ACCOUNT"; readonly clearAttempt: false }
  | { readonly kind: "PRESERVE_AND_NAVIGATE"; readonly route: string; readonly clearAttempt: false }
  | { readonly kind: "FOREIGN_ACCOUNT_PENDING"; readonly clearAttempt: false };

export function classifyOpenGameRegistrationPendingAttempt(
  attempt: OpenGameRegistrationAttempt,
  currentUserId: string | null,
  target: OpenGameRegistrationAttemptTarget,
): OpenGameRegistrationPendingAttemptDecision {
  if (currentUserId === null) {
    return { kind: "PRESERVE_LOGIN_COMPARE_ACCOUNT", clearAttempt: false };
  }
  if (currentUserId !== attempt.originatingUserId) {
    return { kind: "FOREIGN_ACCOUNT_PENDING", clearAttempt: false };
  }
  const sameResource = attempt.kind === "apply"
    ? target.kind === "apply" && target.shareToken === attempt.shareToken
    : attempt.kind === "decision"
      ? target.kind === "decision" && target.gameId === attempt.gameId
      : attempt.kind === "withdraw"
        ? target.kind === "withdraw" && target.shareToken === attempt.shareToken
        : attempt.kind === "attendance"
          ? target.kind === "attendance" && target.gameId === attempt.gameId
          : target.kind === "remove-member" && target.gameId === attempt.gameId;
  if (sameResource) return { kind: "READY", attempt, clearAttempt: false };
  const route = attempt.kind === "decision"
    ? `/pages/captain-game-applications/index?game_id=${attempt.gameId}`
    : attempt.kind === "attendance"
      ? `/pages/captain-game-attendance/index?game_id=${attempt.gameId}`
      : attempt.kind === "remove-member"
        ? `/pages/captain-game-members/index?game_id=${attempt.gameId}`
        : `/pages/captain-game-public/index?token=${attempt.shareToken}`;
  return { kind: "PRESERVE_AND_NAVIGATE", route, clearAttempt: false };
}

let configuredSource: OpenGameRegistrationSource | undefined;

export function registerOpenGameRegistrationSource(source: OpenGameRegistrationSource): void {
  configuredSource = source;
}

export function getOpenGameRegistrationSource(): OpenGameRegistrationSource {
  if (configuredSource === undefined) throw new Error("OPEN_GAME_REGISTRATION_SOURCE_NOT_CONFIGURED");
  return configuredSource;
}

export function resetOpenGameRegistrationSourceForTesting(): void {
  configuredSource = undefined;
}

let configuredAttemptStore: OpenGameRegistrationAttemptStore | undefined;

export function registerOpenGameRegistrationAttemptStore(store: OpenGameRegistrationAttemptStore): void {
  configuredAttemptStore = store;
}

export function getOpenGameRegistrationAttemptStore(): OpenGameRegistrationAttemptStore {
  if (configuredAttemptStore === undefined) {
    throw new Error("OPEN_GAME_REGISTRATION_ATTEMPT_STORE_NOT_CONFIGURED");
  }
  return configuredAttemptStore;
}

export function resetOpenGameRegistrationAttemptStoreForTesting(): void {
  configuredAttemptStore = undefined;
}
