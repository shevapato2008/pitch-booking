/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */

import { beforeEach, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";

import { decodePublicGameDirectory } from "../../domain/public-game-directory-decoder";
import type {
  PublicGameDirectory,
  PublicGameDirectoryFilters,
} from "../../domain/public-game-directory";
import {
  registerPublicGameDirectorySource,
  resetPublicGameDirectorySourceForTesting,
  type PublicGameDirectorySource,
} from "../../services/public-game-directory";

type PageDefinition = Record<string, any> & { data: Record<string, any> };
type RuntimePage = PageDefinition & { setData(patch: Record<string, unknown>): void };

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
}

let captured: PageDefinition | undefined;

function loadPage(): RuntimePage {
  if (!captured) {
    (globalThis as any).Page = (definition: PageDefinition) => { captured = definition; };
    jest.requireActual("./index");
  }
  if (!captured) throw new Error("PAGE_NOT_CAPTURED");
  return {
    ...captured,
    data: structuredClone(captured.data),
    setData(patch: Record<string, unknown>) { Object.assign(this.data, patch); },
  } as RuntimePage;
}

const call = (page: RuntimePage, method: string, ...args: unknown[]) =>
  (page[method] as (...values: unknown[]) => unknown).apply(page, args);

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(`contracts/examples/${name}.json`, "utf8")) as unknown;
}

const readyDirectory = decodePublicGameDirectory(fixture("public-games-ready"));
const sourceEmptyDirectory = decodePublicGameDirectory(fixture("public-games-empty"));

function directory(
  items: PublicGameDirectory["items"] = readyDirectory.items,
  availableDates: PublicGameDirectory["availableDates"] = readyDirectory.availableDates,
): PublicGameDirectory {
  return {
    authoritativeNow: readyDirectory.authoritativeNow,
    availableDates,
    items,
  };
}

function registerSource(
  implementation: PublicGameDirectorySource["getDirectory"] = async () => readyDirectory,
) {
  const getDirectory = jest.fn(implementation);
  registerPublicGameDirectorySource({ getDirectory });
  return getDirectory;
}

beforeEach(() => {
  resetPublicGameDirectorySourceForTesting();
  (globalThis as any).wx = {
    getWindowInfo: jest.fn(() => ({ windowWidth: 375, statusBarHeight: 44 })),
    getMenuButtonBoundingClientRect: jest.fn(() => ({
      top: 48, bottom: 80, left: 278, right: 365, width: 87, height: 32,
    })),
    navigateTo: jest.fn(),
    navigateBack: jest.fn(),
    reLaunch: jest.fn(),
  };
  (globalThis as any).getCurrentPages = jest.fn(() => [
    { route: "pages/intent-entry/index" },
    { route: "pages/game-discovery/index" },
  ]);
});

test("initial onShow keeps exactly two skeletons until the real directory renders approved cards", async () => {
  const first = deferred<PublicGameDirectory>();
  const getDirectory = registerSource(() => first.promise);
  const page = loadPage();

  call(page, "onLoad");
  const loading = call(page, "onShow") as Promise<void>;

  expect(getDirectory).toHaveBeenCalledWith({});
  expect(page.data).toMatchObject({
    status: "LOADING",
    games: [],
    resultCount: 0,
    filters: { date: "ALL", format: "ALL", availableOnly: false },
  });
  const wxml = readFileSync("miniprogram/pages/game-discovery/index.wxml", "utf8");
  expect(wxml.match(/class="c1b-skeleton"/g)).toHaveLength(2);

  first.resolve(readyDirectory);
  await loading;

  expect(page.data).toMatchObject({
    status: "READY",
    resultCount: 3,
    sourceEmpty: false,
    filterNoMatch: false,
    dateOptions: [
      { value: "ALL", label: "全部日期" },
      { value: "2026-08-29", label: "8/29 周六" },
      { value: "2026-08-30", label: "8/30 周日" },
      { value: "2026-08-31", label: "8/31 周一" },
    ],
  });
  expect(page.data.games[0]).toMatchObject({
    detailPath: "/pages/captain-game-public/index?token=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    name: "海河周六晨练局",
    teamName: "海河晨光队",
    venueName: "天津河东体育中心",
    pitchName: "笼式五人制 2 号场",
    dateLabel: "8月29日 周六",
    timeLabel: "07:30–09:00",
    formatLabel: "五人制",
    intensityLabel: "轻松交流",
    positionsLabel: "中场 / 前锋",
    playerSummary: "6 / 10 人",
    spotsLabel: "公开报名剩 4 名",
    aaLabel: "¥36.00",
    deadlineLabel: "8月28日 周五 20:00",
  });
});

