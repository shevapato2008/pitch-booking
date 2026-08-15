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
  for (const handler of ["onRefreshImageStatus", "onRefreshDescriptionStatus", "onSubmitDescription", "onRetryDescription", "onSaveFacilities", "onRetryUnknown"]) expect(markup).toContain(handler);
  expect(markup).toContain("imageRefreshError"); expect(markup).toContain("descriptionRefreshError"); expect(markup).toContain("descriptionActionLabel");
  expect(markup).toContain("保存场馆设施"); expect(markup).not.toContain("保存场馆资料"); expect(markup).not.toContain("onRefreshReviewStatus"); expect(markup).not.toContain("onRetryUpload"); expect(json).toContain('"enablePullDownRefresh":true');
});

test("facility buttons retain their centered 88rpx touch target", () => {
  const styles = readFileSync("miniprogram/pages/venue-profile/index.wxss", "utf8"); expect(styles).toMatch(/\.venue-profile__chip\s*\{[^}]*display:flex;[^}]*height:88rpx;[^}]*align-items:center;[^}]*justify-content:center;/);
});

test("a clean rejected description retries its own moderation item and a dirty one submits a modification", async () => {
  jest.useFakeTimers(); const rejected = { ...ready, currentRevision: { ...ready.currentRevision, summaryState: "REJECTED" as const, descriptionState: "REJECTED" as const } }; const api = source(); api.get.mockResolvedValue(rejected); api.retryModeration.mockResolvedValue(rejected); registerVenueProfileDataSource(api);
  const page = loadPage(); await page.onLoad({ venue_id: ready.venue.id }); expect(page.data.descriptionActionLabel).toBe("重新审核介绍"); await page.onRetryDescription();
  expect(api.retryModeration).toHaveBeenCalledWith(expect.objectContaining({ itemId: rejected.currentRevision.id })); await jest.advanceTimersByTimeAsync(5000); expect(api.get).toHaveBeenCalledTimes(2);
  page.onDescriptionInput({ detail: { value: "修改后的介绍" } }); expect(page.data.descriptionActionLabel).toBe("提交修改"); page.onUnload();
});

test("restores a persisted scoped save into its region and replays the exact key without clearing another draft", async () => {
  const attempt = { kind: "save" as const, scope: "description" as const, venueId: ready.venue.id, body: { expectedFacilityVersion: ready.facilityVersion, expectedRevisionVersion: ready.revisionVersion, description: "待重试", facilities: ready.currentRevision.facilities }, idempotencyKey: "original-description-key-123" }; stored = structuredClone(attempt); const api = source(); api.save.mockResolvedValue(next()); registerVenueProfileDataSource(api);
  const page = loadPage(); await page.onLoad({ venue_id: ready.venue.id }); page.onToggleFacility({ currentTarget: { dataset: { facilityCode: "LOCKERS" } } }); expect(page.data.unknownScope).toBe("description"); await page.onRetryUnknown();
  expect(api.save).toHaveBeenCalledWith(attempt); expect(page.data).toMatchObject({ descriptionDirty: false, facilitiesDirty: true }); page.onUnload();
});

test("conflicts refresh authoritatively without replacing either local draft or adding a regional generic error", async () => {
  const api = source(); api.save.mockRejectedValueOnce(Object.assign(new Error(), { code: "VENUE_PROFILE_VERSION_CONFLICT" })); registerVenueProfileDataSource(api); const page = loadPage(); await page.onLoad({ venue_id: ready.venue.id }); page.onDescriptionInput({ detail: { value: "本地介绍" } }); page.onToggleFacility({ currentTarget: { dataset: { facilityCode: "LOCKERS" } } }); await page.onSubmitDescription();
  expect(api.get).toHaveBeenCalledTimes(2); expect(page.data).toMatchObject({ description: "本地介绍", descriptionDirty: true, facilitiesDirty: true, descriptionActionError: "" });
});

