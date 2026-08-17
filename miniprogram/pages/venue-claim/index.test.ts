/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any -- dynamic Mini Program Page harness */

import { beforeEach, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";

import type { VenueOnboardingEvidenceKind } from "../../domain/venue-onboarding";
import type { VenueOnboardingDataSource, VenueOnboardingEvidenceCapability } from "../../services/venue-onboarding";
import { registerVenueOnboardingDataSource, registerVenueOnboardingEvidenceCapability, resetVenueOnboardingBindingsForTesting } from "../../services/venue-onboarding";

type RuntimePage = Record<string, any> & { data: Record<string, any>; setData(patch: Record<string, unknown>): void };
let definition: Record<string, any> | undefined;
const candidate = { venueId: "7e68d7d8-4b7e-4f04-a5c5-3fe263e69c6f", name: "浦东滨江足球公园", districtName: "浦东新区", address: "滨江大道1000号" };
const evidenceId = "37e2344f-91e1-4754-a171-8047a06bb3c1";
const application = { applicationId: "51479910-178f-43ba-941a-93c1aa8247f8", kind: "CLAIM" as const, status: "SUBMITTED" as const, venue: { venueId: candidate.venueId, name: candidate.name, address: candidate.address }, submittedAt: "2026-08-17T09:35:00+08:00", updatedAt: "2026-08-17T09:35:00+08:00", rejectionReason: null };

function source(): VenueOnboardingDataSource {
  return {
    login: jest.fn(async () => ({ userId: "user", maskedPhone: "138****0000", contactName: "张三" })),
    authorizePhone: jest.fn(async () => ({ maskedPhone: "138****0000" })),
    searchCandidates: jest.fn(async () => ({ items: [candidate], nextCursor: null })),
    listApplications: jest.fn(async () => ({ items: [], nextCursor: null })),
    createUploadIntent: jest.fn(async (kind: VenueOnboardingEvidenceKind) => ({ evidenceId, kind, postPolicy: { url: "https://oss.example.com", method: "POST" as const, fields: { key: "opaque/${filename}" }, expiresAt: "2099-01-01T00:00:00Z" }, acceptedMimeTypes: kind === "VENUE_EXTERIOR" ? ["image/jpeg", "image/png"] : ["image/jpeg", "image/png", "application/pdf"], maximumBytes: 15728640 })),
    completeEvidence: jest.fn(async () => ({ evidenceId, status: "COMPLETED" as const })),
    submitClaim: jest.fn(async () => application),
    submitCreate: jest.fn(async () => application),
  };
}

const media: VenueOnboardingEvidenceCapability = {
  choose: jest.fn(async (kind) => ({ tempFilePath: `/tmp/${kind}.jpg`, filename: `${kind}.jpg`, mimeType: "image/jpeg", byteSize: 42 })),
  upload: jest.fn(async () => undefined),
};

function page(): RuntimePage {
  if (!definition) { (globalThis as any).Page = (value: Record<string, any>) => { definition = value; }; jest.requireActual("./index"); }
  return { ...definition, data: structuredClone(definition!.data), disposed: false, writeInFlight: false, evidenceFiles: {}, evidenceAttempts: {}, setData(patch) { Object.assign(this.data, patch); } } as RuntimePage;
}

beforeEach(() => {
  jest.clearAllMocks();
  resetVenueOnboardingBindingsForTesting();
  (globalThis as any).wx = { getWindowInfo: jest.fn(() => ({ statusBarHeight: 59 })), getMenuButtonBoundingClientRect: jest.fn(() => ({ top: 63, left: 295, height: 32 })), navigateBack: jest.fn(), reLaunch: jest.fn(), redirectTo: jest.fn() };
});

test("searches, selects, uploads each required item and submits once", async () => {
  const api = source(); registerVenueOnboardingDataSource(api); registerVenueOnboardingEvidenceCapability(media); const target = page();
  await target.onLoad({});
  target.onSearchInput({ detail: { value: "浦东滨江" } }); await target.onSearch();
  target.onSelectCandidate({ currentTarget: { dataset: { candidateId: candidate.venueId } } });
  for (const kind of ["MANAGEMENT_AUTHORIZATION", "VENUE_EXTERIOR"]) await target.onChooseEvidence({ currentTarget: { dataset: { evidenceKind: kind } } });
  expect(target.data.submitDisabled).toBe(false);
  await target.onSubmit(); await target.onSubmit();
  expect(api.submitClaim).toHaveBeenCalledTimes(1);
  expect(api.submitClaim).toHaveBeenCalledWith(expect.objectContaining({ venueId: candidate.venueId, contactName: "张三", evidence: { MANAGEMENT_AUTHORIZATION: evidenceId, VENUE_EXTERIOR: evidenceId } }), expect.any(String));
  expect(target.data).toMatchObject({ mode: "submitted", application: expect.objectContaining({ status: "SUBMITTED" }) });
});

test("one evidence failure stays in its row and retry reuses the selected file", async () => {
  const api = source(); (media.upload as jest.MockedFunction<VenueOnboardingEvidenceCapability["upload"]>).mockRejectedValueOnce(new Error("oss")); registerVenueOnboardingDataSource(api); registerVenueOnboardingEvidenceCapability(media); const target = page(); await target.onLoad({});
  await target.onChooseEvidence({ currentTarget: { dataset: { evidenceKind: "VENUE_EXTERIOR" } } });
  expect(target.data.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "VENUE_EXTERIOR", status: "error" })]));
  await target.onRetryEvidence({ currentTarget: { dataset: { evidenceKind: "VENUE_EXTERIOR" } } });
  expect(media.choose).toHaveBeenCalledTimes(1);
  expect(target.data.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "VENUE_EXTERIOR", status: "completed" })]));
});