test("date, format, and availability selections update locally then issue exact server filters", async () => {
  const getDirectory = registerSource(async (filters?: PublicGameDirectoryFilters) => {
    if (filters?.availableOnly) return directory([readyDirectory.items[0]]);
    if (filters?.format === "FIVE") return directory([readyDirectory.items[0]]);
    if (filters?.localDate === "2026-08-29") return directory([readyDirectory.items[0]]);
    return readyDirectory;
  });
  const page = loadPage();
  await call(page, "onShow");

  const dateLoad = call(page, "onSelectDate", {
    currentTarget: { dataset: { value: "2026-08-29" } },
  }) as Promise<void>;
  expect(page.data).toMatchObject({ status: "LOADING", filters: { date: "2026-08-29" } });
  await dateLoad;
  expect(getDirectory).toHaveBeenLastCalledWith({ localDate: "2026-08-29" });

  const formatLoad = call(page, "onFormatChange", { detail: { value: "1" } }) as Promise<void>;
  expect(page.data).toMatchObject({
    status: "LOADING",
    selectedFormatIndex: 1,
    selectedFormatLabel: "五人制",
    filters: { date: "2026-08-29", format: "FIVE", availableOnly: false },
  });
  await formatLoad;
  expect(getDirectory).toHaveBeenLastCalledWith({ localDate: "2026-08-29", format: "FIVE" });

  const availabilityLoad = call(page, "onToggleAvailable") as Promise<void>;
  expect(page.data).toMatchObject({
    status: "LOADING",
    filters: { date: "2026-08-29", format: "FIVE", availableOnly: true },
  });
  await availabilityLoad;
  expect(getDirectory).toHaveBeenLastCalledWith({
    localDate: "2026-08-29",
    format: "FIVE",
    availableOnly: true,
  });
});

test("a filtered empty response keeps source truth and clear resets every filter with a real reload", async () => {
  let calls = 0;
  const getDirectory = registerSource(async () => {
    calls += 1;
    if (calls === 2) return directory([]);
    return readyDirectory;
  });
  const page = loadPage();
  await call(page, "onShow");

  await call(page, "onSelectDate", {
    currentTarget: { dataset: { value: "2026-08-31" } },
  });
  expect(page.data).toMatchObject({
    status: "READY", games: [], resultCount: 0, sourceEmpty: false, filterNoMatch: true,
  });

  const clear = call(page, "onClearFilters") as Promise<void>;
  expect(page.data).toMatchObject({
    status: "LOADING",
    selectedFormatIndex: 0,
    selectedFormatLabel: "全部人制",
    filters: { date: "ALL", format: "ALL", availableOnly: false },
  });
  await clear;
  expect(getDirectory).toHaveBeenLastCalledWith({});
  expect(page.data).toMatchObject({ status: "READY", resultCount: 3, filterNoMatch: false });
});

test("a source-empty response exposes real intent recovery and deep-link back uses the same reLaunch", async () => {
  registerSource(async () => sourceEmptyDirectory);
  const page = loadPage();
  await call(page, "onShow");

  expect(page.data).toMatchObject({
    status: "READY", games: [], resultCount: 0, sourceEmpty: true, filterNoMatch: false,
    dateOptions: [{ value: "ALL", label: "全部日期" }],
  });
  call(page, "onReturnIntent");
  expect(wx.reLaunch).toHaveBeenCalledWith({ url: "/pages/intent-entry/index" });

  (getCurrentPages as unknown as jest.Mock).mockReturnValue([{ route: "pages/game-discovery/index" }]);
  call(page, "onHeaderBack");
  expect(wx.reLaunch).toHaveBeenLastCalledWith({ url: "/pages/intent-entry/index" });
});

