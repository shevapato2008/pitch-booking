/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */

import { beforeEach, expect, jest, test } from "@jest/globals";
import { existsSync, readFileSync } from "node:fs";

import {
  decodeOpenGameRegistrationContext,
} from "../../domain/open-game-registration-decoder";
import type {
  OpenGameApplicationSubmission,
  OpenGameRegistrationContext,
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
  type OpenGameRegistrationSource,
} from "../../services/open-game-registration";

type PageDefinition = Record<string, any> & { data: Record<string, any> };
type RuntimePage = PageDefinition & { setData(patch: Record<string, unknown>): void };

const SOURCE_PATH = "miniprogram/pages/player-game-application/index.ts";
const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz_12345";
const OTHER_TOKEN = "1234567890_abcdefghijklmnopqrstu";
const USER_ID = "11111111-2222-4333-8444-555555555555";
const OTHER_USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const CONTRACT_UUID = "00000000-0000-0000-0000-000000000001";
const GAME_ID = "22222222-3333-4444-8555-666666666666";

const fixture = (name: string): Record<string, unknown> => JSON.parse(
  readFileSync(`contracts/examples/${name}.json`, "utf8"),
) as Record<string, unknown>;
const readyContext = decodeOpenGameRegistrationContext(
  fixture("open-game-registration-context-apply-ready"),
);
const appliedContext = decodeOpenGameRegistrationContext(
  fixture("open-game-registration-context-applied"),
);

const submission: OpenGameApplicationSubmission = {
  displayName: "周末小翼",
  position: "FORWARD",
  note: "可以补边路，按时到场。",
  adultConfirmed: true,
  riskConfirmed: true,
};

let captured: PageDefinition | undefined;
let currentUserId: string | null;
let attemptStore: OpenGameRegistrationAttemptStore;

const call = (page: RuntimePage, method: string, ...args: unknown[]) => page[method](...args);
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function loadPage(): RuntimePage {
  expect(existsSync(SOURCE_PATH)).toBe(true);
  if (!existsSync(SOURCE_PATH)) throw new Error("production player application page is missing");
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
    routeToken: "",
    authority: null,
    authorityUserId: null,
    mutationInFlight: null,
    pendingRoute: "",
    serverErrors: {},
  } as RuntimePage;
}

function source(overrides: Partial<OpenGameRegistrationSource> = {}): OpenGameRegistrationSource {
  return {
    login: jest.fn(async () => {
      if (currentUserId === null) throw new OpenGameRegistrationApiError("LOGIN_FAILED");
      return currentUserId;
    }),
    currentUserId: jest.fn(() => currentUserId),
    getContext: jest.fn(async () => readyContext),
    apply: jest.fn(async () => appliedContext),
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

function fillValid(page: RuntimePage): void {
  call(page, "onDisplayNameInput", { detail: { value: ` ${submission.displayName} ` } });
  call(page, "onPositionTap", { currentTarget: { dataset: { position: submission.position } } });
  call(page, "onNoteInput", { detail: { value: ` ${submission.note} ` } });
  call(page, "onAdultChange", { detail: { value: ["adult"] } });
  call(page, "onRiskChange", { detail: { value: ["risk"] } });
}

async function openReady(page: RuntimePage): Promise<void> {
  call(page, "onLoad", { token: TOKEN });
  await flush();
  expect(page.data.status).toBe("READY");
}

function seedAttempt(overrides: Partial<Extract<OpenGameRegistrationAttempt, { kind: "apply" }>> = {}) {
  const attempt = {
    kind: "apply" as const,
    originatingUserId: USER_ID,
    shareToken: TOKEN,
    body: submission,
    idempotencyKey: "application-key-00000000000001",
    ...overrides,
  };
  attemptStore.begin(attempt);
  return attempt;
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
    getMenuButtonBoundingClientRect: jest.fn(() => ({ top: 48, left: 278, width: 87, height: 32 })),
    navigateBack: jest.fn(completeNavigation),
    navigateTo: jest.fn(completeNavigation),
    redirectTo: jest.fn(completeNavigation),
    reLaunch: jest.fn(completeNavigation),
  };
  (globalThis as any).getCurrentPages = jest.fn(() => [
    { route: "pages/captain-game-public/index" },
    { route: "pages/player-game-application/index" },
  ]);
});

