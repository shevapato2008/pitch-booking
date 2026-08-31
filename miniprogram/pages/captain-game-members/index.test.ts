/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */

import { existsSync, readFileSync } from "node:fs";
import { beforeEach, expect, jest, test } from "@jest/globals";

import type {
  OpenGameMemberRemovalResult,
  OpenGameMemberRoster,
} from "../../domain/open-game-registration";
import { OpenGameRegistrationApiError } from "../../services/http-open-game-registration";
import {
  registerOpenGameRegistrationAttemptStore,
  registerOpenGameRegistrationSource,
  resetOpenGameRegistrationAttemptStoreForTesting,
  resetOpenGameRegistrationSourceForTesting,
  type OpenGameMemberRemoveAttempt,
  type OpenGameRegistrationSource,
} from "../../services/open-game-registration";
import { createOpenGameRegistrationAttemptStore } from "../../services/open-game-registration-attempt-store";
import type { SessionStorage } from "../../services/session-store";

type PageDefinition = Record<string, any> & { data: Record<string, any> };
type RuntimePage = PageDefinition & { setData(patch: Record<string, unknown>): void };

const GAME_ID = "00000000-0000-4000-8000-000000000501";
const OTHER_GAME_ID = "00000000-0000-4000-8000-000000000502";
const USER_ID = "00000000-0000-4000-8000-000000000503";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000504";
const MEMBER_ID = "00000000-0000-4000-8000-000000000511";
const BLOCKED_ID = "00000000-0000-4000-8000-000000000512";

const sourcePath = "miniprogram/pages/captain-game-members/index.ts";
const templatePath = sourcePath.replace(/\.ts$/, ".wxml");
const stylesPath = sourcePath.replace(/\.ts$/, ".wxss");
const configPath = sourcePath.replace(/\.ts$/, ".json");

let captured: PageDefinition | undefined;
let currentUserId: string | null;
let values: Map<string, unknown>;
let attemptStore: ReturnType<typeof createOpenGameRegistrationAttemptStore>;

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function call(page: RuntimePage, method: string, ...args: unknown[]) {
  return page[method](...args);
}

function loadPage(): RuntimePage {
  if (!captured) {
    expect(existsSync(sourcePath)).toBe(true);
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
    currentRoster: null,
    authorityUserId: null,
    removalSelection: null,
    unknownAttempt: null,
    pendingRoute: "",
    readInFlight: null,
    mutationInFlight: null,
    navigationInFlight: null,
  } as RuntimePage;
}

function roster(overrides: Partial<OpenGameMemberRoster> = {}): OpenGameMemberRoster {
  return {
    game: {
      id: GAME_ID,
      name: "海河周六轻松局",
      venueName: "天津河东体育中心",
      pitchName: "笼式五人制 2 号场",
      startsAt: "2026-09-05T09:00:00+08:00",
      endsAt: "2026-09-05T10:30:00+08:00",
      timeZone: "Asia/Shanghai",
      state: "PUBLISHED",
    },
    joinedCount: 2,
    remainingSpots: 0,
    waitlistCount: 1,
    members: [
      {
        registrationId: MEMBER_ID,
        displayName: "左边锋小王",
        position: "FORWARD",
        joinedAt: "2026-09-01T10:00:00+08:00",
        promotedFromWaitlist: false,
        version: 4,
        allowedActions: { canRemove: true, removeBlockedReason: null },
      },
      {
        registrationId: BLOCKED_ID,
        displayName: "中场阿杰",
        position: "MIDFIELDER",
        joinedAt: "2026-09-01T10:30:00+08:00",
        promotedFromWaitlist: true,
        version: 3,
        allowedActions: {
          canRemove: false,
          removeBlockedReason: "ATTENDANCE_RECORDED",
        },
      },
    ],
    ...overrides,
  };
}

function result(
  attempt: OpenGameMemberRemoveAttempt,
  overrides: Partial<OpenGameMemberRemovalResult> = {},
): OpenGameMemberRemovalResult {
  return {
    removedRegistrationId: attempt.registrationId,
    removedDisplayName: "左边锋小王",
    status: "REMOVED",
    version: attempt.expectedVersion + 1,
    removedAt: "2026-09-01T11:00:00+08:00",
    joinedCount: 2,
    remainingSpots: 0,
    waitlistCount: 0,
    promotedMember: {
      registrationId: "00000000-0000-4000-8000-000000000513",
      displayName: "候补小林",
      position: "DEFENDER",
      version: 3,
    },
    ...overrides,
  };
}

function afterRemoval(): OpenGameMemberRoster {
  return roster({
    waitlistCount: 0,
    members: [
      roster().members[1],
      {
        registrationId: "00000000-0000-4000-8000-000000000513",
        displayName: "候补小林",
        position: "DEFENDER",
        joinedAt: "2026-09-01T11:00:00+08:00",
        promotedFromWaitlist: true,
        version: 3,
        allowedActions: { canRemove: true, removeBlockedReason: null },
      },
    ],
  });
}

