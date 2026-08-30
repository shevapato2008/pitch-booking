import { decodeWeChatSession } from "../domain/decoders";
import {
  arrayAt,
  enumAt,
  exactObject,
  stringAt,
} from "../domain/decoder-primitives";
import {
  decodeOpenGameApplicationDecisionResult,
  decodeOpenGameApplicationQueue,
  decodeMyOpenGameApplications,
  decodeOpenGameRegistrationContext,
} from "../domain/open-game-registration-decoder";
import type {
  OpenGameApplyBlockedReason,
  OpenGameRegistrationContext,
  OpenGameReviewActions,
  OpenGameReviewBlockedReason,
  OpenGameWaitlistBlockedReason,
} from "../domain/open-game-registration";
import type {
  StatusTransport,
  TransportError,
  WeChatIdentityCapability,
} from "../runtime/interfaces";
import type {
  OpenGameRegistrationApiErrorCode,
  OpenGameRegistrationApplyAttempt,
  OpenGameRegistrationDecisionAttempt,
  OpenGameRegistrationSource,
  OpenGameRegistrationWithdrawAttempt,
} from "./open-game-registration";
import type { SessionStore, StoredSession } from "./session-store";

export interface OpenGameRegistrationFieldError {
  readonly field: string;
  readonly message: string;
}

export interface OpenGameRegistrationInvalidArgumentDetails {
  readonly fields: readonly OpenGameRegistrationFieldError[];
}

export interface OpenGameRegistrationNotAllowedDetails {
  readonly applyBlockedReason: OpenGameApplyBlockedReason;
  readonly remainingSpots: number;
}

export interface OpenGameRegistrationCapacityChangedDetails {
  readonly remainingSpots: number;
  readonly allowedActions: OpenGameReviewActions;
}

export type OpenGameRegistrationApiErrorDetails =
  | undefined
  | OpenGameRegistrationInvalidArgumentDetails
  | OpenGameRegistrationNotAllowedDetails
  | OpenGameRegistrationCapacityChangedDetails;

type NoDetailsCode = Exclude<
  OpenGameRegistrationApiErrorCode,
  "INVALID_ARGUMENT" | "APPLICATION_NOT_ALLOWED" | "APPLICATION_CAPACITY_CHANGED"
>;

export class OpenGameRegistrationApiError extends Error {
  readonly code: OpenGameRegistrationApiErrorCode;
  readonly details: OpenGameRegistrationApiErrorDetails;

  constructor(code: NoDetailsCode);
  constructor(code: "INVALID_ARGUMENT", details?: OpenGameRegistrationInvalidArgumentDetails);
  constructor(code: "APPLICATION_NOT_ALLOWED", details: OpenGameRegistrationNotAllowedDetails);
  constructor(
    code: "APPLICATION_CAPACITY_CHANGED",
    details: OpenGameRegistrationCapacityChangedDetails,
  );
  constructor(
    code: OpenGameRegistrationApiErrorCode,
    details?: OpenGameRegistrationApiErrorDetails,
  ) {
    super(code);
    this.name = "OpenGameRegistrationApiError";
    this.code = code;
    this.details = details;
  }
}

type Operation = "context" | "apply" | "queue" | "decide" | "withdraw" | "mine";

const APPLY_FIELDS = [
  "display_name",
  "position",
  "note",
  "adult_confirmed",
  "risk_confirmed",
] as const;
const DECISION_FIELDS = ["decision", "expected_version"] as const;
const WITHDRAW_FIELDS = ["action", "expected_version"] as const;
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
const WAITLIST_BLOCKED_REASONS = [
  "APPLICATION_NOT_PENDING",
  "GAME_SUSPENDED",
  "GAME_CANCELLED",
  "GAME_COMPLETED",
  "GAME_STARTED",
  "GAME_NOT_FULL",
  "WAITLIST_NOT_ENABLED",
] as const;
const REVIEW_BLOCKED_REASONS = [
  "APPLICATION_NOT_PENDING",
  "GAME_SUSPENDED",
  "GAME_CANCELLED",
  "GAME_COMPLETED",
  "GAME_STARTED",
  "GAME_FULL",
] as const;

