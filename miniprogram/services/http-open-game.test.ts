/// <reference types="node" />
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";

import { decodeOpenGameEntry, decodeOpenGameOwner, decodeOpenGamePublic } from "../domain/open-game-decoder";
import type { OpenGameDraftInput, OpenGameOwner } from "../domain/open-game";
import type { StatusTransport, TransportError, WeChatIdentityCapability } from "../runtime/interfaces";
import {
  createHttpOpenGameSource,
  OpenGameApiError,
} from "./http-open-game";
import { createOpenGameMutationAttemptStore } from "./open-game-attempt-store";
import type { SessionStore, StoredSession } from "./session-store";
import {
  classifyOpenGameDefinitiveRecovery,
  classifyOpenGameUnknownRecovery,
  type OpenGameCancelAttempt,
  type OpenGameMutationAttempt,
  type OpenGamePublishAttempt,
  type OpenGameSource,
} from "./open-game";

const fixture = (name: string): Record<string, unknown> => JSON.parse(
  readFileSync(`contracts/examples/${name}.json`, "utf8"),
) as Record<string, unknown>;

const rawDraft = fixture("open-game-owner-draft");
const rawPublished = fixture("open-game-owner-published");
const rawCancelled = fixture("open-game-owner-cancelled");
const rawEntryCreate = fixture("open-game-entry-create");
const rawEntryManage = fixture("open-game-entry-manage");
const rawEntryNone = fixture("open-game-entry-none");
const rawPublic = fixture("open-game-public-published");
const rawSession = fixture("wechat-session");

const ownerDraft = decodeOpenGameOwner(rawDraft);
const ownerPublished = decodeOpenGameOwner(rawPublished);
const ownerCancelled = decodeOpenGameOwner(rawCancelled);
const entryCreate = decodeOpenGameEntry(rawEntryCreate);
const entryManage = decodeOpenGameEntry(rawEntryManage);
const entryNone = decodeOpenGameEntry(rawEntryNone);

const OTHER_GAME_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER_ORDER_ID = "22222222-2222-4222-8222-222222222222";
const rawUpdated = { ...rawDraft, version: 2 };
const rawPublishedAtVersionTwo = { ...rawPublished, version: 2 };
const rawCancelledAtVersionTwo = { ...rawCancelled, version: 2 };
const rawProjectedCancelledAtVersionTwo = {
  ...rawCancelledAtVersionTwo,
  persisted_status: "PUBLISHED",
  state_reason: "ORDER_REFUNDED",
  public_view: {
    ...(rawCancelled.public_view as Record<string, unknown>),
    state_reason: "BOOKING_UNAVAILABLE",
  },
};

const draftBody: OpenGameDraftInput = {
  name: ownerDraft.name,
  teamName: ownerDraft.team.name,
  totalPlayers: ownerDraft.totalPlayers,
  fixedPlayers: ownerDraft.fixedPlayers,
  openSpots: ownerDraft.openSpots,
  intensity: ownerDraft.intensity,
  minimumExperience: ownerDraft.minimumExperience,
  positions: ["FORWARD", "DEFENDER", "GOALKEEPER"],
  aaCents: ownerDraft.aaCents,
  registrationDeadline: ownerDraft.registrationDeadline,
  equipmentAndArrivalNotes: ownerDraft.equipmentAndArrivalNotes,
  visibility: ownerDraft.visibility,
};

const createAttempt: Extract<OpenGameMutationAttempt, { readonly kind: "create" }> = {
  kind: "create",
  orderId: "11111111-1111-4111-8111-111111111111",
  body: draftBody,
  idempotencyKey: "6eb8d160-2d31-4b5c-9a2f-e909ac940001",
};
const updateAttempt: Extract<OpenGameMutationAttempt, { readonly kind: "update" }> = {
  kind: "update",
  gameId: ownerDraft.id,
  body: { ...draftBody, expectedVersion: 1 },
  idempotencyKey: "6eb8d160-2d31-4b5c-9a2f-e909ac940002",
};
const publishAttempt: OpenGamePublishAttempt = {
  kind: "publish",
  gameId: ownerDraft.id,
  expectedVersion: 1,
  idempotencyKey: "6eb8d160-2d31-4b5c-9a2f-e909ac940003",
};
const cancelAttempt: OpenGameCancelAttempt = {
  kind: "cancel",
  gameId: ownerDraft.id,
  expectedVersion: 1,
  idempotencyKey: "6eb8d160-2d31-4b5c-9a2f-e909ac940004",
};

