/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */

import { beforeEach, expect, jest, test } from "@jest/globals";
import { existsSync, readFileSync } from "node:fs";

import {
  decodeOpenGameApplicationDecisionResult,
  decodeOpenGameApplicationQueue,
} from "../../domain/open-game-registration-decoder";
import type {
  CaptainOpenGameApplication,
  OpenGameApplicationDecisionResult,
  OpenGameApplicationQueue,
} from "../../domain/open-game-registration";
import { OpenGameRegistrationApiError } from "../../services/http-open-game-registration";
import { createOpenGameRegistrationAttemptStore } from "../../services/open-game-registration-attempt-store";
import {
  registerOpenGameRegistrationAttemptStore,
  registerOpenGameRegistrationSource,
  resetOpenGameRegistrationAttemptStoreForTesting,
  resetOpenGameRegistrationSourceForTesting,
  type OpenGameRegistrationAttempt,
  type OpenGameRegistrationAttemptStore,
  type OpenGameRegistrationDecisionAttempt,
  type OpenGameRegistrationSource,
} from "../../services/open-game-registration";

type PageDefinition = Record<string, any> & { data: Record<string, any> };
type RuntimePage = PageDefinition & { setData(patch: Record<string, unknown>): void };

const SOURCE_PATH = "miniprogram/pages/captain-game-applications/index.ts";
const GAME_ID = "11111111-2222-4333-8444-555555555555";
const OTHER_GAME_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const USER_ID = "22222222-3333-4444-8555-666666666666";
const OTHER_USER_ID = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const OTHER_TOKEN = "1234567890_abcdefghijklmnopqrstu";

const fixture = (name: string): Record<string, unknown> => JSON.parse(
  readFileSync(`contracts/examples/${name}.json`, "utf8"),
) as Record<string, unknown>;
const pendingQueue = decodeOpenGameApplicationQueue(fixture("open-game-applications-pending"));
const emptyQueue = decodeOpenGameApplicationQueue(fixture("open-game-applications-empty"));
const fullWaitlistQueue = decodeOpenGameApplicationQueue(
  fixture("open-game-applications-full-waitlist"),
);
const joinedResult = decodeOpenGameApplicationDecisionResult(
  fixture("open-game-application-decision-joined"),
);
const rejectedResult = decodeOpenGameApplicationDecisionResult(
  fixture("open-game-application-decision-rejected"),
);
const waitlistedResult = decodeOpenGameApplicationDecisionResult(
  fixture("open-game-application-decision-waitlisted"),
);
const firstApplication = pendingQueue.applications[0]!;
const secondApplication = pendingQueue.applications[1]!;

let captured: PageDefinition | undefined;
let currentUserId: string | null;
let attemptStore: OpenGameRegistrationAttemptStore;

const call = (page: RuntimePage, method: string, ...args: unknown[]) => page[method](...args);
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function loadPage(): RuntimePage {
  expect(existsSync(SOURCE_PATH)).toBe(true);
  if (!existsSync(SOURCE_PATH)) throw new Error("production captain applications page is missing");
  if (!captured) {
    (globalThis as any).Page = (definition: PageDefinition) => { captured = definition; };
    jest.requireActual("./index");
  }
  return {
    ...captured!,
    data: structuredClone(captured!.data),
    setData(patch: Record<string, unknown>) { Object.assign(this.data, patch); },
    loadGeneration: 0,
    visible: true,
    skipNextShow: false,
    routeGameId: "",
    currentQueue: null,
    firstApplication: null,
    authorityUserId: null,
    panelSelection: null,
    unknownAttempt: null,
    pendingRoute: "",
    readInFlight: null,
    mutationInFlight: null,
    navigationInFlight: null,
  } as RuntimePage;
}

function registrationSource(
  overrides: Partial<OpenGameRegistrationSource> = {},
): OpenGameRegistrationSource {
  return {
    login: jest.fn(async () => {
      if (currentUserId === null) throw new OpenGameRegistrationApiError("LOGIN_FAILED");
      return currentUserId;
    }),
    currentUserId: jest.fn(() => currentUserId),
    getContext: jest.fn(),
    apply: jest.fn(),
    getPending: jest.fn(async () => pendingQueue),
    decide: jest.fn(async (attempt: OpenGameRegistrationDecisionAttempt) => {
      if (attempt.decision === "ACCEPT") return joinedResult;
      if (attempt.decision === "WAITLIST") return waitlistedResult;
      return rejectedResult;
    }),
    ...overrides,
  } as OpenGameRegistrationSource;
}

function registerSource(overrides: Partial<OpenGameRegistrationSource> = {}) {
  const api = registrationSource(overrides);
  registerOpenGameRegistrationSource(api);
  return api;
}

function decisionAttempt(
  overrides: Partial<OpenGameRegistrationDecisionAttempt> = {},
): OpenGameRegistrationDecisionAttempt {
  return {
    kind: "decision",
    originatingUserId: USER_ID,
    gameId: GAME_ID,
    applicationId: firstApplication.id,
    decision: "ACCEPT",
    expectedVersion: firstApplication.version,
    idempotencyKey: "decision-key-0000000000000001",
    ...overrides,
  };
}

function seedAttempt(
  attempt: OpenGameRegistrationAttempt = decisionAttempt(),
): OpenGameRegistrationAttempt {
  attemptStore.begin(attempt);
  return attempt;
}

function queue(
  applications: readonly CaptainOpenGameApplication[],
  pendingCount = applications.length,
  remainingSpots = 4,
): OpenGameApplicationQueue {
  return {
    remainingSpots,
    pendingCount,
    applications,
    waitlistCount: 0,
    waitlist: [],
  };
}

