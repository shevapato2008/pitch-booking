import { expect, jest, test } from "@jest/globals";

import {
  createProductionIdentity,
  productionIdentity,
  productionMedia,
  productionNative,
  productionPayment,
  productionPhone,
  productionSessionStorage,
  productionTransport,
} from "./production";

test("rejects a wx.login call that never invokes a callback", async () => {
  jest.useFakeTimers();
  try {
    setWx({ login: jest.fn(() => undefined) });
    const pending = createProductionIdentity({ timeoutMs: 50 }).login();
    const rejection = expect(pending).rejects.toMatchObject({ code: "LOGIN_FAILED" });
    await jest.advanceTimersByTimeAsync(50);
    await rejection;
  } finally {
    jest.useRealTimers();
  }
});

test("binds the single session-store boundary to synchronous wx storage", () => {
  const getStorageSync = jest.fn((key: string) => {
    void key;
    return { token: "token", expiresAt: "2099-01-01T00:00:00Z" };
  });
  const setStorageSync = jest.fn();
  const removeStorageSync = jest.fn();
  setWx({ getStorageSync, setStorageSync, removeStorageSync });

  expect(productionSessionStorage.get("session-key")).toEqual({ token: "token", expiresAt: "2099-01-01T00:00:00Z" });
  productionSessionStorage.set("session-key", { token: "next", expiresAt: "2099-02-01T00:00:00Z" });
  productionSessionStorage.remove("session-key");

  expect(getStorageSync).toHaveBeenCalledWith("session-key");
  expect(setStorageSync).toHaveBeenCalledWith("session-key", { token: "next", expiresAt: "2099-02-01T00:00:00Z" });
  expect(removeStorageSync).toHaveBeenCalledWith("session-key");
});

test("normalizes wx.login and getPhoneNumber event codes and rejects failure or empty codes", async () => {
  const login = jest.fn((options: WechatMiniprogram.LoginOption) => options.success?.({ code: "login-code", errMsg: "login:ok" }));
  setWx({ login });
  await expect(productionIdentity.login()).resolves.toEqual({ code: "login-code" });
  expect(productionPhone.normalizeEvent({ code: "phone-code", errMsg: "getPhoneNumber:ok" }))
    .toEqual({ code: "phone-code" });
  expect(() => productionPhone.normalizeEvent({ code: "", errMsg: "getPhoneNumber:ok" }))
    .toThrow("PHONE_REJECTED");
  expect(() => productionPhone.normalizeEvent({ code: "phone-code", errMsg: "getPhoneNumber:fail user deny" }))
    .toThrow("PHONE_REJECTED");
  expect(() => productionPhone.normalizeEvent({ code: "phone-code", errMsg: "getPhoneNumber:ok forged-suffix" }))
    .toThrow("PHONE_REJECTED");
  expect(() => productionPhone.normalizeEvent({ code: "x".repeat(257), errMsg: "getPhoneNumber:ok" }))
    .toThrow("PHONE_REJECTED");
  expect(productionPhone.normalizeEvent({ code: "x".repeat(256), errMsg: "getPhoneNumber:ok" }))
    .toEqual({ code: "x".repeat(256) });

  const failedLogin = jest.fn((options: WechatMiniprogram.LoginOption) => options.fail?.({ errMsg: "login:fail", errno: -1 }));
  setWx({ login: failedLogin });
  await expect(productionIdentity.login()).rejects.toMatchObject({ code: "LOGIN_FAILED" });
});

test("uses an eight-second GET request and resolves only 2xx response data", async () => {
  const request = captureRequest();
  const response = productionTransport("https://api.example").get("/venues/primary");
  request.options.success?.(requestResult(204, { ok: true }));

  await expect(response).resolves.toEqual({ ok: true });
  expect(request.call).toHaveBeenCalledWith(expect.objectContaining({
    url: "https://api.example/venues/primary",
    method: "GET",
    timeout: 8000,
  }));
});

test("forwards GET headers and POST body/headers through the frozen transport boundary", async () => {
  const getRequest = captureRequest();
  const transport = productionTransport("https://api.example");
  const getResponse = transport.get("/resource", { Authorization: "Bearer token" });
  getRequest.options.success?.(requestResult(200, { method: "get" }));
  await expect(getResponse).resolves.toEqual({ method: "get" });
  expect(getRequest.call).toHaveBeenCalledWith(expect.objectContaining({
    method: "GET",
    header: { Authorization: "Bearer token" },
  }));

  const postRequest = captureRequest();
  const postResponse = transport.post("/resource", { code: "one-time" }, { "Idempotency-Key": "key-1" });
  postRequest.options.success?.(requestResult(201, { method: "post" }));
  await expect(postResponse).resolves.toEqual({ method: "post" });
  expect(postRequest.call).toHaveBeenCalledWith(expect.objectContaining({
    method: "POST",
    data: { code: "one-time" },
    header: { "Idempotency-Key": "key-1" },
  }));
});

