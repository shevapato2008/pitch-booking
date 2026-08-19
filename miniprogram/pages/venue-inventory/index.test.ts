/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";

import { registerInventoryDataSource, resetInventoryDataSourceForTesting, type InventoryDataSource } from "../../services/inventory";
import { registerInventoryMutationAttemptStore, resetInventoryMutationAttemptStoreForTesting } from "../../services/inventory-attempt-store";

const venueId = "00000000-0000-4000-8000-000000000010";
const pitchA = { id: "00000000-0000-4000-8000-000000000020", name: "七人制 A 场", displayName: "A场", pitchType: "SEVEN_A_SIDE" as const, playersPerSide: 7 as const };
const pitchB = { id: "00000000-0000-4000-8000-000000000021", name: "五人制 1 场", displayName: "滨河场", pitchType: "FIVE_A_SIDE" as const, playersPerSide: 5 as const };
const slot = { id: "00000000-0000-4000-8000-000000000030", pitchId: pitchA.id, startsAt: "2026-08-11T14:00:00+08:00", endsAt: "2026-08-11T16:00:00+08:00", startTime: "14:00", endTime: "16:00", priceCents: 26000, status: "AVAILABLE" as const, checkoutVersion: 12, editable: true, readOnlyReason: null };
const day = (pitch: typeof pitchA | typeof pitchB = pitchA, localDate = "2026-08-11") => ({
  venue: { id: venueId, name: "渤海元丰足球场", timezone: "Asia/Shanghai" as const }, localDate,
  availabilityWindow: { startDate: "2026-08-10", endDate: "2026-08-23" }, pitches: [pitchB, pitchA],
  selectedPitchId: pitch.id, slots: pitch.id === pitchA.id ? [slot] : [], generatedAt: "2026-08-11T06:00:00Z",
});

let captured: any;
const loadPage = () => {
  if (!captured) {
    (globalThis as any).Page = (definition: any) => { captured = definition; };
    jest.requireActual("./index");
  }
  return { ...captured, data: structuredClone(captured.data), setData(patch: Record<string, unknown>) { Object.assign(this.data, patch); } };
};

beforeEach(() => {
  resetInventoryDataSourceForTesting(); resetInventoryMutationAttemptStoreForTesting();
  (globalThis as any).wx = {
    getWindowInfo: jest.fn(() => ({ windowWidth: 375, statusBarHeight: 44 })),
    getMenuButtonBoundingClientRect: jest.fn(() => ({ top: 48, bottom: 80, left: 278, right: 365, width: 87, height: 32 })),
    navigateBack: jest.fn(async () => undefined), redirectTo: jest.fn(async () => undefined), showToast: jest.fn(),
  };
});

test("loads authority data and renders the approved inventory structure", async () => {
  const source = sourceHarness(); registerInventoryDataSource(source);
  const page = loadPage(); await page.onLoad({ venue_id: venueId, local_date: "2026-08-11" });
  expect(page.data).toMatchObject({ mode: "ready", monthTitle: "2026年8月", selectedDate: "2026-08-11", slotCount: 1 });
  expect(page.data.selectedPitch).toMatchObject({ id: pitchA.id, displayName: "A场" });
  expect(page.data.slots[0]).toMatchObject({ price: "260", statusLabel: "开放", editable: true });
  expect(page.data.week).toHaveLength(7);
});

test("uses the Shanghai calendar date when no explicit inventory date is supplied", async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-08-15T17:38:00Z"));
  try {
    const source = sourceHarness();
    source.getDay.mockImplementation(async (_venueId, _pitchId, localDate) => day(pitchA, localDate));
    registerInventoryDataSource(source);
    const page = loadPage(); await page.onLoad({ venue_id: venueId });
    expect(source.getDay).toHaveBeenCalledWith(venueId, undefined, "2026-08-16");
    expect(page.data).toMatchObject({ mode: "ready", selectedDate: "2026-08-16", selectedPitch: { id: pitchA.id } });
  } finally {
    jest.useRealTimers();
  }
});

