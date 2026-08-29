/// <reference types="node" />
import { describe, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";

import {
  decodeOpenGameApplicationDecisionResult,
  decodeOpenGameApplicationQueue,
  decodeMyOpenGameApplications,
  decodeOpenGameRegistrationContext,
} from "../domain/open-game-registration-decoder";
import type { StatusTransport, WeChatIdentityCapability } from "../runtime/interfaces";
import {
  createHttpOpenGameRegistrationSource,
  OpenGameRegistrationApiError,
} from "./http-open-game-registration";
import type {
  OpenGameRegistrationApplyAttempt,
  OpenGameRegistrationDecisionAttempt,
  OpenGameRegistrationWithdrawAttempt,
} from "./open-game-registration";
import type { SessionStore, StoredSession } from "./session-store";

const fixture = (name: string): Record<string, unknown> => JSON.parse(
  readFileSync(`contracts/examples/${name}.json`, "utf8"),
) as Record<string, unknown>;

const USER_ID = "00000000-0000-4000-8000-000000000001";
const USER_B_ID = "00000000-0000-4000-8000-000000000002";
const GAME_ID = "22222222-3333-4444-8555-666666666666";
const APPLICATION_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SHARE_TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz_12345";
const SESSION_TOKEN = "stored-session-token";
const rawSession = fixture("wechat-session");
const rawAnonymousContext = fixture("open-game-registration-context-anonymous");
const rawAppliedContext = fixture("open-game-registration-context-applied");
const rawQueue = fixture("open-game-applications-pending");
const rawJoinedDecision = fixture("open-game-application-decision-joined");
const rawMine = fixture("my-open-game-applications-ready");
const REPLACEMENT_B_SESSION: StoredSession = {
  token: "replacement-account-b-token",
  expiresAt: "2099-02-01T00:00:00Z",
  userId: USER_B_ID,
};
const REFRESHED_A_SESSION: StoredSession = {
  token: "replacement-account-a-token",
  expiresAt: "2099-02-01T00:00:00Z",
  userId: USER_ID,
};

const applyAttempt: OpenGameRegistrationApplyAttempt = {
  kind: "apply",
  originatingUserId: USER_ID,
  shareToken: SHARE_TOKEN,
  body: {
    displayName: "周末小翼",
    position: "FORWARD",
    note: "可以补边路，按时到场。",
    adultConfirmed: true,
    riskConfirmed: true,
  },
  idempotencyKey: "application-key-00000000000001",
};
const decisionAttempt: OpenGameRegistrationDecisionAttempt = {
  kind: "decision",
  originatingUserId: USER_ID,
  gameId: GAME_ID,
  applicationId: APPLICATION_ID,
  decision: "ACCEPT",
  expectedVersion: 1,
  idempotencyKey: "decision-key-0000000000000001",
};
const withdrawAttempt: OpenGameRegistrationWithdrawAttempt = {
  kind: "withdraw",
  originatingUserId: USER_ID,
  shareToken: SHARE_TOKEN,
  applicationId: APPLICATION_ID,
  action: "WITHDRAW_APPLICATION",
  expectedVersion: 1,
  idempotencyKey: "withdraw-key-0000000000000001",
};

function contextWithWithdrawalFields(viewerPatch: Record<string, unknown>): Record<string, unknown> {
  return {
    ...rawAppliedContext,
    viewer_registration: {
      ...(rawAppliedContext.viewer_registration as Record<string, unknown>),
      id: APPLICATION_ID,
      version: 1,
      withdrawn_at: null,
      withdrawal_kind: null,
      late_exit_recorded: false,
      available_withdrawal_action: "WITHDRAW_APPLICATION",
      late_exit_will_be_recorded: false,
      ...viewerPatch,
    },
  };
}

const rawWithdrawnContext = contextWithWithdrawalFields({
  persisted_status: "WITHDRAWN",
  effective_status: "WITHDRAWN",
  version: 2,
  withdrawn_at: "2026-08-24T00:30:00+08:00",
  withdrawal_kind: "APPLICATION_WITHDRAWAL",
  available_withdrawal_action: null,
});

type Call = {
  readonly method: "GET" | "POST" | "PUT";
  readonly path: string;
  readonly body: unknown;
  readonly headers?: Readonly<Record<string, string>>;
};

const response = (statusCode: number, data: unknown) => ({ statusCode, data });
const httpError = (statusCode: number, code: string, details: unknown = {}) => ({
  code: "HTTP_ERROR" as const,
  statusCode,
  data: { error: { code, message: "error", request_id: "request-id", details } },
});
const rejected = (value: unknown) => ({ rejectWith: value });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function isRejectedTransportValue(value: unknown): boolean {
  return typeof value === "object" && value !== null && "code" in value;
}

function harness(
  responses: Array<unknown | Promise<unknown>>,
  initialSession: StoredSession | null = {
    token: SESSION_TOKEN,
    expiresAt: "2099-01-01T00:00:00Z",
    userId: USER_ID,
  },
) {
  const calls: Call[] = [];
  let storedSession = initialSession;
  const plain = async <T>(): Promise<T> => { throw new Error("PLAIN_TRANSPORT_NOT_ALLOWED"); };
  const transport: StatusTransport = {
    get: plain,
    post: plain,
    put: plain,
    requestWithStatus: async <T>(
      method: "GET" | "POST" | "PUT",
      path: string,
      body: unknown,
      headers?: Readonly<Record<string, string>>,
    ) => {
      calls.push({ method, path, body, headers });
      const next = responses.shift();
      if (typeof next === "object" && next !== null && "rejectWith" in next) {
        throw (next as { readonly rejectWith: unknown }).rejectWith;
      }
      const value = await next;
      if (isRejectedTransportValue(value)) throw value;
      return value as { readonly statusCode: number; readonly data: T };
    },
  };
  const sessionStore: SessionStore = {
    load: jest.fn(() => storedSession),
    save: jest.fn((session: StoredSession) => { storedSession = session; }),
    clear: jest.fn(() => { storedSession = null; }),
  };
  const identity: WeChatIdentityCapability = {
    login: jest.fn(async () => ({ code: "wechat-code" })),
  };
  return {
    calls,
    identity,
    sessionStore,
    source: createHttpOpenGameRegistrationSource({ transport, identity, sessionStore }),
  };
}

describe("HTTP open-game registration requests", () => {
  test("withdraws through the exact self-only endpoint with explicit action, version, bearer, and key", async () => {
    const h = harness([response(200, rawWithdrawnContext)]);

    await expect(h.source.withdraw(withdrawAttempt)).resolves.toEqual(
      decodeOpenGameRegistrationContext(rawWithdrawnContext),
    );

    expect(h.calls).toEqual([{
      method: "POST",
      path: `/api/v1/open-game-applications/${APPLICATION_ID}/withdraw`,
      body: { action: "WITHDRAW_APPLICATION", expected_version: 1 },
      headers: {
        Authorization: `Bearer ${SESSION_TOKEN}`,
        "Idempotency-Key": withdrawAttempt.idempotencyKey,
      },
    }]);
  });

  test.each([
    [401, "AUTH_REQUIRED"],
    [404, "APPLICATION_NOT_FOUND"],
    [409, "APPLICATION_STATE_CHANGED"],
    [409, "IDEMPOTENCY_KEY_REUSED"],
    [422, "INVALID_ARGUMENT"],
  ] as const)("maps definitive withdraw HTTP %s %s and keeps other failures unknown", async (
    statusCode,
    code,
  ) => {
    const details = code === "INVALID_ARGUMENT"
      ? { fields: [{ field: "expected_version", message: "字段值不符合要求。" }] }
      : {};
    const error = await registrationError(harness([
      httpError(statusCode, code, details),
    ]).source.withdraw(withdrawAttempt));
    expect(error).toMatchObject({ code });
  });

  test.each([
    [httpError(500, "SERVICE_UNAVAILABLE")],
    [{ code: "NETWORK_ERROR", errMsg: "offline" }],
    [response(200, { ...rawWithdrawnContext, private: true })],
    [response(201, rawWithdrawnContext)],
  ])("keeps an uncertain or malformed withdrawal result unknown", async (failure) => {
    const error = await registrationError(harness([failure]).source.withdraw(withdrawAttempt));
    expect(error.code).toBe("APPLICATION_RESULT_UNKNOWN");
  });

  test("lists mine with exact authenticated default, encoded cursor, explicit limit, and empty cursor queries", async () => {
    const h = harness([
      response(200, rawMine),
      response(200, rawMine),
      response(200, rawMine),
    ]);

    await expect(h.source.listMine()).resolves.toEqual(decodeMyOpenGameApplications(rawMine));
    await expect(h.source.listMine("opaque /+?=&游标", 7)).resolves.toEqual(
      decodeMyOpenGameApplications(rawMine),
    );
    await expect(h.source.listMine("", 20)).resolves.toEqual(decodeMyOpenGameApplications(rawMine));

    expect(h.calls).toEqual([
      {
        method: "GET",
        path: "/api/v1/open-game-applications?limit=20",
        body: undefined,
        headers: { Authorization: `Bearer ${SESSION_TOKEN}` },
      },
      {
        method: "GET",
        path: "/api/v1/open-game-applications?limit=7&cursor=opaque%20%2F%2B%3F%3D%26%E6%B8%B8%E6%A0%87",
        body: undefined,
        headers: { Authorization: `Bearer ${SESSION_TOKEN}` },
      },
      {
        method: "GET",
        path: "/api/v1/open-game-applications?limit=20&cursor=",
        body: undefined,
        headers: { Authorization: `Bearer ${SESSION_TOKEN}` },
      },
    ]);
    expect(h.identity.login).not.toHaveBeenCalled();
  });

  test("constructs the four exact encoded endpoint calls, snake_case bodies, and headers", async () => {
    const h = harness([
      response(200, rawAnonymousContext),
      response(201, rawAppliedContext),
      response(200, rawQueue),
      response(200, rawJoinedDecision),
    ], null);

    await expect(h.source.getContext("share/token +?=")).resolves.toEqual(
      decodeOpenGameRegistrationContext(rawAnonymousContext),
    );
    h.sessionStore.save({
      token: SESSION_TOKEN,
      expiresAt: "2099-01-01T00:00:00Z",
      userId: USER_ID,
    });
    await expect(h.source.apply({ ...applyAttempt, shareToken: "share/token +?=" })).resolves.toEqual(
      decodeOpenGameRegistrationContext(rawAppliedContext),
    );
    await expect(h.source.getPending("game/id +?=")).resolves.toEqual(
      decodeOpenGameApplicationQueue(rawQueue),
    );
    await expect(h.source.decide(decisionAttempt)).resolves.toEqual(
      decodeOpenGameApplicationDecisionResult(rawJoinedDecision),
    );

    expect(h.calls).toEqual([
      {
        method: "GET",
        path: "/api/v1/shared-games/share%2Ftoken%20%2B%3F%3D/registration-context",
        body: undefined,
        headers: undefined,
      },
      {
        method: "POST",
        path: "/api/v1/shared-games/share%2Ftoken%20%2B%3F%3D/applications",
        body: {
          display_name: applyAttempt.body.displayName,
          position: applyAttempt.body.position,
          note: applyAttempt.body.note,
          adult_confirmed: true,
          risk_confirmed: true,
        },
        headers: {
          Authorization: `Bearer ${SESSION_TOKEN}`,
          "Idempotency-Key": applyAttempt.idempotencyKey,
        },
      },
      {
        method: "GET",
        path: "/api/v1/games/game%2Fid%20%2B%3F%3D/applications",
        body: undefined,
        headers: { Authorization: `Bearer ${SESSION_TOKEN}` },
      },
      {
        method: "POST",
        path: `/api/v1/games/${GAME_ID}/applications/${APPLICATION_ID}/decision`,
        body: { decision: "ACCEPT", expected_version: 1 },
        headers: {
          Authorization: `Bearer ${SESSION_TOKEN}`,
          "Idempotency-Key": decisionAttempt.idempotencyKey,
        },
      },
    ]);
    expect(h.identity.login).not.toHaveBeenCalled();
  });

  test("required operations fail locally without silently logging in", async () => {
    const h = harness([], null);

    for (const operation of [
      h.source.apply(applyAttempt),
      h.source.getPending(GAME_ID),
      h.source.listMine(),
      h.source.decide(decisionAttempt),
    ]) {
      await expect(operation).rejects.toEqual(new OpenGameRegistrationApiError("AUTH_REQUIRED"));
    }
    expect(h.calls).toEqual([]);
    expect(h.identity.login).not.toHaveBeenCalled();
  });

  test("a supplied bearer 401 clears v2 auth and is never retried anonymously", async () => {
    const h = harness([httpError(401, "AUTH_REQUIRED")]);

    await expect(h.source.getContext(SHARE_TOKEN))
      .rejects.toEqual(new OpenGameRegistrationApiError("AUTH_REQUIRED"));

    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]?.headers).toEqual({ Authorization: `Bearer ${SESSION_TOKEN}` });
    expect(h.sessionStore.clear).toHaveBeenCalledTimes(1);
    expect(h.identity.login).not.toHaveBeenCalled();
  });

  test.each([
    ["account B", REPLACEMENT_B_SESSION],
    ["a refreshed account A token", REFRESHED_A_SESSION],
  ])("a late account A 401 preserves %s and becomes a stale read failure", async (
    _label,
    replacement,
  ) => {
    const lateResponse = deferred<unknown>();
    const h = harness([lateResponse.promise]);
    const oldRequest = h.source.listMine();

    h.sessionStore.save(replacement);
    lateResponse.resolve(httpError(401, "AUTH_REQUIRED"));

    await expect(oldRequest).rejects.toEqual(new OpenGameRegistrationApiError("SERVICE_UNAVAILABLE"));
    expect(h.sessionStore.clear).not.toHaveBeenCalled();
    expect(h.sessionStore.load()).toEqual(replacement);
    expect(h.source.currentUserId()).toBe(replacement.userId);
  });
});

