import { beforeEach, describe, expect, jest, test } from "@jest/globals";

import type { Transport, WeChatIdentityCapability } from "../runtime/interfaces";
import type { SessionStore } from "./session-store";
import { createHttpPaymentDataSource, PaymentApiError } from "./http-payment";

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

function harness(responses: Array<unknown | Error | ReturnType<typeof httpError>>) {
  const calls: Call[] = [];
  let stored = { token: "old-token", expiresAt: "2099-01-01T00:00:00Z" } as { token: string; expiresAt: string } | null;
  const next = async () => {
    const value = responses.shift();
    if (value instanceof Error || (typeof value === "object" && value !== null && "code" in value)) throw value;
    return value;
  };
  const transport: Transport = {
    get: async <T>(path: string, headers?: Readonly<Record<string, string>>) => {
      calls.push({ method: "GET", path, headers });
      return await next() as T;
    },
    post: async <T>(path: string, body: unknown, headers?: Readonly<Record<string, string>>) => {
      calls.push({ method: "POST", path, body, headers });
      return await next() as T;
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
    const testHarness = harness([paymentPrepay]);
    await expect(testHarness.source.createPayment("order-1", "unchanged-key-1234"))
      .resolves.toMatchObject({ outcome: "PREPAY_CREATED" });
    expect(testHarness.calls).toEqual([{
      method: "POST", path: "/api/v1/orders/order-1/pay", body: undefined,
      headers: { Authorization: "Bearer old-token", "Idempotency-Key": "unchanged-key-1234" },
    }]);
  });

  test("decodes confirming and already-confirmed create results without inventing authority", async () => {
    const confirming = harness([paymentConfirming]);
    await expect(confirming.source.createPayment("order-1", "confirming-key-1"))
      .resolves.toMatchObject({ outcome: "PAYMENT_CONFIRMING", order: { status: "PENDING_PAYMENT" } });

    const already = harness([{
      order_id: confirmedOrder.id,
      status: "ALREADY_CONFIRMED",
      order: confirmedOrder,
    }]);
    await expect(already.source.createPayment("order-1", "confirmed-key-12"))
      .resolves.toMatchObject({ outcome: "ALREADY_CONFIRMED", order: { status: "CONFIRMED" } });
  });

  test("reconciles confirming and terminal responses and gets authoritative orders", async () => {
    const testHarness = harness([paymentConfirming, confirmedOrder, pendingOrder]);
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
    const testHarness = harness([authError, session, paymentPrepay]);
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
    const testHarness = harness([authError, session, authError]);
    await expect(testHarness.source.createPayment("order-1", "stable-key-12345"))
      .rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(testHarness.identity.login).toHaveBeenCalledTimes(1);
    expect(testHarness.calls.filter(({ path }) => path.endsWith("/pay"))).toHaveLength(2);
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
});
