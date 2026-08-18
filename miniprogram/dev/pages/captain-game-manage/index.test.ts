/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */

import { beforeEach, expect, jest, test } from "@jest/globals";
import { captainOpenGameStore } from "../../captain-open-game-fixture";

interface Definition { data: Record<string, any>; onLoad(options?: { state?: unknown }): void; onShow(): void; onPublish(): void; onConfirmPublish(): void; onPreview(): void; onEdit(): void; onShare(): void; onClosePanel(): void; onCancel(): void; onConfirmCancel(): void; onAbandon(): void; onConfirmAbandon(): void; onReload(): void; onReturnOrder(): void; onHeaderBack(): void; }
let captured: Definition | undefined;
const loadPage = () => {
  if (!captured) { (globalThis as any).Page = (definition: Definition) => { captured = definition; }; jest.requireActual("./index"); }
  return { ...captured!, data: { ...captured!.data }, setData(patch: Record<string, unknown>) { Object.assign(this.data, patch); } } as Definition & { setData(patch: Record<string, unknown>): void };
};

beforeEach(() => { captainOpenGameStore.reset("ELIGIBLE"); (globalThis as any).wx = { getWindowInfo: jest.fn(() => ({ windowWidth: 375, statusBarHeight: 44 })), getMenuButtonBoundingClientRect: jest.fn(() => ({ top: 48, left: 278, width: 87, height: 32 })), navigateTo: jest.fn(), redirectTo: jest.fn(), reLaunch: jest.fn(), navigateBack: jest.fn() }; (globalThis as any).getCurrentPages = jest.fn(() => [{}, {}]); });

test("draft publish requires confirmation before it becomes published", () => {
  const page = loadPage();
  page.onLoad({ state: "DRAFT" });
  page.onPublish();
  expect(page.data).toMatchObject({ visualState: "DRAFT", panel: "publish", headerRightInsetPx: 105, headerLeftInsetPx: 105 });
  page.onConfirmPublish();
  expect(page.data).toMatchObject({ visualState: "PUBLISHED", panel: null, published: true });
});

test("preview and edit have deterministic Fixture navigation", () => {
  const page = loadPage();
  page.onLoad({ state: "DRAFT" });
  page.onPreview();
  expect(wx.navigateTo).toHaveBeenCalledWith({ url: "/dev/pages/captain-game-public/index?from=DRAFT" });
  page.onEdit();
  expect(wx.navigateTo).toHaveBeenCalledWith({ url: "/dev/pages/captain-game-form/index?state=DRAFT" });
});

test("share failure is visible without changing published lifecycle", () => {
  const page = loadPage();
  page.onLoad({ state: "PUBLISHED" });
  page.onShare();
  expect(page.data).toMatchObject({ visualState: "PUBLISHED", shareError: "暂时无法分享" });
});

test("cancellation requires confirmation and leaves the booking unchanged", () => {
  const page = loadPage();
  page.onLoad({ state: "PUBLISHED" });
  page.onCancel();
  expect(page.data.panel).toBe("cancel");
  page.onConfirmCancel();
  expect(page.data).toMatchObject({ visualState: "CANCELLED", panel: null, bookingChanged: false });
  expect(wx.reLaunch).toHaveBeenCalledWith({ url: "/dev/pages/captain-game-manage/index?state=CANCELLED" });
  page.onReturnOrder();
  expect(wx.navigateBack).toHaveBeenCalledWith({ delta: 1 });
});

test("abandoning a draft is confirmed, while closing its confirmation preserves the draft", () => {
  const page = loadPage();
  page.onLoad({ state: "DRAFT" });
  page.onAbandon();
  expect(page.data).toMatchObject({ visualState: "DRAFT", panel: "abandon" });
  page.onClosePanel();
  expect(page.data).toMatchObject({ visualState: "DRAFT", panel: null, private: true });
  page.onAbandon();
  page.onConfirmAbandon();
  expect(wx.redirectTo).toHaveBeenCalledWith({ url: "/dev/pages/captain-game-form/index?state=ELIGIBLE" });
});

test("an old manager page corrects itself from the authoritative cancelled Fixture on show", () => {
  const page = loadPage();
  page.onLoad({ state: "PUBLISHED" });
  captainOpenGameStore.reset("CANCELLED");
  page.onShow();
  expect(page.data.visualState).toBe("CANCELLED");
});

test("onShow refreshes a same-lifecycle manager from the current Fixture snapshot", () => {
  const page = loadPage();
  page.onLoad({ state: "PUBLISHED" });
  captainOpenGameStore.saveDraft({ ...captainOpenGameStore.current().snapshot, name: "同生命周期刷新", total: 16, open: 5 });
  page.onShow();
  expect(page.data).toMatchObject({ visualState: "PUBLISHED", snapshot: { name: "同生命周期刷新", total: 16, open: 5 } });
});

test("existing lifecycle wins over a stale manager query, and suspended exposes only truthful actions", () => {
  captainOpenGameStore.reset("PUBLISHED");
  const page = loadPage();
  page.onLoad({ state: "DRAFT" });
  expect(page.data.visualState).toBe("PUBLISHED");
  captainOpenGameStore.reset("ELIGIBLE");
  page.onLoad({ state: "SUSPENDED" });
  expect(page.data).toMatchObject({ visualState: "SUSPENDED", canEdit: false, message: "订单状态变化，球局已暂停招募" });
  page.onCancel();
  expect(page.data.panel).toBe("cancel");
});

test("load error offers a real local reload transition", () => {
  const page = loadPage();
  page.onLoad({ state: "LOAD_ERROR" });
  expect(page.data).toMatchObject({ visualState: "LOAD_ERROR", recoveryAction: "重新加载" });
  page.onReload();
  expect(page.data).toMatchObject({ visualState: "DRAFT", private: true });
});
