/// <reference types="node" />

import { beforeEach, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";

interface PageDefinition {
  data: {
    searchCenterName: string;
  };
  onLoad(): void;
  onOpenOrders(): void;
  [key: string]: unknown;
}

interface RuntimePage extends PageDefinition {
  setData(patch: Record<string, unknown>): void;
}

let capturedDefinition: PageDefinition | undefined;

function loadPage(): RuntimePage {
  if (!capturedDefinition) {
    (globalThis as unknown as { Page(value: PageDefinition): void }).Page = (value) => {
      capturedDefinition = value;
    };
    jest.requireActual("./index");
  }

  return {
    ...capturedDefinition!,
    data: { ...capturedDefinition!.data },
    setData(patch) { Object.assign(this.data, patch); },
  };
}

beforeEach(() => {
  (globalThis as unknown as { wx: unknown }).wx = {
    navigateTo: jest.fn(),
  };
});

test("renders the approved two-column context row and truncates the long left label", () => {
  const page = loadPage();
  const template = readFileSync("miniprogram/dev/pages/my-orders-map/index.wxml", "utf8");
  const styles = readFileSync("miniprogram/dev/pages/my-orders-map/index.wxss", "utf8");

  page.onLoad();

  expect(page.data.searchCenterName.length).toBeGreaterThan(20);
  expect(template).toMatch(/class="map-context-row"/);
  expect(template).toMatch(/class="map-center-value"/);
  expect(template).toMatch(/class="map-orders-action"/);
  expect(styles).toMatch(/\.map-context-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+248rpx/s);
  expect(styles).toMatch(/\.map-center-value\s*\{[^}]*overflow:\s*hidden[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/s);
});

test("opens the development order list through real native navigation", () => {
  const page = loadPage();

  page.onOpenOrders();

  expect(wx.navigateTo).toHaveBeenCalledWith({ url: "/dev/pages/my-orders/index?state=ready" });
});

test("binds every visible map-shell button to a page handler", () => {
  const page = loadPage();
  const template = readFileSync("miniprogram/dev/pages/my-orders-map/index.wxml", "utf8");
  const buttons = [...template.matchAll(/<button\b([^>]*)>/g)];

  expect(buttons.length).toBeGreaterThan(0);
  for (const [, attributes] of buttons) {
    const handler = attributes.match(/(?:bindtap|catchtap)="([^"]+)"/)?.[1];
    expect(handler).toBeDefined();
    expect(typeof page[handler!]).toBe("function");
  }
});
