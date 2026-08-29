/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */

import { beforeEach, expect, jest, test } from "@jest/globals";
import { existsSync, readFileSync } from "node:fs";

import { decodeMyOpenGameApplications } from "../../domain/open-game-registration-decoder";
import type {
  OpenGameApplicationItem,
  OpenGameApplicationPage,
} from "../../domain/open-game-registration";
import { OpenGameRegistrationApiError } from "../../services/http-open-game-registration";
import {
  registerOpenGameRegistrationSource,
  resetOpenGameRegistrationSourceForTesting,
  type OpenGameRegistrationSource,
} from "../../services/open-game-registration";

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
const READY = decodeMyOpenGameApplications(JSON.parse(
  readFileSync("contracts/examples/my-open-game-applications-ready.json", "utf8"),
) as unknown);
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
  expect(api.listMine).toHaveBeenCalledTimes(1);
  expect(pageInstance.data).toMatchObject({ listScrollTop: 728.25, resultCount: 2 });

  call(pageInstance, "onHeaderBack");
  expect(wx.navigateBack).toHaveBeenCalledWith({ delta: 1 });
  (getCurrentPages as unknown as jest.Mock).mockReturnValue([{ route: "pages/my-game-registrations/index" }]);
  call(pageInstance, "onHeaderBack");
  call(pageInstance, "onOpenDiscovery");
  expect(wx.reLaunch).toHaveBeenNthCalledWith(1, { url: "/pages/game-discovery/index" });
  expect(wx.reLaunch).toHaveBeenNthCalledWith(2, { url: "/pages/game-discovery/index" });
});

test("hiding during refresh clears transient busy state and ignores the late response", async () => {
  const refresh = deferred<OpenGameApplicationPage>();
  let calls = 0;
  const api = registerSource({
    listMine: jest.fn(() => {
      calls += 1;
      return calls === 1
        ? Promise.resolve(page(READY.items.slice(0, 2), null))
        : refresh.promise;
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
  expect(api.listMine).toHaveBeenCalledTimes(2);
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