test("a current load failure clears cards and retry performs a new authoritative request", async () => {
  let calls = 0;
  const getDirectory = registerSource(async () => {
    calls += 1;
    if (calls === 2) throw new Error("network unavailable");
    return readyDirectory;
  });
  const page = loadPage();

  await call(page, "onShow");
  expect(page.data.resultCount).toBe(3);
  await call(page, "onToggleAvailable");
  expect(page.data).toMatchObject({
    status: "LOAD_ERROR", games: [], resultCount: 0, sourceEmpty: false, filterNoMatch: false,
    filters: { date: "ALL", format: "ALL", availableOnly: true },
  });

  await call(page, "onRetry");
  expect(getDirectory).toHaveBeenCalledTimes(3);
  expect(getDirectory).toHaveBeenLastCalledWith({ availableOnly: true });
  expect(page.data).toMatchObject({ status: "READY", resultCount: 3 });
});

test("a filter that remains visible after load error performs a real recovery request", async () => {
  let calls = 0;
  const getDirectory = registerSource(async () => {
    calls += 1;
    if (calls === 1) throw new Error("network unavailable");
    return directory([readyDirectory.items[1]]);
  });
  const page = loadPage();
  await call(page, "onShow");
  expect(page.data.status).toBe("LOAD_ERROR");

  await call(page, "onFormatChange", { detail: { value: "2" } });

  expect(getDirectory).toHaveBeenLastCalledWith({ format: "SEVEN" });
  expect(page.data).toMatchObject({
    status: "READY",
    selectedFormatIndex: 2,
    selectedFormatLabel: "七人制",
    filters: { date: "ALL", format: "SEVEN", availableOnly: false },
  });
});

test("the whole card navigates only to an exact current server-provided detailPath", async () => {
  registerSource();
  const page = loadPage();
  await call(page, "onShow");

  const firstPath = readyDirectory.items[0].detailPath;
  call(page, "onOpenGame", { currentTarget: { dataset: { detailPath: firstPath } } });
  expect(wx.navigateTo).toHaveBeenCalledWith({ url: firstPath });

  call(page, "onOpenGame", {
    currentTarget: { dataset: { detailPath: "/pages/captain-game-public/index?token=dddddddddddddddddddddddddddddddd" } },
  });
  call(page, "onOpenGame", { currentTarget: { dataset: { detailPath: 42 } } });
  expect(wx.navigateTo).toHaveBeenCalledTimes(1);
});

test("returning from detail refreshes counts while preserving the selected filters", async () => {
  const refreshed = directory([{ ...readyDirectory.items[0], currentPlayers: 7, remainingSpots: 3 }]);
  let calls = 0;
  const getDirectory = registerSource(async () => {
    calls += 1;
    return calls === 3 ? refreshed : directory([readyDirectory.items[0]]);
  });
  const page = loadPage();
  await call(page, "onShow");
  await call(page, "onSelectDate", {
    currentTarget: { dataset: { value: "2026-08-29" } },
  });

  const path = readyDirectory.items[0].detailPath;
  call(page, "onOpenGame", { currentTarget: { dataset: { detailPath: path } } });
  call(page, "onHide");
  await call(page, "onShow");

  expect(getDirectory).toHaveBeenCalledTimes(3);
  expect(getDirectory).toHaveBeenLastCalledWith({ localDate: "2026-08-29" });
  expect(page.data).toMatchObject({
    status: "READY",
    filters: { date: "2026-08-29", format: "ALL", availableOnly: false },
  });
  expect(page.data.games[0]).toMatchObject({
    playerSummary: "7 / 10 人",
    spotsLabel: "公开报名剩 3 名",
  });
});

