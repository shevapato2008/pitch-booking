/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

import {
  createWeChatWaitlistPromotionSubscriptionCapability,
  getWaitlistPromotionSubscriptionCapabilityOrUndefined,
  registerWaitlistPromotionSubscriptionCapability,
  resetWaitlistPromotionSubscriptionCapabilityForTesting,
} from "./open-game-notification-subscription";

const TEMPLATE_ID = "zun-LzcQyW-edafCVvzPkK4de2Rllr1fFpw2A_x0oXE";

beforeEach(() => {
  resetWaitlistPromotionSubscriptionCapabilityForTesting();
  (globalThis as any).wx = { requestSubscribeMessage: jest.fn() };
});

describe("WeChat waitlist promotion subscription capability", () => {
  test.each([
    "accept",
    "acceptWithAlert",
    "acceptWithAudio",
    "acceptWithForcePush",
  ])("maps %s to ACCEPTED and sends exactly one closed template list", async (decision) => {
    (wx.requestSubscribeMessage as unknown as jest.Mock).mockImplementation((options: any) => {
      options.success({ errMsg: "requestSubscribeMessage:ok", [TEMPLATE_ID]: decision });
    });
    const capability = createWeChatWaitlistPromotionSubscriptionCapability(TEMPLATE_ID);

    await expect(capability.request()).resolves.toBe("ACCEPTED");

    expect(wx.requestSubscribeMessage).toHaveBeenCalledTimes(1);
    expect(wx.requestSubscribeMessage).toHaveBeenCalledWith({
      tmplIds: [TEMPLATE_ID],
      success: expect.any(Function),
      fail: expect.any(Function),
    });
  });

  test.each(["reject", "ban", "filter", "unexpected"])(
    "maps %s to DECLINED without exposing the raw response",
    async (decision) => {
      (wx.requestSubscribeMessage as unknown as jest.Mock).mockImplementation((options: any) => {
        options.success({ errMsg: "requestSubscribeMessage:ok", [TEMPLATE_ID]: decision });
      });

      await expect(
        createWeChatWaitlistPromotionSubscriptionCapability(TEMPLATE_ID).request(),
      ).resolves.toBe("DECLINED");
    },
  );

  test("maps native failure and synchronous throw to UNAVAILABLE", async () => {
    (wx.requestSubscribeMessage as unknown as jest.Mock).mockImplementationOnce((options: any) => {
      options.fail({ errCode: 10002, errMsg: "sensitive native detail" });
    });
    const failed = createWeChatWaitlistPromotionSubscriptionCapability(TEMPLATE_ID);
    await expect(failed.request()).resolves.toBe("UNAVAILABLE");

    (wx.requestSubscribeMessage as unknown as jest.Mock).mockImplementationOnce(() => {
      throw new Error("sensitive native detail");
    });
    const threw = createWeChatWaitlistPromotionSubscriptionCapability(TEMPLATE_ID);
    await expect(threw.request()).resolves.toBe("UNAVAILABLE");
  });

  test("returns a distinct timeout and ignores callbacks after the first settlement", async () => {
    jest.useFakeTimers();
    let options: any;
    (wx.requestSubscribeMessage as unknown as jest.Mock).mockImplementation((value: any) => {
      options = value;
    });
    const capability = createWeChatWaitlistPromotionSubscriptionCapability(
      TEMPLATE_ID,
      { timeoutMs: 25 },
    );

    const result = capability.request();
    jest.advanceTimersByTime(25);
    await expect(result).resolves.toBe("TIMED_OUT");
    options.success({ errMsg: "requestSubscribeMessage:ok", [TEMPLATE_ID]: "accept" });
    options.fail({ errCode: 10003, errMsg: "late failure" });
    await expect(result).resolves.toBe("TIMED_OUT");
    jest.useRealTimers();
  });

  test("rejects malformed template IDs before native IO", () => {
    for (const templateId of ["", " leading", "contains space", "x".repeat(129)]) {
      expect(() => createWeChatWaitlistPromotionSubscriptionCapability(templateId)).toThrow(
        "WAITLIST_PROMOTION_TEMPLATE_ID_INVALID",
      );
    }
    expect(wx.requestSubscribeMessage).not.toHaveBeenCalled();
  });
});

test("registry is explicit and resettable", () => {
  expect(getWaitlistPromotionSubscriptionCapabilityOrUndefined()).toBeUndefined();
  const capability = createWeChatWaitlistPromotionSubscriptionCapability(TEMPLATE_ID);
  registerWaitlistPromotionSubscriptionCapability(capability);
  expect(getWaitlistPromotionSubscriptionCapabilityOrUndefined()).toBe(capability);
  resetWaitlistPromotionSubscriptionCapabilityForTesting();
  expect(getWaitlistPromotionSubscriptionCapabilityOrUndefined()).toBeUndefined();
});