describe("HTTP open-game registration explicit login", () => {
  test("coalesces concurrent exchanges, saves exact v2 ownership, and reports current owner", async () => {
    let resolveExchange: ((value: unknown) => void) | undefined;
    const exchange = new Promise<unknown>((resolve) => { resolveExchange = resolve; });
    const h = harness([exchange], null);

    expect(h.source.currentUserId()).toBeNull();
    const first = h.source.login();
    const second = h.source.login();
    resolveExchange?.(response(200, rawSession));

    await expect(first).resolves.toBe(USER_ID);
    await expect(second).resolves.toBe(USER_ID);
    expect(h.identity.login).toHaveBeenCalledTimes(1);
    expect(h.calls).toEqual([{
      method: "POST",
      path: "/api/v1/auth/wechat/session",
      body: { code: "wechat-code" },
      headers: undefined,
    }]);
    expect(h.sessionStore.save).toHaveBeenCalledWith({
      token: String(rawSession.session_token),
      expiresAt: String(rawSession.expires_at),
      userId: USER_ID,
    });
    expect(h.source.currentUserId()).toBe(USER_ID);
  });

  test("wraps login failures and permits a later explicit retry", async () => {
    const h = harness([
      { code: "NETWORK_ERROR", errMsg: "offline" },
      response(200, rawSession),
    ], null);

    await expect(h.source.login()).rejects.toEqual(new OpenGameRegistrationApiError("LOGIN_FAILED"));
    await expect(h.source.login()).resolves.toBe(USER_ID);
    expect(h.identity.login).toHaveBeenCalledTimes(2);
  });

  test("a late account A login exchange preserves account B stored while it was in flight", async () => {
    const exchange = deferred<unknown>();
    const h = harness([exchange.promise]);
    const oldLogin = h.source.login();

    h.sessionStore.save(REPLACEMENT_B_SESSION);
    exchange.resolve(response(200, rawSession));

    await expect(oldLogin).resolves.toBe(USER_ID);
    expect(h.sessionStore.save).toHaveBeenCalledTimes(1);
    expect(h.sessionStore.load()).toEqual(REPLACEMENT_B_SESSION);
    expect(h.source.currentUserId()).toBe(USER_B_ID);
  });
});