function source(overrides: Partial<OpenGameRegistrationSource> = {}): OpenGameRegistrationSource {
  return {
    login: jest.fn(async () => { currentUserId = USER_ID; return USER_ID; }),
    currentUserId: jest.fn(() => currentUserId),
    listMine: jest.fn(),
    getContext: jest.fn(),
    apply: jest.fn(),
    getPending: jest.fn(),
    decide: jest.fn(),
    withdraw: jest.fn(),
    getAttendanceRoster: jest.fn(),
    markAttendance: jest.fn(),
    getMembers: jest.fn(async () => roster()),
    removeMember: jest.fn(async (attempt: OpenGameMemberRemoveAttempt) => result(attempt)),
    ...overrides,
  } as OpenGameRegistrationSource;
}

function memberEvent(registrationId: unknown) {
  return { currentTarget: { dataset: { registrationId } } };
}

function reasonEvent(value: unknown) {
  return { detail: { value } };
}

function seedAttempt(overrides: Partial<OpenGameMemberRemoveAttempt> = {}) {
  const attempt: OpenGameMemberRemoveAttempt = {
    kind: "remove-member",
    originatingUserId: USER_ID,
    gameId: GAME_ID,
    registrationId: MEMBER_ID,
    expectedVersion: 4,
    reason: "队员临时无法到场",
    idempotencyKey: "remove-member-existing-result-0001",
    ...overrides,
  };
  expect(attemptStore.begin(attempt)).toEqual({ kind: "READY", attempt });
  return attempt;
}

async function loadReady(api = source()) {
  registerOpenGameRegistrationSource(api);
  const page = loadPage();
  call(page, "onLoad", { game_id: GAME_ID });
  await flush();
  return { page, api };
}

beforeEach(() => {
  resetOpenGameRegistrationSourceForTesting();
  resetOpenGameRegistrationAttemptStoreForTesting();
  currentUserId = USER_ID;
  values = new Map();
  const storage: SessionStorage = {
    get: (key) => values.get(key),
    set: (key, value) => { values.set(key, structuredClone(value)); },
    remove: (key) => { values.delete(key); },
  };
  attemptStore = createOpenGameRegistrationAttemptStore(storage);
  registerOpenGameRegistrationAttemptStore(attemptStore);
  (globalThis as any).wx = {
    getWindowInfo: jest.fn(() => ({ windowWidth: 375, statusBarHeight: 44 })),
    getMenuButtonBoundingClientRect: jest.fn(() => ({
      top: 48, bottom: 80, left: 278, right: 365, width: 87, height: 32,
    })),
    hideShareMenu: jest.fn(),
    navigateBack: jest.fn((options?: { success?: () => void }) => options?.success?.()),
    redirectTo: jest.fn((options?: { success?: () => void }) => options?.success?.()),
    reLaunch: jest.fn((options?: { success?: () => void }) => options?.success?.()),
  };
  (globalThis as any).getCurrentPages = jest.fn(() => [
    { route: "pages/captain-game-manage/index" },
    { route: "pages/captain-game-members/index" },
  ]);
});

test("loads the owner-only member roster and projects privacy-safe stable rows", async () => {
  const { page, api } = await loadReady();

  expect(api.getMembers).toHaveBeenCalledWith(GAME_ID);
  expect(page.data).toMatchObject({
    status: "READY",
    summaryLabel: "已加入 2 人 · 空缺 0 人 · 候补 1 人",
    isEmpty: false,
    game: {
      gameName: "海河周六轻松局",
      dateTimeLabel: "9月5日 周六 · 09:00–10:30",
      placeLabel: "天津河东体育中心 · 笼式五人制 2 号场",
    },
  });
  expect(page.data.members).toEqual([
    expect.objectContaining({
      registrationId: MEMBER_ID,
      displayName: "左边锋小王",
      positionLabel: "前锋",
      sourceLabel: "审核通过加入",
      canRemove: true,
    }),
    expect.objectContaining({
      registrationId: BLOCKED_ID,
      sourceLabel: "候补递补加入",
      blockedLabel: "已记录到场，不能移除",
      canRemove: false,
    }),
  ]);
  expect(JSON.stringify(page.data.members)).not.toMatch(/phone|wechat|userId|order|payment/i);
});