test("keeps an initial read failure in the full error state without an empty pitch shell", async () => {
  const source = sourceHarness();
  source.getDay.mockRejectedValueOnce(Object.assign(new Error("invalid local date"), { code: "INVALID_ARGUMENT" }));
  registerInventoryDataSource(source);
  const page = loadPage(); await page.onLoad({ venue_id: venueId, local_date: "2026-08-15" });
  expect(page.data).toMatchObject({ mode: "load-error", statusMessage: "库存加载失败，请重试", recoveryLabel: "重试", selectedPitch: null, pageAction: { disabled: true } });
  const markup = readFileSync("miniprogram/pages/venue-inventory/index.wxml", "utf8");
  expect(markup).toContain("mode === 'initial-loading' || mode === 'load-error'");
});

test("shows a first-load permission failure as a complete non-retryable error state", async () => {
  const source = sourceHarness();
  source.getDay.mockRejectedValueOnce(Object.assign(new Error("forbidden"), { code: "INVENTORY_FORBIDDEN" }));
  registerInventoryDataSource(source);
  const page = loadPage(); await page.onLoad({ venue_id: venueId, local_date: "2026-08-16" });
  expect(page.data).toMatchObject({ mode: "load-error", statusMessage: "当前账号没有该场馆的库存管理权限", recoveryLabel: "", writeControlsDisabled: true, pageAction: { disabled: true } });
});

test("explains that inventory needs a physical pitch and links to pitch setup", async () => {
  const source = sourceHarness();
  source.getDay.mockRejectedValueOnce(Object.assign(new Error("pitch not found"), { code: "PITCH_NOT_FOUND" }));
  registerInventoryDataSource(source);
  const page = loadPage(); await page.onLoad({ venue_id: venueId, local_date: "2026-08-16" });

  expect(page.data).toMatchObject({
    mode: "pitch-required",
    statusMessage: "尚未配置物理场地",
    recoveryLabel: "",
    writeControlsDisabled: true,
    selectedPitch: null,
    pageAction: { disabled: true },
  });
  page.onOpenPitchConfiguration();
  expect(wx.redirectTo).toHaveBeenCalledWith({ url: `/pages/venue-pitch-setup/index?venue_id=${venueId}` });

  const markup = readFileSync("miniprogram/pages/venue-inventory/index.wxml", "utf8");
  expect(markup).toContain("请先添加场地，再设置库存时段。");
  expect(markup).toMatch(/mode === 'pitch-required'[\s\S]*bindtap="onOpenPitchConfiguration"/);
});

test("drops stale pitch/date responses and keeps the latest tuple", async () => {
  const first = deferred<ReturnType<typeof day>>(); const second = deferred<ReturnType<typeof day>>();
  const source = sourceHarness(); (source as any).getDay = jest.fn<(...args: any[]) => any>().mockResolvedValueOnce(day()).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  registerInventoryDataSource(source); const page = loadPage(); await page.onLoad({ venue_id: venueId, local_date: "2026-08-11" });
  const oldRead = page.selectAndLoad(pitchA.id, "2026-08-12");
  const latestRead = page.selectAndLoad(pitchB.id, "2026-08-13");
  second.resolve(day(pitchB, "2026-08-13")); await latestRead;
  first.resolve(day(pitchA, "2026-08-12")); await oldRead;
  expect(page.data).toMatchObject({ selectedDate: "2026-08-13", selectedPitch: { id: pitchB.id }, slotCount: 0 });
});

