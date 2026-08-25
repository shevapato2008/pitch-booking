/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */

import { beforeEach, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";

import type { OpenGameEntry, OpenGameOwner } from "../../domain/open-game";
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
    ...captured!,
    data: structuredClone(captured!.data),
    setData(patch: Record<string, unknown>) { Object.assign(this.data, patch); },
    loadGeneration: 0,
    mutationInFlight: null,
    visible: true,
  } as RuntimePage;
}

const orderId = "00000000-0000-4000-8000-000000000201";
const gameId = "00000000-0000-4000-8000-000000000202";
const order = {
  venueName: "天津奥体足球场", pitchName: "七人制 A 场", pitchSpecification: "7人制",
  playersPerSide: 7, bookingPriceCents: 42000,
  startsAt: "2099-08-29T20:00:00+08:00", endsAt: "2099-08-29T22:00:00+08:00", timeZone: "Asia/Shanghai",
} as const;
const publicView = {
  name: "周末轻松局", teamName: "津门蓝队", state: "DRAFT", stateReason: null,
  venueName: order.venueName, pitchName: order.pitchName, pitchSpecification: order.pitchSpecification,
  startsAt: order.startsAt, endsAt: order.endsAt, timeZone: order.timeZone,
  totalPlayers: 14, fixedPlayers: 8, openSpots: 4, intensity: "CASUAL", minimumExperience: "会传接球即可",
  positions: ["GOALKEEPER", "DEFENDER"] as const, aaCents: 3000,
  registrationDeadline: "2099-08-29T18:00:00+08:00", equipmentAndArrivalNotes: "提前到场", visibility: "PUBLIC",
} as const;
const owner = (overrides: Partial<OpenGameOwner> = {}): OpenGameOwner => ({
  id: gameId, orderId, order, name: publicView.name,
  team: { id: "00000000-0000-4000-8000-000000000203", name: publicView.teamName },
  totalPlayers: 14, fixedPlayers: 8, openSpots: 4, intensity: "CASUAL", minimumExperience: "会传接球即可",
  positions: ["GOALKEEPER", "DEFENDER"], aaCents: 3000,
  registrationDeadline: publicView.registrationDeadline, equipmentAndArrivalNotes: "提前到场", visibility: "PUBLIC",
  persistedStatus: "DRAFT", state: "DRAFT", stateReason: null, version: 1,
  allowedActions: { canEdit: true, canPublish: true, canShare: false, canCancel: true, canPreview: true },
  share: null, publicView, ...overrides,
});

let storedAttempt: OpenGameMutationAttempt | null;
const store: OpenGameMutationAttemptStore = {
  load: () => storedAttempt,
  begin(attempt) {
    if (storedAttempt && JSON.stringify({ ...storedAttempt, idempotencyKey: "" }) !== JSON.stringify({ ...attempt, idempotencyKey: "" })) {
      return { kind: "FOREIGN_PENDING", attempt: storedAttempt };
    }
    storedAttempt ??= attempt;
    return { kind: "READY", attempt: storedAttempt };
  },
  clear: jest.fn(() => { storedAttempt = null; }),
};

function source(overrides: Partial<OpenGameSource> = {}): OpenGameSource {
  return {
    login: jest.fn(async () => undefined),
    getEntry: jest.fn(async (): Promise<OpenGameEntry> => ({ entry: "CREATE", order, gameId: null, blockedReason: null })),
    getOwnedGame: jest.fn(async () => owner()),
    getSharedGame: jest.fn(async () => publicView),
    create: jest.fn(async () => owner()),
    update: jest.fn(async () => owner({ version: 2 })),
    publish: jest.fn(async () => owner()),
    cancel: jest.fn(async () => owner()),
    ...overrides,
  };
}