test("rejects ambiguous routes and offers real login and load recovery", async () => {
  const api = source({
    getMembers: jest.fn<(gameId: string) => Promise<OpenGameMemberRoster>>()
      .mockRejectedValueOnce(new OpenGameRegistrationApiError("AUTH_REQUIRED"))
      .mockResolvedValueOnce(roster()),
  });
  registerOpenGameRegistrationSource(api);
  const invalid = loadPage();
  call(invalid, "onLoad", { game_id: GAME_ID, extra: "not-allowed" });
  expect(invalid.data.status).toBe("NOT_FOUND");
  expect(api.getMembers).not.toHaveBeenCalled();

  const page = loadPage();
  call(page, "onLoad", { game_id: GAME_ID });
  await flush();
  expect(page.data.status).toBe("AUTH_LOSS");
  await call(page, "onLogin");
  expect(api.login).toHaveBeenCalledTimes(1);
  expect(page.data.status).toBe("READY");
});

test("freezes the selected member and validates a trimmed private-free reason", async () => {
  const { page } = await loadReady();

  call(page, "onOpenRemoval", memberEvent(BLOCKED_ID));
  expect(page.data.removalPanel).toBeNull();
  call(page, "onOpenRemoval", memberEvent(MEMBER_ID));
  expect(page.data.removalPanel).toEqual({ registrationId: MEMBER_ID });
  expect(page.data.removalMemberName).toBe("左边锋小王");
  expect(page.data.confirmDisabled).toBe(true);

  call(page, "onReasonInput", reasonEvent("微信 wx_friend"));
  expect(page.data.reasonError).toBe("请勿填写联系方式或证件号码");
  expect(page.data.confirmDisabled).toBe(true);
  call(page, "onReasonInput", reasonEvent("  队员临时无法到场  "));
  expect(page.data.reasonCount).toBe(8);
  expect(page.data.reasonError).toBe("");
  expect(page.data.confirmDisabled).toBe(false);

  // Authority changes after the sheet opens must not silently retarget the action.
  page.currentRoster = roster({
    members: roster().members.map((member) => member.registrationId === MEMBER_ID
      ? { ...member, version: 5 }
      : member),
  });
  await call(page, "onConfirmRemoval");
  expect(page.data.removalPanel).toBeNull();
  expect(page.data.noticeMessage).toMatch(/名单.*变化/);
});

test("submits once with the frozen version and renders promotion only after authoritative readback", async () => {
  let release!: (value: OpenGameMemberRemovalResult) => void;
  const pending = new Promise<OpenGameMemberRemovalResult>((resolve) => { release = resolve; });
  const api = source({
    getMembers: jest.fn<(gameId: string) => Promise<OpenGameMemberRoster>>()
      .mockResolvedValueOnce(roster())
      .mockResolvedValueOnce(afterRemoval()),
    removeMember: jest.fn(() => pending),
  });
  const { page } = await loadReady(api);
  call(page, "onOpenRemoval", memberEvent(MEMBER_ID));
  call(page, "onReasonInput", reasonEvent("  队员临时无法到场  "));

  const first = call(page, "onConfirmRemoval");
  const second = call(page, "onConfirmRemoval");
  expect(api.removeMember).toHaveBeenCalledTimes(1);
  expect(api.removeMember).toHaveBeenCalledWith(expect.objectContaining({
    kind: "remove-member",
    gameId: GAME_ID,
    registrationId: MEMBER_ID,
    expectedVersion: 4,
    reason: "队员临时无法到场",
  }));
  expect(page.data.status).toBe("REMOVING");
  expect(page.data.confirmDisabled).toBe(true);

  const attempt = (api.removeMember as jest.Mock).mock.calls[0][0] as OpenGameMemberRemoveAttempt;
  release(result(attempt));
  await Promise.all([first, second]);
  expect(api.getMembers).toHaveBeenCalledTimes(2);
  expect(attemptStore.load()).toBeNull();
  expect(page.data.status).toBe("READY");
  expect(page.data.noticeMessage).toBe("已移除左边锋小王；候补第 1 位候补小林已加入。");
  expect(page.data.members.map((item: any) => item.displayName)).toEqual(["中场阿杰", "候补小林"]);
});

test("refreshes authority and blocks rows after a definitive state conflict", async () => {
  const conflict = roster({
    game: { ...roster().game, state: "SUSPENDED" },
    members: roster().members.map((member) => ({
      ...member,
      allowedActions: { canRemove: false as const, removeBlockedReason: "GAME_SUSPENDED" as const },
    })),
  });
  const api = source({
    getMembers: jest.fn<(gameId: string) => Promise<OpenGameMemberRoster>>()
      .mockResolvedValueOnce(roster()).mockResolvedValueOnce(conflict),
    removeMember: jest.fn<(
      attempt: OpenGameMemberRemoveAttempt,
    ) => Promise<OpenGameMemberRemovalResult>>()
      .mockRejectedValue(new OpenGameRegistrationApiError("APPLICATION_STATE_CHANGED")),
  });
  const { page } = await loadReady(api);
  call(page, "onOpenRemoval", memberEvent(MEMBER_ID));
  call(page, "onReasonInput", reasonEvent("成员临时退出"));
  await call(page, "onConfirmRemoval");

  expect(page.data.status).toBe("CONFLICT");
  expect(page.data.errorMessage).toMatch(/状态已变化/);
  expect(page.data.members.every((item: any) => item.canRemove === false)).toBe(true);
  expect(attemptStore.load()).toBeNull();
});