type Operation = "context" | "apply" | "queue" | "decide" | "mine";

function perform(
  h: ReturnType<typeof harness>,
  operation: Operation,
): Promise<unknown> {
  if (operation === "context") return h.source.getContext(SHARE_TOKEN);
  if (operation === "apply") return h.source.apply(applyAttempt);
  if (operation === "queue") return h.source.getPending(GAME_ID);
  if (operation === "mine") return h.source.listMine();
  return h.source.decide(decisionAttempt);
}

async function registrationError(promise: Promise<unknown>): Promise<OpenGameRegistrationApiError> {
  try {
    await promise;
  } catch (caught) {
    expect(caught).toBeInstanceOf(OpenGameRegistrationApiError);
    if (caught instanceof OpenGameRegistrationApiError) return caught;
    throw caught;
  }
  throw new Error("EXPECTED_OPEN_GAME_REGISTRATION_API_ERROR");
}

describe("HTTP open-game registration closed errors", () => {
  const fieldDetails = {
    apply: { fields: [{ field: "display_name", message: "字段值不符合要求。" }] },
    queue: {},
    decide: { fields: [{ field: "expected_version", message: "字段值不符合要求。" }] },
  } as const;
  const notAllowedDetails = (
    fixture("error-application-not-allowed").error as Record<string, unknown>
  ).details;
  const capacityDetails = (
    fixture("error-application-capacity-changed").error as Record<string, unknown>
  ).details;

  test.each([
    ["context", 401, "AUTH_REQUIRED", {}, undefined],
    ["context", 404, "OPEN_GAME_NOT_FOUND", {}, undefined],
    ["apply", 401, "AUTH_REQUIRED", {}, undefined],
    ["apply", 404, "OPEN_GAME_NOT_FOUND", {}, undefined],
    ["apply", 409, "APPLICATION_ALREADY_EXISTS", {}, undefined],
    ["apply", 409, "APPLICATION_NOT_ALLOWED", notAllowedDetails, {
      applyBlockedReason: "GAME_FULL",
      remainingSpots: 0,
    }],
    ["apply", 409, "IDEMPOTENCY_KEY_REUSED", {}, undefined],
    ["apply", 422, "INVALID_ARGUMENT", fieldDetails.apply, fieldDetails.apply],
    ["queue", 401, "AUTH_REQUIRED", {}, undefined],
    ["queue", 404, "OPEN_GAME_NOT_FOUND", {}, undefined],
    ["queue", 422, "INVALID_ARGUMENT", fieldDetails.queue, undefined],
    ["mine", 401, "AUTH_REQUIRED", {}, undefined],
    ["mine", 422, "INVALID_ARGUMENT", {}, undefined],
    ["decide", 401, "AUTH_REQUIRED", {}, undefined],
    ["decide", 404, "OPEN_GAME_NOT_FOUND", {}, undefined],
    ["decide", 404, "APPLICATION_NOT_FOUND", {}, undefined],
    ["decide", 409, "APPLICATION_STATE_CHANGED", {}, undefined],
    ["decide", 409, "APPLICATION_CAPACITY_CHANGED", capacityDetails, {
      remainingSpots: 0,
      allowedActions: {
        canAccept: false,
        acceptBlockedReason: "GAME_FULL",
        canReject: true,
        rejectBlockedReason: null,
      },
    }],
    ["decide", 409, "IDEMPOTENCY_KEY_REUSED", {}, undefined],
    ["decide", 422, "INVALID_ARGUMENT", fieldDetails.decide, fieldDetails.decide],
  ] as const)("maps %s HTTP %s %s only from its matrix row", async (
    operation,
    statusCode,
    code,
    wireDetails,
    expectedDetails,
  ) => {
    const h = harness([httpError(statusCode, code, wireDetails)]);

    const error = await registrationError(perform(h, operation));

    expect(error.code).toBe(code);
    expect(error.details).toEqual(expectedDetails);
    if (statusCode === 401) expect(h.sessionStore.clear).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["context", 422, "INVALID_ARGUMENT"],
    ["context", 404, "APPLICATION_NOT_FOUND"],
    ["apply", 409, "APPLICATION_STATE_CHANGED"],
    ["apply", 404, "APPLICATION_NOT_FOUND"],
    ["queue", 409, "APPLICATION_STATE_CHANGED"],
    ["queue", 404, "APPLICATION_NOT_FOUND"],
    ["mine", 404, "OPEN_GAME_NOT_FOUND"],
    ["mine", 404, "INVALID_ARGUMENT"],
    ["decide", 409, "APPLICATION_ALREADY_EXISTS"],
    ["decide", 404, "AUTH_REQUIRED"],
  ] as const)("fails closed for out-of-matrix %s HTTP %s %s", async (
    operation,
    statusCode,
    code,
  ) => {
    const error = await registrationError(perform(
      harness([httpError(statusCode, code)]),
      operation,
    ));
    expect(error.code).toBe(operation === "apply" || operation === "decide"
      ? "APPLICATION_RESULT_UNKNOWN"
      : "SERVICE_UNAVAILABLE");
  });

  test.each([
    ["extra envelope key", {
      ...httpError(404, "OPEN_GAME_NOT_FOUND"),
      data: { ...httpError(404, "OPEN_GAME_NOT_FOUND").data, private: true },
    }],
    ["extra error key", {
      ...httpError(404, "OPEN_GAME_NOT_FOUND"),
      data: {
        error: {
          ...(httpError(404, "OPEN_GAME_NOT_FOUND").data.error),
          private: true,
        },
      },
    }],
    ["empty message", {
      ...httpError(404, "OPEN_GAME_NOT_FOUND"),
      data: { error: { code: "OPEN_GAME_NOT_FOUND", message: "", request_id: "request", details: {} } },
    }],
    ["empty request id", {
      ...httpError(404, "OPEN_GAME_NOT_FOUND"),
      data: { error: { code: "OPEN_GAME_NOT_FOUND", message: "error", request_id: "", details: {} } },
    }],
    ["non-empty details for a no-details code", httpError(
      404,
      "OPEN_GAME_NOT_FOUND",
      { remaining_spots: 0 },
    )],
  ])("rejects a malformed closed error envelope: %s", async (_label, failure) => {
    const error = await registrationError(harness([failure]).source.getContext(SHARE_TOKEN));
    expect(error.code).toBe("SERVICE_UNAVAILABLE");
  });

  test.each([
    ["empty fields", { fields: [] }],
    ["unknown apply field", { fields: [{ field: "originating_user_id", message: "bad" }] }],
    ["extra field error key", {
      fields: [{ field: "display_name", message: "bad", input: "private" }],
    }],
    ["empty field message", { fields: [{ field: "display_name", message: "" }] }],
    ["extra details key", {
      fields: [{ field: "display_name", message: "bad" }],
      private: true,
    }],
  ])("rejects malformed apply 422 details: %s", async (_label, details) => {
    const error = await registrationError(harness([
      httpError(422, "INVALID_ARGUMENT", details),
    ]).source.apply(applyAttempt));
    expect(error.code).toBe("APPLICATION_RESULT_UNKNOWN");
  });

  test("accepts only endpoint-known 422 body fields", async () => {
    const applyFields = ["display_name", "position", "note", "adult_confirmed", "risk_confirmed"];
    const decisionFields = ["decision", "expected_version"];
    for (const field of applyFields) {
      const error = await registrationError(harness([
        httpError(422, "INVALID_ARGUMENT", { fields: [{ field, message: "bad" }] }),
      ]).source.apply(applyAttempt));
      expect(error.details).toEqual({ fields: [{ field, message: "bad" }] });
    }
    for (const field of decisionFields) {
      const error = await registrationError(harness([
        httpError(422, "INVALID_ARGUMENT", { fields: [{ field, message: "bad" }] }),
      ]).source.decide(decisionAttempt));
      expect(error.details).toEqual({ fields: [{ field, message: "bad" }] });
    }
    const queueError = await registrationError(harness([
      httpError(422, "INVALID_ARGUMENT", { fields: [{ field: "game_id", message: "bad" }] }),
    ]).source.getPending(GAME_ID));
    expect(queueError.code).toBe("SERVICE_UNAVAILABLE");
    const mineError = await registrationError(harness([
      httpError(422, "INVALID_ARGUMENT", { fields: [{ field: "date", message: "bad" }] }),
    ]).source.listMine());
    expect(mineError.code).toBe("SERVICE_UNAVAILABLE");
  });

  test.each([
    ["not-allowed extra key", 409, "APPLICATION_NOT_ALLOWED", {
      apply_blocked_reason: "GAME_FULL", remaining_spots: 0, private: true,
    }],
    ["not-allowed unknown blocker", 409, "APPLICATION_NOT_ALLOWED", {
      apply_blocked_reason: "WAITLISTED", remaining_spots: 0,
    }],
    ["not-allowed negative spots", 409, "APPLICATION_NOT_ALLOWED", {
      apply_blocked_reason: "GAME_FULL", remaining_spots: -1,
    }],
    ["capacity extra key", 409, "APPLICATION_CAPACITY_CHANGED", {
      ...(capacityDetails as Record<string, unknown>), private: true,
    }],
    ["capacity invalid action pair", 409, "APPLICATION_CAPACITY_CHANGED", {
      remaining_spots: 0,
      allowed_actions: {
        can_accept: true,
        accept_blocked_reason: "GAME_FULL",
        can_reject: true,
        reject_blocked_reason: null,
      },
    }],
    ["capacity GAME_FULL reject", 409, "APPLICATION_CAPACITY_CHANGED", {
      remaining_spots: 0,
      allowed_actions: {
        can_accept: false,
        accept_blocked_reason: "GAME_FULL",
        can_reject: false,
        reject_blocked_reason: "GAME_FULL",
      },
    }],
  ])("rejects malformed closed 409 details: %s", async (_label, status, code, details) => {
    const operation = code === "APPLICATION_NOT_ALLOWED"
      ? harness([httpError(status, code, details)]).source.apply(applyAttempt)
      : harness([httpError(status, code, details)]).source.decide(decisionAttempt);
    const error = await registrationError(operation);
    expect(error.code).toBe("APPLICATION_RESULT_UNKNOWN");
  });

  test("clears every HTTP 401 before strict decoding but preserves generic failure semantics", async () => {
    const malformedRead = harness([{
      code: "HTTP_ERROR",
      statusCode: 401,
      data: { malformed: true },
    }]);
    const wrongWrite = harness([httpError(401, "OPEN_GAME_NOT_FOUND")]);

    expect((await registrationError(malformedRead.source.getContext(SHARE_TOKEN))).code)
      .toBe("SERVICE_UNAVAILABLE");
    expect((await registrationError(wrongWrite.source.apply(applyAttempt))).code)
      .toBe("APPLICATION_RESULT_UNKNOWN");
    expect(malformedRead.sessionStore.clear).toHaveBeenCalledTimes(1);
    expect(wrongWrite.sessionStore.clear).toHaveBeenCalledTimes(1);
    expect(malformedRead.calls).toHaveLength(1);
    expect(wrongWrite.calls).toHaveLength(1);
  });
});

