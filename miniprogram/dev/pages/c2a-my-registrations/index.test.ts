/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */

import { beforeEach, expect, jest, test } from "@jest/globals";

import { c2aRegistrationWithdrawalStore } from "../../c2a-registration-withdrawal-fixture";

interface Definition {
  data: Record<string, any>;
  onLoad(): void;
  onShow(): void;
  onOpenRegistration(event: { currentTarget?: { dataset?: { registrationId?: unknown } } }): void;
  onScroll(event: { detail?: { scrollTop?: unknown } }): void;
  onHeaderBack(): void;
}

let captured: Definition | undefined;
const loadPage = () => {
  if (!captured) {
    (globalThis as any).Page = (definition: Definition) => { captured = definition; };
    jest.requireActual("./index");
  }
  return { ...captured!, data: { ...captured!.data }, setData(patch: Record<string, unknown>) { Object.assign(this.data, patch); } } as Definition & { setData(patch: Record<string, unknown>): void };
};

beforeEach(() => {
  c2aRegistrationWithdrawalStore.reset("JOINED_LATE");
  (globalThis as any).wx = {
    getWindowInfo: jest.fn(() => ({ windowWidth: 375, statusBarHeight: 44 })),
    getMenuButtonBoundingClientRect: jest.fn(() => ({ top: 48, bottom: 80, left: 278, right: 365, width: 87, height: 32 })),
    navigateTo: jest.fn(), navigateBack: jest.fn(), redirectTo: jest.fn(),
  };
  (globalThis as any).getCurrentPages = jest.fn(() => [{}]);
});

test("projects the selected registration and opens only its exact detail", () => {
  const page = loadPage();
  page.onLoad();
  page.onShow();
  const registrationId = c2aRegistrationWithdrawalStore.current().registration.registrationId;
  expect(page.data).toMatchObject({ headerTopPx: 44, headerRowHeightPx: 44, resultCount: 1, listScrollTop: 0 });
  expect(page.data.items[0]).toMatchObject({ registrationId, statusLabel: "已加入" });

  page.onOpenRegistration({ currentTarget: { dataset: { registrationId } } });
  expect(wx.navigateTo).toHaveBeenCalledWith({
    url: `/dev/pages/c2a-registration-detail/index?registrationId=${encodeURIComponent(registrationId)}`,
  });
  page.onOpenRegistration({ currentTarget: { dataset: { registrationId: "unknown" } } });
  expect(wx.navigateTo).toHaveBeenCalledTimes(1);
});

test("withdrawn state and exact scroll are recovered on show after returning from detail", () => {
  const page = loadPage();
  page.onLoad();
  page.onScroll({ detail: { scrollTop: 486.5 } });
  const registrationId = c2aRegistrationWithdrawalStore.current().registration.registrationId;
  c2aRegistrationWithdrawalStore.openConfirmation(registrationId);
  c2aRegistrationWithdrawalStore.beginWithdrawal();
  c2aRegistrationWithdrawalStore.resolveWithdrawal("CONFIRMED");

  page.data.items = [];
  page.data.listScrollTop = 0;
  page.onShow();
  expect(page.data).toMatchObject({ listScrollTop: 486.5, resultCount: 1 });
  expect(page.data.items[0]).toMatchObject({ effectiveStatus: "WITHDRAWN", statusLabel: "已退出" });
});

test("back returns to the launcher without modifying the C1c store", () => {
  const page = loadPage();
  page.onHeaderBack();
  expect(wx.redirectTo).toHaveBeenCalledWith({ url: "/dev/pages/c2a-withdrawal-scenario/index" });
  (getCurrentPages as unknown as jest.Mock).mockReturnValue([{}, {}]);
  page.onHeaderBack();
  expect(wx.navigateBack).toHaveBeenCalledWith({ delta: 1 });
});
