/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */

import { beforeEach, expect, jest, test } from "@jest/globals";

interface Definition { data: Record<string, any>; onLoad(options?: { state?: unknown }): void; onStepper(event: any): void; onSave(): void; onReturnOrder(): void; }
let captured: Definition | undefined;
const loadPage = () => {
  if (!captured) {
    (globalThis as any).Page = (definition: Definition) => { captured = definition; };
    jest.requireActual("./index");
  }
  return { ...captured!, data: { ...captured!.data }, setData(patch: Record<string, unknown>) { Object.assign(this.data, patch); } } as Definition & { setData(patch: Record<string, unknown>): void };
};

beforeEach(() => { (globalThis as any).wx = { navigateBack: jest.fn(), redirectTo: jest.fn() }; });

test("eligible form loads and keeps stepper errors adjacent to the changed field", () => {
  const page = loadPage();
  page.onLoad({ state: "ELIGIBLE" });
  expect(page.data).toMatchObject({ visualState: "ELIGIBLE", canEdit: true, stepperError: "" });
  page.data.form = { ...page.data.form, total: 12, fixed: 8, open: 4 };
  page.onStepper({ currentTarget: { dataset: { action: "total-decrease" } } });
  expect(page.data).toMatchObject({ stepperError: "计划总人数不能少于固定队员和开放名额之和" });
});

test("ineligible deep links show the reason and return to the real order", () => {
  const page = loadPage();
  page.onLoad({ state: "INELIGIBLE" });
  expect(page.data).toMatchObject({ canEdit: false, reason: "该订单当前不能用于创建开放球局", returnAction: "返回订单" });
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
