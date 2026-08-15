/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { decodeAdminVenueProfile } from "../../domain/venue-profile";
import type { VenueProfileDataSource, VenueProfileMediaCapability } from "../../services/venue-profile";
import { registerVenueProfileDataSource, registerVenueProfileMediaCapability, resetVenueProfileBindingsForTesting } from "../../services/venue-profile";
import type { VenueProfileAttemptStore } from "../../services/venue-profile-attempt-store";
import { registerVenueProfileAttemptStore, resetVenueProfileAttemptStoreForTesting } from "../../services/venue-profile-attempt-store";

let captured: any;
const ready = decodeAdminVenueProfile(JSON.parse(readFileSync("contracts/examples/venue-profile-admin-ready.json", "utf8")));
const reviewing = decodeAdminVenueProfile(JSON.parse(readFileSync("contracts/examples/venue-profile-reviewing.json", "utf8")));
const next = (patch: Record<string, unknown> = {}) => ({ ...ready, revisionVersion: ready.revisionVersion + 1, currentRevision: { ...ready.currentRevision, revisionVersion: ready.currentRevision.revisionVersion + 1 }, ...patch });
function source(): jest.Mocked<VenueProfileDataSource> { return {
  login: jest.fn(async () => undefined), get: jest.fn(async () => ready), save: jest.fn(async () => next()),
  createUploadIntent: jest.fn(async () => ({ imageId: "c3195309-183b-46cc-81e6-2c0977223099", objectKey: "private/image.webp", signedPutUrl: "https://oss.example.com/image", requiredHeaders: { "Content-Type": "image/webp", "Content-Length": "3" }, maximumBytes: 10485760, acceptedMimeTypes: ["image/jpeg", "image/png", "image/webp"] })),
  completeUpload: jest.fn(async () => next()), deleteImage: jest.fn(async () => next()), reorderImages: jest.fn(async () => next()), setCover: jest.fn(async () => next()), retryModeration: jest.fn(async () => next()),
}; }
const media: jest.Mocked<VenueProfileMediaCapability> = { chooseImage: jest.fn(async () => ({ filename: "field.webp", mimeType: "image/webp", byteSize: 3, bytes: new Uint8Array([1, 2, 3]).buffer })), upload: jest.fn(async () => undefined) };
let stored: any = null;
const store: VenueProfileAttemptStore = { load: jest.fn(() => stored), begin: jest.fn((attempt: any) => { if (!stored) stored = structuredClone(attempt); return stored; }), clear: jest.fn(() => { stored = null; }) };
function loadPage() { if (!captured) { (globalThis as any).Page = (value: any) => { captured = value; }; jest.requireActual("./index"); } return { ...captured, data: structuredClone(captured.data), setData(patch: any) { Object.assign(this.data, patch); } }; }

beforeEach(() => {
  resetVenueProfileBindingsForTesting(); resetVenueProfileAttemptStoreForTesting(); stored = null; jest.clearAllMocks();
  registerVenueProfileDataSource(source()); registerVenueProfileMediaCapability(media); registerVenueProfileAttemptStore(store);
  (globalThis as any).wx = { getWindowInfo: jest.fn(() => ({ windowWidth: 375, statusBarHeight: 44 })), getMenuButtonBoundingClientRect: jest.fn(() => ({ top: 48, bottom: 80, left: 278, right: 365, width: 87, height: 32 })), navigateBack: jest.fn(), navigateTo: jest.fn(), redirectTo: jest.fn(), showModal: jest.fn(({ success }: any) => success({ confirm: true })), stopPullDownRefresh: jest.fn() };
});
afterEach(() => { jest.useRealTimers(); });

test("keeps description and facilities drafts independently across a scoped description submission", async () => {
  const api = source(); api.save.mockImplementation(async (attempt) => next({ currentRevision: { ...ready.currentRevision, description: attempt.body.description, facilities: ready.currentRevision.facilities } })); registerVenueProfileDataSource(api);
  const page = loadPage(); await page.onLoad({ venue_id: ready.venue.id });
  page.onDescriptionInput({ detail: { value: "新的介绍" } }); expect(page.data).toMatchObject({ descriptionDirty: true, facilitiesDirty: false });
  page.onToggleFacility({ currentTarget: { dataset: { facilityCode: "LOCKERS" } } }); expect(page.data).toMatchObject({ descriptionDirty: true, facilitiesDirty: true });
  await page.onSubmitDescription();
  expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ scope: "description", body: expect.objectContaining({ description: "新的介绍", facilities: ready.currentRevision.facilities }) }));
  expect(page.data).toMatchObject({ descriptionDirty: false, facilitiesDirty: true });
  page.onUnload();
});

