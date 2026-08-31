/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */

import { beforeEach, expect, jest, test } from "@jest/globals";

interface InvitationPage {
  data: Record<string, any>;
  onLoad(options?: { state?: string }): void;
  onAcceptInvitation(): void;
  onContinueClaim(): void;
  onOpenApplications(): void;
  onRetry(): void;
  onPrimaryAction(): void;
  onHeaderBack(): void;
  setPreviewState(state: "ready" | "claimed" | "submitted" | "unavailable"): void;
}

let captured: InvitationPage | undefined;

function loadPage(): InvitationPage & { setData(patch: Record<string, unknown>): void } {
  if (!captured) {
    (globalThis as any).Page = (definition: InvitationPage) => { captured = definition; };
    jest.requireActual("./index");
  }
  return {
    ...captured!,
    data: { ...captured!.data },
    setData(patch: Record<string, unknown>) { Object.assign(this.data, patch); },
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.restoreAllMocks();
  (globalThis as any).wx = {
    getWindowInfo: jest.fn(() => ({ windowWidth: 390, statusBarHeight: 44 })),
    getMenuButtonBoundingClientRect: jest.fn(() => ({ top: 48, bottom: 80, left: 292, right: 378, width: 86, height: 32 })),
    hideShareMenu: jest.fn(),
    showLoading: jest.fn(),
    hideLoading: jest.fn(),
    navigateTo: jest.fn(),
    navigateBack: jest.fn(),
    reLaunch: jest.fn(),
  };
  (globalThis as any).getCurrentPages = jest.fn(() => [{}]);
});

test("accept binds the preview to the current account without claiming authority", () => {
  const page = loadPage();
  page.onLoad({ state: "ready" });
  expect(page.data.view.actionKind).toBe("accept");
  expect(page.data.headerTopPx).toBe(44);

  page.onPrimaryAction();
  expect(wx.showLoading).toHaveBeenCalledWith({ title: "正在接受", mask: true });
  expect(page.data.busy).toBe(true);
  jest.advanceTimersByTime(260);
  expect(wx.hideLoading).toHaveBeenCalledTimes(1);
  expect(page.data.view.actionKind).toBe("claim");
  expect(page.data.view.description).toContain("平台人工审核");
  expect(page.data.busy).toBe(false);
});

test("claimed, submitted and unavailable actions each have a concrete recovery", () => {
  const page = loadPage();

  page.setPreviewState("claimed");
  page.onPrimaryAction();
  expect(wx.navigateTo).toHaveBeenLastCalledWith({
    url: "/dev/pages/venue-claim/index?invitation=d1a-preview&venueId=10000000-0000-4000-8000-000000000001",
  });

  page.setPreviewState("submitted");
  page.onPrimaryAction();
  expect(wx.navigateTo).toHaveBeenLastCalledWith({ url: "/dev/pages/venue-access/index?case=pending" });

  page.setPreviewState("unavailable");
  page.onPrimaryAction();
  expect(page.data.view.actionKind).toBe("accept");
});

test("back follows history and otherwise returns to the production entry", () => {
  const page = loadPage();
  page.onHeaderBack();
  expect(wx.reLaunch).toHaveBeenCalledWith({ url: "/pages/intent-entry/index" });

  (getCurrentPages as unknown as jest.Mock).mockReturnValue([{}, {}]);
  page.onHeaderBack();
  expect(wx.navigateBack).toHaveBeenCalledWith({ delta: 1 });
});
