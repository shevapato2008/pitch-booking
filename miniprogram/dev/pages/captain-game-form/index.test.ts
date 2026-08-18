/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */

import { beforeEach, expect, jest, test } from "@jest/globals";
import { CAPTAIN_OPEN_GAME_FIXTURE, captainOpenGameStore } from "../../captain-open-game-fixture";

interface Definition { data: Record<string, any>; onLoad(options?: { state?: unknown }): void; onStepper(event: any): void; onSave(): void; onReturnOrder(): void; onHeaderBack(): void; }
let captured: Definition | undefined;
const loadPage = () => {
  if (!captured) {
    (globalThis as any).Page = (definition: Definition) => { captured = definition; };
    jest.requireActual("./index");
  }
  return { ...captured!, data: { ...captured!.data }, setData(patch: Record<string, unknown>) { Object.assign(this.data, patch); } } as Definition & { setData(patch: Record<string, unknown>): void };
};

beforeEach(() => { captainOpenGameStore.reset("ELIGIBLE"); (globalThis as any).wx = { getWindowInfo: jest.fn(() => ({ windowWidth: 375, statusBarHeight: 44 })), getMenuButtonBoundingClientRect: jest.fn(() => ({ top: 48, left: 278, width: 87, height: 32 })), navigateBack: jest.fn(), redirectTo: jest.fn(), reLaunch: jest.fn() }; (globalThis as any).getCurrentPages = jest.fn(() => [{}]); });

test("eligible form loads and keeps stepper errors adjacent to the changed field", () => {
  const page = loadPage();
  page.onLoad({ state: "ELIGIBLE" });
  expect(page.data).toMatchObject({ visualState: "ELIGIBLE", canEdit: true, stepperError: "", headerTopPx: 44, headerRowHeightPx: 44, headerRightInsetPx: 105, headerLeftInsetPx: 105 });
  page.data.form = { ...page.data.form, total: 12, fixed: 8, open: 4 };
  page.onStepper({ currentTarget: { dataset: { action: "total-decrease" } } });
  expect(page.data).toMatchObject({ stepperError: "计划总人数不能少于固定队员和开放名额之和" });
});

test("ineligible deep links show the reason and return to the real order", () => {
  const page = loadPage();
  page.onLoad({ state: "INELIGIBLE" });
  expect(page.data).toMatchObject({ canEdit: false, reason: "该订单当前不能用于创建开放球局", returnAction: "返回订单" });
  (getCurrentPages as unknown as jest.Mock).mockReturnValue([{}, {}]);
  page.onReturnOrder();
  expect(wx.navigateBack).toHaveBeenCalledWith({ delta: 1 });
});

test("saving a form creates a local private draft and enters deterministic management", () => {
  const page = loadPage();
  page.onLoad();
  page.onSave();
  expect(page.data).toMatchObject({ visualState: "DRAFT", private: true, published: false });
  expect(wx.redirectTo).toHaveBeenCalledWith({ url: "/dev/pages/captain-game-manage/index?state=DRAFT" });
});

test("published editing reads its current snapshot without reset and keeps the published lifecycle on save", () => {
  const edited = { ...CAPTAIN_OPEN_GAME_FIXTURE.form, name: "保留的发布编辑", total: 16, open: 5 };
  captainOpenGameStore.reset("PUBLISHED");
  captainOpenGameStore.saveDraft(edited);
  const page = loadPage();
  page.onLoad({ state: "PUBLISHED" });
  expect(page.data).toMatchObject({ mode: "edit", pageTitle: "编辑球局", form: edited });
  page.onSave();
  expect(page.data).toMatchObject({ visualState: "PUBLISHED", published: true, private: false });
  expect(wx.redirectTo).toHaveBeenCalledWith({ url: "/dev/pages/captain-game-manage/index?state=PUBLISHED" });
});

test("an old DRAFT deep link cannot roll a published form back from its current Fixture snapshot", () => {
  const published = { ...CAPTAIN_OPEN_GAME_FIXTURE.form, name: "权威已发布快照", total: 16, open: 5 };
  captainOpenGameStore.reset("PUBLISHED");
  captainOpenGameStore.saveDraft(published);
  const page = loadPage();
  page.onLoad({ state: "DRAFT" });
  expect(page.data).toMatchObject({ visualState: "PUBLISHED", mode: "edit", form: published });
  expect(captainOpenGameStore.current()).toMatchObject({ state: "PUBLISHED", snapshot: published });
});

test("an old PUBLISHED deep link cannot revive a cancelled form", () => {
  captainOpenGameStore.reset("CANCELLED");
  const page = loadPage();
  page.onLoad({ state: "PUBLISHED" });
  expect(page.data).toMatchObject({ visualState: "CANCELLED", canEdit: false });
  expect(captainOpenGameStore.current().state).toBe("CANCELLED");
});

test("saving an edit returns to the existing manager instead of pushing another manager", () => {
  captainOpenGameStore.reset("PUBLISHED");
  const page = loadPage();
  (getCurrentPages as unknown as jest.Mock).mockReturnValue([{ route: "dev/pages/captain-game-manage/index" }, { route: "dev/pages/captain-game-form/index" }]);
  page.onLoad({ state: "PUBLISHED" });
  page.onSave();
  expect(wx.navigateBack).toHaveBeenCalledWith({ delta: 1 });
  expect(wx.redirectTo).not.toHaveBeenCalled();
});

test("save result unknown stays visibly confirming and cannot submit again", () => {
  const page = loadPage();
  page.onLoad({ state: "SAVE_UNKNOWN" });
  expect(page.data).toMatchObject({ visualState: "SAVE_UNKNOWN", canEdit: false, message: "正在确认保存结果，已保留你的输入" });
  page.onSave();
  expect(wx.navigateBack).not.toHaveBeenCalled();
  expect(wx.redirectTo).not.toHaveBeenCalled();
});

test("returning an ineligible deep link falls back to my orders when no history exists", () => {
  const page = loadPage();
  page.onLoad({ state: "INELIGIBLE" });
  page.onReturnOrder();
  expect(wx.reLaunch).toHaveBeenCalledWith({ url: "/pages/my-orders/index" });
  (getCurrentPages as unknown as jest.Mock).mockReturnValue([{}, {}]);
  page.onReturnOrder();
  expect(wx.navigateBack).toHaveBeenCalledWith({ delta: 1 });
});
