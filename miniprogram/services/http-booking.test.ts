import { describe, expect, jest, test } from "@jest/globals";

import type { Transport, WeChatIdentityCapability, WeChatPhoneCapability } from "../runtime/interfaces";
import { createSessionStore } from "./session-store";
import { createHttpBookingDataSource } from "./http-booking";

const sessionFixture = jest.requireActual<Record<string, unknown>>("../../contracts/examples/wechat-session.json");
const phoneFixture = jest.requireActual<Record<string, unknown>>("../../contracts/examples/phone-verified.json");
const checkoutFixture = jest.requireActual<Record<string, unknown>>("../../contracts/examples/checkout-ready.json");
const orderFixture = jest.requireActual<Record<string, unknown>>("../../contracts/examples/order-pending.json");
const expiredOrderFixture = jest.requireActual<Record<string, unknown>>("../../contracts/examples/order-expired.json");
const priceChangedFixture = jest.requireActual<Record<string, unknown>>("../../contracts/examples/error-price-changed.json");

describe("HTTP booking adapter", () => {
  test("logs in, saves the decoded token and uses Bearer for subsequent calls", async () => {
    const harness = createHarness();
    harness.post.mockResolvedValueOnce(sessionFixture).mockResolvedValueOnce(phoneFixture);
    harness.get.mockResolvedValueOnce(checkoutFixture).mockResolvedValueOnce(orderFixture);

    await expect(harness.source.login()).resolves.toMatchObject({ userId: expect.any(String), maskedPhone: null });
    const rawPhoneDetail = { code: "phone-code", errMsg: "getPhoneNumber:ok" };
    await expect(harness.source.authorizePhone(rawPhoneDetail)).resolves.toEqual({ maskedPhone: "138****5678" });
    await expect(harness.source.getCheckout("slot-id")).resolves.toMatchObject({ slotId: expect.any(String) });
    await expect(harness.source.getOrder("order-id")).resolves.toMatchObject({ orderId: expect.any(String) });

    expect(harness.identity.login).toHaveBeenCalledTimes(1);
    expect(harness.phone.normalizeEvent).toHaveBeenCalledWith(rawPhoneDetail);
    expect(harness.post).toHaveBeenNthCalledWith(1, "/api/v1/auth/wechat/session", { code: "wx-login-code" }, undefined);
    expect(harness.post).toHaveBeenNthCalledWith(2, "/api/v1/auth/wechat/phone", { code: "phone-code" }, { Authorization: `Bearer ${sessionFixture.session_token}` });
    expect(harness.get).toHaveBeenNthCalledWith(1, "/api/v1/slots/slot-id/checkout", { Authorization: `Bearer ${sessionFixture.session_token}` });
    expect(harness.get).toHaveBeenNthCalledWith(2, "/api/v1/orders/order-id", { Authorization: `Bearer ${sessionFixture.session_token}` });
  });

  test("creates with only contract body plus Bearer and Idempotency-Key", async () => {
    const harness = createHarness();
    await establishSession(harness);
    harness.post.mockResolvedValueOnce(orderFixture);
    const request = { slotId: "slot-1", checkoutVersion: 12, contactName: "张三" };

    await harness.source.createOrder({ request, idempotencyKey: "stable-key-123456" });

    expect(harness.post).toHaveBeenLastCalledWith(
      "/api/v1/orders",
      { slot_id: "slot-1", checkout_version: 12, contact_name: "张三" },
      { Authorization: `Bearer ${sessionFixture.session_token}`, "Idempotency-Key": "stable-key-123456" },
    );
  });

  test("decodes every success and error response before exposing it", async () => {
    const harness = createHarness();
    await establishSession(harness);
    harness.get.mockResolvedValueOnce({ ...checkoutFixture, unexpected: true });
    await expect(harness.source.getCheckout("slot")).rejects.toMatchObject({ code: "INVALID_API_RESPONSE" });

    harness.post.mockRejectedValueOnce({ code: "HTTP_ERROR", statusCode: 409, data: priceChangedFixture });
    await expect(harness.source.createOrder({
      request: { slotId: "slot", checkoutVersion: 12, contactName: "张三" },
      idempotencyKey: "stable-key-123456",
    })).rejects.toMatchObject({ code: "PRICE_CHANGED", details: { checkout: { version: 13 } } });
  });

  test("treats an expired order returned from the create endpoint as unknown", async () => {
    const harness = createHarness();
    await establishSession(harness);
    harness.post.mockResolvedValueOnce(expiredOrderFixture);

    await expect(harness.source.createOrder({
      request: { slotId: "slot", checkoutVersion: 12, contactName: "张三" },
      idempotencyKey: "stable-key-123456",
    })).rejects.toMatchObject({ code: "SUBMISSION_RESULT_UNKNOWN" });
  });

  test.each(["NETWORK_ERROR", "REQUEST_TIMEOUT"] as const)("maps create %s to unknown result", async (code) => {
    const harness = createHarness();
    await establishSession(harness);
    harness.post.mockRejectedValueOnce({ code, errMsg: "not logged" });
    await expect(harness.source.createOrder({
      request: { slotId: "slot", checkoutVersion: 12, contactName: "张三" },
      idempotencyKey: "same-key-and-body",
    })).rejects.toMatchObject({ code: "SUBMISSION_RESULT_UNKNOWN" });
  });

  test("clears persisted session on decoded 401 before recovering", async () => {
    const harness = createHarness();
    await establishSession(harness);
    harness.get.mockRejectedValueOnce({
      code: "HTTP_ERROR", statusCode: 401,
      data: { error: { code: "AUTH_REQUIRED", message: "do not parse me", request_id: "req", details: {} } },
    }).mockResolvedValueOnce(orderFixture);
    harness.post.mockResolvedValueOnce(sessionFixture);

    await expect(harness.source.getOrder("order")).resolves.toMatchObject({ status: "PENDING_PAYMENT" });
    expect(harness.storage.remove).toHaveBeenCalled();
  });

  test("clears persisted session before strictly rejecting a malformed 401 envelope", async () => {
    const harness = createHarness();
    await establishSession(harness);
    harness.get.mockRejectedValueOnce({ code: "HTTP_ERROR", statusCode: 401, data: { malformed: true } });

    await expect(harness.source.getOrder("order")).rejects.toMatchObject({ code: "INVALID_API_RESPONSE" });
    expect(harness.storage.remove).toHaveBeenCalled();
  });

  test.each([
    [{ code: "", errMsg: "getPhoneNumber:ok" }],
    [{ code: "phone-code", errMsg: "getPhoneNumber:fail user deny" }],
  ])("normalizes and rejects invalid raw phone details before HTTP", async (rawDetail) => {
    const harness = createHarness();
    await establishSession(harness);
    harness.phone.normalizeEvent.mockImplementationOnce(() => { throw Object.assign(new Error("PHONE_REJECTED"), { code: "PHONE_REJECTED" }); });

    await expect(harness.source.authorizePhone(rawDetail)).rejects.toMatchObject({ code: "PHONE_REJECTED" });
    expect(harness.post).toHaveBeenCalledTimes(1);
  });

  test.each(["checkout", "phone", "create", "detail"] as const)(
    "refreshes one rejected session and replays the original %s operation",
    async (operation) => {
      const harness = createHarness();
      await establishSession(harness);
      const authRequired = {
        code: "HTTP_ERROR", statusCode: 401,
        data: { error: { code: "AUTH_REQUIRED", message: "expired", request_id: "req", details: {} } },
      };
      const createAttempt = {
        request: { slotId: "slot", checkoutVersion: 12, contactName: "张三" },
        idempotencyKey: "same-create-key-123",
      };

      if (operation === "checkout") {
        harness.get.mockRejectedValueOnce(authRequired).mockResolvedValueOnce(checkoutFixture);
        harness.post.mockResolvedValueOnce(sessionFixture);
        await expect(harness.source.getCheckout("slot")).resolves.toMatchObject({ version: 12 });
      } else if (operation === "detail") {
        harness.get.mockRejectedValueOnce(authRequired).mockResolvedValueOnce(orderFixture);
        harness.post.mockResolvedValueOnce(sessionFixture);
        await expect(harness.source.getOrder("order")).resolves.toMatchObject({ status: "PENDING_PAYMENT" });
      } else if (operation === "phone") {
        harness.post.mockRejectedValueOnce(authRequired).mockResolvedValueOnce(sessionFixture).mockResolvedValueOnce(phoneFixture);
        await expect(harness.source.authorizePhone({ code: "phone-code", errMsg: "getPhoneNumber:ok" }))
          .resolves.toEqual({ maskedPhone: "138****5678" });
      } else {
        harness.post.mockRejectedValueOnce(authRequired).mockResolvedValueOnce(sessionFixture).mockResolvedValueOnce(orderFixture);
        await expect(harness.source.createOrder(createAttempt)).resolves.toMatchObject({ status: "PENDING_PAYMENT" });
        const createCalls = harness.post.mock.calls.filter(([path]) => path === "/api/v1/orders");
        expect(createCalls).toHaveLength(2);
        expect(createCalls[1]).toEqual(createCalls[0]);
      }

      expect(harness.identity.login).toHaveBeenCalledTimes(2);
      expect(harness.storage.remove).toHaveBeenCalled();
    },
  );

  test("stops after a second auth rejection", async () => {
    const harness = createHarness();
    await establishSession(harness);
    const authRequired = {
      code: "HTTP_ERROR", statusCode: 401,
      data: { error: { code: "AUTH_REQUIRED", message: "expired", request_id: "req", details: {} } },
    };
    harness.get.mockRejectedValueOnce(authRequired).mockRejectedValueOnce(authRequired);
    harness.post.mockResolvedValueOnce(sessionFixture);

    await expect(harness.source.getOrder("order")).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(harness.get).toHaveBeenCalledTimes(2);
    expect(harness.identity.login).toHaveBeenCalledTimes(2);
  });

  test("shares one silent login across concurrent auth-rejected operations", async () => {
    const harness = createHarness();
    await establishSession(harness);
    const authRequired = {
      code: "HTTP_ERROR", statusCode: 401,
      data: { error: { code: "AUTH_REQUIRED", message: "expired", request_id: "req", details: {} } },
    };
    harness.get
      .mockRejectedValueOnce(authRequired)
      .mockRejectedValueOnce(authRequired)
      .mockResolvedValueOnce(checkoutFixture)
      .mockResolvedValueOnce(orderFixture);
    const refresh = deferred<unknown>();
    harness.post.mockImplementationOnce(() => refresh.promise);

    const requests = Promise.all([
      harness.source.getCheckout("slot"),
      harness.source.getOrder("order"),
    ]);
    await Promise.resolve(); await Promise.resolve();
    expect(harness.identity.login).toHaveBeenCalledTimes(2);
    refresh.resolve(sessionFixture);

    await expect(requests).resolves.toEqual([
      expect.objectContaining({ version: 12 }),
      expect.objectContaining({ status: "PENDING_PAYMENT" }),
    ]);
    expect(harness.identity.login).toHaveBeenCalledTimes(2);
  });

  test("maps a malformed create 2xx to unknown and allows exact replay", async () => {
    const harness = createHarness();
    await establishSession(harness);
    const attempt = {
      request: { slotId: "slot", checkoutVersion: 12, contactName: "张三" },
      idempotencyKey: "same-malformed-key",
    };
    harness.post.mockResolvedValueOnce({ malformed: true }).mockResolvedValueOnce(orderFixture);

    await expect(harness.source.createOrder(attempt)).rejects.toMatchObject({ code: "SUBMISSION_RESULT_UNKNOWN" });
    await expect(harness.source.createOrder(attempt)).resolves.toMatchObject({ status: "PENDING_PAYMENT" });

    const calls = harness.post.mock.calls.filter(([path]) => path === "/api/v1/orders");
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(calls[0]);
  });

  test("keeps explicit create 4xx codes but maps a decoded 5xx to unknown", async () => {
    const harness = createHarness();
    await establishSession(harness);
    const attempt = {
      request: { slotId: "slot", checkoutVersion: 12, contactName: "张三" },
      idempotencyKey: "business-outcome-key",
    };
    harness.post.mockRejectedValueOnce({
      code: "HTTP_ERROR", statusCode: 409,
      data: { error: { code: "SLOT_NOT_AVAILABLE", message: "gone", request_id: "r1", details: {} } },
    });
    await expect(harness.source.createOrder(attempt)).rejects.toMatchObject({ code: "SLOT_NOT_AVAILABLE" });

    harness.post.mockRejectedValueOnce({
      code: "HTTP_ERROR", statusCode: 500,
      data: { error: { code: "INTERNAL_ERROR", message: "failed", request_id: "r2", details: {} } },
    });
    await expect(harness.source.createOrder(attempt)).rejects.toMatchObject({ code: "SUBMISSION_RESULT_UNKNOWN" });
  });
});

