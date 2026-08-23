/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */

import { beforeEach, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";

import type { OpenGameOwner, OpenGamePublic } from "../../domain/open-game";
import { OpenGameApiError } from "../../services/http-open-game";
import { registerOpenGameSource, resetOpenGameSourceForTesting, type OpenGameSource } from "../../services/open-game";

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
  return { ...captured!, data: structuredClone(captured!.data), setData(patch: Record<string, unknown>) { Object.assign(this.data, patch); }, loadGeneration: 0, visible: true } as RuntimePage;
}

const gameId = "00000000-0000-4000-8000-000000000401";
const token = "abcdefghijklmnopqrstuvwxyzABCDEF";
function publicGame(state: OpenGamePublic["state"] = "PUBLISHED"): OpenGamePublic {
  return {
    name: "周末轻松局", teamName: "津门蓝队", state,
    stateReason: state === "SUSPENDED" ? "BOOKING_UNAVAILABLE" : state === "CANCELLED" ? "CAPTAIN_CANCELLED" : state === "COMPLETED" ? "BOOKING_COMPLETED" : null,
    venueName: "天津奥体足球场", pitchName: "七人制 A 场", pitchSpecification: "7人制",
    startsAt: "2099-08-29T20:00:00+08:00", endsAt: "2099-08-29T22:00:00+08:00", timeZone: "Asia/Shanghai",
    totalPlayers: 14, fixedPlayers: 8, openSpots: 4, intensity: "CASUAL", minimumExperience: "会传接球即可",
    positions: ["GOALKEEPER", "DEFENDER"], aaCents: 3000, registrationDeadline: "2099-08-29T18:00:00+08:00",
    equipmentAndArrivalNotes: "深浅球衣，提前 15 分钟到场", visibility: "PUBLIC",
  };
}
function owner(): OpenGameOwner {
  const game = publicGame();
  return {
    id: gameId, orderId: "00000000-0000-4000-8000-000000000402",
    order: { venueName: game.venueName, pitchName: game.pitchName, pitchSpecification: game.pitchSpecification, playersPerSide: 7, bookingPriceCents: 42000, startsAt: game.startsAt, endsAt: game.endsAt, timeZone: game.timeZone },
    name: game.name, team: { id: "00000000-0000-4000-8000-000000000403", name: game.teamName },
    totalPlayers: game.totalPlayers, fixedPlayers: game.fixedPlayers, openSpots: game.openSpots, intensity: game.intensity,
    minimumExperience: game.minimumExperience, positions: game.positions, aaCents: game.aaCents, registrationDeadline: game.registrationDeadline,
    equipmentAndArrivalNotes: game.equipmentAndArrivalNotes, visibility: game.visibility, persistedStatus: "DRAFT", state: "DRAFT", stateReason: null, version: 1,
    allowedActions: { canEdit: true, canPublish: true, canShare: false, canCancel: true, canPreview: true }, share: null, publicView: { ...game, state: "DRAFT" },
  };
}
function source(overrides: Partial<OpenGameSource> = {}): OpenGameSource {
  return {
    login: jest.fn(async () => undefined), getEntry: jest.fn(), getOwnedGame: jest.fn(async () => owner()), getSharedGame: jest.fn(async () => publicGame()),
    create: jest.fn(), update: jest.fn(), publish: jest.fn(), cancel: jest.fn(), ...overrides,
  } as OpenGameSource;
}

beforeEach(() => {
  resetOpenGameSourceForTesting();
  (globalThis as any).wx = {
    getWindowInfo: jest.fn(() => ({ windowWidth: 375, statusBarHeight: 44 })),
    getMenuButtonBoundingClientRect: jest.fn(() => ({ top: 48, left: 278, width: 87, height: 32 })),
    hideShareMenu: jest.fn(async () => undefined), navigateBack: jest.fn(async () => undefined), redirectTo: jest.fn(async () => undefined), reLaunch: jest.fn(async () => undefined),
  };
  (globalThis as any).getCurrentPages = jest.fn(() => [{ route: "pages/intent-entry/index" }, { route: "pages/captain-game-public/index" }]);
});

test("strict shared route loads only public authority and never owner/login", async () => {
  const api = source(); registerOpenGameSource(api);
  const page = loadPage(); call(page, "onLoad", { token }); expect(page.data.status).toBe("LOADING"); await flush();
  expect(page.data).toMatchObject({ status: "READY", mode: "shared", state: "PUBLISHED", showReturnManage: false });
  expect(api.getSharedGame).toHaveBeenCalledWith(token); expect(api.getOwnedGame).not.toHaveBeenCalled(); expect(api.login).not.toHaveBeenCalled(); expect(wx.hideShareMenu).toHaveBeenCalled();
});

test("strict owner preview loads only nested publicView and exposes real manager return", async () => {
  const api = source(); registerOpenGameSource(api);
  const page = loadPage(); call(page, "onLoad", { game_id: gameId, preview: "1" }); await flush();
  expect(page.data).toMatchObject({ status: "READY", mode: "owner", showReturnManage: true, name: "周末轻松局" });
  expect(api.getOwnedGame).toHaveBeenCalledWith(gameId); expect(api.getSharedGame).not.toHaveBeenCalled();
  expect(Object.keys(page.data.publicGame).sort()).toEqual([
    "aaCents", "endsAt", "equipmentAndArrivalNotes", "fixedPlayers", "intensity", "minimumExperience", "name", "openSpots", "pitchName", "pitchSpecification", "positions", "registrationDeadline", "startsAt", "state", "stateReason", "teamName", "timeZone", "totalPlayers", "venueName", "visibility",
  ].sort());
});

