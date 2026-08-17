/// <reference types="node" />

import { beforeEach, expect, jest, test } from "@jest/globals";

interface PageData {
  selectedImageId: string;
  selectedImage: { id: string; cover: boolean };
  profile: { venueId: string; name: string; description: string; images: { id: string; cover: boolean }[] };
}
interface PageDefinition {
  data: PageData;
  onLoad(options?: { venue_id?: unknown }): void;
  onSelectGallery(event: { currentTarget?: { dataset?: { imageId?: unknown } } }): void;
  onViewAvailability(): void;
}
interface RuntimePage extends PageDefinition { setData(patch: Partial<PageData>): void }

let capturedDefinition: PageDefinition | undefined;

function loadPage(): RuntimePage {
  if (!capturedDefinition) {
    (globalThis as unknown as { Page(value: PageDefinition): void }).Page = (value) => { capturedDefinition = value; };
    jest.requireActual("./index");
  }
  return {
    ...capturedDefinition!,
    data: JSON.parse(JSON.stringify(capturedDefinition!.data)) as PageData,
    setData(patch) { Object.assign(this.data, patch); },
  };
}

beforeEach(() => {
  (globalThis as unknown as { wx: unknown }).wx = {
    getWindowInfo: jest.fn(() => ({ windowWidth: 375, statusBarHeight: 44 })),
    getMenuButtonBoundingClientRect: jest.fn(() => ({ top: 48, left: 278, width: 87, height: 32 })),
    navigateTo: jest.fn(),
    navigateBack: jest.fn(),
  };
});

test("public page reads only the last approved whole revision", () => {
  const page = loadPage();
  page.onLoad();
  expect(page.data.profile.images).toHaveLength(3);
  expect(page.data.profile.images[0].cover).toBe(true);
  expect(page.data.profile.description).toContain("公开资料仅展示已通过整版审核的内容");
  expect(page.data.profile.description).not.toContain("新增夜场照明与淋浴设施");
});

test("gallery selection changes the visible image", () => {
  const page = loadPage();
  page.onLoad();
  const imageId = page.data.profile.images[2].id;
  page.onSelectGallery({ currentTarget: { dataset: { imageId } } });
  expect(page.data.selectedImageId).toBe(imageId);
  expect(page.data.selectedImage.id).toBe(imageId);
});

test("查看可订时段 preserves the selected venue inside the booking journey", () => {
  const page = loadPage();
  page.onLoad({ venue_id: "venue-tianjin-olympic" });
  expect(page.data.profile).toMatchObject({
    venueId: "venue-tianjin-olympic",
    name: "天津奥体足球公园",
  });
  page.onViewAvailability();
  expect(wx.navigateTo).toHaveBeenCalledWith({
    url: "/pages/availability/index?venueId=venue-tianjin-olympic",
  });
});

test("controller exposes no contact action", () => {
  const page = loadPage() as unknown as Record<string, unknown>;
  expect(Object.keys(page).filter((key) => /phone|contact|chat|call|link/i.test(key))).toEqual([]);
});
