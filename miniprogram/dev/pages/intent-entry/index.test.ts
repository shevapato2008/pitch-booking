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
  };
  onChooseIntent(event: { currentTarget?: { dataset?: { intentId?: unknown } } }): void;
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
    setStorageSync: jest.fn(),
    reLaunch: jest.fn(),
    showToast: jest.fn(),
  };
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