type Call = {
  readonly method: string;
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

function harness(responses: unknown[], sessionPresent = true) {
  const calls: Call[] = [];
  let storedSession: StoredSession | null = sessionPresent
    ? { token: "old-token", expiresAt: "2099-01-01T00:00:00Z" }
    : null;
  const next = async (): Promise<unknown> => {
    const value = responses.shift();
    if (value instanceof Error || (value && typeof value === "object" && "code" in value)) throw value;
    return value;
  };
  const plainRequest = async <T>(): Promise<T> => { throw new Error("PLAIN_TRANSPORT_NOT_ALLOWED"); };
  const transport: StatusTransport = {
    get: plainRequest,
    post: plainRequest,
    put: plainRequest,
    requestWithStatus: async <T>(
      method: "GET" | "POST" | "PUT",
      path: string,
      body: unknown,
      headers?: Readonly<Record<string, string>>,
    ) => {
      calls.push({ method, path, body, headers });
      return (await next()) as { readonly statusCode: number; readonly data: T };
    },
  };
  const load = jest.fn(() => storedSession);
  const sessionStore: SessionStore = {
    load,
    save: jest.fn((value: StoredSession) => { storedSession = value; }),
    clear: jest.fn(() => { storedSession = null; }),
  };
  const identity: WeChatIdentityCapability = {
    login: jest.fn(async () => ({ code: "wechat-code" })),
  };
  return {
    calls,
    identity,
    load,
    sessionStore,
    source: createHttpOpenGameSource({ transport, identity, sessionStore }),
  };
}

function performMutation(source: OpenGameSource, attempt: OpenGameMutationAttempt): Promise<OpenGameOwner> {
  if (attempt.kind === "create") return source.create(attempt);
  if (attempt.kind === "update") return source.update(attempt);
  if (attempt.kind === "publish") return source.publish(attempt as OpenGamePublishAttempt);
  return source.cancel(attempt as OpenGameCancelAttempt);
}

beforeEach(() => { jest.clearAllMocks(); });

describe("HTTP open-game reads and authentication", () => {
  test("uses StatusTransport, encodes owner segments, and logs in once when the session is missing", async () => {
    const h = harness([response(200, rawSession), response(200, rawEntryCreate)], false);

    await expect(h.source.getEntry("order/id +?=")).resolves.toEqual(entryCreate);

    expect(h.identity.login).toHaveBeenCalledTimes(1);
    expect(h.calls).toEqual([
      { method: "POST", path: "/api/v1/auth/wechat/session", body: { code: "wechat-code" }, headers: undefined },
      {
        method: "GET",
        path: "/api/v1/orders/order%2Fid%20%2B%3F%3D/game",
        body: undefined,
        headers: { Authorization: `Bearer ${String(rawSession.session_token)}` },
      },
    ]);
  });

  test("shared-token GET encodes the token and never loads auth, logs in, or sends bearer", async () => {
    const h = harness([response(200, rawPublic)], false);

    await expect(h.source.getSharedGame("share/token +?=")).resolves.toMatchObject({ state: "PUBLISHED" });

    expect(h.calls).toEqual([{
      method: "GET",
      path: "/api/v1/shared-games/share%2Ftoken%20%2B%3F%3D",
      body: undefined,
      headers: undefined,
    }]);
    expect(h.load).not.toHaveBeenCalled();
    expect(h.identity.login).not.toHaveBeenCalled();
  });

  test("silently re-logs in once after owner 401 and replays the exact mutation", async () => {
    const h = harness([
      httpError(401, "AUTH_REQUIRED"),
      response(200, rawSession),
      response(200, rawUpdated),
    ]);

    await expect(h.source.update(updateAttempt)).resolves.toMatchObject({ id: ownerDraft.id });

    const writes = h.calls.filter(({ method }) => method === "PUT");
    expect(writes).toHaveLength(2);
    expect(writes[0]).toMatchObject({
      body: writes[1]?.body,
      headers: { Authorization: "Bearer old-token", "Idempotency-Key": updateAttempt.idempotencyKey },
    });
    expect(writes[1]).toMatchObject({
      body: writes[0]?.body,
      headers: { Authorization: `Bearer ${String(rawSession.session_token)}`, "Idempotency-Key": updateAttempt.idempotencyKey },
    });
    expect(h.identity.login).toHaveBeenCalledTimes(1);
  });

  test("a second owner 401 is definitive auth loss", async () => {
    const h = harness([
      httpError(401, "AUTH_REQUIRED"),
      response(200, rawSession),
      httpError(401, "AUTH_REQUIRED"),
    ]);

    await expect(h.source.cancel(cancelAttempt)).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(h.identity.login).toHaveBeenCalledTimes(1);
    expect(h.sessionStore.clear).toHaveBeenCalledTimes(2);
  });

  test("rejects a structurally valid owner response for another game", async () => {
    expect(() => decodeOpenGameOwner(rawDraft)).not.toThrow();
    const h = harness([response(200, rawDraft)]);

    await expect(h.source.getOwnedGame("game/id +?="))
      .rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(h.calls[0]?.path).toBe("/api/v1/games/game%2Fid%20%2B%3F%3D");
  });

  test("rejects a structurally valid draft response from the shared endpoint", async () => {
    const draftPublic = { ...rawPublic, state: "DRAFT" };
    expect(() => decodeOpenGamePublic(draftPublic)).not.toThrow();

    await expect(harness([response(200, draftPublic)]).source.getSharedGame("shared-token"))
      .rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });
});

describe("HTTP open-game mutations", () => {
  test("sends exact snake_case requests, paths, and stable idempotency headers", async () => {
    const create = createAttempt;
    const update = updateAttempt;
    const publish = publishAttempt;
    const cancel = cancelAttempt;
    const h = harness([
      response(201, rawDraft),
      response(200, rawUpdated),
      response(200, rawPublishedAtVersionTwo),
      response(200, rawCancelledAtVersionTwo),
    ]);

    await h.source.create(create);
    await h.source.update(update);
    await h.source.publish(publish);
    await h.source.cancel(cancel);

    const snakeBody = {
      name: draftBody.name,
      team_name: draftBody.teamName,
      total_players: draftBody.totalPlayers,
      fixed_players: draftBody.fixedPlayers,
      open_spots: draftBody.openSpots,
      intensity: draftBody.intensity,
      minimum_experience: draftBody.minimumExperience,
      positions: ["FORWARD", "DEFENDER", "GOALKEEPER"],
      aa_cents: draftBody.aaCents,
      registration_deadline: draftBody.registrationDeadline,
      equipment_and_arrival_notes: draftBody.equipmentAndArrivalNotes,
      visibility: draftBody.visibility,
    };
    expect(h.calls).toEqual([
      expect.objectContaining({ method: "POST", path: `/api/v1/orders/${create.orderId}/game`, body: snakeBody, headers: expect.objectContaining({ "Idempotency-Key": create.idempotencyKey }) }),
      expect.objectContaining({ method: "PUT", path: `/api/v1/games/${update.gameId}`, body: { ...snakeBody, expected_version: 1 }, headers: expect.objectContaining({ "Idempotency-Key": update.idempotencyKey }) }),
      expect.objectContaining({ method: "POST", path: `/api/v1/games/${publish.gameId}/publish`, body: { expected_version: 1 }, headers: expect.objectContaining({ "Idempotency-Key": publish.idempotencyKey }) }),
      expect.objectContaining({ method: "POST", path: `/api/v1/games/${cancel.gameId}/cancel`, body: { expected_version: 1 }, headers: expect.objectContaining({ "Idempotency-Key": cancel.idempotencyKey }) }),
    ]);
  });

  test.each([
    ["create order", createAttempt, { ...rawDraft, order_id: OTHER_ORDER_ID }],
    ["create state", createAttempt, { ...rawPublished, version: 1 }],
    ["create version", createAttempt, rawUpdated],
    ["update game", updateAttempt, { ...rawUpdated, id: OTHER_GAME_ID }],
    ["update version", updateAttempt, rawDraft],
    ["publish game", publishAttempt, { ...rawPublishedAtVersionTwo, id: OTHER_GAME_ID }],
    ["publish version", publishAttempt, { ...rawPublished, version: 1 }],
    ["publish state", publishAttempt, rawUpdated],
    ["cancel game", cancelAttempt, { ...rawCancelledAtVersionTwo, id: OTHER_GAME_ID }],
    ["cancel version", cancelAttempt, { ...rawCancelled, version: 1 }],
    ["cancel state", cancelAttempt, rawPublishedAtVersionTwo],
    ["cancel persisted status", cancelAttempt, rawProjectedCancelledAtVersionTwo],
  ] as const)("rejects a structurally valid mismatched %s result without clearing its attempt", async (
    _caseName,
    attempt,
    payload,
  ) => {
    expect(() => decodeOpenGameOwner(payload)).not.toThrow();
    let stored: unknown;
    const store = createOpenGameMutationAttemptStore({
      get: () => stored,
      set: (_key, value) => { stored = value; },
      remove: () => { stored = undefined; },
    });
    expect(store.begin(attempt)).toMatchObject({ kind: "READY" });

    await expect(performMutation(harness([response(attempt.kind === "create" ? 201 : 200, payload)]).source, attempt))
      .rejects.toMatchObject({ code: "OPEN_GAME_RESULT_UNKNOWN" });
    expect(store.load()).toEqual(attempt);
  });

  test("accepts only 201 for create and 200 for every other operation", async () => {
    await expect(harness([response(200, rawDraft)]).source.create(createAttempt))
      .rejects.toMatchObject({ code: "OPEN_GAME_RESULT_UNKNOWN" });
    await expect(harness([response(201, rawDraft)]).source.update(updateAttempt))
      .rejects.toMatchObject({ code: "OPEN_GAME_RESULT_UNKNOWN" });
    await expect(harness([response(201, rawEntryCreate)]).source.getEntry(createAttempt.orderId))
      .rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  test("keeps timeout, network, 5xx, and malformed success uncertain without clearing the attempt", async () => {
    for (const failure of [
      { code: "REQUEST_TIMEOUT", errMsg: "timeout" } as TransportError,
      { code: "NETWORK_ERROR", errMsg: "network" } as TransportError,
      httpError(503, "SERVICE_UNAVAILABLE"),
      response(201, { ...rawDraft, private: true }),
    ]) {
      let stored: unknown;
      const store = createOpenGameMutationAttemptStore({
        get: () => stored,
        set: (_key, value) => { stored = value; },
        remove: () => { stored = undefined; },
      });
      const stable = store.begin(createAttempt);
      if (stable.kind !== "READY" || stable.attempt.kind !== "create") throw new Error("EXPECTED_READY_ATTEMPT");
      const h = harness([failure]);

      await expect(h.source.create(stable.attempt)).rejects.toMatchObject({ code: "OPEN_GAME_RESULT_UNKNOWN" });
      expect(store.load()).toEqual(createAttempt);
    }
  });

  test.each([
    ["create", 404, "ORDER_NOT_FOUND", "ORDER_NOT_FOUND"],
    ["create", 409, "ORDER_NOT_ELIGIBLE", "ORDER_NOT_ELIGIBLE"],
    ["create", 409, "OPEN_GAME_ALREADY_EXISTS", "OPEN_GAME_ALREADY_EXISTS"],
    ["create", 409, "IDEMPOTENCY_KEY_REUSED", "IDEMPOTENCY_KEY_REUSED"],
    ["update", 404, "OPEN_GAME_NOT_FOUND", "OPEN_GAME_NOT_FOUND"],
    ["update", 409, "ORDER_NOT_ELIGIBLE", "ORDER_NOT_ELIGIBLE"],
    ["update", 409, "OPEN_GAME_STATE_CHANGED", "OPEN_GAME_STATE_CHANGED"],
    ["publish", 409, "IDEMPOTENCY_KEY_REUSED", "IDEMPOTENCY_KEY_REUSED"],
    ["cancel", 409, "OPEN_GAME_STATE_CHANGED", "OPEN_GAME_STATE_CHANGED"],
  ] as const)("maps definitive %s %s %s only from the closed envelope", async (kind, status, code, expected) => {
    const source = harness([httpError(status, code)]).source;
    const operation = kind === "create" ? source.create(createAttempt)
      : kind === "update" ? source.update(updateAttempt)
        : kind === "publish" ? source.publish(publishAttempt)
          : source.cancel(cancelAttempt);
    await expect(operation).rejects.toMatchObject({ code: expected });
  });

  test("strictly maps 422 field details and rejects an out-of-matrix conflict as unknown", async () => {
    const fields = [{ field: "registration_deadline", message: "必须晚于当前时间。" }];
    await expect(harness([httpError(422, "INVALID_ARGUMENT", { fields })]).source.create(createAttempt))
      .rejects.toEqual(new OpenGameApiError("INVALID_ARGUMENT", fields));

    await expect(harness([httpError(409, "ORDER_NOT_ELIGIBLE")]).source.cancel(cancelAttempt))
      .rejects.toMatchObject({ code: "OPEN_GAME_RESULT_UNKNOWN" });
    await expect(harness([{
      code: "HTTP_ERROR",
      statusCode: 409,
      data: { error: { code: "OPEN_GAME_STATE_CHANGED", message: "error", request_id: "request-id", details: {}, private: true } },
    }]).source.update(updateAttempt)).rejects.toMatchObject({ code: "OPEN_GAME_RESULT_UNKNOWN" });
  });

  test("read faults, wrong status, and malformed bodies fail closed as unavailable", async () => {
    for (const failure of [
      { code: "REQUEST_TIMEOUT", errMsg: "timeout" } as TransportError,
      httpError(503, "SERVICE_UNAVAILABLE"),
      httpError(404, "ORDER_NOT_FOUND"),
      response(200, { ...rawPublic, order_id: "private" }),
    ]) {
      await expect(harness([failure]).source.getSharedGame("shared-token"))
        .rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    }
  });
});

describe("open-game authoritative recovery classifiers", () => {
  const ownerAtVersion = (version: number): OpenGameOwner => decodeOpenGameOwner({ ...rawDraft, version });

  test.each([
    [createAttempt, entryManage, "NAVIGATE", true],
    [createAttempt, entryCreate, "REPLAY", false],
    [createAttempt, entryNone, "CLAMP", true],
    [updateAttempt, ownerAtVersion(2), "ACCEPT", true],
    [updateAttempt, ownerAtVersion(1), "REPLAY", false],
    [updateAttempt, ownerPublished, "CLAMP", true],
    [publishAttempt, ownerPublished, "ACCEPT", true],
    [publishAttempt, ownerDraft, "REPLAY", false],
    [publishAttempt, ownerAtVersion(2), "CLAMP", true],
    [cancelAttempt, ownerCancelled, "ACCEPT", true],
    [cancelAttempt, ownerDraft, "REPLAY", false],
    [cancelAttempt, ownerPublished, "CLAMP", true],
  ] as const)("classifies unknown recovery row %# as %s", (attempt, authority, kind, clearAttempt) => {
    expect(classifyOpenGameUnknownRecovery(attempt, authority)).toMatchObject({ kind, clearAttempt });
  });

  test("update acceptance compares every requested field and exact expected+1 version", () => {
    for (const body of [
      { ...updateAttempt.body, name: "另一个球局" },
      { ...updateAttempt.body, teamName: "另一支球队" },
      { ...updateAttempt.body, totalPlayers: 15 },
      { ...updateAttempt.body, fixedPlayers: 8 },
      { ...updateAttempt.body, openSpots: 3 },
      { ...updateAttempt.body, intensity: "COMPETITIVE" as const },
      { ...updateAttempt.body, minimumExperience: null },
      { ...updateAttempt.body, positions: ["ANY"] as const },
      { ...updateAttempt.body, aaCents: 9999 },
      { ...updateAttempt.body, registrationDeadline: "2026-08-28T17:00:00+08:00" },
      { ...updateAttempt.body, equipmentAndArrivalNotes: null },
      { ...updateAttempt.body, visibility: "PUBLIC" as const },
    ]) {
      expect(classifyOpenGameUnknownRecovery({ ...updateAttempt, body }, ownerAtVersion(2)))
        .toMatchObject({ kind: "CLAMP", clearAttempt: true });
    }
  });

  test.each([
    ["OPEN_GAME_ALREADY_EXISTS", createAttempt, undefined, "REFRESH_ENTRY", false],
    ["OPEN_GAME_ALREADY_EXISTS", createAttempt, entryManage, "NAVIGATE", true],
    ["OPEN_GAME_ALREADY_EXISTS", createAttempt, entryCreate, "CLAMP", true],
    ["ORDER_NOT_ELIGIBLE", createAttempt, undefined, "REFRESH_ENTRY", false],
    ["ORDER_NOT_ELIGIBLE", createAttempt, entryNone, "CLAMP", true],
    ["OPEN_GAME_STATE_CHANGED", updateAttempt, undefined, "REFRESH_OWNER", false],
    ["OPEN_GAME_STATE_CHANGED", updateAttempt, ownerPublished, "CLAMP", true],
    ["IDEMPOTENCY_KEY_REUSED", publishAttempt, undefined, "CONFLICT", true],
    ["INVALID_ARGUMENT", updateAttempt, undefined, "CORRECT", true],
    ["OPEN_GAME_NOT_FOUND", cancelAttempt, undefined, "NOT_FOUND", true],
    ["AUTH_REQUIRED", cancelAttempt, undefined, "LOGIN", true],
  ] as const)("classifies definitive recovery row %#", (code, attempt, authority, kind, clearAttempt) => {
    expect(classifyOpenGameDefinitiveRecovery(attempt, code, authority))
      .toMatchObject({ kind, clearAttempt });
  });
});
