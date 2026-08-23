/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */

import { existsSync, readFileSync } from "node:fs";
import { beforeEach, expect, jest, test } from "@jest/globals";

import { c1aPlayerApplicationStore } from "../../c1a-player-application-fixture";

interface Definition {
  data: Record<string, any>;
  onLoad(options?: { outcome?: unknown }): void;
  onShow(): void;
  onHeaderBack(): void;
  onAccept(): void;
  onReject(): void;
  onClosePanel(): void;
  onConfirmDecision(): void;
  onConfirmDecisionResult(): void;
  onRefreshApplications(): void;
  onReload(): void;
  onRecoverAuthentication(): void;
  onReturnPreview(): void;
  onSwitchApplicant(): void;
}

const sourcePath = "miniprogram/dev/pages/c1a-captain-applications/index.ts";
let captured: Definition | undefined;

function requirePage(): Definition & { setData(patch: Record<string, unknown>): void } {
  expect(existsSync(sourcePath)).toBe(true);
  if (!existsSync(sourcePath)) throw new Error("C1a captain applications page is missing");
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

function preparePending(): void {
  c1aPlayerApplicationStore.login();
  c1aPlayerApplicationStore.openApplication();
  c1aPlayerApplicationStore.updateDraft(validForm);
  c1aPlayerApplicationStore.submitApplication();
  c1aPlayerApplicationStore.setViewerRole("CAPTAIN");
  c1aPlayerApplicationStore.login();
}

beforeEach(() => {
  c1aPlayerApplicationStore.reset("ACCEPT");
  preparePending();
  (globalThis as any).wx = {
    getWindowInfo: jest.fn(() => ({ windowWidth: 375, statusBarHeight: 44 })),
    getMenuButtonBoundingClientRect: jest.fn(() => ({ top: 48, left: 278, width: 87, height: 32 })),
    navigateBack: jest.fn(),
    redirectTo: jest.fn(),
    reLaunch: jest.fn(),
  };
  (globalThis as any).getCurrentPages = jest.fn(() => [{ route: "dev/pages/c1a-scenario/index" }, { route: "dev/pages/c1a-captain-applications/index" }]);
});
test("captain page imports the singleton and closing either confirmation never writes a decision", () => {
  const page = requirePage();
  const source = readFileSync(sourcePath, "utf8");
  expect(source).toMatch(/c1aPlayerApplicationStore/);
  expect(source).not.toMatch(/createC1aPlayerApplicationStore\s*\(/);
  page.onLoad();
  expect(page.data).toMatchObject({ registrationStatus: "APPLIED", panel: null, hasPending: true, headerRightInsetPx: 105 });

  page.onAccept();
  expect(page.data.panel).toBe("ACCEPT");
  page.onClosePanel();
  expect(page.data).toMatchObject({ panel: null, registrationStatus: "APPLIED" });
  page.onReject();
  expect(page.data.panel).toBe("REJECT");
  page.onClosePanel();
  expect(c1aPlayerApplicationStore.current().registrationStatus).toBe("APPLIED");
});

test.each([
  ["onAccept", "JOINED"],
  ["onReject", "REJECTED"],
] as const)("%s confirms a terminal result, renders the honest empty state, and applicant reads it onShow", (handler, status) => {
  const page = requirePage();
  page.onLoad();
  page[handler]();
  page.onConfirmDecision();
  expect(page.data).toMatchObject({ registrationStatus: status, panel: null, hasPending: false, empty: true });

  page.onSwitchApplicant();
  expect(c1aPlayerApplicationStore.current().viewerRole).toBe("APPLICANT");
  expect(wx.redirectTo).toHaveBeenCalledWith({ url: "/dev/pages/c1a-game-public/index" });
  page.onShow();
  expect(page.data.registrationStatus).toBe(status);
});

test("unknown captain mutation confirms only the original decision attempt", () => {
  const page = requirePage();
  page.onLoad({ outcome: "UNKNOWN" });
  page.onAccept();
  page.onConfirmDecision();
  const attempt = c1aPlayerApplicationStore.current().decisionAttempt?.key;
  expect(page.data).toMatchObject({ registrationStatus: "APPLIED", operationState: "MUTATION_UNKNOWN", decisionOutcome: "UNKNOWN" });

  page.onConfirmDecision();
  expect(c1aPlayerApplicationStore.current().decisionAttempt?.key).toBe(attempt);
  page.onConfirmDecisionResult();
  expect(page.data).toMatchObject({ registrationStatus: "JOINED", operationState: "READY", empty: true });
  expect(c1aPlayerApplicationStore.current().decisionAttempt?.key).toBe(attempt);
});

test("capacity conflict preserves APPLIED until an explicit refresh and never invents a waitlist", () => {
  const page = requirePage();
  page.onLoad({ outcome: "CAPACITY_CHANGED" });
  page.onAccept();
  page.onConfirmDecision();
  expect(page.data).toMatchObject({ registrationStatus: "APPLIED", operationState: "CAPACITY_CHANGED", remainingSpots: 0, hasPending: true });
  page.onRefreshApplications();
  expect(page.data).toMatchObject({ registrationStatus: "APPLIED", operationState: "READY", remainingSpots: 0 });
  expect(JSON.stringify(page.data)).not.toContain("WAITLIST");
});

test("captain recovery and deep-link buttons reload authority or return to the scenario", () => {
  const page = requirePage();
  page.onLoad();
  c1aPlayerApplicationStore.injectLoadError();
  page.onShow();
  page.onReload();
  expect(page.data.operationState).toBe("READY");

  c1aPlayerApplicationStore.loseAuthentication();
  page.onShow();
  page.onRecoverAuthentication();
  expect(page.data.authenticated).toBe(true);

  c1aPlayerApplicationStore.injectNotFound();
  page.onShow();
  page.onReturnPreview();
  expect(wx.reLaunch).toHaveBeenCalledWith({ url: "/dev/pages/c1a-scenario/index" });

  (getCurrentPages as unknown as jest.Mock).mockReturnValue([{ route: "dev/pages/c1a-captain-applications/index" }]);
  page.onHeaderBack();
  expect(wx.reLaunch).toHaveBeenLastCalledWith({ url: "/dev/pages/c1a-scenario/index" });
});
