/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */

import { beforeEach, expect, jest, test } from "@jest/globals";

import { c1bGameDiscoveryStore } from "../../c1b-game-discovery-fixture";
import { c1cMyGameRegistrationsStore } from "../../c1c-my-game-registrations-fixture";

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
  return {
    ...captured!,
    data: { ...captured!.data },
    setData(patch: Record<string, unknown>) { Object.assign(this.data, patch); },
  } as Definition & { setData(patch: Record<string, unknown>): void };
};

beforeEach(() => {
  c1bGameDiscoveryStore.reset("READY");
  c1cMyGameRegistrationsStore.reset("READY");
  (globalThis as any).wx = {
    getWindowInfo: jest.fn(() => ({ windowWidth: 375, statusBarHeight: 44 })),
    getMenuButtonBoundingClientRect: jest.fn(() => ({ top: 48, bottom: 80, left: 278, right: 365, width: 87, height: 32 })),
    navigateTo: jest.fn(),
    navigateBack: jest.fn(),
    reLaunch: jest.fn(),
  };
  (globalThis as any).getCurrentPages = jest.fn(() => [{}]);
});

test("reads header geometry and exposes exactly the four C1c preview launch states", () => {
  const page = loadPage();
  page.onLoad();

  expect(page.data).toMatchObject({ headerTopPx: 44, headerRowHeightPx: 44 });
  expect(page.data.scenarios.map(({ scenario }: { scenario: string }) => scenario)).toEqual([
    "ENTRY", "READY", "EMPTY", "LOAD_ERROR",
  ]);
});

test.each([
  ["READY", { status: "READY", sourceEmpty: false }, "/dev/pages/c1c-my-registrations/index"],
  ["EMPTY", { status: "READY", sourceEmpty: true }, "/dev/pages/c1c-my-registrations/index"],
  ["LOAD_ERROR", { status: "LOAD_ERROR", sourceEmpty: false }, "/dev/pages/c1c-my-registrations/index"],
] as const)("%s resets the C1c store and opens the registration list", (scenario, snapshot, url) => {
  const page = loadPage();
  c1cMyGameRegistrationsStore.setListScrollTop(640);

  page.onOpenScenario({ currentTarget: { dataset: { scenario } } });

  expect(c1cMyGameRegistrationsStore.current()).toMatchObject({ ...snapshot, listScrollTop: 0 });
  expect(wx.navigateTo).toHaveBeenCalledWith({ url });
});

test("ENTRY resets both stores and opens the C1b-shaped C1c entry", () => {
  c1bGameDiscoveryStore.reset("FILTER_NO_MATCH");
  c1cMyGameRegistrationsStore.setEntryScrollTop(288);
  const page = loadPage();

  page.onOpenScenario({ currentTarget: { dataset: { scenario: "ENTRY" } } });

  expect(c1bGameDiscoveryStore.current()).toMatchObject({
    status: "READY",
    filters: { date: "ALL", format: "ALL", availableOnly: false },
  });
  expect(c1cMyGameRegistrationsStore.current().entryScrollTop).toBe(0);
  expect(wx.navigateTo).toHaveBeenCalledWith({ url: "/dev/pages/c1c-discovery-entry/index" });
});

test("unknown launch state is inert and back uses history or the real intent entry", () => {
  const page = loadPage();
  page.onOpenScenario({ currentTarget: { dataset: { scenario: "UNKNOWN" } } });
  expect(wx.navigateTo).not.toHaveBeenCalled();

  page.onHeaderBack();
  expect(wx.reLaunch).toHaveBeenCalledWith({ url: "/pages/intent-entry/index" });

  (getCurrentPages as unknown as jest.Mock).mockReturnValue([{}, {}]);
  page.onHeaderBack();
  expect(wx.navigateBack).toHaveBeenCalledWith({ delta: 1 });
});
