/// <reference types="node" />
import { describe, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";

import type { StatusTransport, WeChatIdentityCapability } from "../runtime/interfaces";
import { createOpenGameReportAttemptStore } from "./open-game-report-attempt-store";
import type { SessionStorage, SessionStore, StoredSession } from "./session-store";
import {
  createHttpOpenGameReportSource,
  OpenGameReportApiError,
} from "./http-open-game-report";
import type { OpenGameReportAttempt } from "./open-game-report";

const fixture = (name: string): Record<string, unknown> => JSON.parse(
  readFileSync(`contracts/examples/${name}.json`, "utf8"),
) as Record<string, unknown>;
const USER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000002";
const GAME_ID = "51000000-0000-4000-8000-000000000001";
const OTHER_GAME_ID = "51000000-0000-4000-8000-000000000002";
const attempt: OpenGameReportAttempt = {
  originatingUserId: USER_ID,
  gameId: GAME_ID,
  body: {
    category: "FALSE_INFORMATION",
    facts: "公开说明称费用已经包含，但组织者随后要求额外支付未公开费用。",
  },
  idempotencyKey: "game-report-key-000000000001",
  replayed: false,
};

type Call = {
  readonly method: "GET" | "POST" | "PUT";
  readonly path: string;
  readonly body: unknown;
  readonly headers?: Readonly<Record<string, string>>;
};
const response = (statusCode: number, data: unknown) => ({ statusCode, data });
const rejected = (rejectWith: unknown) => ({ rejectWith });
const httpError = (statusCode: number, code: string, details: unknown = {}) => ({
  code: "HTTP_ERROR" as const,
  statusCode,
  data: { error: { code, message: "error", request_id: "request-id", details } },
});

function harness(
  responses: unknown[],
  initialSession: StoredSession | null = {
    token: "session-token",
    expiresAt: "2099-01-01T00:00:00Z",
    userId: USER_ID,
  },
) {
  const calls: Call[] = [];
  let stored = initialSession;
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
      return next as { readonly statusCode: number; readonly data: T };
    },
  };
  const sessionStore: SessionStore = {
    load: jest.fn(() => stored),
    save: jest.fn((value: StoredSession) => { stored = value; }),
    clear: jest.fn(() => { stored = null; }),
  };
  const identity: WeChatIdentityCapability = {
    login: jest.fn(async () => ({ code: "wechat-code" })),
  };
  return {
    calls,
    identity,
    sessionStore,
    source: createHttpOpenGameReportSource({ transport, identity, sessionStore }),
  };
}