test("creates from real inputs, persists unknown attempts, and retries the same key", async () => {
  const source = sourceHarness(); (source as any).createSlot = jest.fn<(...args: any[]) => any>().mockRejectedValueOnce(Object.assign(new Error(), { code: "INVENTORY_RESULT_UNKNOWN" })).mockResolvedValueOnce(slot);
  registerInventoryDataSource(source);
  let saved: any; const store = { load: jest.fn(() => saved ?? null), save: jest.fn((value: any) => { saved = structuredClone(value); }), clear: jest.fn(() => { saved = undefined; }) };
  registerInventoryMutationAttemptStore(store);
  const page = loadPage(); await page.onLoad({ venue_id: venueId, local_date: "2026-08-11" });
  page.onOpenCreate(); page.onStartTimeChange({ detail: { value: "09:30" } }); page.onEndTimeChange({ detail: { value: "11:00" } }); page.onPriceInput({ detail: { value: "200" } });
  await page.onSaveSlot();
  expect(page.data.mode).toBe("save-result-unknown"); expect(store.save).toHaveBeenCalledTimes(1);
  await page.onRetryMutation();
  expect(source.createSlot).toHaveBeenCalledTimes(2);
  expect(source.createSlot.mock.calls[1][0]).toEqual(source.createSlot.mock.calls[0][0]);
  expect(store.clear).toHaveBeenCalled(); expect(page.data.editor).toBeNull();
});

test("locks navigation, selection, and dismissal while a saved result is unknown", async () => {
  const source = sourceHarness(); source.createSlot.mockRejectedValueOnce(Object.assign(new Error(), { code: "INVENTORY_RESULT_UNKNOWN" }));
  registerInventoryDataSource(source);
  let saved: any; registerInventoryMutationAttemptStore({ load: () => saved ?? null, save: jest.fn((value: any) => { saved = structuredClone(value); }), clear: jest.fn() });
  const page = loadPage(); await page.onLoad({ venue_id: venueId, local_date: "2026-08-11" });
  page.onOpenCreate(); await page.onSaveSlot();
  const editor = page.data.editor; const selectedDate = page.data.selectedDate; const selectedPitchId = page.data.selectedPitch.id;

  page.onBack(); page.onOpenCalendar(); page.onOpenPitchPicker(); page.onSelectDate({ currentTarget: { dataset: { date: "2026-08-12" } } });
  page.onSelectPitch({ currentTarget: { dataset: { pitchId: pitchB.id } } }); page.onCloseOverlay();

  expect(wx.navigateBack).not.toHaveBeenCalled();
  expect(page.data).toMatchObject({ mode: "save-result-unknown", selectedDate, selectedPitch: { id: selectedPitchId }, sheet: null, editor });
  expect(source.getDay).toHaveBeenCalledTimes(1);
});

test("edits price/status and permission failure disables every write control", async () => {
  const source = sourceHarness();
  (source as any).updateSlot = jest.fn<(...args: any[]) => any>().mockResolvedValueOnce({ ...slot, status: "CLOSED", priceCents: 28000, checkoutVersion: 13 });
  registerInventoryDataSource(source); registerInventoryMutationAttemptStore({ load: () => null, save: jest.fn(), clear: jest.fn() });
  const page = loadPage(); await page.onLoad({ venue_id: venueId, local_date: "2026-08-11" });
  page.onSlotTap({ currentTarget: { dataset: { slotId: slot.id } } }); page.onPriceInput({ detail: { value: "280" } }); page.onStatusSelect({ currentTarget: { dataset: { status: "CLOSED" } } });
  await page.onSaveSlot();
  expect(source.updateSlot).toHaveBeenCalledWith(expect.objectContaining({ body: { expectedCheckoutVersion: 12, priceCents: 28000, status: "CLOSED" } }));
  (source as any).getDay = jest.fn<(...args: any[]) => any>().mockRejectedValueOnce(Object.assign(new Error(), { code: "INVENTORY_FORBIDDEN" }));
  await page.selectAndLoad(pitchA.id, "2026-08-12");
  expect(page.data).toMatchObject({ writeControlsDisabled: true, mode: "permission-error", editor: null });
});