beforeEach(() => {
  resetOpenGameSourceForTesting();
  resetOpenGameMutationAttemptStoreForTesting();
  storedAttempt = null;
  (store.clear as jest.Mock).mockClear();
  registerOpenGameMutationAttemptStore(store);
  (globalThis as any).wx = {
    getWindowInfo: jest.fn(() => ({ windowWidth: 375, statusBarHeight: 44 })),
    getMenuButtonBoundingClientRect: jest.fn(() => ({ top: 48, left: 278, width: 87, height: 32 })),
    navigateTo: jest.fn(async () => undefined), navigateBack: jest.fn(async () => undefined),
    redirectTo: jest.fn(async () => undefined), reLaunch: jest.fn(async () => undefined),
  };
  (globalThis as any).getCurrentPages = jest.fn(() => [{ route: "pages/order-detail/index" }, { route: "pages/captain-game-form/index" }]);
});

test("create authority loads immutable order facts and every planned native control", async () => {
  registerOpenGameSource(source());
  const page = loadPage();
  call(page, "onLoad", { order_id: orderId });
  expect(page.data.status).toBe("LOADING");
  await flush();
  expect(page.data).toMatchObject({ status: "READY", mode: "create", order: { venueName: order.venueName }, saveLabel: "保存草稿" });
  expect(page.data).toMatchObject({ headerTopPx: 44, headerRowHeightPx: 44, headerHeightPx: 88, headerLeftInsetPx: 105, headerRightInsetPx: 105 });
  expect(page.data.form.aaYuan).toBe("");
  expect(page.data.form.aaSuggestionCents).toBe(3000);

  const wxml = readFileSync("miniprogram/pages/captain-game-form/index.wxml", "utf8");
  for (const control of ["onTextInput", "onFieldBlur", "onStepper", "onIntensityChange", "onPositionsChange", "onAaInput", "onDeadlineDateChange", "onDeadlineTimeChange", "onNotesInput", "onVisibilityChange"]) {
    expect(wxml).toContain(control);
  }
  expect(wxml).toContain("不可修改");
  expect(wxml).toContain('class="header__system" style="height: {{headerTopPx}}px;"');
  expect(wxml).toContain('class="header" style="height: {{headerRowHeightPx}}px;"');
  expect(wxml).not.toContain("padding-left: {{headerLeftInsetPx}}px");
  expect(wxml).toContain("到场线下结算，平台不代收或担保");
  expect(wxml).not.toContain(".indexOf(");
  expect(page.data.positions.find((position: { value: string }) => position.value === "ANY").checked).toBe(true);
});

test("a new form restores a persisted foreign terminal attempt before exposing save", async () => {
  const foreignGameId = "00000000-0000-4000-8000-000000000299";
  storedAttempt = { kind: "cancel", gameId: foreignGameId, expectedVersion: 4, idempotencyKey: "open-game-restored-foreign-0001" };
  const api = source({
    getOwnedGame: jest.fn(async () => owner({
      id: foreignGameId,
      state: "CANCELLED",
      persistedStatus: "CANCELLED",
      version: 5,
      allowedActions: { canEdit: false, canPublish: false, canShare: false, canCancel: false, canPreview: false },
    })),
  });
  registerOpenGameSource(api);
  const page = loadPage(); call(page, "onLoad", { order_id: orderId }); await flush();

  expect(page.data).toMatchObject({ status: "FOREIGN_PENDING", canSave: false, pendingKind: "cancel" });
  const initialName = page.data.form.name;
  call(page, "onTextInput", { currentTarget: { dataset: { field: "name" } }, detail: { value: "不应写入" } });
  expect(page.data.form.name).toBe(initialName);
  expect(readFileSync("miniprogram/pages/captain-game-form/index.wxml", "utf8")).toContain('bindtap="onConfirmPreviousOperation">确认上次操作');

  await call(page, "onConfirmPreviousOperation");

  expect(api.getOwnedGame).toHaveBeenCalledWith(foreignGameId);
  expect(api.getEntry).toHaveBeenCalledTimes(2);
  expect(store.clear).toHaveBeenCalledTimes(1);
  expect(page.data).toMatchObject({ status: "READY", mode: "create", orderId });
  expect(wx.redirectTo).not.toHaveBeenCalled();
});

