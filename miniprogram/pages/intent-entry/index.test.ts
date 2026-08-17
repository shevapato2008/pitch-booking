/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any -- dynamic Mini Program Page harness */

import { beforeEach, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";

type RuntimePage = Record<string, any> & { data: Record<string, any>; setData(patch: Record<string, unknown>): void };
let definition: Record<string, any> | undefined;

function page(): RuntimePage {
  if (!definition) {
    (globalThis as any).Page = (value: Record<string, any>) => { definition = value; };
    jest.requireActual("./index");
  }
  return { ...definition, data: structuredClone(definition!.data), setData(patch) { Object.assign(this.data, patch); } } as RuntimePage;
}

beforeEach(() => {
  (globalThis as any).wx = {
    getWindowInfo: jest.fn(() => ({ windowWidth: 393, statusBarHeight: 59 })),
    getMenuButtonBoundingClientRect: jest.fn(() => ({ top: 63, left: 295, height: 32 })),
    reLaunch: jest.fn(), navigateTo: jest.fn(),
  };
});

test("BOOK and HOST enter their real production journeys", () => {
  const booking = page();
  booking.onChooseIntent({ currentTarget: { dataset: { intentId: "BOOK" } } });
  booking.onChooseIntent({ currentTarget: { dataset: { intentId: "BOOK" } } });
  expect(wx.reLaunch).toHaveBeenCalledTimes(1);
  expect(wx.reLaunch).toHaveBeenCalledWith(expect.objectContaining({ url: "/pages/venue-map/index" }));
  const hosting = page();
  hosting.onChooseIntent({ currentTarget: { dataset: { intentId: "HOST" } } });
  hosting.onChooseIntent({ currentTarget: { dataset: { intentId: "HOST" } } });
  expect(wx.navigateTo).toHaveBeenCalledTimes(1);
  expect(wx.navigateTo).toHaveBeenCalledWith(expect.objectContaining({ url: "/pages/venue-access/index" }));
  hosting.onShow();
  hosting.onChooseIntent({ currentTarget: { dataset: { intentId: "HOST" } } });
  expect(wx.navigateTo).toHaveBeenCalledTimes(2);
});

test("PLAY remains visible and natively disabled without a navigation escape hatch", () => {
  const target = page();
  target.onChooseIntent({ currentTarget: { dataset: { intentId: "PLAY" } } });
  expect(wx.reLaunch).not.toHaveBeenCalled();
  expect(wx.navigateTo).not.toHaveBeenCalled();
  const markup = readFileSync("miniprogram/pages/intent-entry/index.wxml", "utf8");
  expect(markup).toContain("即将开放");
  expect(markup).toContain('disabled="{{item.disabled}}"');
});

test("invalid intents are inert and production source has no development dependency", () => {
  const target = page();
  target.onChooseIntent({ currentTarget: { dataset: { intentId: "ADMIN" } } });
  expect(wx.reLaunch).not.toHaveBeenCalled();
  expect(wx.navigateTo).not.toHaveBeenCalled();
  const source = readFileSync("miniprogram/pages/intent-entry/index.ts", "utf8");
  expect(source).not.toMatch(/\/dev\/|DEV_|fixture/i);
});

test("HOST explains both application and authorized workbench paths", () => {
  const hosting = page();
  expect(hosting.data.intents.find(({ id }: { id: string }) => id === "HOST").subtitle)
    .toBe("申请合作，或进入已授权的场馆工作台");
});

test("retains the confirmed capsule-safe city interaction", () => {
  const target = page();
  target.onLoad({ cityPicker: "open" });
  expect(target.data).toMatchObject({ headerTopPx: 59, headerRowHeightPx: 44, headerRightInsetPx: 106, isCityPickerOpen: true });
  target.onSelectCurrentCity();
  expect(target.data.isCityPickerOpen).toBe(false);
});