describe("HTTP open-game registration failure certainty", () => {
  test.each([null, undefined, "primitive rejection", 42])(
    "contains an unknown transport rejection without leaking TypeError: %p",
    async (failure) => {
      const read = await registrationError(harness([
        rejected(failure),
      ]).source.getContext(SHARE_TOKEN));
      const write = await registrationError(harness([
        rejected(failure),
      ]).source.apply(applyAttempt));

      expect(read.code).toBe("SERVICE_UNAVAILABLE");
      expect(write.code).toBe("APPLICATION_RESULT_UNKNOWN");
    },
  );

  test("wraps synchronous session-load failures by read/write certainty", async () => {
    const read = harness([]);
    const write = harness([]);
    jest.mocked(read.sessionStore.load).mockImplementationOnce(() => {
      throw new Error("SESSION_STORAGE_READ_FAILED");
    });
    jest.mocked(write.sessionStore.load).mockImplementationOnce(() => {
      throw new Error("SESSION_STORAGE_READ_FAILED");
    });

    expect((await registrationError(read.source.getContext(SHARE_TOKEN))).code)
      .toBe("SERVICE_UNAVAILABLE");
    expect((await registrationError(write.source.apply(applyAttempt))).code)
      .toBe("APPLICATION_RESULT_UNKNOWN");
    expect(read.calls).toEqual([]);
    expect(write.calls).toEqual([]);
  });

  test("does not let a failing 401 session clear mask strict AUTH_REQUIRED", async () => {
    const h = harness([httpError(401, "AUTH_REQUIRED")]);
    jest.mocked(h.sessionStore.clear).mockImplementationOnce(() => {
      throw new Error("SESSION_STORAGE_CLEAR_FAILED");
    });

    const error = await registrationError(h.source.getContext(SHARE_TOKEN));

    expect(error.code).toBe("AUTH_REQUIRED");
    expect(h.sessionStore.clear).toHaveBeenCalledTimes(1);
    expect(h.calls).toHaveLength(1);
  });

  test.each([
    ["timeout", { code: "REQUEST_TIMEOUT", errMsg: "timeout" }],
    ["network", { code: "NETWORK_ERROR", errMsg: "offline" }],
    ["HTTP 500", httpError(500, "SERVICE_UNAVAILABLE")],
    ["HTTP 503", httpError(503, "SERVICE_UNAVAILABLE")],
  ])("maps %s by read/write certainty and exposes only the registration error class", async (
    _label,
    failure,
  ) => {
    for (const operation of ["context", "queue", "mine"] as const) {
      expect((await registrationError(perform(harness([failure]), operation))).code)
        .toBe("SERVICE_UNAVAILABLE");
    }
    for (const operation of ["apply", "decide"] as const) {
      expect((await registrationError(perform(harness([failure]), operation))).code)
        .toBe("APPLICATION_RESULT_UNKNOWN");
    }
  });

  test.each([
    ["context", 201, rawAnonymousContext, "SERVICE_UNAVAILABLE"],
    ["queue", 201, rawQueue, "SERVICE_UNAVAILABLE"],
    ["mine", 201, rawMine, "SERVICE_UNAVAILABLE"],
    ["apply", 200, rawAppliedContext, "APPLICATION_RESULT_UNKNOWN"],
    ["decide", 201, rawJoinedDecision, "APPLICATION_RESULT_UNKNOWN"],
    ["context", 200, { ...rawAnonymousContext, private: true }, "SERVICE_UNAVAILABLE"],
    ["queue", 200, { ...rawQueue, private: true }, "SERVICE_UNAVAILABLE"],
    ["mine", 200, { ...rawMine, private: true }, "SERVICE_UNAVAILABLE"],
    ["apply", 201, { ...rawAppliedContext, private: true }, "APPLICATION_RESULT_UNKNOWN"],
    ["decide", 200, { ...rawJoinedDecision, private: true }, "APPLICATION_RESULT_UNKNOWN"],
  ] as const)("maps wrong or malformed successful %s authority to %s", async (
    operation,
    status,
    payload,
    expected,
  ) => {
    const error = await registrationError(perform(harness([response(status, payload)]), operation));
    expect(error.code).toBe(expected);
  });

  test("encodes both decision path segments and sends the verbatim key even on a definitive failure", async () => {
    const h = harness([httpError(401, "AUTH_REQUIRED")]);
    const unusual = {
      ...decisionAttempt,
      gameId: "game/id +?=",
      applicationId: "application/id +?=",
      idempotencyKey: "verbatim-key-0000000000001",
    };

    await registrationError(h.source.decide(unusual));

    expect(h.calls).toEqual([{
      method: "POST",
      path: "/api/v1/games/game%2Fid%20%2B%3F%3D/applications/application%2Fid%20%2B%3F%3D/decision",
      body: { decision: "ACCEPT", expected_version: 1 },
      headers: {
        Authorization: `Bearer ${SESSION_TOKEN}`,
        "Idempotency-Key": "verbatim-key-0000000000001",
      },
    }]);
    expect(unusual).toEqual({
      ...decisionAttempt,
      gameId: "game/id +?=",
      applicationId: "application/id +?=",
      idempotencyKey: "verbatim-key-0000000000001",
    });
  });
});