const DEFINITIVE_CODES: Readonly<
  Record<Operation, Readonly<Partial<Record<number, readonly OpenGameRegistrationApiErrorCode[]>>>>
> = {
  context: {
    401: ["AUTH_REQUIRED"],
    404: ["OPEN_GAME_NOT_FOUND"],
  },
  apply: {
    401: ["AUTH_REQUIRED"],
    404: ["OPEN_GAME_NOT_FOUND"],
    409: ["APPLICATION_ALREADY_EXISTS", "APPLICATION_NOT_ALLOWED", "IDEMPOTENCY_KEY_REUSED"],
    422: ["INVALID_ARGUMENT"],
  },
  queue: {
    401: ["AUTH_REQUIRED"],
    404: ["OPEN_GAME_NOT_FOUND"],
    422: ["INVALID_ARGUMENT"],
  },
  mine: {
    401: ["AUTH_REQUIRED"],
    422: ["INVALID_ARGUMENT"],
  },
  decide: {
    401: ["AUTH_REQUIRED"],
    404: ["OPEN_GAME_NOT_FOUND", "APPLICATION_NOT_FOUND"],
    409: ["APPLICATION_STATE_CHANGED", "APPLICATION_CAPACITY_CHANGED", "IDEMPOTENCY_KEY_REUSED"],
    422: ["INVALID_ARGUMENT"],
  },
  withdraw: {
    401: ["AUTH_REQUIRED"],
    404: ["APPLICATION_NOT_FOUND"],
    409: ["APPLICATION_STATE_CHANGED", "IDEMPOTENCY_KEY_REUSED"],
    422: ["INVALID_ARGUMENT"],
  },
};

function booleanAt(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new Error(path);
  return value;
}

function safeIntegerAt(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(path);
  return value as number;
}

function expectedDecisionStatus(value: unknown): "JOINED" | "REJECTED" {
  if (value === "ACCEPT") return "JOINED";
  if (value === "REJECT") return "REJECTED";
  throw new Error("UNSUPPORTED_APPLICATION_DECISION");
}

function withdrawalKindForAction(value: unknown): "APPLICATION_WITHDRAWAL" | "GAME_EXIT" {
  if (value === "WITHDRAW_APPLICATION") return "APPLICATION_WITHDRAWAL";
  if (value === "LEAVE_GAME") return "GAME_EXIT";
  throw new Error("UNSUPPORTED_APPLICATION_WITHDRAWAL");
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
    || (!capacityAvailable && !fullCapacity && !commonBlocked)) throw new Error(path);
  return Object.freeze({
    canAccept,
    acceptBlockedReason,
    canWaitlist,
    waitlistBlockedReason,
    canReject,
    rejectBlockedReason,
  });
}

function decodeInvalidArgumentDetails(
  value: unknown,
  operation: Operation,
): OpenGameRegistrationInvalidArgumentDetails | undefined {
  const details = value as Record<string, unknown>;
  if (typeof details === "object" && details !== null && !Array.isArray(details)
    && Object.keys(details).length === 0) return undefined;
  const object = exactObject(value, ["fields"], "$.error.details");
  const allowedFields: readonly string[] = operation === "apply"
    ? APPLY_FIELDS
    : operation === "decide" ? DECISION_FIELDS
      : operation === "withdraw" ? WITHDRAW_FIELDS : [];
  const fields = Object.freeze(arrayAt(object.fields, "$.error.details.fields", 1).map(
    (item, index): OpenGameRegistrationFieldError => {
      const path = `$.error.details.fields[${index}]`;
      const field = exactObject(item, ["field", "message"], path);
      const fieldName = stringAt(field.field, `${path}.field`);
      if (!allowedFields.includes(fieldName)) throw new Error(`${path}.field`);
      return Object.freeze({
        field: fieldName,
        message: stringAt(field.message, `${path}.message`),
      });
    },
  ));
  return Object.freeze({ fields });
}

