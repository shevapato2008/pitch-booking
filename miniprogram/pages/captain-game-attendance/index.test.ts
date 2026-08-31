/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */

import { existsSync, readFileSync } from "node:fs";
import { beforeEach, expect, jest, test } from "@jest/globals";

import type {
  OpenGameAttendanceMarkResult,
  OpenGameAttendanceRoster,
} from "../../domain/open-game-registration";
import { OpenGameRegistrationApiError } from "../../services/http-open-game-registration";
import {
  registerOpenGameRegistrationAttemptStore,
  registerOpenGameRegistrationSource,
  resetOpenGameRegistrationAttemptStoreForTesting,
  resetOpenGameRegistrationSourceForTesting,
  type OpenGameAttendanceMarkAttempt,
  type OpenGameRegistrationSource,
} from "../../services/open-game-registration";
import { createOpenGameRegistrationAttemptStore } from "../../services/open-game-registration-attempt-store";
import type { SessionStorage } from "../../services/session-store";

type PageDefinition = Record<string, any> & { data: Record<string, any> };
type RuntimePage = PageDefinition & { setData(patch: Record<string, unknown>): void };

const GAME_ID = "00000000-0000-4000-8000-000000000401";
const OTHER_GAME_ID = "00000000-0000-4000-8000-000000000402";
const USER_ID = "00000000-0000-4000-8000-000000000403";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000404";
const REG_UNMARKED = "00000000-0000-4000-8000-000000000411";
const REG_PRESENT = "00000000-0000-4000-8000-000000000412";
const REG_NO_SHOW = "00000000-0000-4000-8000-000000000413";

const sourcePath = "miniprogram/pages/captain-game-attendance/index.ts";
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
    decisionSelection: null,
    unknownAttempt: null,
    pendingRoute: "",
    readInFlight: null,
    mutationInFlight: null,
    navigationInFlight: null,
  } as RuntimePage;
}

function roster(overrides: Partial<OpenGameAttendanceRoster> = {}): OpenGameAttendanceRoster {
  const registrations = overrides.registrations ?? [
    {
      registrationId: REG_UNMARKED,
      displayName: "天津周末左边锋小王",
      position: "FORWARD" as const,
      attendanceStatus: "UNMARKED" as const,
      attendanceRecordedAt: null,
      attendanceCorrectedAt: null,
      version: 2,
    },
    {
      registrationId: REG_PRESENT,
      displayName: "海河路中场阿杰",
      position: "MIDFIELDER" as const,
      attendanceStatus: "PRESENT" as const,
      attendanceRecordedAt: "2026-08-30T20:32:00+08:00",
      attendanceCorrectedAt: "2026-08-31T14:18:00+08:00",
      version: 3,
    },
    {
      registrationId: REG_NO_SHOW,
      displayName: "奥体后卫小林",
      position: "DEFENDER" as const,
      attendanceStatus: "NO_SHOW" as const,
      attendanceRecordedAt: "2026-08-30T20:34:00+08:00",
      attendanceCorrectedAt: null,
      version: 4,
    },
  ];
  return {
    game: {
      id: GAME_ID,
      name: "奥体周日傍晚局",
      venueName: "天津奥体足球场",
      pitchName: "七人制 A 场",
      startsAt: "2026-08-30T18:30:00+08:00",
      endsAt: "2026-08-30T20:30:00+08:00",
      timeZone: "Asia/Shanghai",
      state: "COMPLETED",
    },
    recordedCount: registrations.filter((item) => item.attendanceStatus !== "UNMARKED").length,
    totalCount: registrations.length,
    attendanceComplete: registrations.every((item) => item.attendanceStatus !== "UNMARKED"),
    registrations,
    ...overrides,
  };
}

function markResult(
  attempt: OpenGameAttendanceMarkAttempt,
  overrides: Partial<OpenGameAttendanceMarkResult> = {},
): OpenGameAttendanceMarkResult {
  return {
    registrationId: attempt.registrationId,
    attendanceStatus: attempt.attendanceStatus,
    attendanceRecordedAt: "2026-08-30T20:36:00+08:00",
    version: attempt.expectedVersion + 1,
    recordedCount: 3,
    totalCount: 3,
    attendanceComplete: true,
    ...overrides,
  };
}

