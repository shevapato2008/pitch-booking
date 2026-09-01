/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";

import {
  decodeOpenGameReportContext,
  decodeOpenGameReportForReporter,
} from "../../domain/open-game-report-decoder";
import type { OpenGameReportContext } from "../../domain/open-game-report";
import { OpenGameReportApiError } from "../../services/http-open-game-report";
import { createOpenGameReportAttemptStore } from "../../services/open-game-report-attempt-store";
import {
  registerOpenGameReportAttemptStore,
  registerOpenGameReportSource,
  resetOpenGameReportAttemptStoreForTesting,
  resetOpenGameReportSourceForTesting,
  type OpenGameReportAttempt,
  type OpenGameReportSource,
} from "../../services/open-game-report";
import type { SessionStorage } from "../../services/session-store";

type PageDefinition = Record<string, any> & { data: Record<string, any> };
type RuntimePage = PageDefinition & { setData(patch: Record<string, unknown>): void };
const call = (page: RuntimePage, method: string, ...args: unknown[]) => page[method](...args);
const flush = async () => {
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
};
let captured: PageDefinition | undefined;
function loadPage(): RuntimePage {
  if (!captured) {
    (globalThis as any).Page = (definition: PageDefinition) => { captured = definition; };
    jest.requireActual("./index");
  }
  return {
    ...captured!,
    data: structuredClone(captured!.data),
    loadGeneration: 0,
    visible: true,
    skipNextShow: false,
    routeGameId: "",
    mutationInFlight: null,
    setData(patch: Record<string, unknown>) { Object.assign(this.data, patch); },
  } as RuntimePage;
}

const fixture = (name: string): Record<string, unknown> => JSON.parse(
  readFileSync(`contracts/examples/${name}.json`, "utf8"),
) as Record<string, unknown>;
const GAME_ID = "51000000-0000-4000-8000-000000000001";
const OTHER_GAME_ID = "51000000-0000-4000-8000-000000000002";
const USER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000002";
const ready = decodeOpenGameReportContext(fixture("open-game-report-context"));
const submitted = decodeOpenGameReportForReporter(fixture("open-game-report-submitted"));
const reported: OpenGameReportContext = {
  ...ready,
  submissionAllowed: false,
  submissionBlocker: "REPORT_ALREADY_EXISTS",
  report: submitted,
};

function memoryStorage() {
  const values = new Map<string, unknown>();
  const storage: SessionStorage = {
    get: (key) => values.get(key),
    set: (key, value) => { values.set(key, structuredClone(value)); },
    remove: (key) => { values.delete(key); },
  };
  return storage;
}

let currentUserId: string | null;
function source(overrides: Partial<OpenGameReportSource> = {}): OpenGameReportSource {
  return {
    login: jest.fn(async () => { currentUserId = USER_ID; return USER_ID; }),
    currentUserId: jest.fn(() => currentUserId),
    getMyReport: jest.fn(async () => ready),
    submit: jest.fn(async () => submitted),
    ...overrides,
  };
}

function register(overrides: Partial<OpenGameReportSource> = {}) {
  const api = source(overrides);
  const store = createOpenGameReportAttemptStore(memoryStorage());
  registerOpenGameReportSource(api);
  registerOpenGameReportAttemptStore(store);
  return { api, store };
}

beforeEach(() => {
  resetOpenGameReportSourceForTesting();
  resetOpenGameReportAttemptStoreForTesting();
  currentUserId = USER_ID;
  (globalThis as any).getCurrentPages = jest.fn(() => [{ route: "pages/open-game-report/index" }]);
  (globalThis as any).wx = {
    getWindowInfo: jest.fn(() => ({ statusBarHeight: 47, screenWidth: 390 })),
    getMenuButtonBoundingClientRect: jest.fn(() => ({ top: 51, bottom: 83, left: 294, right: 381, width: 87, height: 32 })),
    hideShareMenu: jest.fn(),
    navigateBack: jest.fn(({ success }: { success?: () => void }) => { success?.(); }),
    redirectTo: jest.fn(({ success }: { success?: () => void }) => { success?.(); }),
    navigateTo: jest.fn(({ success }: { success?: () => void }) => { success?.(); }),
  };
});