test("malformed, ineligible and auth-loss routes expose only real return, retry or login actions", async () => {
  const first = source({ getEntry: jest.fn(async (): Promise<OpenGameEntry> => ({ entry: "NONE", order: null, gameId: null, blockedReason: "ORDER_NOT_ELIGIBLE" })) });
  registerOpenGameSource(first);
  const page = loadPage();
  call(page, "onLoad", { order_id: orderId }); await flush();
  expect(page.data).toMatchObject({ status: "INELIGIBLE", canSave: false });
  await call(page, "onReturnOrder");
  expect(wx.navigateBack).toHaveBeenCalledWith({ delta: 1 });

  const invalid = loadPage();
  call(invalid, "onLoad", { order_id: "bad" });
  expect(invalid.data).toMatchObject({ status: "INELIGIBLE", canSave: false });

  resetOpenGameSourceForTesting();
  const auth = source({ getEntry: jest.fn(async () => { throw new OpenGameApiError("AUTH_REQUIRED"); }) });
  registerOpenGameSource(auth);
  const authPage = loadPage();
  call(authPage, "onLoad", { order_id: orderId }); await flush();
  expect(authPage.data).toMatchObject({ status: "AUTH_LOSS", canSave: false });
  await call(authPage, "onLogin"); await flush();
  expect(auth.login).toHaveBeenCalledTimes(1);
});

test("all form handlers mutate real values, validate adjacent errors, and keep ANY exclusive", async () => {
  registerOpenGameSource(source());
  const page = loadPage(); call(page, "onLoad", { order_id: orderId }); await flush();
  call(page, "onTextInput", { currentTarget: { dataset: { field: "name" } }, detail: { value: "x" } });
  call(page, "onFieldBlur", { currentTarget: { dataset: { field: "name" } } });
  expect(page.data.fieldErrors.name).toBe("球局名称需为 2–30 个字符");
  call(page, "onTextInput", { currentTarget: { dataset: { field: "name" } }, detail: { value: "周末轻松局" } });
  call(page, "onPositionsChange", { detail: { value: ["ANY", "FORWARD"] } });
  expect(page.data.form.positions).toEqual(["FORWARD"]);
  call(page, "onPositionsChange", { detail: { value: ["ANY", "GOALKEEPER"] } });
  expect(page.data.form.positions).toEqual(["ANY"]);
  call(page, "onAaInput", { detail: { value: "18.88" } });
  call(page, "onIntensityChange", { detail: { value: "COMPETITIVE" } });
  call(page, "onVisibilityChange", { detail: { value: "LINK_ONLY" } });
  call(page, "onDeadlineDateChange", { detail: { value: "2099-08-29" } });
  call(page, "onDeadlineTimeChange", { detail: { value: "18:30" } });
  expect(page.data.fieldErrors.registrationDeadline).toBe("报名截止不得晚于开场前 2 小时");
  call(page, "onDeadlineTimeChange", { detail: { value: "17:30" } });
  expect(page.data.fieldErrors.registrationDeadline).toBeUndefined();
  call(page, "onNotesInput", { detail: { value: "提前 15 分钟" } });
  expect(page.data.form).toMatchObject({ aaYuan: "18.88", intensity: "COMPETITIVE", visibility: "LINK_ONLY", deadlineTime: "17:30", equipmentAndArrivalNotes: "提前 15 分钟" });
});

test("SAVE_ERROR keeps the visible form editable and retries with a corrected body", async () => {
  let writes = 0;
  const api = source({
    create: jest.fn(async () => {
      writes += 1;
      if (writes === 1) throw new OpenGameApiError("INVALID_ARGUMENT", [{ field: "team_name", message: "球队名称不可用" }]);
      return owner();
    }),
  });
  registerOpenGameSource(api);
  const page = loadPage(); call(page, "onLoad", { order_id: orderId }); await flush();
  page.data.form = { ...page.data.form, name: "周末轻松局", teamName: "旧球队", aaYuan: "30" };

  await call(page, "onSave");
  expect(page.data.status).toBe("SAVE_ERROR");
  call(page, "onTextInput", { currentTarget: { dataset: { field: "teamName" } }, detail: { value: "津门蓝队" } });
  call(page, "onStepper", { currentTarget: { dataset: { field: "totalPlayers", delta: 1 } } });
  expect(page.data.form).toMatchObject({ teamName: "津门蓝队", totalPlayers: 15 });

  await call(page, "onSave");
  expect(api.create).toHaveBeenCalledTimes(2);
  expect(page.data.status).toBe("SAVE_SUCCEEDED");
});

