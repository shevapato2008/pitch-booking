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
    navigateBack: jest.fn(async () => undefined), showToast: jest.fn(),
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
  expect(markup).not.toContain("仅视觉预览"); expect(markup).not.toContain("onPreview");
  for (const handler of ["onBack", "onOpenCalendar", "onSelectDate", "onConfirmDate", "onOpenPitchPicker", "onSelectPitch", "onSlotTap", "onOpenCreate", "onStartTimeChange", "onEndTimeChange", "onPriceInput", "onStatusSelect", "onCloseOverlay", "onSaveSlot", "onRetryRead", "onRetryMutation"]) expect(markup).toContain(handler);
});

function sourceHarness(): jest.Mocked<InventoryDataSource> {
  return { login: jest.fn(async () => undefined), getDay: jest.fn(async () => day()), createSlot: jest.fn(async () => slot), updateSlot: jest.fn(async () => slot) };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
