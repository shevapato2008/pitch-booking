/// <reference types="node" />
import { describe, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";

import {
  decodeOpenGameMemberRemovalResult,
  decodeOpenGameMemberRoster,
} from "../domain/open-game-registration-decoder";
import type { StatusTransport, WeChatIdentityCapability } from "../runtime/interfaces";
import {
  createHttpOpenGameRegistrationSource,
  OpenGameRegistrationApiError,
} from "./http-open-game-registration";
import type { OpenGameMemberRemoveAttempt } from "./open-game-registration";
import type { SessionStore } from "./session-store";

const fixture = (name: string): Record<string, unknown> => JSON.parse(
  readFileSync(`contracts/examples/${name}.json`, "utf8"),
) as Record<string, unknown>;
const USER_ID = "00000000-0000-4000-8000-000000000001";
const SESSION_TOKEN = "stored-session-token";
const rawRoster = fixture("open-game-member-roster-ready");
const rawResult = fixture("open-game-member-removal-promoted");
const GAME_ID = "51000000-0000-4000-8000-000000000001";
const REGISTRATION_ID = "52000000-0000-4000-8000-000000000001";
const attempt: OpenGameMemberRemoveAttempt = {
  kind: "remove-member",
  originatingUserId: USER_ID,
  gameId: GAME_ID,
  registrationId: REGISTRATION_ID,
  expectedVersion: 2,
  reason: "临时有事，双方已沟通",
  idempotencyKey: "remove-member-key-000000000001",
};

type Call = {
  readonly method: "GET" | "POST" | "PUT";
  readonly path: string;
  readonly body: unknown;
  readonly headers?: Readonly<Record<string, string>>;
};
const response = (statusCode: number, data: unknown) => ({ statusCode, data });
const rejected = (value: unknown) => ({ rejectWith: value });

function harness(responses: Array<unknown>) {
  const calls: Call[] = [];
  const transport: StatusTransport = {
    get: async () => { throw new Error("plain transport disabled"); },
    post: async () => { throw new Error("plain transport disabled"); },
    put: async () => { throw new Error("plain transport disabled"); },
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
    load: jest.fn(() => ({
      token: SESSION_TOKEN,
      expiresAt: "2099-01-01T00:00:00Z",
      userId: USER_ID,
    })),
    save: jest.fn(),
    clear: jest.fn(),
  };
  const identity: WeChatIdentityCapability = { login: jest.fn(async () => ({ code: "unused" })) };
  return {
    calls,
    source: createHttpOpenGameRegistrationSource({ transport, identity, sessionStore }),
  };
}

describe("HTTP open-game member removal", () => {
  test("reads owner roster and removes through exact authenticated requests", async () => {
    const h = harness([response(200, rawRoster), response(200, rawResult)]);
    await expect(h.source.getMembers(GAME_ID)).resolves.toEqual(
      decodeOpenGameMemberRoster(rawRoster),
    );
    await expect(h.source.removeMember(attempt)).resolves.toEqual(
      decodeOpenGameMemberRemovalResult(rawResult),
    );
    expect(h.calls).toEqual([
      {
        method: "GET",
        path: `/api/v1/games/${GAME_ID}/members`,
        body: undefined,
        headers: { Authorization: `Bearer ${SESSION_TOKEN}` },
      },
      {
        method: "POST",
        path: `/api/v1/games/${GAME_ID}/members/${REGISTRATION_ID}/remove`,
        body: { expected_version: 2, reason: "临时有事，双方已沟通" },
        headers: {
          Authorization: `Bearer ${SESSION_TOKEN}`,
          "Idempotency-Key": attempt.idempotencyKey,
        },
      },
    ]);
  });

  test.each([
    [response(201, rawResult)],
    [response(200, { ...rawResult, reason: "private" })],
    [rejected({ code: "NETWORK_ERROR" })],
  ])("keeps uncertain removal results unknown", async (failure) => {
    const error = await hError(harness([failure]).source.removeMember(attempt));
    expect(error.code).toBe("APPLICATION_RESULT_UNKNOWN");
  });
});

async function hError(promise: Promise<unknown>): Promise<OpenGameRegistrationApiError> {
  try {
    await promise;
  } catch (caught) {
    if (caught instanceof OpenGameRegistrationApiError) return caught;
  }
  throw new Error("expected OpenGameRegistrationApiError");
}