function terminalRoster(
  attendanceStatus: "PRESENT" | "NO_SHOW" = "PRESENT",
): OpenGameAttendanceRoster {
  return roster({
    registrations: roster().registrations.map((item) => item.registrationId === REG_UNMARKED
      ? {
        ...item,
        attendanceStatus,
        attendanceRecordedAt: "2026-08-30T20:36:00+08:00",
        version: item.version + 1,
      }
      : item),
    recordedCount: 3,
    attendanceComplete: true,
  });
}

function source(overrides: Partial<OpenGameRegistrationSource> = {}): OpenGameRegistrationSource {
  return {
    login: jest.fn(async () => {
      currentUserId = USER_ID;
      return USER_ID;
    }),
    currentUserId: jest.fn(() => currentUserId),
    listMine: jest.fn(),
    getContext: jest.fn(),
    apply: jest.fn(),
    getPending: jest.fn(),
    decide: jest.fn(),
    withdraw: jest.fn(),
    getAttendanceRoster: jest.fn(async () => roster()),
    markAttendance: jest.fn(async (attempt: OpenGameAttendanceMarkAttempt) => markResult(attempt)),
    ...overrides,
  } as OpenGameRegistrationSource;
}

function registrationEvent(registrationId: unknown) {
  return { currentTarget: { dataset: { registrationId } } };
}

function seedAttempt(overrides: Partial<OpenGameAttendanceMarkAttempt> = {}) {
  const attempt: OpenGameAttendanceMarkAttempt = {
    kind: "attendance",
    originatingUserId: USER_ID,
    gameId: GAME_ID,
    registrationId: REG_UNMARKED,
    attendanceStatus: "PRESENT",
    expectedVersion: 2,
    idempotencyKey: "attendance-existing-result-0001",
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
    setClipboardData: jest.fn(),
    navigateBack: jest.fn((options?: { success?: () => void }) => options?.success?.()),
    redirectTo: jest.fn((options?: { success?: () => void }) => options?.success?.()),
    reLaunch: jest.fn((options?: { success?: () => void }) => options?.success?.()),
  };
  (globalThis as any).getCurrentPages = jest.fn(() => [
    { route: "pages/captain-game-manage/index" },
    { route: "pages/captain-game-attendance/index" },
  ]);
});

test("loads the authoritative roster and projects stable display-only fields", async () => {
  const { page, api } = await loadReady();

  expect(wx.hideShareMenu).toHaveBeenCalledTimes(1);
  expect(api.getAttendanceRoster).toHaveBeenCalledWith(GAME_ID);
  expect(page.data).toMatchObject({
    status: "READY",
    headerTopPx: 44,
    headerRowHeightPx: 44,
    progressLabel: "已记录 2 / 3",
    isEmpty: false,
    isComplete: false,
    game: {
      gameName: "奥体周日傍晚局",
      dateTimeLabel: "8月30日 周日 · 18:30–20:30",
      placeLabel: "天津奥体足球场 · 七人制 A 场",
    },
  });
  expect(page.data.roster.map((item: any) => ({
    id: item.registrationId,
    position: item.positionLabel,
    result: item.resultLabel,
    canMark: item.canMark,
  }))).toEqual([
    { id: REG_UNMARKED, position: "前锋", result: "待记录", canMark: true },
    { id: REG_PRESENT, position: "中场", result: "已到场", canMark: false },
    { id: REG_NO_SHOW, position: "后卫", result: "未到场", canMark: false },
  ]);
  expect(page.data.roster[1].recordedTimeLabel).toContain("8月30日");
  expect(page.data.roster[1]).toMatchObject({
    correctedTimeLabel: "平台已纠正 · 8月31日 周一 14:18",
  });
});

