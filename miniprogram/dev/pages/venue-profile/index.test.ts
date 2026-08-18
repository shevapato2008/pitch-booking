/// <reference types="node" />

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const stateIds = [
  "ready", "uploading", "image-reviewing", "image-rejected", "description-reviewing",
  "description-rejected", "pending-manual", "load-error", "save-unknown",
] as const;

interface ImageItem { id: string; cover: boolean }
interface Profile { description: string; facilities: string[]; images: ImageItem[] }
interface PageData {
  visualState: string;
  workingProfile: Profile | null;
  descriptionCount: number;
  imageActionsEnabled: boolean;
  headerTopPx: number;
  headerRowHeightPx: number;
  headerRightInsetPx: number;
}
interface DatasetEvent { currentTarget?: { dataset?: Record<string, unknown> } }
interface PageDefinition {
  data: PageData;
  onLoad(options?: { state?: unknown }): void;
  onChooseImage(): void;
  onRetryUpload(): void;
  onRemoveImage(event: DatasetEvent): void;
  onReorderImage(event: DatasetEvent): void;
  onSetCover(event: DatasetEvent): void;
  onRetryModeration(): void;
  onDescriptionInput(event: { detail?: { value?: unknown } }): void;
  onToggleFacility(event: DatasetEvent): void;
  onSave(): void;
  onReload(): void;
  onRetryUnknown(): void;
  onStateAction(event: DatasetEvent): void;
}
interface RuntimePage extends PageDefinition { setData(patch: Partial<PageData>): void }

let capturedDefinition: PageDefinition | undefined;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function loadPage(): RuntimePage {
  if (!capturedDefinition) {
    (globalThis as unknown as { Page(value: PageDefinition): void }).Page = (value) => { capturedDefinition = value; };
    jest.requireActual("./index");
  }
  return {
    ...capturedDefinition!,
    data: clone(capturedDefinition!.data),
    setData(patch) { Object.assign(this.data, patch); },
  };
}

beforeEach(() => {
  (globalThis as unknown as { wx: unknown }).wx = {
    getWindowInfo: jest.fn(() => ({ windowWidth: 375, statusBarHeight: 44 })),
    getMenuButtonBoundingClientRect: jest.fn(() => ({ top: 48, left: 278, width: 87, height: 32 })),
    chooseMedia: jest.fn(({ success }: { success(result: unknown): void }) => success({ tempFiles: [{ tempFilePath: "/tmp/venue.jpg" }] })),
    navigateTo: jest.fn(),
    navigateBack: jest.fn(),
  };
});

describe.each(stateIds)("admin state %s", (state) => {
  test("loads the deterministic approved fixture", () => {
    const page = loadPage();
    page.onLoad({ state });
    expect(page.data.visualState).toBe(state);
    expect(page.data.headerTopPx).toBe(44);
    expect(page.data.headerRowHeightPx).toBe(44);
    expect(page.data.headerRightInsetPx).toBe(105);
    expect(page.data.workingProfile === null).toBe(state === "load-error");
    expect(page.data.imageActionsEnabled).toBe(state === "ready");
  });
});

test("invalid state falls back to ready", () => {
  const page = loadPage();
  page.onLoad({ state: "public-published" });
  expect(page.data.visualState).toBe("ready");
});

test("choosing and retrying an image enters an explicit uploading state", () => {
  const page = loadPage();
  page.onLoad();
  page.onChooseImage();
  expect(page.data.visualState).toBe("uploading");
  const images = page.data.workingProfile?.images ?? [];
  expect(images[images.length - 1]?.id).toBe("image-local-upload");
  page.onLoad({ state: "image-rejected" });
  page.onRetryUpload();
  expect(page.data.visualState).toBe("uploading");
});

test("delete, reorder, and set-cover visibly mutate working images", () => {
  const page = loadPage();
  page.onLoad();
  const before = page.data.workingProfile!.images.map(({ id }) => id);
  page.onReorderImage({ currentTarget: { dataset: { imageId: before[2], direction: -1 } } });
  expect(page.data.workingProfile!.images.map(({ id }) => id)).toEqual([before[0], before[2], before[1], before[3]]);
  page.onSetCover({ currentTarget: { dataset: { imageId: before[2] } } });
  expect(page.data.workingProfile!.images[0]).toMatchObject({ id: before[2], cover: true });
  expect(page.data.workingProfile!.images.filter(({ cover }) => cover)).toHaveLength(1);
  page.onRemoveImage({ currentTarget: { dataset: { imageId: before[1] } } });
  expect(page.data.workingProfile!.images.map(({ id }) => id)).not.toContain(before[1]);
});

