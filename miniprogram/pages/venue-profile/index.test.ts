/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { decodeAdminVenueProfile } from "../../domain/venue-profile";
import type { VenueProfileDataSource, VenueProfileMediaCapability } from "../../services/venue-profile";
import { registerVenueProfileDataSource, registerVenueProfileMediaCapability, resetVenueProfileBindingsForTesting } from "../../services/venue-profile";
import type { VenueProfileAttemptStore } from "../../services/venue-profile-attempt-store";
import { registerVenueProfileAttemptStore, resetVenueProfileAttemptStoreForTesting } from "../../services/venue-profile-attempt-store";

let captured: any;
const ready = decodeAdminVenueProfile(JSON.parse(readFileSync("contracts/examples/venue-profile-admin-ready.json", "utf8")));
const next = (patch: Record<string, unknown> = {}) => ({ ...ready, revisionVersion: ready.revisionVersion + 1, currentRevision: { ...ready.currentRevision, revisionVersion: ready.currentRevision.revisionVersion + 1 }, ...patch });
function source(): jest.Mocked<VenueProfileDataSource> {
  return {
    login: jest.fn(async () => undefined), get: jest.fn(async () => ready), save: jest.fn(async () => next()),
    createUploadIntent: jest.fn(async () => ({ imageId: "c3195309-183b-46cc-81e6-2c0977223099", objectKey: "private/image.webp", signedPutUrl: "https://oss.example.com/image", requiredHeaders: { "Content-Type": "image/webp", "Content-Length": "3" }, maximumBytes: 10485760, acceptedMimeTypes: ["image/jpeg", "image/png", "image/webp"] })),
    completeUpload: jest.fn(async () => next()), deleteImage: jest.fn(async () => next()), reorderImages: jest.fn(async () => next()), setCover: jest.fn(async () => next()), retryModeration: jest.fn(async () => next()),
  };
}
const media: jest.Mocked<VenueProfileMediaCapability> = { chooseImage: jest.fn(async () => ({ filename: "field.webp", mimeType: "image/webp", byteSize: 3, bytes: new Uint8Array([1, 2, 3]).buffer })), upload: jest.fn(async () => undefined) };
let stored: any = null;
const store: VenueProfileAttemptStore = { load: jest.fn(() => stored), begin: jest.fn((attempt: any) => { if (!stored) stored = structuredClone(attempt); return stored; }), clear: jest.fn(() => { stored = null; }) };
function loadPage() { if (!captured) { (globalThis as any).Page = (value: any) => { captured = value; }; jest.requireActual("./index"); } return { ...captured, data: structuredClone(captured.data), setData(patch: any) { Object.assign(this.data, patch); } }; }

beforeEach(() => {
  resetVenueProfileBindingsForTesting(); resetVenueProfileAttemptStoreForTesting(); stored = null; jest.clearAllMocks();
  registerVenueProfileDataSource(source()); registerVenueProfileMediaCapability(media); registerVenueProfileAttemptStore(store);
  (globalThis as any).wx = { getWindowInfo: jest.fn(() => ({ windowWidth: 375, statusBarHeight: 44 })), getMenuButtonBoundingClientRect: jest.fn(() => ({ top: 48, bottom: 80, left: 278, right: 365, width: 87, height: 32 })), navigateBack: jest.fn(), navigateTo: jest.fn(), redirectTo: jest.fn(), showToast: jest.fn(), showModal: jest.fn(({ success }: any) => success({ confirm: true })) };
});

test("loads the authoritative profile and preserves the approved hierarchy", async () => {
  const api = source(); registerVenueProfileDataSource(api); const page = loadPage(); await page.onLoad({ venue_id: ready.venue.id });
  expect(api.login).toHaveBeenCalled(); expect(api.get).toHaveBeenCalledWith(ready.venue.id);
  expect(page.data).toMatchObject({ venueName: "渤海元丰足球场", mode: "ready", description: ready.currentRevision.description, descriptionCount: Array.from(ready.currentRevision.description).length, imageCount: 2 });
});

test("edits 300 code points and saves facilities plus description atomically", async () => {
  const api = source(); api.save.mockImplementation(async (attempt) => next({ currentRevision: { ...ready.currentRevision, revisionVersion: ready.currentRevision.revisionVersion + 1, description: attempt.body.description, facilities: attempt.body.facilities } })); registerVenueProfileDataSource(api); const page = loadPage(); await page.onLoad({ venue_id: ready.venue.id });
  page.onDescriptionInput({ detail: { value: `${"足".repeat(299)}⚽尾` } }); page.onToggleFacility({ currentTarget: { dataset: { facilityCode: "LOCKERS" } } }); await page.onSave();
  expect(Array.from(page.data.description)).toHaveLength(300);
  expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ kind: "save", venueId: ready.venue.id, body: expect.objectContaining({ description: `${"足".repeat(299)}⚽`, facilities: expect.arrayContaining(["LOCKERS"]) }), idempotencyKey: expect.any(String) }));
  expect(page.data.dirty).toBe(false);
});

