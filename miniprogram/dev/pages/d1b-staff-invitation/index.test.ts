/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */

import { beforeEach, expect, jest, test } from "@jest/globals";

let captured: any;

function page() {
  if (!captured) {
    (globalThis as any).Page = (definition: any) => { captured = definition; };
    jest.requireActual("./index");
  }
  return { ...captured, data: structuredClone(captured.data), setData(patch: any) { Object.assign(this.data, patch); } };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.restoreAllMocks();
  (globalThis as any).wx = {
    getWindowInfo: jest.fn(() => ({ windowWidth: 411, statusBarHeight: 28 })),
    getMenuButtonBoundingClientRect: jest.fn(() => ({ top: 32, bottom: 64, left: 313, right: 399, width: 86, height: 32 })),
    hideShareMenu: jest.fn(),
    showLoading: jest.fn(),
    hideLoading: jest.fn(),
    reLaunch: jest.fn(),
    navigateBack: jest.fn(),
  };
  (globalThis as any).getCurrentPages = jest.fn(() => [{}]);
});

test("available invitation accepts once and opens the real venue portfolio", () => {
  const view = page();
  view.onLoad({ state: "invitation" });
  expect(view.data.view.actionKind).toBe("accept");
  view.onAcceptInvitation();
  expect(view.data.busy).toBe(true);
  jest.advanceTimersByTime(260);
  expect(view.data.view.actionKind).toBe("portfolio");
  view.onPrimaryAction();
  expect(wx.reLaunch).toHaveBeenCalledWith({ url: "/pages/venue-access/index" });
});

test("unavailable invitation has an explicit retry recovery", () => {
  const view = page();
  view.onLoad({ state: "unavailable" });
  view.onPrimaryAction();
  expect(view.data.view.actionKind).toBe("accept");
});