test.each(["image-rejected", "description-rejected"] as const)("%s keeps image controls noninteractive while text remains editable", (state) => {
  const page = loadPage();
  page.onLoad({ state });
  const before = JSON.stringify(page.data.workingProfile!.images);
  const imageId = page.data.workingProfile!.images[1].id;
  page.onChooseImage();
  page.onRemoveImage({ currentTarget: { dataset: { imageId } } });
  page.onReorderImage({ currentTarget: { dataset: { imageId, direction: 1 } } });
  page.onSetCover({ currentTarget: { dataset: { imageId } } });
  expect(page.data.visualState).toBe(state);
  expect(JSON.stringify(page.data.workingProfile!.images)).toBe(before);
  expect(wx.chooseMedia).not.toHaveBeenCalled();
});

test("moderation retry is explicit and preserves the working draft", () => {
  const page = loadPage();
  page.onLoad({ state: "image-rejected" });
  const profile = clone(page.data.workingProfile);
  page.onRetryModeration();
  expect(page.data.visualState).toBe("image-reviewing");
  expect(page.data.workingProfile).toEqual(profile);
});

test("description editing enforces 300 Unicode code points without splitting non-BMP text", () => {
  const page = loadPage();
  page.onLoad({ state: "description-rejected" });
  page.onDescriptionInput({ detail: { value: `${"足".repeat(299)}⚽尾` } });
  expect(Array.from(page.data.workingProfile!.description)).toHaveLength(300);
  expect(page.data.workingProfile!.description.endsWith("⚽")).toBe(true);
  expect(page.data.descriptionCount).toBe(300);
});

test("each fixed facility can be toggled independently", () => {
  const page = loadPage();
  page.onLoad();
  const codes = [
    "PARKING", "TOILET", "CHANGING_ROOM", "SHOWER", "LOCKERS", "DRINKING_WATER",
    "BEVERAGE_SALES", "EQUIPMENT_RENTAL", "REST_AREA", "FIRST_AID", "AED", "INDOOR",
    "OUTDOOR", "COVERED", "LIGHTING", "ARTIFICIAL_TURF", "NATURAL_GRASS",
  ];
  for (const facilityCode of codes) {
    const selected = page.data.workingProfile!.facilities.includes(facilityCode);
    page.onToggleFacility({ currentTarget: { dataset: { facilityCode } } });
    expect(page.data.workingProfile!.facilities.includes(facilityCode)).toBe(!selected);
  }
});

test("save and unknown-result retry retain the exact working draft", () => {
  const page = loadPage();
  page.onLoad();
  page.onDescriptionInput({ detail: { value: "保留到权威结果确认的草稿" } });
  page.onToggleFacility({ currentTarget: { dataset: { facilityCode: "LOCKERS" } } });
  const profile = clone(page.data.workingProfile);
  page.onSave();
  expect(page.data.visualState).toBe("save-unknown");
  expect(page.data.workingProfile).toEqual(profile);
  page.onRetryUnknown();
  expect(page.data.visualState).toBe("description-reviewing");
  expect(page.data.workingProfile).toEqual(profile);
});

test("only truthful reload resets the full working draft", () => {
  const page = loadPage();
  page.onLoad({ state: "load-error" });
  page.onReload();
  expect(page.data.visualState).toBe("ready");
  expect(page.data.workingProfile?.description).toContain("新增夜场照明与淋浴设施");
  expect(page.data.workingProfile?.images).toHaveLength(4);
});

test("approved state buttons always produce their declared local state or real navigation", () => {
  const page = loadPage();
  page.onLoad({ state: "uploading" });
  page.onStateAction({ currentTarget: { dataset: { operation: "GET_IMAGE_UPLOAD", nextState: "image-reviewing" } } });
  expect(page.data.visualState).toBe("image-reviewing");
  page.onStateAction({ currentTarget: { dataset: { operation: "VIEW_PUBLIC_PROFILE", nextState: "public-published" } } });
  expect((wx.navigateTo as jest.Mock)).toHaveBeenCalledWith({
    url: "/dev/pages/venue-profile-public/index?venue_id=venue-bohai-yuanfeng",
  });
});