test("first-page return uses the order-detail order_id contract", async () => {
  registerOpenGameSource(source());
  (globalThis as any).getCurrentPages = jest.fn(() => [{ route: "pages/captain-game-form/index" }]);
  const page = loadPage(); call(page, "onLoad", { order_id: orderId }); await flush();

  call(page, "onReturnOrder");

  expect(wx.reLaunch).toHaveBeenCalledWith({ url: `/pages/order-detail/index?order_id=${orderId}` });
});

test("create serializes duplicate taps, persists one key, and navigates only from authority", async () => {
  let resolve!: (value: OpenGameOwner) => void;
  const createPromise = new Promise<OpenGameOwner>((yes) => { resolve = yes; });
  const api = source({ create: jest.fn(() => createPromise) });
  registerOpenGameSource(api);
  const page = loadPage(); call(page, "onLoad", { order_id: orderId }); await flush();
  page.data.form = { ...page.data.form, name: "周末轻松局", teamName: "津门蓝队", aaYuan: "30" };
  const first = call(page, "onSave");
  const duplicate = call(page, "onSave");
  expect(api.create).toHaveBeenCalledTimes(1);
  expect(page.data.status).toBe("SAVING");
  resolve(owner()); await first; await duplicate;
  expect(store.clear).toHaveBeenCalledTimes(1);
  expect(wx.redirectTo).toHaveBeenCalledWith(expect.objectContaining({ url: `/pages/captain-game-manage/index?game_id=${gameId}` }));
});

test("422 maps adjacent fields and unknown result confirms or replays the original attempt", async () => {
  const invalidApi = source({ create: jest.fn(async () => { throw new OpenGameApiError("INVALID_ARGUMENT", [{ field: "team_name", message: "球队名称不可用" }]); }) });
  registerOpenGameSource(invalidApi);
  const page = loadPage(); call(page, "onLoad", { order_id: orderId }); await flush();
  page.data.form = { ...page.data.form, name: "周末轻松局", teamName: "津门蓝队", aaYuan: "30" };
  await call(page, "onSave");
  expect(page.data).toMatchObject({ status: "SAVE_ERROR", fieldErrors: { teamName: "球队名称不可用" } });

  resetOpenGameSourceForTesting(); storedAttempt = null;
  let calls = 0;
  const unknownApi = source({
    create: jest.fn(async () => { calls += 1; if (calls === 1) throw new OpenGameApiError("OPEN_GAME_RESULT_UNKNOWN"); return owner(); }),
    getEntry: jest.fn(async (): Promise<OpenGameEntry> => ({ entry: "CREATE", order, gameId: null, blockedReason: null })),
  });
  registerOpenGameSource(unknownApi);
  const unknown = loadPage(); call(unknown, "onLoad", { order_id: orderId }); await flush();
  unknown.data.form = { ...unknown.data.form, name: "周末轻松局", teamName: "津门蓝队", aaYuan: "30" };
  await call(unknown, "onSave");
  const original = storedAttempt;
  if (!original) throw new Error("ATTEMPT_NOT_STORED");
  expect(unknown.data.status).toBe("SAVE_UNKNOWN");
  await call(unknown, "onConfirmSaveResult");
  expect(unknownApi.create).toHaveBeenNthCalledWith(2, original);
  expect(store.clear).toHaveBeenCalled();
});