test("preserves and replays only the exact durable key when a result is unknown", async () => {
  const durable = seedAttempt();
  const api = source({
    getMembers: jest.fn<(gameId: string) => Promise<OpenGameMemberRoster>>()
      .mockResolvedValueOnce(roster())
      .mockResolvedValueOnce(roster())
      .mockResolvedValueOnce(afterRemoval()),
    removeMember: jest.fn(async (attempt: OpenGameMemberRemoveAttempt) => result(attempt)),
  });
  const { page } = await loadReady(api);
  expect(page.data.status).toBe("RESULT_UNKNOWN");

  await call(page, "onConfirmUnknownResult");
  expect(api.removeMember).toHaveBeenCalledWith(durable);
  expect(((api.removeMember as jest.Mock).mock.calls[0][0] as OpenGameMemberRemoveAttempt)
    .idempotencyKey).toBe(
    durable.idempotencyKey,
  );
  expect(attemptStore.load()).toBeNull();
  expect(page.data.status).toBe("READY");
});

test("never replays a pending removal across accounts and routes other operations", async () => {
  seedAttempt();
  currentUserId = OTHER_USER_ID;
  const foreign = await loadReady();
  expect(foreign.page.data.status).toBe("FOREIGN_PENDING");
  expect(foreign.api.removeMember).not.toHaveBeenCalled();

  attemptStore.clear();
  currentUserId = USER_ID;
  seedAttempt({ gameId: OTHER_GAME_ID });
  const other = await loadReady();
  expect(other.page.data.status).toBe("OTHER_PENDING");
  expect(other.page.data.pendingRoute).toBe(
    `/pages/captain-game-members/index?game_id=${OTHER_GAME_ID}`,
  );
  await call(other.page, "onGoPending");
  expect(wx.redirectTo).toHaveBeenCalledWith(expect.objectContaining({
    url: `/pages/captain-game-members/index?game_id=${OTHER_GAME_ID}`,
  }));
});

test("ignores stale roster responses after the page is hidden", async () => {
  let resolveRoster!: (value: OpenGameMemberRoster) => void;
  const api = source({
    getMembers: jest.fn(() => new Promise<OpenGameMemberRoster>((resolve) => {
      resolveRoster = resolve;
    })),
  });
  registerOpenGameRegistrationSource(api);
  const page = loadPage();
  call(page, "onLoad", { game_id: GAME_ID });
  call(page, "onHide");
  resolveRoster(roster());
  await flush();
  expect(page.data.status).toBe("LOADING");
});

test("uses deterministic navigation and a complete accessible safe-area UI contract", async () => {
  const { page } = await loadReady();
  await call(page, "onHeaderBack");
  expect(wx.navigateBack).toHaveBeenCalledWith(expect.objectContaining({ delta: 1 }));

  expect(existsSync(templatePath)).toBe(true);
  expect(existsSync(stylesPath)).toBe(true);
  expect(existsSync(configPath)).toBe(true);
  const template = readFileSync(templatePath, "utf8");
  const styles = readFileSync(stylesPath, "utf8");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
  expect(config.navigationStyle).toBe("custom");
  for (const handler of [
    "onHeaderBack", "onRetryLoad", "onLogin", "onReturnManage", "onGoPending",
    "onResolveConflict", "onConfirmUnknownResult", "onOpenRemoval", "onCloseRemoval",
    "onConfirmRemoval",
  ]) {
    expect(template).toContain(`bindtap="${handler}"`);
    expect(typeof page[handler]).toBe("function");
  }
  expect(template).toContain('bindinput="onReasonInput"');
  expect(template).toContain('catchtouchmove="onBlockTouchMove"');
  expect(typeof page.onReasonInput).toBe("function");
  expect(typeof page.onBlockTouchMove).toBe("function");
  expect(template).toContain('disabled="{{confirmDisabled}}"');
  expect(template).toContain('maxlength="-1"');
  expect(template).toContain('aria-modal="true"');
  expect(styles).toMatch(/\.c2e-page\s*\{[^}]*height:\s*100vh[^}]*overflow:\s*hidden/s);
  expect(styles).toMatch(/\.c2e-scroll\s*\{[^}]*flex:\s*1 1 auto[^}]*height:\s*0[^}]*min-height:\s*0/s);
  expect(styles).toMatch(/\.c2e-(?:state-action|row-action|sheet-action)[^{]*\{[^}]*min-height:\s*88rpx[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*justify-content:\s*center/s);
  expect(styles).toContain("env(safe-area-inset-bottom");
});