test("mixed, missing and malformed route combinations fail closed without source calls", () => {
  const api = source(); registerOpenGameSource(api);
  for (const options of [{}, { token: "short" }, { game_id: gameId }, { game_id: gameId, preview: "0" }, { token, game_id: gameId, preview: "1" }]) {
    const page = loadPage(); call(page, "onLoad", options); expect(page.data).toMatchObject({ status: "NOT_FOUND", showReturnManage: false });
  }
  expect(api.getSharedGame).not.toHaveBeenCalled(); expect(api.getOwnedGame).not.toHaveBeenCalled(); expect(api.login).not.toHaveBeenCalled();
});

test("unknown shared token is not-found; transient shared error retries without login", async () => {
  const unknown = source({ getSharedGame: jest.fn(async () => { throw new OpenGameApiError("OPEN_GAME_NOT_FOUND"); }) }); registerOpenGameSource(unknown);
  const missing = loadPage(); call(missing, "onLoad", { token }); await flush(); expect(missing.data.status).toBe("NOT_FOUND"); expect(missing.data.showLogin).toBe(false);

  let calls = 0; resetOpenGameSourceForTesting(); const flaky = source({ getSharedGame: jest.fn(async () => { calls += 1; if (calls === 1) throw new OpenGameApiError("SERVICE_UNAVAILABLE"); return publicGame("SUSPENDED"); }) }); registerOpenGameSource(flaky);
  const page = loadPage(); call(page, "onLoad", { token }); await flush(); expect(page.data.status).toBe("LOAD_ERROR"); call(page, "onRetry"); await flush(); expect(page.data).toMatchObject({ status: "READY", state: "SUSPENDED" }); expect(flaky.login).not.toHaveBeenCalled();
});

test("owner auth loss offers real login, while shared visitors never see login", async () => {
  let authenticated = false;
  const api = source({ getOwnedGame: jest.fn(async () => { if (!authenticated) throw new OpenGameApiError("AUTH_REQUIRED"); return owner(); }), login: jest.fn(async () => { authenticated = true; }) }); registerOpenGameSource(api);
  const page = loadPage(); call(page, "onLoad", { game_id: gameId, preview: "1" }); await flush(); expect(page.data).toMatchObject({ status: "AUTH_LOSS", showLogin: true }); await call(page, "onLogin"); await flush(); expect(page.data.status).toBe("READY");
});

test.each(["PUBLISHED", "SUSPENDED", "CANCELLED", "COMPLETED"] as const)("renders shared %s honestly", async (state) => {
  registerOpenGameSource(source({ getSharedGame: jest.fn(async () => publicGame(state)) }));
  const page = loadPage(); call(page, "onLoad", { token }); await flush(); expect(page.data).toMatchObject({ status: "READY", state });
  if (state === "SUSPENDED" || state === "CANCELLED" || state === "COMPLETED") expect(page.data.stateReasonText.length).toBeGreaterThan(0);
});

test("public markup is read-only, contains the frozen settlement note, and has no private or application controls", () => {
  const wxml = readFileSync("miniprogram/pages/captain-game-public/index.wxml", "utf8");
  expect(wxml).toContain("当前仅供查看，申请加入即将开放"); expect(wxml).toContain("到场线下结算，平台不代收或担保");
  expect(wxml).not.toMatch(/bindtap="onApply|open-type="share"|phone|orderId|payment|refund|contact/i);
  expect(wxml).toContain("onHeaderBack"); expect(wxml).toContain("onReturnManage"); expect(wxml).toContain("onRetry"); expect(wxml).toContain("onLogin");
});

test("shared back and owner return follow their distinct first-page fallbacks", async () => {
  registerOpenGameSource(source());
  const shared = loadPage(); call(shared, "onLoad", { token }); await flush(); call(shared, "onHeaderBack"); expect(wx.navigateBack).toHaveBeenCalledWith({ delta: 1 });
  (globalThis as any).getCurrentPages = jest.fn(() => [{ route: "pages/captain-game-public/index" }]);
  const firstShared = loadPage(); call(firstShared, "onLoad", { token }); await flush(); call(firstShared, "onHeaderBack"); expect(wx.reLaunch).toHaveBeenCalledWith({ url: "/pages/intent-entry/index" });

  const preview = loadPage(); call(preview, "onLoad", { game_id: gameId, preview: "1" }); await flush(); await call(preview, "onReturnManage");
  expect(wx.redirectTo).toHaveBeenCalledWith(expect.objectContaining({ url: `/pages/captain-game-manage/index?game_id=${gameId}` }));
});

test("hide-show replaces a pending public read and ignores its stale response", async () => {
  let resolveFirst!: (value: OpenGamePublic) => void;
  const first = new Promise<OpenGamePublic>((yes) => { resolveFirst = yes; });
  let reads = 0;
  const api = source({
    getSharedGame: jest.fn(() => {
      reads += 1;
      return reads === 1 ? first : Promise.resolve(publicGame("SUSPENDED"));
    }),
  });
  registerOpenGameSource(api);
  const page = loadPage(); call(page, "onLoad", { token });
  expect(typeof page.onShow).toBe("function");
  call(page, "onShow");
  call(page, "onHide"); call(page, "onShow"); await flush();
  resolveFirst(publicGame("PUBLISHED")); await flush();

  expect(api.getSharedGame).toHaveBeenCalledTimes(2);
  expect(page.data).toMatchObject({ status: "READY", state: "SUSPENDED" });
});
