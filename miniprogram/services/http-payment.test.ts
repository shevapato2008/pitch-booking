import { beforeEach, describe, expect, jest, test } from "@jest/globals";

import type { WeChatIdentityCapability } from "../runtime/interfaces";
import type { SessionStore } from "./session-store";
import {
  createHttpPaymentDataSource,
  PaymentApiError,
  type PaymentTransport,
} from "./http-payment";

const pendingOrder = jest.requireActual<Record<string, unknown>>("../../contracts/examples/order-pending.json");
const confirmedOrder = jest.requireActual<Record<string, unknown>>("../../contracts/examples/order-confirmed.json");
const paymentPrepay = jest.requireActual<Record<string, unknown>>("../../contracts/examples/payment-prepay-created.json");
const paymentConfirming = jest.requireActual<Record<string, unknown>>("../../contracts/examples/payment-confirming.json");
const session = jest.requireActual<Record<string, unknown>>("../../contracts/examples/wechat-session.json");

interface Call {
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
}

function httpError(statusCode: number, data: unknown) {
  return { code: "HTTP_ERROR" as const, statusCode, data };
}

function response(statusCode: number, data: unknown) {
  return { statusCode, data };
}

function harness(
  responses: Array<unknown | Error | ReturnType<typeof httpError>>,
  initialSession: "present" | "missing" = "present",
) {
  const calls: Call[] = [];
  let stored = initialSession === "present"
    ? { token: "old-token", expiresAt: "2099-01-01T00:00:00Z" }
    : null as { token: string; expiresAt: string } | null;
  const next = async () => {
    const value = responses.shift();
    if (value instanceof Error || (typeof value === "object" && value !== null && "code" in value)) throw value;
    return value;
  };
  const transport: PaymentTransport = {
    get: async <T>() => await next() as T,
    post: async <T>() => await next() as T,
    requestWithStatus: async <T>(
      method: "GET" | "POST",
      path: string,
      body: unknown,
      headers?: Readonly<Record<string, string>>,
    ) => {
      calls.push({ method, path, body, headers });
      return await next() as { readonly statusCode: number; readonly data: T };
    },
  };
  const sessionStore: SessionStore = {
    load: () => stored,
    save: (value) => { stored = value; },
    clear: () => { stored = null; },
  };
  const identity: WeChatIdentityCapability = { login: jest.fn(async () => ({ code: "login-code" })) };
  return {
    calls, identity,
    source: createHttpPaymentDataSource({ transport, sessionStore, identity }),
  };
}