function decodeNotAllowedDetails(value: unknown): OpenGameRegistrationNotAllowedDetails {
  const object = exactObject(
    value,
    ["apply_blocked_reason", "remaining_spots"],
    "$.error.details",
  );
  return Object.freeze({
    applyBlockedReason: enumAt(
      object.apply_blocked_reason,
      APPLY_BLOCKED_REASONS,
      "$.error.details.apply_blocked_reason",
    ),
    remainingSpots: safeIntegerAt(object.remaining_spots, "$.error.details.remaining_spots"),
  });
}

function decodeCapacityChangedDetails(value: unknown): OpenGameRegistrationCapacityChangedDetails {
  const object = exactObject(value, ["remaining_spots", "allowed_actions"], "$.error.details");
  return Object.freeze({
    remainingSpots: safeIntegerAt(object.remaining_spots, "$.error.details.remaining_spots"),
    allowedActions: decodeReviewActions(object.allowed_actions, "$.error.details.allowed_actions"),
  });
}

function noDetailsError(
  code: NoDetailsCode,
): OpenGameRegistrationApiError {
  switch (code) {
    case "AUTH_REQUIRED": return new OpenGameRegistrationApiError("AUTH_REQUIRED");
    case "LOGIN_FAILED": return new OpenGameRegistrationApiError("LOGIN_FAILED");
    case "OPEN_GAME_NOT_FOUND": return new OpenGameRegistrationApiError("OPEN_GAME_NOT_FOUND");
    case "APPLICATION_NOT_FOUND": return new OpenGameRegistrationApiError("APPLICATION_NOT_FOUND");
    case "APPLICATION_ALREADY_EXISTS": return new OpenGameRegistrationApiError("APPLICATION_ALREADY_EXISTS");
    case "APPLICATION_STATE_CHANGED": return new OpenGameRegistrationApiError("APPLICATION_STATE_CHANGED");
    case "IDEMPOTENCY_KEY_REUSED": return new OpenGameRegistrationApiError("IDEMPOTENCY_KEY_REUSED");
    case "SERVICE_UNAVAILABLE": return new OpenGameRegistrationApiError("SERVICE_UNAVAILABLE");
    case "APPLICATION_RESULT_UNKNOWN": return new OpenGameRegistrationApiError("APPLICATION_RESULT_UNKNOWN");
  }
}

function decodeDefinitiveError(
  value: unknown,
  statusCode: number,
  operation: Operation,
): OpenGameRegistrationApiError | null {
  const envelope = exactObject(value, ["error"], "$" );
  const error = exactObject(
    envelope.error,
    ["code", "message", "request_id", "details"],
    "$.error",
  );
  const code = stringAt(error.code, "$.error.code") as OpenGameRegistrationApiErrorCode;
  stringAt(error.message, "$.error.message");
  stringAt(error.request_id, "$.error.request_id");
  const allowed = DEFINITIVE_CODES[operation][statusCode];
  if (!allowed?.includes(code)) return null;
  if (code === "INVALID_ARGUMENT") {
    const details = decodeInvalidArgumentDetails(error.details, operation);
    return details === undefined
      ? new OpenGameRegistrationApiError("INVALID_ARGUMENT")
      : new OpenGameRegistrationApiError("INVALID_ARGUMENT", details);
  }
  if (code === "APPLICATION_NOT_ALLOWED") {
    return new OpenGameRegistrationApiError(
      "APPLICATION_NOT_ALLOWED",
      decodeNotAllowedDetails(error.details),
    );
  }
  if (code === "APPLICATION_CAPACITY_CHANGED") {
    return new OpenGameRegistrationApiError(
      "APPLICATION_CAPACITY_CHANGED",
      decodeCapacityChangedDetails(error.details),
    );
  }
  exactObject(error.details, [], "$.error.details");
  return noDetailsError(code);
}