test("uses the approved native form and backs every button with a real handler", () => {
  loadPage();
  const json = readFileSync("miniprogram/pages/player-game-application/index.json", "utf8");
  const template = readFileSync("miniprogram/pages/player-game-application/index.wxml", "utf8");
  const styles = readFileSync("miniprogram/pages/player-game-application/index.wxss", "utf8");

  expect(JSON.parse(json)).toEqual({ navigationStyle: "custom" });
  expect(template).toContain("c1a-form-intro");
  expect(template).toContain("本场称呼");
  expect(template).toContain("意向位置");
  expect(template).toContain("给队长的话");
  expect(template).toContain("我已满 18 周岁");
  expect(template).toContain("我了解足球运动存在受伤风险，并自愿参与");
  expect(template).not.toMatch(/Fixture|开发预览|outcome|dev\/pages|c1a-scenario/);
  expect(template).not.toMatch(/class="c1a-nav"[^>]*padding-(?:left|right)/);
  const buttons = template.match(/<button\b[^>]*>/g) ?? [];
  expect(buttons.length).toBeGreaterThan(0);
  for (const button of buttons) expect(button).toMatch(/bindtap="[A-Za-z][A-Za-z0-9]*"/);
  for (const handler of [
    "onHeaderBack", "onReload", "onLogin", "onPositionTap", "onCancel", "onSubmit",
    "onConfirmResult", "onReturnGame", "onGoPending", "onClearPending",
  ]) expect(template).toContain(`bindtap="${handler}"`);

  expect(styles).toMatch(/\.c1a-button\s*\{[^}]*min-height:\s*88rpx[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*justify-content:\s*center/s);
  expect(styles).toMatch(/\.c1a-option\s*\{[^}]*min-height:\s*88rpx[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*justify-content:\s*center/s);
  expect(styles).toMatch(/\.c1a-footer\s*\{[^}]*position:\s*fixed[^}]*bottom:\s*0[^}]*env\(safe-area-inset-bottom/s);
  expect(styles).toMatch(/\.c1a-button--primary\s*\{[^}]*#0369A1/s);
  expect(styles).toMatch(/\.c1a-button--primary:active|\.c1a-button--primary\.button-hover/);
  expect(styles).toMatch(/\.c1a-button--primary\[disabled\]/);
  expect(template).toContain('hover-class="c1a-consent--pressed"');
  expect(styles).toMatch(/\.c1a-consent--pressed\s*\{/);
  expect(template).toMatch(/class="[^"]*\bc1a-navigation-error\b[^"]*"/);
});

test("accepts exactly one legal 32-character token and otherwise performs no read", async () => {
  const api = registerSource();
  for (const options of [
    {},
    { token: TOKEN.slice(1) },
    { token: `${TOKEN.slice(0, 31)}!` },
    { token: TOKEN, game_id: GAME_ID },
  ]) {
    const page = loadPage();
    call(page, "onLoad", options);
    await flush();
    expect(page.data.status).toBe("NOT_FOUND");
  }
  expect(api.getContext).not.toHaveBeenCalled();

  const valid = loadPage();
  await openReady(valid);
  expect(api.getContext).toHaveBeenCalledWith(TOKEN);
});

test("loads server authority and edits all five positions plus both confirmations through Task 9 validation", async () => {
  const api = registerSource();
  const page = loadPage();
  await openReady(page);
  expect(api.getContext).toHaveBeenCalledTimes(1);
  expect(page.data.positions.map((position: { value: string }) => position.value)).toEqual([
    "GOALKEEPER", "DEFENDER", "MIDFIELDER", "FORWARD", "ANY",
  ]);

  call(page, "onDisplayNameInput", { detail: { value: "范" } });
  expect(page.data.validation.errors.displayName).toContain("2–24");
  call(page, "onDisplayNameInput", { detail: { value: "周末小翼" } });
  for (const value of ["GOALKEEPER", "DEFENDER", "MIDFIELDER", "FORWARD", "ANY"]) {
    call(page, "onPositionTap", { currentTarget: { dataset: { position: value } } });
    expect(page.data.draft.position).toBe(value);
    expect(page.data.positions.find((position: { value: string }) => position.value === value).selected).toBe(true);
  }
  call(page, "onPositionTap", { currentTarget: { dataset: { position: "SWEEPER" } } });
  expect(page.data.draft.position).toBe("ANY");
  call(page, "onNoteInput", { detail: { value: submission.note } });
  call(page, "onAdultChange", { detail: { value: ["adult"] } });
  call(page, "onRiskChange", { detail: { value: ["risk"] } });
  expect(page.data.validation.valid).toBe(true);
  expect(page.data.canSubmit).toBe(true);
});

test("shows adjacent client errors and cannot persist or send an invalid draft", async () => {
  const api = registerSource();
  const page = loadPage();
  await openReady(page);
  call(page, "onDisplayNameInput", { detail: { value: "微信 pitch_friend" } });
  call(page, "onNoteInput", { detail: { value: "电话 13800138000" } });
  await call(page, "onSubmit");

  expect(page.data.attempted).toBe(true);
  expect(page.data.validation.errors.displayName).toContain("联系");
  expect(page.data.validation.errors.position).toContain("位置");
  expect(page.data.validation.errors.note).toContain("联系");
  expect(page.data.validation.errors.adultConfirmed).toContain("18");
  expect(page.data.validation.errors.riskConfirmed).toContain("风险");
  expect(attemptStore.load()).toBeNull();
  expect(api.apply).not.toHaveBeenCalled();
});

test("cancel and header back discard only local edits, perform zero writes, and return honestly", async () => {
  const api = registerSource();
  const page = loadPage();
  await openReady(page);
  fillValid(page);
  await call(page, "onCancel");
  expect(page.data.draft.displayName).toBe("");
  expect(attemptStore.load()).toBeNull();
  expect(api.apply).not.toHaveBeenCalled();
  expect(wx.navigateBack).toHaveBeenCalledWith(expect.objectContaining({ delta: 1 }));

  (getCurrentPages as unknown as jest.Mock).mockReturnValue([
    { route: "pages/player-game-application/index" },
  ]);
  const deepLink = loadPage();
  await openReady(deepLink);
  fillValid(deepLink);
  await call(deepLink, "onHeaderBack");
  expect(api.apply).not.toHaveBeenCalled();
  expect(wx.redirectTo).toHaveBeenCalledWith(expect.objectContaining({
    url: `/pages/captain-game-public/index?token=${TOKEN}`,
  }));
});

test("persists before send, suppresses duplicate taps, and clears only after authoritative success", async () => {
  let resolveApply!: (context: OpenGameRegistrationContext) => void;
  const pending = new Promise<OpenGameRegistrationContext>((resolve) => { resolveApply = resolve; });
  const api = registerSource({ apply: jest.fn(() => pending) });
  const page = loadPage();
  await openReady(page);
  fillValid(page);

  const first = call(page, "onSubmit");
  const duplicate = call(page, "onSubmit");
  const stored = attemptStore.load();
  expect(api.apply).toHaveBeenCalledTimes(1);
  expect(page.data.status).toBe("SUBMITTING");
  expect(stored).toMatchObject({
    kind: "apply", originatingUserId: USER_ID, shareToken: TOKEN, body: submission,
  });
  expect((api.apply as jest.Mock).mock.calls[0]?.[0]).toEqual(stored);

  resolveApply(appliedContext);
  await first;
  await duplicate;
  expect(attemptStore.load()).toBeNull();
  expect(wx.navigateBack).toHaveBeenCalledTimes(1);
});

test("authoritative success with failed navigation never becomes a second submission", async () => {
  const failNavigation = (options: unknown) => {
    (options as { fail?: (error: Error) => void }).fail?.(new Error("NAV_FAILED"));
  };
  (wx.navigateBack as unknown as jest.Mock).mockImplementation(failNavigation);
  (wx.redirectTo as unknown as jest.Mock).mockImplementation(failNavigation);
  (wx.reLaunch as unknown as jest.Mock).mockImplementation(failNavigation);
  const api = registerSource();
  const page = loadPage();
  await openReady(page);
  fillValid(page);
  await call(page, "onSubmit");

  expect(page.data.status).toBe("SUBMITTED_NAV_ERROR");
  expect(attemptStore.load()).toBeNull();
  expect(api.apply).toHaveBeenCalledTimes(1);
  (wx.navigateBack as unknown as jest.Mock).mockImplementation(completeNavigation);
  await call(page, "onReturnGame");
  expect(api.apply).toHaveBeenCalledTimes(1);
  expect(wx.navigateBack).toHaveBeenCalledTimes(2);
});

test("401 preserves draft and attempt; explicit same-account login reads authority before exact replay", async () => {
  const apply = jest.fn(async () => {
    if (apply.mock.calls.length === 1) throw new OpenGameRegistrationApiError("AUTH_REQUIRED");
    return appliedContext;
  });
  const api = registerSource({ apply });
  const page = loadPage();
  await openReady(page);
  fillValid(page);
  await call(page, "onSubmit");
  const stored = attemptStore.load();

  expect(page.data.status).toBe("AUTH_LOSS");
  expect(page.data.draft.displayName.trim()).toBe(submission.displayName);
  expect(stored).not.toBeNull();
  await call(page, "onLogin");
  expect(api.login).toHaveBeenCalledTimes(1);
  expect(api.getContext).toHaveBeenCalledTimes(2);
  expect(api.apply).toHaveBeenCalledTimes(1);
  expect(page.data.status).toBe("RESULT_UNKNOWN");

  await call(page, "onConfirmResult");
  expect(api.getContext).toHaveBeenCalledTimes(3);
  expect(api.apply).toHaveBeenCalledTimes(2);
  expect((api.apply as jest.Mock).mock.calls[1]?.[0]).toEqual(stored);
  expect(attemptStore.load()).toBeNull();
});

test("an account change after login never rebinds or replays the original attempt", async () => {
  const api = registerSource({
    apply: jest.fn(async () => { throw new OpenGameRegistrationApiError("AUTH_REQUIRED"); }),
    login: jest.fn(async () => {
      currentUserId = OTHER_USER_ID;
      return OTHER_USER_ID;
    }),
  });
  const page = loadPage();
  await openReady(page);
  fillValid(page);
  await call(page, "onSubmit");
  const original = attemptStore.load();
  await call(page, "onLogin");

  expect(page.data.status).toBe("FOREIGN_PENDING");
  expect(api.apply).toHaveBeenCalledTimes(1);
  expect(attemptStore.load()).toEqual(original);
});

test("unknown result first reads context and either accepts authority or replays the exact stored key", async () => {
  let applied = false;
  const apply = jest.fn(async () => {
    if (!applied) {
      applied = true;
      throw new OpenGameRegistrationApiError("APPLICATION_RESULT_UNKNOWN");
    }
    return appliedContext;
  });
  const api = registerSource({ apply });
  const page = loadPage();
  await openReady(page);
  fillValid(page);
  await call(page, "onSubmit");
  const original = attemptStore.load();
  expect(page.data.status).toBe("RESULT_UNKNOWN");

  await call(page, "onConfirmResult");
  expect(api.getContext).toHaveBeenCalledTimes(2);
  expect(api.apply).toHaveBeenCalledTimes(2);
  expect((api.apply as jest.Mock).mock.calls[1]?.[0]).toEqual(original);
  expect(attemptStore.load()).toBeNull();

  resetOpenGameRegistrationSourceForTesting();
  seedAttempt({ idempotencyKey: "application-key-authority-000001" });
  const authority = registerSource({ getContext: jest.fn(async () => appliedContext) });
  const restarted = loadPage();
  call(restarted, "onLoad", { token: TOKEN });
  await flush();
  expect(authority.apply).not.toHaveBeenCalled();
  expect(attemptStore.load()).toBeNull();
  expect(wx.navigateBack).toHaveBeenCalled();
});

test("server validation is inline and definite full/state failures clear the attempt then return to authority", async () => {
  const invalidApi = registerSource({
    apply: jest.fn(async () => {
      throw new OpenGameRegistrationApiError("INVALID_ARGUMENT", {
        fields: [{ field: "display_name", message: "称呼当前不可用" }],
      });
    }),
  });
  const invalid = loadPage();
  await openReady(invalid);
  fillValid(invalid);
  await call(invalid, "onSubmit");
  expect(invalid.data).toMatchObject({ status: "READY", canSubmit: false });
  expect(invalid.data.validation.errors.displayName).toBe("称呼当前不可用");
  expect(attemptStore.load()).toBeNull();
  call(invalid, "onDisplayNameInput", { detail: { value: "周末飞翼" } });
  expect(invalid.data.validation.errors.displayName).toBeNull();
  expect(invalid.data.canSubmit).toBe(true);
  expect(invalidApi.getContext).toHaveBeenCalledTimes(1);

  resetOpenGameRegistrationSourceForTesting();
  const deadlineContext: OpenGameRegistrationContext = {
    ...readyContext,
    allowedActions: { canApply: false, applyBlockedReason: "REGISTRATION_DEADLINE_PASSED" },
  };
  let contextCalls = 0;
  const fullApi = registerSource({
    getContext: jest.fn(async () => {
      contextCalls += 1;
      return contextCalls === 1 ? readyContext : deadlineContext;
    }),
    apply: jest.fn(async () => {
      throw new OpenGameRegistrationApiError("APPLICATION_NOT_ALLOWED", {
        applyBlockedReason: "REGISTRATION_DEADLINE_PASSED", remainingSpots: 4,
      });
    }),
  });
  const full = loadPage();
  await openReady(full);
  fillValid(full);
  await call(full, "onSubmit");
  expect(attemptStore.load()).toBeNull();
  expect(fullApi.getContext).toHaveBeenCalledTimes(2);
  expect(full.data.status).toBe("AUTHORITY_CHANGED");
  expect(wx.navigateBack).toHaveBeenCalled();
});

test.each([
  ["IDEMPOTENCY_KEY_REUSED", "CONFLICT"],
  ["OPEN_GAME_NOT_FOUND", "NOT_FOUND"],
] as const)("definite %s clears the unsubmitted attempt and exposes no false success", async (code, status) => {
  const api = registerSource({
    apply: jest.fn(async () => { throw new OpenGameRegistrationApiError(code); }),
  });
  const page = loadPage();
  await openReady(page);
  fillValid(page);
  await call(page, "onSubmit");
  expect(page.data.status).toBe(status);
  expect(attemptStore.load()).toBeNull();
  expect(api.apply).toHaveBeenCalledTimes(1);
  expect(wx.navigateBack).not.toHaveBeenCalled();
});

test("same-account restart restores the original form and waits for explicit confirmation", async () => {
  const original = seedAttempt();
  const api = registerSource();
  const page = loadPage();
  call(page, "onLoad", { token: TOKEN });
  await flush();

  expect(page.data).toMatchObject({
    status: "RESULT_UNKNOWN",
    draft: {
      displayName: submission.displayName,
      position: submission.position,
      note: submission.note,
      adultConfirmed: true,
      riskConfirmed: true,
    },
  });
  expect(attemptStore.load()).toEqual(original);
  expect(api.apply).not.toHaveBeenCalled();
});

test("same-account pending work for another resource navigates to its deterministic recovery route", async () => {
  seedAttempt({ shareToken: OTHER_TOKEN });
  const api = registerSource();
  const page = loadPage();
  call(page, "onLoad", { token: TOKEN });
  await flush();
  expect(page.data.status).toBe("OTHER_PENDING");

  await call(page, "onGoPending");
  expect(wx.redirectTo).toHaveBeenCalledWith(expect.objectContaining({
    url: `/pages/captain-game-public/index?token=${OTHER_TOKEN}`,
  }));
  expect(api.apply).not.toHaveBeenCalled();
  expect(attemptStore.load()).not.toBeNull();
});

test("pending and ordinary return navigation failures stay visibly recoverable inline", async () => {
  const failNavigation = (options: unknown) => {
    (options as { fail?: (error: Error) => void }).fail?.(new Error("NAV_FAILED"));
  };
  seedAttempt({ shareToken: OTHER_TOKEN });
  const api = registerSource();
  const pending = loadPage();
  call(pending, "onLoad", { token: TOKEN });
  await flush();
  (wx.redirectTo as unknown as jest.Mock).mockImplementation(failNavigation);
  (wx.reLaunch as unknown as jest.Mock).mockImplementation(failNavigation);
  await call(pending, "onGoPending");
  expect(pending.data.navigationError).toContain("无法前往确认");
  expect(api.apply).not.toHaveBeenCalled();

  (wx.navigateBack as unknown as jest.Mock).mockImplementation(failNavigation);
  await call(pending, "onReturnGame");
  expect(pending.data.navigationError).toContain("无法返回球局详情");
  expect(api.apply).not.toHaveBeenCalled();
});

test("different-account pending work is never sent and explicit local clear reloads current authority", async () => {
  const original = seedAttempt();
  currentUserId = OTHER_USER_ID;
  const api = registerSource();
  const page = loadPage();
  call(page, "onLoad", { token: TOKEN });
  await flush();
  expect(page.data.status).toBe("FOREIGN_PENDING");
  expect(attemptStore.load()).toEqual(original);
  expect(api.apply).not.toHaveBeenCalled();

  await call(page, "onClearPending");
  expect(attemptStore.load()).toBeNull();
  expect(api.getContext).toHaveBeenCalledTimes(2);
  expect(page.data.status).toBe("READY");
  expect(api.apply).not.toHaveBeenCalled();
});

test("a current-session storage failure at submit cannot persist or send an application", async () => {
  let failCurrentUserRead = false;
  const api = registerSource({
    currentUserId: jest.fn(() => {
      if (failCurrentUserRead) throw new Error("LOCAL_SESSION_READ_FAILED");
      return USER_ID;
    }),
  });
  const page = loadPage();
  await openReady(page);
  fillValid(page);
  failCurrentUserRead = true;

  expect(() => call(page, "onSubmit")).not.toThrow();
  expect(page.data.status).toBe("AUTH_LOSS");
  expect(attemptStore.load()).toBeNull();
  expect(api.apply).not.toHaveBeenCalled();
});

test("does not narrow a contract-valid decoded user UUID before persistence or send", async () => {
  currentUserId = CONTRACT_UUID;
  const api = registerSource();
  const page = loadPage();
  await openReady(page);
  fillValid(page);
  expect(page.data.canSubmit).toBe(true);

  await call(page, "onSubmit");
  expect(api.apply).toHaveBeenCalledWith(expect.objectContaining({
    originatingUserId: CONTRACT_UUID,
  }));
});

test("unknown recovery never replays or clears when the durable record changes during its read", async () => {
  seedAttempt();
  let reads = 0;
  const api = registerSource({
    getContext: jest.fn(async () => {
      reads += 1;
      if (reads === 2) {
        attemptStore.clear();
        seedAttempt({
          shareToken: OTHER_TOKEN,
          idempotencyKey: "application-key-other-resource-01",
        });
      }
      return readyContext;
    }),
  });
  const page = loadPage();
  call(page, "onLoad", { token: TOKEN });
  await flush();
  expect(page.data.status).toBe("RESULT_UNKNOWN");

  await call(page, "onConfirmResult");
  expect(api.apply).not.toHaveBeenCalled();
  expect(attemptStore.load()).toMatchObject({
    kind: "apply",
    shareToken: OTHER_TOKEN,
    idempotencyKey: "application-key-other-resource-01",
  });
  expect(page.data.status).toBe("OTHER_PENDING");
});

test("submission follows canApply alone and never invents a capacity or date blocker", async () => {
  const strangeButAuthoritative: OpenGameRegistrationContext = {
    ...readyContext,
    remainingSpots: 0,
    allowedActions: { canApply: true, applyBlockedReason: null },
  };
  const api = registerSource({ getContext: jest.fn(async () => strangeButAuthoritative) });
  const page = loadPage();
  await openReady(page);
  fillValid(page);
  expect(page.data.canSubmit).toBe(true);
  await call(page, "onSubmit");
  expect(api.apply).toHaveBeenCalledTimes(1);

  resetOpenGameRegistrationSourceForTesting();
  const blockedContext: OpenGameRegistrationContext = {
    ...readyContext,
    allowedActions: { canApply: false, applyBlockedReason: "GAME_SUSPENDED" },
  };
  const blockedApi = registerSource({ getContext: jest.fn(async () => blockedContext) });
  const blocked = loadPage();
  call(blocked, "onLoad", { token: TOKEN });
  await flush();
  expect(blocked.data.status).toBe("AUTHORITY_CHANGED");
  await call(blocked, "onSubmit");
  expect(blockedApi.apply).not.toHaveBeenCalled();
});

test("load errors have real retry/login/not-found recovery without losing a durable attempt", async () => {
  let calls = 0;
  const flaky = registerSource({
    getContext: jest.fn(async () => {
      calls += 1;
      if (calls === 1) throw new OpenGameRegistrationApiError("SERVICE_UNAVAILABLE");
      return readyContext;
    }),
  });
  const page = loadPage();
  call(page, "onLoad", { token: TOKEN });
  await flush();
  expect(page.data.status).toBe("LOAD_ERROR");
  await call(page, "onReload");
  expect(page.data.status).toBe("READY");
  expect(flaky.getContext).toHaveBeenCalledTimes(2);

  resetOpenGameRegistrationSourceForTesting();
  const auth = registerSource({
    getContext: jest.fn(async () => { throw new OpenGameRegistrationApiError("AUTH_REQUIRED"); }),
  });
  const authPage = loadPage();
  call(authPage, "onLoad", { token: TOKEN });
  await flush();
  expect(authPage.data.status).toBe("AUTH_LOSS");
  await call(authPage, "onLogin");
  expect(auth.login).toHaveBeenCalledTimes(1);

  resetOpenGameRegistrationSourceForTesting();
  registerSource({
    getContext: jest.fn(async () => { throw new OpenGameRegistrationApiError("OPEN_GAME_NOT_FOUND"); }),
  });
  const missing = loadPage();
  call(missing, "onLoad", { token: TOKEN });
  await flush();
  expect(missing.data.status).toBe("NOT_FOUND");
});

test("hide and unload invalidate late reads and writes without clearing the durable attempt", async () => {
  let resolveLoad!: (context: OpenGameRegistrationContext) => void;
  const pendingLoad = new Promise<OpenGameRegistrationContext>((resolve) => { resolveLoad = resolve; });
  registerSource({ getContext: jest.fn(() => pendingLoad) });
  const loading = loadPage();
  call(loading, "onLoad", { token: TOKEN });
  call(loading, "onHide");
  resolveLoad(readyContext);
  await flush();
  expect(loading.data.status).toBe("LOADING");

  resetOpenGameRegistrationSourceForTesting();
  let resolveApply!: (context: OpenGameRegistrationContext) => void;
  const pendingApply = new Promise<OpenGameRegistrationContext>((resolve) => { resolveApply = resolve; });
  const api = registerSource({ apply: jest.fn(() => pendingApply) });
  const submitting = loadPage();
  await openReady(submitting);
  fillValid(submitting);
  const request = call(submitting, "onSubmit");
  const original = attemptStore.load();
  call(submitting, "onUnload");
  resolveApply(appliedContext);
  await request;
  expect(api.apply).toHaveBeenCalledTimes(1);
  expect(attemptStore.load()).toEqual(original);
  expect(wx.navigateBack).not.toHaveBeenCalled();
});
