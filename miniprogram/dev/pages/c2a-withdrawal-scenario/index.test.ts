/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */

import { beforeEach, expect, jest, test } from "@jest/globals";

import { c2aRegistrationWithdrawalStore } from "../../c2a-registration-withdrawal-fixture";

interface Definition {
  data: Record<string, any>;
  onLoad(): void;
  onOpenScenario(event: { currentTarget?: { dataset?: { scenario?: unknown } } }): void;
  onHeaderBack(): void;
}

let captured: Definition | undefined;
const loadPage = () => {
  if (!captured) {
    (globalThis as any).Page = (definition: Definition) => { captured = definition; };
    jest.requireActual("./index");
  }
  return { ...captured!, data: { ...captured!.data }, setData(patch: Record<string, unknown>) { Object.assign(this.data, patch); } } as Definition & { setData(patch: Record<string, unknown>): void };
};

beforeEach(() => {
  c2aRegistrationWithdrawalStore.reset("JOINED_LATE");
  (globalThis as any).wx = {
    getWindowInfo: jest.fn(() => ({ windowWidth: 375, statusBarHeight: 44 })),
    getMenuButtonBoundingClientRect: jest.fn(() => ({ top: 48, bottom: 80, left: 278, right: 365, width: 87, height: 32 })),
    navigateTo: jest.fn(), navigateBack: jest.fn(), reLaunch: jest.fn(),
  };
  (globalThis as any).getCurrentPages = jest.fn(() => [{}]);
});

test("exposes the five approved C2a launch states and reads header geometry", () => {
  const page = loadPage();
  page.onLoad();
  expect(page.data).toMatchObject({ headerTopPx: 44, headerRowHeightPx: 44 });
  expect(page.data.scenarios.map(({ scenario }: { scenario: string }) => scenario)).toEqual([
    "APPLIED", "JOINED_EARLY", "JOINED_LATE", "WITHDRAWN", "RESULT_UNKNOWN",
  ]);
});

test.each(["APPLIED", "JOINED_EARLY", "JOINED_LATE", "WITHDRAWN", "RESULT_UNKNOWN"] as const)(
  "%s resets the isolated store and opens its thin list",
  (scenario) => {
    const page = loadPage();
    c2aRegistrationWithdrawalStore.setListScrollTop(520);
    page.onOpenScenario({ currentTarget: { dataset: { scenario } } });
    expect(c2aRegistrationWithdrawalStore.current()).toMatchObject({ scenario, listScrollTop: 0 });
    expect(wx.navigateTo).toHaveBeenCalledWith({ url: "/dev/pages/c2a-my-registrations/index" });
  },
);

test("unknown state is inert and header back uses history or real intent entry", () => {
  const page = loadPage();
  page.onOpenScenario({ currentTarget: { dataset: { scenario: "UNKNOWN" } } });
  expect(wx.navigateTo).not.toHaveBeenCalled();
  page.onHeaderBack();
  expect(wx.reLaunch).toHaveBeenCalledWith({ url: "/pages/intent-entry/index" });
  (getCurrentPages as unknown as jest.Mock).mockReturnValue([{}, {}]);
  page.onHeaderBack();
  expect(wx.navigateBack).toHaveBeenCalledWith({ delta: 1 });
});