test("ordinary image, description, and facility failures remain in their owning regions", async () => {
  const api = source(); registerVenueProfileDataSource(api); const page = loadPage(); await page.onLoad({ venue_id: ready.venue.id }); api.save.mockRejectedValueOnce(new Error("description")); page.onDescriptionInput({ detail: { value: "介绍" } }); await page.onSubmitDescription(); expect(page.data).toMatchObject({ descriptionActionError: "介绍提交失败，请重试", facilitySaveError: "", imageActionError: "" });
  expect(page.data.unknownScope).toBe("description"); stored = null; page.setData({ unknownScope: "" });
  api.save.mockRejectedValueOnce(new Error("facilities")); page.onToggleFacility({ currentTarget: { dataset: { facilityCode: "LOCKERS" } } }); await page.onSaveFacilities(); expect(page.data).toMatchObject({ facilitySaveError: "设施保存失败，请重试", imageActionError: "" });
  expect(page.data.unknownScope).toBe("facilities"); stored = null; page.setData({ unknownScope: "" });
  api.createUploadIntent.mockRejectedValueOnce(new Error("image")); await page.onChooseImage(); expect(page.data).toMatchObject({ imageActionError: "图片操作失败，请重试", descriptionActionError: "介绍提交失败，请重试" });
  expect(page.data.unknownScope).toBe("image");
});

test("only pending moderation blocks facilities and only a pending image loses its own actions", async () => {
  const api = source(); registerVenueProfileDataSource(api); const pendingImage = { ...ready, currentRevision: { ...ready.currentRevision, summaryState: "REVIEWING" as const, images: ready.currentRevision.images.map((image, index) => ({ ...image, state: index === 0 ? "REVIEWING" as const : "APPROVED" as const })) } }; const page = loadPage(); page.applyProfile(pendingImage); page.onToggleFacility({ currentTarget: { dataset: { facilityCode: "LOCKERS" } } });
  expect(page.data).toMatchObject({ facilitySaveBlockedReason: expect.any(String), imageActionsEnabled: true }); expect(page.data.images).toEqual(expect.arrayContaining([expect.objectContaining({ state: "REVIEWING", actionsEnabled: false }), expect.objectContaining({ state: "APPROVED", actionsEnabled: true })]));
  await page.onSetCover({ currentTarget: { dataset: { imageId: pendingImage.currentRevision.images[1].id } } }); expect(api.setCover).toHaveBeenCalledTimes(1);
  const rejected = { ...ready, currentRevision: { ...ready.currentRevision, summaryState: "REJECTED" as const, descriptionState: "REJECTED" as const } }; page.applyProfile(rejected); expect(page.data.facilitySaveBlockedReason).toBe(""); page.applyProfile(ready); expect(page.data.facilitySaveBlockedReason).toBe("");
});

test("upload completion increments the revision and navigation and either local dirty flag retain their existing safeguards", async () => {
  const api = source(); registerVenueProfileDataSource(api); const page = loadPage(); await page.onLoad({ venue_id: ready.venue.id }); await page.onChooseImage(); expect(api.completeUpload).toHaveBeenCalledWith(expect.objectContaining({ expectedRevisionVersion: ready.revisionVersion + 1 }));
  page.onToggleFacility({ currentTarget: { dataset: { facilityCode: "LOCKERS" } } }); page.onBack(); expect(wx.showModal).toHaveBeenCalled(); page.onNavigateWorkbench({ currentTarget: { dataset: { target: "inventory" } } }); expect(wx.navigateTo).toHaveBeenCalledWith({ url: `/pages/venue-inventory/index?venue_id=${ready.venue.id}` }); page.onUnload();
});

test("an unknown complete replay that returns reviewing schedules the image refresh", async () => {
  jest.useFakeTimers(); const intentImageId = "c3195309-183b-46cc-81e6-2c0977223099"; const attempt = { kind: "complete" as const, venueId: ready.venue.id, imageId: intentImageId, expectedRevisionVersion: ready.revisionVersion + 1, idempotencyKey: "original-complete-key-123" }; stored = structuredClone(attempt); const api = source(); api.completeUpload.mockResolvedValue(reviewing); registerVenueProfileDataSource(api);
  const page = loadPage(); await page.onLoad({ venue_id: ready.venue.id }); await page.onRetryUnknown(); expect(api.completeUpload).toHaveBeenCalledWith(attempt); await jest.advanceTimersByTimeAsync(5000); expect(api.get).toHaveBeenCalledTimes(2); page.onUnload();
});

test("attempt-store conflicts are rendered in their owning region instead of escaping", async () => {
  const conflictingStore: VenueProfileAttemptStore = { load: () => null, begin: () => { throw new Error("conflict"); }, clear: () => undefined }; registerVenueProfileAttemptStore(conflictingStore); const page = loadPage(); await page.onLoad({ venue_id: ready.venue.id }); page.onDescriptionInput({ detail: { value: "介绍" } }); await expect(page.onSubmitDescription()).resolves.toBeUndefined(); expect(page.data.descriptionActionError).toBe("介绍提交失败，请重试");
});

