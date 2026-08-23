/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */

import { beforeEach, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";

import type { OpenGameOwner } from "../../domain/open-game";
import { OpenGameApiError } from "../../services/http-open-game";
import {
  registerOpenGameMutationAttemptStore,
  registerOpenGameSource,
  resetOpenGameMutationAttemptStoreForTesting,
  resetOpenGameSourceForTesting,
  type OpenGameMutationAttempt,
  type OpenGameMutationAttemptStore,
  type OpenGameSource,
} from "../../services/open-game";

type PageDefinition = Record<string, any> & { data: Record<string, any> };
type RuntimePage = PageDefinition & { setData(patch: Record<string, unknown>): void };
const call = (page: RuntimePage, method: string, ...args: unknown[]) => page[method].apply(page, args);
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
let captured: PageDefinition | undefined;
function loadPage(): RuntimePage {
  if (!captured) {
    (globalThis as any).Page = (definition: PageDefinition) => { captured = definition; };
    jest.requireActual("./index");
  }
  return {
    ...captured!, data: structuredClone(captured!.data),
    setData(patch: Record<string, unknown>) { Object.assign(this.data, patch); },
    loadGeneration: 0, mutationInFlight: null, currentAttempt: null, foreignAttempt: null, owner: null, visible: true,
  } as RuntimePage;
}

const gameId = "00000000-0000-4000-8000-000000000301";
const orderId = "00000000-0000-4000-8000-000000000302";
const order = {
  venueName: "天津奥体足球场", pitchName: "七人制 A 场", pitchSpecification: "7人制", playersPerSide: 7,
  bookingPriceCents: 42000, startsAt: "2099-08-29T20:00:00+08:00", endsAt: "2099-08-29T22:00:00+08:00", timeZone: "Asia/Shanghai",
} as const;
function owner(overrides: Partial<OpenGameOwner> = {}): OpenGameOwner {
  const state = overrides.state ?? "DRAFT";
  const publicView = {
    name: "周末轻松局", teamName: "津门蓝队", state, stateReason: state === "SUSPENDED" ? "BOOKING_UNAVAILABLE" as const : state === "CANCELLED" ? "CAPTAIN_CANCELLED" as const : state === "COMPLETED" ? "BOOKING_COMPLETED" as const : null,
    venueName: order.venueName, pitchName: order.pitchName, pitchSpecification: order.pitchSpecification,
    startsAt: order.startsAt, endsAt: order.endsAt, timeZone: order.timeZone,
    totalPlayers: 14, fixedPlayers: 8, openSpots: 4, intensity: "CASUAL" as const, minimumExperience: "会传接球即可",
    positions: ["ANY"] as const, aaCents: 3000, registrationDeadline: "2099-08-29T18:00:00+08:00",
    equipmentAndArrivalNotes: "提前到场", visibility: "PUBLIC" as const,
  };
  return {
    id: gameId, orderId, order, name: publicView.name,
    team: { id: "00000000-0000-4000-8000-000000000303", name: publicView.teamName },
    totalPlayers: 14, fixedPlayers: 8, openSpots: 4, intensity: "CASUAL", minimumExperience: "会传接球即可", positions: ["ANY"], aaCents: 3000,
    registrationDeadline: publicView.registrationDeadline, equipmentAndArrivalNotes: "提前到场", visibility: "PUBLIC",
    persistedStatus: state === "CANCELLED" ? "CANCELLED" : state === "DRAFT" ? "DRAFT" : "PUBLISHED",
    state, stateReason: state === "SUSPENDED" ? "ORDER_REFUND_PENDING" : state === "CANCELLED" ? "CAPTAIN_CANCELLED" : state === "COMPLETED" ? "ORDER_COMPLETED" : null,
    version: 1,
    allowedActions: { canEdit: state === "DRAFT" || state === "PUBLISHED", canPublish: state === "DRAFT", canShare: state === "PUBLISHED", canCancel: state === "DRAFT" || state === "PUBLISHED" || state === "SUSPENDED", canPreview: state !== "CANCELLED" },
    share: state === "PUBLISHED" ? { title: "周末轻松局 · 周六 20:00", path: "/pages/captain-game-public/index?token=abcdefghijklmnopqrstuvwxyzABCDEF", imageUrl: null } : null,
    publicView, ...overrides,
  };
}

let storedAttempt: OpenGameMutationAttempt | null;
const store: OpenGameMutationAttemptStore = {
  load: () => storedAttempt,
  begin(attempt) {
    if (storedAttempt && JSON.stringify({ ...storedAttempt, idempotencyKey: "" }) !== JSON.stringify({ ...attempt, idempotencyKey: "" })) return { kind: "FOREIGN_PENDING", attempt: storedAttempt };
    storedAttempt ??= attempt;
    return { kind: "READY", attempt: storedAttempt };
  },
  clear: jest.fn(() => { storedAttempt = null; }),
};
function source(overrides: Partial<OpenGameSource> = {}): OpenGameSource {
  return {
    login: jest.fn(async () => undefined), getEntry: jest.fn(), getOwnedGame: jest.fn(async () => owner()), getSharedGame: jest.fn(),
    create: jest.fn(), update: jest.fn(), publish: jest.fn(async () => owner({ state: "PUBLISHED", persistedStatus: "PUBLISHED", version: 2, allowedActions: { canEdit: true, canPublish: false, canShare: true, canCancel: true, canPreview: true }, share: { title: "safe", path: "/pages/captain-game-public/index?token=abcdefghijklmnopqrstuvwxyzABCDEF", imageUrl: null } })),
    cancel: jest.fn(async () => owner({ state: "CANCELLED", persistedStatus: "CANCELLED", version: 2, allowedActions: { canEdit: false, canPublish: false, canShare: false, canCancel: false, canPreview: false }, share: null })),
    ...overrides,
  } as OpenGameSource;
}

beforeEach(() => {
  resetOpenGameSourceForTesting(); resetOpenGameMutationAttemptStoreForTesting(); storedAttempt = null;
  (store.clear as jest.Mock).mockClear(); registerOpenGameMutationAttemptStore(store);
  (globalThis as any).wx = {
    getWindowInfo: jest.fn(() => ({ windowWidth: 375, statusBarHeight: 44 })),
    getMenuButtonBoundingClientRect: jest.fn(() => ({ top: 48, left: 278, width: 87, height: 32 })),
    hideShareMenu: jest.fn(async () => undefined), showShareMenu: jest.fn(async () => undefined),
    navigateTo: jest.fn(async () => undefined), navigateBack: jest.fn(async () => undefined), redirectTo: jest.fn(async () => undefined), reLaunch: jest.fn(async () => undefined),
  };
  (globalThis as any).getCurrentPages = jest.fn(() => [{ route: "pages/order-detail/index" }, { route: "pages/captain-game-manage/index" }]);
});

test("loads authority, hides share by default, and projects every action independently", async () => {
  const api = source(); registerOpenGameSource(api);
  const page = loadPage(); call(page, "onLoad", { game_id: gameId });
  expect(page.data.status).toBe("LOADING"); expect(wx.hideShareMenu).toHaveBeenCalled();
  await flush();
  expect(page.data).toMatchObject({ status: "READY", state: "DRAFT", canEdit: true, canPublish: true, canShare: false, canCancel: true, canPreview: true });
  expect(wx.showShareMenu).not.toHaveBeenCalled();

  const latePublished = owner({ state: "PUBLISHED", persistedStatus: "PUBLISHED", registrationDeadline: "2020-01-01T08:00:00+08:00", allowedActions: { canEdit: true, canPublish: false, canShare: true, canCancel: true, canPreview: true }, share: { title: "safe", path: "/pages/captain-game-public/index?token=abcdefghijklmnopqrstuvwxyzABCDEF", imageUrl: null } });
  resetOpenGameSourceForTesting(); registerOpenGameSource(source({ getOwnedGame: jest.fn(async () => latePublished) }));
  const published = loadPage(); call(published, "onLoad", { game_id: gameId }); await flush();
  expect(published.data).toMatchObject({ state: "PUBLISHED", canEdit: true, canShare: true, canCancel: true });
  expect(wx.showShareMenu).toHaveBeenCalled();
});

test("a new manager restores and resolves its persisted same-game terminal publish", async () => {
  storedAttempt = { kind: "publish", gameId, expectedVersion: 1, idempotencyKey: "open-game-restored-current-0001" };
  const published = owner({
    state: "PUBLISHED",
    persistedStatus: "PUBLISHED",
    version: 2,
    allowedActions: { canEdit: true, canPublish: false, canShare: true, canCancel: true, canPreview: true },
    share: { title: "safe", path: "/pages/captain-game-public/index?token=abcdefghijklmnopqrstuvwxyzABCDEF", imageUrl: null },
  });
  const api = source({ getOwnedGame: jest.fn(async () => published) });
  registerOpenGameSource(api);
  const page = loadPage(); call(page, "onLoad", { game_id: gameId }); await flush();

  expect(page.data).toMatchObject({ status: "MUTATION_UNKNOWN", state: "PUBLISHED", pendingKind: "publish", canCancel: true });
  expect(readFileSync("miniprogram/pages/captain-game-manage/index.wxml", "utf8")).toContain('bindtap="onConfirmUnknown">确认操作结果');
  call(page, "onOpenCancel");
  expect(page.data.panel).toBe("");
  await call(page, "onEdit");
  expect(wx.navigateTo).not.toHaveBeenCalled();

  await call(page, "onConfirmUnknown");

  expect(api.getOwnedGame).toHaveBeenCalledTimes(2);
  expect(store.clear).toHaveBeenCalledTimes(1);
  expect(page.data).toMatchObject({ status: "READY", state: "PUBLISHED" });
  expect(wx.navigateTo).not.toHaveBeenCalled();
  expect(wx.redirectTo).not.toHaveBeenCalled();
});

test.each([
  { label: "current definitive 404", attemptGameId: gameId, code: "OPEN_GAME_NOT_FOUND", expectedStatus: "NOT_FOUND", shouldClear: true },
  { label: "foreign definitive 404", attemptGameId: "00000000-0000-4000-8000-000000000399", code: "OPEN_GAME_NOT_FOUND", expectedStatus: "NOT_FOUND", shouldClear: false },
  { label: "current second auth failure", attemptGameId: gameId, code: "AUTH_REQUIRED", expectedStatus: "AUTH_LOSS", shouldClear: true },
  { label: "current transient failure", attemptGameId: gameId, code: "SERVICE_UNAVAILABLE", expectedStatus: "LOAD_ERROR", shouldClear: false },
] as const)("initial $label clears only a definitively unusable matching attempt", async ({ attemptGameId, code, expectedStatus, shouldClear }) => {
  const persisted: OpenGameMutationAttempt = {
    kind: "cancel", gameId: attemptGameId, expectedVersion: 1, idempotencyKey: "open-game-load-error-0001",
  };
  storedAttempt = persisted;
  registerOpenGameSource(source({ getOwnedGame: jest.fn(async () => { throw new OpenGameApiError(code); }) }));
  const page = loadPage(); call(page, "onLoad", { game_id: gameId }); await flush();

  expect(page.data.status).toBe(expectedStatus);
  expect(wx.navigateTo).not.toHaveBeenCalled();
  expect(wx.redirectTo).not.toHaveBeenCalled();
  if (shouldClear) {
    expect(store.clear).toHaveBeenCalledTimes(1);
    expect(storedAttempt).toBeNull();
  } else {
    expect(store.clear).not.toHaveBeenCalled();
    expect(storedAttempt).toEqual(persisted);
  }
});

test("malformed, not-found, load-error and auth-loss expose only real recovery", async () => {
  registerOpenGameSource(source());
  const malformed = loadPage(); call(malformed, "onLoad", { game_id: "bad" });
  expect(malformed.data).toMatchObject({ status: "NOT_FOUND", canEdit: false, canPublish: false });

  let loadCalls = 0;
  resetOpenGameSourceForTesting(); const flaky = source({ getOwnedGame: jest.fn(async () => { loadCalls += 1; if (loadCalls === 1) throw new OpenGameApiError("SERVICE_UNAVAILABLE"); return owner(); }) }); registerOpenGameSource(flaky);
  const page = loadPage(); call(page, "onLoad", { game_id: gameId }); await flush(); expect(page.data.status).toBe("LOAD_ERROR");
  call(page, "onReload"); await flush(); expect(page.data.status).toBe("READY");

  resetOpenGameSourceForTesting(); const auth = source({ getOwnedGame: jest.fn(async () => { throw new OpenGameApiError("AUTH_REQUIRED"); }) }); registerOpenGameSource(auth);
  const authPage = loadPage(); call(authPage, "onLoad", { game_id: gameId }); await flush(); expect(authPage.data.status).toBe("AUTH_LOSS");
  await call(authPage, "onLogin"); expect(auth.login).toHaveBeenCalledTimes(1);
});

test("approved visible buttons are native and backed by real handlers", () => {
  const wxml = readFileSync("miniprogram/pages/captain-game-manage/index.wxml", "utf8");
  expect(wxml).toContain('open-type="share"');
  for (const handler of ["onReload", "onLogin", "onOpenPublish", "onClosePanel", "onConfirmPublish", "onOpenCancel", "onConfirmCancel", "onEdit", "onPreview", "onReturnOrder", "onHeaderBack", "onConfirmUnknown", "onConfirmPreviousOperation"]) expect(wxml).toContain(handler);
  expect(wxml).toContain("不会取消已预订场地，也不会改变订单、支付或退款状态");
  expect(wxml).toContain("正在提交操作");
  expect(wxml).not.toContain("status === 'READY' || status === 'MUTATING'");
});

test("native share uses only authoritative share and never mutates state", async () => {
  const published = owner({ state: "PUBLISHED", persistedStatus: "PUBLISHED", allowedActions: { canEdit: true, canPublish: false, canShare: true, canCancel: true, canPreview: true }, share: { title: "安全标题", path: "/pages/captain-game-public/index?token=abcdefghijklmnopqrstuvwxyzABCDEF", imageUrl: null } });
  registerOpenGameSource(source({ getOwnedGame: jest.fn(async () => published) }));
  const page = loadPage(); call(page, "onLoad", { game_id: gameId }); await flush();
  expect(call(page, "onShareAppMessage")).toEqual({ title: "安全标题", path: published.share?.path });
  call(page, "onShareFailure"); expect(page.data.state).toBe("PUBLISHED");
});

test("publish modal closes without mutation, serializes confirm, and applies authority", async () => {
  let resolve!: (value: OpenGameOwner) => void; const pending = new Promise<OpenGameOwner>((yes) => { resolve = yes; });
  const api = source({ publish: jest.fn(() => pending) }); registerOpenGameSource(api);
  const page = loadPage(); call(page, "onLoad", { game_id: gameId }); await flush();
  call(page, "onOpenPublish"); expect(page.data.panel).toBe("publish"); call(page, "onClosePanel"); expect(api.publish).not.toHaveBeenCalled();
  call(page, "onOpenPublish"); const first = call(page, "onConfirmPublish"); const duplicate = call(page, "onConfirmPublish");
  expect(api.publish).toHaveBeenCalledTimes(1); expect(page.data.status).toBe("MUTATING");
  expect(readFileSync("miniprogram/pages/captain-game-manage/index.wxml", "utf8")).toContain("wx:if=\"{{status === 'READY'}}\"");
  resolve(owner({ state: "PUBLISHED", persistedStatus: "PUBLISHED", version: 2, allowedActions: { canEdit: true, canPublish: false, canShare: true, canCancel: true, canPreview: true }, share: { title: "safe", path: "/pages/captain-game-public/index?token=abcdefghijklmnopqrstuvwxyzABCDEF", imageUrl: null } }));
  await first; await duplicate; expect(page.data.state).toBe("PUBLISHED"); expect(store.clear).toHaveBeenCalledTimes(1);
});

test("hide invalidates a late mutation without clearing its durable attempt", async () => {
  let resolve!: (value: OpenGameOwner) => void;
  const pending = new Promise<OpenGameOwner>((yes) => { resolve = yes; });
  const api = source({ publish: jest.fn(() => pending) }); registerOpenGameSource(api);
  const page = loadPage(); call(page, "onLoad", { game_id: gameId }); await flush();
  call(page, "onOpenPublish"); const publishing = call(page, "onConfirmPublish");
  call(page, "onHide");

  resolve(owner({ state: "PUBLISHED", persistedStatus: "PUBLISHED", version: 2 })); await publishing;

  expect(page.data.status).toBe("MUTATING");
  expect(store.clear).not.toHaveBeenCalled();
  expect(storedAttempt).not.toBeNull();
});

test("first-page malformed route returns to the real order list", () => {
  registerOpenGameSource(source());
  (globalThis as any).getCurrentPages = jest.fn(() => [{ route: "pages/captain-game-manage/index" }]);
  const page = loadPage(); call(page, "onLoad", { game_id: "bad" });

  call(page, "onReturnOrder");

  expect(wx.reLaunch).toHaveBeenCalledWith({ url: "/pages/my-orders/index" });
});

test("unknown publish replays the original attempt and state-change clamps authority", async () => {
  let calls = 0;
  const api = source({ publish: jest.fn(async () => { calls += 1; if (calls === 1) throw new OpenGameApiError("OPEN_GAME_RESULT_UNKNOWN"); return owner({ state: "PUBLISHED", persistedStatus: "PUBLISHED", version: 2 }); }), getOwnedGame: jest.fn(async () => owner()) });
  registerOpenGameSource(api); const page = loadPage(); call(page, "onLoad", { game_id: gameId }); await flush();
  call(page, "onOpenPublish"); await call(page, "onConfirmPublish"); const original = storedAttempt;
  if (!original || original.kind !== "publish") throw new Error("ATTEMPT_NOT_STORED");
  expect(page.data.status).toBe("MUTATION_UNKNOWN"); await call(page, "onConfirmUnknown");
  expect((api.publish as jest.Mock).mock.calls[1]?.[0]).toEqual(original); expect(store.clear).toHaveBeenCalled();

  resetOpenGameSourceForTesting(); storedAttempt = null;
  const latest = owner({ state: "PUBLISHED", persistedStatus: "PUBLISHED", version: 2, allowedActions: { canEdit: true, canPublish: false, canShare: true, canCancel: true, canPreview: true }, share: { title: "safe", path: "/pages/captain-game-public/index?token=abcdefghijklmnopqrstuvwxyzABCDEF", imageUrl: null } });
  const changed = source({ publish: jest.fn(async () => { throw new OpenGameApiError("OPEN_GAME_STATE_CHANGED"); }), getOwnedGame: jest.fn(async () => latest) }); registerOpenGameSource(changed);
  const clamped = loadPage(); call(clamped, "onLoad", { game_id: gameId }); await flush(); call(clamped, "onOpenPublish"); await call(clamped, "onConfirmPublish");
  expect(clamped.data.state).toBe("PUBLISHED"); expect(store.clear).toHaveBeenCalled();
});

test("foreign pending replaces mutations and resolves its own resource", async () => {
  const foreignId = "00000000-0000-4000-8000-000000000399";
  storedAttempt = { kind: "cancel", gameId: foreignId, expectedVersion: 4, idempotencyKey: "open-game-existing-0002" };
  const api = source({ getOwnedGame: jest.fn(async (id) => id === foreignId ? owner({ id: foreignId, state: "CANCELLED", persistedStatus: "CANCELLED", version: 5, allowedActions: { canEdit: false, canPublish: false, canShare: false, canCancel: false, canPreview: false }, share: null }) : owner()) });
  registerOpenGameSource(api); const page = loadPage(); call(page, "onLoad", { game_id: gameId }); await flush();
  call(page, "onOpenPublish"); await call(page, "onConfirmPublish"); expect(page.data.status).toBe("FOREIGN_PENDING");
  await call(page, "onConfirmPreviousOperation"); expect(api.getOwnedGame).toHaveBeenCalledWith(foreignId); expect(store.clear).toHaveBeenCalled(); expect(page.data.status).toBe("READY");
});

test("cancel is confirmed, navigation actions are real, and suspended reason is inline", async () => {
  const api = source(); registerOpenGameSource(api); const page = loadPage(); call(page, "onLoad", { game_id: gameId }); await flush();
  call(page, "onOpenCancel"); expect(page.data.panel).toBe("cancel"); await call(page, "onConfirmCancel"); expect(api.cancel).toHaveBeenCalledTimes(1); expect(page.data.state).toBe("CANCELLED");

  resetOpenGameSourceForTesting(); registerOpenGameSource(source()); const nav = loadPage(); call(nav, "onLoad", { game_id: gameId }); await flush();
  await call(nav, "onEdit"); await call(nav, "onPreview");
  expect(wx.navigateTo).toHaveBeenCalledWith(expect.objectContaining({ url: `/pages/captain-game-form/index?game_id=${gameId}` }));
  expect(wx.navigateTo).toHaveBeenCalledWith(expect.objectContaining({ url: `/pages/captain-game-public/index?game_id=${gameId}&preview=1` }));

  resetOpenGameSourceForTesting(); registerOpenGameSource(source({ getOwnedGame: jest.fn(async () => owner({ state: "SUSPENDED", persistedStatus: "PUBLISHED", allowedActions: { canEdit: false, canPublish: false, canShare: false, canCancel: true, canPreview: true }, share: null })) }));
  const suspended = loadPage(); call(suspended, "onLoad", { game_id: gameId }); await flush(); expect(suspended.data.stateReasonText).toContain("退款"); expect(suspended.data.canEdit).toBe(false);
});