test("upload timeout leaves the evidence row in an explicit retryable error", async () => {
  const api = source();
  const timeoutMedia: VenueOnboardingEvidenceCapability = {
    choose: jest.fn(async () => ({ tempFilePath: "/tmp/stuck.jpg", filename: "stuck.jpg", mimeType: "image/jpeg", byteSize: 42 })),
    upload: jest.fn(async () => { throw new Error("OSS_UPLOAD_TIMEOUT"); }),
  };
  registerVenueOnboardingDataSource(api); registerVenueOnboardingEvidenceCapability(timeoutMedia);
  const target = page(); await target.onLoad({});
  await target.onChooseEvidence({ currentTarget: { dataset: { evidenceKind: "VENUE_EXTERIOR" } } });
  expect(target.data.evidence).toEqual(expect.arrayContaining([expect.objectContaining({
    kind: "VENUE_EXTERIOR", status: "error", retryMode: "retry", errorMessage: "上传超时，请重试",
  })]));
});

test("passes native getPhoneNumber detail to phone verification", async () => {
  const api = source();
  (api.login as jest.MockedFunction<VenueOnboardingDataSource["login"]>).mockResolvedValueOnce({ userId: "user", maskedPhone: null, contactName: "张三" });
  registerVenueOnboardingDataSource(api); registerVenueOnboardingEvidenceCapability(media);
  const target = page(); await target.onLoad({});
  await target.onAuthorizePhone({ detail: { code: "phone-code", errMsg: "getPhoneNumber:ok" } });
  expect(api.authorizePhone).toHaveBeenCalledWith({ code: "phone-code", errMsg: "getPhoneNumber:ok" });
  expect(target.data.maskedPhone).toBe("138****0000");
});

