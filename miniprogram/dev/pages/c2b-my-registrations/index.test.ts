/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */

import { existsSync, readFileSync } from "node:fs";
import { beforeEach, expect, jest, test } from "@jest/globals";

const fixturePath = "miniprogram/dev/c2b-waitlist-fixture.ts";
const sourcePath = "miniprogram/dev/pages/c2b-my-registrations/index.ts";
let captured: any;

function fixture(): any {
  expect(existsSync(fixturePath)).toBe(true);
  if (!existsSync(fixturePath)) throw new Error("fixture missing");
  return jest.requireActual("../../c2b-waitlist-fixture");
}

function page(): any {
  expect(existsSync(sourcePath)).toBe(true);
  if (!existsSync(sourcePath)) throw new Error("list page missing");
  if (!captured) {
    (globalThis as any).Page = (definition: any) => { captured = definition; };
    jest.requireActual("./index");
  }
  return { ...captured, data: { ...captured.data }, setData(patch: any) { Object.assign(this.data, patch); } };
}

beforeEach(() => {
  if (existsSync(fixturePath)) fixture().c2bWaitlistStore.reset("WAITLISTED_FIRST");
  (globalThis as any).wx = {
    getWindowInfo: jest.fn(() => ({ windowWidth: 375, statusBarHeight: 44 })),
    getMenuButtonBoundingClientRect: jest.fn(() => ({ top: 48, bottom: 80, left: 278, right: 365, width: 87, height: 32 })),
    navigateTo: jest.fn(), navigateBack: jest.fn(), redirectTo: jest.fn(),
  };
  (globalThis as any).getCurrentPages = jest.fn(() => [{}]);
});

test("list exposes only the current account registration and exact waitlist position", () => {
  const target = page();
  target.onLoad();
  target.onShow();
  expect(target.data).toMatchObject({ resultCount: 1, listScrollTop: 0 });
  expect(target.data.items[0]).toMatchObject({
    effectiveStatus: "WAITLISTED",
    statusLabel: "候补第 1 位",
    waitlistPosition: 1,
  });
});

test("whole card opens only its exact detail and restores scroll", () => {
  const target = page();
  target.onLoad();
  const id = fixture().c2bWaitlistStore.current().applicant.registrationId;
  target.onScroll({ detail: { scrollTop: 404.5 } });
  target.onOpenRegistration({ currentTarget: { dataset: { registrationId: id } } });
  expect(wx.navigateTo).toHaveBeenCalledWith({
    url: `/dev/pages/c2b-registration-detail/index?registrationId=${encodeURIComponent(id)}`,
  });
  target.onOpenRegistration({ currentTarget: { dataset: { registrationId: "unknown" } } });
  expect(wx.navigateTo).toHaveBeenCalledTimes(1);
  target.onShow();
  expect(target.data.listScrollTop).toBe(404.5);
});

test("promotion and withdrawal are read back from the same authority", () => {
  const target = page();
  target.onLoad();
  fixture().c2bWaitlistStore.promoteAfterJoinedExit();
  target.onShow();
  expect(target.data.items[0]).toMatchObject({ effectiveStatus: "JOINED", statusLabel: "已加入" });

  fixture().c2bWaitlistStore.reset("WAITLISTED_FIRST");
  const id = fixture().c2bWaitlistStore.current().applicant.registrationId;
  fixture().c2bWaitlistStore.openWaitlistWithdrawal(id);
  fixture().c2bWaitlistStore.confirmWaitlistWithdrawal();
  target.onShow();
  expect(target.data.items[0]).toMatchObject({ effectiveStatus: "WITHDRAWN", statusLabel: "已退出" });
});

test("registration card is the only target and all buttons are bound", () => {
  const wxml = readFileSync(sourcePath.replace(/\.ts$/, ".wxml"), "utf8");
  const cards = wxml.match(/<button[^>]+class="c2b-registration-card[^>]*>[\s\S]*?<\/button>/g) ?? [];
  expect(cards.length).toBeGreaterThan(0);
  cards.forEach((card) => {
    expect(card).toMatch(/bindtap="onOpenRegistration"/);
    expect((card.match(/<button/g) ?? []).length).toBe(1);
  });
  for (const button of wxml.match(/<button\b[^>]*>/g) ?? []) expect(button).toMatch(/bindtap="on[A-Za-z]+"/);
});