test("opening My Registrations preserves filters, cards, and exact scroll without reloading on return", async () => {
  const getDirectory = registerSource();
  const page = loadPage();
  call(page, "onLoad");
  await call(page, "onShow");
  await call(page, "onSelectDate", {
    currentTarget: { dataset: { value: "2026-08-30" } },
  });
  call(page, "onScroll", { detail: { scrollTop: 314.5 } });
  const names = page.data.games.map((game: { name: string }) => game.name);

  call(page, "onOpenMyRegistrations");
  expect(wx.navigateTo).toHaveBeenCalledWith(expect.objectContaining({
    url: "/pages/my-game-registrations/index",
  }));
  call(page, "onHide");
  await call(page, "onShow");

  expect(getDirectory).toHaveBeenCalledTimes(2);
  expect(page.data).toMatchObject({
    entryScrollTop: 314.5,
    filters: { date: "2026-08-30", format: "ALL", availableOnly: false },
  });
  expect(page.data.games.map((game: { name: string }) => game.name)).toEqual(names);
});

test("a failed My Registrations navigation does not suppress the next authoritative reload", async () => {
  const getDirectory = registerSource();
  const page = loadPage();
  await call(page, "onShow");
  (wx.navigateTo as unknown as jest.Mock).mockImplementationOnce((options: unknown) => {
    (options as { fail?: (reason: Error) => void }).fail?.(new Error("NAV_FAILED"));
  });

  call(page, "onOpenMyRegistrations");
  call(page, "onHide");
  await call(page, "onShow");

  expect(getDirectory).toHaveBeenCalledTimes(2);
});

test("a late older response cannot overwrite the latest onShow result", async () => {
  const stale = deferred<PublicGameDirectory>();
  const latest = deferred<PublicGameDirectory>();
  let calls = 0;
  registerSource(() => {
    calls += 1;
    return calls === 1 ? stale.promise : latest.promise;
  });
  const page = loadPage();

  const staleLoad = call(page, "onShow") as Promise<void>;
  call(page, "onHide");
  const latestLoad = call(page, "onShow") as Promise<void>;
  const latestDirectory = directory([readyDirectory.items[1]]);
  latest.resolve(latestDirectory);
  await latestLoad;
  expect(page.data.games.map((game: { name: string }) => game.name)).toEqual(["奥体周日傍晚局"]);

  stale.resolve(directory([readyDirectory.items[0]]));
  await staleLoad;
  expect(page.data.games.map((game: { name: string }) => game.name)).toEqual(["奥体周日傍晚局"]);
});

test("filter, retry, clear, and card interactions stay inert throughout loading", async () => {
  const pending = deferred<PublicGameDirectory>();
  const getDirectory = registerSource(() => pending.promise);
  const page = loadPage();
  const loading = call(page, "onShow") as Promise<void>;

  call(page, "onSelectDate", { currentTarget: { dataset: { value: "2026-08-29" } } });
  call(page, "onFormatChange", { detail: { value: "1" } });
  call(page, "onToggleAvailable");
  call(page, "onClearFilters");
  call(page, "onRetry");
  call(page, "onOpenGame", {
    currentTarget: { dataset: { detailPath: readyDirectory.items[0].detailPath } },
  });

  expect(getDirectory).toHaveBeenCalledTimes(1);
  expect(page.data.filters).toEqual({ date: "ALL", format: "ALL", availableOnly: false });
  expect(wx.navigateTo).not.toHaveBeenCalled();
  pending.resolve(readyDirectory);
  await loading;
});

test("native header geometry has a safe fallback and history back stays predictable", () => {
  registerSource();
  const page = loadPage();
  call(page, "onLoad");
  expect(page.data).toMatchObject({ headerTopPx: 44, headerRowHeightPx: 44 });

  call(page, "onHeaderBack");
  expect(wx.navigateBack).toHaveBeenCalledWith({ delta: 1 });

  (wx.getWindowInfo as unknown as jest.Mock).mockImplementation(() => { throw new Error("platform unavailable"); });
  const fallback = loadPage();
  expect(() => call(fallback, "onLoad")).not.toThrow();
  expect(fallback.data).toMatchObject({ headerTopPx: 0, headerRowHeightPx: 44 });
});

