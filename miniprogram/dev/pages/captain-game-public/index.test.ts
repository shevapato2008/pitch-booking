/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */

import { beforeEach, expect, jest, test } from "@jest/globals";
import { captainOpenGameStore } from "../../captain-open-game-fixture";

interface Definition { data: Record<string, any>; onLoad(options?: { from?: unknown; state?: unknown }): void; onShow(): void; onReturnManage(): void; onHeaderBack(): void; }
let captured: Definition | undefined;
const loadPage = () => {
  if (!captured) { (globalThis as any).Page = (definition: Definition) => { captured = definition; }; jest.requireActual("./index"); }
  return { ...captured!, data: { ...captured!.data }, setData(patch: Record<string, unknown>) { Object.assign(this.data, patch); } } as Definition & { setData(patch: Record<string, unknown>): void };
};

beforeEach(() => { (globalThis as any).wx = { redirectTo: jest.fn(), reLaunch: jest.fn(), navigateBack: jest.fn() }; (globalThis as any).getCurrentPages = jest.fn(() => [{}, {}]); });

test("published public detail is readonly, has no application action, and explains that joining is forthcoming", () => {
  const page = loadPage();
  page.onLoad({ from: "PUBLISHED" });
  expect(page.data).toMatchObject({ visualState: "PUBLISHED", readonly: true, applicationAvailable: false, notice: "当前仅供查看，申请加入即将开放" });
  expect(Object.keys(page).filter((key) => /apply|join|signup/i.test(key))).toEqual([]);
});

test("return routes precisely to the manager that opened the public detail", () => {
  const page = loadPage();
  page.onLoad({ from: "DRAFT" });
  page.onReturnManage();
  expect(wx.redirectTo).toHaveBeenCalledWith({ url: "/dev/pages/captain-game-manage/index?state=DRAFT" });
});

test("an old public history entry cannot revive a cancelled published page", () => {
  const page = loadPage();
  captainOpenGameStore.reset("CANCELLED");
  page.onLoad({ from: "PUBLISHED" });
  page.onShow();
  expect(wx.reLaunch).toHaveBeenCalledWith({ url: "/dev/pages/captain-game-manage/index?state=CANCELLED" });
});
