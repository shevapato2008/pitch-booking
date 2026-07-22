import { expect, jest, test } from "@jest/globals";

import {
  productionMedia,
  productionNative,
  productionTransport,
} from "./production";

test("uses an eight-second GET request and returns response data", async () => {
  const request = jest.fn((options: WechatMiniprogram.RequestOption) => {
    options.success?.({ data: { ok: true }, statusCode: 200, header: {}, cookies: [] } as unknown as WechatMiniprogram.RequestSuccessCallbackResult);
    return {} as WechatMiniprogram.RequestTask;
  });
  setWx({ request });

  await expect(productionTransport("https://api.example").get("/venues/primary"))
    .resolves.toEqual({ ok: true });
  expect(request).toHaveBeenCalledWith(expect.objectContaining({
    url: "https://api.example/venues/primary",
    method: "GET",
    timeout: 8000,
  }));
});

test("delegates native capabilities and preserves media sources", async () => {
  const openLocation = jest.fn((options: WechatMiniprogram.OpenLocationOption) => {
    options.success?.({ errMsg: "openLocation:ok" });
  });
  const makePhoneCall = jest.fn((options: WechatMiniprogram.MakePhoneCallOption) => {
    options.success?.({ errMsg: "makePhoneCall:ok" });
  });
  setWx({ openLocation, makePhoneCall });

  await expect(productionNative.openLocation({
    latitude: 39,
    longitude: 117,
    name: "球场",
    address: "天津",
  })).resolves.toBeUndefined();
  await expect(productionNative.makePhoneCall("02212345678")).resolves.toBeUndefined();
  expect(productionMedia.resolve("COVER", "https://example.test/cover.jpg"))
    .toBe("https://example.test/cover.jpg");
});

function setWx(value: Record<string, unknown>): void {
  (globalThis as typeof globalThis & { wx: WechatMiniprogram.Wx }).wx = value as unknown as WechatMiniprogram.Wx;
}