test("production markup preserves nested scroll, touch geometry, safe area, and real handlers", () => {
  const wxml = readFileSync("miniprogram/pages/game-discovery/index.wxml", "utf8");
  const styles = readFileSync("miniprogram/pages/game-discovery/index.wxss", "utf8");
  const buttons = wxml.match(/<button\b[^>]*>/g) ?? [];
  const card = wxml.match(/<button[^>]*class="c1b-game-card"[\s\S]*?<\/button>/)?.[0] ?? "";

  expect(wxml.match(/<scroll-view\b/g)).toHaveLength(2);
  expect(wxml).toMatch(/class="c1b-scroll"\s+scroll-y="true"[^>]+scroll-top="{{entryScrollTop}}"[^>]+bindscroll="onScroll"/);
  expect(wxml).toMatch(/class="c1b-date-strip"\s+scroll-x="true"/);
  expect(wxml).toContain('disabled="{{status === \'LOADING\'}}"');
  expect(wxml).toContain('bindchange="onFormatChange"');
  expect(card).toMatch(/bindtap="onOpenGame"/);
  expect(card).not.toMatch(/<button[^>]*>[\s\S]*<button/);
  expect(buttons.length).toBeGreaterThan(0);
  for (const button of buttons) expect(button).toMatch(/bindtap="[A-Za-z][A-Za-z0-9]*"/);
  for (const handler of [
    "onHeaderBack", "onSelectDate", "onToggleAvailable", "onRetry",
    "onReturnIntent", "onClearFilters", "onOpenGame", "onOpenMyRegistrations",
  ]) expect(wxml).toContain(`bindtap="${handler}"`);
  expect(wxml.indexOf('bindtap="onOpenMyRegistrations"')).toBeLessThan(wxml.indexOf('class="c1b-filters"'));
  expect(wxml).not.toMatch(/Fixture|开发预览|模拟数据|scenario|dev\/pages/i);

  const controls = styles.match(/\.c1b-date-chip, \.c1b-filter-chip, \.c1b-secondary-action\s*\{([^}]*)\}/s)?.[1] ?? "";
  for (const declaration of [
    /min-height:\s*88rpx/, /display:\s*flex/, /align-items:\s*center/, /justify-content:\s*center/,
  ]) expect(controls).toMatch(declaration);
  expect(styles).toMatch(/\.c1b-page\s*\{[^}]*height:\s*100vh[^}]*overflow:\s*hidden/s);
  expect(styles).toMatch(/\.c1b-scroll\s*\{[^}]*height:\s*0[^}]*min-height:\s*0/s);
  expect(styles).toMatch(/\.c1b-content\s*\{[^}]*env\(safe-area-inset-bottom,\s*0px\)/s);
  expect(styles).toMatch(/\.c1b-date-strip__inner\s*\{[^}]*display:\s*inline-flex/s);
  expect(styles).toMatch(/\.c1b-game-card\s*\{[^}]*min-height:\s*444rpx/s);
  expect(styles).toMatch(/\.c1b-skeleton\s*\{[^}]*min-height:\s*444rpx/s);
  const mineEntryRule = styles.match(/\.c1b-mine-entry\s*\{([^}]*)\}/s)?.[1] ?? "";
  for (const declaration of [
    /min-height:\s*88rpx/, /display:\s*flex/, /align-items:\s*center/, /justify-content:\s*center/,
  ]) expect(mineEntryRule).toMatch(declaration);
  expect(wxml).toMatch(/class="c1b-metric c1b-metric--deadline"[^>]*>[\s\S]*?\{\{item\.deadlineLabel\}\}/);
  const metricValueRule = styles.match(/\.c1b-metric-value\s*\{([^}]*)\}/s)?.[1] ?? "";
  for (const declaration of [
    /display:\s*flex/, /min-height:\s*68rpx/, /align-items:\s*center/, /justify-content:\s*center/,
  ]) expect(metricValueRule).toMatch(declaration);
  const deadlineValueRule = styles.match(/\.c1b-metric--deadline \.c1b-metric-value\s*\{([^}]*)\}/s)?.[1] ?? "";
  for (const declaration of [
    /overflow:\s*hidden/, /text-overflow:\s*clip/, /white-space:\s*normal/, /word-break:\s*keep-all/,
  ]) expect(deadlineValueRule).toMatch(declaration);
});
