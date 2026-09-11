/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { beforeEach, expect, jest, test } from "@jest/globals";
import { getOpenGameRegistrationSource, getOpenGameRegistrationAttemptStore } from "../../../services/open-game-registration";
import { getVenueProfileDataSource } from "../../../services/venue-profile";

let definition: any;
function page() {
  expect(existsSync("miniprogram/dev/pages/night-glow-production-preview/index.ts")).toBe(true);
  (globalThis as any).Page = (value: unknown) => { definition = value; };
  jest.requireActual("./index");
  return { ...definition, data: structuredClone(definition.data), setData(value: unknown) { Object.assign(this.data, value); } };
}
beforeEach(() => {
  (globalThis as any).wx = {
    redirectTo: jest.fn(), getStorageSync: jest.fn(), setStorageSync: jest.fn(), removeStorageSync: jest.fn(),
  };
});

test("opens the real member page with an isolated roster and attempt store", async () => {
  page().onLoad({ target: "MEMBERS" });
  expect(wx.redirectTo).toHaveBeenCalledWith({ url: "/pages/captain-game-members/index?game_id=00000000-0000-4000-8000-000000000501" });
  expect((await getOpenGameRegistrationSource().getMembers("00000000-0000-4000-8000-000000000501")).members).toHaveLength(2);
  expect(getOpenGameRegistrationAttemptStore().load()).toBeNull();
  expect(wx.getStorageSync).not.toHaveBeenCalled();
  expect(wx.setStorageSync).not.toHaveBeenCalled();
});

test("opens the real venue profile with local-only ready content", async () => {
  page().onLoad({ target: "VENUE_PROFILE" });
  expect(wx.redirectTo).toHaveBeenCalledWith({ url: "/pages/venue-profile/index?venue_id=00000000-0000-4000-8000-000000000010" });
  expect((await getVenueProfileDataSource().get("00000000-0000-4000-8000-000000000010")).currentRevision.images).toHaveLength(3);
  expect(wx.getStorageSync).not.toHaveBeenCalled();
});

test("keeps unknown targets on the explicitly labelled development menu", () => {
  const preview = page();
  preview.onLoad({ target: "https://example.invalid" });
  expect(wx.redirectTo).not.toHaveBeenCalled();
  expect(preview.data.title).toContain("开发预览");
  expect(preview.data.targets.length).toBeGreaterThan(10);
});

test("all menu destinations are registered production pages, never external routes", () => {
  const registered = JSON.parse(readFileSync("miniprogram/app.json", "utf8")).pages as string[];
  for (const target of page().data.targets) {
    expect(registered).toContain(target.url.slice(1).split("?")[0]);
  }
});

test("legacy link opens the existing application form without an existing registration", async () => {
  page().onLoad({ target: "LEGACY_APPLICATION" });
  expect(wx.redirectTo).toHaveBeenCalledWith({ url: expect.stringMatching(/^\/pages\/player-game-application\/index\?token=/) });
  const route = (wx.redirectTo as jest.Mock).mock.calls[0][0] as { url: string };
  const context = await getOpenGameRegistrationSource().getContext(route.url.split("token=")[1]);
  expect(context.viewerRegistration).toBeNull();
  expect(context.allowedActions.canApply).toBe(true);
});
