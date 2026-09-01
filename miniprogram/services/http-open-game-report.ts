import { decodeWeChatSession } from "../domain/decoders";
import { exactObject, objectAt, stringAt } from "../domain/decoder-primitives";
import {
  decodeOpenGameReportContext,
  decodeOpenGameReportForReporter,
} from "../domain/open-game-report-decoder";
import type { StatusTransport, TransportError, WeChatIdentityCapability } from "../runtime/interfaces";
import type { SessionStore, StoredSession } from "./session-store";
import type {
  OpenGameReportApiErrorCode,
  OpenGameReportAttempt,
  OpenGameReportSource,
} from "./open-game-report";

type Operation = "read" | "submit";

const DEFINITIVE: Readonly<Record<Operation, Readonly<Partial<Record<number, readonly OpenGameReportApiErrorCode[]>>>>> = {
  read: {
    401: ["AUTH_REQUIRED"],
    404: ["REPORT_CONTEXT_NOT_FOUND"],
    422: ["INVALID_ARGUMENT"],
  },
  submit: {
    401: ["AUTH_REQUIRED"],
    404: ["REPORT_CONTEXT_NOT_FOUND"],
    409: ["REPORTING_WINDOW_CLOSED", "REPORT_ALREADY_EXISTS", "IDEMPOTENCY_KEY_REUSED"],
    422: ["INVALID_ARGUMENT", "SENSITIVE_CONTENT_NOT_ALLOWED"],
  },
};

export class OpenGameReportApiError extends Error {
  readonly code: OpenGameReportApiErrorCode;

  constructor(code: OpenGameReportApiErrorCode) {
    super(code);
    this.name = "OpenGameReportApiError";
    this.code = code;
  }
}

function httpFailure(caught: unknown): { readonly statusCode: number; readonly data: unknown } | null {
  if (typeof caught !== "object" || caught === null) return null;
  const candidate = caught as Partial<TransportError> & { readonly data?: unknown };
  if (candidate.code !== "HTTP_ERROR" || !Number.isInteger(candidate.statusCode)) return null;
  return { statusCode: candidate.statusCode as number, data: candidate.data };
}

function sameSession(left: StoredSession | null, right: StoredSession | null): boolean {
  if (left === null || right === null) return left === right;
  return left.token === right.token && left.expiresAt === right.expiresAt && left.userId === right.userId;
}

function replaceSessionIfCurrent(
  store: SessionStore,
  expected: StoredSession | null,
  replacement: StoredSession | null,
): boolean {
  if (!sameSession(store.load(), expected)) return false;
  if (replacement === null) store.clear();
  else store.save(replacement);
  return true;
}

function decodeDefinitiveError(
  value: unknown,
  statusCode: number,
  operation: Operation,
): OpenGameReportApiError | null {
  const envelope = exactObject(value, ["error"], "$");
  const error = exactObject(envelope.error, ["code", "message", "request_id", "details"], "$.error");
  const code = stringAt(error.code, "$.error.code") as OpenGameReportApiErrorCode;
  stringAt(error.message, "$.error.message");
  stringAt(error.request_id, "$.error.request_id");
  objectAt(error.details, "$.error.details");
  return DEFINITIVE[operation][statusCode]?.includes(code)
    ? new OpenGameReportApiError(code)
    : null;
}

function classifyFailure(
  caught: unknown,
  operation: Operation,
  store: SessionStore,
  requestSession: StoredSession | null,
): OpenGameReportApiError {
  if (caught instanceof OpenGameReportApiError) return caught;
  const failure = httpFailure(caught);
  if (failure?.statusCode === 401 && requestSession !== null) {
    try {
      if (!replaceSessionIfCurrent(store, requestSession, null)) {
        return new OpenGameReportApiError(
          operation === "submit" ? "REPORT_RESULT_UNKNOWN" : "SERVICE_UNAVAILABLE",
        );
      }
    } catch {
      return new OpenGameReportApiError(
        operation === "submit" ? "REPORT_RESULT_UNKNOWN" : "SERVICE_UNAVAILABLE",
      );
    }
  }
  if (failure !== null && failure.statusCode < 500) {
    try {
      const error = decodeDefinitiveError(failure.data, failure.statusCode, operation);
      if (error !== null) return error;
    } catch {
      // An incomplete or out-of-matrix envelope is never treated as definitive.
    }
  }
  return new OpenGameReportApiError(
    operation === "submit" ? "REPORT_RESULT_UNKNOWN" : "SERVICE_UNAVAILABLE",
  );
}

function authorization(store: SessionStore): {
  readonly session: StoredSession;
  readonly headers: Readonly<Record<string, string>>;
} {
  const session = store.load();
  if (session === null) throw new OpenGameReportApiError("AUTH_REQUIRED");
  return { session, headers: { Authorization: `Bearer ${session.token}` } };
}

export function createHttpOpenGameReportSource({ transport, identity, sessionStore }: {
  readonly transport: StatusTransport;
  readonly identity: WeChatIdentityCapability;
  readonly sessionStore: SessionStore;
}): OpenGameReportSource {
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
        throw new OpenGameReportApiError("LOGIN_FAILED");
      }
    })();
    loginInFlight = request;
    void request.then(
      () => { if (loginInFlight === request) loginInFlight = undefined; },
      () => { if (loginInFlight === request) loginInFlight = undefined; },
    );
    return request;
  };

  const getMyReport = async (gameId: string) => {
    let requestSession: StoredSession | null = null;
    try {
      const authorizationContext = authorization(sessionStore);
      requestSession = authorizationContext.session;
      const response = await transport.requestWithStatus<unknown>(
        "GET",
        `/api/v1/games/${encodeURIComponent(gameId)}/my-report`,
        undefined,
        authorizationContext.headers,
      );
      if (response.statusCode !== 200) throw new Error("REPORT_CONTEXT_STATUS");
      const context = decodeOpenGameReportContext(response.data);
      if (context.target.gameId !== gameId) throw new Error("REPORT_CONTEXT_GAME_MISMATCH");
      return context;
    } catch (caught) {
      throw classifyFailure(caught, "read", sessionStore, requestSession);
    }
  };

  const submit = async (attempt: OpenGameReportAttempt) => {
    let requestSession: StoredSession | null = null;
    try {
      const authorizationContext = authorization(sessionStore);
      requestSession = authorizationContext.session;
      const response = await transport.requestWithStatus<unknown>(
        "POST",
        `/api/v1/games/${encodeURIComponent(attempt.gameId)}/reports`,
        { category: attempt.body.category, facts: attempt.body.facts },
        {
          ...authorizationContext.headers,
          "Idempotency-Key": attempt.idempotencyKey,
        },
      );
      if (response.statusCode !== 200 && response.statusCode !== 201) {
        throw new OpenGameReportApiError("REPORT_RESULT_UNKNOWN");
      }
      const report = decodeOpenGameReportForReporter(response.data);
      if (report.category !== attempt.body.category || report.facts !== attempt.body.facts) {
        throw new Error("REPORT_AUTHORITY_MISMATCH");
      }
      return report;
    } catch (caught) {
      throw classifyFailure(caught, "submit", sessionStore, requestSession);
    }
  };

  return {
    login,
    currentUserId: () => sessionStore.load()?.userId ?? null,
    getMyReport,
    submit,
  };
}