async function openPending(page: RuntimePage): Promise<void> {
  call(page, "onLoad", { game_id: GAME_ID });
  await flush();
  expect(page.data.status).toBe("READY");
  expect(page.data.hasPending).toBe(true);
}

function completeNavigation(options: unknown): void {
  (options as { success?: () => void }).success?.();
}

beforeEach(() => {
  resetOpenGameRegistrationSourceForTesting();
  resetOpenGameRegistrationAttemptStoreForTesting();
  currentUserId = USER_ID;
  const values = new Map<string, unknown>();
  attemptStore = createOpenGameRegistrationAttemptStore({
    get: (key) => values.get(key),
    set: (key, value) => { values.set(key, value); },
    remove: (key) => { values.delete(key); },
  });
  registerOpenGameRegistrationAttemptStore(attemptStore);
  (globalThis as any).wx = {
    getWindowInfo: jest.fn(() => ({ windowWidth: 375, statusBarHeight: 44 })),
    getMenuButtonBoundingClientRect: jest.fn(() => ({
      top: 48, left: 278, width: 87, height: 32,
    })),
    navigateBack: jest.fn(completeNavigation),
    navigateTo: jest.fn(completeNavigation),
    redirectTo: jest.fn(completeNavigation),
    reLaunch: jest.fn(completeNavigation),
  };
  (globalThis as any).getCurrentPages = jest.fn(() => [
    { route: "pages/captain-game-manage/index" },
    { route: "pages/captain-game-applications/index" },
  ]);
});

