/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any -- dynamic Mini Program Page harness */

import { beforeEach, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";

import type { ManagedVenue } from "../../domain/venue-access";
import { registerVenueAccessDataSource, resetVenueAccessBindingsForTesting, type VenueAccessDataSource } from "../../services/venue-access";

type RuntimePage = Record<string, any> & { data: Record<string, any>; setData(patch: Record<string, unknown>): void };
let definition: Record<string, any> | undefined;
const first: ManagedVenue = { id: "00000000-0000-4000-8000-000000000010", name: "渤海元丰足球场", districtName: "西青区", address: "天津市西青区利达路" };
const second: ManagedVenue = { id: "00000000-0000-4000-8000-000000000020", name: "天津奥体足球公园", districtName: "南开区", address: "天津市南开区凌宾路 1 号" };

function source(venues: readonly ManagedVenue[] = []): VenueAccessDataSource {
  return { login: jest.fn(async () => undefined), listManagedVenues: jest.fn(async () => venues) };
}

function page(): RuntimePage {
  if (!definition) {
    (globalThis as any).Page = (value: Record<string, any>) => { definition = value; };
    jest.requireActual("./index");
  }
  return { ...definition, data: structuredClone(definition!.data), disposed: false, loading: false, redirected: false, setData(patch) { Object.assign(this.data, patch); } } as RuntimePage;
}

beforeEach(() => {
  resetVenueAccessBindingsForTesting();
  (globalThis as any).wx = {
    getWindowInfo: jest.fn(() => ({ windowWidth: 393, statusBarHeight: 59 })),
    getMenuButtonBoundingClientRect: jest.fn(() => ({ top: 63, left: 295, height: 32 })),
    redirectTo: jest.fn(), navigateTo: jest.fn(), reLaunch: jest.fn(),
  };
});

test("zero venues still renders both real onboarding actions and returns to the entry", async () => {
  const api = source(); registerVenueAccessDataSource(api); const target = page();
  await target.onLoad();
  expect(api.login).toHaveBeenCalledTimes(1); expect(api.listManagedVenues).toHaveBeenCalledTimes(1);
  expect(target.data).toMatchObject({ mode: "empty", venues: [] });
  expect(wx.redirectTo).not.toHaveBeenCalled();
  target.onBackToEntry();
  expect(wx.reLaunch).toHaveBeenCalledWith({ url: "/pages/intent-entry/index" });
  const markup = readFileSync("miniprogram/pages/venue-access/index.wxml", "utf8");
  expect(markup).toContain("认领已有场馆");
  expect(markup).toContain("创建新场馆");
  expect(markup).not.toMatch(/自动授权|自助认证|申请成功/);
});

test("one venue remains in the stable portfolio and can be chosen explicitly", async () => {
  registerVenueAccessDataSource(source([first])); const target = page();
  await target.onLoad();
  expect(target.data).toMatchObject({ title: "我的场馆", mode: "ready", venues: [first] });
  expect(wx.redirectTo).not.toHaveBeenCalled();
  target.onChooseVenue({ currentTarget: { dataset: { venueId: first.id } } });
  expect(wx.redirectTo).toHaveBeenCalledTimes(1);
  expect(wx.redirectTo).toHaveBeenCalledWith(expect.objectContaining({ url: `/pages/venue-profile/index?venue_id=${encodeURIComponent(first.id)}` }));
});

test("multiple venues stay selectable and reject unknown ids", async () => {
  registerVenueAccessDataSource(source([first, second])); const target = page();
  await target.onLoad();
  expect(target.data).toMatchObject({ title: "我的场馆", mode: "ready", venues: [first, second] });
  expect(wx.redirectTo).not.toHaveBeenCalled();
  target.onChooseVenue({ currentTarget: { dataset: { venueId: "unknown" } } });
  expect(wx.redirectTo).not.toHaveBeenCalled();
  target.onChooseVenue({ currentTarget: { dataset: { venueId: second.id } } });
  target.onChooseVenue({ currentTarget: { dataset: { venueId: second.id } } });
  expect(wx.redirectTo).toHaveBeenCalledTimes(1);
  expect(wx.redirectTo).toHaveBeenCalledWith(expect.objectContaining({ url: `/pages/venue-profile/index?venue_id=${encodeURIComponent(second.id)}` }));
});

test("claim and create CTAs open their production routes", async () => {
  registerVenueAccessDataSource(source([first])); const target = page(); await target.onLoad();
  target.onOpenClaim(); target.onOpenCreate();
  expect(wx.navigateTo).toHaveBeenNthCalledWith(1, { url: "/pages/venue-claim/index" });
  expect(wx.navigateTo).toHaveBeenNthCalledWith(2, { url: "/pages/venue-create/index" });
});

test("only a rejected application opens its fresh retry journey", () => {
  registerVenueAccessDataSource(source()); const target = page();
  target.onOpenApplication({ currentTarget: { dataset: { applicationId: "51479910-178f-43ba-941a-93c1aa8247f8", kind: "CREATE", status: "SUBMITTED" } } });
  expect(wx.navigateTo).not.toHaveBeenCalled();
  target.onOpenApplication({ currentTarget: { dataset: { applicationId: "51479910-178f-43ba-941a-93c1aa8247f8", kind: "CREATE", status: "REJECTED" } } });
  expect(wx.navigateTo).toHaveBeenCalledWith({ url: "/pages/venue-create/index?application_id=51479910-178f-43ba-941a-93c1aa8247f8" });
});

test("a failed read remains distinct from empty and retries into the loaded state", async () => {
  const api = source([first, second]);
  (api.listManagedVenues as jest.MockedFunction<VenueAccessDataSource["listManagedVenues"]>)
    .mockRejectedValueOnce(new Error("network"));
  registerVenueAccessDataSource(api); const target = page();
  await target.onLoad();
  expect(target.data).toMatchObject({ mode: "error", errorMessage: "场馆权限暂时无法读取，请重试" });
  const retry = target.onRetry(); expect(target.data.retrying).toBe(true); await retry;
  expect(target.data).toMatchObject({ mode: "ready", retrying: false, venues: [first, second] });
});

test("production page has no fixture or query-case dependency", () => {
  const sourceText = readFileSync("miniprogram/pages/venue-access/index.ts", "utf8");
  expect(sourceText).not.toMatch(/\/dev\/|fixture|previewCase|case=multiple|case=empty/i);
});
