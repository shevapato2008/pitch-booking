/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */

import { existsSync, readFileSync } from "node:fs";
import { beforeEach, expect, jest, test } from "@jest/globals";

import { c1aPlayerApplicationStore, type C1aDecision } from "../../c1a-player-application-fixture";

interface Definition {
  data: Record<string, any>;
  onLoad(): void;
  onShow(): void;
  onHeaderBack(): void;
  onLogin(): void;
  onApply(): void;
  onRefresh(): void;
  onConfirmSubmitResult(): void;
  onReload(): void;
  onRecoverAuthentication(): void;
  onReturnPreview(): void;
}

const sourcePath = "miniprogram/dev/pages/c1a-game-public/index.ts";
let captured: Definition | undefined;

function requirePage(): Definition & { setData(patch: Record<string, unknown>): void } {
  expect(existsSync(sourcePath)).toBe(true);
  if (!existsSync(sourcePath)) throw new Error("C1a public page is missing");
  if (!captured) {
    (globalThis as any).Page = (definition: Definition) => { captured = definition; };
    jest.requireActual("./index");
  }
  return {
    ...captured!,
    data: { ...captured!.data },
    setData(patch: Record<string, unknown>) { Object.assign(this.data, patch); },
  };
}

const validForm = {
  displayName: "小范",
  position: "MIDFIELDER" as const,
  note: "会提前到场热身",
  adultConfirmed: true,
  riskConfirmed: true,
};

function submitPending(): void {
  c1aPlayerApplicationStore.login();
  c1aPlayerApplicationStore.openApplication();
  c1aPlayerApplicationStore.updateDraft(validForm);
  c1aPlayerApplicationStore.submitApplication();
}

function decide(decision: C1aDecision): void {
  c1aPlayerApplicationStore.setViewerRole("CAPTAIN");
  c1aPlayerApplicationStore.login();
  c1aPlayerApplicationStore.openDecision(decision);
  c1aPlayerApplicationStore.confirmDecision();
}

beforeEach(() => {
  c1aPlayerApplicationStore.reset("ACCEPT");
  (globalThis as any).wx = {
    getWindowInfo: jest.fn(() => ({ windowWidth: 375, statusBarHeight: 44 })),
    getMenuButtonBoundingClientRect: jest.fn(() => ({ top: 48, left: 278, width: 87, height: 32 })),
    navigateTo: jest.fn(),
    navigateBack: jest.fn(),
    redirectTo: jest.fn(),
    reLaunch: jest.fn(),
  };
  (globalThis as any).getCurrentPages = jest.fn(() => [{ route: "dev/pages/c1a-scenario/index" }, { route: "dev/pages/c1a-game-public/index" }]);
});
test("public detail imports the singleton, logs in without leaving, and then opens the real application form", () => {
  const page = requirePage();
  const source = readFileSync(sourcePath, "utf8");
  expect(source).toMatch(/c1aPlayerApplicationStore/);
  expect(source).not.toMatch(/createC1aPlayerApplicationStore\s*\(/);

  page.onLoad();
  expect(page.data).toMatchObject({ authenticated: false, registrationStatus: "NONE", primaryAction: "LOGIN", headerRightInsetPx: 105 });
  page.onLogin();
  expect(page.data).toMatchObject({ authenticated: true, registrationStatus: "NONE", primaryAction: "APPLY" });
  expect(wx.navigateTo).not.toHaveBeenCalled();

  page.onApply();
  expect(c1aPlayerApplicationStore.current().formOpen).toBe(true);
  expect(wx.navigateTo).toHaveBeenCalledWith({ url: "/dev/pages/c1a-game-application/index" });
});

test.each([
  ["ACCEPT", "JOINED", "已加入本场球局"],
  ["REJECT", "REJECTED", "队长本次未能接受申请"],
] as const)("onShow reads the shared %s result and terminal states expose no fake action", (decision, status, statusCopy) => {
  submitPending();
  const page = requirePage();
  page.onLoad();
  expect(page.data).toMatchObject({ registrationStatus: "APPLIED", primaryAction: "REFRESH" });

  decide(decision);
  page.onShow();
  expect(page.data).toMatchObject({ registrationStatus: status, statusCopy, primaryAction: null });
});

test("refresh and unknown-submit recovery both read the original shared attempt", () => {
  c1aPlayerApplicationStore.login();
  c1aPlayerApplicationStore.openApplication();
  c1aPlayerApplicationStore.updateDraft(validForm);
  const attempt = c1aPlayerApplicationStore.submitApplication("UNKNOWN").submitAttempt?.key;
  const page = requirePage();
  page.onLoad();
  expect(page.data).toMatchObject({ operationState: "SUBMIT_UNKNOWN", primaryAction: "CONFIRM_SUBMIT" });

  page.onConfirmSubmitResult();
  expect(page.data).toMatchObject({ registrationStatus: "APPLIED", operationState: "READY", primaryAction: "REFRESH" });
  expect(c1aPlayerApplicationStore.current().submitAttempt?.key).toBe(attempt);
  page.onRefresh();
  expect(page.data.registrationStatus).toBe("APPLIED");
});

test("load, authentication, not-found, and deep-link return actions recover honestly", () => {
  const page = requirePage();
  page.onLoad();
  c1aPlayerApplicationStore.injectLoadError();
  page.onShow();
  expect(page.data.operationState).toBe("LOAD_ERROR");
  page.onReload();
  expect(page.data.operationState).toBe("READY");

  c1aPlayerApplicationStore.loseAuthentication();
  page.onShow();
  page.onRecoverAuthentication();
  expect(page.data.authenticated).toBe(true);

  c1aPlayerApplicationStore.injectNotFound();
  page.onShow();
  page.onReturnPreview();
  expect(c1aPlayerApplicationStore.current()).toMatchObject({ operationState: "READY", registrationStatus: "NONE" });
  expect(wx.reLaunch).toHaveBeenCalledWith({ url: "/dev/pages/c1a-scenario/index" });

  (getCurrentPages as unknown as jest.Mock).mockReturnValue([{ route: "dev/pages/c1a-game-public/index" }]);
  page.onHeaderBack();
  expect(wx.reLaunch).toHaveBeenLastCalledWith({ url: "/dev/pages/c1a-scenario/index" });
});