test("loads the authoritative form, exact categories, and approved production structure", async () => {
  const { api } = register();
  const page = loadPage();
  call(page, "onLoad", { game_id: GAME_ID });
  await flush();

  expect(api.getMyReport).toHaveBeenCalledWith(GAME_ID);
  expect(page.data).toMatchObject({
    status: "READY",
    gameName: "海河周日轻松局",
    teamName: "津门晨风队",
    submissionAllowed: true,
    report: null,
    targetLabel: "本场球局及组织者",
    resultUnknown: false,
  });
  expect(page.data.categories.map((item: { value: string }) => item.value)).toEqual([
    "FALSE_INFORMATION", "EXTRA_CHARGE", "DANGEROUS_BEHAVIOR", "HARASSMENT",
    "ORGANIZER_NO_SHOW",
  ]);

  const json = JSON.parse(readFileSync("miniprogram/pages/open-game-report/index.json", "utf8"));
  const wxml = readFileSync("miniprogram/pages/open-game-report/index.wxml", "utf8");
  const styles = readFileSync("miniprogram/pages/open-game-report/index.wxss", "utf8");
  expect(json).toEqual({ navigationStyle: "custom" });
  expect(wxml).not.toMatch(/Fixture|开发预览|模拟数据|dev\/pages/i);
  for (const handler of [
    "onHeaderBack", "onSelectCategory", "onFactsInput", "onPrepareSubmit",
    "onCancelSubmit", "onConfirmSubmit", "onRecoverUnknownResult", "onReload", "onLogin",
  ]) expect(wxml).toContain(`${handler}`);
  for (const button of wxml.match(/<button\b[^>]*>/g) ?? []) {
    expect(button).toMatch(/bindtap="on[A-Za-z]+"/);
  }
  expect(styles).toMatch(/\.c2f-submit\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*justify-content:\s*center/s);
  expect(styles).toMatch(/\.c2f-scroll\s*\{[^}]*min-height:\s*0/s);
  expect(styles).toMatch(/env\(safe-area-inset-bottom,\s*0px\)/);
});

test("invalid routes fail closed and back performs real navigation", async () => {
  const { api } = register();
  for (const options of [{}, { game_id: "short" }, { game_id: GAME_ID, extra: "1" }]) {
    const page = loadPage();
    call(page, "onLoad", options);
    await flush();
    expect(page.data.status).toBe("NOT_FOUND");
  }
  expect(api.getMyReport).not.toHaveBeenCalled();
  const page = loadPage();
  await call(page, "onHeaderBack");
  expect(wx.redirectTo).toHaveBeenCalledWith(expect.objectContaining({
    url: "/pages/my-game-registrations/index",
  }));
});

test("validates locally, confirmation cancel is read-only, and confirm persists before POST", async () => {
  let persistedDuringSubmit: OpenGameReportAttempt | null = null;
  const registered = register({
    submit: jest.fn(async (attempt) => {
      persistedDuringSubmit = registered.store.load();
      expect(persistedDuringSubmit).toEqual(attempt);
      return submitted;
    }),
  });
  const page = loadPage();
  call(page, "onLoad", { game_id: GAME_ID });
  await flush();

  call(page, "onPrepareSubmit");
  expect(page.data).toMatchObject({ categoryError: "请选择举报类别", factsError: "请填写事实说明" });
  call(page, "onSelectCategory", { currentTarget: { dataset: { category: "FALSE_INFORMATION" } } });
  call(page, "onFactsInput", { detail: { value: "请联系 13800138000 核实" } });
  call(page, "onPrepareSubmit");
  expect(page.data.factsError).toContain("联系方式");
  call(page, "onFactsInput", { detail: { value: submitted.facts } });
  call(page, "onPrepareSubmit");
  expect(page.data.confirmationOpen).toBe(true);
  call(page, "onCancelSubmit");
  expect(page.data.confirmationOpen).toBe(false);
  expect(registered.api.submit).not.toHaveBeenCalled();

  call(page, "onPrepareSubmit");
  await call(page, "onConfirmSubmit");
  expect(registered.api.submit).toHaveBeenCalledTimes(1);
  expect(persistedDuringSubmit).not.toBeNull();
  expect(page.data).toMatchObject({ report: expect.objectContaining({ status: "PENDING" }), resultUnknown: false });
  expect(registered.store.load()).toBeNull();
});