function createHarness() {
  let persisted: unknown;
  const storage = {
    get: jest.fn(() => persisted),
    set: jest.fn((_key: string, value: unknown) => { persisted = value; }),
    remove: jest.fn(() => { persisted = undefined; }),
  };
  const get = jest.fn<(path: string, headers?: Readonly<Record<string, string>>) => Promise<unknown>>(
    async () => undefined,
  );
  const post = jest.fn<(
    path: string,
    body: unknown,
    headers?: Readonly<Record<string, string>>,
  ) => Promise<unknown>>(async () => undefined);
  const transport: Transport = {
    get: <T>(path: string, headers?: Readonly<Record<string, string>>) => get(path, headers) as Promise<T>,
    post: <T>(path: string, body: unknown, headers?: Readonly<Record<string, string>>) => post(path, body, headers) as Promise<T>,
    put: async <T>() => undefined as T,
  };
  const identity: WeChatIdentityCapability = { login: jest.fn(async () => ({ code: "wx-login-code" })) };
  const phone: WeChatPhoneCapability = {
    normalizeEvent: jest.fn((raw: unknown) => {
      const code = (raw as { code?: unknown }).code;
      if (typeof code !== "string" || code.length === 0) throw Object.assign(new Error("PHONE_REJECTED"), { code: "PHONE_REJECTED" });
      return { code };
    }),
  };
  const sessionStore = createSessionStore(storage, () => Date.parse("2026-07-28T00:00:00Z"));
  return {
    source: createHttpBookingDataSource({ transport, identity, phone, sessionStore }),
    identity,
    phone: phone as { normalizeEvent: jest.MockedFunction<WeChatPhoneCapability["normalizeEvent"]> },
    storage,
    get,
    post,
  };
}

async function establishSession(harness: ReturnType<typeof createHarness>) {
  harness.post.mockResolvedValueOnce(sessionFixture);
  await harness.source.login();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