describe("HTTP payment data source", () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test("creates prepay with Bearer and the original idempotency key", async () => {
    const testHarness = harness([response(201, paymentPrepay)]);
    await expect(testHarness.source.createPayment("order-1", "unchanged-key-1234"))
      .resolves.toMatchObject({ outcome: "PREPAY_CREATED" });
    expect(testHarness.calls).toEqual([{
      method: "POST", path: "/api/v1/orders/order-1/pay", body: undefined,
      headers: { Authorization: "Bearer old-token", "Idempotency-Key": "unchanged-key-1234" },
    }]);
  });

  test("decodes confirming and already-confirmed create results without inventing authority", async () => {
    const confirming = harness([response(202, paymentConfirming)]);
    await expect(confirming.source.createPayment("order-1", "confirming-key-1"))
      .resolves.toMatchObject({ outcome: "PAYMENT_CONFIRMING", order: { status: "PENDING_PAYMENT" } });

    const already = harness([response(200, {
      order_id: confirmedOrder.id,
      status: "ALREADY_CONFIRMED",
      order: confirmedOrder,
    })]);
    await expect(already.source.createPayment("order-1", "confirmed-key-12"))
      .resolves.toMatchObject({ outcome: "ALREADY_CONFIRMED", order: { status: "CONFIRMED" } });
  });

  test("reconciles confirming and terminal responses and gets authoritative orders", async () => {
    const testHarness = harness([
      response(202, paymentConfirming),
      response(200, confirmedOrder),
      response(200, pendingOrder),
    ]);
    await expect(testHarness.source.reconcilePayment("order-1", "payment-1"))
      .resolves.toMatchObject({ outcome: "PAYMENT_CONFIRMING" });
    await expect(testHarness.source.reconcilePayment("order-1", "payment-1"))
      .resolves.toMatchObject({ outcome: "TERMINAL", order: { status: "CONFIRMED" } });
    await expect(testHarness.source.getOrder("order-1"))
      .resolves.toMatchObject({ status: "PENDING_PAYMENT", paymentState: null });
    expect(testHarness.calls.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "POST /api/v1/orders/order-1/payments/payment-1/reconcile",
      "POST /api/v1/orders/order-1/payments/payment-1/reconcile",
      "GET /api/v1/orders/order-1",
    ]);
  });

  test("retries one 401 after login with the same idempotency key", async () => {
    const authError = httpError(401, {
      error: { code: "AUTH_REQUIRED", message: "auth", request_id: "r", details: {} },
    });
    const testHarness = harness([authError, response(200, session), response(201, paymentPrepay)]);
    await expect(testHarness.source.createPayment("order-1", "stable-key-12345"))
      .resolves.toMatchObject({ outcome: "PREPAY_CREATED" });
    expect(testHarness.identity.login).toHaveBeenCalledTimes(1);
    expect(testHarness.calls[1]).toMatchObject({
      method: "POST", path: "/api/v1/auth/wechat/session", body: { code: "login-code" },
    });
    expect(testHarness.calls[2]?.headers).toEqual({
      Authorization: `Bearer ${String(session.session_token)}`,
      "Idempotency-Key": "stable-key-12345",
    });
  });

  test("never retries authentication more than once", async () => {
    const authError = httpError(401, {
      error: { code: "AUTH_REQUIRED", message: "auth", request_id: "r", details: {} },
    });
    const testHarness = harness([authError, response(200, session), authError]);
    await expect(testHarness.source.createPayment("order-1", "stable-key-12345"))
      .rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(testHarness.identity.login).toHaveBeenCalledTimes(1);
    expect(testHarness.calls.filter(({ path }) => path.endsWith("/pay"))).toHaveLength(2);
  });

  test("exchanges a missing session once before create and preserves the idempotency key", async () => {
    const testHarness = harness([response(200, session), response(201, paymentPrepay)], "missing");
    await expect(testHarness.source.createPayment("order-1", "missing-session-key"))
      .resolves.toMatchObject({ outcome: "PREPAY_CREATED" });
    expect(testHarness.identity.login).toHaveBeenCalledTimes(1);
    expect(testHarness.calls.map(({ path }) => path)).toEqual([
      "/api/v1/auth/wechat/session",
      "/api/v1/orders/order-1/pay",
    ]);
    expect(testHarness.calls[1]?.headers).toEqual({
      Authorization: `Bearer ${String(session.session_token)}`,
      "Idempotency-Key": "missing-session-key",
    });
  });

  test("does not perform a second exchange when the request after missing-session recovery returns 401", async () => {
    const authError = httpError(401, {
      error: { code: "AUTH_REQUIRED", message: "auth", request_id: "r", details: {} },
    });
    const testHarness = harness([response(200, session), authError], "missing");
    await expect(testHarness.source.createPayment("order-1", "one-recovery-key"))
      .rejects.toEqual(new PaymentApiError("AUTH_REQUIRED"));
    expect(testHarness.identity.login).toHaveBeenCalledTimes(1);
    expect(testHarness.calls.filter(({ path }) => path.endsWith("/pay"))).toHaveLength(1);
  });

  test("shares one in-flight exchange across concurrent missing-session reads", async () => {
    const testHarness = harness([
      response(200, session),
      response(200, pendingOrder),
      response(200, pendingOrder),
    ], "missing");
    await expect(Promise.all([
      testHarness.source.getOrder("order-1"),
      testHarness.source.getOrder("order-2"),
    ])).resolves.toHaveLength(2);
    expect(testHarness.identity.login).toHaveBeenCalledTimes(1);
    expect(testHarness.calls.filter(({ path }) => path.endsWith("/auth/wechat/session"))).toHaveLength(1);
  });

  test("hides every 404 and treats unverified network or server failures conservatively", async () => {
    const hidden = harness([httpError(404, { private: "must-not-decode" })]);
    await expect(hidden.source.getOrder("secret-order"))
      .rejects.toEqual(new PaymentApiError("ORDER_NOT_FOUND"));

    const network = harness([{ code: "NETWORK_ERROR", errMsg: "socket" } as unknown as ReturnType<typeof httpError>]);
    await expect(network.source.createPayment("order-1", "network-key-1234"))
      .rejects.toEqual(new PaymentApiError("PAYMENT_RESULT_UNKNOWN"));

    const server = harness([httpError(500, { unexpected: true })]);
    await expect(server.source.reconcilePayment("order-1", "payment-1"))
      .rejects.toEqual(new PaymentApiError("PAYMENT_RESULT_UNKNOWN"));
  });

  test("preserves a verified definitive provider rejection", async () => {
    const rejected = harness([httpError(503, {
      error: { code: "PAYMENT_CREATE_FAILED", message: "no", request_id: "r", details: {} },
    })]);
    await expect(rejected.source.createPayment("order-1", "rejected-key-123"))
      .rejects.toEqual(new PaymentApiError("PAYMENT_CREATE_FAILED"));
  });

  test("rejects a definitive payment failure forged onto an undeclared 409 status", async () => {
    const forged = harness([httpError(409, {
      error: { code: "PAYMENT_CREATE_FAILED", message: "fake", request_id: "r", details: {} },
    })]);
    await expect(forged.source.createPayment("order-1", "forged-key-1234"))
      .rejects.toMatchObject({ code: "INVALID_API_RESPONSE" });
  });

  test("binds each successful payment body to its declared HTTP status", async () => {
    await expect(harness([response(200, paymentConfirming)]).source.createPayment("o", "status-key-12345"))
      .rejects.toMatchObject({ code: "INVALID_API_RESPONSE" });
    await expect(harness([response(202, paymentPrepay)]).source.createPayment("o", "status-key-12345"))
      .rejects.toMatchObject({ code: "INVALID_API_RESPONSE" });
    await expect(harness([response(201, paymentConfirming)]).source.createPayment("o", "status-key-12345"))
      .rejects.toMatchObject({ code: "INVALID_API_RESPONSE" });
    await expect(harness([response(200, paymentConfirming)]).source.reconcilePayment("o", "p"))
      .rejects.toMatchObject({ code: "INVALID_API_RESPONSE" });
    await expect(harness([response(202, confirmedOrder)]).source.reconcilePayment("o", "p"))
      .rejects.toMatchObject({ code: "INVALID_API_RESPONSE" });
  });

  test("accepts a replayed 200 prepay and a CLOSED/EXPIRED 200 reconciliation", async () => {
    await expect(harness([response(200, paymentPrepay)]).source.createPayment("o", "replay-key-12345"))
      .resolves.toMatchObject({ outcome: "PREPAY_CREATED" });
    await expect(harness([response(200, {
      ...jest.requireActual<Record<string, unknown>>("../../contracts/examples/order-expired.json"),
      payment_state: "CLOSED",
    })]).source.reconcilePayment("o", "p"))
      .resolves.toMatchObject({ outcome: "TERMINAL", order: { status: "EXPIRED", paymentState: "CLOSED" } });
  });

  test("does not let forged 5xx bodies trigger login or definitive authority", async () => {
    const forgedAuth = harness([httpError(500, {
      error: { code: "AUTH_REQUIRED", message: "fake", request_id: "r", details: {} },
    })]);
    await expect(forgedAuth.source.createPayment("o", "forged-key-1234"))
      .rejects.toEqual(new PaymentApiError("PAYMENT_RESULT_UNKNOWN"));
    expect(forgedAuth.identity.login).not.toHaveBeenCalled();

    const forgedFailure = harness([httpError(500, {
      error: { code: "PAYMENT_CREATE_FAILED", message: "fake", request_id: "r", details: {} },
    })]);
    await expect(forgedFailure.source.createPayment("o", "forged-key-1234"))
      .rejects.toEqual(new PaymentApiError("PAYMENT_RESULT_UNKNOWN"));
  });

  test.each(["create", "reconcile", "get"] as const)("hides 404 for %s", async (operation) => {
    const hidden = harness([httpError(404, {
      error: { code: "PAYMENT_CREATE_FAILED", message: "private", request_id: "r", details: {} },
    })]);
    const pending = operation === "create"
      ? hidden.source.createPayment("secret", "hidden-key-12345")
      : operation === "reconcile"
        ? hidden.source.reconcilePayment("secret", "payment")
        : hidden.source.getOrder("secret");
    await expect(pending).rejects.toEqual(new PaymentApiError("ORDER_NOT_FOUND"));
  });
});