test("foreign pending replaces save and navigation failure retains authoritative manager reopen", async () => {
  storedAttempt = {
    kind: "cancel", gameId: "00000000-0000-4000-8000-000000000299", expectedVersion: 4,
    idempotencyKey: "open-game-existing-0001",
  };
  const api = source({ getOwnedGame: jest.fn(async () => owner({ id: storedAttempt && "gameId" in storedAttempt ? storedAttempt.gameId : gameId, state: "CANCELLED", persistedStatus: "CANCELLED", version: 5, allowedActions: { canEdit: false, canPublish: false, canShare: false, canCancel: false, canPreview: false } })) });
  registerOpenGameSource(api);
  const page = loadPage(); call(page, "onLoad", { order_id: orderId }); await flush();
  page.data.form = { ...page.data.form, name: "周末轻松局", teamName: "津门蓝队", aaYuan: "30" };
  await call(page, "onSave");
  expect(page.data.status).toBe("FOREIGN_PENDING");
  await call(page, "onConfirmPreviousOperation");
  expect(store.clear).toHaveBeenCalled();

  resetOpenGameSourceForTesting(); storedAttempt = null;
  const authority = source(); registerOpenGameSource(authority);
  (wx.redirectTo as any).mockRejectedValueOnce(new Error("nav"));
  const successful = loadPage(); call(successful, "onLoad", { order_id: orderId }); await flush();
  successful.data.form = { ...successful.data.form, name: "周末轻松局", teamName: "津门蓝队", aaYuan: "30" };
  await call(successful, "onSave");
  expect(successful.data).toMatchObject({ status: "SAVE_SUCCEEDED", authoritativeGameId: gameId, navigationError: "球局已保存，请重新打开管理页。" });
  await call(successful, "onOpenManager");
  expect(wx.redirectTo).toHaveBeenLastCalledWith(expect.objectContaining({ url: `/pages/captain-game-manage/index?game_id=${gameId}` }));
});

test("foreign replay resolves its own write and returns to the current form", async () => {
  const foreignGameId = "00000000-0000-4000-8000-000000000299";
  storedAttempt = { kind: "cancel", gameId: foreignGameId, expectedVersion: 4, idempotencyKey: "open-game-existing-0003" };
  const foreignAttempt = storedAttempt;
  if (foreignAttempt.kind !== "cancel") throw new Error("CANCEL_ATTEMPT_REQUIRED");
  const api = source({
    getOwnedGame: jest.fn(async () => owner({
      id: foreignGameId,
      version: 4,
      allowedActions: { canEdit: true, canPublish: true, canShare: false, canCancel: true, canPreview: true },
    })),
    cancel: jest.fn(async () => owner({
      id: foreignGameId,
      state: "CANCELLED",
      persistedStatus: "CANCELLED",
      version: 5,
      allowedActions: { canEdit: false, canPublish: false, canShare: false, canCancel: false, canPreview: false },
    })),
  });
  registerOpenGameSource(api);
  const page = loadPage(); call(page, "onLoad", { order_id: orderId }); await flush();
  page.data.form = { ...page.data.form, name: "周末轻松局", teamName: "津门蓝队", aaYuan: "30" };

  await call(page, "onSave");
  expect(page.data.status).toBe("FOREIGN_PENDING");
  await call(page, "onConfirmPreviousOperation");

  expect(api.cancel).toHaveBeenCalledWith(foreignAttempt as Parameters<OpenGameSource["cancel"]>[0]);
  expect(page.data).toMatchObject({ status: "READY", mode: "create", orderId });
  expect(wx.redirectTo).not.toHaveBeenCalled();
});

test("foreign replay definitive recovery clears its attempt and reloads the current form authority", async () => {
  const foreignGameId = "00000000-0000-4000-8000-000000000299";
  storedAttempt = { kind: "cancel", gameId: foreignGameId, expectedVersion: 4, idempotencyKey: "open-game-existing-0004" };
  let ownerReads = 0;
  const api = source({
    getOwnedGame: jest.fn(async () => {
      ownerReads += 1;
      return ownerReads === 1
        ? owner({
          id: foreignGameId,
          version: 4,
          allowedActions: { canEdit: true, canPublish: true, canShare: false, canCancel: true, canPreview: true },
        })
        : owner({
          id: foreignGameId,
          state: "CANCELLED",
          persistedStatus: "CANCELLED",
          version: 5,
          allowedActions: { canEdit: false, canPublish: false, canShare: false, canCancel: false, canPreview: false },
        });
    }),
    cancel: jest.fn(async () => { throw new OpenGameApiError("OPEN_GAME_STATE_CHANGED"); }),
  });
  registerOpenGameSource(api);
  const page = loadPage(); call(page, "onLoad", { order_id: orderId }); await flush();
  page.data.form = { ...page.data.form, name: "当前订单球局", teamName: "当前球队", aaYuan: "30" };

  await call(page, "onSave");
  expect(page.data.status).toBe("FOREIGN_PENDING");
  await call(page, "onConfirmPreviousOperation");

  expect(store.clear).toHaveBeenCalledTimes(1);
  expect(api.getEntry).toHaveBeenCalledTimes(2);
  expect(page.data).toMatchObject({ status: "READY", mode: "create", orderId, authoritativeGameId: "" });
  expect(wx.redirectTo).not.toHaveBeenCalled();
});

