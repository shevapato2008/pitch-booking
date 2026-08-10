import { beforeEach, expect, jest, test } from "@jest/globals";

type IntentId = "HOST" | "BOOK" | "PLAY";

interface Intent {
  id: IntentId;
  title: string;
}

interface PageDefinition {
  data: {
    intents: readonly Intent[];
    activeIntent: IntentId;
    recentVenueName: string;
    recentSummary: string;
    pendingOrderSummary: string;
    pendingOrderDetail: string;
  };
  onLoad(query?: { intent?: unknown }): void;
  onOpenIntent(event: { currentTarget?: { dataset?: { intentId?: unknown } } }): void;
  onContinueLast(): void;
  onOpenMy(): void;
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

function openIntent(page: RuntimePage, intentId: unknown) {
  page.onOpenIntent({ currentTarget: { dataset: { intentId } } });
}

beforeEach(() => {
  (globalThis as unknown as { wx: unknown }).wx = {
    getStorageSync: jest.fn(),
    reLaunch: jest.fn(),
    showToast: jest.fn(),
  };
});

test("keeps only shortcut rendering fields in page data", () => {
  const page = loadPage();

  expect(page.data.intents).toEqual([
    { id: "HOST", title: "出租场地" },
    { id: "BOOK", title: "租赁场地" },
    { id: "PLAY", title: "找球踢" },
  ]);
});

test("uses the valid PLAY query as the returning home active intent", () => {
  const page = loadPage();

  page.onLoad({ intent: "PLAY" });

  expect(page.data.activeIntent).toBe("PLAY");
});

test("falls back to a valid stored intent when the query is invalid", () => {
  const page = loadPage();
  const wx = (globalThis as unknown as { wx: unknown }).wx as { getStorageSync: jest.Mock };
  wx.getStorageSync.mockReturnValue("HOST");

  page.onLoad({ intent: "NOT_AN_INTENT" });

  expect(wx.getStorageSync).toHaveBeenCalledWith("DEV_ONLY_LAST_INTENT");
  expect(page.data.activeIntent).toBe("HOST");
});

test("uses BOOK when neither query nor storage has a valid intent", () => {
  const page = loadPage();
  const wx = (globalThis as unknown as { wx: unknown }).wx as { getStorageSync: jest.Mock };
  wx.getStorageSync.mockReturnValue("");

  page.onLoad({ intent: "RETURNING_HOME" });

  expect(page.data.activeIntent).toBe("BOOK");
});

test("BOOK opens the venue map", () => {
  const page = loadPage();
  const wx = (globalThis as unknown as { wx: unknown }).wx as { reLaunch: jest.Mock };

  openIntent(page, "BOOK");

  expect(wx.reLaunch).toHaveBeenCalledWith({ url: "/pages/venue-map/index" });
});

test.each<IntentId>(["HOST", "PLAY"])("%s is honestly marked preview-only", (intentId) => {
  const page = loadPage();
  const wx = (globalThis as unknown as { wx: unknown }).wx as {
    reLaunch: jest.Mock;
    showToast: jest.Mock;
  };

  openIntent(page, intentId);

  expect(wx.reLaunch).not.toHaveBeenCalled();
  expect(wx.showToast).toHaveBeenCalledWith({ title: "仅视觉预览，当前未开放", icon: "none" });
});

test("invalid intents do nothing", () => {
  const page = loadPage();
  const wx = (globalThis as unknown as { wx: unknown }).wx as {
    reLaunch: jest.Mock;
    showToast: jest.Mock;
  };

  openIntent(page, "RETURNING_HOME");

  expect(wx.reLaunch).not.toHaveBeenCalled();
  expect(wx.showToast).not.toHaveBeenCalled();
});

test("continue last opens the venue map", () => {
  const page = loadPage();
  const wx = (globalThis as unknown as { wx: unknown }).wx as { reLaunch: jest.Mock };

  page.onContinueLast();

  expect(wx.reLaunch).toHaveBeenCalledWith({ url: "/pages/venue-map/index" });
});

test("my is honestly marked preview-only", () => {
  const page = loadPage();
  const wx = (globalThis as unknown as { wx: unknown }).wx as { showToast: jest.Mock };

  page.onOpenMy();

  expect(wx.showToast).toHaveBeenCalledWith({ title: "仅视觉预览，当前未开放", icon: "none" });
});
