import { expect, jest, test } from "@jest/globals";

import {
  productionMedia,
  productionNative,
  productionTransport,
} from "./production";

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
