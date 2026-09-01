/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any -- dynamic Mini Program Page harness */

import { beforeEach, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";

import type { VenueOnboardingDataSource } from "../../services/venue-onboarding";
import {
  registerVenueOnboardingDataSource,
  resetVenueOnboardingBindingsForTesting,
} from "../../services/venue-onboarding";

type RuntimePage = Record<string, any> & { data: Record<string, any>; setData(patch: Record<string, unknown>): void };
let definition: Record<string, any> | undefined;
const token = "Wm8Lk3R6uQ2pV9sH7xTa4bNcE5fG1jK0dZyR3qP6uQx";
const invitation = {
  viewerState: "AVAILABLE" as const,
  venue: {
    venueId: "20000000-0000-4000-8000-000000000002",
    name: "天津海河东体育中心足球场",
    districtName: "河东区",
    address: "天津市河东区津塘路156号院内东侧",
  },
  expiresAt: "2026-09-08T13:18:00Z",
  applicationId: null,
  version: 1,
};

function source(): VenueOnboardingDataSource {
  return {
    login: jest.fn(async () => ({ userId: "user", maskedPhone: "138****0000", contactName: "张三" })),
    authorizePhone: jest.fn(async () => ({ maskedPhone: "138****0000" })),
    searchCandidates: jest.fn(async () => ({ items: [], nextCursor: null })),
    listApplications: jest.fn(async () => ({ items: [], nextCursor: null })),
    createUploadIntent: jest.fn() as never,
    completeEvidence: jest.fn() as never,
    submitClaim: jest.fn() as never,
    submitCreate: jest.fn() as never,
    readInvitation: jest.fn(async () => invitation),
    acceptInvitation: jest.fn(async () => ({ ...invitation, viewerState: "CLAIMED_BY_VIEWER" as const, version: 2 })),
    submitInvitedClaim: jest.fn() as never,
  };
}

function page(): RuntimePage {
  if (!definition) {
    (globalThis as any).Page = (value: Record<string, any>) => { definition = value; };
    jest.requireActual("./index");
  }
  return {
    ...definition,
    data: structuredClone(definition!.data),
    disposed: false,
    acceptAttempt: undefined,
    setData(patch: Record<string, unknown>) { Object.assign(this.data, patch); },
  } as RuntimePage;
}

beforeEach(() => {
  jest.clearAllMocks();
  resetVenueOnboardingBindingsForTesting();
  (globalThis as any).wx = {
    getWindowInfo: jest.fn(() => ({ statusBarHeight: 59 })),
    getMenuButtonBoundingClientRect: jest.fn(() => ({ top: 63, left: 295, height: 32 })),
    hideShareMenu: jest.fn(),
    navigateTo: jest.fn(),
    navigateBack: jest.fn(),
    reLaunch: jest.fn(),
  };
});

test("loads an authenticated invitation and accepts once before opening the locked claim form", async () => {
  const api = source();
  registerVenueOnboardingDataSource(api);
  const target = page();
  await target.onLoad({ token });
  expect(target.data).toMatchObject({ mode: "ready", actionKind: "accept", venue: invitation.venue });
  await target.onPrimaryAction();
  await target.onPrimaryAction();
  expect(api.acceptInvitation).toHaveBeenCalledTimes(1);
  expect(api.acceptInvitation).toHaveBeenCalledWith(token, expect.any(String));
  expect(wx.navigateTo).toHaveBeenCalledWith({
    url: `/pages/venue-claim/index?invitation_token=${token}`,
  });
});

test("keeps opaque unavailable errors private and makes retry a real read", async () => {
  const api = source();
  (api.readInvitation as any).mockRejectedValueOnce(Object.assign(new Error("gone"), {
    code: "VENUE_INVITATION_UNAVAILABLE",
  })).mockResolvedValueOnce(invitation);
  registerVenueOnboardingDataSource(api);
  const target = page();
  await target.onLoad({ token });
  expect(target.data).toMatchObject({ mode: "unavailable", actionKind: "retry" });
  expect(JSON.stringify(target.data)).not.toMatch(/claimed_by|openid|phone/);
  await target.onPrimaryAction();
  expect(api.readInvitation).toHaveBeenCalledTimes(2);
  expect(target.data.mode).toBe("ready");
});

test("submitted viewer opens the existing application portfolio", async () => {
  const api = source();
  (api.readInvitation as any).mockResolvedValueOnce({
    ...invitation,
    viewerState: "SUBMITTED_BY_VIEWER",
    applicationId: "30000000-0000-4000-8000-000000000003",
  });
  registerVenueOnboardingDataSource(api);
  const target = page();
  await target.onLoad({ token });
  await target.onPrimaryAction();
  expect(wx.navigateTo).toHaveBeenCalledWith({ url: "/pages/venue-access/index" });
});

test("production invitation markup has no Fixture and every visible action is bound", () => {
  const markup = readFileSync("miniprogram/pages/venue-invitation/index.wxml", "utf8");
  expect(markup).toContain("bindtap=\"onPrimaryAction\"");
  expect(markup).toContain("bindtap=\"onHeaderBack\"");
  expect(markup).not.toMatch(/Fixture|模拟数据|D1a 开发预览/);
});