test("definitive refreshed MANAGE authority opens its real manager", async () => {
  let entryReads = 0;
  const api = source({
    getEntry: jest.fn(async (): Promise<OpenGameEntry> => {
      entryReads += 1;
      return entryReads === 1
        ? { entry: "CREATE", order, gameId: null, blockedReason: null }
        : { entry: "MANAGE", order: null, gameId, blockedReason: null };
    }),
    create: jest.fn(async () => { throw new OpenGameApiError("ORDER_NOT_ELIGIBLE"); }),
  });
  registerOpenGameSource(api);
  const page = loadPage(); call(page, "onLoad", { order_id: orderId }); await flush();
  page.data.form = { ...page.data.form, name: "周末轻松局", teamName: "津门蓝队", aaYuan: "30" };

  await call(page, "onSave");

  expect(wx.redirectTo).toHaveBeenCalledWith(expect.objectContaining({ url: `/pages/captain-game-manage/index?game_id=${gameId}` }));
});

test("a definitive auth loss while confirming clears the attempt and removes mutation controls", async () => {
  let entryReads = 0;
  const api = source({
    getEntry: jest.fn(async (): Promise<OpenGameEntry> => {
      entryReads += 1;
      if (entryReads === 1) return { entry: "CREATE", order, gameId: null, blockedReason: null };
      throw new OpenGameApiError("AUTH_REQUIRED");
    }),
    create: jest.fn(async () => { throw new OpenGameApiError("OPEN_GAME_RESULT_UNKNOWN"); }),
  });
  registerOpenGameSource(api);
  const page = loadPage(); call(page, "onLoad", { order_id: orderId }); await flush();
  page.data.form = { ...page.data.form, name: "周末轻松局", teamName: "津门蓝队", aaYuan: "30" };
  await call(page, "onSave");

  await call(page, "onConfirmSaveResult");

  expect(page.data).toMatchObject({ status: "AUTH_LOSS", canSave: false });
  expect(store.clear).toHaveBeenCalled();
});

test("unload keeps a pending mutation durable and ignores its late response", async () => {
  let resolve!: (value: OpenGameOwner) => void;
  const pending = new Promise<OpenGameOwner>((yes) => { resolve = yes; });
  const api = source({ create: jest.fn(() => pending) }); registerOpenGameSource(api);
  const page = loadPage(); call(page, "onLoad", { order_id: orderId }); await flush();
  page.data.form = { ...page.data.form, name: "周末轻松局", teamName: "津门蓝队", aaYuan: "30" };
  const saving = call(page, "onSave");
  call(page, "onUnload");

  resolve(owner()); await saving;

  expect(store.clear).not.toHaveBeenCalled();
  expect(wx.redirectTo).not.toHaveBeenCalled();
  expect(storedAttempt).not.toBeNull();
});

test("unknown venue timezone fails closed without calling create", async () => {
  const api = source({ getEntry: jest.fn(async (): Promise<OpenGameEntry> => ({ entry: "CREATE", order: { ...order, timeZone: "America/New_York" }, gameId: null, blockedReason: null })) });
  registerOpenGameSource(api);
  const page = loadPage(); call(page, "onLoad", { order_id: orderId }); await flush();
  page.data.form = { ...page.data.form, name: "周末轻松局", teamName: "津门蓝队", aaYuan: "30" };
  await call(page, "onSave");
  expect(page.data.fieldErrors.registrationDeadline).toContain("暂不支持");
  expect(api.create).not.toHaveBeenCalled();
});
