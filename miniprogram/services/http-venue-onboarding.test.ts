import { describe, expect, jest, test } from "@jest/globals";
/* eslint-disable @typescript-eslint/no-explicit-any -- native WeChat callback harness */

import type { Transport, WeChatIdentityCapability, WeChatPhoneCapability } from "../runtime/interfaces";
import type { VenueOnboardingUploadIntent } from "../domain/venue-onboarding";
import type { SessionStore, StoredSession } from "./session-store";
import { createHttpVenueOnboardingDataSource } from "./http-venue-onboarding";
import { createWeChatVenueOnboardingEvidenceCapability } from "./venue-onboarding";

const session = {
  session_token: "wxsess_7jX9Qp2Lm8Vn4Rt6Yw3Kc5Hd1Bs0Fa9Eu7Gi2No6Zx4",
  expires_at: "2099-01-01T00:00:00Z",
  user: { id: "88888888-8888-4888-8888-888888888888", masked_phone: "138****0000", last_contact_name: "张三" },
};
const candidates = { items: [{ venue_id: "7e68d7d8-4b7e-4f04-a5c5-3fe263e69c6f", name: "浦东滨江足球公园", district_name: "浦东新区", address: "滨江大道1000号" }], next_cursor: null };
const uploadIntent = { evidence_id: "37e2344f-91e1-4754-a171-8047a06bb3c1", status: "PENDING_UPLOAD", post_policy: { url: "https://uploads.example.com/venue-onboarding", method: "POST", fields: { key: "opaque/${filename}", policy: "short" }, expires_at: "2099-01-01T00:00:00Z" }, constraints: { kind: "VENUE_EXTERIOR", accepted_mime_types: ["image/jpeg", "image/png"], maximum_bytes: 15728640 } };
const completed = { evidence_id: uploadIntent.evidence_id, status: "COMPLETED" };
const submitted = { application_id: "51479910-178f-43ba-941a-93c1aa8247f8", kind: "CREATE", status: "SUBMITTED", venue: { venue_id: null, name: "新场馆", address: "测试路1号" }, submitted_at: "2026-08-17T09:35:00+08:00", updated_at: "2026-08-17T09:35:00+08:00" };
const authRequired = { code: "HTTP_ERROR", statusCode: 401, data: { error: { code: "AUTH_REQUIRED", message: "expired", request_id: "req", details: {} } } };

