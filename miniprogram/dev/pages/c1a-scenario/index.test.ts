/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */

import { existsSync, readFileSync } from "node:fs";
import { beforeEach, expect, jest, test } from "@jest/globals";

import { c1aPlayerApplicationStore } from "../../c1a-player-application-fixture";

interface Definition {
  data: Record<string, any>;
  onLoad(): void;
  onShow(): void;
  onResetAccept(): void;
  onResetReject(): void;
  onOpenApplicant(): void;
  onOpenCaptain(): void;
}

const sourcePath = "miniprogram/dev/pages/c1a-scenario/index.ts";
let captured: Definition | undefined;

function requirePage(): Definition & { setData(patch: Record<string, unknown>): void } {
  expect(existsSync(sourcePath)).toBe(true);
  if (!existsSync(sourcePath)) throw new Error("C1a scenario page is missing");
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

beforeEach(() => {
  c1aPlayerApplicationStore.reset("ACCEPT");
  (globalThis as any).wx = {
    getWindowInfo: jest.fn(() => ({ windowWidth: 375, statusBarHeight: 44 })),
    getMenuButtonBoundingClientRect: jest.fn(() => ({ top: 48, left: 278, width: 87, height: 32 })),
    navigateTo: jest.fn(),
    reLaunch: jest.fn(),
  };
});
test("scenario imports the one module singleton and onShow re-reads its authority", () => {
  const page = requirePage();
  const source = readFileSync(sourcePath, "utf8");
  expect(source).toMatch(/import[\s\S]*c1aPlayerApplicationStore[\s\S]*from "\.\.\/\.\.\/c1a-player-application-fixture"/);
  expect(source).not.toMatch(/createC1aPlayerApplicationStore\s*\(/);

  page.onLoad();
  expect(page.data).toMatchObject({ branch: "ACCEPT", viewerRole: "APPLICANT", authenticated: false, registrationStatus: "NONE" });
  c1aPlayerApplicationStore.reset("REJECT");
  page.onShow();
  expect(page.data.branch).toBe("REJECT");
});

test.each([
  ["onResetAccept", "ACCEPT"],
  ["onResetReject", "REJECT"],
] as const)("%s resets the requested branch and opens the anonymous applicant detail", (handler, branch) => {
  const page = requirePage();
  page.onLoad();
  page[handler]();

  expect(c1aPlayerApplicationStore.current()).toMatchObject({ branch, viewerRole: "APPLICANT", authenticated: false, registrationStatus: "NONE" });
  expect(wx.navigateTo).toHaveBeenCalledWith({ url: "/dev/pages/c1a-game-public/index" });
});

test("development-only role controls switch the shared store and navigate to the matching page", () => {
  const page = requirePage();
  page.onLoad();

  page.onOpenCaptain();
  expect(c1aPlayerApplicationStore.current()).toMatchObject({ viewerRole: "CAPTAIN", authenticated: true });
  expect(wx.navigateTo).toHaveBeenLastCalledWith({ url: "/dev/pages/c1a-captain-applications/index" });

  page.onOpenApplicant();
  expect(c1aPlayerApplicationStore.current().viewerRole).toBe("APPLICANT");
  expect(wx.navigateTo).toHaveBeenLastCalledWith({ url: "/dev/pages/c1a-game-public/index" });
});
