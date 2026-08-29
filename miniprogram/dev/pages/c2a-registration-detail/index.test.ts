/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */

import { beforeEach, expect, jest, test } from "@jest/globals";

import { c2aRegistrationWithdrawalStore } from "../../c2a-registration-withdrawal-fixture";

interface Definition {
  data: Record<string, any>;
  onLoad(query?: { registrationId?: unknown }): void;
  onShow(): void;
  onOpenWithdrawalConfirm(): void;
  onCancelWithdrawal(): void;
  onConfirmWithdrawal(): void;
  onConfirmWithdrawalResult(): void;
  onDismissError(): void;
  onHeaderBack(): void;
  onReturnList(): void;
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
    navigateBack: jest.fn(), redirectTo: jest.fn(),
  };
  (globalThis as any).getCurrentPages = jest.fn(() => [{ route: "dev/pages/c2a-registration-detail/index" }]);
});

const loadCurrentDetail = () => {
  const page = loadPage();
  const id = c2aRegistrationWithdrawalStore.current().registration.registrationId;
  page.onLoad({ registrationId: encodeURIComponent(id) });
  page.onShow();
  return page;
};

test.each([
  ["APPLIED", "撤回申请", false],
  ["JOINED_EARLY", "退出球局", false],
  ["JOINED_LATE", "退出球局", true],
  ["WITHDRAWN", "", false],
] as const)("%s projects its exact action and six-hour warning", (scenario, action, isLateExit) => {
  c2aRegistrationWithdrawalStore.reset(scenario);
  const page = loadCurrentDetail();
  expect(page.data).toMatchObject({ notFound: false, isLateExit, primaryActionLabel: action });
  expect(page.data.showPrimaryAction).toBe(action !== "");
});

test("cancel keeps JOINED while confirm releases one spot exactly once", () => {
  const page = loadCurrentDetail();
  const initialSpots = page.data.game.remainingSpots;
  page.onOpenWithdrawalConfirm();
  expect(page.data.operationState).toBe("CONFIRMING");
  page.onCancelWithdrawal();
  expect(page.data.registration.effectiveStatus).toBe("JOINED");
  expect(page.data.game.remainingSpots).toBe(initialSpots);

  page.onOpenWithdrawalConfirm();
  page.onConfirmWithdrawal();
  expect(page.data).toMatchObject({ operationState: "IDLE", showPrimaryAction: false });
  expect(page.data.registration).toMatchObject({ effectiveStatus: "WITHDRAWN", lateExitRecorded: true });
  expect(page.data.game.remainingSpots).toBe(initialSpots + 1);
  page.onConfirmWithdrawal();
  expect(page.data.game.remainingSpots).toBe(initialSpots + 1);
});

test("APPLIED confirmation does not release a spot and result-unknown only confirms authority", () => {
  c2aRegistrationWithdrawalStore.reset("APPLIED");
  const applied = loadCurrentDetail();
  const initialSpots = applied.data.game.remainingSpots;
  applied.onOpenWithdrawalConfirm();
  applied.onConfirmWithdrawal();
  expect(applied.data.registration.effectiveStatus).toBe("WITHDRAWN");
  expect(applied.data.game.remainingSpots).toBe(initialSpots);

  c2aRegistrationWithdrawalStore.reset("RESULT_UNKNOWN");
  const unknown = loadCurrentDetail();
  unknown.onOpenWithdrawalConfirm();
  expect(unknown.data.operationState).toBe("RESULT_UNKNOWN");
  unknown.onConfirmWithdrawalResult();
  expect(unknown.data).toMatchObject({ operationState: "IDLE", showPrimaryAction: false });
  expect(unknown.data.registration.effectiveStatus).toBe("WITHDRAWN");
});

test("unknown IDs never fall back and deep links return to the thin list", () => {
  const page = loadPage();
  page.onLoad({ registrationId: "unknown" });
  page.onShow();
  expect(page.data).toMatchObject({ notFound: true, registration: null });
  page.onReturnList();
  expect(wx.redirectTo).toHaveBeenCalledWith({ url: "/dev/pages/c2a-my-registrations/index" });

  (getCurrentPages as unknown as jest.Mock).mockReturnValue([
    { route: "dev/pages/c2a-my-registrations/index" },
    { route: "dev/pages/c2a-registration-detail/index" },
  ]);
  page.onHeaderBack();
  expect(wx.navigateBack).toHaveBeenCalledWith({ delta: 1 });
});