test("facility save disables immediately while its request is in flight and suppresses a duplicate", async () => {
  const api = source(); let resolveSave!: (value: typeof ready) => void; api.save.mockImplementationOnce(() => new Promise((resolve) => { resolveSave = resolve; })); registerVenueProfileDataSource(api); const page = loadPage(); await page.onLoad({ venue_id: ready.venue.id }); page.onToggleFacility({ currentTarget: { dataset: { facilityCode: "LOCKERS" } } });
  const save = page.onSaveFacilities(); expect(page.data).toMatchObject({ facilitySaveBusy: true, facilitySaveEnabled: false }); await page.onSaveFacilities(); expect(api.save).toHaveBeenCalledTimes(1);
  resolveSave(next()); await save; expect(page.data.facilitySaveBusy).toBe(false);
});

test("one controller write guard serializes description, facilities, image, and unknown-result retries", async () => {
  const api = source(); let resolveSave!: (value: typeof ready) => void; api.save.mockImplementationOnce(() => new Promise((resolve) => { resolveSave = resolve; })); registerVenueProfileDataSource(api); const page = loadPage(); await page.onLoad({ venue_id: ready.venue.id }); page.onDescriptionInput({ detail: { value: "介绍" } }); page.onToggleFacility({ currentTarget: { dataset: { facilityCode: "LOCKERS" } } });
  const pendingSave = page.onSubmitDescription(); expect(page.data.writeBusy).toBe(true); await page.onSaveFacilities(); await page.onChooseImage(); expect(api.save).toHaveBeenCalledTimes(1); expect(api.createUploadIntent).not.toHaveBeenCalled(); resolveSave(next()); await pendingSave;
  stored = { kind: "save", scope: "facilities", venueId: ready.venue.id, body: { expectedFacilityVersion: ready.facilityVersion, expectedRevisionVersion: ready.revisionVersion, description: ready.currentRevision.description, facilities: ["LOCKERS"] }, idempotencyKey: "unknown-facilities-key-123" }; let resolveRetry!: (value: typeof ready) => void; api.save.mockImplementationOnce(() => new Promise((resolve) => { resolveRetry = resolve; })); const retry = page.onRetryUnknown(); await page.onRetryUnknown(); expect(api.save).toHaveBeenCalledTimes(2); resolveRetry(next()); await retry; page.onUnload();
});

test("a stale GET cannot overwrite a newer facility save and a late mutation after unload is inert", async () => {
  jest.useFakeTimers(); const api = source(); registerVenueProfileDataSource(api); const page = loadPage(); await page.onLoad({ venue_id: ready.venue.id }); let resolveRead!: (value: typeof ready) => void; api.get.mockImplementationOnce(() => new Promise((resolve) => { resolveRead = resolve; })); const read = page.onPullDownRefresh(); page.onToggleFacility({ currentTarget: { dataset: { facilityCode: "LOCKERS" } } }); await page.onSaveFacilities(); const saved = page.data.profile; resolveRead(ready); await read; expect(page.data.profile).toEqual(saved);
  let resolveSave!: (value: typeof ready) => void; api.save.mockImplementationOnce(() => new Promise((resolve) => { resolveSave = resolve; })); page.onToggleFacility({ currentTarget: { dataset: { facilityCode: "PARKING" } } }); const write = page.onSaveFacilities(); page.onUnload(); resolveSave(next()); await write; await jest.advanceTimersByTimeAsync(5000); expect(api.get).toHaveBeenCalledTimes(2);
});

test("post-load permission failures disable all write actions and page refresh failure uses error tone", async () => {
  const api = source(); registerVenueProfileDataSource(api); const page = loadPage(); await page.onLoad({ venue_id: ready.venue.id }); api.get.mockRejectedValueOnce(Object.assign(new Error(), { code: "VENUE_PROFILE_FORBIDDEN" })); await page.onPullDownRefresh(); expect(page.data).toMatchObject({ mode: "permission-error", descriptionEditable: false, facilitiesEditable: false, imageActionsEnabled: false, writeBusy: false });
  const another = loadPage(); await another.onLoad({ venue_id: ready.venue.id }); api.save.mockRejectedValueOnce(Object.assign(new Error(), { code: "VENUE_PROFILE_FORBIDDEN" })); another.onDescriptionInput({ detail: { value: "介绍" } }); await another.onSubmitDescription(); expect(another.data).toMatchObject({ mode: "permission-error", descriptionEditable: false, facilitiesEditable: false, imageActionsEnabled: false, writeBusy: false });
  const refresh = loadPage(); await refresh.onLoad({ venue_id: ready.venue.id }); api.get.mockRejectedValueOnce(new Error("network")); await refresh.onPullDownRefresh(); expect(refresh.data).toMatchObject({ tone: "error", statusDetail: expect.stringContaining("刷新") });
});

