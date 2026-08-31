/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */

import { existsSync, readFileSync } from "node:fs";
import { beforeEach, expect, jest, test } from "@jest/globals";

import { c1aPlayerApplicationStore } from "../../c1a-player-application-fixture";

interface Definition {
  data: Record<string, any>;
  onLoad(options?: { outcome?: unknown }): void;
  onShow(): void;
  onDisplayNameInput(event: any): void;
  onPositionTap(event: any): void;
  onNoteInput(event: any): void;
  onAdultChange(event: any): void;
  onRiskChange(event: any): void;
  onCancel(): void;
  onHeaderBack(): void;
  onSubmit(): void;
  onConfirmSubmitResult(): void;
  onReload(): void;
  onRecoverAuthentication(): void;
  onReturnGame(): void;
  onReturnPreview(): void;
}

const sourcePath = "miniprogram/dev/pages/c1a-game-application/index.ts";
let captured: Definition | undefined;

function requirePage(): Definition & { setData(patch: Record<string, unknown>): void } {
  expect(existsSync(sourcePath)).toBe(true);
  if (!existsSync(sourcePath)) throw new Error("C1a application page is missing");
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

function fillValid(page: Definition): void {
  page.onDisplayNameInput({ detail: { value: "小范" } });
  page.onPositionTap({ currentTarget: { dataset: { position: "MIDFIELDER" } } });
  page.onNoteInput({ detail: { value: "会提前到场热身" } });
  page.onAdultChange({ detail: { value: ["adult"] } });
  page.onRiskChange({ detail: { value: ["risk"] } });
}

beforeEach(() => {
  c1aPlayerApplicationStore.reset("ACCEPT");
  c1aPlayerApplicationStore.login();
  c1aPlayerApplicationStore.openApplication();
  (globalThis as any).wx = {
    getWindowInfo: jest.fn(() => ({ windowWidth: 375, statusBarHeight: 44 })),
    getMenuButtonBoundingClientRect: jest.fn(() => ({ top: 48, left: 278, width: 87, height: 32 })),
    navigateBack: jest.fn(),
    redirectTo: jest.fn(),
    reLaunch: jest.fn(),
  };
  (globalThis as any).getCurrentPages = jest.fn(() => [
    { route: "dev/pages/c1a-game-public/index" },
    { route: "dev/pages/c1a-game-application/index" },
  ]);
});
test("form imports the singleton and writes each input category with adjacent validation", () => {
  const page = requirePage();
  const source = readFileSync(sourcePath, "utf8");
  const template = readFileSync("miniprogram/dev/pages/c1a-game-application/index.wxml", "utf8");
  expect(source).toMatch(/c1aPlayerApplicationStore/);
  expect(source).not.toMatch(/createC1aPlayerApplicationStore\s*\(/);

  page.onLoad();
  page.onDisplayNameInput({ detail: { value: "范" } });
  expect(page.data.validation.errors.displayName).toBeTruthy();
  page.onDisplayNameInput({ detail: { value: "小范" } });
  page.onPositionTap({ currentTarget: { dataset: { position: "FORWARD" } } });
  page.onNoteInput({ detail: { value: "微信号 pitch_friend" } });
  expect(page.data.validation.errors.note).toMatch(/联系/);
  page.onNoteInput({ detail: { value: "会提前到场热身" } });
  page.onAdultChange({ detail: { value: ["adult"] } });
  page.onRiskChange({ detail: { value: ["risk"] } });

  expect(page.data).toMatchObject({
    draft: { displayName: "小范", position: "FORWARD", note: "会提前到场热身", adultConfirmed: true, riskConfirmed: true },
    validation: { valid: true },
  });
  for (const field of ["displayName", "position", "note", "adultConfirmed", "riskConfirmed"]) {
    expect(template).toContain(`validation.errors.${field}`);
  }
});

test("cancel discards the draft, writes no application, and returns to the shared detail", () => {
  const page = requirePage();
  page.onLoad();
  fillValid(page);
  page.onCancel();

  expect(c1aPlayerApplicationStore.current()).toMatchObject({ registrationStatus: "NONE", formOpen: false, draft: { displayName: "" } });
  expect(wx.navigateBack).toHaveBeenCalledWith({ delta: 1 });
});

test("submit validates, blocks a duplicate in flight, and creates exactly one APPLIED result", () => {
  const page = requirePage();
  page.onLoad();
  page.onSubmit();
  expect(c1aPlayerApplicationStore.current().registrationStatus).toBe("NONE");
  expect(page.data.validation.valid).toBe(false);

  fillValid(page);
  page.data.submitting = true;
  page.onSubmit();
  expect(c1aPlayerApplicationStore.current().submitAttempt).toBeNull();
  page.data.submitting = false;
  page.onSubmit();
  const firstAttempt = c1aPlayerApplicationStore.current().submitAttempt?.key;
  expect(c1aPlayerApplicationStore.current().registrationStatus).toBe("APPLIED");
  expect(wx.navigateBack).toHaveBeenCalledWith({ delta: 1 });
  page.onSubmit();
  expect(c1aPlayerApplicationStore.current().submitAttempt?.key).toBe(firstAttempt);
});

test("unknown submit preserves the original attempt until explicit confirmation", () => {
  const page = requirePage();
  page.onLoad({ outcome: "UNKNOWN" });
  fillValid(page);
  page.onSubmit();
  const attempt = c1aPlayerApplicationStore.current().submitAttempt?.key;
  expect(page.data).toMatchObject({ operationState: "SUBMIT_UNKNOWN", registrationStatus: "NONE", submitOutcome: "UNKNOWN" });
  expect(wx.navigateBack).not.toHaveBeenCalled();

  page.onSubmit();
  expect(c1aPlayerApplicationStore.current().submitAttempt?.key).toBe(attempt);
  page.onConfirmSubmitResult();
  expect(c1aPlayerApplicationStore.current()).toMatchObject({ registrationStatus: "APPLIED", operationState: "READY", submitAttempt: { key: attempt } });
  expect(wx.navigateBack).toHaveBeenCalledWith({ delta: 1 });
});

test("an unauthenticated deep link redirects to the public login boundary without exposing an inert form", () => {
  c1aPlayerApplicationStore.reset();
  const before = c1aPlayerApplicationStore.current();
  const page = requirePage();
  page.onLoad();
  page.onShow();

  expect(wx.redirectTo).toHaveBeenCalledTimes(1);
  expect(wx.redirectTo).toHaveBeenCalledWith({ url: "/dev/pages/c1a-game-public/index" });
  expect(page.data.redirecting).toBe(true);
  expect(c1aPlayerApplicationStore.current()).toEqual(before);

  page.onDisplayNameInput({ detail: { value: "不会被吞掉的输入" } });
  expect(c1aPlayerApplicationStore.current()).toEqual(before);
  expect(page.data.draft.displayName).toBe("");

  const template = readFileSync("miniprogram/dev/pages/c1a-game-application/index.wxml", "utf8");
  expect(template).toContain('wx:if="{{redirecting}}"');
  expect(template).toContain('wx:if="{{!redirecting && operationState === \'READY\'}}"');
});

test("error recovery never creates a new result and deep-link returns fall back to the scenario", () => {
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

  c1aPlayerApplicationStore.injectStateChangedFull();
  page.onShow();
  page.onReturnGame();
  expect(c1aPlayerApplicationStore.current()).toMatchObject({ registrationStatus: "NONE", game: { remainingSpots: 0 }, draft: { displayName: "" } });
  expect(wx.navigateBack).toHaveBeenCalledWith({ delta: 1 });

  c1aPlayerApplicationStore.reset();
  c1aPlayerApplicationStore.injectNotFound();
  page.onShow();
  page.onReturnPreview();
  expect(wx.reLaunch).toHaveBeenCalledWith({ url: "/dev/pages/c1a-scenario/index" });

  (getCurrentPages as unknown as jest.Mock).mockReturnValue([{ route: "dev/pages/c1a-game-application/index" }]);
  c1aPlayerApplicationStore.reset();
  c1aPlayerApplicationStore.login();
  c1aPlayerApplicationStore.openApplication();
  page.onHeaderBack();
  expect(wx.reLaunch).toHaveBeenLastCalledWith({ url: "/dev/pages/c1a-scenario/index" });
});
