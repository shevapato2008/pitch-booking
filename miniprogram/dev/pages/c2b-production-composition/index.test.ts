/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */

import { beforeEach, expect, jest, test } from "@jest/globals";

import {
  C2B_PRODUCTION_PREVIEW_GAME_ID,
  C2B_PRODUCTION_PREVIEW_SHARE_TOKEN,
} from "../../c2b-production-registration-source";
import {
  getOpenGameRegistrationAttemptStore,
  getOpenGameRegistrationSource,
  resetOpenGameRegistrationAttemptStoreForTesting,
  resetOpenGameRegistrationSourceForTesting,
} from "../../../services/open-game-registration";

type PageDefinition = Record<string, any> & { data: Record<string, any> };
let captured: PageDefinition | undefined;

function loadPage(): PageDefinition {
  if (!captured) {
    (globalThis as any).Page = (definition: PageDefinition) => { captured = definition; };
    jest.requireActual("./index");
  }
  return { ...captured!, data: structuredClone(captured!.data) };
}

beforeEach(() => {
  resetOpenGameRegistrationSourceForTesting();
  resetOpenGameRegistrationAttemptStoreForTesting();
  const storage = new Map<string, unknown>();
  (globalThis as any).wx = {
    getStorageSync: jest.fn((key: string) => storage.get(key)),
    setStorageSync: jest.fn((key: string, value: unknown) => storage.set(key, value)),
    removeStorageSync: jest.fn((key: string) => storage.delete(key)),
    redirectTo: jest.fn(),
    reLaunch: jest.fn(),
  };
});

test.each([
  ["FULL_REVIEW", "CAPTAIN", `/pages/captain-game-applications/index?game_id=${C2B_PRODUCTION_PREVIEW_GAME_ID}`],
  ["WAITLISTED_FIRST", "DETAIL", `/pages/captain-game-public/index?token=${C2B_PRODUCTION_PREVIEW_SHARE_TOKEN}`],
  ["PROMOTED", "LIST", "/pages/my-game-registrations/index"],
] as const)("installs %s fixture authority and opens the actual %s production page", async (
  scenario,
  target,
  route,
) => {
  const page = loadPage();

  page.onLoad({ scenario, target });

  expect(wx.redirectTo).toHaveBeenCalledWith({ url: route });
  expect(wx.removeStorageSync).not.toHaveBeenCalled();
  expect(getOpenGameRegistrationAttemptStore().load()).toBeNull();
  const source = getOpenGameRegistrationSource();
  expect(source.currentUserId()).not.toBeNull();
  if (target === "CAPTAIN") {
    expect((await source.getPending(C2B_PRODUCTION_PREVIEW_GAME_ID)).applications).toHaveLength(1);
  } else {
    expect((await source.getContext(C2B_PRODUCTION_PREVIEW_SHARE_TOKEN)).viewerRegistration)
      .not.toBeNull();
  }
});

test("invalid options fail closed to the existing isolated C2b launcher", () => {
  const page = loadPage();

  page.onLoad({ scenario: "UNKNOWN", target: "DETAIL" });

  expect(wx.reLaunch).toHaveBeenCalledWith({ url: "/dev/pages/c2b-waitlist-scenario/index" });
  expect(wx.redirectTo).not.toHaveBeenCalled();
  expect(() => getOpenGameRegistrationSource()).toThrow("OPEN_GAME_REGISTRATION_SOURCE_NOT_CONFIGURED");
});