test("production markup has real handlers and no preview-only controls", () => {
  const markup = readFileSync("miniprogram/pages/venue-inventory/index.wxml", "utf8");
  const styles = readFileSync("miniprogram/pages/venue-inventory/index.wxss", "utf8");
  expect(markup).not.toContain("仅视觉预览"); expect(markup).not.toContain("onPreview");
  for (const handler of ["onBack", "onOpenPitchConfiguration", "onOpenCalendar", "onSelectDate", "onConfirmDate", "onOpenPitchPicker", "onSelectPitch", "onSlotTap", "onOpenCreate", "onStartTimeChange", "onEndTimeChange", "onPriceInput", "onStatusSelect", "onCloseOverlay", "onSaveSlot", "onRetryRead", "onRetryMutation"]) expect(markup).toContain(handler);
  expect(styles).toMatch(/\.calendar-day\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;[^}]*justify-content:\s*center;/s);
});

test("covers back, pitch picker, calendar, close, and initial retry controls", async () => {
  const source = sourceHarness();
  source.getDay.mockRejectedValueOnce(Object.assign(new Error(), { code: "SERVICE_UNAVAILABLE" })).mockImplementation(async (_venueId, pitchId, localDate) => day(pitchId === pitchB.id ? pitchB : pitchA, localDate));
  registerInventoryDataSource(source);
  const page = loadPage(); await page.onLoad({ venue_id: venueId, local_date: "2026-08-11" });
  expect(page.data.mode).toBe("load-error"); await page.onRetryRead(); expect(page.data.mode).toBe("ready");
  page.onBack(); expect(wx.navigateBack).toHaveBeenCalled();

  page.onOpenPitchPicker(); expect(page.data.sheet).toMatchObject({ kind: "pitch-picker", selectedPitchId: pitchA.id });
  page.onCloseOverlay(); expect(page.data.sheet).toBeNull();
  page.onOpenPitchPicker(); page.onSelectPitch({ currentTarget: { dataset: { pitchId: pitchB.id } } }); await Promise.resolve(); await Promise.resolve();
  expect(page.data.selectedPitch).toMatchObject({ id: pitchB.id });

  page.onOpenCalendar(); expect(page.data.sheet).toMatchObject({ kind: "calendar", pendingLabel: "8月11日 周二" });
  page.onSelectDate({ currentTarget: { dataset: { date: "2026-08-12" } } }); expect(page.data.pendingDate).toBe("2026-08-12");
  page.onConfirmDate(); await Promise.resolve(); await Promise.resolve(); expect(page.data.selectedDate).toBe("2026-08-12");
});

test("covers add, validation, cancel, editable and read-only slot controls", async () => {
  const source = sourceHarness(); registerInventoryDataSource(source); registerInventoryMutationAttemptStore({ load: () => null, save: jest.fn(), clear: jest.fn() });
  const page = loadPage(); await page.onLoad({ venue_id: venueId, local_date: "2026-08-11" });
  page.onOpenCreate(); expect(page.data.editor).toMatchObject({ mode: "create", saveLabel: "新增并开放" });
  page.onStartTimeChange({ detail: { value: "11:00" } }); page.onEndTimeChange({ detail: { value: "10:30" } }); await page.onSaveSlot();
  expect(page.data.editor.fieldError).toContain("请检查时间和价格"); expect(source.createSlot).not.toHaveBeenCalled();
  page.onCloseOverlay(); expect(page.data.editor).toBeNull();

  page.onSlotTap({ currentTarget: { dataset: { slotId: slot.id } } }); expect(page.data.editor).toMatchObject({ mode: "edit", timeReadOnly: true });
  page.onStatusSelect({ currentTarget: { dataset: { status: "CLOSED" } } }); expect(page.data.editor.draft.status).toBe("CLOSED");
  page.onCloseOverlay();
  page.setData({ slots: [{ ...page.data.slots[0], editable: false }] }); page.onSlotTap({ currentTarget: { dataset: { slotId: slot.id } } }); expect(page.data.editor).toBeNull();
});