describe("HTTP open-game registration response authority", () => {
  test.each([
    ["different application", contextWithWithdrawalFields({
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      persisted_status: "WITHDRAWN",
      effective_status: "WITHDRAWN",
      version: 2,
      withdrawn_at: "2026-08-24T00:30:00+08:00",
      withdrawal_kind: "APPLICATION_WITHDRAWAL",
      available_withdrawal_action: null,
    })],
    ["unchanged version", { ...rawWithdrawnContext, viewer_registration: {
      ...(rawWithdrawnContext.viewer_registration as Record<string, unknown>), version: 1,
    } }],
    ["wrong withdrawal kind", { ...rawWithdrawnContext, viewer_registration: {
      ...(rawWithdrawnContext.viewer_registration as Record<string, unknown>),
      withdrawal_kind: "GAME_EXIT",
      decided_at: "2026-08-24T00:25:00+08:00",
    } }],
    ["cancelled effective result at write response", { ...rawWithdrawnContext, viewer_registration: {
      ...(rawWithdrawnContext.viewer_registration as Record<string, unknown>),
      effective_status: "CANCELLED",
    } }],
  ])("rejects a structurally valid mismatched withdrawal result: %s", async (_label, payload) => {
    expect(() => decodeOpenGameRegistrationContext(payload)).not.toThrow();
    const error = await registrationError(
      harness([response(200, payload)]).source.withdraw(withdrawAttempt),
    );
    expect(error.code).toBe("APPLICATION_RESULT_UNKNOWN");
  });

  test.each([
    ["anonymous result", rawAnonymousContext],
    ["different display name", {
      ...rawAppliedContext,
      viewer_registration: {
        ...(rawAppliedContext.viewer_registration as Record<string, unknown>),
        display_name: "另一位球员",
      },
    }],
    ["different position", {
      ...rawAppliedContext,
      viewer_registration: {
        ...(rawAppliedContext.viewer_registration as Record<string, unknown>),
        position: "DEFENDER",
      },
    }],
    ["different note", {
      ...rawAppliedContext,
      viewer_registration: {
        ...(rawAppliedContext.viewer_registration as Record<string, unknown>),
        note: null,
      },
    }],
    ["joined persisted result", {
      ...rawAppliedContext,
      viewer_registration: {
        ...(rawAppliedContext.viewer_registration as Record<string, unknown>),
        persisted_status: "JOINED",
        effective_status: "JOINED",
        version: 2,
        decided_at: "2026-08-24T00:25:00+08:00",
        available_withdrawal_action: "LEAVE_GAME",
      },
    }],
    ["rejected effective result", {
      ...rawAppliedContext,
      viewer_registration: {
        ...(rawAppliedContext.viewer_registration as Record<string, unknown>),
        persisted_status: "REJECTED",
        effective_status: "REJECTED",
        version: 2,
        decided_at: "2026-08-24T00:25:00+08:00",
        available_withdrawal_action: null,
      },
    }],
  ])("rejects a structurally valid mismatched apply result: %s", async (_label, payload) => {
    expect(() => decodeOpenGameRegistrationContext(payload)).not.toThrow();
    const error = await registrationError(harness([response(201, payload)]).source.apply(applyAttempt));
    expect(error.code).toBe("APPLICATION_RESULT_UNKNOWN");
  });

  test("accepts only the exact authoritative applied projection", async () => {
    const h = harness([response(201, rawAppliedContext)]);

    await expect(h.source.apply(applyAttempt)).resolves.toEqual(
      decodeOpenGameRegistrationContext(rawAppliedContext),
    );
    expect(h.sessionStore.clear).not.toHaveBeenCalled();
  });

  test.each([
    ["different application", decisionAttempt, {
      ...rawJoinedDecision,
      application_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    }],
    ["wrong accept status", decisionAttempt, fixture("open-game-application-decision-rejected")],
    ["wrong reject status", {
      ...decisionAttempt,
      decision: "REJECT" as const,
    }, rawJoinedDecision],
    ["unchanged version", decisionAttempt, { ...rawJoinedDecision, version: 1 }],
    ["skipped version", decisionAttempt, { ...rawJoinedDecision, version: 3 }],
    ["unsafe expected increment", {
      ...decisionAttempt,
      expectedVersion: Number.MAX_SAFE_INTEGER,
    }, { ...rawJoinedDecision, version: Number.MAX_SAFE_INTEGER }],
  ] as const)("rejects a structurally valid mismatched decision result: %s", async (
    _label,
    attempt,
    payload,
  ) => {
    expect(() => decodeOpenGameApplicationDecisionResult(payload)).not.toThrow();
    const error = await registrationError(harness([response(200, payload)]).source.decide(attempt));
    expect(error.code).toBe("APPLICATION_RESULT_UNKNOWN");
  });

  test("accepts both exact ACCEPT and REJECT authority without inventing a result", async () => {
    const rejectAttempt = { ...decisionAttempt, decision: "REJECT" as const };
    const rawRejected = fixture("open-game-application-decision-rejected");
    const h = harness([
      response(200, rawJoinedDecision),
      response(200, rawRejected),
    ]);

    await expect(h.source.decide(decisionAttempt)).resolves.toEqual(
      decodeOpenGameApplicationDecisionResult(rawJoinedDecision),
    );
    await expect(h.source.decide(rejectAttempt)).resolves.toEqual(
      decodeOpenGameApplicationDecisionResult(rawRejected),
    );
  });
});

