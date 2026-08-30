/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */

import { existsSync, readFileSync } from "node:fs";
import { beforeEach, expect, jest, test } from "@jest/globals";

const fixturePath = "miniprogram/dev/c2b-waitlist-fixture.ts";
const sourcePath = "miniprogram/dev/pages/c2b-registration-detail/index.ts";
let captured: any;

function fixture(): any {
  expect(existsSync(fixturePath)).toBe(true);
  if (!existsSync(fixturePath)) throw new Error("fixture missing");
  return jest.requireActual("../../c2b-waitlist-fixture");
}

function page(): any {
  expect(existsSync(sourcePath)).toBe(true);
  if (!existsSync(sourcePath)) throw new Error("detail page missing");
  if (!captured) {
    (globalThis as any).Page = (definition: any) => { captured = definition; };
    jest.requireActual("./index");
  }
  return { ...captured, data: { ...captured.data }, setData(patch: any) { Object.assign(this.data, patch); } };
}

function loadCurrent(): any {
  const target = page();
  const id = fixture().c2bWaitlistStore.current().applicant.registrationId;
  target.onLoad({ registrationId: encodeURIComponent(id) });
  target.onShow();
  return target;
}

beforeEach(() => {
  if (existsSync(fixturePath)) fixture().c2bWaitlistStore.reset("WAITLISTED_FIRST");
  (globalThis as any).wx = {
    getWindowInfo: jest.fn(() => ({ windowWidth: 375, statusBarHeight: 44 })),
    getMenuButtonBoundingClientRect: jest.fn(() => ({ top: 48, bottom: 80, left: 278, right: 365, width: 87, height: 32 })),
    navigateBack: jest.fn(), redirectTo: jest.fn(),
  };
  (globalThis as any).getCurrentPages = jest.fn(() => [{ route: "dev/pages/c2b-registration-detail/index" }]);
});

test("waitlisted detail shows authoritative position and one honest exit action", () => {
  const target = loadCurrent();
  expect(target.data).toMatchObject({
    notFound: false,
    statusTone: "waitlisted",
    statusHeading: "候补中 · 当前第 1 位",
    showWithdrawalAction: true,
    primaryActionLabel: "退出候补",
  });
  expect(JSON.stringify(target.data)).not.toContain("已通知");
});

test("cancel preserves waitlist while confirm withdraws without changing capacity", () => {
  const target = loadCurrent();
  const before = target.data.game;
  target.onOpenWithdrawalConfirm();
  expect(target.data.showConfirmation).toBe(true);
  target.onCancelWithdrawal();
  expect(target.data.registration.effectiveStatus).toBe("WAITLISTED");
  target.onOpenWithdrawalConfirm();
  target.onConfirmWithdrawal();
  expect(target.data).toMatchObject({ showConfirmation: false, showWithdrawalAction: false });
  expect(target.data.registration).toMatchObject({ effectiveStatus: "WITHDRAWN", withdrawalKind: "WAITLIST_WITHDRAWAL" });
  expect(target.data.game).toMatchObject({ currentPlayers: before.currentPlayers, remainingSpots: before.remainingSpots });
});

test("promoted authority shows joined with no simultaneous waitlist or notification claim", () => {
  fixture().c2bWaitlistStore.reset("PROMOTED");
  const target = loadCurrent();
  expect(target.data).toMatchObject({
    statusTone: "joined",
    statusHeading: "已加入",
    showWithdrawalAction: false,
    registration: { effectiveStatus: "JOINED", waitlistPosition: null },
    game: { currentPlayers: 14, remainingSpots: 0 },
  });
  expect(target.data.statusCopy).not.toMatch(/候补中|已通知/);
});

test("suspended authority freezes promotion but still lets the candidate leave the waitlist", () => {
  fixture().c2bWaitlistStore.reset("BLOCKED_SUSPENDED");
  const target = loadCurrent();
  expect(target.data).toMatchObject({
    statusTone: "blocked",
    statusHeading: "球局暂停中",
    showWithdrawalAction: true,
    primaryActionLabel: "退出候补",
  });
  target.onOpenWithdrawalConfirm();
  expect(target.data.showConfirmation).toBe(true);
  target.onConfirmWithdrawal();
  expect(target.data).toMatchObject({
    statusTone: "neutral",
    statusHeading: "已退出候补",
    showWithdrawalAction: false,
    registration: { effectiveStatus: "WITHDRAWN" },
  });
});

test("unknown ids never fall back and detail keeps fixed-footer safety contracts", () => {
  const target = page();
  target.onLoad({ registrationId: "unknown" });
  target.onShow();
  expect(target.data).toMatchObject({ notFound: true, registration: null });
  target.onReturnList();
  expect(wx.redirectTo).toHaveBeenCalledWith({ url: "/dev/pages/c2b-my-registrations/index" });

  const wxml = readFileSync(sourcePath.replace(/\.ts$/, ".wxml"), "utf8");
  const wxss = readFileSync(sourcePath.replace(/\.ts$/, ".wxss"), "utf8");
  for (const button of wxml.match(/<button\b[^>]*>/g) ?? []) expect(button).toMatch(/bindtap="on[A-Za-z]+"/);
  expect(wxss).toMatch(/height:\s*100vh/);
  expect(wxss).toMatch(/height:\s*0[^}]*min-height:\s*0/s);
  expect(wxss).toMatch(/env\(safe-area-inset-bottom/);
  expect(wxss).toMatch(/min-height:\s*(?:88|96)rpx/);
  expect(wxss).toMatch(/align-items:\s*center/);
  expect(wxss).toMatch(/justify-content:\s*center/);
});