test("image mutations retain signed upload, endpoint routing, and persisted upload intent replay", async () => {
  const api = source(); registerVenueProfileDataSource(api); const page = loadPage(); await page.onLoad({ venue_id: ready.venue.id }); await page.onChooseImage(); expect(media.upload).toHaveBeenCalledWith("https://oss.example.com/image", expect.any(ArrayBuffer), { "Content-Type": "image/webp", "Content-Length": "3" }); expect(api.completeUpload).toHaveBeenCalledWith(expect.objectContaining({ expectedRevisionVersion: ready.revisionVersion + 1 }));
  const imageId = ready.currentRevision.images[1].id; await page.onSetCover({ currentTarget: { dataset: { imageId } } }); const third = { ...page.data.images[1], id: "c3195309-183b-46cc-81e6-2c0977223003" }; page.setData({ images: [...page.data.images, third], imageCount: 3 }); await page.onReorderImage({ currentTarget: { dataset: { imageId: third.id, direction: -1 } } }); await page.onRemoveImage({ currentTarget: { dataset: { imageId } } }); await page.onRetryModeration({ currentTarget: { dataset: { itemId: imageId } } }); expect(api.setCover).toHaveBeenCalledTimes(1); expect(api.reorderImages).toHaveBeenCalledTimes(1); expect(api.deleteImage).toHaveBeenCalledTimes(1); expect(api.retryModeration).toHaveBeenCalledTimes(1);
  const attempt = { kind: "uploadIntent" as const, venueId: ready.venue.id, body: { expectedRevisionVersion: ready.revisionVersion, filename: "field.webp", mimeType: "image/webp" as const, byteSize: 3 }, idempotencyKey: "original-upload-intent-key-123" }; stored = structuredClone(attempt); await page.onRetryUnknown(); expect(api.createUploadIntent).toHaveBeenCalledWith(attempt); page.onUnload();
});

test("production markup binds every visible business handler", () => {
  const markup = readFileSync("miniprogram/pages/venue-profile/index.wxml", "utf8"); for (const handler of ["onBack", "onReload", "onChooseImage", "onSetCover", "onRemoveImage", "onReorderImage", "onRetryModeration", "onRefreshImageStatus", "onDescriptionInput", "onRefreshDescriptionStatus", "onSubmitDescription", "onRetryDescription", "onToggleFacility", "onSaveFacilities", "onRetryUnknown", "onNavigateWorkbench"]) expect(markup).toContain(handler);
});

test("save success preserves a newer description or facilities edit made while the request was pending", async () => {
  const api = source(); let resolveDescription!: (value: typeof ready) => void; api.save.mockImplementationOnce(() => new Promise((resolve) => { resolveDescription = resolve; })); registerVenueProfileDataSource(api); const page = loadPage(); await page.onLoad({ venue_id: ready.venue.id }); page.onDescriptionInput({ detail: { value: "first" } }); const descriptionSave = page.onSubmitDescription(); page.onDescriptionInput({ detail: { value: "second" } }); resolveDescription(next()); await descriptionSave; expect(page.data).toMatchObject({ description: "second", descriptionDirty: true });
  let resolveFacilities!: (value: typeof ready) => void; api.save.mockImplementationOnce(() => new Promise((resolve) => { resolveFacilities = resolve; })); page.onToggleFacility({ currentTarget: { dataset: { facilityCode: "LOCKERS" } } }); const facilitySave = page.onSaveFacilities(); page.onToggleFacility({ currentTarget: { dataset: { facilityCode: "PARKING" } } }); const newerFacilities = [...page.data.facilities]; resolveFacilities(next()); await facilitySave; expect(page.data).toMatchObject({ facilitiesDirty: true }); expect(page.data.facilities).toEqual(newerFacilities); page.onUnload();
});

