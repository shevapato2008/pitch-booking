/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */

import { beforeEach, expect, jest, test } from "@jest/globals";
import { existsSync, readFileSync } from "node:fs";

import { decodeMyOpenGameApplications } from "../../domain/open-game-registration-decoder";
import type {
  OpenGameApplicationItem,
  OpenGameApplicationPage,
} from "../../domain/open-game-registration";
import type { StatusTransport } from "../../runtime/interfaces";
import {
  createHttpOpenGameRegistrationSource,
  OpenGameRegistrationApiError,
} from "../../services/http-open-game-registration";
import {
  registerOpenGameRegistrationSource,
  resetOpenGameRegistrationSourceForTesting,
  type OpenGameRegistrationSource,
} from "../../services/open-game-registration";
import type { SessionStore, StoredSession } from "../../services/session-store";

type PageDefinition = Record<string, any> & { data: Record<string, any> };
type RuntimePage = PageDefinition & { setData(patch: Record<string, unknown>): void };

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
}

const SOURCE_PATH = "miniprogram/pages/my-game-registrations/index.ts";
const USER_A = "11111111-2222-4333-8444-555555555555";
const USER_B = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const RAW_READY = JSON.parse(
  readFileSync("contracts/examples/my-open-game-applications-ready.json", "utf8"),
) as Record<string, unknown>;
const READY = decodeMyOpenGameApplications(RAW_READY);
const EMPTY = decodeMyOpenGameApplications(JSON.parse(
  readFileSync("contracts/examples/my-open-game-applications-empty.json", "utf8"),
) as unknown);

let captured: PageDefinition | undefined;
let currentUserId: string | null;

function loadPage(): RuntimePage {
  expect(existsSync(SOURCE_PATH)).toBe(true);
  if (!existsSync(SOURCE_PATH)) throw new Error("production My Registrations page is missing");
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

function page(items: readonly OpenGameApplicationItem[], nextCursor: string | null): OpenGameApplicationPage {
  return Object.freeze({ items: Object.freeze([...items]), nextCursor });
}

function source(overrides: Partial<OpenGameRegistrationSource> = {}): OpenGameRegistrationSource {
  return {
    login: jest.fn(async () => {
      if (currentUserId === null) throw new OpenGameRegistrationApiError("LOGIN_FAILED");
      return currentUserId;
    }),
    currentUserId: jest.fn(() => currentUserId),
    listMine: jest.fn(async () => READY),
    getContext: jest.fn(),
    apply: jest.fn(),
    getPending: jest.fn(),
    decide: jest.fn(),
    withdraw: jest.fn(),
    ...overrides,
  } as OpenGameRegistrationSource;
}

function registerSource(overrides: Partial<OpenGameRegistrationSource> = {}) {
  const api = source(overrides);
  registerOpenGameRegistrationSource(api);
  return api;
}

beforeEach(() => {
  resetOpenGameRegistrationSourceForTesting();
  currentUserId = USER_A;
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
    { route: "pages/game-discovery/index" },
    { route: "pages/my-game-registrations/index" },
  ]);
});