test("migrates the approved native review layout and backs every production button with a real handler", () => {
  loadPage();
  const json = readFileSync("miniprogram/pages/captain-game-applications/index.json", "utf8");
  const source = readFileSync(SOURCE_PATH, "utf8");
  const template = readFileSync("miniprogram/pages/captain-game-applications/index.wxml", "utf8");
  const styles = readFileSync("miniprogram/pages/captain-game-applications/index.wxss", "utf8");

  expect(JSON.parse(json)).toEqual({ navigationStyle: "custom" });
  expect(template).toContain("报名审核");
  expect(template).toContain("条待审核申请");
  expect(template).toContain("{{pendingCount}}");
  expect(template).toContain("仅展示申请人主动填写的本场信息");
  expect(source).toContain("确认接受加入？");
  expect(source).toContain("确认加入候补？");
  expect(source).toContain("确认婉拒申请？");
  expect(template).toContain("当前球局已满员");
  expect(template).toContain("可以按申请审核顺序加入候补，或婉拒本场申请");
  expect(template).not.toMatch(/Fixture|开发预览|preview|dev\/pages|c1a-scenario/);
  expect(template).not.toMatch(/返回预览入口|切换到申请人视角|角色切换/);
  expect(template).not.toContain("game.name");
  expect(template).not.toMatch(/application\.(?:id|version)/);
  expect(template).toMatch(/<button[^>]*wx:elif="{{canAccept}}"[^>]*bindtap="onAccept"/);
  expect(template).toMatch(/<button[^>]*wx:if="{{canWaitlist}}"[^>]*bindtap="onWaitlist"/);
  expect(template).toMatch(/<button[^>]*disabled="{{!canReject}}"[^>]*bindtap="onReject"/);
  const buttons = template.match(/<button\b[^>]*>/g) ?? [];
  expect(buttons.length).toBeGreaterThan(0);
  for (const button of buttons) expect(button).toMatch(/bindtap="[A-Za-z][A-Za-z0-9]*"/);
  for (const handler of [
    "onHeaderBack", "onReload", "onLogin", "onReturnNotFound", "onGoPending",
    "onClearPending", "onRefreshApplications", "onReturnManage", "onAccept", "onWaitlist",
    "onReject",
    "onClosePanel", "onConfirmDecision", "onConfirmDecisionResult", "onCloseUnknown",
  ]) expect(template).toContain(`bindtap="${handler}"`);

  expect(source).not.toMatch(/from\s+["']\.\.\/\.\.\/services\/open-game["']/);
  expect(source).not.toMatch(/\.sort\s*\(|\.shift\s*\(/);
  expect(styles).toMatch(/\.c1a-button\s*\{[^}]*min-height:\s*88rpx[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*justify-content:\s*center/s);
  expect(styles).toMatch(/\.c1a-icon-button\s*\{[^}]*min-height:\s*88rpx[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*justify-content:\s*center/s);
  expect(styles).toMatch(/\.c1a-footer\s*\{[^}]*position:\s*fixed[^}]*env\(safe-area-inset-bottom/s);
  expect(styles).toMatch(/\.c1a-scrim\s*\{[^}]*position:\s*fixed[^}]*env\(safe-area-inset-bottom/s);
  expect(styles).toMatch(/\.c1a-button--primary\s*\{[^}]*#0369A1/s);
  expect(styles).toMatch(/\.c1a-button--primary:active|\.c1a-button--primary\.button-hover/);
  expect(styles).toMatch(/\.c1a-button--secondary:active|\.c1a-button--secondary\.button-hover/);
  expect(styles).toMatch(/\.c1a-button--neutral:active|\.c1a-button--neutral\.button-hover/);
  expect(styles).toMatch(/\.c1a-button--primary\[disabled\]/);
  expect(template).toMatch(/class="[^"\n]*c1a-navigation-error[^"\n]*"/);
});

test("accepts exactly one UUID game_id and performs no read for mixed or malformed routes", async () => {
  const api = registerSource();
  for (const options of [
    {},
    { game_id: "not-a-uuid" },
    { game_id: GAME_ID.slice(1) },
    { game_id: GAME_ID, token: OTHER_TOKEN },
  ]) {
    const page = loadPage();
    call(page, "onLoad", options);
    await flush();
    expect(page.data.status).toBe("NOT_FOUND");
  }
  expect(api.getPending).not.toHaveBeenCalled();

  const valid = loadPage();
  await openPending(valid);
  expect(api.getPending).toHaveBeenCalledWith(GAME_ID);
});

test("preserves server order, shows pendingCount, renders only applications[0], and exposes exact privacy fields", async () => {
  const authoritative = queue([secondApplication, firstApplication], 7, 3);
  const api = registerSource({ getPending: jest.fn(async () => authoritative) });
  const page = loadPage();
  await openPending(page);

  expect(api.getPending).toHaveBeenCalledTimes(1);
  expect(page.data).toMatchObject({ pendingCount: 7, remainingSpots: 3, hasPending: true });
  expect(page.data.application.id).toBe(secondApplication.id);
  expect(Object.keys(page.data.application).sort()).toEqual([
    "allowedActions", "appliedAt", "displayName", "id", "note", "position", "version",
  ].sort());
  expect(Object.keys(page.data.application.allowedActions).sort()).toEqual([
    "acceptBlockedReason", "canAccept", "canWaitlist", "canReject", "rejectBlockedReason",
    "waitlistBlockedReason",
  ].sort());
  expect(JSON.stringify(page.data)).not.toContain(firstApplication.displayName);
  for (const forbidden of ["userId", "phone", "wechat", "avatar", "order", "payment", "rating"]) {
    expect(JSON.stringify(page.data).toLowerCase()).not.toContain(forbidden.toLowerCase());
  }
});

test("projects a UTC applied_at across midnight into the product Shanghai time zone", async () => {
  const utcApplication: CaptainOpenGameApplication = {
    ...firstApplication,
    appliedAt: "2026-08-23T16:18:00Z",
  };
  registerSource({ getPending: jest.fn(async () => queue([utcApplication], 1, 4)) });
  const page = loadPage();
  await openPending(page);

  expect(page.data.appliedAtLabel).toContain("8月24日");
  expect(page.data.appliedAtLabel).toContain("00:18");
  expect(page.data.appliedAtLabel).not.toContain("8月23日");
});

test("renders the authoritative empty state and returns to the real manage route", async () => {
  registerSource({ getPending: jest.fn(async () => emptyQueue) });
  (getCurrentPages as unknown as jest.Mock).mockReturnValue([
    { route: "pages/captain-game-applications/index" },
  ]);
  const page = loadPage();
  call(page, "onLoad", { game_id: GAME_ID });
  await flush();
  expect(page.data).toMatchObject({ status: "READY", pendingCount: 0, hasPending: false, empty: true });

  await call(page, "onReturnManage");
  expect(wx.redirectTo).toHaveBeenCalledWith(expect.objectContaining({
    url: `/pages/captain-game-manage/index?game_id=${GAME_ID}`,
  }));
});

test("opens and closes accept/reject confirmation without persisting or sending anything", async () => {
  const api = registerSource();
  const page = loadPage();
  await openPending(page);

  call(page, "onAccept");
  expect(page.data).toMatchObject({ panel: "ACCEPT", decisionTitle: "确认接受加入？" });
  expect(page.panelSelection).toEqual({
    applicationId: firstApplication.id,
    expectedVersion: firstApplication.version,
    decision: "ACCEPT",
  });
  call(page, "onClosePanel");
  expect(page.data.panel).toBeNull();
  call(page, "onReject");
  expect(page.data).toMatchObject({ panel: "REJECT", decisionTitle: "确认婉拒申请？" });
  call(page, "onClosePanel");
  expect(attemptStore.load()).toBeNull();
  expect(api.decide).not.toHaveBeenCalled();
});

test("a full application exposes only reject and waitlist, and opening its sheet performs no write", async () => {
  const api = registerSource({ getPending: jest.fn(async () => fullWaitlistQueue) });
  const page = loadPage();
  await openPending(page);

  expect(page.data).toMatchObject({
    canAccept: false,
    canWaitlist: true,
    canReject: true,
    fullWaitlist: true,
    blockerMessage: "",
  });
  call(page, "onAccept");
  expect(page.data.panel).toBeNull();
  call(page, "onWaitlist");
  expect(page.data).toMatchObject({
    panel: "WAITLIST",
    decisionTitle: "确认加入候补？",
    decisionCopy: "确认后将按本场不可复用的先后顺序排入候补，当前不会增加已加入人数。",
    decisionButton: "确认加入候补",
  });
  expect(page.panelSelection).toEqual({
    applicationId: fullWaitlistQueue.applications[0]!.id,
    expectedVersion: fullWaitlistQueue.applications[0]!.version,
    decision: "WAITLIST",
  });
  call(page, "onClosePanel");
  expect(attemptStore.load()).toBeNull();
  expect(api.decide).not.toHaveBeenCalled();
});

test("uses allowedActions alone: disabled waitlist stays hidden and remainingSpots never enables accept", async () => {
  const fullApplication: CaptainOpenGameApplication = {
    ...firstApplication,
    allowedActions: {
      canAccept: false,
      acceptBlockedReason: "GAME_FULL",
      canWaitlist: false,
      waitlistBlockedReason: "WAITLIST_NOT_ENABLED",
      canReject: true,
      rejectBlockedReason: null,
    },
  };
  registerSource({ getPending: jest.fn(async () => queue([fullApplication], 1, 12)) });
  const full = loadPage();
  await openPending(full);
  expect(full.data).toMatchObject({
    canAccept: false,
    canWaitlist: false,
    canReject: true,
    fullWaitlist: false,
    remainingSpots: 12,
  });
  call(full, "onAccept");
  expect(full.data.panel).toBeNull();
  call(full, "onWaitlist");
  expect(full.data.panel).toBeNull();
  call(full, "onReject");
  expect(full.data.panel).toBe("REJECT");

  resetOpenGameRegistrationSourceForTesting();
  const allowedAtZero: CaptainOpenGameApplication = {
    ...firstApplication,
    allowedActions: {
      canAccept: true,
      acceptBlockedReason: null,
      canWaitlist: false,
      waitlistBlockedReason: "GAME_NOT_FULL",
      canReject: true,
      rejectBlockedReason: null,
    },
  };
  registerSource({ getPending: jest.fn(async () => queue([allowedAtZero], 1, 0)) });
  const strange = loadPage();
  await openPending(strange);
  call(strange, "onAccept");
  expect(strange.data.panel).toBe("ACCEPT");
});

test("persists a WAITLIST attempt before one POST, then clears it and authoritatively reloads", async () => {
  let resolveDecision!: (result: OpenGameApplicationDecisionResult) => void;
  const pendingDecision = new Promise<OpenGameApplicationDecisionResult>(
    (resolve) => { resolveDecision = resolve; },
  );
  let reads = 0;
  const api = registerSource({
    getPending: jest.fn(async () => {
      reads += 1;
      return reads === 1 ? fullWaitlistQueue : emptyQueue;
    }),
    decide: jest.fn((attempt: OpenGameRegistrationDecisionAttempt) => {
      expect(attemptStore.load()).toEqual(attempt);
      return pendingDecision;
    }),
  });
  const page = loadPage();
  await openPending(page);
  call(page, "onWaitlist");
  const first = call(page, "onConfirmDecision");
  const duplicate = call(page, "onConfirmDecision");
  const stored = attemptStore.load();

  expect(api.decide).toHaveBeenCalledTimes(1);
  expect(stored).toMatchObject({
    kind: "decision",
    originatingUserId: USER_ID,
    gameId: GAME_ID,
    applicationId: fullWaitlistQueue.applications[0]!.id,
    decision: "WAITLIST",
    expectedVersion: fullWaitlistQueue.applications[0]!.version,
  });
  resolveDecision(waitlistedResult);
  await first;
  await duplicate;

  expect(attemptStore.load()).toBeNull();
  expect(api.getPending).toHaveBeenCalledTimes(2);
  expect(page.data).toMatchObject({
    status: "READY",
    hasPending: false,
    noticeMessage: "已将上一条申请加入候补，并读取最新待审核列表。",
  });
});

test("freezes the selected id/version/decision and never confirms a changed first item", async () => {
  let reads = 0;
  const api = registerSource({
    getPending: jest.fn(async () => {
      reads += 1;
      return reads === 1 ? pendingQueue : queue([secondApplication], 1, 4);
    }),
  });
  const page = loadPage();
  await openPending(page);
  call(page, "onAccept");
  await call(page, "onReload");
  expect(page.data.application.id).toBe(secondApplication.id);
  await call(page, "onConfirmDecision");
  expect(api.decide).not.toHaveBeenCalled();
  expect(attemptStore.load()).toBeNull();
  expect(page.data.panel).toBeNull();
});

test("persists before one POST, suppresses duplicate confirmation, then clears and reloads the authoritative next item", async () => {
  let resolveDecision!: (result: OpenGameApplicationDecisionResult) => void;
  const pendingDecision = new Promise<OpenGameApplicationDecisionResult>(
    (resolve) => { resolveDecision = resolve; },
  );
  let reads = 0;
  const api = registerSource({
    getPending: jest.fn(async () => {
      reads += 1;
      return reads === 1 ? pendingQueue : queue([secondApplication], 1, 3);
    }),
    decide: jest.fn((attempt: OpenGameRegistrationDecisionAttempt) => {
      expect(attemptStore.load()).toEqual(attempt);
      return pendingDecision;
    }),
  });
  const page = loadPage();
  await openPending(page);
  call(page, "onAccept");
  const first = call(page, "onConfirmDecision");
  const duplicate = call(page, "onConfirmDecision");
  const stored = attemptStore.load();

  expect(api.decide).toHaveBeenCalledTimes(1);
  expect(stored).toMatchObject({
    kind: "decision",
    originatingUserId: USER_ID,
    gameId: GAME_ID,
    applicationId: firstApplication.id,
    decision: "ACCEPT",
    expectedVersion: firstApplication.version,
  });
  expect((api.decide as jest.Mock).mock.calls[0]?.[0]).toEqual(stored);

  resolveDecision(joinedResult);
  await first;
  await duplicate;
  expect(attemptStore.load()).toBeNull();
  expect(api.getPending).toHaveBeenCalledTimes(2);
  expect(page.data).toMatchObject({ status: "READY", pendingCount: 1 });
  expect(page.data.application.id).toBe(secondApplication.id);
});

test("a local persistence failure sends no decision", async () => {
  resetOpenGameRegistrationAttemptStoreForTesting();
  registerOpenGameRegistrationAttemptStore({
    load: () => null,
    begin: () => { throw new Error("LOCAL_WRITE_FAILED"); },
    resolveForUser: () => null,
    clear: jest.fn(),
  });
  const api = registerSource();
  const page = loadPage();
  await openPending(page);
  call(page, "onAccept");
  await call(page, "onConfirmDecision");

  expect(page.data.status).toBe("LOAD_ERROR");
  expect(api.decide).not.toHaveBeenCalled();
});

test("an account change after the panel opens cannot persist or send under stale queue authority", async () => {
  const api = registerSource();
  const page = loadPage();
  await openPending(page);
  call(page, "onAccept");
  currentUserId = OTHER_USER_ID;
  await call(page, "onConfirmDecision");

  expect(page.data.status).toBe("AUTH_LOSS");
  expect(attemptStore.load()).toBeNull();
  expect(api.decide).not.toHaveBeenCalled();
});

test("an active late success cannot clear a replacement durable record or continue as normal", async () => {
  let resolveDecision!: (result: OpenGameApplicationDecisionResult) => void;
  const pendingDecision = new Promise<OpenGameApplicationDecisionResult>(
    (resolve) => { resolveDecision = resolve; },
  );
  const api = registerSource({ decide: jest.fn(() => pendingDecision) });
  const page = loadPage();
  await openPending(page);
  call(page, "onAccept");
  const request = call(page, "onConfirmDecision");
  attemptStore.clear();
  const replacement = seedAttempt(decisionAttempt({
    gameId: OTHER_GAME_ID,
    idempotencyKey: "decision-replacement-000000001",
  }));
  resolveDecision(joinedResult);
  await request;

  expect(attemptStore.load()).toEqual(replacement);
  expect(api.getPending).toHaveBeenCalledTimes(1);
  expect(page.data.status).toBe("OTHER_PENDING");
});

test("an active definitive error also reclassifies a replacement durable record before changing UI state", async () => {
  let rejectDecision!: (error: Error) => void;
  const pendingDecision = new Promise<OpenGameApplicationDecisionResult>(
    (_resolve, reject) => { rejectDecision = reject; },
  );
  const api = registerSource({ decide: jest.fn(() => pendingDecision) });
  const page = loadPage();
  await openPending(page);
  call(page, "onAccept");
  const request = call(page, "onConfirmDecision");
  attemptStore.clear();
  const replacement = seedAttempt(decisionAttempt({
    gameId: OTHER_GAME_ID,
    idempotencyKey: "decision-error-replacement-00001",
  }));
  rejectDecision(new OpenGameRegistrationApiError("APPLICATION_CAPACITY_CHANGED", {
    remainingSpots: 0,
    allowedActions: {
      canAccept: false,
      acceptBlockedReason: "GAME_FULL",
      canWaitlist: false,
      waitlistBlockedReason: "WAITLIST_NOT_ENABLED",
      canReject: true,
      rejectBlockedReason: null,
    },
  }));
  await request;

  expect(attemptStore.load()).toEqual(replacement);
  expect(api.getPending).toHaveBeenCalledTimes(1);
  expect(page.data.status).toBe("OTHER_PENDING");
});

test.each(["load", "clear"] as const)(
  "a storage %s exception while reconciling a definitive error is contained as unknown",
  async (failure) => {
    let failLoad = false;
    let failClear = false;
    resetOpenGameRegistrationAttemptStoreForTesting();
    registerOpenGameRegistrationAttemptStore({
      load: () => {
        if (failLoad) throw new Error("LOCAL_LOAD_FAILED");
        return attemptStore.load();
      },
      begin: (attempt) => attemptStore.begin(attempt),
      resolveForUser: (userId) => attemptStore.resolveForUser(userId),
      clear: () => {
        if (failClear) throw new Error("LOCAL_CLEAR_FAILED");
        attemptStore.clear();
      },
    });
    let rejectDecision!: (error: Error) => void;
    const pendingDecision = new Promise<OpenGameApplicationDecisionResult>(
      (_resolve, reject) => { rejectDecision = reject; },
    );
    const api = registerSource({ decide: jest.fn(() => pendingDecision) });
    const page = loadPage();
    await openPending(page);
    call(page, "onReject");
    const request = call(page, "onConfirmDecision");
    failLoad = failure === "load";
    failClear = failure === "clear";
    rejectDecision(new OpenGameRegistrationApiError("APPLICATION_STATE_CHANGED"));

    await expect(request).resolves.toBeUndefined();
    expect(page.data.status).toBe("RESULT_UNKNOWN");
    expect(api.getPending).toHaveBeenCalledTimes(1);
    expect(attemptStore.load()).not.toBeNull();
  },
);

test("successful rejection clears its exact attempt and also reloads the next server item", async () => {
  let reads = 0;
  const api = registerSource({
    getPending: jest.fn(async () => {
      reads += 1;
      return reads === 1 ? pendingQueue : queue([secondApplication], 1, 4);
    }),
    decide: jest.fn(async () => rejectedResult),
  });
  const page = loadPage();
  await openPending(page);
  call(page, "onReject");
  await call(page, "onConfirmDecision");

  expect(api.decide).toHaveBeenCalledWith(expect.objectContaining({
    decision: "REJECT",
    applicationId: firstApplication.id,
    expectedVersion: firstApplication.version,
  }));
  expect(attemptStore.load()).toBeNull();
  expect(api.getPending).toHaveBeenCalledTimes(2);
  expect(page.data.application.id).toBe(secondApplication.id);
});

test("capacity conflict preserves the current row and requires an explicit authoritative refresh", async () => {
  const blockedActions = {
    canAccept: false as const,
    acceptBlockedReason: "GAME_FULL" as const,
    canWaitlist: true as const,
    waitlistBlockedReason: null,
    canReject: true as const,
    rejectBlockedReason: null,
  };
  let reads = 0;
  const refreshed = queue([{ ...firstApplication, allowedActions: blockedActions }], 1, 0);
  const api = registerSource({
    getPending: jest.fn(async () => {
      reads += 1;
      return reads === 1 ? pendingQueue : refreshed;
    }),
    decide: jest.fn(async () => {
      throw new OpenGameRegistrationApiError("APPLICATION_CAPACITY_CHANGED", {
        remainingSpots: 0,
        allowedActions: blockedActions,
      });
    }),
  });
  const page = loadPage();
  await openPending(page);
  call(page, "onAccept");
  await call(page, "onConfirmDecision");

  expect(page.data).toMatchObject({
    status: "CAPACITY_CHANGED",
    remainingSpots: 0,
    canAccept: false,
    canWaitlist: true,
    canReject: true,
  });
  expect(page.data.application.id).toBe(firstApplication.id);
  expect(api.getPending).toHaveBeenCalledTimes(1);
  expect(attemptStore.load()).toBeNull();

  await call(page, "onRefreshApplications");
  expect(api.getPending).toHaveBeenCalledTimes(2);
  expect(page.data.application.id).toBe(firstApplication.id);
  expect(api.decide).toHaveBeenCalledTimes(1);
  call(page, "onWaitlist");
  expect(page.data.panel).toBe("WAITLIST");
});

test("state conflict never shifts locally and automatically rereads the authoritative queue", async () => {
  let reads = 0;
  const api = registerSource({
    getPending: jest.fn(async () => {
      reads += 1;
      return reads === 1 ? pendingQueue : queue([firstApplication], 1, 4);
    }),
    decide: jest.fn(async () => {
      throw new OpenGameRegistrationApiError("APPLICATION_STATE_CHANGED");
    }),
  });
  const page = loadPage();
  await openPending(page);
  call(page, "onReject");
  await call(page, "onConfirmDecision");

  expect(api.getPending).toHaveBeenCalledTimes(2);
  expect(page.data.application.id).toBe(firstApplication.id);
  expect(page.data.status).toBe("READY");
  expect(page.data.noticeMessage).toContain("状态已变化");
  expect(attemptStore.load()).toBeNull();
});

test("unknown decision preserves and replays the exact durable attempt key", async () => {
  let sends = 0;
  let reads = 0;
  const api = registerSource({
    getPending: jest.fn(async () => {
      reads += 1;
      return reads === 1 ? pendingQueue : queue([secondApplication], 1, 3);
    }),
    decide: jest.fn(async () => {
      sends += 1;
      if (sends === 1) throw new OpenGameRegistrationApiError("APPLICATION_RESULT_UNKNOWN");
      return joinedResult;
    }),
  });
  const page = loadPage();
  await openPending(page);
  call(page, "onAccept");
  await call(page, "onConfirmDecision");
  const original = attemptStore.load();
  expect(page.data.status).toBe("RESULT_UNKNOWN");
  expect(original).not.toBeNull();

  await call(page, "onConfirmDecisionResult");
  expect(api.decide).toHaveBeenCalledTimes(2);
  expect((api.decide as jest.Mock).mock.calls[1]?.[0]).toEqual(original);
  expect(attemptStore.load()).toBeNull();
  expect(api.getPending).toHaveBeenCalledTimes(3);
  expect((api.getPending as jest.Mock).mock.invocationCallOrder[1])
    .toBeLessThan((api.decide as jest.Mock).mock.invocationCallOrder[1]!);
});

test("a waitlist result stays unknown even when the read queue already projects the row without a version", async () => {
  const application = fullWaitlistQueue.applications[0]!;
  const projectedWaitlist = {
    ...emptyQueue,
    remainingSpots: 0,
    waitlistCount: 1,
    waitlist: [{
      id: application.id,
      displayName: application.displayName,
      position: application.position,
      note: application.note,
      appliedAt: application.appliedAt,
      waitlistedAt: waitlistedResult.decidedAt!,
      waitlistPosition: 1,
    }],
  };
  let reads = 0;
  let sends = 0;
  const api = registerSource({
    getPending: jest.fn(async () => {
      reads += 1;
      if (reads === 1) return fullWaitlistQueue;
      if (reads === 2) return projectedWaitlist;
      return emptyQueue;
    }),
    decide: jest.fn(async () => {
      sends += 1;
      if (sends === 1) throw new OpenGameRegistrationApiError("APPLICATION_RESULT_UNKNOWN");
      return waitlistedResult;
    }),
  });
  const page = loadPage();
  await openPending(page);
  call(page, "onWaitlist");
  await call(page, "onConfirmDecision");
  const original = attemptStore.load();
  expect(original).toMatchObject({ decision: "WAITLIST" });

  await call(page, "onConfirmDecisionResult");
  expect(api.decide).toHaveBeenCalledTimes(2);
  expect((api.decide as jest.Mock).mock.calls[1]?.[0]).toEqual(original);
  expect(attemptStore.load()).toBeNull();
  expect(api.getPending).toHaveBeenCalledTimes(3);
  expect((api.getPending as jest.Mock).mock.invocationCallOrder[1])
    .toBeLessThan((api.decide as jest.Mock).mock.invocationCallOrder[1]!);
});

test("401 preserves the attempt; explicit same-account login reloads before an explicit same-key replay", async () => {
  let sends = 0;
  const api = registerSource({
    decide: jest.fn(async () => {
      sends += 1;
      if (sends === 1) throw new OpenGameRegistrationApiError("AUTH_REQUIRED");
      return joinedResult;
    }),
  });
  const page = loadPage();
  await openPending(page);
  call(page, "onAccept");
  await call(page, "onConfirmDecision");
  const original = attemptStore.load();
  expect(page.data.status).toBe("AUTH_LOSS");

  await call(page, "onLogin");
  expect(api.login).toHaveBeenCalledTimes(1);
  expect(api.getPending).toHaveBeenCalledTimes(2);
  expect(api.decide).toHaveBeenCalledTimes(1);
  expect(page.data.status).toBe("RESULT_UNKNOWN");

  await call(page, "onConfirmDecisionResult");
  expect(api.decide).toHaveBeenCalledTimes(2);
  expect((api.decide as jest.Mock).mock.calls[1]?.[0]).toEqual(original);
});

test("a different account after login never rebinds, clears, or replays the original decision", async () => {
  const api = registerSource({
    decide: jest.fn(async () => { throw new OpenGameRegistrationApiError("AUTH_REQUIRED"); }),
    login: jest.fn(async () => {
      currentUserId = OTHER_USER_ID;
      return OTHER_USER_ID;
    }),
  });
  const page = loadPage();
  await openPending(page);
  call(page, "onAccept");
  await call(page, "onConfirmDecision");
  const original = attemptStore.load();
  await call(page, "onLogin");

  expect(page.data.status).toBe("FOREIGN_PENDING");
  expect(api.decide).toHaveBeenCalledTimes(1);
  expect(attemptStore.load()).toEqual(original);
});

test.each([
  "OPEN_GAME_NOT_FOUND",
  "APPLICATION_NOT_FOUND",
] as const)("handles symmetric decision 404 %s without false success", async (code) => {
  const api = registerSource({
    decide: jest.fn(async () => { throw new OpenGameRegistrationApiError(code); }),
  });
  const page = loadPage();
  await openPending(page);
  call(page, "onReject");
  await call(page, "onConfirmDecision");
  expect(page.data.status).toBe("NOT_FOUND");
  expect(attemptStore.load()).toBeNull();
  expect(api.getPending).toHaveBeenCalledTimes(1);
});

test("read service failure has a real coalesced retry and authentication loss has explicit login", async () => {
  let reads = 0;
  const api = registerSource({
    getPending: jest.fn(async () => {
      reads += 1;
      if (reads === 1) throw new OpenGameRegistrationApiError("SERVICE_UNAVAILABLE");
      return pendingQueue;
    }),
  });
  const page = loadPage();
  call(page, "onLoad", { game_id: GAME_ID });
  await flush();
  expect(page.data.status).toBe("LOAD_ERROR");
  const first = call(page, "onReload");
  const duplicate = call(page, "onReload");
  await first;
  await duplicate;
  expect(api.getPending).toHaveBeenCalledTimes(2);
  expect(page.data.status).toBe("READY");

  resetOpenGameRegistrationSourceForTesting();
  const auth = registerSource({
    getPending: jest.fn(async () => { throw new OpenGameRegistrationApiError("AUTH_REQUIRED"); }),
  });
  const authPage = loadPage();
  call(authPage, "onLoad", { game_id: GAME_ID });
  await flush();
  expect(authPage.data.status).toBe("AUTH_LOSS");
  await call(authPage, "onLogin");
  expect(auth.login).toHaveBeenCalledTimes(1);
});

test("queue 404 enters the same not-found return flow and uses history when available", async () => {
  registerSource({
    getPending: jest.fn(async () => { throw new OpenGameRegistrationApiError("OPEN_GAME_NOT_FOUND"); }),
  });
  const page = loadPage();
  call(page, "onLoad", { game_id: GAME_ID });
  await flush();
  expect(page.data.status).toBe("NOT_FOUND");
  await call(page, "onReturnNotFound");
  expect(wx.navigateBack).toHaveBeenCalledWith(expect.objectContaining({ delta: 1 }));
});

test("hide/unload invalidates late reads and decisions without clearing the durable attempt", async () => {
  let resolveRead!: (value: OpenGameApplicationQueue) => void;
  const pendingRead = new Promise<OpenGameApplicationQueue>((resolve) => { resolveRead = resolve; });
  registerSource({ getPending: jest.fn(() => pendingRead) });
  const loading = loadPage();
  call(loading, "onLoad", { game_id: GAME_ID });
  call(loading, "onHide");
  resolveRead(pendingQueue);
  await flush();
  expect(loading.data.status).toBe("LOADING");

  resetOpenGameRegistrationSourceForTesting();
  let resolveDecision!: (value: OpenGameApplicationDecisionResult) => void;
  const pendingDecision = new Promise<OpenGameApplicationDecisionResult>(
    (resolve) => { resolveDecision = resolve; },
  );
  const api = registerSource({ decide: jest.fn(() => pendingDecision) });
  const deciding = loadPage();
  await openPending(deciding);
  call(deciding, "onAccept");
  const request = call(deciding, "onConfirmDecision");
  const original = attemptStore.load();
  call(deciding, "onUnload");
  resolveDecision(joinedResult);
  await request;
  expect(api.decide).toHaveBeenCalledTimes(1);
  expect(api.getPending).toHaveBeenCalledTimes(1);
  expect(attemptStore.load()).toEqual(original);
});

test("same-account restart preserves the current-game decision and waits for explicit confirmation", async () => {
  const original = seedAttempt();
  const api = registerSource();
  const page = loadPage();
  call(page, "onLoad", { game_id: GAME_ID });
  await flush();

  expect(page.data.status).toBe("RESULT_UNKNOWN");
  expect(attemptStore.load()).toEqual(original);
  expect(api.decide).not.toHaveBeenCalled();
});

test.each([
  [
    decisionAttempt({ gameId: OTHER_GAME_ID, idempotencyKey: "decision-other-game-00000001" }),
    `/pages/captain-game-applications/index?game_id=${OTHER_GAME_ID}`,
  ],
  [
    {
      kind: "apply" as const,
      originatingUserId: USER_ID,
      shareToken: OTHER_TOKEN,
      body: {
        displayName: "周末小翼",
        position: "FORWARD" as const,
        note: null,
        adultConfirmed: true as const,
        riskConfirmed: true as const,
      },
      idempotencyKey: "application-other-token-000001",
    },
    `/pages/captain-game-public/index?token=${OTHER_TOKEN}`,
  ],
] as const)("same-account work for another resource navigates to its deterministic recovery route", async (attempt, route) => {
  seedAttempt(attempt);
  const api = registerSource();
  const page = loadPage();
  call(page, "onLoad", { game_id: GAME_ID });
  await flush();
  expect(page.data.status).toBe("OTHER_PENDING");

  await call(page, "onGoPending");
  expect(wx.redirectTo).toHaveBeenCalledWith(expect.objectContaining({ url: route }));
  expect(api.decide).not.toHaveBeenCalled();
  expect(attemptStore.load()).toEqual(attempt);
});

test("foreign work is never sent; clear rereads ownership before removing only a still-foreign record", async () => {
  const original = seedAttempt(decisionAttempt({ originatingUserId: OTHER_USER_ID }));
  const api = registerSource();
  const page = loadPage();
  call(page, "onLoad", { game_id: GAME_ID });
  await flush();
  expect(page.data.status).toBe("FOREIGN_PENDING");
  expect(api.decide).not.toHaveBeenCalled();

  attemptStore.clear();
  const nowOwned = seedAttempt(decisionAttempt({ idempotencyKey: "decision-now-owned-000000001" }));
  await call(page, "onClearPending");
  expect(attemptStore.load()).toEqual(nowOwned);
  expect(page.data.status).toBe("RESULT_UNKNOWN");

  attemptStore.clear();
  seedAttempt(original);
  page.setData({ status: "FOREIGN_PENDING" });
  await call(page, "onClearPending");
  expect(attemptStore.load()).toBeNull();
  expect(api.getPending).toHaveBeenCalledTimes(2);
  expect(api.decide).not.toHaveBeenCalled();
});

test("normal back, 404 return, and unknown close use real fallbacks while unknown close preserves the attempt", async () => {
  registerSource({ getPending: jest.fn(async () => emptyQueue) });
  const normal = loadPage();
  call(normal, "onLoad", { game_id: GAME_ID });
  await flush();
  await call(normal, "onHeaderBack");
  expect(wx.navigateBack).toHaveBeenCalledWith(expect.objectContaining({ delta: 1 }));

  (getCurrentPages as unknown as jest.Mock).mockReturnValue([
    { route: "pages/captain-game-applications/index" },
  ]);
  const deepLink = loadPage();
  call(deepLink, "onLoad", { game_id: GAME_ID });
  await flush();
  await call(deepLink, "onHeaderBack");
  expect(wx.redirectTo).toHaveBeenCalledWith(expect.objectContaining({
    url: `/pages/captain-game-manage/index?game_id=${GAME_ID}`,
  }));

  const missing = loadPage();
  call(missing, "onLoad", { game_id: "bad" });
  await call(missing, "onReturnNotFound");
  expect(wx.reLaunch).toHaveBeenCalledWith(expect.objectContaining({
    url: "/pages/intent-entry/index",
  }));

  const original = seedAttempt();
  (getCurrentPages as unknown as jest.Mock).mockReturnValue([
    { route: "pages/captain-game-manage/index" },
    { route: "pages/captain-game-applications/index" },
  ]);
  const unknown = loadPage();
  call(unknown, "onLoad", { game_id: GAME_ID });
  await flush();
  expect(unknown.data.status).toBe("RESULT_UNKNOWN");
  await call(unknown, "onCloseUnknown");
  expect(attemptStore.load()).toEqual(original);
  expect(wx.navigateBack).toHaveBeenLastCalledWith(expect.objectContaining({ delta: 1 }));

  (getCurrentPages as unknown as jest.Mock).mockReturnValue([
    { route: "pages/captain-game-applications/index" },
  ]);
  await call(unknown, "onCloseUnknown");
  expect(wx.redirectTo).toHaveBeenLastCalledWith(expect.objectContaining({
    url: `/pages/captain-game-manage/index?game_id=${GAME_ID}`,
  }));
});

test("failed real navigation remains visibly retryable inline", async () => {
  const failNavigation = (options: unknown) => {
    (options as { fail?: (error: Error) => void }).fail?.(new Error("NAV_FAILED"));
  };
  registerSource({ getPending: jest.fn(async () => emptyQueue) });
  (getCurrentPages as unknown as jest.Mock).mockReturnValue([
    { route: "pages/captain-game-applications/index" },
  ]);
  (wx.redirectTo as unknown as jest.Mock).mockImplementation(failNavigation);
  const page = loadPage();
  call(page, "onLoad", { game_id: GAME_ID });
  await flush();

  await call(page, "onReturnManage");
  expect(page.data.navigationError).toContain("暂时无法返回球局管理");

  seedAttempt(decisionAttempt({ gameId: OTHER_GAME_ID }));
  page.pendingRoute = `/pages/captain-game-applications/index?game_id=${OTHER_GAME_ID}`;
  page.setData({ status: "OTHER_PENDING" });
  (wx.reLaunch as unknown as jest.Mock).mockImplementation(failNavigation);
  await call(page, "onGoPending");
  expect(page.data.navigationError).toContain("暂时无法前往确认");
});

test.each([
  ["IDEMPOTENCY_KEY_REUSED", "CONFLICT"],
  ["INVALID_ARGUMENT", "READY"],
] as const)("definite %s clears the attempt without inventing a decision", async (code, status) => {
  const api = registerSource({
    decide: jest.fn(async () => {
      throw code === "INVALID_ARGUMENT"
        ? new OpenGameRegistrationApiError("INVALID_ARGUMENT")
        : new OpenGameRegistrationApiError("IDEMPOTENCY_KEY_REUSED");
    }),
  });
  const page = loadPage();
  await openPending(page);
  call(page, "onReject");
  await call(page, "onConfirmDecision");
  expect(page.data.status).toBe(status);
  expect(attemptStore.load()).toBeNull();
  expect(api.decide).toHaveBeenCalledTimes(1);
  expect(api.getPending).toHaveBeenCalledTimes(code === "INVALID_ARGUMENT" ? 2 : 1);
});
