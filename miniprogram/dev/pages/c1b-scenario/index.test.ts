/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */

import { beforeEach, expect, jest, test } from "@jest/globals";

import { c1bGameDiscoveryStore } from "../../c1b-game-discovery-fixture";

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
  (globalThis as any).wx = {
    getWindowInfo: jest.fn(() => ({ windowWidth: 375, statusBarHeight: 44 })),
    getMenuButtonBoundingClientRect: jest.fn(() => ({ top: 48, bottom: 80, left: 278, right: 365, width: 87, height: 32 })),
    navigateTo: jest.fn(),
    navigateBack: jest.fn(),
    reLaunch: jest.fn(),
  };
  (globalThis as any).getCurrentPages = jest.fn(() => [{}]);
});

test("reads the shared header geometry and exposes every repeatable preview scenario", () => {
  const page = loadPage();
  page.onLoad();

  expect(page.data).toMatchObject({ headerTopPx: 44, headerRowHeightPx: 44 });
  expect(page.data.scenarios.map(({ scenario }: { scenario: string }) => scenario)).toEqual([
    "READY", "FILTERED_NONEMPTY", "FILTER_NO_MATCH", "LOAD_ERROR", "LOADING", "SOURCE_EMPTY", "SELECTED_DETAIL",
  ]);
});

test.each([
  ["READY", "/dev/pages/c1b-game-discovery/index", { status: "READY", games: expect.any(Array) }],
  ["FILTERED_NONEMPTY", "/dev/pages/c1b-game-discovery/index", { filters: { date: "2026-08-29", format: "FIVE", availableOnly: true } }],
  ["FILTER_NO_MATCH", "/dev/pages/c1b-game-discovery/index", { filterNoMatch: true }],
  ["LOAD_ERROR", "/dev/pages/c1b-game-discovery/index", { status: "LOAD_ERROR" }],
  ["LOADING", "/dev/pages/c1b-game-discovery/index", { status: "LOADING" }],
  ["SOURCE_EMPTY", "/dev/pages/c1b-game-discovery/index", { sourceEmpty: true }],
] as const)("%s resets the singleton and enters the directory", (scenario, url, snapshot) => {
  const page = loadPage();
  page.onOpenScenario({ currentTarget: { dataset: { scenario } } });

  expect(c1bGameDiscoveryStore.current()).toMatchObject(snapshot);
  expect(wx.navigateTo).toHaveBeenCalledWith({ url });
});

test("selected-detail resets to the representative game and opens the same encoded ID", () => {
  const page = loadPage();
  page.onOpenScenario({ currentTarget: { dataset: { scenario: "SELECTED_DETAIL" } } });

  expect(c1bGameDiscoveryStore.current().selectedGameId).toBe("harbor-five");
  expect(wx.navigateTo).toHaveBeenCalledWith({
    url: "/dev/pages/c1b-game-detail/index?gameId=harbor-five",
  });
});

test("unknown scenario is inert and back uses history or the real intent entry", () => {
  const page = loadPage();
  page.onOpenScenario({ currentTarget: { dataset: { scenario: "UNKNOWN" } } });
  expect(wx.navigateTo).not.toHaveBeenCalled();

  page.onHeaderBack();
  expect(wx.reLaunch).toHaveBeenCalledWith({ url: "/pages/intent-entry/index" });

  (getCurrentPages as unknown as jest.Mock).mockReturnValue([{}, {}]);
  page.onHeaderBack();
  expect(wx.navigateBack).toHaveBeenCalledWith({ delta: 1 });
});
