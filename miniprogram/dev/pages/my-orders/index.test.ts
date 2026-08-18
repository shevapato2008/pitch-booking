/// <reference types="node" />

import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";

interface PreviewOrder {
  readonly orderId: string;
  readonly route: string;
  readonly status: string;
}

interface PageDefinition {
  data: {
    previewState: string;
    orders: readonly PreviewOrder[];
  };
  onLoad(options?: { state?: unknown }): void;
  onOpenOrder(event: { currentTarget?: { dataset?: { orderId?: unknown } } }): void;
  onGoSelectVenue(): void;
  onRetry(): void;
  onPullDownRefresh(): void;
  onLoadMore(): void;
  onRetryLoadMore(): void;
  onUnload(): void;
  [key: string]: unknown;
}

interface RuntimePage extends PageDefinition {
  setData(patch: Record<string, unknown>): void;
}

interface NavigationBackOptions {
  readonly delta: number;
  readonly fail: () => void;
}

let capturedDefinition: PageDefinition | undefined;

function loadPage(state: string): RuntimePage {
  if (!capturedDefinition) {
    (globalThis as unknown as { Page(value: PageDefinition): void }).Page = (value) => {
      capturedDefinition = value;
    };
    jest.requireActual("./index");
  }

  const page: RuntimePage = {
    ...capturedDefinition!,
    data: { ...capturedDefinition!.data, orders: [...capturedDefinition!.data.orders] },
    setData(patch) { Object.assign(this.data, patch); },
  };
  page.onLoad({ state });
  return page;
}

beforeEach(() => {
  jest.useFakeTimers();
  (globalThis as unknown as { wx: unknown }).wx = {
    navigateTo: jest.fn(),
    navigateBack: jest.fn(),
    reLaunch: jest.fn(),
    stopPullDownRefresh: jest.fn(),
  };
});

afterEach(() => {
  jest.useRealTimers();
});

test("ready cards navigate to their matching existing order detail routes", () => {
  const page = loadPage("ready");

  for (const order of page.data.orders) {
    page.onOpenOrder({ currentTarget: { dataset: { orderId: order.orderId } } });
  }

  expect(wx.navigateTo).toHaveBeenCalledTimes(page.data.orders.length);
  expect((wx.navigateTo as jest.Mock).mock.calls.map(([options]) => options)).toEqual(
    page.data.orders.map(({ route }) => ({ url: route })),
  );
});

test("empty exit navigates back and relaunches the venue map only when back fails", () => {
  const page = loadPage("empty");

  page.onGoSelectVenue();

  expect(wx.navigateBack).toHaveBeenCalledTimes(1);
  expect(wx.reLaunch).not.toHaveBeenCalled();
  const options = (wx.navigateBack as jest.Mock).mock.calls[0][0] as NavigationBackOptions;
  expect(options.delta).toBe(1);
  options.fail();
  expect(wx.reLaunch).toHaveBeenCalledWith({ url: "/pages/venue-map/index" });
});

test("retry and refresh replace immutable central Fixture states", () => {
  const fixture = jest.requireActual("../../my-orders-fixture") as {
    MY_ORDERS_PREVIEW_STATES: Record<string, unknown>;
  };
  const fixtureBytes = JSON.stringify(fixture.MY_ORDERS_PREVIEW_STATES);
  const errorPage = loadPage("error");

  errorPage.onRetry();
  expect(errorPage.data.previewState).toBe("loading");
  jest.runOnlyPendingTimers();
  expect(errorPage.data.previewState).toBe("ready");

  errorPage.onPullDownRefresh();
  expect(errorPage.data.previewState).toBe("refreshing");
  jest.runOnlyPendingTimers();
  expect(errorPage.data.previewState).toBe("ready-refreshed");
  expect(wx.stopPullDownRefresh).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(fixture.MY_ORDERS_PREVIEW_STATES)).toBe(fixtureBytes);
  expect(Object.isFrozen(fixture.MY_ORDERS_PREVIEW_STATES)).toBe(true);
  errorPage.onUnload();
});

test("load more failure and retry retain orders before appending the immutable next page", () => {
  const page = loadPage("ready");
  const initialOrders = page.data.orders;

  page.onLoadMore();
  expect(page.data.previewState).toBe("loading-more");
  expect(page.data.orders).toEqual(initialOrders);
  expect(page.data.orders).not.toBe(initialOrders);
  jest.runOnlyPendingTimers();
  expect(page.data.previewState).toBe("load-more-error");
  expect(page.data.orders).toEqual(initialOrders);

  page.onRetryLoadMore();
  expect(page.data.previewState).toBe("loading-more");
  jest.runOnlyPendingTimers();
  expect(page.data.previewState).toBe("end");
  expect(page.data.orders.length).toBeGreaterThan(initialOrders.length);
  page.onUnload();
});

test("closing projection visually outranks simultaneous payment confirmation", () => {
  const fixture = jest.requireActual("../../my-orders-fixture") as {
    MY_ORDERS_RAW_FIXTURE: ReadonlyArray<{ closingPayment: boolean; paymentConfirming: boolean }>;
    projectMyOrdersFixtureOrder(order: unknown): PreviewOrder;
  };
  const ambiguous = fixture.MY_ORDERS_RAW_FIXTURE.find(
    ({ closingPayment, paymentConfirming }) => closingPayment && paymentConfirming,
  );

  expect(ambiguous).toBeDefined();
  expect(fixture.projectMyOrdersFixtureOrder(ambiguous).status).toBe("closing");
});

test("binds every visible list action to a real page handler", () => {
  const page = loadPage("ready");
  const template = readFileSync("miniprogram/dev/pages/my-orders/index.wxml", "utf8");
  const buttons = [...template.matchAll(/<button\b([^>]*)>/g)];

  expect(buttons.length).toBeGreaterThan(0);
  for (const [, attributes] of buttons) {
    const handler = attributes.match(/(?:bindtap|catchtap)="([^"]+)"/)?.[1];
    expect(handler).toBeDefined();
    expect(typeof page[handler!]).toBe("function");
  }
  page.onUnload();
});
