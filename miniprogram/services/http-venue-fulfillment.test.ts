/// <reference types="node" />
import { beforeEach, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";

import type { StatusTransport, TransportError, WeChatIdentityCapability } from "../runtime/interfaces";
import type { SessionStore } from "./session-store";
import type { VenueFulfillmentAttemptStore } from "./venue-fulfillment-attempt-store";
import { createHttpVenueFulfillmentDataSource, VenueFulfillmentApiError } from "./http-venue-fulfillment";

const page = JSON.parse(readFileSync("contracts/examples/venue-fulfillment-orders.json", "utf8"));
const checkedIn = JSON.parse(readFileSync("contracts/examples/venue-order-checked-in.json", "utf8"));
const completed = JSON.parse(readFileSync("contracts/examples/venue-order-completed.json", "utf8"));
const refund = JSON.parse(readFileSync("contracts/examples/refund-accepted.json", "utf8"));
const session = JSON.parse(readFileSync("contracts/examples/wechat-session.json", "utf8"));

type Call = { method: string; path: string; body: unknown; headers?: Readonly<Record<string, string>> };
const response = (statusCode: number, data: unknown) => ({ statusCode, data });
const httpError = (statusCode: number, code: string, data: unknown = {}) => ({ code: "HTTP_ERROR" as const, statusCode, data: { error: { code, message: "error", request_id: "request", details: data } } });

function harness(responses: unknown[], sessionPresent = true) {
  const calls: Call[] = [];
  let storedSession = sessionPresent ? { token: "old-token", expiresAt: "2099-01-01T00:00:00Z" } : null;
  let pending: any = null;
  const next = async () => { const value = responses.shift(); if (value instanceof Error || (value && typeof value === "object" && "code" in value)) throw value; return value; };
  const transport: StatusTransport = {
    get: async <T>() => (await next()) as T,
    post: async <T>() => (await next()) as T,
    put: async <T>() => (await next()) as T,
    requestWithStatus: async <T>(method: "GET" | "POST" | "PUT", path: string, body: unknown, headers?: Readonly<Record<string, string>>) => { calls.push({ method, path, body, headers }); return (await next()) as { statusCode: number; data: T }; },
  };
  const sessionStore: SessionStore = {
    load: () => storedSession,
    save: (value) => { storedSession = value; },
    clear: () => { storedSession = null; },
  };
  const attemptStore: VenueFulfillmentAttemptStore = {
    load: () => pending,
    begin: jest.fn((attempt: any) => { pending ??= structuredClone(attempt); return structuredClone(pending); }),
    clear: jest.fn(() => { pending = null; }),
  };
  const identity: WeChatIdentityCapability = { login: jest.fn(async () => ({ code: "wechat-code" })) };
  return { calls, attemptStore, identity, source: createHttpVenueFulfillmentDataSource({ transport, identity, sessionStore, attemptStore }) };
}

beforeEach(() => { jest.clearAllMocks(); });

test("sends encoded optional list query and Bearer without relabelling read errors as empty", async () => {
  const h = harness([response(200, page)]);
  await expect(h.source.listOrders(page.venue.id, "2026-07-28", "cursor+/=", 12)).resolves.toMatchObject({ serviceDate: "2026-07-28" });
  expect(h.calls[0]).toEqual({
    method: "GET",
    path: `/api/v1/venues/${page.venue.id}/fulfillment/orders?service_date=2026-07-28&limit=12&cursor=cursor%2B%2F%3D`,
    body: undefined,
    headers: { Authorization: "Bearer old-token" },
  });
});

test("posts check-in, completion, and refund with the exact original keys", async () => {
  const h = harness([response(200, checkedIn), response(200, completed), response(202, refund)]);
  await h.source.checkIn({ kind: "checkIn", venueId: page.venue.id, orderId: checkedIn.id, idempotencyKey: "original-checkin-key-1" });
  await h.source.complete({ kind: "complete", venueId: page.venue.id, orderId: completed.id, idempotencyKey: "original-complete-key-1" });
  await h.source.refund({ kind: "refund", venueId: page.venue.id, orderId: refund.order_id, reason: "场地临时检修", idempotencyKey: "original-refund-key-01" });
  expect(h.calls).toEqual([
    expect.objectContaining({ method: "POST", path: expect.stringContaining("/check-in"), body: {}, headers: expect.objectContaining({ "Idempotency-Key": "original-checkin-key-1" }) }),
    expect.objectContaining({ method: "POST", path: expect.stringContaining("/complete"), body: {}, headers: expect.objectContaining({ "Idempotency-Key": "original-complete-key-1" }) }),
    expect.objectContaining({ method: "POST", path: expect.stringContaining("/refund"), body: { reason_note: "场地临时检修" }, headers: expect.objectContaining({ "Idempotency-Key": "original-refund-key-01" }) }),
  ]);
});

test("performs one 401 login and replays a mutation with its persisted key", async () => {
  const h = harness([httpError(401, "AUTH_REQUIRED"), response(200, session), response(200, checkedIn)]);
  await h.source.checkIn({ kind: "checkIn", venueId: page.venue.id, orderId: checkedIn.id, idempotencyKey: "replayed-checkin-key-1" });
  expect(h.identity.login).toHaveBeenCalledTimes(1);
  expect(h.calls.filter(({ path }) => path.endsWith("/check-in"))).toHaveLength(2);
  expect(h.calls[h.calls.length - 1]?.headers).toEqual({ Authorization: `Bearer ${session.session_token}`, "Idempotency-Key": "replayed-checkin-key-1" });
});

test.each([
  [404, "ORDER_NOT_FOUND", "ORDER_NOT_FOUND"],
  [409, "ORDER_STATE_CHANGED", "ORDER_STATE_CHANGED"],
  [409, "IDEMPOTENCY_KEY_REUSED", "IDEMPOTENCY_KEY_REUSED"],
  [409, "REFUND_IN_PROGRESS", "REFUND_IN_PROGRESS"],
] as const)("maps definitive %s %s without exposing private details", async (status, code, expected) => {
  const h = harness([httpError(status, code, { private: "hidden" })]);
  await expect(h.source.complete({ kind: "complete", venueId: page.venue.id, orderId: completed.id, idempotencyKey: "definitive-error-key-1" }))
    .rejects.toEqual(new VenueFulfillmentApiError(expected));
  expect(h.attemptStore.clear).toHaveBeenCalledTimes(1);
});

test("maps a read 503 for display but keeps write timeout, 5xx, and malformed success uncertain", async () => {
  await expect(harness([httpError(503, "SERVICE_UNAVAILABLE")]).source.listOrders(page.venue.id))
    .rejects.toEqual(new VenueFulfillmentApiError("SERVICE_UNAVAILABLE"));
  for (const failure of [
    { code: "REQUEST_TIMEOUT", errMsg: "timeout" } as TransportError,
    httpError(500, "INTERNAL_ERROR"),
    response(200, { ...checkedIn, private: true }),
  ]) {
    const h = harness([failure]);
    await expect(h.source.checkIn({ kind: "checkIn", venueId: page.venue.id, orderId: checkedIn.id, idempotencyKey: "uncertain-checkin-key-1" }))
      .rejects.toEqual(new VenueFulfillmentApiError("FULFILLMENT_RESULT_UNKNOWN"));
    expect(h.attemptStore.clear).not.toHaveBeenCalled();
  }
});

test("rejects response/status contradictions and preserves the attempt for recovery", async () => {
  const h = harness([response(201, checkedIn)]);
  await expect(h.source.checkIn({ kind: "checkIn", venueId: page.venue.id, orderId: checkedIn.id, idempotencyKey: "wrong-status-key-0001" }))
    .rejects.toEqual(new VenueFulfillmentApiError("FULFILLMENT_RESULT_UNKNOWN"));
  expect(h.attemptStore.clear).not.toHaveBeenCalled();
});

test("a missing session logs in before a read and only once", async () => {
  const h = harness([response(200, session), response(200, page)], false);
  await h.source.listOrders(page.venue.id);
  expect(h.identity.login).toHaveBeenCalledTimes(1);
  expect(h.calls.map(({ path }) => path)).toEqual(["/api/v1/auth/wechat/session", `/api/v1/venues/${page.venue.id}/fulfillment/orders?limit=20`]);
});
