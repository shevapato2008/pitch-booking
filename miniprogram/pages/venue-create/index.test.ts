/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any -- dynamic Mini Program Page harness */

import { beforeEach, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";

import { createEvidenceItems, type VenueOnboardingEvidenceKind } from "../../domain/venue-onboarding";
import type { PoiSearchCapability } from "../../services/poi-search";
import { registerPoiSearchCapability } from "../../services/poi-search";
import type { VenueOnboardingDataSource, VenueOnboardingEvidenceCapability } from "../../services/venue-onboarding";
import { registerVenueOnboardingDataSource, registerVenueOnboardingEvidenceCapability, resetVenueOnboardingBindingsForTesting } from "../../services/venue-onboarding";

type RuntimePage = Record<string, any> & { data: Record<string, any>; setData(patch: Record<string, unknown>): void };
let definition: Record<string, any> | undefined;
const evidenceId = "37e2344f-91e1-4754-a171-8047a06bb3c1";
const duplicate = { venueId: "7e68d7d8-4b7e-4f04-a5c5-3fe263e69c6f", name: "浦东滨江足球公园", districtName: "浦东新区", address: "滨江大道1000号" };
const submitted = { applicationId: "51479910-178f-43ba-941a-93c1aa8247f8", kind: "CREATE" as const, status: "SUBMITTED" as const, venue: { venueId: null, name: "海河足球场", address: "海河东路188号" }, submittedAt: "2026-08-17T09:35:00+08:00", updatedAt: "2026-08-17T09:35:00+08:00", rejectionReason: null };

function source(): VenueOnboardingDataSource {
  return {
    login: jest.fn(async () => ({ userId: "user", maskedPhone: "138****0000", contactName: "张三" })), authorizePhone: jest.fn(async () => ({ maskedPhone: "138****0000" })),
    searchCandidates: jest.fn(async () => ({ items: [], nextCursor: null })), listApplications: jest.fn(async () => ({ items: [], nextCursor: null })),
    createUploadIntent: jest.fn(async (kind: VenueOnboardingEvidenceKind) => ({ evidenceId, kind, postPolicy: { url: "https://oss.example.com", method: "POST" as const, fields: { key: "opaque/${filename}" }, expiresAt: "2099-01-01T00:00:00Z" }, acceptedMimeTypes: ["image/jpeg", "image/png", "application/pdf"], maximumBytes: 15728640 })),
    completeEvidence: jest.fn(async () => ({ evidenceId, status: "COMPLETED" as const })), submitClaim: jest.fn(async () => submitted), submitCreate: jest.fn(async () => submitted),
  };
}
const media: VenueOnboardingEvidenceCapability = { choose: jest.fn(async (kind) => ({ tempFilePath: `/tmp/${kind}.jpg`, filename: `${kind}.jpg`, mimeType: "image/jpeg", byteSize: 42 })), upload: jest.fn(async () => undefined) };
const poi: PoiSearchCapability = { suggest: jest.fn(async () => [{ id: "poi", name: "海河足球场", address: "天津市河东区海河东路188号", city: "天津市", district: "河东区", adcode: "120102", latitude: 39.1, longitude: 117.2, coordinateSystem: "GCJ02" as const }]) };

function page(): RuntimePage {
  if (!definition) { (globalThis as any).Page = (value: Record<string, any>) => { definition = value; }; jest.requireActual("./index"); }
  return { ...definition, data: structuredClone(definition!.data), disposed: false, writeInFlight: false, evidenceFiles: {}, evidenceAttempts: {}, setData(patch) { Object.assign(this.data, patch); } } as RuntimePage;
}

beforeEach(() => { jest.clearAllMocks(); resetVenueOnboardingBindingsForTesting(); registerPoiSearchCapability(poi); (globalThis as any).wx = { getWindowInfo: jest.fn(() => ({ statusBarHeight: 59 })), getMenuButtonBoundingClientRect: jest.fn(() => ({ top: 63, left: 295, height: 32 })), navigateBack: jest.fn(), reLaunch: jest.fn(), redirectTo: jest.fn(), showActionSheet: jest.fn(({ success }) => success({ tapIndex: 0 })) }; });

test("uses a structured Tencent POI, uploads all evidence and submits real create fields", async () => {
  const api = source(); registerVenueOnboardingDataSource(api); registerVenueOnboardingEvidenceCapability(media); const target = page(); await target.onLoad({});
  target.onVenueNameInput({ detail: { value: "海河足球场" } }); target.onAddressInput({ detail: { value: "海河东路" } }); await target.onChooseMapLocation();
  for (const kind of ["BUSINESS_LICENSE", "MANAGEMENT_AUTHORIZATION", "VENUE_EXTERIOR", "VENUE_INTERIOR"]) await target.onChooseEvidence({ currentTarget: { dataset: { evidenceKind: kind } } });
  expect(target.data.submitDisabled).toBe(false); await target.onSubmit();
  expect(api.submitCreate).toHaveBeenCalledWith(expect.objectContaining({ districtCode: "120102", districtName: "河东区", latitude: 39.1, longitude: 117.2 }), expect.any(String));
  expect(target.data.mode).toBe("submitted");
});

test("a safe duplicate offers conversion to a preselected claim route", async () => {
  const api = source(); (api.submitCreate as jest.MockedFunction<VenueOnboardingDataSource["submitCreate"]>).mockRejectedValueOnce(Object.assign(new Error("duplicate"), { code: "POSSIBLE_DUPLICATE_VENUE", duplicateCandidate: duplicate })); registerVenueOnboardingDataSource(api); registerVenueOnboardingEvidenceCapability(media); const target = page(); target.setData({ submitDisabled: false, venueName: "海河足球场", address: "海河东路", location: { districtCode: "120102", districtName: "河东区", latitude: 39.1, longitude: 117.2 }, contactName: "张三", maskedPhone: "138****0000", evidence: createEvidenceItems("CREATE").map((item) => ({ ...item, status: "completed", evidenceId })) });
  await target.onSubmit(); expect(target.data).toMatchObject({ mode: "duplicate", duplicateCandidate: duplicate }); target.onConvertToClaim();
  expect(wx.redirectTo).toHaveBeenCalledWith({ url: expect.stringContaining(`/pages/venue-claim/index?candidate_id=${duplicate.venueId}`) });
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

test("expired upload policy starts a fresh reservation while keeping the selected file", async () => {
  const api = source();
  (api.createUploadIntent as jest.MockedFunction<VenueOnboardingDataSource["createUploadIntent"]>)
    .mockResolvedValueOnce({ evidenceId, kind: "VENUE_EXTERIOR", postPolicy: { url: "https://oss.example.com", method: "POST", fields: { key: "expired/${filename}" }, expiresAt: "2020-01-01T00:00:00Z" }, acceptedMimeTypes: ["image/jpeg"], maximumBytes: 15728640 })
    .mockResolvedValueOnce({ evidenceId, kind: "VENUE_EXTERIOR", postPolicy: { url: "https://oss.example.com", method: "POST", fields: { key: "fresh/${filename}" }, expiresAt: "2099-01-01T00:00:00Z" }, acceptedMimeTypes: ["image/jpeg"], maximumBytes: 15728640 });
  registerVenueOnboardingDataSource(api); registerVenueOnboardingEvidenceCapability(media);
  const target = page(); await target.onLoad({});
  const event = { currentTarget: { dataset: { evidenceKind: "VENUE_EXTERIOR" } } };
  await target.onChooseEvidence(event);
  expect(target.data.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "VENUE_EXTERIOR", status: "error", retryMode: "restart" })]));
  await target.onRetryEvidence(event);
  const firstKey = (api.createUploadIntent as jest.Mock).mock.calls[0][1];
  const secondKey = (api.createUploadIntent as jest.Mock).mock.calls[1][1];
  expect(secondKey).not.toBe(firstKey);
  expect(media.choose).toHaveBeenCalledTimes(1);
  expect(target.data.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "VENUE_EXTERIOR", status: "completed" })]));
});

test("returns to the existing portfolio page without growing the page stack", async () => {
  const api = source(); registerVenueOnboardingDataSource(api); registerVenueOnboardingEvidenceCapability(media);
  const target = page(); await target.onLoad({});
  target.onBack(); target.onReturnPortfolio();
  expect(wx.navigateBack).toHaveBeenCalledTimes(2);
  expect(wx.redirectTo).not.toHaveBeenCalled();
});

test("production create markup binds real location, phone, evidence and submission actions", () => {
  const markup = readFileSync("miniprogram/pages/venue-create/index.wxml", "utf8");
  for (const handler of ["onBack", "onVenueNameInput", "onAddressInput", "onChooseMapLocation", "onAuthorizePhone", "onChooseEvidence", "onRetryEvidence", "onSubmit", "onConvertToClaim", "onReturnPortfolio"]) expect(markup).toContain(handler);
  expect(markup).not.toMatch(/视觉预览|Fixture/);
  expect(markup).toContain("item.retryMode === 'reselect' ? '重新选择'");
});
