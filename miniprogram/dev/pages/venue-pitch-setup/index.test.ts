/// <reference types="node" />

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

import type { VenuePitchSetupVisualState, VenuePitchSetupView } from "../../venue-pitch-setup-fixture";

const states = [
  "initial-loading", "load-error", "first-entry-empty", "inactive-only", "add-first-open",
  "first-pitch-draft", "unnamed-pitch-draft", "first-save-success", "six-pitch-list",
  "edit-preset-open", "edit-custom-open", "field-validation", "deactivate-blocked",
  "unused-delete-confirm", "unused-deleted-draft", "deactivated-draft", "reactivated-draft",
  "save-in-progress", "save-failed", "configuration-changed", "save-result-unknown",
  "unsaved-leave-confirm",
] as const satisfies readonly VenuePitchSetupVisualState[];

interface PageData extends VenuePitchSetupView {
  headerTopPx: number;
  headerRowHeightPx: number;
  headerRightInsetPx: number;
  underlyingState: VenuePitchSetupVisualState;
  draftPlayersInput: string;
  draftPlayersPreview: string;
  isDraftPlayersValid: boolean;
}

interface PageDefinition {
  data: PageData;
  onLoad(options?: { state?: unknown }): void;
  onOpenAdd(): void;
  onPitchTap(event: { currentTarget?: { dataset?: { pitchId?: unknown } } }): void;
  onPlayersInput(event: { detail?: { value?: unknown } }): void;
  onCompleteEditor(): void;
  onDeletePitch(): void;
  onConfirmDelete(): void;
  onDeactivatePitch(): void;
  onReactivatePitch(): void;
  onCloseSheet(): void;
  onCancelSheet(): void;
  onBack(): void;
  onPageAction(): void;
}

interface RuntimePage extends PageDefinition {
  setData(patch: Partial<PageData>): void;
}

let capturedDefinition: PageDefinition | undefined;

function loadPage(): RuntimePage {
  if (!capturedDefinition) {
    (globalThis as unknown as { Page(value: PageDefinition): void }).Page = (value) => { capturedDefinition = value; };
    jest.requireActual("./index");
  }
  return {
    ...capturedDefinition!,
    data: { ...capturedDefinition!.data },
    setData(patch) { Object.assign(this.data, patch); },
  };
}

beforeEach(() => {
  (globalThis as unknown as { wx: unknown }).wx = {
    getWindowInfo: jest.fn(() => ({ windowWidth: 375, statusBarHeight: 44 })),
    getMenuButtonBoundingClientRect: jest.fn(() => ({ top: 48, bottom: 80, left: 278, right: 365, width: 87, height: 32 })),
    showToast: jest.fn(),
  };
});

describe.each(states)("state %s", (state) => {
  test("loads the exact visual state through the shared view builder", () => {
    const page = loadPage();
    page.onLoad({ state });
    expect(page.data.visualState).toBe(state);
    expect(page.data.headerTopPx).toBe(44);
    expect(page.data.headerRowHeightPx).toBe(44);
    expect(page.data.headerRightInsetPx).toBe(105);
  });
});

test("missing and invalid state queries fall back to six-pitch-list", () => {
  const page = loadPage();
  page.onLoad({ state: "saving" });
  expect(page.data.visualState).toBe("six-pitch-list");
  page.onLoad();
  expect(page.data.visualState).toBe("six-pitch-list");
});

test("opens add, A场 preset editor, and other canonical pitches in the inline custom editor", () => {
  const page = loadPage();
  page.onLoad({ state: "first-entry-empty" });
  page.onOpenAdd();
  expect(page.data).toMatchObject({ visualState: "add-first-open", underlyingState: "first-entry-empty" });
  page.onCloseSheet();
  expect(page.data.visualState).toBe("first-entry-empty");

  page.onLoad();
  page.onPitchTap({ currentTarget: { dataset: { pitchId: "pitch-7-001" } } });
  expect(page.data).toMatchObject({ visualState: "edit-preset-open", underlyingState: "six-pitch-list" });
  page.onCancelSheet();
  page.onPitchTap({ currentTarget: { dataset: { pitchId: "pitch-5-002" } } });
  expect(page.data.visualState).toBe("edit-custom-open");
  page.onCloseSheet();
  page.onPitchTap({ currentTarget: { dataset: { pitchId: "missing" } } });
  expect(page.data.visualState).toBe("six-pitch-list");
});

test.each([
  ["6", "预览：6人制", true], ["6.5", "预览：6.5人制", false], ["0", "预览：0人制", false],
  ["99", "预览：99人制", true], ["100", "预览：100人制", false], ["abc", "请输入 1–99 的整数", false],
] as const)("previews numeric value %s but accepts only integer 1–99", (value, preview, valid) => {
  const page = loadPage();
  page.onLoad({ state: "edit-custom-open" });
  page.onPlayersInput({ detail: { value } });
  expect(page.data).toMatchObject({ draftPlayersInput: value, draftPlayersPreview: preview, isDraftPlayersValid: valid });
});

test("editor completion changes only the page draft visual state", () => {
  const page = loadPage();
  page.onLoad({ state: "add-first-open" });
  page.onCompleteEditor();
  expect(page.data.visualState).toBe("first-pitch-draft");
  page.onLoad({ state: "edit-custom-open" });
  page.onPlayersInput({ detail: { value: "6.5" } });
  page.onCompleteEditor();
  expect(page.data.visualState).toBe("field-validation");
  page.onLoad({ state: "edit-custom-open" });
  page.onCompleteEditor();
  expect(page.data.visualState).toBe("six-pitch-list");
});

test("delete, deactivate, and reactivate use only approved local draft states", () => {
  const page = loadPage();
  page.onLoad();
  page.onDeletePitch();
  expect(page.data.visualState).toBe("unused-delete-confirm");
  page.onConfirmDelete();
  expect(page.data.visualState).toBe("unused-deleted-draft");
  page.onDeactivatePitch();
  expect(page.data.visualState).toBe("deactivated-draft");
  page.onReactivatePitch();
  expect(page.data.visualState).toBe("reactivated-draft");
});

test.each(["save-in-progress", "save-result-unknown"] as const)("%s ignores duplicate page saves and cannot be dismissed", (state) => {
  const page = loadPage();
  page.onLoad({ state });
  page.onPageAction();
  page.onCloseSheet();
  expect(page.data.visualState).toBe(state);
});

test("back from a page draft opens leave confirmation and cancel restores that draft", () => {
  const page = loadPage();
  page.onLoad({ state: "deactivated-draft" });
  page.onBack();
  expect(page.data).toMatchObject({ visualState: "unsaved-leave-confirm", underlyingState: "deactivated-draft" });
  page.onCancelSheet();
  expect(page.data.visualState).toBe("deactivated-draft");
});

test("first save handoff stays preview-only and never navigates to inventory-v2", () => {
  const page = loadPage();
  const wx = (globalThis as unknown as { wx: { showToast: jest.Mock } }).wx;
  page.onLoad({ state: "first-save-success" });
  page.onPageAction();
  expect(wx.showToast).toHaveBeenCalledWith({ title: "仅视觉预览，未写入场地配置", icon: "none" });
});