function httpFailure(caught: unknown): { readonly statusCode: number; readonly data: unknown } | null {
  if (typeof caught !== "object" || caught === null) return null;
  const candidate = caught as Partial<TransportError> & { readonly data?: unknown };
  if (candidate.code !== "HTTP_ERROR" || !Number.isInteger(candidate.statusCode)) return null;
  return { statusCode: candidate.statusCode as number, data: candidate.data };
}

function sameSession(left: StoredSession | null, right: StoredSession | null): boolean {
  if (left === null || right === null) return left === right;
  return left.token === right.token
    && left.expiresAt === right.expiresAt
    && left.userId === right.userId;
}

function replaceSessionIfCurrent(
  sessionStore: SessionStore,
  expected: StoredSession | null,
  replacement: StoredSession | null,
): boolean {
  if (!sameSession(sessionStore.load(), expected)) return false;
  if (replacement === null) sessionStore.clear();
  else sessionStore.save(replacement);
  return true;
}

function classifyFailure(
  caught: unknown,
  operation: Operation,
  write: boolean,
  sessionStore: SessionStore,
  requestSession: StoredSession | null,
): OpenGameRegistrationApiError {
  if (caught instanceof OpenGameRegistrationApiError) return caught;
  const failure = httpFailure(caught);
  if (failure?.statusCode === 401 && requestSession !== null) {
    try {
      if (!replaceSessionIfCurrent(sessionStore, requestSession, null)) {
        return noDetailsError(write ? "APPLICATION_RESULT_UNKNOWN" : "SERVICE_UNAVAILABLE");
      }
    } catch {
      // Local cleanup cannot replace the server's strict authentication result.
    }
  }
  if (failure !== null && failure.statusCode < 500) {
    try {
      const definitive = decodeDefinitiveError(failure.data, failure.statusCode, operation);
      if (definitive !== null) return definitive;
    } catch {
      // Malformed or out-of-matrix responses are never treated as definitive.
    }
  }
  return noDetailsError(write ? "APPLICATION_RESULT_UNKNOWN" : "SERVICE_UNAVAILABLE");
}

function authorization(sessionStore: SessionStore): {
  readonly session: StoredSession;
  readonly headers: Readonly<Record<string, string>>;
} {
  const session = sessionStore.load();
  if (session === null) throw new OpenGameRegistrationApiError("AUTH_REQUIRED");
  return { session, headers: { Authorization: `Bearer ${session.token}` } };
}

