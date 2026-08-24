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
  decodeOpenGameRegistrationContext,
} from "../domain/open-game-registration-decoder";
import type {
  OpenGameApplyBlockedReason,
  OpenGameRegistrationContext,
  OpenGameReviewActions,
  OpenGameReviewBlockedReason,
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
} from "./open-game-registration";
import type { SessionStore } from "./session-store";

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

type Operation = "context" | "apply" | "queue" | "decide";

const APPLY_FIELDS = [
  "display_name",
  "position",
  "note",
  "adult_confirmed",
  "risk_confirmed",
] as const;
const DECISION_FIELDS = ["decision", "expected_version"] as const;
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
  decide: {
    401: ["AUTH_REQUIRED"],
    404: ["OPEN_GAME_NOT_FOUND", "APPLICATION_NOT_FOUND"],
    409: ["APPLICATION_STATE_CHANGED", "APPLICATION_CAPACITY_CHANGED", "IDEMPOTENCY_KEY_REUSED"],
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
    || rejectBlockedReason === "GAME_FULL") throw new Error(path);
  return Object.freeze({ canAccept, acceptBlockedReason, canReject, rejectBlockedReason });
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
    : operation === "decide" ? DECISION_FIELDS : [];
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

function classifyFailure(
  caught: unknown,
  operation: Operation,
  write: boolean,
  sessionStore: SessionStore,
): OpenGameRegistrationApiError {
  if (caught instanceof OpenGameRegistrationApiError) return caught;
  const failure = httpFailure(caught);
  if (failure?.statusCode === 401) {
    try {
      sessionStore.clear();
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

function authorization(sessionStore: SessionStore): Readonly<Record<string, string>> {
  const session = sessionStore.load();
  if (session === null) throw new OpenGameRegistrationApiError("AUTH_REQUIRED");
  return { Authorization: `Bearer ${session.token}` };
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
        const identityResult = await identity.login();
        if (identityResult.code.length === 0) throw new Error("EMPTY_WECHAT_CODE");
        const response = await transport.requestWithStatus<unknown>(
          "POST",
          "/api/v1/auth/wechat/session",
          { code: identityResult.code },
        );
        if (response.statusCode !== 200) throw new Error("LOGIN_STATUS");
        const session = decodeWeChatSession(response.data);
        sessionStore.save({
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
    try {
      const session = sessionStore.load();
      const headers = session === null ? undefined : { Authorization: `Bearer ${session.token}` };
      const response = await transport.requestWithStatus<unknown>(
        "GET",
        `/api/v1/shared-games/${encodeURIComponent(shareToken)}/registration-context`,
        undefined,
        headers,
      );
      if (response.statusCode !== 200) throw new OpenGameRegistrationApiError("SERVICE_UNAVAILABLE");
      return decodeOpenGameRegistrationContext(response.data);
    } catch (caught) {
      throw classifyFailure(caught, "context", false, sessionStore);
    }
  };

  const apply = async (
    attempt: OpenGameRegistrationApplyAttempt,
  ): Promise<OpenGameRegistrationContext> => {
    try {
      const headers = {
        ...authorization(sessionStore),
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
      throw classifyFailure(caught, "apply", true, sessionStore);
    }
  };

  const getPending = async (gameId: string) => {
    try {
      const headers = authorization(sessionStore);
      const response = await transport.requestWithStatus<unknown>(
        "GET",
        `/api/v1/games/${encodeURIComponent(gameId)}/applications`,
        undefined,
        headers,
      );
      if (response.statusCode !== 200) throw new OpenGameRegistrationApiError("SERVICE_UNAVAILABLE");
      return decodeOpenGameApplicationQueue(response.data);
    } catch (caught) {
      throw classifyFailure(caught, "queue", false, sessionStore);
    }
  };

  const decide = async (attempt: OpenGameRegistrationDecisionAttempt) => {
    try {
      const headers = {
        ...authorization(sessionStore),
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
      const expectedStatus = attempt.decision === "ACCEPT" ? "JOINED" : "REJECTED";
      if (!Number.isSafeInteger(expectedVersion)
        || result.applicationId !== attempt.applicationId
        || result.status !== expectedStatus
        || result.version !== expectedVersion) {
        throw new Error("APPLICATION_DECISION_AUTHORITY_MISMATCH");
      }
      return result;
    } catch (caught) {
      throw classifyFailure(caught, "decide", true, sessionStore);
    }
  };

  return {
    login,
    currentUserId: () => sessionStore.load()?.userId ?? null,
    getContext,
    apply,
    getPending,
    decide,
  };
}
