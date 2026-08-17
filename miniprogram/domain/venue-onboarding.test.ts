import { describe, expect, test } from "@jest/globals";

import {
  createEvidenceItems,
  decodeVenueOnboardingApplication,
  decodeVenueOnboardingApplications,
  decodeVenueOnboardingCandidates,
  decodeVenueOnboardingEvidenceClosed,
  decodeVenueOnboardingUploadIntent,
  presentApplicationStatus,
  submissionBlocker,
} from "./venue-onboarding";

const candidate = {
  venue_id: "7e68d7d8-4b7e-4f04-a5c5-3fe263e69c6f",
  name: "浦东滨江足球公园",
  district_name: "浦东新区",
  address: "滨江大道1000号",
};

const application = {
  application_id: "51479910-178f-43ba-941a-93c1aa8247f8",
  kind: "CREATE",
  status: "SUBMITTED",
  venue: { venue_id: null, name: "前滩社区足球场", address: "前滩大道88号" },
  submitted_at: "2026-08-17T09:35:00+08:00",
  updated_at: "2026-08-17T09:35:00+08:00",
};

describe("venue onboarding decoders", () => {
  test("strictly decodes candidates, uploads, completion and applicant applications", () => {
    expect(decodeVenueOnboardingCandidates({ items: [candidate], next_cursor: null })).toEqual({
      items: [{
        venueId: candidate.venue_id,
        name: candidate.name,
        districtName: candidate.district_name,
        address: candidate.address,
      }],
      nextCursor: null,
    });
    expect(decodeVenueOnboardingUploadIntent({
      evidence_id: "37e2344f-91e1-4754-a171-8047a06bb3c1",
      status: "PENDING_UPLOAD",
      post_policy: {
        url: "https://uploads.example.com/venue-onboarding",
        method: "POST",
        fields: { key: "opaque/${filename}", policy: "short-lived" },
        expires_at: "2026-08-17T09:45:00+08:00",
      },
      constraints: {
        kind: "BUSINESS_LICENSE",
        accepted_mime_types: ["image/jpeg", "image/png", "application/pdf"],
        maximum_bytes: 10485760,
      },
    })).toMatchObject({ evidenceId: "37e2344f-91e1-4754-a171-8047a06bb3c1", kind: "BUSINESS_LICENSE" });
    expect(decodeVenueOnboardingEvidenceClosed({
      evidence_id: "37e2344f-91e1-4754-a171-8047a06bb3c1",
      status: "COMPLETED",
    })).toEqual({ evidenceId: "37e2344f-91e1-4754-a171-8047a06bb3c1", status: "COMPLETED" });
    expect(decodeVenueOnboardingApplication(application)).toMatchObject({
      applicationId: application.application_id,
      kind: "CREATE",
      status: "SUBMITTED",
      venue: { venueId: null, name: application.venue.name },
    });
    expect(decodeVenueOnboardingApplications({ items: [{ ...application, rejection_reason: null }], next_cursor: null }).items).toHaveLength(1);
    expect(decodeVenueOnboardingApplications({ items: [{ ...application, status: "REJECTED", rejection_reason: "地址证明不完整" }], next_cursor: null }).items[0])
      .toMatchObject({ status: "REJECTED", rejectionReason: "地址证明不完整" });
  });

  test.each([
    [{ items: [{ ...candidate, private_key: "secret" }], next_cursor: null }],
    [{ items: [candidate], next_cursor: 1 }],
    [{ ...application, status: "REVIEWING" }],
  ])("rejects malformed or over-posted response %#", (value) => {
    const decode = "application_id" in value
      ? decodeVenueOnboardingApplication
      : decodeVenueOnboardingCandidates;
    expect(() => decode(value)).toThrow();
  });
});

test("required evidence and truthful application labels drive submission state", () => {
  const claim = createEvidenceItems("CLAIM");
  expect(claim.map(({ kind }) => kind)).toEqual(["MANAGEMENT_AUTHORIZATION", "VENUE_EXTERIOR"]);
  expect(createEvidenceItems("CREATE").slice(0, 2).map(({ helper }) => helper))
    .toEqual(["支持 JPG、PNG 图片", "支持 JPG、PNG 图片"]);
  expect(submissionBlocker({ selectedVenueId: "venue", contactName: "张三", maskedPhone: null, evidence: claim }))
    .toBe("请先验证联系电话");
  expect(submissionBlocker({ selectedVenueId: "venue", contactName: "张三", maskedPhone: "138****0000", evidence: claim }))
    .toContain("经营或管理授权证明");
  expect(presentApplicationStatus("SUBMITTED")).toEqual({ label: "审核中", tone: "reviewing" });
  expect(presentApplicationStatus("APPROVED")).toEqual({ label: "已通过", tone: "approved" });
  expect(presentApplicationStatus("REJECTED")).toEqual({ label: "未通过", tone: "rejected" });
});