describe("HTTP venue onboarding source", () => {
  test("uses bearer auth and exact contract routes for reads, uploads, phone and idempotent mutations", async () => {
    const x = harness();
    x.post.mockResolvedValueOnce(session);
    await expect(x.source.login()).resolves.toMatchObject({ maskedPhone: "138****0000", contactName: "张三" });
    expect(x.sessionStore.save).toHaveBeenCalledWith({
      token: session.session_token,
      expiresAt: session.expires_at,
      userId: session.user.id,
    });
    x.get.mockResolvedValueOnce(candidates).mockResolvedValueOnce({ items: [{ ...submitted, rejection_reason: null }], next_cursor: null });
    await x.source.searchCandidates("浦东 滨江");
    await x.source.listApplications();
    x.post.mockResolvedValueOnce({ masked_phone: "139****1111", verified_at: "2026-08-17T09:00:00+08:00" });
    await x.source.authorizePhone({ code: "phone-code", errMsg: "getPhoneNumber:ok" });
    x.post.mockResolvedValueOnce(uploadIntent).mockResolvedValueOnce(completed).mockResolvedValueOnce(submitted);
    await x.source.createUploadIntent("VENUE_EXTERIOR", "intent-key-123456");
    await x.source.completeEvidence(uploadIntent.evidence_id, "complete-key-1234");
    await x.source.submitCreate({
      name: "新场馆", address: "测试路1号", districtCode: "120101", districtName: "和平区",
      latitude: 39.1, longitude: 117.2, contactName: "张三",
      evidence: { BUSINESS_LICENSE: uploadIntent.evidence_id, MANAGEMENT_AUTHORIZATION: uploadIntent.evidence_id, VENUE_EXTERIOR: uploadIntent.evidence_id, VENUE_INTERIOR: uploadIntent.evidence_id },
    }, "create-key-123456");
    const bearer = { Authorization: `Bearer ${session.session_token}` };
    expect(x.get).toHaveBeenNthCalledWith(1, "/api/v1/venue-onboarding/candidates?q=%E6%B5%A6%E4%B8%9C%20%E6%BB%A8%E6%B1%9F&limit=20", bearer);
    expect(x.get).toHaveBeenNthCalledWith(2, "/api/v1/venue-onboarding/applications?limit=20", bearer);
    expect(x.post).toHaveBeenCalledWith("/api/v1/venue-onboarding/evidence/upload-intents", { kind: "VENUE_EXTERIOR" }, { ...bearer, "Idempotency-Key": "intent-key-123456" });
    expect(x.post).toHaveBeenCalledWith(`/api/v1/venue-onboarding/evidence/${uploadIntent.evidence_id}/complete`, undefined, { ...bearer, "Idempotency-Key": "complete-key-1234" });
    expect(x.post).toHaveBeenLastCalledWith("/api/v1/venue-onboarding/venues", expect.objectContaining({ district_code: "120101", contact_name: "张三" }), { ...bearer, "Idempotency-Key": "create-key-123456" });
  });

  test("reads, accepts and submits a token-locked invitation without a client venue id", async () => {
    const x = harness(session.session_token);
    const invitation = {
      viewer_state: "AVAILABLE",
      venue: candidates.items[0],
      expires_at: "2099-01-01T00:00:00Z",
      application_id: null,
      version: 1,
    };
    x.get.mockResolvedValueOnce(invitation);
    x.post.mockResolvedValueOnce({ ...invitation, viewer_state: "CLAIMED_BY_VIEWER", version: 2 });
    x.post.mockResolvedValueOnce({ ...submitted, kind: "CLAIM", venue: { ...submitted.venue, venue_id: candidates.items[0].venue_id } });
    const token = "Wm8Lk3R6uQ2pV9sH7xTa4bNcE5fG1jK0dZyR3qP6uQx";
    await x.source.readInvitation!(token);
    await x.source.acceptInvitation!(token, "accept-key-123456");
    await x.source.submitInvitedClaim!(token, {
      contactName: "张三",
      evidence: {
        MANAGEMENT_AUTHORIZATION: uploadIntent.evidence_id,
        VENUE_EXTERIOR: uploadIntent.evidence_id,
      },
    }, "invited-claim-key-123");
    const bearer = { Authorization: `Bearer ${session.session_token}` };
    expect(x.get).toHaveBeenCalledWith(`/api/v1/venue-invitations/${token}`, bearer);
    expect(x.post).toHaveBeenNthCalledWith(1, `/api/v1/venue-invitations/${token}/accept`, undefined, {
      ...bearer, "Idempotency-Key": "accept-key-123456",
    });
    expect(x.post).toHaveBeenNthCalledWith(2, `/api/v1/venue-invitations/${token}/claims`, {
      contact_name: "张三",
      evidence: { MANAGEMENT_AUTHORIZATION: uploadIntent.evidence_id, VENUE_EXTERIOR: uploadIntent.evidence_id },
    }, { ...bearer, "Idempotency-Key": "invited-claim-key-123" });
  });

  test("relogs once after 401 and replays the exact idempotent request", async () => {
    const x = harness("old-token");
    x.post.mockRejectedValueOnce(authRequired).mockResolvedValueOnce(session).mockResolvedValueOnce(submitted);
    const body = { venueId: candidates.items[0].venue_id, contactName: "张三", evidence: { MANAGEMENT_AUTHORIZATION: uploadIntent.evidence_id, VENUE_EXTERIOR: uploadIntent.evidence_id } };
    await expect(x.source.submitClaim(body, "same-claim-key-123")).resolves.toMatchObject({ status: "SUBMITTED" });
    const calls = x.post.mock.calls.filter(([path]) => path === "/api/v1/venue-onboarding/claims");
    expect(calls).toHaveLength(2);
    expect(calls[1]?.[1]).toEqual(calls[0]?.[1]);
    expect(calls[1]?.[2]?.["Idempotency-Key"]).toBe("same-claim-key-123");
    expect(calls[1]?.[2]?.Authorization).toBe(`Bearer ${session.session_token}`);
    expect(x.identity.login).toHaveBeenCalledTimes(1);
  });

  test("surfaces a safe public duplicate as a claim conversion and keeps hidden duplicates generic", async () => {
    const x = harness("old-token");
    x.post.mockRejectedValueOnce({ code: "HTTP_ERROR", statusCode: 409, data: { error: { code: "POSSIBLE_DUPLICATE_VENUE", message: "duplicate", request_id: "r", details: { claim_candidate: candidates.items[0] } } } });
    await expect(x.source.submitCreate({ name: "x", address: "a", districtCode: "120101", districtName: "和平区", latitude: 39, longitude: 117, contactName: "张三", evidence: { BUSINESS_LICENSE: uploadIntent.evidence_id, MANAGEMENT_AUTHORIZATION: uploadIntent.evidence_id, VENUE_EXTERIOR: uploadIntent.evidence_id, VENUE_INTERIOR: uploadIntent.evidence_id } }, "duplicate-key-123"))
      .rejects.toMatchObject({ code: "POSSIBLE_DUPLICATE_VENUE", duplicateCandidate: { venueId: candidates.items[0].venue_id } });
    const hidden = harness("old-token");
    hidden.post.mockRejectedValueOnce({ code: "HTTP_ERROR", statusCode: 409, data: { error: { code: "POSSIBLE_DUPLICATE_VENUE", message: "duplicate", request_id: "r", details: {} } } });
    await expect(hidden.source.submitCreate({ name: "x", address: "a", districtCode: "120101", districtName: "和平区", latitude: 39, longitude: 117, contactName: "张三", evidence: { BUSINESS_LICENSE: uploadIntent.evidence_id, MANAGEMENT_AUTHORIZATION: uploadIntent.evidence_id, VENUE_EXTERIOR: uploadIntent.evidence_id, VENUE_INTERIOR: uploadIntent.evidence_id } }, "hidden-key-123456"))
      .rejects.toMatchObject({ code: "POSSIBLE_DUPLICATE_VENUE", duplicateCandidate: undefined });
  });
});

