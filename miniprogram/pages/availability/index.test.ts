/// <reference types="node" />

import { beforeEach, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { decodeAvailability } from "../../domain/decoders";

type PageDefinition = Record<string, unknown> & { data: Record<string, unknown> };
type RuntimePage = PageDefinition & { setData(patch: Record<string, unknown>): void };

let capturedDefinition: PageDefinition | undefined;
function loadPage(): RuntimePage {
  let definition = capturedDefinition;
  if (!definition) {
    (globalThis as unknown as { Page(value: PageDefinition): void }).Page = (value) => { capturedDefinition = value; };
    jest.requireActual("./index");
    definition = capturedDefinition;
  }
  if (!definition) throw new Error("PAGE_NOT_CAPTURED");
  return {
    ...definition,
    data: { ...definition.data },
    setData(patch: Record<string, unknown>) { Object.assign(this.data, patch); },
  } as RuntimePage;
}

const call = (page: RuntimePage, method: string, ...args: unknown[]) =>
  (page[method] as (...values: unknown[]) => unknown).apply(page, args);

beforeEach(() => {
  (globalThis as unknown as { wx: unknown }).wx = undefined;
});

test("selected-slot CTA navigates with only the encoded slot_id", async () => {
  const urls: string[] = [];
  (globalThis as unknown as { wx: { navigateTo(input: { url: string }): Promise<void> } }).wx = {
    async navigateTo({ url }) { urls.push(url); },
  };
  const page = loadPage();
  page.data.selectedSlotId = "slot/with?reserved&characters";

  await call(page, "onConfirmSlot");

  expect(urls).toEqual([
    "/pages/booking-confirmation/index?slot_id=slot%2Fwith%3Freserved%26characters",
  ]);
});

test("CTA does nothing until a slot is selected", async () => {
  let calls = 0;
  (globalThis as unknown as { wx: { navigateTo(): Promise<void> } }).wx = {
    async navigateTo() { calls += 1; },
  };
  const page = loadPage();
  page.data.selectedSlotId = null;

  await call(page, "onConfirmSlot");

  expect(calls).toBe(0);
});

test("disabled online booking keeps browsing visible but never navigates to checkout", async () => {
  let calls = 0;
  (globalThis as unknown as { wx: { navigateTo(): Promise<void> } }).wx = {
    async navigateTo() { calls += 1; },
  };
  const page = loadPage();
  page.data.onlineBookingEnabled = false;
  page.data.selectedSlotId = "slot-disabled";

  await call(page, "onConfirmSlot");

  expect(calls).toBe(0);
  expect(page.data.navigationError).toBe("");
});

test("only enabled booking can select an available slot, and selection remains toggleable", () => {
  const page = loadPage();
  const availability = decodeAvailability(jest.requireActual("../../../contracts/examples/availability-ready.json"));
  const available = availability.pitchGroups.flatMap(({ slots }) => slots).find(({ status }) => status === "AVAILABLE")!;
  page.data.availability = availability;
  page.data.selectedSlotId = null;
  page.data.onlineBookingEnabled = false;
  call(page, "onSlotSelect", { detail: { slotId: available.id } });
  expect(page.data.selectedSlotId).toBeNull();
  page.data.onlineBookingEnabled = true;
  call(page, "onSlotSelect", { detail: { slotId: available.id } });
  expect(page.data.selectedSlotId).toBe(available.id);
  call(page, "onSlotSelect", { detail: { slotId: available.id } });
  expect(page.data.selectedSlotId).toBeNull();
});

test("navigation rejection is handled and keeps the selected slot retryable", async () => {
  (globalThis as unknown as { wx: { navigateTo(): Promise<void> } }).wx = {
    async navigateTo() { throw new Error("navigation failed"); },
  };
  const page = loadPage();
  page.data.selectedSlotId = "slot-retry";

  await expect(call(page, "onConfirmSlot")).resolves.toBeUndefined();

  expect(page.data.selectedSlotId).toBe("slot-retry");
  expect(page.data.navigationError).toBe("页面打开失败，请重试。");
});

test("the selected date remains visible after availability reload remounts the date strip", () => {
  const template = readFileSync("miniprogram/components/date-strip/index.wxml", "utf8");

  expect(template).toContain('scroll-into-view="date-{{selectedDate}}"');
  expect(template).toContain('id="date-{{item.date}}"');
});

test("disabled native slot buttons retain semantic dark colors and separated price/status labels", () => {
  const template = readFileSync("miniprogram/components/slot-grid/index.wxml", "utf8");
  const styles = readFileSync("miniprogram/components/slot-grid/index.wxss", "utf8");
  expect(template).toContain('<view class="slot-meta">');
  for (const state of ["available", "expired", "booked", "closed", "temporarily-locked", "selected"]) {
    expect(styles).toContain(`.slot.slot--${state}.slot--disabled`);
  }
  expect(template).toContain('disabled="{{disabled || !slot.isSelectable}}"');
});

test("globally disabled availability is explicitly read-only, not a green booking promise", () => {
  const template = readFileSync("miniprogram/components/slot-grid/index.wxml", "utf8");
  const styles = readFileSync("miniprogram/components/slot-grid/index.wxss", "utf8");
  const page = readFileSync("miniprogram/pages/availability/index.wxml", "utf8");
  const config = JSON.parse(readFileSync("miniprogram/pages/availability/index.json", "utf8"));
  expect(template).toContain("disabled && slot.isSelectable ? 'slot--readonly' : ''");
  // Both the visible status and accessible label must tell the same truth.
  expect(template.match(/disabled && slot\.isSelectable \? '空闲 · 只读' : slot\.statusLabel/g)).toHaveLength(2);
  expect(styles).toMatch(/\.slot\.slot--disabled\.slot--readonly\s*\{[^}]*color:\s*#A4B5C8;[^}]*background:\s*#152539;/s);
  expect(styles.lastIndexOf(".slot.slot--disabled.slot--readonly")).toBeGreaterThan(styles.lastIndexOf(".slot.slot--selected.slot--disabled"));
  expect(page).toContain("仅展示场地库存，暂不能选择或下单。");
  expect(config.navigationBarTitleText).toBe("场地时段");
});

test("the selected-slot CTA uses a safe-area fixed action bar without covering content", () => {
  const template = readFileSync("miniprogram/pages/availability/index.wxml", "utf8");
  const styles = readFileSync("miniprogram/pages/availability/index.wxss", "utf8");

  expect(template).toContain("availability-content--with-action");
  expect(template).toContain('class="availability-action-bar u-surface"');
  expect(template).toContain('class="availability-confirm u-control u-radius-md ng-button ng-button--primary"');
  expect(styles).toMatch(/\.availability-action-bar\s*\{[^}]*position:\s*fixed;[^}]*bottom:\s*0;[^}]*env\(safe-area-inset-bottom/s);
  expect(styles).toMatch(/\.availability-confirm\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;[^}]*justify-content:\s*center;/s);
  expect(styles).toMatch(/\.availability-content--with-action\s*\{[^}]*padding-bottom:\s*calc\(/s);
});