test("permission disables rejected-image retry and unknown scope allows replay but blocks new writes", async () => {
  const rejected = { ...ready, currentRevision: { ...ready.currentRevision, images: ready.currentRevision.images.map((image, index) => ({ ...image, state: index === 1 ? "REJECTED" as const : image.state })) } }; const api = source(); registerVenueProfileDataSource(api); const page = loadPage(); page.applyProfile(rejected); page.disableForPermission(); await page.onRetryModeration({ currentTarget: { dataset: { itemId: rejected.currentRevision.images[1].id } } }); expect(api.retryModeration).not.toHaveBeenCalled();
  const attempt = { kind: "save" as const, scope: "description" as const, venueId: ready.venue.id, body: { expectedFacilityVersion: ready.facilityVersion, expectedRevisionVersion: ready.revisionVersion, description: "retry", facilities: ready.currentRevision.facilities }, idempotencyKey: "unknown-description-key-456" }; stored = structuredClone(attempt); const replay = loadPage(); await replay.onLoad({ venue_id: ready.venue.id }); replay.onDescriptionInput({ detail: { value: "new local draft" } }); await replay.onSubmitDescription(); await replay.onSaveFacilities(); await replay.onChooseImage(); expect(api.save).not.toHaveBeenCalled(); expect(api.createUploadIntent).not.toHaveBeenCalled(); await replay.onRetryUnknown(); expect(api.save).toHaveBeenCalledWith(attempt); expect(replay.data.unknownScope).toBe(""); replay.onUnload();
});

test("disposed failures and conflicts do not update state or start reads", async () => {
  const api = source(); let rejectSave!: (error: unknown) => void; api.save.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectSave = reject; })); registerVenueProfileDataSource(api); const page = loadPage(); await page.onLoad({ venue_id: ready.venue.id }); page.onDescriptionInput({ detail: { value: "late" } }); const rejected = page.onSubmitDescription(); page.onUnload(); rejectSave(new Error("late")); await rejected; expect(api.get).toHaveBeenCalledTimes(1);
  stored = null; const conflictApi = source(); let rejectConflict!: (error: unknown) => void; conflictApi.save.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectConflict = reject; })); registerVenueProfileDataSource(conflictApi); const conflict = loadPage(); await conflict.onLoad({ venue_id: ready.venue.id }); conflict.onDescriptionInput({ detail: { value: "late conflict" } }); const pending = conflict.onSubmitDescription(); await Promise.resolve(); conflict.onUnload(); rejectConflict(Object.assign(new Error(), { code: "VENUE_PROFILE_VERSION_CONFLICT" })); await pending; expect(conflictApi.get).toHaveBeenCalledTimes(1);
});

test("only the current overlapping refresh clears its own busy state", async () => {
  const api = source(); api.get.mockResolvedValue(reviewing); registerVenueProfileDataSource(api); const page = loadPage(); await page.onLoad({ venue_id: ready.venue.id }); let resolveOld!: (value: typeof reviewing) => void; let resolveNew!: (value: typeof reviewing) => void; api.get.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; })).mockImplementationOnce(() => new Promise((resolve) => { resolveNew = resolve; })); const old = page.onRefreshImageStatus(); page.invalidateReads(); const current = page.onRefreshDescriptionStatus(); resolveOld(reviewing); await old; expect(page.data.descriptionRefreshBusy).toBe(true); resolveNew(reviewing); await current;
});

test("normal save refreshes never leave a temporary attempt exposed as unknown", async () => {
  const api = source(); let resolveSave!: (value: typeof ready) => void; api.save.mockImplementationOnce(() => new Promise((resolve) => { resolveSave = resolve; })); registerVenueProfileDataSource(api); const page = loadPage(); await page.onLoad({ venue_id: ready.venue.id }); page.onDescriptionInput({ detail: { value: "保存中" } }); const save = page.onSubmitDescription(); await page.onPullDownRefresh(); expect(page.data.unknownScope).toBe(""); resolveSave(next()); await save; expect(page.data.unknownScope).toBe(""); expect(stored).toBeNull(); page.onUnload();
});

test("successful reads and missing-attempt recovery clear stale unknown scope", async () => {
  const page = loadPage(); await page.onLoad({ venue_id: ready.venue.id }); page.setData({ unknownScope: "description" }); await page.onPullDownRefresh(); expect(page.data.unknownScope).toBe(""); page.setData({ unknownScope: "image" }); await page.onRetryUnknown(); expect(page.data.unknownScope).toBe("");
});

test("OSS upload failure exposes and replays its original persisted upload intent", async () => {
  const api = source(); registerVenueProfileDataSource(api); media.upload.mockRejectedValueOnce(new Error("oss")); const page = loadPage(); await page.onLoad({ venue_id: ready.venue.id }); await page.onChooseImage(); const original = stored; expect(page.data.unknownScope).toBe("image"); expect(original).toMatchObject({ kind: "uploadIntent", body: { filename: "field.webp", mimeType: "image/webp", byteSize: 3 } }); await page.onRetryUnknown(); expect(api.createUploadIntent).toHaveBeenLastCalledWith(original); page.onUnload();
});