test.each([400, 404, 500, 503])("normalizes HTTP %i responses", async (statusCode) => {
  const request = captureRequest();
  const response = productionTransport("https://api.example").get("/resource");
  request.options.success?.(requestResult(statusCode, { error: "body" }));

  await expect(response).rejects.toEqual({ code: "HTTP_ERROR", statusCode, data: { error: "body" } });
});

test.each([
  ["request:fail timeout", "REQUEST_TIMEOUT"],
  ["request:fail socket closed", "NETWORK_ERROR"],
])("normalizes wx failure %s", async (errMsg, code) => {
  const request = captureRequest();
  const response = productionTransport("https://api.example").get("/resource");
  request.options.fail?.({ errMsg } as unknown as WechatMiniprogram.RequestFailCallbackErr);

  await expect(response).rejects.toEqual({ code, errMsg });
});

test("ignores fail after success", async () => {
  const request = captureRequest();
  const response = productionTransport("https://api.example").get("/resource");
  request.options.success?.(requestResult(200, { ok: true }));
  request.options.fail?.({ errMsg: "request:fail timeout" } as unknown as WechatMiniprogram.RequestFailCallbackErr);

  await expect(response).resolves.toEqual({ ok: true });
});

test("ignores success after fail", async () => {
  const request = captureRequest();
  const response = productionTransport("https://api.example").get("/resource");
  request.options.fail?.({ errMsg: "request:fail socket closed" } as unknown as WechatMiniprogram.RequestFailCallbackErr);
  request.options.success?.(requestResult(200, { ok: true }));

  await expect(response).rejects.toEqual({ code: "NETWORK_ERROR", errMsg: "request:fail socket closed" });
});

test("forwards native capability arguments exactly and preserves media sources", async () => {
  let openOptions: WechatMiniprogram.OpenLocationOption | undefined;
  let phoneOptions: WechatMiniprogram.MakePhoneCallOption | undefined;
  const openLocation = jest.fn((options: WechatMiniprogram.OpenLocationOption) => {
    openOptions = options;
    options.success?.({ errMsg: "openLocation:ok" });
  });
  const makePhoneCall = jest.fn((options: WechatMiniprogram.MakePhoneCallOption) => {
    phoneOptions = options;
    options.success?.({ errMsg: "makePhoneCall:ok" });
  });
  setWx({ openLocation, makePhoneCall });

  const location = { latitude: 39, longitude: 117, name: "球场", address: "天津" };
  await expect(productionNative.openLocation(location)).resolves.toBeUndefined();
  await expect(productionNative.makePhoneCall("02212345678")).resolves.toBeUndefined();
  expect(openOptions).toEqual(expect.objectContaining(location));
  expect(phoneOptions).toEqual(expect.objectContaining({ phoneNumber: "02212345678" }));
  expect(productionMedia.resolve("COVER", "https://example.test/cover.jpg"))
    .toBe("https://example.test/cover.jpg");
});

test("normalizes wx.requestPayment success without manufacturing order authority", async () => {
  const requestPayment = jest.fn((options: WechatMiniprogram.RequestPaymentOption) => {
    options.success?.({ errMsg: "requestPayment:ok" });
  });
  setWx({ requestPayment });
  const params = {
    timeStamp: "1785146640", nonceStr: "nonce", package: "prepay_id=one",
    signType: "RSA" as const, paySign: "signature",
  };
  await expect(productionPayment.requestPayment(params)).resolves.toEqual({ outcome: "cashier_success" });
  expect(requestPayment).toHaveBeenCalledWith(expect.objectContaining(params));
  expect(await productionPayment.requestPayment(params)).not.toHaveProperty("order");
});

test.each([
  ["requestPayment:fail cancel", { outcome: "user_cancelled" }],
  ["requestPayment:fail cancel extra", { outcome: "launch_failed", message: "支付调起失败，请重试。" }],
  ["requestPayment:fail system error", { outcome: "launch_failed", message: "支付调起失败，请重试。" }],
] as const)("normalizes exact requestPayment failure %s", async (errMsg, expected) => {
  setWx({
    requestPayment(options: WechatMiniprogram.RequestPaymentOption) {
      options.fail?.({ errMsg } as Parameters<NonNullable<typeof options.fail>>[0]);
    },
  });
  await expect(productionPayment.requestPayment({
    timeStamp: "1", nonceStr: "n", package: "prepay_id=p", signType: "RSA", paySign: "s",
  })).resolves.toEqual(expected);
});

function captureRequest() {
  let options: WechatMiniprogram.RequestOption | undefined;
  const call = jest.fn((input: WechatMiniprogram.RequestOption) => {
    options = input;
    return {} as WechatMiniprogram.RequestTask;
  });
  setWx({ request: call });
  return {
    call,
    get options() {
      if (!options) throw new Error("REQUEST_NOT_CAPTURED");
      return options;
    },
  };
}

function requestResult(statusCode: number, data: unknown): WechatMiniprogram.RequestSuccessCallbackResult {
  return { statusCode, data } as unknown as WechatMiniprogram.RequestSuccessCallbackResult;
}

function setWx(value: Record<string, unknown>): void {
  (globalThis as typeof globalThis & { wx: WechatMiniprogram.Wx }).wx = value as unknown as WechatMiniprogram.Wx;
}