test("keeps retry visible when an unknown persisted update cannot rebuild its editor", async () => {
  const missingAttempt = { kind: "update" as const, venueId, slotId: "00000000-0000-4000-8000-000000000099", body: { expectedCheckoutVersion: 2, priceCents: 22000, status: "AVAILABLE" as const }, idempotencyKey: "inventory-missing-slot-key" };
  const source = sourceHarness(); source.updateSlot.mockRejectedValueOnce(Object.assign(new Error(), { code: "INVENTORY_RESULT_UNKNOWN" }));
  registerInventoryDataSource(source); registerInventoryMutationAttemptStore({ load: () => missingAttempt, save: jest.fn(), clear: jest.fn() });
  const page = loadPage(); await page.onLoad({ venue_id: venueId, local_date: "2026-08-11" });
  expect(page.data).toMatchObject({ mode: "save-result-unknown", editor: null, statusMessage: "保存结果正在确认，请使用原操作重试" });
  const markup = readFileSync("miniprogram/pages/venue-inventory/index.wxml", "utf8");
  expect(markup).toContain("mode === 'save-result-unknown' && !editor"); expect(markup).toContain('bindtap="onRetryMutation"');
});

test("shows conflict feedback after the authoritative inventory refresh completes", async () => {
  const source = sourceHarness(); source.updateSlot.mockRejectedValueOnce(Object.assign(new Error(), { code: "INVENTORY_VERSION_CONFLICT" }));
  registerInventoryDataSource(source); registerInventoryMutationAttemptStore({ load: () => null, save: jest.fn(), clear: jest.fn() });
  const page = loadPage(); await page.onLoad({ venue_id: venueId, local_date: "2026-08-11" });
  page.onSlotTap({ currentTarget: { dataset: { slotId: slot.id } } }); await page.onSaveSlot();
  expect(source.getDay).toHaveBeenCalledTimes(2);
  expect(page.data).toMatchObject({ mode: "ready", editor: null, statusMessage: "该时段状态已变化，已重新读取库存" });
});

test("keeps editable input for time conflicts and ordinary save failures", async () => {
  const source = sourceHarness(); source.createSlot
    .mockRejectedValueOnce(Object.assign(new Error(), { code: "SLOT_TIME_CONFLICT" }))
    .mockRejectedValueOnce(Object.assign(new Error(), { code: "SERVICE_UNAVAILABLE" }));
  const store = { load: () => null, save: jest.fn(), clear: jest.fn() };
  registerInventoryDataSource(source); registerInventoryMutationAttemptStore(store);
  const page = loadPage(); await page.onLoad({ venue_id: venueId, local_date: "2026-08-11" });
  page.onOpenCreate(); await page.onSaveSlot();
  expect(page.data.editor).toMatchObject({ saveLabel: "重新保存", saveDisabled: false, closeDisabled: false, fieldError: "09:30–11:00 与已有时段重叠，请调整开始或结束时间" });
  expect(store.clear).toHaveBeenCalledTimes(1);
  await page.onSaveSlot();
  expect(page.data.editor).toMatchObject({ saveLabel: "重新保存", saveDisabled: false, closeDisabled: false, fieldError: "保存失败，请重试" });
});

test("explains a rejected past start time instead of showing a generic input error", async () => {
  const source = sourceHarness(); source.createSlot.mockRejectedValueOnce(Object.assign(new Error(), { code: "INVALID_ARGUMENT" }));
  registerInventoryDataSource(source); registerInventoryMutationAttemptStore({ load: () => null, save: jest.fn(), clear: jest.fn() });
  const page = loadPage(); await page.onLoad({ venue_id: venueId, local_date: "2026-08-11" });
  page.onOpenCreate(); await page.onSaveSlot();
  expect(page.data.editor).toMatchObject({
    saveLabel: "重新保存",
    saveDisabled: false,
    fieldError: "09:30 已经开始，请选择当前时间之后的开始时间",
  });
});

function sourceHarness(): jest.Mocked<InventoryDataSource> {
  return { login: jest.fn(async () => undefined), getDay: jest.fn(async () => day()), createSlot: jest.fn(async () => slot), updateSlot: jest.fn(async () => slot) };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
