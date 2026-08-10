import { beforeEach, expect, jest, test } from "@jest/globals";

type IntentId = "HOST" | "BOOK" | "PLAY";

interface Intent {
  id: IntentId;
  title: string;
  subtitle: string;
  icon: string;
}

interface PageDefinition {
  data: {
    intents: readonly Intent[];
    note: string;
    headerTopPx: number;
    headerRowHeightPx: number;
    headerRightInsetPx: number;
    isCityPickerOpen: boolean;
    currentCityName: string;
    currentStatus: string;
    otherCityName: string;
    otherStatus: string;
  };
  onLoad(options?: { cityPicker?: unknown }): void;
  onChooseIntent(event: { currentTarget?: { dataset?: { intentId?: unknown } } }): void;
  onOpenCityPicker(): void;
  onCloseCityPicker(): void;
  onSelectCurrentCity(): void;
}

interface RuntimePage extends PageDefinition {
  setData(patch: Record<string, unknown>): void;
}

let capturedDefinition: PageDefinition | undefined;

function loadPage(): RuntimePage {
  if (!capturedDefinition) {
    (globalThis as unknown as { Page(value: PageDefinition): void }).Page = (value) => {
      capturedDefinition = value;
    };
    jest.requireActual("./index");
  }

  return {
    ...capturedDefinition!,
    data: { ...capturedDefinition!.data },
    setData(patch) { Object.assign(this.data, patch); },
  };
}

function choose(page: RuntimePage, intentId: unknown) {
  page.onChooseIntent({ currentTarget: { dataset: { intentId } } });
}

beforeEach(() => {
  (globalThis as unknown as { wx: unknown }).wx = {
    getWindowInfo: jest.fn(() => ({ windowWidth: 393, statusBarHeight: 59 })),
    getMenuButtonBoundingClientRect: jest.fn(() => ({
      top: 63,
      bottom: 95,
      left: 295,
      right: 382,
      width: 87,
      height: 32,
    })),
    setStorageSync: jest.fn(),
    reLaunch: jest.fn(),
    showToast: jest.fn(),
  };
});

test("reads the safe header layout and opens the city sheet only from the exact first-entry option", () => {
  const page = loadPage();

  page.onLoad({ cityPicker: "open" });

  expect(page.data.headerTopPx).toBe(59);
  expect(page.data.headerRowHeightPx).toBe(44);
  expect(page.data.headerRightInsetPx).toBe(106);
  expect(page.data.isCityPickerOpen).toBe(true);
});

test("opens, closes, and selects the current city without leaving the fixture", () => {
  const page = loadPage();

  page.onOpenCityPicker();
  expect(page.data.isCityPickerOpen).toBe(true);
  page.onCloseCityPicker();
  expect(page.data.isCityPickerOpen).toBe(false);
  page.onOpenCityPicker();
  page.onSelectCurrentCity();
  expect(page.data.isCityPickerOpen).toBe(false);
});

test("exposes the three equal first-entry intents in HOST, BOOK, PLAY order", () => {
  const page = loadPage();

  expect(page.data.intents).toHaveLength(3);
  expect(page.data.intents.map(({ id }) => id)).toEqual(["HOST", "BOOK", "PLAY"]);
  expect(page.data.intents.map(({ title, subtitle, icon }) => ({ title, subtitle, icon }))).toHaveLength(3);
});

test("BOOK records the selected development intent before entering the venue map", () => {
  const page = loadPage();
  const wx = (globalThis as unknown as { wx: unknown }).wx as {
    setStorageSync: jest.Mock;
    reLaunch: jest.Mock;
  };

  choose(page, "BOOK");

  expect(wx.setStorageSync).toHaveBeenCalledWith("DEV_ONLY_LAST_INTENT", "BOOK");
  expect(wx.reLaunch).toHaveBeenCalledWith({ url: "/pages/venue-map/index" });
  expect(wx.setStorageSync.mock.invocationCallOrder[0]).toBeLessThan(
    wx.reLaunch.mock.invocationCallOrder[0],
  );
});

test.each<IntentId>(["HOST", "PLAY"])("%s records its intent and honestly marks the flow as preview-only", (intentId) => {
  const page = loadPage();
  const wx = (globalThis as unknown as { wx: unknown }).wx as {
    setStorageSync: jest.Mock;
    reLaunch: jest.Mock;
    showToast: jest.Mock;
  };

  choose(page, intentId);

  expect(wx.setStorageSync).toHaveBeenCalledWith("DEV_ONLY_LAST_INTENT", intentId);
  expect(wx.reLaunch).not.toHaveBeenCalled();
  expect(wx.showToast).toHaveBeenCalledWith({ title: "仅视觉预览，当前未开放", icon: "none" });
});

test("ignores invalid intent ids without changing development state or UI", () => {
  const page = loadPage();
  const wx = (globalThis as unknown as { wx: unknown }).wx as {
    setStorageSync: jest.Mock;
    reLaunch: jest.Mock;
    showToast: jest.Mock;
  };

  choose(page, "RETURNING_HOME");

  expect(wx.setStorageSync).not.toHaveBeenCalled();
  expect(wx.reLaunch).not.toHaveBeenCalled();
  expect(wx.showToast).not.toHaveBeenCalled();
});