test("saves facilities with authoritative description while content review keeps chips editable", async () => {
  const api = source(); api.get.mockResolvedValue(reviewing); api.save.mockImplementation(async (attempt) => ({ ...reviewing, currentRevision: { ...reviewing.currentRevision, facilities: attempt.body.facilities } })); registerVenueProfileDataSource(api);
  const page = loadPage(); await page.onLoad({ venue_id: reviewing.venue.id }); page.onToggleFacility({ currentTarget: { dataset: { facilityCode: "LOCKERS" } } });
  expect(page.data).toMatchObject({ facilitiesDirty: true, facilitySaveBlockedReason: expect.any(String) });
  await page.onSaveFacilities(); expect(api.save).not.toHaveBeenCalled();
  page.applyProfile({ ...ready, currentRevision: { ...ready.currentRevision, description: "authoritative" } }); await page.onSaveFacilities();
  expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ scope: "facilities", body: expect.objectContaining({ description: "authoritative", facilities: expect.arrayContaining(["LOCKERS"]) }) }));
});

test("regional refresh preserves both drafts, clears regional errors, and pull-down always stops", async () => {
  const api = source(); registerVenueProfileDataSource(api); const page = loadPage(); await page.onLoad({ venue_id: ready.venue.id });
  page.onDescriptionInput({ detail: { value: "本地介绍" } }); page.onToggleFacility({ currentTarget: { dataset: { facilityCode: "LOCKERS" } } }); page.setData({ imageRefreshError: "图片刷新失败", descriptionRefreshError: "介绍刷新失败" });
  await page.onPullDownRefresh();
  expect(api.get).toHaveBeenCalledTimes(2); expect(wx.stopPullDownRefresh).toHaveBeenCalledTimes(1); expect(page.data).toMatchObject({ description: "本地介绍", facilitiesDirty: true, imageRefreshError: "", descriptionRefreshError: "" });
  api.get.mockRejectedValueOnce(new Error("network")); await page.onPullDownRefresh(); expect(wx.stopPullDownRefresh).toHaveBeenCalledTimes(2);
});

test("regional refresh suppresses concurrent duplicate GETs and onShow is inert", async () => {
  const api = source(); api.get.mockResolvedValue(reviewing); registerVenueProfileDataSource(api); const page = loadPage(); await page.onLoad({ venue_id: ready.venue.id }); page.onShow(); expect(api.get).toHaveBeenCalledTimes(1);
  let resolve!: (value: typeof reviewing) => void; api.get.mockImplementationOnce(() => new Promise((done) => { resolve = done; })); const first = page.onRefreshImageStatus(); const duplicate = page.onRefreshDescriptionStatus(); expect(api.get).toHaveBeenCalledTimes(2); resolve(reviewing); await Promise.all([first, duplicate]);
});

test("schedules one replacing 5-second authoritative refresh for image and description submissions and cancels on unload", async () => {
  jest.useFakeTimers(); const api = source(); registerVenueProfileDataSource(api); const page = loadPage(); await page.onLoad({ venue_id: ready.venue.id });
  await page.onChooseImage(); await page.onChooseImage(); expect(api.get).toHaveBeenCalledTimes(1); await jest.advanceTimersByTimeAsync(5000); expect(api.get).toHaveBeenCalledTimes(2);
  page.onDescriptionInput({ detail: { value: "定时介绍" } }); await page.onSubmitDescription(); await page.onSubmitDescription(); await jest.advanceTimersByTimeAsync(5000); expect(api.get).toHaveBeenCalledTimes(3);
  await page.onChooseImage(); page.onUnload(); await jest.advanceTimersByTimeAsync(5000); expect(api.get).toHaveBeenCalledTimes(3);
});

test("does not map old published URLs onto pending or rejected draft images", async () => {
  const page = loadPage(); const unsafe = { ...ready, currentRevision: { ...ready.currentRevision, summaryState: "REVIEWING" as const, images: ready.currentRevision.images.map((image) => ({ ...image, state: "REVIEWING" as const })) } }; page.applyProfile(unsafe); expect(page.data.images[0].url).toBe("");
  page.applyProfile(ready); expect(page.data.images[0].url).toBe(ready.published.images[0].url);
});

test("production markup binds regional actions and facilities-only footer", () => {
  const markup = readFileSync("miniprogram/pages/venue-profile/index.wxml", "utf8"); const json = readFileSync("miniprogram/pages/venue-profile/index.json", "utf8");
  for (const handler of ["onRefreshImageStatus", "onRefreshDescriptionStatus", "onSubmitDescription", "onSaveFacilities", "onRetryUnknown"]) expect(markup).toContain(handler);
  expect(markup).toContain("保存场馆设施"); expect(markup).not.toContain("保存场馆资料"); expect(markup).not.toContain("onRefreshReviewStatus"); expect(json).toContain('"enablePullDownRefresh":true');
});

test("facility buttons retain their centered 88rpx touch target", () => {
  const styles = readFileSync("miniprogram/pages/venue-profile/index.wxss", "utf8"); expect(styles).toMatch(/\.venue-profile__chip\s*\{[^}]*display:flex;[^}]*height:88rpx;[^}]*align-items:center;[^}]*justify-content:center;/);
});