test("captain copies the registration id with visible retryable feedback and stale guards", async () => {
  const clipboardCalls: Array<{
    data: string;
    success: () => void;
    fail: () => void;
  }> = [];
  (wx.setClipboardData as jest.Mock).mockImplementation((options) => {
    clipboardCalls.push(options as typeof clipboardCalls[number]);
  });
  const { page } = await loadReady();

  call(page, "onCopyRegistrationId", registrationEvent(REG_PRESENT));
  expect(clipboardCalls[0].data).toBe(REG_PRESENT);
  expect(page.data).toMatchObject({
    copyFeedbackRegistrationId: REG_PRESENT,
    copyFeedbackMessage: "正在复制…",
    copyFeedbackKind: "pending",
  });

  call(page, "onCopyRegistrationId", registrationEvent(REG_PRESENT));
  clipboardCalls[0].success();
  expect(page.data.copyFeedbackMessage).toBe("正在复制…");
  clipboardCalls[1].fail();
  expect(page.data).toMatchObject({
    copyFeedbackRegistrationId: REG_PRESENT,
    copyFeedbackMessage: "复制失败，请重试",
    copyFeedbackKind: "error",
  });

  call(page, "onCopyRegistrationId", registrationEvent(REG_PRESENT));
  clipboardCalls[2].success();
  expect(page.data).toMatchObject({
    copyFeedbackRegistrationId: REG_PRESENT,
    copyFeedbackMessage: "报名编号已复制",
    copyFeedbackKind: "success",
  });

  const template = readFileSync(templatePath, "utf8");
  const styles = readFileSync(stylesPath, "utf8");
  expect(template).toContain('bindtap="onCopyRegistrationId"');
  expect(template).toContain("平台已纠正");
  expect(template).toContain("{{item.registrationId}}");
  expect(styles).toMatch(/\.c2d-copy-action\s*\{[^}]*min-height:\s*88rpx[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*justify-content:\s*center/s);
});

test("invalid routes, 404, authentication loss, and load failure expose real recovery", async () => {
  registerOpenGameRegistrationSource(source());
  const invalid = loadPage();
  call(invalid, "onLoad", { game_id: "bad", extra: "x" });
  expect(invalid.data).toMatchObject({ status: "NOT_FOUND", roster: [] });

  resetOpenGameRegistrationSourceForTesting();
  registerOpenGameRegistrationSource(source({
    getAttendanceRoster: jest.fn(async () => { throw new OpenGameRegistrationApiError("OPEN_GAME_NOT_FOUND"); }),
  }));
  const missing = loadPage(); call(missing, "onLoad", { game_id: GAME_ID }); await flush();
  expect(missing.data.status).toBe("NOT_FOUND");

  resetOpenGameRegistrationSourceForTesting();
  const auth = source({
    getAttendanceRoster: jest.fn(async () => { throw new OpenGameRegistrationApiError("AUTH_REQUIRED"); }),
  });
  registerOpenGameRegistrationSource(auth);
  const authPage = loadPage(); call(authPage, "onLoad", { game_id: GAME_ID }); await flush();
  expect(authPage.data.status).toBe("AUTH_LOSS");
  await call(authPage, "onLogin");
  expect(auth.login).toHaveBeenCalledTimes(1);

  resetOpenGameRegistrationSourceForTesting();
  let reads = 0;
  const flaky = source({
    getAttendanceRoster: jest.fn(async () => {
      reads += 1;
      if (reads === 1) throw new OpenGameRegistrationApiError("SERVICE_UNAVAILABLE");
      return roster();
    }),
  });
  registerOpenGameRegistrationSource(flaky);
  const retry = loadPage(); call(retry, "onLoad", { game_id: GAME_ID }); await flush();
  expect(retry.data.status).toBe("LOAD_ERROR");
  await call(retry, "onRetryLoad");
  expect(retry.data.status).toBe("READY");
  expect(flaky.getAttendanceRoster).toHaveBeenCalledTimes(2);
});

test.each([
  [
    "foreign account",
    { originatingUserId: OTHER_USER_ID },
    "FOREIGN_PENDING",
    "",
  ],
  [
    "another game",
    { gameId: OTHER_GAME_ID },
    "OTHER_PENDING",
    `/pages/captain-game-attendance/index?game_id=${OTHER_GAME_ID}`,
  ],
] as const)("a %s pending attempt remains recoverable when this roster returns 404", async (
  _description,
  attemptOverrides,
  status,
  pendingRoute,
) => {
  const original = seedAttempt(attemptOverrides);
  registerOpenGameRegistrationSource(source({
    getAttendanceRoster: jest.fn(async () => {
      throw new OpenGameRegistrationApiError("OPEN_GAME_NOT_FOUND");
    }),
  }));
  const page = loadPage();
  call(page, "onLoad", { game_id: GAME_ID });
  await flush();

  expect(page.data).toMatchObject({ status, pendingRoute });
  expect(attemptStore.load()).toEqual(original);
});

test("a same-account same-game pending attempt is cleared only after authoritative 404", async () => {
  seedAttempt();
  registerOpenGameRegistrationSource(source({
    getAttendanceRoster: jest.fn(async () => {
      throw new OpenGameRegistrationApiError("OPEN_GAME_NOT_FOUND");
    }),
  }));
  const page = loadPage();
  call(page, "onLoad", { game_id: GAME_ID });
  await flush();

  expect(page.data.status).toBe("NOT_FOUND");
  expect(attemptStore.load()).toBeNull();
});

test.each([
  ["onMarkPresent", "PRESENT", "确认已到场？", "确认到场"],
  ["onMarkNoShow", "NO_SHOW", "确认未到场？", "确认未到场"],
] as const)("%s freezes one eligible row in the reviewed confirmation sheet", async (
  handler,
  attendanceStatus,
  decisionTitle,
  confirmButtonLabel,
) => {
  const { page } = await loadReady();

  call(page, handler, registrationEvent(REG_UNMARKED));
  expect(page.data).toMatchObject({
    decisionPanel: { registrationId: REG_UNMARKED, attendanceStatus },
    decisionTitle,
    decisionPlayerName: "天津周末左边锋小王",
    decisionWarning: "确认后本页不能自行修改。",
    confirmButtonLabel,
  });
  call(page, "onCloseDecision");
  expect(page.data.decisionPanel).toBeNull();

  call(page, handler, registrationEvent(REG_PRESENT));
  call(page, handler, registrationEvent("missing"));
  expect(page.data.decisionPanel).toBeNull();
});

test("confirm durably sends one exact attempt and applies the authoritative result once", async () => {
  let resolve!: (value: OpenGameAttendanceMarkResult) => void;
  const pending = new Promise<OpenGameAttendanceMarkResult>((yes) => { resolve = yes; });
  let reads = 0;
  const api = source({
    getAttendanceRoster: jest.fn(async () => {
      reads += 1;
      return reads === 1 ? roster() : terminalRoster();
    }),
    markAttendance: jest.fn(() => pending),
  });
  const { page } = await loadReady(api);
  call(page, "onMarkPresent", registrationEvent(REG_UNMARKED));

  const first = call(page, "onConfirmDecision");
  const duplicate = call(page, "onConfirmDecision");
  expect(api.markAttendance).toHaveBeenCalledTimes(1);
  const attempt = (api.markAttendance as jest.Mock).mock.calls[0][0] as OpenGameAttendanceMarkAttempt;
  expect(attempt).toMatchObject({
    kind: "attendance",
    originatingUserId: USER_ID,
    gameId: GAME_ID,
    registrationId: REG_UNMARKED,
    attendanceStatus: "PRESENT",
    expectedVersion: 2,
  });
  expect(attempt.idempotencyKey).toMatch(/^attendance-[A-Za-z0-9_-]{16,}$/);
  expect(attemptStore.load()).toEqual(attempt);
  expect(page.data.status).toBe("MARKING");

  resolve(markResult(attempt));
  await first; await duplicate;
  expect(api.getAttendanceRoster).toHaveBeenCalledTimes(2);
  expect(attemptStore.load()).toBeNull();
  expect(page.data).toMatchObject({
    status: "READY",
    progressLabel: "已记录 3 / 3",
    isComplete: true,
  });
  expect(page.data.roster[0]).toMatchObject({
    resultLabel: "已到场",
    canMark: false,
    recordedTimeLabel: expect.stringContaining("8月30日"),
  });
  await call(page, "onConfirmDecision");
  expect(api.markAttendance).toHaveBeenCalledTimes(1);
});

test("a 409 clears only the exact attempt, refreshes authority, and keeps rows inert until acknowledgement", async () => {
  const changed = roster({
    registrations: roster().registrations.map((item) => item.registrationId === REG_UNMARKED
      ? {
        ...item,
        attendanceStatus: "NO_SHOW" as const,
        attendanceRecordedAt: "2026-08-30T20:38:00+08:00",
        version: 3,
      }
      : item),
    recordedCount: 3,
    attendanceComplete: true,
  });
  let reads = 0;
  const api = source({
    getAttendanceRoster: jest.fn(async () => {
      reads += 1;
      return reads === 1 ? roster() : changed;
    }),
    markAttendance: jest.fn(async () => { throw new OpenGameRegistrationApiError("ATTENDANCE_STATE_CHANGED"); }),
  });
  const { page } = await loadReady(api);
  call(page, "onMarkPresent", registrationEvent(REG_UNMARKED));
  await call(page, "onConfirmDecision");

  expect(attemptStore.load()).toBeNull();
  expect(api.getAttendanceRoster).toHaveBeenCalledTimes(2);
  expect(page.data).toMatchObject({ status: "CONFLICT", isComplete: true });
  expect(page.data.roster[0]).toMatchObject({ resultLabel: "未到场", canMark: false });

  await call(page, "onResolveConflict");
  expect(api.getAttendanceRoster).toHaveBeenCalledTimes(3);
  expect(page.data.status).toBe("READY");
});

test("unknown recovery first reads authority and replays the unchanged durable attempt with its original key", async () => {
  const original = seedAttempt();
  let reads = 0;
  const api = source({
    getAttendanceRoster: jest.fn(async () => {
      reads += 1;
      return reads <= 2 ? roster() : terminalRoster();
    }),
  });
  const { page } = await loadReady(api);
  expect(page.data.status).toBe("RESULT_UNKNOWN");

  await call(page, "onConfirmUnknownResult");

  expect(api.getAttendanceRoster).toHaveBeenCalledTimes(3);
  expect(api.markAttendance).toHaveBeenCalledTimes(1);
  expect(api.markAttendance).toHaveBeenCalledWith(original);
  expect(attemptStore.load()).toBeNull();
  expect(page.data).toMatchObject({ status: "READY", isComplete: true });
});

test("unknown recovery accepts matching terminal authority without replay", async () => {
  const original = seedAttempt();
  const terminal = roster({
    registrations: roster().registrations.map((item) => item.registrationId === REG_UNMARKED
      ? {
        ...item,
        attendanceStatus: original.attendanceStatus,
        attendanceRecordedAt: "2026-08-30T20:36:00+08:00",
        version: original.expectedVersion + 1,
      }
      : item),
    recordedCount: 3,
    attendanceComplete: true,
  });
  let reads = 0;
  const api = source({
    getAttendanceRoster: jest.fn(async () => {
      reads += 1;
      return reads === 1 ? roster() : terminal;
    }),
  });
  const { page } = await loadReady(api);

  await call(page, "onConfirmUnknownResult");

  expect(api.markAttendance).not.toHaveBeenCalled();
  expect(attemptStore.load()).toBeNull();
  expect(page.data).toMatchObject({ status: "READY", isComplete: true });
});

test("unknown write failures preserve the attempt and login never replays it under another account", async () => {
  const api = source({
    markAttendance: jest.fn(async () => { throw new OpenGameRegistrationApiError("APPLICATION_RESULT_UNKNOWN"); }),
  });
  const { page } = await loadReady(api);
  call(page, "onMarkNoShow", registrationEvent(REG_UNMARKED));
  await call(page, "onConfirmDecision");
  const original = attemptStore.load();
  expect(original).toMatchObject({ kind: "attendance", attendanceStatus: "NO_SHOW" });
  expect(page.data.status).toBe("RESULT_UNKNOWN");

  currentUserId = null;
  (api.login as jest.Mock).mockImplementation(async () => {
    currentUserId = OTHER_USER_ID;
    return OTHER_USER_ID;
  });
  await call(page, "onLogin");
  expect(page.data.status).toBe("FOREIGN_PENDING");
  expect(api.markAttendance).toHaveBeenCalledTimes(1);
  expect(attemptStore.load()).toEqual(original);
});

test("other-resource and foreign-account pending attempts have real safe exits", async () => {
  seedAttempt({ gameId: OTHER_GAME_ID });
  const { page } = await loadReady();
  expect(page.data).toMatchObject({
    status: "OTHER_PENDING",
    pendingRoute: `/pages/captain-game-attendance/index?game_id=${OTHER_GAME_ID}`,
  });
  await call(page, "onGoPending");
  expect(wx.redirectTo).toHaveBeenCalledWith(expect.objectContaining({
    url: `/pages/captain-game-attendance/index?game_id=${OTHER_GAME_ID}`,
  }));

  values.clear();
  seedAttempt({ originatingUserId: OTHER_USER_ID });
  resetOpenGameRegistrationSourceForTesting();
  const foreignApi = source({
    login: jest.fn(async () => {
      currentUserId = OTHER_USER_ID;
      return OTHER_USER_ID;
    }),
  });
  registerOpenGameRegistrationSource(foreignApi);
  const foreign = loadPage(); call(foreign, "onLoad", { game_id: GAME_ID }); await flush();
  expect(foreign.data.status).toBe("FOREIGN_PENDING");
  const original = attemptStore.load();
  await call(foreign, "onLogin");
  expect(foreignApi.login).toHaveBeenCalledTimes(1);
  expect(attemptStore.load()).toEqual(original);
  expect(foreign.data.status).toBe("RESULT_UNKNOWN");
});

test("empty and complete authority remain distinct truthful states", async () => {
  const emptyRoster = roster({
    registrations: [], recordedCount: 0, totalCount: 0, attendanceComplete: true,
  });
  const empty = await loadReady(source({ getAttendanceRoster: jest.fn(async () => emptyRoster) }));
  expect(empty.page.data).toMatchObject({
    status: "READY",
    progressLabel: "已记录 0 / 0",
    isEmpty: true,
    isComplete: false,
    emptyMessage: "本场没有需要记录的散客",
  });

  resetOpenGameRegistrationSourceForTesting();
  const completedRoster = roster({
    registrations: roster().registrations.map((item) => item.attendanceStatus === "UNMARKED"
      ? {
        ...item,
        attendanceStatus: "PRESENT" as const,
        attendanceRecordedAt: "2026-08-30T20:36:00+08:00",
        version: item.version + 1,
      }
      : item),
    recordedCount: 3,
    attendanceComplete: true,
  });
  const complete = await loadReady(source({ getAttendanceRoster: jest.fn(async () => completedRoster) }));
  expect(complete.page.data).toMatchObject({
    isEmpty: false,
    isComplete: true,
    completionMessage: "本场散客到场记录已完成",
  });
});

test("template is the reviewed scroll-safe skeleton with real handlers and no development imports", () => {
  const sourceText = readFileSync(sourcePath, "utf8");
  const template = readFileSync(templatePath, "utf8");
  const styles = readFileSync(stylesPath, "utf8");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const page = loadPage();

  expect(config).toEqual({ navigationStyle: "custom" });
  expect(`${sourceText}\n${template}`).not.toMatch(/c2c-attendance-fixture|C2C_ATTENDANCE_FIXTURE|模拟数据|fixtureNotice/);
  expect(sourceText).toContain("getOpenGameRegistrationSource");
  expect(sourceText).toContain("getOpenGameRegistrationAttemptStore");
  expect(template).toContain("本场已结束");
  expect(template).toContain("本场没有需要记录的散客");
  expect(sourceText).toContain('decisionWarning: "确认后本页不能自行修改。"');
  expect(template).toContain("{{decisionWarning}}");
  expect(template).not.toMatch(/微信昵称|实名|报名备注|用户 ID|showToast|假成功/);
  expect(template).not.toMatch(/c2c-footer/);
  for (const button of template.match(/<button\b[^>]*>/g) ?? []) {
    const handler = button.match(/bindtap="([^"]+)"/)?.[1] ?? "";
    expect(handler).toMatch(/^on[A-Za-z]+$/);
    expect(typeof page[handler]).toBe("function");
    expect(button).toContain('hover-class="c2c-pressed"');
  }
  expect(styles).toMatch(/\.c2c-page\s*\{[^}]*height:\s*100vh[^}]*overflow:\s*hidden/s);
  expect(styles).toMatch(/\.c2c-scroll\s*\{[^}]*flex:\s*1 1 auto[^}]*height:\s*0[^}]*min-height:\s*0/s);
  expect(styles).toMatch(/env\(safe-area-inset-bottom/);
  for (const selector of ["c2c-state-action", "c2c-row-action", "c2c-sheet-close", "c2c-sheet-action"]) {
    expect(styles).toMatch(new RegExp(`\\.${selector}\\s*\\{[^}]*min-height:\\s*(?:88|\\d{3,})rpx[^}]*display:\\s*flex[^}]*align-items:\\s*center[^}]*justify-content:\\s*center`, "s"));
  }
});

test("back and empty-state return use real history or the deterministic manage route", async () => {
  const { page } = await loadReady();
  await call(page, "onHeaderBack");
  expect(wx.navigateBack).toHaveBeenCalledWith(expect.objectContaining({ delta: 1 }));

  (getCurrentPages as unknown as jest.Mock).mockReturnValue([
    { route: "pages/captain-game-attendance/index" },
  ]);
  await call(page, "onReturnManage");
  expect(wx.redirectTo).toHaveBeenCalledWith(expect.objectContaining({
    url: `/pages/captain-game-manage/index?game_id=${GAME_ID}`,
  }));
});
