/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */

import { beforeEach, expect, jest, test } from "@jest/globals";

interface Definition { data: Record<string, any>; onLoad(options?: { state?: unknown }): void; onPublish(): void; onConfirmPublish(): void; onPreview(): void; onEdit(): void; onShare(): void; onClosePanel(): void; onCancel(): void; onConfirmCancel(): void; onReturnOrder(): void; }
let captured: Definition | undefined;
const loadPage = () => {
  if (!captured) { (globalThis as any).Page = (definition: Definition) => { captured = definition; }; jest.requireActual("./index"); }
  return { ...captured!, data: { ...captured!.data }, setData(patch: Record<string, unknown>) { Object.assign(this.data, patch); } } as Definition & { setData(patch: Record<string, unknown>): void };
};

beforeEach(() => { (globalThis as any).wx = { navigateTo: jest.fn(), redirectTo: jest.fn(), navigateBack: jest.fn(), showShareMenu: jest.fn() }; });

test("draft publish requires confirmation before it becomes published", () => {
  const page = loadPage();
  page.onLoad({ state: "DRAFT" });
  page.onPublish();
  expect(page.data).toMatchObject({ visualState: "DRAFT", panel: "publish" });
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
  page.onReturnOrder();
  expect(wx.navigateBack).toHaveBeenCalledWith({ delta: 1 });
});