describe("native onboarding evidence upload", () => {
  const policy: VenueOnboardingUploadIntent = {
    evidenceId: uploadIntent.evidence_id,
    kind: "VENUE_EXTERIOR",
    postPolicy: { url: "https://private-onboarding.oss-cn-beijing.aliyuncs.com", method: "POST", fields: { key: "opaque/${filename}", policy: "opaque-policy", "x-oss-signature": "opaque-signature" }, expiresAt: "2099-01-01T00:00:00Z" },
    acceptedMimeTypes: ["image/jpeg", "image/png"], maximumBytes: 15 * 1024 * 1024,
  };

  test("uses the native image picker for every evidence row and posts opaque OSS fields unchanged", async () => {
    const chooseMessageFile = jest.fn(({ success }) => success({ tempFiles: [{ path: "/tmp/license.pdf", name: "license.pdf", size: 42 }] }));
    const chooseMedia = jest.fn(({ success }) => success({ tempFiles: [{ tempFilePath: "/tmp/evidence.jpg", fileType: "image", size: 43 }] }));
    (globalThis as any).wx = {
      chooseMessageFile,
      chooseMedia,
      uploadFile: jest.fn(({ success }) => success({ statusCode: 201 })),
    };
    const capability = createWeChatVenueOnboardingEvidenceCapability();
    await expect(capability.choose("BUSINESS_LICENSE")).resolves.toMatchObject({ mimeType: "image/jpeg", byteSize: 43 });
    await expect(capability.choose("MANAGEMENT_AUTHORIZATION")).resolves.toMatchObject({ mimeType: "image/jpeg", byteSize: 43 });
    const photo = await capability.choose("VENUE_EXTERIOR");
    await capability.upload(photo, policy);
    expect(chooseMessageFile).not.toHaveBeenCalled();
    expect(chooseMedia).toHaveBeenCalledTimes(3);
    expect(wx.uploadFile).toHaveBeenCalledWith(expect.objectContaining({ url: policy.postPolicy.url, filePath: "/tmp/evidence.jpg", name: "file", formData: policy.postPolicy.fields }));
    const request = (wx.uploadFile as jest.Mock).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(request).not.toHaveProperty("header");
  });

  test("aborts an upload that produces no callback after fifteen seconds", async () => {
    jest.useFakeTimers();
    try {
      let request: { fail(result: { errMsg: string }): void } | undefined;
      const abort = jest.fn(() => request?.fail({ errMsg: "uploadFile:fail abort" }));
      (globalThis as any).wx = {
        uploadFile: jest.fn((options: { fail(result: { errMsg: string }): void }) => { request = options; return { abort }; }),
      };
      const capability = createWeChatVenueOnboardingEvidenceCapability();
      const pending = expect(capability.upload({ tempFilePath: "/tmp/stuck.jpg", filename: "stuck.jpg", mimeType: "image/jpeg", byteSize: 43 }, policy))
        .rejects.toThrow("OSS_UPLOAD_TIMEOUT");
      jest.advanceTimersByTime(15_000);
      await pending;
      expect(abort).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

function harness(token?: string) {
  let stored: StoredSession | null = token
    ? { token, expiresAt: "2099-01-01T00:00:00Z", userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }
    : null;
  const get = jest.fn<(path: string, headers?: Readonly<Record<string, string>>) => Promise<unknown>>();
  const post = jest.fn<(path: string, body: unknown, headers?: Readonly<Record<string, string>>) => Promise<unknown>>();
  const transport: Transport = { get: (path, headers) => get(path, headers) as never, post: (path, body, headers) => post(path, body, headers) as never, put: async () => undefined as never };
  const identity: WeChatIdentityCapability & { login: jest.Mock } = { login: jest.fn(async () => ({ code: "wx-code" })) };
  const phone: WeChatPhoneCapability = { normalizeEvent: jest.fn(() => ({ code: "phone-code" })) };
  const save = jest.fn((next: StoredSession) => { stored = next; });
  const sessionStore: SessionStore = { load: () => stored, save, clear: () => { stored = null; } };
  return { get, post, identity, sessionStore, source: createHttpVenueOnboardingDataSource({ transport, identity, phone, sessionStore }) };
}