test("production page and route use the approved native layout without preview copy", () => {
  loadPage();
  const json = readFileSync("miniprogram/pages/my-game-registrations/index.json", "utf8");
  const wxml = readFileSync("miniprogram/pages/my-game-registrations/index.wxml", "utf8");
  const styles = readFileSync("miniprogram/pages/my-game-registrations/index.wxss", "utf8");
  const app = JSON.parse(readFileSync("miniprogram/app.json", "utf8")) as { pages: string[] };

  expect(JSON.parse(json)).toEqual({ navigationStyle: "custom" });
  expect(app.pages).toContain("pages/my-game-registrations/index");
  expect(wxml).not.toMatch(/Fixture|开发预览|模拟数据|dev\/pages/i);
  expect(wxml).toMatch(/<scroll-view[^>]+scroll-y="true"[^>]+scroll-top="{{listScrollTop}}"[^>]+bindscroll="onScroll"/);
  const cards = wxml.match(/<button[^>]+class="c1c-registration-card[^>]*>[\s\S]*?<\/button>/g) ?? [];
  expect(cards).not.toHaveLength(0);
  for (const card of cards) {
    expect(card).toMatch(/bindtap="onOpenRegistration"/);
    expect(card).not.toMatch(/<button[^>]*>[\s\S]*<button/);
  }
  for (const button of wxml.match(/<button\b[^>]*>/g) ?? []) {
    expect(button).toMatch(/bindtap="on[A-Za-z]+"/);
  }
  for (const handler of [
    "onHeaderBack", "onLogin", "onRetry", "onRefresh", "onLoadMore",
    "onOpenRegistration", "onOpenDiscovery",
  ]) expect(wxml).toContain(`bindtap="${handler}"`);
  expect(styles).toMatch(/\.c1c-refresh-action, \.c1c-secondary-action, \.c1c-inline-error button\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*justify-content:\s*center/s);
  expect(styles).toMatch(/\.c1c-content\s*\{[^}]*env\(safe-area-inset-bottom,\s*0px\)/s);
  expect(styles).toMatch(/\.c1c-chevron\s*\{[^}]*border-top:[^}]*border-right:/s);
  expect(wxml).toContain("c1c-registration-card--waitlisted");
  expect(wxml).toContain("c1c-status--waitlisted");
  expect(styles).toMatch(/\.c1c-registration-card--waitlisted\s*\{[^}]*#FED7AA/s);
  expect(styles).toMatch(/\.c1c-status--waitlisted\s*\{[^}]*#FFF7ED[^}]*#9A3412/s);
});

test("initial read renders approved cards and a real empty response renders no invented cards", async () => {
  const first = deferred<OpenGameApplicationPage>();
  const api = registerSource({ listMine: jest.fn(() => first.promise) });
  const readyPage = loadPage();
  call(readyPage, "onLoad");
  const loading = call(readyPage, "onShow") as Promise<void>;

  expect(api.listMine).toHaveBeenCalledWith(undefined, 20);
  expect(readyPage.data).toMatchObject({ status: "LOADING", items: [], resultCount: 0 });
  first.resolve(page(READY.items.slice(0, 2), "opaque-page-2"));
  await loading;
  expect(readyPage.data).toMatchObject({
    status: "READY", sourceEmpty: false, resultCount: 2, nextCursor: "opaque-page-2",
  });
  expect(readyPage.data.items.map((item: { statusLabel: string }) => item.statusLabel)).toEqual([
    "球局已取消", "未通过",
  ]);

  registerSource({ listMine: jest.fn(async () => EMPTY) });
  const emptyPage = loadPage();
  await call(emptyPage, "onShow");
  expect(emptyPage.data).toMatchObject({
    status: "READY", sourceEmpty: true, items: [], resultCount: 0, nextCursor: null,
  });
});

test("a mixed authoritative list keeps WAITLISTED warm-position copy separate from JOINED", async () => {
  const waitlisted: OpenGameApplicationItem = {
    ...READY.items[3],
    effectiveStatus: "WAITLISTED",
    waitlistPosition: 2,
    waitlistedAt: "2026-08-29T01:35:00Z",
    promotedAt: null,
  };
  const promoted: OpenGameApplicationItem = {
    ...READY.items[2],
    effectiveStatus: "JOINED",
    waitlistPosition: null,
    waitlistedAt: "2026-08-28T01:35:00Z",
    promotedAt: "2026-08-28T02:00:00Z",
  };
  registerSource({ listMine: jest.fn(async () => page([waitlisted, promoted], null)) });
  const pageInstance = loadPage();
  await call(pageInstance, "onShow");

  expect(pageInstance.data.items).toEqual([
    expect.objectContaining({
      effectiveStatus: "WAITLISTED",
      statusLabel: "候补第 2 位",
      waitlistPosition: 2,
      promotedAt: null,
    }),
    expect.objectContaining({
      effectiveStatus: "JOINED",
      statusLabel: "已加入",
      waitlistPosition: null,
      promotedAt: "2026-08-28T02:00:00Z",
    }),
  ]);
});

test("explicit refresh replaces a waitlist position from authority without client-side arithmetic", async () => {
  const initial = {
    ...READY.items[3],
    effectiveStatus: "WAITLISTED" as const,
    waitlistPosition: 3,
    waitlistedAt: "2026-08-29T01:35:00Z",
    promotedAt: null,
  };
  const compressed = { ...initial, waitlistPosition: 2 };
  let reads = 0;
  const api = registerSource({
    listMine: jest.fn(async () => {
      reads += 1;
      return page([reads === 1 ? initial : compressed], "waitlist-next-page");
    }),
  });
  const pageInstance = loadPage();
  await call(pageInstance, "onShow");
  call(pageInstance, "onScroll", { detail: { scrollTop: 612.5 } });
  expect(pageInstance.data.items[0].statusLabel).toBe("候补第 3 位");

  await call(pageInstance, "onRefresh");

  expect(api.listMine).toHaveBeenCalledTimes(2);
  expect(pageInstance.data.items[0]).toMatchObject({
    effectiveStatus: "WAITLISTED",
    statusLabel: "候补第 2 位",
    waitlistPosition: 2,
  });
  expect(pageInstance.data).toMatchObject({
    listScrollTop: 612.5,
    nextCursor: "waitlist-next-page",
  });
});

test("no session performs no read; explicit login failure stays retryable and success starts page one", async () => {
  currentUserId = null;
  let loginAttempts = 0;
  const api = registerSource({
    login: jest.fn(async () => {
      loginAttempts += 1;
      if (loginAttempts === 1) throw new OpenGameRegistrationApiError("LOGIN_FAILED");
      currentUserId = USER_A;
      return USER_A;
    }),
  });
  const pageInstance = loadPage();
  await call(pageInstance, "onShow");
  expect(pageInstance.data.status).toBe("AUTH_REQUIRED");
  expect(api.listMine).not.toHaveBeenCalled();

  await call(pageInstance, "onLogin");
  expect(pageInstance.data).toMatchObject({ status: "LOGIN_FAILED", items: [], loginBusy: false });
  expect(api.listMine).not.toHaveBeenCalled();

  await call(pageInstance, "onLogin");
  expect(api.login).toHaveBeenCalledTimes(2);
  expect(api.listMine).toHaveBeenCalledWith(undefined, 20);
  expect(pageInstance.data).toMatchObject({ status: "READY", resultCount: 4, loginBusy: false });
});

test("a visible deferred account A login resynchronizes to account B stored before completion", async () => {
  currentUserId = null;
  const login = deferred<string>();
  const bItem = { ...READY.items[3], gameName: "账号 B 的球局" };
  const api = registerSource({
    login: jest.fn(() => login.promise),
    listMine: jest.fn(async () => page([bItem], null)),
  });
  const pageInstance = loadPage();
  await call(pageInstance, "onShow");
  const loggingIn = call(pageInstance, "onLogin") as Promise<void>;
  expect(pageInstance.data.loginBusy).toBe(true);

  currentUserId = USER_B;
  login.resolve(USER_A);
  await loggingIn;

  expect(api.listMine).toHaveBeenCalledWith(undefined, 20);
  expect(pageInstance.data).toMatchObject({
    status: "READY", loginBusy: false, resultCount: 1,
  });
  expect(pageInstance.data.items.map((item: { gameName: string }) => item.gameName)).toEqual([
    "账号 B 的球局",
  ]);
});

test("initial failure retries, while refresh failure retains current cards", async () => {
  let calls = 0;
  const api = registerSource({
    listMine: jest.fn(async () => {
      calls += 1;
      if (calls === 1 || calls === 3) throw new OpenGameRegistrationApiError("SERVICE_UNAVAILABLE");
      return page(READY.items.slice(0, 2), "opaque-page-2");
    }),
  });
  const pageInstance = loadPage();
  await call(pageInstance, "onShow");
  expect(pageInstance.data).toMatchObject({ status: "LOAD_ERROR", items: [], resultCount: 0 });

  await call(pageInstance, "onRetry");
  const ids = pageInstance.data.items.map((item: { registrationId: string }) => item.registrationId);
  expect(pageInstance.data).toMatchObject({ status: "READY", nextCursor: "opaque-page-2" });

  await call(pageInstance, "onRefresh");
  expect(api.listMine).toHaveBeenLastCalledWith(undefined, 20);
  expect(pageInstance.data).toMatchObject({
    status: "READY", refreshError: true, refreshing: false, nextCursor: "opaque-page-2",
  });
  expect(pageInstance.data.items.map((item: { registrationId: string }) => item.registrationId)).toEqual(ids);
});

test("an idle refresh after switching accounts clears A and loads account B", async () => {
  const accountBRead = deferred<OpenGameApplicationPage>();
  const aItem = { ...READY.items[0], gameName: "账号 A 的球局" };
  const bItem = { ...READY.items[3], gameName: "账号 B 的球局" };
  const api = registerSource({
    listMine: jest.fn(() => currentUserId === USER_A
      ? Promise.resolve(page([aItem], "account-a-cursor"))
      : accountBRead.promise),
  });
  const pageInstance = loadPage();
  await call(pageInstance, "onShow");

  currentUserId = USER_B;
  const refreshing = call(pageInstance, "onRefresh") as Promise<void>;

  expect(api.listMine).toHaveBeenCalledTimes(2);
  expect(pageInstance.data).toMatchObject({
    status: "LOADING", items: [], nextCursor: null, resultCount: 0, listScrollTop: 0,
  });
  accountBRead.resolve(page([bItem], "account-b-cursor"));
  await refreshing;
  expect(pageInstance.data).toMatchObject({
    status: "READY", nextCursor: "account-b-cursor", resultCount: 1,
  });
  expect(pageInstance.data.items.map((item: { gameName: string }) => item.gameName)).toEqual([
    "账号 B 的球局",
  ]);
});

test("an idle retry after switching accounts loads B instead of requiring login", async () => {
  const bItem = { ...READY.items[3], gameName: "账号 B 的球局" };
  const api = registerSource({
    listMine: jest.fn(async () => {
      if (currentUserId === USER_A) throw new OpenGameRegistrationApiError("SERVICE_UNAVAILABLE");
      return page([bItem], null);
    }),
  });
  const pageInstance = loadPage();
  await call(pageInstance, "onShow");
  expect(pageInstance.data.status).toBe("LOAD_ERROR");

  currentUserId = USER_B;
  await call(pageInstance, "onRetry");

  expect(api.listMine).toHaveBeenCalledTimes(2);
  expect(pageInstance.data).toMatchObject({ status: "READY", resultCount: 1 });
  expect(pageInstance.data.items.map((item: { gameName: string }) => item.gameName)).toEqual([
    "账号 B 的球局",
  ]);
});

test("load-more failure retains cards and cursor; retry appends stable unique registrations", async () => {
  const first = page(READY.items.slice(0, 2), "opaque-page-2");
  const second = page([READY.items[1], READY.items[2], READY.items[3]], null);
  let moreCalls = 0;
  const api = registerSource({
    listMine: jest.fn(async (cursor?: string) => {
      if (cursor === undefined) return first;
      moreCalls += 1;
      if (moreCalls === 1) throw new OpenGameRegistrationApiError("SERVICE_UNAVAILABLE");
      return second;
    }),
  });
  const pageInstance = loadPage();
  await call(pageInstance, "onShow");
  const before = pageInstance.data.items.map((item: { registrationId: string }) => item.registrationId);

  await call(pageInstance, "onLoadMore");
  expect(api.listMine).toHaveBeenLastCalledWith("opaque-page-2", 20);
  expect(pageInstance.data).toMatchObject({ loadMoreError: true, nextCursor: "opaque-page-2" });
  expect(pageInstance.data.items.map((item: { registrationId: string }) => item.registrationId)).toEqual(before);

  await call(pageInstance, "onLoadMore");
  expect(pageInstance.data).toMatchObject({ loadMoreError: false, nextCursor: null, resultCount: 4 });
  expect(new Set(pageInstance.data.items.map((item: { registrationId: string }) => item.registrationId)).size).toBe(4);
});

test("idle load-more after switching accounts clears A and loads account B page one", async () => {
  const aItem = { ...READY.items[0], gameName: "账号 A 的球局" };
  const bItem = { ...READY.items[3], gameName: "账号 B 的球局" };
  const api = registerSource({
    listMine: jest.fn(async () => currentUserId === USER_A
      ? page([aItem], "account-a-cursor")
      : page([bItem], null)),
  });
  const pageInstance = loadPage();
  await call(pageInstance, "onShow");

  currentUserId = USER_B;
  await call(pageInstance, "onLoadMore");

  expect(api.listMine).toHaveBeenNthCalledWith(1, undefined, 20);
  expect(api.listMine).toHaveBeenNthCalledWith(2, undefined, 20);
  expect(pageInstance.data).toMatchObject({
    status: "READY", nextCursor: null, resultCount: 1, listScrollTop: 0,
  });
  expect(pageInstance.data.items.map((item: { gameName: string }) => item.gameName)).toEqual([
    "账号 B 的球局",
  ]);
});

test("cards use only the current registration id, preserve scroll/detail return, and deep links return to discovery", async () => {
  const api = registerSource({ listMine: jest.fn(async () => page(READY.items.slice(0, 2), null)) });
  const pageInstance = loadPage();
  call(pageInstance, "onLoad");
  await call(pageInstance, "onShow");
  call(pageInstance, "onScroll", { detail: { scrollTop: 728.25 } });
  const registration = pageInstance.data.items[0] as { registrationId: string; detailPath: string };

  call(pageInstance, "onOpenRegistration", {
    currentTarget: { dataset: { registrationId: registration.registrationId } },
  });
  expect(wx.navigateTo).toHaveBeenCalledWith({ url: registration.detailPath });
  call(pageInstance, "onOpenRegistration", {
    currentTarget: { dataset: { registrationId: "40000000-0000-4000-8000-999999999999" } },
  });
  expect(wx.navigateTo).toHaveBeenCalledTimes(1);

  call(pageInstance, "onHide");
  await call(pageInstance, "onShow");
  expect(api.listMine).toHaveBeenCalledTimes(2);
  expect(pageInstance.data).toMatchObject({ listScrollTop: 728.25, resultCount: 2 });

  call(pageInstance, "onHeaderBack");
  expect(wx.navigateBack).toHaveBeenCalledWith({ delta: 1 });
  (getCurrentPages as unknown as jest.Mock).mockReturnValue([{ route: "pages/my-game-registrations/index" }]);
  call(pageInstance, "onHeaderBack");
  call(pageInstance, "onOpenDiscovery");
  expect(wx.reLaunch).toHaveBeenNthCalledWith(1, { url: "/pages/game-discovery/index" });
  expect(wx.reLaunch).toHaveBeenNthCalledWith(2, { url: "/pages/game-discovery/index" });
});

test("same-account onShow refreshes first-page authority while preserving loaded tail and scroll", async () => {
  const first = { ...READY.items[0], effectiveStatus: "WAITLISTED" as const, waitlistPosition: 1 };
  const promoted = {
    ...first,
    effectiveStatus: "JOINED" as const,
    waitlistPosition: null,
    promotedAt: "2026-08-29T02:30:00Z",
  };
  const tail = READY.items[1]!;
  let firstPageReads = 0;
  const api = registerSource({
    listMine: jest.fn(async (cursor?: string) => {
      if (cursor === "page-2") return page([tail], "page-3");
      firstPageReads += 1;
      return firstPageReads === 1
        ? page([first], "page-2")
        : page([promoted], "new-first-page-cursor");
    }),
  });
  const pageInstance = loadPage();
  await call(pageInstance, "onShow");
  await call(pageInstance, "onLoadMore");
  call(pageInstance, "onScroll", { detail: { scrollTop: 640 } });
  call(pageInstance, "onHide");
  await call(pageInstance, "onShow");

  expect(api.listMine).toHaveBeenNthCalledWith(3, undefined, 20);
  expect(pageInstance.data.items.map(
    (item: { registrationId: string }) => item.registrationId,
  )).toEqual([promoted.id, tail.id]);
  expect(pageInstance.data.items[0]).toMatchObject({
    effectiveStatus: "JOINED",
    waitlistPosition: null,
    promotedAt: "2026-08-29T02:30:00Z",
  });
  expect(pageInstance.data).toMatchObject({
    nextCursor: "page-3",
    resultCount: 2,
    listScrollTop: 640,
  });
});

test("same-account onShow keeps a loaded boundary card displaced by a new first-page item", async () => {
  const first = READY.items[0]!;
  const displaced = READY.items[1]!;
  const tail = READY.items[2]!;
  const inserted = READY.items[3]!;
  let firstPageReads = 0;
  registerSource({
    listMine: jest.fn(async (cursor?: string) => {
      if (cursor === "old-page-2") return page([tail], "after-loaded-tail");
      firstPageReads += 1;
      return firstPageReads === 1
        ? page([first, displaced], "old-page-2")
        : page([inserted, first], "new-page-2");
    }),
  });
  const pageInstance = loadPage();
  await call(pageInstance, "onShow");
  await call(pageInstance, "onLoadMore");
  call(pageInstance, "onScroll", { detail: { scrollTop: 700 } });
  call(pageInstance, "onHide");
  await call(pageInstance, "onShow");

  expect(pageInstance.data.items.map(
    (item: { registrationId: string }) => item.registrationId,
  )).toEqual([inserted.id, first.id, displaced.id, tail.id]);
  expect(pageInstance.data).toMatchObject({
    nextCursor: "after-loaded-tail",
    resultCount: 4,
    listScrollTop: 700,
  });
});

test("same-account detail authority patches one loaded registration by id without resetting pagination or scroll", async () => {
  registerSource({ listMine: jest.fn(async () => page(READY.items.slice(0, 3), "page-4")) });
  const pageInstance = loadPage();
  await call(pageInstance, "onShow");
  call(pageInstance, "onScroll", { detail: { scrollTop: 728.25 } });
  const beforeIds = pageInstance.data.items.map(
    (item: { registrationId: string }) => item.registrationId,
  );
  const targetId = beforeIds[1];

  expect(call(pageInstance, "applyRegistrationAuthority", {
    originatingUserId: USER_A,
    registrationId: targetId,
    effectiveStatus: "WAITLISTED",
    waitlistPosition: 3,
    waitlistedAt: "2026-08-29T01:35:00Z",
    promotedAt: null,
  })).toBe(true);
  expect(pageInstance.data.items.map(
    (item: { registrationId: string }) => item.registrationId,
  )).toEqual(beforeIds);
  expect(pageInstance.data.items[1]).toMatchObject({
    registrationId: targetId,
    effectiveStatus: "WAITLISTED",
    statusLabel: "候补第 3 位",
    waitlistPosition: 3,
    waitlistedAt: "2026-08-29T01:35:00Z",
    promotedAt: null,
  });
  expect(pageInstance.data).toMatchObject({
    nextCursor: "page-4",
    resultCount: 3,
    listScrollTop: 728.25,
  });

  expect(call(pageInstance, "applyRegistrationAuthority", {
    originatingUserId: USER_A,
    registrationId: "40000000-0000-4000-8000-999999999999",
    effectiveStatus: "WITHDRAWN",
    waitlistPosition: null,
    waitlistedAt: "2026-08-29T01:35:00Z",
    promotedAt: null,
  })).toBe(false);
  currentUserId = USER_B;
  expect(call(pageInstance, "applyRegistrationAuthority", {
    originatingUserId: USER_A,
    registrationId: targetId,
    effectiveStatus: "CANCELLED",
    waitlistPosition: null,
    waitlistedAt: "2026-08-29T01:35:00Z",
    promotedAt: null,
  })).toBe(false);
  expect(pageInstance.data.items[1].effectiveStatus).toBe("WAITLISTED");
});

test("a stale account A card tap synchronizes account B without navigating to A", async () => {
  const aItem = { ...READY.items[0], gameName: "账号 A 的球局" };
  const bItem = { ...READY.items[3], gameName: "账号 B 的球局" };
  const api = registerSource({
    listMine: jest.fn(async () => currentUserId === USER_A
      ? page([aItem], null)
      : page([bItem], null)),
  });
  const pageInstance = loadPage();
  await call(pageInstance, "onShow");
  const staleRegistrationId = pageInstance.data.items[0].registrationId as string;

  currentUserId = USER_B;
  await call(pageInstance, "onOpenRegistration", {
    currentTarget: { dataset: { registrationId: staleRegistrationId } },
  });

  expect(wx.navigateTo).not.toHaveBeenCalled();
  expect(api.listMine).toHaveBeenCalledTimes(2);
  expect(pageInstance.data).toMatchObject({ status: "READY", resultCount: 1 });
  expect(pageInstance.data.items.map((item: { gameName: string }) => item.gameName)).toEqual([
    "账号 B 的球局",
  ]);
});

test("hiding during refresh clears transient busy state and ignores the late response", async () => {
  const refresh = deferred<OpenGameApplicationPage>();
  let calls = 0;
  const api = registerSource({
    listMine: jest.fn(() => {
      calls += 1;
      if (calls === 2) return refresh.promise;
      return Promise.resolve(page(READY.items.slice(0, 2), null));
    }),
  });
  const pageInstance = loadPage();
  await call(pageInstance, "onShow");
  const ids = pageInstance.data.items.map((item: { registrationId: string }) => item.registrationId);
  const refreshing = call(pageInstance, "onRefresh") as Promise<void>;
  expect(pageInstance.data.refreshing).toBe(true);

  call(pageInstance, "onHide");
  await call(pageInstance, "onShow");
  expect(pageInstance.data.refreshing).toBe(false);
  expect(api.listMine).toHaveBeenCalledTimes(3);
  expect(pageInstance.data.items.map((item: { registrationId: string }) => item.registrationId)).toEqual(ids);

  refresh.resolve(page([READY.items[3]], null));
  await refreshing;
  expect(pageInstance.data.items.map((item: { registrationId: string }) => item.registrationId)).toEqual(ids);
});

test("401 clears old authority without auto-login", async () => {
  let calls = 0;
  const api = registerSource({
    listMine: jest.fn(async () => {
      calls += 1;
      if (calls === 2) {
        currentUserId = null;
        throw new OpenGameRegistrationApiError("AUTH_REQUIRED");
      }
      return page(READY.items.slice(0, 2), "opaque-page-2");
    }),
  });
  const pageInstance = loadPage();
  await call(pageInstance, "onShow");
  call(pageInstance, "onScroll", { detail: { scrollTop: 200 } });
  await call(pageInstance, "onRefresh");

  expect(pageInstance.data).toMatchObject({
    status: "AUTH_REQUIRED", items: [], nextCursor: null, resultCount: 0, listScrollTop: 0,
  });
  expect(api.login).not.toHaveBeenCalled();
});

test("a visible refresh success resynchronizes to account B instead of retaining account A", async () => {
  const staleRefresh = deferred<OpenGameApplicationPage>();
  const aItem = { ...READY.items[0], gameName: "账号 A 的球局" };
  const bItem = { ...READY.items[3], gameName: "账号 B 的球局" };
  let calls = 0;
  const api = registerSource({
    listMine: jest.fn(() => {
      calls += 1;
      if (calls === 1) return Promise.resolve(page([aItem], "account-a-cursor"));
      if (calls === 2) return staleRefresh.promise;
      return Promise.resolve(page([bItem], "account-b-cursor"));
    }),
  });
  const pageInstance = loadPage();
  await call(pageInstance, "onShow");
  const refreshing = call(pageInstance, "onRefresh") as Promise<void>;
  expect(pageInstance.data).toMatchObject({ refreshing: true, nextCursor: "account-a-cursor" });

  currentUserId = USER_B;
  staleRefresh.resolve(page([{ ...aItem, gameName: "账号 A 的过期刷新" }], null));
  await refreshing;

  expect(api.listMine).toHaveBeenCalledTimes(3);
  expect(pageInstance.data).toMatchObject({
    status: "READY",
    refreshing: false,
    loadingMore: false,
    nextCursor: "account-b-cursor",
    resultCount: 1,
  });
  expect(pageInstance.data.items.map((item: { gameName: string }) => item.gameName)).toEqual([
    "账号 B 的球局",
  ]);
});

test("a visible load-more error after session loss clears account A cards, cursor, and busy state", async () => {
  const staleMore = deferred<OpenGameApplicationPage>();
  const api = registerSource({
    listMine: jest.fn((cursor?: string) => cursor === undefined
      ? Promise.resolve(page(READY.items.slice(0, 2), "account-a-cursor"))
      : staleMore.promise),
  });
  const pageInstance = loadPage();
  await call(pageInstance, "onShow");
  const loadingMore = call(pageInstance, "onLoadMore") as Promise<void>;
  expect(pageInstance.data).toMatchObject({ loadingMore: true, nextCursor: "account-a-cursor" });

  currentUserId = null;
  staleMore.reject(new OpenGameRegistrationApiError("SERVICE_UNAVAILABLE"));
  await loadingMore;

  expect(pageInstance.data).toMatchObject({
    status: "AUTH_REQUIRED",
    items: [],
    nextCursor: null,
    resultCount: 0,
    listScrollTop: 0,
    refreshing: false,
    loadingMore: false,
  });
  expect(api.login).not.toHaveBeenCalled();
});

test("account B wins after account A is hidden and its late response is discarded", async () => {
  const pendingA = deferred<OpenGameApplicationPage>();
  const bItem = { ...READY.items[3], gameName: "账号 B 的球局" };
  const api = registerSource({
    listMine: jest.fn(() => currentUserId === USER_A
      ? pendingA.promise
      : Promise.resolve(page([bItem], null))),
  });
  const pageInstance = loadPage();
  const aLoad = call(pageInstance, "onShow") as Promise<void>;
  call(pageInstance, "onHide");
  currentUserId = USER_B;
  const bLoad = call(pageInstance, "onShow") as Promise<void>;
  expect(pageInstance.data).toMatchObject({ status: "LOADING", items: [], listScrollTop: 0 });
  await bLoad;
  expect(pageInstance.data.items.map((item: { gameName: string }) => item.gameName)).toEqual(["账号 B 的球局"]);

  pendingA.resolve(page([READY.items[0]], null));
  await aLoad;
  expect(api.listMine).toHaveBeenCalledTimes(2);
  expect(pageInstance.data.items.map((item: { gameName: string }) => item.gameName)).toEqual(["账号 B 的球局"]);
});

test("a real late account A 401 preserves account B session and rendered items", async () => {
  const staleAccountA = deferred<unknown>();
  const sessionA: StoredSession = {
    token: "account-a-token",
    expiresAt: "2099-01-01T00:00:00Z",
    userId: USER_A,
  };
  const sessionB: StoredSession = {
    token: "account-b-token",
    expiresAt: "2099-02-01T00:00:00Z",
    userId: USER_B,
  };
  let storedSession: StoredSession | null = sessionA;
  const sessionStore: SessionStore = {
    load: jest.fn(() => storedSession),
    save: jest.fn((session: StoredSession) => { storedSession = session; }),
    clear: jest.fn(() => { storedSession = null; }),
  };
  const bPayload = structuredClone(RAW_READY) as Record<string, unknown>;
  const rawItems = bPayload.items as Array<Record<string, unknown>>;
  bPayload.items = [{ ...rawItems[3], game_name: "账号 B 的球局" }];
  bPayload.next_cursor = null;
  let requestCount = 0;
  const unsupported = async <T>(): Promise<T> => { throw new Error("UNSUPPORTED_TRANSPORT_CALL"); };
  const transport: StatusTransport = {
    get: unsupported,
    post: unsupported,
    put: unsupported,
    requestWithStatus: async <T>() => {
      requestCount += 1;
      if (requestCount === 1) throw await staleAccountA.promise;
      return { statusCode: 200, data: bPayload as T };
    },
  };
  const api = createHttpOpenGameRegistrationSource({
    transport,
    identity: { login: jest.fn(async () => ({ code: "unused" })) },
    sessionStore,
  });
  registerOpenGameRegistrationSource(api);
  const pageInstance = loadPage();
  const accountALoad = call(pageInstance, "onShow") as Promise<void>;

  call(pageInstance, "onHide");
  sessionStore.save(sessionB);
  await call(pageInstance, "onShow");
  expect(pageInstance.data.items.map((item: { gameName: string }) => item.gameName)).toEqual([
    "账号 B 的球局",
  ]);

  staleAccountA.resolve({
    code: "HTTP_ERROR",
    statusCode: 401,
    data: { error: { code: "AUTH_REQUIRED", message: "expired", request_id: "old-a", details: {} } },
  });
  await accountALoad;

  expect(api.currentUserId()).toBe(USER_B);
  expect(sessionStore.load()).toEqual(sessionB);
  expect(pageInstance.data).toMatchObject({ status: "READY", resultCount: 1 });
  expect(pageInstance.data.items.map((item: { gameName: string }) => item.gameName)).toEqual([
    "账号 B 的球局",
  ]);
});

test("a stale A1 refresh 401 preserves refreshed A2 session, cards, and retry state", async () => {
  const staleRefresh = deferred<unknown>();
  const sessionA1: StoredSession = {
    token: "account-a1-token",
    expiresAt: "2099-01-01T00:00:00Z",
    userId: USER_A,
  };
  const sessionA2: StoredSession = {
    token: "account-a2-token",
    expiresAt: "2099-02-01T00:00:00Z",
    userId: USER_A,
  };
  let storedSession: StoredSession | null = sessionA1;
  const sessionStore: SessionStore = {
    load: jest.fn(() => storedSession),
    save: jest.fn((session: StoredSession) => { storedSession = session; }),
    clear: jest.fn(() => { storedSession = null; }),
  };
  let requestCount = 0;
  const unsupported = async <T>(): Promise<T> => { throw new Error("UNSUPPORTED_TRANSPORT_CALL"); };
  const transport: StatusTransport = {
    get: unsupported,
    post: unsupported,
    put: unsupported,
    requestWithStatus: async <T>() => {
      requestCount += 1;
      if (requestCount === 1) return { statusCode: 200, data: RAW_READY as T };
      throw await staleRefresh.promise;
    },
  };
  const api = createHttpOpenGameRegistrationSource({
    transport,
    identity: { login: jest.fn(async () => ({ code: "unused" })) },
    sessionStore,
  });
  registerOpenGameRegistrationSource(api);
  const pageInstance = loadPage();
  await call(pageInstance, "onShow");
  const originalIds = pageInstance.data.items.map(
    (item: { registrationId: string }) => item.registrationId,
  );
  const refreshing = call(pageInstance, "onRefresh") as Promise<void>;

  sessionStore.save(sessionA2);
  staleRefresh.resolve({
    code: "HTTP_ERROR",
    statusCode: 401,
    data: { error: { code: "AUTH_REQUIRED", message: "expired", request_id: "old-a1", details: {} } },
  });
  await refreshing;

  expect(api.currentUserId()).toBe(USER_A);
  expect(sessionStore.load()).toEqual(sessionA2);
  expect(sessionStore.clear).not.toHaveBeenCalled();
  expect(pageInstance.data).toMatchObject({
    status: "READY", refreshing: false, refreshError: true, resultCount: 4,
  });
  expect(pageInstance.data.items.map(
    (item: { registrationId: string }) => item.registrationId,
  )).toEqual(originalIds);
});
