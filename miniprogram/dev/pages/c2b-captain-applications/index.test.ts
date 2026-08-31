/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */

import { existsSync, readFileSync } from "node:fs";
import { beforeEach, expect, jest, test } from "@jest/globals";

const fixturePath = "miniprogram/dev/c2b-waitlist-fixture.ts";
const sourcePath = "miniprogram/dev/pages/c2b-captain-applications/index.ts";
let captured: any;

function fixture(): any {
  expect(existsSync(fixturePath)).toBe(true);
  if (!existsSync(fixturePath)) throw new Error("fixture missing");
  return jest.requireActual("../../c2b-waitlist-fixture");
}

function page(): any {
  expect(existsSync(sourcePath)).toBe(true);
  if (!existsSync(sourcePath)) throw new Error("captain page missing");
  if (!captured) {
    (globalThis as any).Page = (definition: any) => { captured = definition; };
    jest.requireActual("./index");
  }
  return { ...captured, data: { ...captured.data }, setData(patch: any) { Object.assign(this.data, patch); } };
}

beforeEach(() => {
  if (existsSync(fixturePath)) fixture().c2bWaitlistStore.reset("FULL_REVIEW");
  (globalThis as any).wx = {
    getWindowInfo: jest.fn(() => ({ windowWidth: 375, statusBarHeight: 44 })),
    getMenuButtonBoundingClientRect: jest.fn(() => ({ top: 48, bottom: 80, left: 278, right: 365, width: 87, height: 32 })),
    navigateBack: jest.fn(), redirectTo: jest.fn(),
  };
  (globalThis as any).getCurrentPages = jest.fn(() => [{ route: "dev/pages/c2b-waitlist-scenario/index" }, { route: "dev/pages/c2b-captain-applications/index" }]);
});

test("full review offers waitlist and rejection instead of a fake acceptance", () => {
  const target = page();
  target.onLoad();
  expect(target.data).toMatchObject({
    canWaitlist: true,
    canReject: true,
    hasPending: true,
    remainingSpots: 0,
    applicant: { persistedStatus: "APPLIED" },
    applicantName: "林晓雨",
    applicantAppliedAtLabel: "8月30日 19:20",
    game: { gameName: "奥体周日候补局" },
  });
  const wxml = readFileSync(sourcePath.replace(/\.ts$/, ".wxml"), "utf8");
  expect(wxml).not.toMatch(/>接受加入</);
  expect(wxml).toContain("{{applicantAppliedAtLabel}}");
  expect(wxml).not.toContain("今天 00:18");
});

test("closing confirmation preserves APPLIED and confirming appends the candidate to FIFO", () => {
  const target = page();
  target.onLoad();
  target.onWaitlist();
  expect(target.data.panel).toBe("WAITLIST");
  target.onClosePanel();
  expect(target.data.applicant.persistedStatus).toBe("APPLIED");
  target.onWaitlist();
  target.onConfirmDecision();
  expect(target.data).toMatchObject({
    panel: null,
    hasPending: false,
    applicant: { persistedStatus: "WAITLISTED", waitlistPosition: 2 },
    noticeMessage: "已加入候补，当前第 2 位。",
  });
});

test("rejection is real and return buttons use navigation", () => {
  const target = page();
  target.onLoad();
  target.onReject();
  target.onConfirmDecision();
  expect(target.data).toMatchObject({ hasPending: false, applicant: { persistedStatus: "REJECTED" } });
  target.onReturnScenario();
  expect(wx.navigateBack).toHaveBeenCalledWith({ delta: 1 });
});

test("captain page keeps centered touch, safe-area, and bound-button contracts", () => {
  const wxml = readFileSync(sourcePath.replace(/\.ts$/, ".wxml"), "utf8");
  const wxss = readFileSync(sourcePath.replace(/\.ts$/, ".wxss"), "utf8");
  for (const button of wxml.match(/<button\b[^>]*>/g) ?? []) expect(button).toMatch(/bindtap="on[A-Za-z]+"/);
  expect(wxss).toMatch(/min-height:\s*88rpx/);
  expect(wxss).toMatch(/align-items:\s*center/);
  expect(wxss).toMatch(/justify-content:\s*center/);
  expect(wxss).toMatch(/env\(safe-area-inset-bottom/);
});