describe("OpenGameRegistrationApiError detail typing", () => {
  test("keeps the four closed public detail variants", () => {
    expect(new OpenGameRegistrationApiError("OPEN_GAME_NOT_FOUND").details).toBeUndefined();
    expect(new OpenGameRegistrationApiError("INVALID_ARGUMENT", {
      fields: [{ field: "display_name", message: "bad" }],
    }).details).toEqual({ fields: [{ field: "display_name", message: "bad" }] });
    expect(new OpenGameRegistrationApiError("APPLICATION_NOT_ALLOWED", {
      applyBlockedReason: "GAME_FULL",
      remainingSpots: 0,
    }).details).toEqual({ applyBlockedReason: "GAME_FULL", remainingSpots: 0 });
    expect(new OpenGameRegistrationApiError("APPLICATION_CAPACITY_CHANGED", {
      remainingSpots: 0,
      allowedActions: {
        canAccept: false,
        acceptBlockedReason: "GAME_FULL",
        canReject: true,
        rejectBlockedReason: null,
      },
    }).details).toMatchObject({ remainingSpots: 0 });
  });

  test("rejects invalid code/detail combinations at compile time", () => {
    if (false) {
      // @ts-expect-error no-details errors cannot expose arbitrary details
      new OpenGameRegistrationApiError("OPEN_GAME_NOT_FOUND", { remainingSpots: 0 });
      // @ts-expect-error APPLICATION_NOT_ALLOWED requires its blocker authority
      new OpenGameRegistrationApiError("APPLICATION_NOT_ALLOWED");
      // @ts-expect-error capacity details cannot be reused for INVALID_ARGUMENT
      new OpenGameRegistrationApiError("INVALID_ARGUMENT", {
        remainingSpots: 0,
        allowedActions: {
          canAccept: false,
          acceptBlockedReason: "GAME_FULL",
          canReject: true,
          rejectBlockedReason: null,
        },
      });
    }
    expect(true).toBe(true);
  });
});