export function createHttpOpenGameRegistrationSource({ transport, identity, sessionStore }: {
  readonly transport: StatusTransport;
  readonly identity: WeChatIdentityCapability;
  readonly sessionStore: SessionStore;
}): OpenGameRegistrationSource {
  let loginInFlight: Promise<string> | undefined;

  const login = (): Promise<string> => {
    if (loginInFlight !== undefined) return loginInFlight;
    const request = (async () => {
      try {
        const expectedSession = sessionStore.load();
        const identityResult = await identity.login();
        if (identityResult.code.length === 0) throw new Error("EMPTY_WECHAT_CODE");
        const response = await transport.requestWithStatus<unknown>(
          "POST",
          "/api/v1/auth/wechat/session",
          { code: identityResult.code },
        );
        if (response.statusCode !== 200) throw new Error("LOGIN_STATUS");
        const session = decodeWeChatSession(response.data);
        replaceSessionIfCurrent(sessionStore, expectedSession, {
          token: session.token,
          expiresAt: session.expiresAt,
          userId: session.user.userId,
        });
        return session.user.userId;
      } catch {
        throw new OpenGameRegistrationApiError("LOGIN_FAILED");
      }
    })();
    loginInFlight = request;
    void request.then(
      () => { if (loginInFlight === request) loginInFlight = undefined; },
      () => { if (loginInFlight === request) loginInFlight = undefined; },
    );
    return request;
  };

  const getContext = async (shareToken: string): Promise<OpenGameRegistrationContext> => {
    let requestSession: StoredSession | null = null;
    try {
      requestSession = sessionStore.load();
      const headers = requestSession === null
        ? undefined
        : { Authorization: `Bearer ${requestSession.token}` };
      const response = await transport.requestWithStatus<unknown>(
        "GET",
        `/api/v1/shared-games/${encodeURIComponent(shareToken)}/registration-context`,
        undefined,
        headers,
      );
      if (response.statusCode !== 200) throw new OpenGameRegistrationApiError("SERVICE_UNAVAILABLE");
      return decodeOpenGameRegistrationContext(response.data);
    } catch (caught) {
      throw classifyFailure(caught, "context", false, sessionStore, requestSession);
    }
  };

  const listMine = async (cursor?: string, limit?: number) => {
    let requestSession: StoredSession | null = null;
    try {
      const authorizationContext = authorization(sessionStore);
      requestSession = authorizationContext.session;
      const query = `limit=${String(limit ?? 20)}`
        + (cursor === undefined ? "" : `&cursor=${encodeURIComponent(cursor)}`);
      const response = await transport.requestWithStatus<unknown>(
        "GET",
        `/api/v1/open-game-applications?${query}`,
        undefined,
        authorizationContext.headers,
      );
      if (response.statusCode !== 200) {
        throw new OpenGameRegistrationApiError("SERVICE_UNAVAILABLE");
      }
      return decodeMyOpenGameApplications(response.data);
    } catch (caught) {
      throw classifyFailure(caught, "mine", false, sessionStore, requestSession);
    }
  };

  const apply = async (
    attempt: OpenGameRegistrationApplyAttempt,
  ): Promise<OpenGameRegistrationContext> => {
    let requestSession: StoredSession | null = null;
    try {
      const authorizationContext = authorization(sessionStore);
      requestSession = authorizationContext.session;
      const headers = {
        ...authorizationContext.headers,
        "Idempotency-Key": attempt.idempotencyKey,
      };
      const response = await transport.requestWithStatus<unknown>(
        "POST",
        `/api/v1/shared-games/${encodeURIComponent(attempt.shareToken)}/applications`,
        {
          display_name: attempt.body.displayName,
          position: attempt.body.position,
          note: attempt.body.note,
          adult_confirmed: attempt.body.adultConfirmed,
          risk_confirmed: attempt.body.riskConfirmed,
        },
        headers,
      );
      if (response.statusCode !== 201) {
        throw new OpenGameRegistrationApiError("APPLICATION_RESULT_UNKNOWN");
      }
      const context = decodeOpenGameRegistrationContext(response.data);
      const registration = context.viewerRegistration;
      if (!context.viewerAuthenticated
        || registration === null
        || registration.displayName !== attempt.body.displayName
        || registration.position !== attempt.body.position
        || registration.note !== attempt.body.note
        || registration.persistedStatus !== "APPLIED"
        || registration.effectiveStatus !== "APPLIED") {
        throw new Error("APPLICATION_AUTHORITY_MISMATCH");
      }
      return context;
    } catch (caught) {
      throw classifyFailure(caught, "apply", true, sessionStore, requestSession);
    }
  };

  const getPending = async (gameId: string) => {
    let requestSession: StoredSession | null = null;
    try {
      const authorizationContext = authorization(sessionStore);
      requestSession = authorizationContext.session;
      const response = await transport.requestWithStatus<unknown>(
        "GET",
        `/api/v1/games/${encodeURIComponent(gameId)}/applications`,
        undefined,
        authorizationContext.headers,
      );
      if (response.statusCode !== 200) throw new OpenGameRegistrationApiError("SERVICE_UNAVAILABLE");
      return decodeOpenGameApplicationQueue(response.data);
    } catch (caught) {
      throw classifyFailure(caught, "queue", false, sessionStore, requestSession);
    }
  };

  const decide = async (attempt: OpenGameRegistrationDecisionAttempt) => {
    let requestSession: StoredSession | null = null;
    try {
      const expectedStatus = expectedDecisionStatus(attempt.decision);
      const authorizationContext = authorization(sessionStore);
      requestSession = authorizationContext.session;
      const headers = {
        ...authorizationContext.headers,
        "Idempotency-Key": attempt.idempotencyKey,
      };
      const response = await transport.requestWithStatus<unknown>(
        "POST",
        `/api/v1/games/${encodeURIComponent(attempt.gameId)}`
          + `/applications/${encodeURIComponent(attempt.applicationId)}/decision`,
        { decision: attempt.decision, expected_version: attempt.expectedVersion },
        headers,
      );
      if (response.statusCode !== 200) {
        throw new OpenGameRegistrationApiError("APPLICATION_RESULT_UNKNOWN");
      }
      const result = decodeOpenGameApplicationDecisionResult(response.data);
      const expectedVersion = attempt.expectedVersion + 1;
      if (!Number.isSafeInteger(expectedVersion)
        || result.applicationId !== attempt.applicationId
        || result.status !== expectedStatus
        || result.version !== expectedVersion) {
        throw new Error("APPLICATION_DECISION_AUTHORITY_MISMATCH");
      }
      return result;
    } catch (caught) {
      throw classifyFailure(caught, "decide", true, sessionStore, requestSession);
    }
  };

  const withdraw = async (
    attempt: OpenGameRegistrationWithdrawAttempt,
  ): Promise<OpenGameRegistrationContext> => {
    let requestSession: StoredSession | null = null;
    try {
      const expectedWithdrawalKind = withdrawalKindForAction(attempt.action);
      const authorizationContext = authorization(sessionStore);
      requestSession = authorizationContext.session;
      const headers = {
        ...authorizationContext.headers,
        "Idempotency-Key": attempt.idempotencyKey,
      };
      const response = await transport.requestWithStatus<unknown>(
        "POST",
        `/api/v1/open-game-applications/${encodeURIComponent(attempt.applicationId)}/withdraw`,
        { action: attempt.action, expected_version: attempt.expectedVersion },
        headers,
      );
      if (response.statusCode !== 200) {
        throw new OpenGameRegistrationApiError("APPLICATION_RESULT_UNKNOWN");
      }
      const context = decodeOpenGameRegistrationContext(response.data);
      const registration = context.viewerRegistration;
      const expectedVersion = attempt.expectedVersion + 1;
      if (!Number.isSafeInteger(expectedVersion)
        || !context.viewerAuthenticated
        || registration === null
        || registration.id !== attempt.applicationId
        || registration.persistedStatus !== "WITHDRAWN"
        || registration.effectiveStatus !== "WITHDRAWN"
        || registration.version !== expectedVersion
        || registration.withdrawalKind !== expectedWithdrawalKind
        || registration.withdrawnAt === null
        || registration.availableWithdrawalAction !== null
        || registration.lateExitWillBeRecorded) {
        throw new Error("APPLICATION_WITHDRAWAL_AUTHORITY_MISMATCH");
      }
      if (attempt.action === "WITHDRAW_APPLICATION" && registration.lateExitRecorded) {
        throw new Error("APPLICATION_WITHDRAWAL_LATE_MISMATCH");
      }
      return context;
    } catch (caught) {
      throw classifyFailure(caught, "withdraw", true, sessionStore, requestSession);
    }
  };

  return {
    login,
    currentUserId: () => sessionStore.load()?.userId ?? null,
    listMine,
    getContext,
    apply,
    getPending,
    decide,
    withdraw,
  };
}