describe("HTTP open-game report source", () => {
  test("reads and submits with the exact game, body, bearer, and original key", async () => {
    const context = fixture("open-game-report-context");
    const submitted = fixture("open-game-report-submitted");
    const h = harness([response(200, context), response(201, submitted)]);

    await expect(h.source.getMyReport(GAME_ID)).resolves.toMatchObject({
      target: { gameId: GAME_ID }, report: null,
    });
    await expect(h.source.submit(attempt)).resolves.toMatchObject({
      reportId: submitted.report_id,
      category: attempt.body.category,
      facts: attempt.body.facts,
    });

    expect(h.calls).toEqual([
      {
        method: "GET",
        path: `/api/v1/games/${GAME_ID}/my-report`,
        body: undefined,
        headers: { Authorization: "Bearer session-token" },
      },
      {
        method: "POST",
        path: `/api/v1/games/${GAME_ID}/reports`,
        body: { category: attempt.body.category, facts: attempt.body.facts },
        headers: {
          Authorization: "Bearer session-token",
          "Idempotency-Key": attempt.idempotencyKey,
        },
      },
    ]);
  });

  test("accepts exact 200 replay but treats mismatched/malformed mutation success as unknown", async () => {
    const submitted = fixture("open-game-report-submitted");
    const replay = harness([response(200, submitted)]);
    await expect(replay.source.submit({ ...attempt, replayed: true })).resolves.toMatchObject({
      reportId: submitted.report_id,
    });

    for (const success of [
      response(201, { ...submitted, facts: "另一段事实" }),
      response(202, submitted),
      response(201, { ...submitted, unexpected: true }),
    ]) {
      const h = harness([success]);
      await expect(h.source.submit(attempt)).rejects.toMatchObject({
        code: "REPORT_RESULT_UNKNOWN",
      });
    }
  });

  test.each([
    [404, "REPORT_CONTEXT_NOT_FOUND"],
    [409, "REPORTING_WINDOW_CLOSED"],
    [409, "REPORT_ALREADY_EXISTS"],
    [409, "IDEMPOTENCY_KEY_REUSED"],
    [422, "INVALID_ARGUMENT"],
    [422, "SENSITIVE_CONTENT_NOT_ALLOWED"],
  ] as const)("classifies definitive submit %s %s", async (statusCode, code) => {
    const h = harness([rejected(httpError(statusCode, code))]);
    await expect(h.source.submit(attempt)).rejects.toEqual(new OpenGameReportApiError(code));
  });

  test("preserves uncertainty for network, 5xx, malformed errors, and stale-session races", async () => {
    for (const failure of [
      { code: "NETWORK_ERROR", errMsg: "offline" },
      httpError(503, "SERVICE_UNAVAILABLE"),
      { code: "HTTP_ERROR", statusCode: 409, data: { error: { code: "REPORT_ALREADY_EXISTS" } } },
    ]) {
      const h = harness([rejected(failure)]);
      await expect(h.source.submit(attempt)).rejects.toMatchObject({ code: "REPORT_RESULT_UNKNOWN" });
    }

    const h = harness([rejected(httpError(401, "AUTH_REQUIRED"))]);
    const replacement = {
      token: "replacement-token",
      expiresAt: "2099-02-01T00:00:00Z",
      userId: OTHER_USER_ID,
    };
    (h.sessionStore.load as jest.Mock).mockReturnValueOnce({
      token: "session-token", expiresAt: "2099-01-01T00:00:00Z", userId: USER_ID,
    }).mockReturnValue(replacement);
    await expect(h.source.submit(attempt)).rejects.toMatchObject({ code: "REPORT_RESULT_UNKNOWN" });
    expect(h.sessionStore.clear).not.toHaveBeenCalled();
  });

  test("login stores a strict session and is single-flight", async () => {
    const rawSession = fixture("wechat-session");
    const h = harness([response(200, rawSession)], null);
    const first = h.source.login();
    const second = h.source.login();
    await expect(Promise.all([first, second])).resolves.toEqual([
      rawSession.user && (rawSession.user as Record<string, unknown>).id,
      rawSession.user && (rawSession.user as Record<string, unknown>).id,
    ]);
    expect(h.calls).toHaveLength(1);
    expect(h.identity.login).toHaveBeenCalledTimes(1);
    expect(h.sessionStore.save).toHaveBeenCalledTimes(1);
  });
});

describe("durable open-game report attempt", () => {
  function memory(initial?: unknown): { storage: SessionStorage; read(): unknown } {
    let value = initial;
    return {
      storage: {
        get: () => value,
        set: (_key, next) => { value = structuredClone(next); },
        remove: () => { value = undefined; },
      },
      read: () => value,
    };
  }

  test("persists one account/game mutation and marks only the exact attempt replayed", () => {
    const local = memory();
    const store = createOpenGameReportAttemptStore(local.storage);
    expect(store.begin(attempt)).toEqual({ kind: "READY", attempt });
    expect(store.load()).toEqual(attempt);
    const replayed = store.markReplayed(attempt);
    expect(replayed).toEqual({ ...attempt, replayed: true });
    expect(store.markReplayed(attempt)).toBeNull();
    expect(store.clearIfCurrent(attempt)).toBe(true);
    expect(store.load()).toBeNull();
  });

  test("never replaces foreign-account, other-game, or changed-body pending mutations", () => {
    const local = memory();
    const store = createOpenGameReportAttemptStore(local.storage);
    store.begin(attempt);
    expect(store.begin({ ...attempt, originatingUserId: OTHER_USER_ID })).toMatchObject({
      kind: "FOREIGN_ACCOUNT_PENDING", attempt,
    });
    expect(store.begin({ ...attempt, gameId: OTHER_GAME_ID })).toMatchObject({
      kind: "SAME_ACCOUNT_PENDING", attempt,
    });
    expect(store.begin({
      ...attempt,
      body: { ...attempt.body, category: "EXTRA_CHARGE" },
    })).toMatchObject({ kind: "SAME_ACCOUNT_PENDING", attempt });
    expect(store.load()).toEqual(attempt);
  });

  test("drops malformed local records and compares current account without leaking body", () => {
    const local = memory({ ...attempt, idempotencyKey: "short" });
    const store = createOpenGameReportAttemptStore(local.storage);
    expect(store.load()).toBeNull();
    expect(local.read()).toBeUndefined();

    store.begin(attempt);
    expect(store.resolveForUser(USER_ID)).toEqual({ kind: "READY", attempt });
    expect(store.resolveForUser(OTHER_USER_ID)).toEqual({
      kind: "FOREIGN_ACCOUNT_PENDING", attempt,
    });
  });
});
