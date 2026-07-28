import { beforeEach, expect, jest, test } from "@jest/globals";

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
