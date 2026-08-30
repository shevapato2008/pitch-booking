/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */

import { existsSync, readFileSync } from "node:fs";
import { beforeEach, expect, jest, test } from "@jest/globals";

const fixturePath = "miniprogram/dev/c2b-waitlist-fixture.ts";
const sourcePath = "miniprogram/dev/pages/c2b-waitlist-scenario/index.ts";
let captured: any;

function fixture(): any {
  expect(existsSync(fixturePath)).toBe(true);
  if (!existsSync(fixturePath)) throw new Error("fixture missing");
  return jest.requireActual("../../c2b-waitlist-fixture");
}

function page(): any {
  expect(existsSync(sourcePath)).toBe(true);
  if (!existsSync(sourcePath)) throw new Error("scenario page missing");
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
    navigateTo: jest.fn(), navigateBack: jest.fn(), reLaunch: jest.fn(),
  };
  (globalThis as any).getCurrentPages = jest.fn(() => [{}]);
});

test("launcher exposes the five bounded scenarios and reads native header geometry", () => {
  const target = page();
  target.onLoad();
  expect(target.data).toMatchObject({ headerTopPx: 44, headerRowHeightPx: 44 });
  expect(target.data.scenarios.map((item: any) => item.scenario)).toEqual([
    "FULL_REVIEW", "WAITLISTED_FIRST", "PROMOTED", "WAITLIST_WITHDRAW_CONFIRM", "BLOCKED_SUSPENDED",
  ]);
});

test.each([
  ["FULL_REVIEW", "/dev/pages/c2b-captain-applications/index"],
  ["WAITLISTED_FIRST", "/dev/pages/c2b-my-registrations/index"],
  ["PROMOTED", "/dev/pages/c2b-my-registrations/index"],
  ["WAITLIST_WITHDRAW_CONFIRM", "/dev/pages/c2b-my-registrations/index"],
  ["BLOCKED_SUSPENDED", "/dev/pages/c2b-my-registrations/index"],
] as const)("%s resets authority and opens its real preview route", (scenario, url) => {
  const target = page();
  target.onOpenScenario({ currentTarget: { dataset: { scenario } } });
  expect(fixture().c2bWaitlistStore.current()).toMatchObject({ scenario, listScrollTop: 0 });
  expect(wx.navigateTo).toHaveBeenCalledWith({ url });
});

test("unknown scenarios are inert and every visible button has a handler", () => {
  const target = page();
  target.onOpenScenario({ currentTarget: { dataset: { scenario: "UNKNOWN" } } });
  expect(wx.navigateTo).not.toHaveBeenCalled();
  const wxml = readFileSync(sourcePath.replace(/\.ts$/, ".wxml"), "utf8");
  for (const button of wxml.match(/<button\b[^>]*>/g) ?? []) expect(button).toMatch(/bindtap="on[A-Za-z]+"/);
});