test("invalid server evidence response requires a fresh file selection", async () => {
  const api = source();
  (api.completeEvidence as jest.MockedFunction<VenueOnboardingDataSource["completeEvidence"]>)
    .mockRejectedValueOnce(Object.assign(new Error("invalid"), { code: "ONBOARDING_EVIDENCE_INVALID" }));
  const choose: jest.MockedFunction<VenueOnboardingEvidenceCapability["choose"]> = jest.fn();
  choose
    .mockResolvedValueOnce({ tempFilePath: "/tmp/bad.jpg", filename: "bad.jpg", mimeType: "image/jpeg", byteSize: 42 })
    .mockResolvedValueOnce({ tempFilePath: "/tmp/good.jpg", filename: "good.jpg", mimeType: "image/jpeg", byteSize: 42 });
  const replacementMedia: VenueOnboardingEvidenceCapability = {
    choose,
    upload: jest.fn(async () => undefined),
  };
  registerVenueOnboardingDataSource(api); registerVenueOnboardingEvidenceCapability(replacementMedia);
  const target = page(); await target.onLoad({});
  const event = { currentTarget: { dataset: { evidenceKind: "VENUE_EXTERIOR" } } };
  await target.onChooseEvidence(event);
  expect(target.data.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "VENUE_EXTERIOR", status: "error", retryMode: "reselect" })]));
  await target.onRetryEvidence(event);
  expect(replacementMedia.choose).toHaveBeenCalledTimes(2);
  expect(target.data.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "VENUE_EXTERIOR", status: "completed", fileName: "good.jpg" })]));
});

test("a stale completed-evidence reservation restarts with fresh keys and the same local file", async () => {
  const api = source();
  (api.completeEvidence as jest.MockedFunction<VenueOnboardingDataSource["completeEvidence"]>)
    .mockRejectedValueOnce(Object.assign(new Error("gone"), { code: "ONBOARDING_APPLICATION_NOT_FOUND" }));
  registerVenueOnboardingDataSource(api); registerVenueOnboardingEvidenceCapability(media);
  const target = page(); await target.onLoad({});
  const event = { currentTarget: { dataset: { evidenceKind: "VENUE_EXTERIOR" } } };
  await target.onChooseEvidence(event);
  expect(target.data.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "VENUE_EXTERIOR", status: "error", retryMode: "restart" })]));
  await target.onRetryEvidence(event);
  const calls = (api.createUploadIntent as jest.Mock).mock.calls;
  expect(calls[1][1]).not.toBe(calls[0][1]);
  expect(media.choose).toHaveBeenCalledTimes(1);
  expect(target.data.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "VENUE_EXTERIOR", status: "completed" })]));
});

test("unload aborts an in-flight upload and ignores its rejection", async () => {
  const api = source();
  let rejectUpload: ((reason: Error) => void) | undefined;
  const abortableMedia: VenueOnboardingEvidenceCapability = {
    choose: jest.fn(async () => ({ tempFilePath: "/tmp/stuck.jpg", filename: "stuck.jpg", mimeType: "image/jpeg", byteSize: 42 })),
    upload: jest.fn(() => new Promise<void>((_resolve, reject) => { rejectUpload = reject; })),
    abortAll: jest.fn(() => rejectUpload?.(new Error("OSS_UPLOAD_ABORTED"))),
  };
  registerVenueOnboardingDataSource(api); registerVenueOnboardingEvidenceCapability(abortableMedia);
  const target = page(); await target.onLoad({});
  const pending = target.onChooseEvidence({ currentTarget: { dataset: { evidenceKind: "VENUE_EXTERIOR" } } });
  await Promise.resolve(); await Promise.resolve();
  target.onUnload();
  await pending;
  expect(abortableMedia.abortAll).toHaveBeenCalledTimes(1);
  expect(target.data.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "VENUE_EXTERIOR", status: "uploading" })]));
});

test("returns to the existing portfolio page without growing the page stack", async () => {
  const api = source(); registerVenueOnboardingDataSource(api); registerVenueOnboardingEvidenceCapability(media);
  const target = page(); await target.onLoad({});
  target.onBack(); target.onReturnPortfolio();
  expect(wx.navigateBack).toHaveBeenCalledTimes(2);
  expect(wx.redirectTo).not.toHaveBeenCalled();
});

test("production claim markup has real search, phone, upload, retry and submit bindings", () => {
  const markup = readFileSync("miniprogram/pages/venue-claim/index.wxml", "utf8");
  for (const handler of ["onBack", "onSearchInput", "onSearch", "onSelectCandidate", "onAuthorizePhone", "onChooseEvidence", "onRetryEvidence", "onSubmit", "onReturnPortfolio"]) expect(markup).toContain(handler);
  expect(markup).not.toMatch(/视觉预览|Fixture/);
  expect(markup).toContain("item.retryMode === 'reselect' ? '重新选择'");
});