test("unknown recovery GETs first and replays the original attempt at most once", async () => {
  const submitMock = jest.fn<OpenGameReportSource["submit"]>();
  submitMock.mockRejectedValueOnce(new OpenGameReportApiError("REPORT_RESULT_UNKNOWN"));
  submitMock.mockRejectedValueOnce(new OpenGameReportApiError("REPORT_RESULT_UNKNOWN"));
  const { api, store } = register({ submit: submitMock });
  const page = loadPage();
  call(page, "onLoad", { game_id: GAME_ID });
  await flush();
  call(page, "onSelectCategory", { currentTarget: { dataset: { category: submitted.category } } });
  call(page, "onFactsInput", { detail: { value: submitted.facts } });
  call(page, "onPrepareSubmit");
  await call(page, "onConfirmSubmit");
  expect(page.data.resultUnknown).toBe(true);
  const original = store.load();
  expect(original).toMatchObject({ replayed: false });

  await call(page, "onRecoverUnknownResult");
  expect(api.getMyReport).toHaveBeenCalledTimes(2);
  expect(submitMock).toHaveBeenCalledTimes(2);
  expect(submitMock.mock.calls[1][0]).toEqual({ ...original, replayed: true });
  expect(store.load()).toMatchObject({ replayed: true });

  await call(page, "onRecoverUnknownResult");
  expect(api.getMyReport).toHaveBeenCalledTimes(3);
  expect(submitMock).toHaveBeenCalledTimes(2);
  expect(page.data.resultUnknown).toBe(true);
});

test("unknown recovery accepts an existing authority without replay", async () => {
  let reads = 0;
  const { api, store } = register({
    getMyReport: jest.fn(async () => (++reads === 1 ? ready : reported)),
    submit: jest.fn(async () => { throw new OpenGameReportApiError("REPORT_RESULT_UNKNOWN"); }),
  });
  const page = loadPage();
  call(page, "onLoad", { game_id: GAME_ID });
  await flush();
  call(page, "onSelectCategory", { currentTarget: { dataset: { category: submitted.category } } });
  call(page, "onFactsInput", { detail: { value: submitted.facts } });
  call(page, "onPrepareSubmit");
  await call(page, "onConfirmSubmit");
  await call(page, "onRecoverUnknownResult");

  expect(api.submit).toHaveBeenCalledTimes(1);
  expect(store.load()).toBeNull();
  expect(page.data).toMatchObject({ resultUnknown: false, report: expect.objectContaining({ reportId: submitted.reportId }) });
});

test("same-account other game and foreign-account attempts never submit on this page", async () => {
  for (const pending of [
    {
      originatingUserId: USER_ID, gameId: OTHER_GAME_ID, body: {
        category: submitted.category, facts: submitted.facts,
      }, idempotencyKey: "game-report-other-000000000001", replayed: false,
    },
    {
      originatingUserId: OTHER_USER_ID, gameId: GAME_ID, body: {
        category: submitted.category, facts: submitted.facts,
      }, idempotencyKey: "game-report-foreign-0000000001", replayed: false,
    },
  ] satisfies OpenGameReportAttempt[]) {
    resetOpenGameReportSourceForTesting();
    resetOpenGameReportAttemptStoreForTesting();
    const registered = register();
    registered.store.begin(pending);
    const page = loadPage();
    call(page, "onLoad", { game_id: GAME_ID });
    await flush();
    expect(page.data.status).toBe(
      pending.originatingUserId === USER_ID ? "OTHER_PENDING" : "FOREIGN_PENDING",
    );
    expect(registered.api.submit).not.toHaveBeenCalled();
    expect(registered.store.load()).toEqual(pending);
  }
});

test("auth recovery compares the durable originating account and stale responses do not paint", async () => {
  currentUserId = null;
  const registered = register({
    getMyReport: jest.fn(async () => { throw new OpenGameReportApiError("AUTH_REQUIRED"); }),
    login: jest.fn(async () => { currentUserId = OTHER_USER_ID; return OTHER_USER_ID; }),
  });
  registered.store.begin({
    originatingUserId: USER_ID,
    gameId: GAME_ID,
    body: { category: submitted.category, facts: submitted.facts },
    idempotencyKey: "game-report-auth-0000000000001",
    replayed: false,
  });
  const page = loadPage();
  call(page, "onLoad", { game_id: GAME_ID });
  await flush();
  expect(page.data.status).toBe("AUTH_LOSS");
  await call(page, "onLogin");
  expect(page.data.status).toBe("FOREIGN_PENDING");
  expect(registered.store.load()).not.toBeNull();

  let resolve!: (value: OpenGameReportContext) => void;
  const delayed = new Promise<OpenGameReportContext>((done) => { resolve = done; });
  resetOpenGameReportSourceForTesting();
  registerOpenGameReportSource(source({ getMyReport: jest.fn(() => delayed) }));
  registered.store.clear();
  currentUserId = USER_ID;
  const stale = loadPage();
  call(stale, "onLoad", { game_id: GAME_ID });
  call(stale, "onHide");
  resolve(ready);
  await flush();
  expect(stale.data.status).toBe("LOADING");
});