test("uploads to the signed URL then completes, and image controls call their matching endpoints", async () => {
  const api = source(); registerVenueProfileDataSource(api); const page = loadPage(); await page.onLoad({ venue_id: ready.venue.id }); await page.onChooseImage();
  expect(api.createUploadIntent).toHaveBeenCalledTimes(1); expect(media.upload).toHaveBeenCalledWith("https://oss.example.com/image", expect.any(ArrayBuffer), { "Content-Type": "image/webp", "Content-Length": "3" }); expect(api.completeUpload).toHaveBeenCalledTimes(1);
  const gallery = ready.currentRevision.images[1].id; await page.onSetCover({ currentTarget: { dataset: { imageId: gallery } } }); const third = { ...page.data.images[1], id: "c3195309-183b-46cc-81e6-2c0977223003" }; page.setData({ images: [...page.data.images, third], imageCount: 3 }); await page.onReorderImage({ currentTarget: { dataset: { imageId: third.id, direction: -1 } } }); await page.onRemoveImage({ currentTarget: { dataset: { imageId: gallery } } }); await page.onRetryModeration({ currentTarget: { dataset: { itemId: gallery } } });
  expect(api.setCover).toHaveBeenCalledTimes(1); expect(api.reorderImages).toHaveBeenCalledTimes(1); expect(api.deleteImage).toHaveBeenCalledTimes(1); expect(api.retryModeration).toHaveBeenCalledTimes(1);
  expect(api.reorderImages.mock.calls[0][0].imageIds[0]).toBe(ready.currentRevision.images[0].id);
});

test("replays an unknown upload intent with its original key and metadata before completing", async () => {
  const api = source(); api.createUploadIntent.mockRejectedValueOnce(Object.assign(new Error(), { code: "VENUE_PROFILE_RESULT_UNKNOWN" })); registerVenueProfileDataSource(api);
  const page = loadPage(); await page.onLoad({ venue_id: ready.venue.id }); await page.onChooseImage();
  const original = api.createUploadIntent.mock.calls[0][0]; expect(page.data.mode).toBe("save-unknown");
  await page.onRetryUnknown();
  expect(api.createUploadIntent.mock.calls[1][0]).toEqual(original); expect(media.chooseImage).toHaveBeenCalledTimes(2); expect(media.upload).toHaveBeenCalledTimes(1); expect(api.completeUpload).toHaveBeenCalledTimes(1); expect(stored).toBeNull();
});

test("keeps an unknown write for an exact same-key retry and reloads version conflicts", async () => {
  const api = source(); api.save.mockRejectedValueOnce(Object.assign(new Error(), { code: "VENUE_PROFILE_RESULT_UNKNOWN" })).mockResolvedValueOnce(next()); registerVenueProfileDataSource(api);
  const page = loadPage(); await page.onLoad({ venue_id: ready.venue.id }); page.onDescriptionInput({ detail: { value: "需要可靠重试的介绍" } }); await page.onSave();
  expect(page.data.mode).toBe("save-unknown"); const first = api.save.mock.calls[0][0]; await page.onRetryUnknown(); expect(api.save.mock.calls[1][0]).toEqual(first);
  api.save.mockRejectedValueOnce(Object.assign(new Error(), { code: "VENUE_PROFILE_VERSION_CONFLICT" })); page.onDescriptionInput({ detail: { value: "冲突" } }); await page.onSave(); expect(api.get).toHaveBeenCalledTimes(2);
});

test("navigation and back-with-unsaved-confirmation all target real routes", async () => {
  const page = loadPage(); await page.onLoad({ venue_id: ready.venue.id }); page.onDescriptionInput({ detail: { value: "未保存" } }); page.onBack();
  expect(wx.showModal).toHaveBeenCalled(); expect(wx.navigateBack).toHaveBeenCalled();
  page.onNavigateWorkbench({ currentTarget: { dataset: { target: "profile" } } }); page.onNavigateWorkbench({ currentTarget: { dataset: { target: "pitches" } } }); page.onNavigateWorkbench({ currentTarget: { dataset: { target: "inventory" } } });
  expect(wx.redirectTo).toHaveBeenCalledWith({ url: `/pages/venue-profile/index?venue_id=${ready.venue.id}` });
  expect(wx.navigateTo).toHaveBeenCalledWith({ url: `/pages/venue-pitch-setup/index?venue_id=${ready.venue.id}` });
  expect(wx.navigateTo).toHaveBeenCalledWith({ url: `/pages/venue-inventory/index?venue_id=${ready.venue.id}` });
});

test("production markup contains no Fixture controls and binds every visible business action", () => {
  const markup = readFileSync("miniprogram/pages/venue-profile/index.wxml", "utf8");
  expect(markup).not.toMatch(/Fixture|Production disabled|nextState/);
  for (const handler of ["onBack", "onReload", "onChooseImage", "onSetCover", "onRemoveImage", "onReorderImage", "onRetryModeration", "onDescriptionInput", "onToggleFacility", "onSave", "onRetryUnknown", "onNavigateWorkbench"]) expect(markup).toContain(handler);
});
